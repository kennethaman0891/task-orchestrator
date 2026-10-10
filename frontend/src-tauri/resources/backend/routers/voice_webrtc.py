#!/usr/bin/env python3
"""WebRTC Voice Pipeline router for TTO sidecar.

Handles WebRTC signaling and media for browser <-> sidecar audio streaming.
"""
import os
import sys
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

# Ensure backend directory is on sys.path for voice module imports
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

router = APIRouter(prefix="/api/voice", tags=["voice-webrtc"])

# Global handler instance (initialized by main.py)
_voice_handler = None


def set_voice_handler(handler):
    """Set the global voice WebRTC handler instance."""
    global _voice_handler
    _voice_handler = handler


@router.post("/offer")
async def voice_offer(request: Request):
    """
    Handle WebRTC offer from browser.
    
    Expected JSON:
    {
        "sessionId": "terminal-123",
        "sdp": "...",
        "type": "offer",
        "terminalId": "optional-terminal-id"
    }
    
    Returns:
    {
        "sdp": "...",
        "type": "answer",
        "sessionId": "terminal-123"
    }
    """
    if _voice_handler is None:
        raise HTTPException(503, "Voice WebRTC handler not initialized")
    
    return await _voice_handler.handle_offer(request)


@router.post("/ice")
async def voice_ice(request: Request):
    """
    Handle ICE candidate from browser.
    
    Expected JSON:
    {
        "sessionId": "terminal-123",
        "candidate": {
            "candidate": "...",
            "sdpMid": "0",
            "sdpMLineIndex": 0
        }
    }
    """
    if _voice_handler is None:
        raise HTTPException(503, "Voice WebRTC handler not initialized")
    
    return await _voice_handler.handle_ice_candidate(request)


@router.post("/message")
async def voice_message(request: Request):
    """
    Handle signaling messages (data channel fallback).
    """
    if _voice_handler is None:
        raise HTTPException(503, "Voice WebRTC handler not initialized")
    
    return await _voice_handler.handle_message(request)


@router.get("/sessions")
async def voice_sessions(request: Request):
    """List active voice sessions."""
    if _voice_handler is None:
        raise HTTPException(503, "Voice WebRTC handler not initialized")
    
    sessions = _voice_handler.get_active_sessions()
    return JSONResponse({
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


@router.get("/health")
async def voice_health():
    """Voice pipeline health check."""
    return JSONResponse({
        "status": "ok",
        "handler_initialized": _voice_handler is not None
    })
