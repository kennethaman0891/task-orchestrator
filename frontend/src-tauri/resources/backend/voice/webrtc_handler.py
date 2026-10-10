"""
WebRTC signaling and media handling for browser <-> sidecar audio streaming.
"""

import asyncio
import json
import logging
from typing import Dict, Optional, AsyncGenerator
from dataclasses import dataclass, field

from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack, RTCIceCandidate
from aiortc.contrib.media import MediaRelay, MediaStreamError
from aiohttp import web

from .pipeline import VoicePipeline, VoiceConfig

logger = logging.getLogger(__name__)


@dataclass
class VoiceSession:
    """Active voice session state."""
    session_id: str
    peer_connection: RTCPeerConnection
    terminal_id: Optional[str] = None
    conversation_history: list = field(default_factory=list)
    audio_track: Optional[MediaStreamTrack] = None
    data_channel: Optional = None
    created_at: float = field(default_factory=lambda: asyncio.get_event_loop().time())
    last_activity: float = field(default_factory=lambda: asyncio.get_event_loop().time())


class VoiceWebRTCHandler:
    """
    Handles WebRTC connections for voice streaming between browser and sidecar.
    
    Flow:
    1. Browser creates offer -> POST /voice/offer
    2. Sidecar creates answer, sets up audio track handling
    3. Browser sends audio via WebRTC track
    4. Sidecar processes through VoicePipeline
    5. Sidecar sends TTS audio back via data channel (or new track)
    """
    
    def __init__(self, voice_pipeline: VoicePipeline):
        self.pipeline = voice_pipeline
        self.peer_connections: Dict[str, RTCPeerConnection] = {}
        self.sessions: Dict[str, VoiceSession] = {}
        self.relay = MediaRelay()
        self._cleanup_task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Start background cleanup task."""
        self._cleanup_task = asyncio.create_task(self._cleanup_stale_sessions())
        logger.info("Voice WebRTC handler started")
    
    async def stop(self):
        """Stop handler and close all connections."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        # Close all peer connections
        for session_id in list(self.sessions.keys()):
            await self._cleanup_session(session_id)
        
        logger.info("Voice WebRTC handler stopped")
    
    async def _cleanup_stale_sessions(self):
        """Periodically clean up stale sessions."""
        while True:
            try:
                await asyncio.sleep(60)  # Check every minute
                now = asyncio.get_event_loop().time()
                stale = [
                    sid for sid, session in self.sessions.items()
                    if now - session.last_activity > 300  # 5 min timeout
                ]
                for sid in stale:
                    logger.info(f"Cleaning up stale session: {sid}")
                    await self._cleanup_session(sid)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Cleanup error: {e}")
    
    # ==================== HTTP Handlers ====================
    
    async def handle_offer(self, request: web.Request) -> web.Response:
        """
        Handle WebRTC offer from browser.
        
        Expected JSON:
        {
            "sessionId": "terminal-123",
            "sdp": "...",
            "type": "offer",
            "terminalId": "optional-terminal-id"
        }
        """
        try:
            params = await request.json()
            session_id = params.get("sessionId", "default")
            terminal_id = params.get("terminalId")
            
            # Validate offer
            if "sdp" not in params or "type" not in params:
                return web.json_response({"error": "Missing sdp or type"}, status=400)
            
            offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
            
            # Create peer connection
            pc = RTCPeerConnection()
            self.peer_connections[session_id] = pc
            
            # Create session state
            session = VoiceSession(
                session_id=session_id,
                peer_connection=pc,
                terminal_id=terminal_id
            )
            self.sessions[session_id] = session
            
            # Set up event handlers
            self._setup_peer_connection_handlers(session)
            
            # Set remote description
            await pc.setRemoteDescription(offer)
            
            # Create answer
            answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            
            logger.info(f"WebRTC offer accepted for session: {session_id}")
            
            return web.json_response({
                "sdp": pc.localDescription.sdp,
                "type": pc.localDescription.type,
                "sessionId": session_id
            })
            
        except Exception as e:
            logger.error(f"Offer handling failed: {e}")
            return web.json_response({"error": str(e)}, status=500)
    
    async def handle_ice_candidate(self, request: web.Request) -> web.Response:
        """Handle ICE candidate from browser."""
        try:
            params = await request.json()
            session_id = params.get("sessionId", "default")
            
            pc = self.peer_connections.get(session_id)
            if not pc:
                return web.json_response({"error": "Session not found"}, status=404)
            
            candidate_data = params.get("candidate")
            if candidate_data:
                candidate = RTCIceCandidate(
                    sdpMid=candidate_data.get("sdpMid"),
                    sdpMLineIndex=candidate_data.get("sdpMLineIndex"),
                    candidate=candidate_data.get("candidate")
                )
                await pc.addIceCandidate(candidate)
            
            return web.json_response({"success": True})
            
        except Exception as e:
            logger.error(f"ICE candidate handling failed: {e}")
            return web.json_response({"error": str(e)}, status=500)
    
    async def handle_message(self, request: web.Request) -> web.Response:
        """
        Handle signaling messages (for data channel communication fallback).
        """
        try:
            params = await request.json()
            session_id = params.get("sessionId", "default")
            
            session = self.sessions.get(session_id)
            if not session or not session.data_channel:
                return web.json_response({"error": "No data channel"}, status=404)
            
            # Forward message to data channel
            message = params.get("message", "")
            session.data_channel.send(json.dumps(message))
            
            return web.json_response({"success": True})
            
        except Exception as e:
            logger.error(f"Message handling failed: {e}")
            return web.json_response({"error": str(e)}, status=500)
    
    # ==================== Peer Connection Setup ====================
    
    def _setup_peer_connection_handlers(self, session: VoiceSession):
        """Set up event handlers for a peer connection."""
        pc = session.peer_connection
        session_id = session.session_id
        
        @pc.on("track")
        def on_track(track: MediaStreamTrack):
            if track.kind == "audio":
                logger.info(f"Audio track received for session {session_id}")
                session.audio_track = track
                session.last_activity = asyncio.get_event_loop().time()
                # Start processing audio
                asyncio.create_task(self._handle_audio_track(session, track))
        
        @pc.on("datachannel")
        def on_datachannel(channel):
            logger.info(f"Data channel opened for session {session_id}: {channel.label}")
            session.data_channel = channel
            session.last_activity = asyncio.get_event_loop().time()
            
            @channel.on("message")
            def on_message(message):
                asyncio.create_task(self._handle_data_channel_message(session, message))
            
            @channel.on("close")
            def on_close():
                logger.info(f"Data channel closed for session {session_id}")
                session.data_channel = None
        
        @pc.on("connectionstatechange")
        async def on_connectionstatechange():
            logger.info(f"Connection state for {session_id}: {pc.connectionState}")
            session.last_activity = asyncio.get_event_loop().time()
            
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self._cleanup_session(session_id)
        
        @pc.on("iceconnectionstatechange")
        async def on_iceconnectionstatechange():
            logger.debug(f"ICE state for {session_id}: {pc.iceConnectionState}")
    
    # ==================== Audio Processing ====================
    
    async def _handle_audio_track(self, session: VoiceSession, track: MediaStreamTrack):
        """Process incoming audio track from browser."""
        # Validate audio track parameters
        if not hasattr(track, 'kind') or track.kind != "audio":
            logger.warning(f"Invalid track kind for session {session.session_id}: {getattr(track, 'kind', 'unknown')}")
            return
        
        # Check track settings (sample rate, etc.) if available
        # aiortc MediaStreamTrack doesn't expose sample rate directly,
        # but we can validate the frames as they come in
        
        # Session duration limit: 30 minutes
        MAX_SESSION_DURATION = 30 * 60  # seconds
        if hasattr(session, 'created_at'):
            import time
            if time.time() - session.created_at > MAX_SESSION_DURATION:
                logger.warning(f"Session {session.session_id} exceeded max duration")
                return
        
        logger.debug(f"Starting audio processing for session {session.session_id}")
        
        # Create async generator for audio chunks
        MAX_CHUNK_SIZE = 1024 * 1024  # 1MB max per chunk
        MAX_TOTAL_SIZE = 50 * 1024 * 1024  # 50MB total per session
        total_bytes = 0
        
        async def audio_chunks() -> AsyncGenerator[bytes, None]:
            nonlocal total_bytes
            while True:
                try:
                    frame = await track.recv()
                    # Convert to PCM16 bytes (aiortc gives us numpy array)
                    audio_data = frame.to_ndarray()
                    # Ensure mono, 16-bit
                    if audio_data.ndim > 1:
                        audio_data = audio_data.mean(axis=0)
                    chunk_bytes = audio_data.astype('int16').tobytes()
                    # Validate chunk size
                    if len(chunk_bytes) > MAX_CHUNK_SIZE:
                        logger.warning(f"Audio chunk too large: {len(chunk_bytes)} bytes")
                        continue
                    total_bytes += len(chunk_bytes)
                    if total_bytes > MAX_TOTAL_SIZE:
                        logger.warning(f"Session {session.session_id} exceeded max total audio size")
                        break
                    yield chunk_bytes
                except MediaStreamError:
                    break
                except Exception as e:
                    logger.debug(f"Audio track ended: {e}")
                    break
        
        try:
            # Process through voice pipeline
            async for tts_chunk in self.pipeline.process_turn(audio_chunks()):
                await self._send_tts_audio(session, tts_chunk)
        except Exception as e:
            logger.error(f"Voice pipeline error for session {session.session_id}: {e}")
            await self._send_error(session, f"Pipeline error: {e}")
        finally:
            logger.debug(f"Audio processing ended for session {session.session_id}")
    
    async def _send_tts_audio(self, session: VoiceSession, audio_chunk: bytes):
        """Send TTS audio chunk back to browser via data channel."""
        if session.data_channel and session.data_channel.readyState == "open":
            try:
                session.data_channel.send(audio_chunk)
            except Exception as e:
                logger.warning(f"Failed to send audio chunk: {e}")
        else:
            # Queue for when data channel opens (or use alternative)
            logger.debug("Data channel not ready, audio chunk dropped")
    
    async def _send_transcript(self, session: VoiceSession, text: str, is_final: bool):
        """Send transcript update to browser."""
        if session.data_channel and session.data_channel.readyState == "open":
            try:
                session.data_channel.send(json.dumps({
                    "type": "transcript",
                    "text": text,
                    "isFinal": is_final
                }))
            except Exception as e:
                logger.warning(f"Failed to send transcript: {e}")
    
    async def _send_response(self, session: VoiceSession, text: str):
        """Send LLM response text to browser."""
        if session.data_channel and session.data_channel.readyState == "open":
            try:
                session.data_channel.send(json.dumps({
                    "type": "response",
                    "text": text
                }))
            except Exception as e:
                logger.warning(f"Failed to send response: {e}")
    
    async def _send_error(self, session: VoiceSession, error: str):
        """Send error to browser."""
        if session.data_channel and session.data_channel.readyState == "open":
            try:
                session.data_channel.send(json.dumps({
                    "type": "error",
                    "error": error
                }))
            except Exception:
                pass
    
    # ==================== Data Channel Handling ====================
    
    async def _handle_data_channel_message(self, session: VoiceSession, message):
        """Handle incoming data channel messages from browser."""
        session.last_activity = asyncio.get_event_loop().time()
        
        try:
            if isinstance(message, str):
                data = json.loads(message)
                msg_type = data.get("type")
                
                if msg_type == "ping":
                    # Keepalive
                    session.data_channel.send(json.dumps({"type": "pong"}))
                
                elif msg_type == "terminal_id":
                    # Update terminal ID
                    session.terminal_id = data.get("terminalId")
                    logger.info(f"Session {session.session_id} bound to terminal {session.terminal_id}")
                
                elif msg_type == "config":
                    # Update pipeline config
                    pass  # Future: dynamic config updates
                    
        except json.JSONDecodeError:
            pass  # Binary audio data, ignore here
        except Exception as e:
            logger.error(f"Data channel message error: {e}")
    
    # ==================== Session Management ====================
    
    async def _cleanup_session(self, session_id: str):
        """Clean up a session and its resources."""
        session = self.sessions.pop(session_id, None)
        if session:
            try:
                if session.peer_connection:
                    await session.peer_connection.close()
            except Exception as e:
                logger.warning(f"Error closing peer connection: {e}")
        
        pc = self.peer_connections.pop(session_id, None)
        if pc and pc != (session.peer_connection if session else None):
            try:
                await pc.close()
            except Exception:
                pass
        
        logger.info(f"Session cleaned up: {session_id}")
    
    def get_session(self, session_id: str) -> Optional[VoiceSession]:
        """Get session by ID."""
        return self.sessions.get(session_id)
    
    def get_active_sessions(self) -> Dict[str, VoiceSession]:
        """Get all active sessions."""
        return self.sessions.copy()


# ==================== Integration Helpers ====================

def create_voice_routes(handler: VoiceWebRTCHandler) -> list:
    """Create aiohttp routes for voice WebRTC endpoints."""
    return [
        web.post("/voice/offer", handler.handle_offer),
        web.post("/voice/ice", handler.handle_ice_candidate),
        web.post("/voice/message", handler.handle_message),
        web.get("/voice/sessions", list_sessions_handler(handler)),
    ]


async def list_sessions_handler(handler: VoiceWebRTCHandler) -> web.Response:
    """List active voice sessions."""
    sessions = handler.get_active_sessions()
    return web.json_response({
        "sessions": [
            {
                "sessionId": s.session_id,
                "terminalId": s.terminal_id,
                "connected": s.peer_connection.connectionState == "connected",
                "iceState": s.peer_connection.iceConnectionState,
                "createdAt": s.created_at,
                "lastActivity": s.last_activity
            }
            for s in sessions.values()
        ]
    })


# ==================== Factory ====================

async def create_voice_webrtc_handler(config: Optional[VoiceConfig] = None) -> VoiceWebRTCHandler:
    """Create and start voice WebRTC handler."""
    from .pipeline import get_voice_pipeline
    
    pipeline = get_voice_pipeline(config)
    handler = VoiceWebRTCHandler(pipeline)
    await handler.start()
    return handler
