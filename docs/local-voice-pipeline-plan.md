# Local Voice Pipeline for Task Orchestrator/OpenDots - End-to-End Plan

## Executive Summary
Build a **fully local, real-time voice interface** for Task Orchestrator terminals using:
- **STT**: Whisper.cpp (via sidecar) or whisper-web (WASM in browser)
- **LLM**: Your existing Qwen models (via Ollama/vLLM/LM Studio)
- **TTS**: Piper (fast, lightweight, WASM-compatible)
- **Transport**: WebRTC for browser <-> sidecar audio streaming

**Target Latency**: 500-800ms end-to-end (push-to-talk mode)
**Architecture**: Browser captures audio -> sidecar processes STT/LLM/TTS -> returns audio

---

## Architecture Overview

```
+-------------------------------------------------------------------+
| BROWSER (OpenDots Chat/ComputerPanel)                             |
|  +--------------+    WebRTC DataChannel    +--------------------+ |
|  | Audio Capture |<-------------------------->| sidecar.py        | |
|  | (getUserMedia) |    Audio Chunks (opus)   | (Voice Pipeline) | |
|  +--------------+                            | +-----+ +-----+  | |
|       ^                                      | | STT | | LLM |  | |
|       | Audio Playback                       | |Whis | |Qwen |  | |
|       +--------------------------------------| +-----+ +-----+  | |
|                                              | | TTS |        | |
|                                              | |Piper|        | |
|                                              | +-----+        | |
+-------------------------------------------------------------------+
                               ^
                               | WebSocket / HTTP
                               v
                    +----------------------+
                    | Tauri App (Terminal) |
                    | JarvisManager        |
                    +----------------------+
```

---

## Phase 1: Sidecar Voice Pipeline (Week 1-2)

### 1.1 Add Voice Dependencies to Sidecar

**File:** `backend/requirements-voice.txt` (or add to main requirements)
```
# STT
faster-whisper>=1.0.0          # CTranslate2 backend, faster than whisper.cpp
# OR: whisper.cpp via subprocess (smaller, no Python deps)

# TTS
piper-tts>=1.2.0               # Fast, lightweight, multi-speaker
onnxruntime>=1.16.0            # Piper dependency

# Audio processing
pydub>=0.25.1                  # Audio format conversion
numpy>=1.24.0                  # Audio array manipulation
webrtcvad>=2.0.10              # Voice activity detection

# WebRTC (for browser audio streaming)
aiortc>=1.6.0                  # Python WebRTC implementation
aiohttp>=3.9.0                 # HTTP server for signaling
```

### 1.2 Create Voice Pipeline Module

**File:** `backend/voice/pipeline.py`
```python
"""
Local Voice Pipeline: STT -> LLM -> TTS
Runs entirely in sidecar process, no external APIs.
"""

import asyncio
import numpy as np
from dataclasses import dataclass
from typing import AsyncGenerator, Optional
import logging

logger = logging.getLogger(__name__)

@dataclass
class VoiceConfig:
    # STT (faster-whisper)
    stt_model: str = "base.en"
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    stt_language: str = "en"
    stt_vad: bool = True
    
    # LLM (your local Qwen)
    llm_endpoint: str = "http://localhost:11434/v1/chat/completions"
    llm_model: str = "qwen2.5-coder:32b"
    llm_temperature: float = 0.7
    llm_max_tokens: int = 2048
    llm_system_prompt: str = "You are Jarvis, a helpful coding assistant. Be concise."
    
    # TTS (Piper)
    tts_model: str = "en_US-lessac-medium"
    tts_speaker_id: int = 0
    tts_length_scale: float = 1.0
    tts_noise_scale: float = 0.667
    tts_noise_w: float = 0.8
    
    # Audio
    sample_rate: int = 16000
    chunk_duration_ms: int = 100
    silence_threshold: float = 0.01
    min_speech_duration_ms: int = 500
    max_silence_duration_ms: int = 1000


class VoicePipeline:
    def __init__(self, config: VoiceConfig):
        self.config = config
        self._stt_model = None
        self._tts_model = None
        self._vad = None
        self._initialized = False
    
    async def initialize(self):
        if self._initialized:
            return
        
        from faster_whisper import WhisperModel
        self._stt_model = WhisperModel(
            self.config.stt_model,
            device=self.config.stt_device,
            compute_type=self.config.stt_compute_type
        )
        logger.info(f"STT model loaded: {self.config.stt_model}")
        
        import webrtcvad
        self._vad = webrtcvad.Vad(2)
        
        from piper import PiperVoice
        self._tts_model = PiperVoice.load(self.config.tts_model)
        logger.info(f"TTS model loaded: {self.config.tts_model}")
        
        self._initialized = True
    
    async def transcribe(self, audio_chunks: AsyncGenerator[bytes, None]) -> str:
        await self.initialize()
        
        audio_buffer = bytearray()
        speech_detected = False
        silence_duration = 0
        
        async for chunk in audio_chunks:
            audio_buffer.extend(chunk)
            is_speech = self._vad.is_speech(chunk, self.config.sample_rate)
            
            if is_speech:
                speech_detected = True
                silence_duration = 0
            elif speech_detected:
                silence_duration += len(chunk) / (self.config.sample_rate * 2) * 1000
            
            if speech_detected and silence_duration >= self.config.max_silence_duration_ms:
                break
        
        if not speech_detected or len(audio_buffer) < self.config.min_speech_duration_ms * self.config.sample_rate * 2 / 1000:
            return ""
        
        audio_np = np.frombuffer(audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0
        
        segments, _ = self._stt_model.transcribe(
            audio_np,
            language=self.config.stt_language,
            vad_filter=self.config.stt_vad
        )
        
        text = " ".join(seg.text for seg in segments).strip()
        logger.info(f"STT: '{text}'")
        return text
    
    async def generate_response(self, user_text: str, conversation_history: list = None) -> str:
        import aiohttp
        
        messages = [{"role": "system", "content": self.config.llm_system_prompt}]
        if conversation_history:
            messages.extend(conversation_history)
        messages.append({"role": "user", "content": user_text})
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.config.llm_endpoint,
                json={
                    "model": self.config.llm_model,
                    "messages": messages,
                    "temperature": self.config.llm_temperature,
                    "max_tokens": self.config.llm_max_tokens,
                    "stream": False
                }
            ) as resp:
                data = await resp.json()
                response = data["choices"][0]["message"]["content"]
                logger.info(f"LLM: '{response[:100]}...'")
                return response
    
    async def synthesize(self, text: str) -> AsyncGenerator[bytes, None]:
        await self.initialize()
        
        for audio_chunk in self._tts_model.synthesize_stream_raw(
            text,
            speaker_id=self.config.tts_speaker_id,
            length_scale=self.config.tts_length_scale,
            noise_scale=self.config.tts_noise_scale,
            noise_w=self.config.tts_noise_w
        ):
            yield audio_chunk
    
    async def process_turn(self, audio_chunks: AsyncGenerator[bytes, None], 
                          conversation_history: list = None) -> AsyncGenerator[bytes, None]:
        user_text = await self.transcribe(audio_chunks)
        if not user_text:
            return
        
        response_text = await self.generate_response(user_text, conversation_history)
        if not response_text:
            return
        
        async for audio_chunk in self.synthesize(response_text):
            yield audio_chunk
```

### 1.3 Add WebRTC Handler to Sidecar

**File:** `backend/voice/webrtc_handler.py`
```python
"""
WebRTC signaling and media handling for browser <-> sidecar audio streaming.
"""

import asyncio
import json
from typing import Dict
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from aiortc.contrib.media import MediaRelay
from aiohttp import web
import logging

logger = logging.getLogger(__name__)

class VoiceWebRTCHandler:
    def __init__(self, voice_pipeline):
        self.pipeline = voice_pipeline
        self.peer_connections: Dict[str, RTCPeerConnection] = {}
        self.relay = MediaRelay()
        self.active_sessions: Dict[str, dict] = {}
    
    async def offer(self, request: web.Request) -> web.Response:
        params = await request.json()
        session_id = params.get("sessionId", "default")
        
        offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
        
        pc = RTCPeerConnection()
        self.peer_connections[session_id] = pc
        
        @pc.on("track")
        def on_track(track: MediaStreamTrack):
            if track.kind == "audio":
                logger.info(f"Audio track received for session {session_id}")
                asyncio.create_task(self._handle_audio_track(session_id, track))
        
        @pc.on("connectionstatechange")
        async def on_connectionstatechange():
            logger.info(f"Connection state: {pc.connectionState}")
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self._cleanup_session(session_id)
        
        await pc.setRemoteDescription(offer)
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        
        return web.json_response({
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type
        })
    
    async def _handle_audio_track(self, session_id: str, track: MediaStreamTrack):
        async def audio_chunks():
            while True:
                try:
                    frame = await track.recv()
                    yield frame.to_ndarray().tobytes()
                except Exception:
                    break
        
        if session_id not in self.active_sessions:
            self.active_sessions[session_id] = {
                "conversation_history": [],
                "terminal_id": None
            }
        
        session = self.active_sessions[session_id]
        
        try:
            async for tts_chunk in self.pipeline.process_turn(
                audio_chunks(), 
                session["conversation_history"]
            ):
                await self._send_audio_chunk(session_id, tts_chunk)
        except Exception as e:
            logger.error(f"Voice pipeline error: {e}")
    
    async def _send_audio_chunk(self, session_id: str, audio_chunk: bytes):
        pass
    
    async def _cleanup_session(self, session_id: str):
        pc = self.peer_connections.pop(session_id, None)
        if pc:
            await pc.close()
        self.active_sessions.pop(session_id, None)
    
    async def handle_ice_candidate(self, request: web.Request) -> web.Response:
        params = await request.json()
        session_id = params.get("sessionId", "default")
        pc = self.peer_connections.get(session_id)
        if pc:
            await pc.addIceCandidate(params["candidate"])
        return web.json_response({"success": True})
```

---

## Phase 2: Browser Voice Client (Week 2)

### 2.1 Create Voice Hook for React

**File:** `frontend/src/opendots/hooks/useLocalVoice.ts`
```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseLocalVoiceOptions {
  terminalId: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onResponse?: (text: string) => void;
  onError?: (error: Error) => void;
}

type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';

interface UseLocalVoiceReturn {
  status: VoiceStatus;
  start: () => Promise<void>;
  stop: () => void;
  error: string | null;
}

export function useLocalVoice({ terminalId, onTranscript, onResponse, onError }: UseLocalVoiceOptions): UseLocalVoiceReturn {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  
  const SIDECAR_URL = 'http://localhost:8765';
  
  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingRef.current = true;
    const audioContext = audioContextRef.current;
    if (!audioContext) return;
    
    while (audioQueueRef.current.length > 0) {
      const buffer = audioQueueRef.current.shift()!;
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);
      await new Promise(resolve => source.onended = resolve);
    }
    
    isPlayingRef.current = false;
  }, []);
  
  const start = useCallback(async () => {
    if (status !== 'idle') return;
    
    try {
      setStatus('connecting');
      setError(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      mediaStreamRef.current = stream;
      
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;
      
      const audioTrack = stream.getAudioTracks()[0];
      pc.addTrack(audioTrack, stream);
      
      const dc = pc.createDataChannel('voice', { ordered: true });
      dcRef.current = dc;
      
      dc.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 22050 });
          audioContextRef.current = audioContext;
          
          audioContext.decodeAudioData(event.data).then(buffer => {
            audioQueueRef.current.push(buffer);
            playAudioQueue();
          });
        } else if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'transcript') {
              onTranscript?.(msg.text, msg.isFinal);
            } else if (msg.type === 'response') {
              onResponse?.(msg.text);
            } else if (msg.type === 'error') {
              setError(msg.error);
              onError?.(new Error(msg.error));
            }
          } catch {}
        }
      };
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      const response = await fetch(`${SIDECAR_URL}/voice/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: terminalId,
          sdp: offer.sdp,
          type: offer.type
        })
      });
      
      const answer = await response.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      
      setStatus('listening');
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start voice';
      setError(msg);
      setStatus('error');
      onError?.(err instanceof Error ? err : new Error(msg));
    }
  }, [terminalId, status, onTranscript, onResponse, onError, playAudioQueue]);
  
  const stop = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    dcRef.current = null;
    setStatus('idle');
  }, []);
  
  useEffect(() => () => stop(), [stop]);
  
  return { status, start, stop, error };
}
```

### 2.2 Integrate with OpenDots Chat Component

**File:** `frontend/src/opendots/components/VoiceButton.tsx`
```tsx
import { useLocalVoice } from '../hooks/useLocalVoice';
import { Mic, MicOff, Loader2, Volume2 } from 'lucide-react';

interface VoiceButtonProps {
  terminalId: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onResponse?: (text: string) => void;
}

export function VoiceButton({ terminalId, onTranscript, onResponse }: VoiceButtonProps) {
  const { status, start, stop, error } = useLocalVoice({
    terminalId,
    onTranscript,
    onResponse
  });
  
  const isActive = status === 'listening' || status === 'processing' || status === 'speaking';
  
  return (
    <button
      type="button"
      onClick={isActive ? stop : start}
      disabled={status === 'connecting'}
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: status === 'connecting' ? 'wait' : 'pointer',
        background: isActive ? '#ef4444' : status === 'error' ? '#f59e0b' : 'var(--accent-primary)',
        color: 'white',
        boxShadow: isActive ? '0 0 20px #ef4444' : 'none',
        transition: 'all 0.2s ease'
      }}
      title={status}
    >
      {status === 'connecting' && <Loader2 size={20} className="animate-spin" />}
      {status === 'listening' && <Mic size={20} />}
      {status === 'processing' && <Loader2 size={20} className="animate-spin" />}
      {status === 'speaking' && <Volume2 size={20} />}
      {status === 'idle' && <MicOff size={20} />}
      {status === 'error' && <MicOff size={20} />}
    </button>
  );
}
```

---

## Phase 3: Terminal Integration (Week 2-3)

### 3.1 Connect Voice to Terminal/Jarvis

**File:** `frontend/src/opendots/adapters/voice-to-terminal.ts`
```typescript
/**
 * Bridge voice pipeline to Task Orchestrator terminal system.
 * Routes voice commands to Jarvis agent or direct terminal execution.
 */

import { jarvisManager } from '@/jarvis/agent/JarvisManager';
import { TerminalManager } from '@/terminal/TerminalManager';
import { sessionContextStore } from '@/jarvis/contextStore';

export interface VoiceTerminalBridge {
  terminalId: string;
  mode: 'jarvis' | 'direct';
}

export async function executeVoiceCommand(bridge: VoiceTerminalBridge, command: string): Promise<void> {
  const { terminalId, mode } = bridge;
  
  if (mode === 'jarvis') {
    const agent = jarvisManager.getAgent(terminalId);
    if (agent.status === 'UNASSIGNED') {
      await jarvisManager.assignAgent(terminalId, ['OBSERVE', 'READ', 'EXECUTE', 'CONTROL', 'WRITE']);
    }
    await jarvisManager.assignTask(terminalId, command);
  } else {
    await TerminalManager.write(terminalId, `${command}
`);
    
    const ctx = sessionContextStore.get(terminalId);
    if (ctx) {
      ctx.currentActivity = `Voice: ${command}`;
      ctx.recentActivity.unshift(`Voice executed: ${command}`);
      if (ctx.recentActivity.length > 10) ctx.recentActivity.pop();
    }
  }
}

export async function processVoiceWithContext(
  terminalId: string,
  transcript: string,
  mode: 'jarvis' | 'direct' = 'jarvis'
): Promise<string> {
  const ctx = sessionContextStore.get(terminalId);
  
  const contextInfo = ctx ? `
Current terminal: ${ctx.terminalName || terminalId}
Workspace: ${ctx.workspaceName || 'unknown'}
Project: ${ctx.cwd?.split('/').pop() || 'unknown'}
CLI: ${ctx.detectedCli || 'shell'}
Recent: ${ctx.recentActivity.slice(0, 3).join('; ')}
` : '';
  
  const enhancedPrompt = `${contextInfo}

User said: "${transcript}"

Execute this as a terminal command or task. Return only the command to run, or a brief response if it's a question.`;
  
  return enhancedPrompt;
}
```

### 3.2 Add Voice Controls to ComputerPanel/Chat

Modify `OpenDotsDashboard.tsx` to include voice button:

```tsx
import { VoiceButton } from '../components/VoiceButton';

// In the header toolbar:
<VoiceButton 
  terminalId={selectedTerminalId} 
  onTranscript={(text, final) => {
    if (final) {
      setMessages(prev => [...prev, { role: 'user', content: `🎤 ${text}` }]);
    }
  }}
  onResponse={(text) => {
    setMessages(prev => [...prev, { role: 'assistant', content: text }]);
  }}
/>
```

---

## Phase 4: Model Optimization (Week 3-4)

### 4.1 STT Model Selection

| Model | Size | Speed (RTF) | Quality | Use Case |
|-------|------|-------------|---------|----------|
| tiny.en | 39 MB | ~0.1x | Low | Fastest, keyword spotting |
| base.en | 74 MB | ~0.3x | Good | **Recommended default** |
| small.en | 244 MB | ~0.5x | Better | Balanced |
| medium.en | 769 MB | ~1.0x | High | Best quality |
| large-v3 | 1550 MB | ~2.0x | Best | Maximum accuracy |

**Recommendation**: Start with `base.en` (int8 quantized) on CPU -- ~300ms for 3s audio.

### 4.2 TTS Voice Selection (Piper)

```bash
# Download voices (place in backend/voice/models/)
# https://github.com/rhasspy/piper/releases/tag/v1.2.0

# English voices (pick one):
en_US-lessac-medium.onnx       # Male, clear, 48MB
en_US-amy-medium.onnx          # Female, natural, 52MB
en_US-ryan-high.onnx           # Male, high quality, 120MB
en_GB-northern_english_male-medium.onnx  # British

# For coding: lessac-medium is clear and fast
```

### 4.3 LLM Optimization for Voice

```python
VOICE_SYSTEM_PROMPT = """You are Jarvis, a voice-activated coding assistant.
CRITICAL: Respond in 1-2 sentences MAX. No markdown, no code blocks.
If user asks to run something, output ONLY the command to execute.
If user asks a question, answer briefly.
Examples:
User: "run tests" -> pytest -xvs
User: "what's the error" -> Last test failed with AssertionError on line 42
User: "fix it" -> I need more context to fix it. Can you share the error?
"""
```

---

## Phase 5: Integration & Polish (Week 4)

### 5.1 Sidecar Integration Points

**Add to `sidecar.py` main.py:**
```python
from voice.pipeline import VoicePipeline, VoiceConfig
from voice.webrtc_handler import VoiceWebRTCHandler
from aiohttp import web

voice_config = VoiceConfig(
    stt_model="base.en",
    llm_endpoint=os.getenv("OLLAMA_URL", "http://localhost:11434") + "/v1/chat/completions",
    llm_model=os.getenv("VOICE_LLM_MODEL", "qwen2.5-coder:32b"),
    tts_model="en_US-lessac-medium"
)

voice_pipeline = VoicePipeline(voice_config)
voice_handler = VoiceWebRTCHandler(voice_pipeline)

app.router.add_post("/voice/offer", voice_handler.offer)
app.router.add_post("/voice/ice", voice_handler.handle_ice_candidate)
```

### 5.2 Configuration

**File:** `backend/voice/config.yaml`
```yaml
voice:
  enabled: true
  host: "0.0.0.0"
  port: 8765
  
  stt:
    model: "base.en"
    device: "cpu"
    compute_type: "int8"
    language: "en"
    
  llm:
    endpoint: "http://localhost:11434/v1/chat/completions"
    model: "qwen2.5-coder:32b"
    temperature: 0.7
    
  tts:
    model: "en_US-lessac-medium"
    speaker_id: 0
    
  audio:
    sample_rate: 16000
    vad_threshold: 0.5
```

---

## Phase 6: Testing & Benchmarks (Week 4)

### 6.1 Latency Targets

| Stage | Target | Measurement |
|-------|--------|-------------|
| Audio capture | <10ms | Browser MediaRecorder |
| STT (3s audio) | <500ms | faster-whisper base.en |
| LLM (short) | <1000ms | Qwen 32B on GPU |
| TTS (short) | <200ms | Piper lessac-medium |
| **Total** | **<1700ms** | End-to-end |

### 6.2 Benchmarking Script

```python
import asyncio
import time
from voice.pipeline import VoicePipeline, VoiceConfig

async def benchmark():
    config = VoiceConfig()
    pipeline = VoicePipeline(config)
    
    await pipeline.initialize()
    
    start = time.time()
    stt_time = time.time() - start
    
    start = time.time()
    llm_time = time.time() - start
    
    start = time.time()
    tts_time = time.time() - start
    
    print(f"STT: {stt_time*1000:.0f}ms")
    print(f"LLM: {llm_time*1000:.0f}ms")
    print(f"TTS: {tts_time*1000:.0f}ms")
    print(f"Total: {(stt_time+llm_time+tts_time)*1000:.0f}ms")

asyncio.run(benchmark())
```

---

## File Structure Summary

```
backend/
├── voice/
│   ├── __init__.py
│   ├── pipeline.py
│   ├── webrtc_handler.py
│   ├── config.yaml
│   ├── benchmark.py
│   └── models/
│       ├── base.en/
│       └── en_US-lessac-medium.onnx

frontend/src/opendots/
├── hooks/
│   └── useLocalVoice.ts
├── components/
│   └── VoiceButton.tsx
├── adapters/
│   └── voice-to-terminal.ts
```

---

## Deployment Notes

### Model Downloads (Run Once)
```bash
# faster-whisper models auto-download on first use
python -c "from faster_whisper import WhisperModel; WhisperModel('base.en', device='cpu', compute_type='int8')"

# Piper voices
mkdir -p backend/voice/models
cd backend/voice/models
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

### Hardware Requirements
| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| GPU | Optional | NVIDIA (CUDA) for LLM |
| Disk | 5 GB | 10 GB |

### GPU Acceleration (Optional)
```python
VoiceConfig(stt_device="cuda", stt_compute_type="float16")
# LLM: ollama run qwen2.5-coder:32b --gpu
```

---

## Success Criteria

- Push-to-talk button in OpenDots Chat/ComputerPanel
- Speech -> text appears in chat transcript
- Jarvis agent executes voice commands in terminal
- TTS response plays through speakers
- <2s end-to-end latency for typical commands
- Works fully offline (no external API calls)
- Clean integration with existing Task Orchestrator terminal/Jarvis system

---

## Timeline

| Week | Deliverable |
|------|-------------|
| 1 | Sidecar pipeline (STT+LLM+TTS) working in isolation |
| 2 | WebRTC browser <-> sidecar audio streaming |
| 2 | React voice hook + VoiceButton component |
| 3 | Terminal/Jarvis integration |
| 3 | Context-aware voice commands |
| 4 | Optimization, benchmarking, polish |
| 4 | Integration testing with OpenDots Dashboard |

---

## Next Steps

1. Add voice dependencies to backend requirements
2. Create `backend/voice/pipeline.py` with STT/LLM/TTS classes
3. Add WebRTC handler to sidecar
4. Create `useLocalVoice` hook in frontend
5. Add VoiceButton to OpenDotsDashboard
6. Test end-to-end with your local Qwen model

**Ready to start Phase 1 (Sidecar Pipeline)?**
