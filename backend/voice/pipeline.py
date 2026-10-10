"""
Local Voice Pipeline: STT -> LLM -> TTS
Runs entirely in sidecar process, no external APIs.
"""

import asyncio
import numpy as np
from dataclasses import dataclass, field
from typing import AsyncGenerator, Optional, List, Dict, Any
import logging
import os

logger = logging.getLogger(__name__)


@dataclass
class VoiceConfig:
    # STT (faster-whisper)
    stt_model: str = "base.en"           # tiny.en, base.en, small.en, medium.en, large-v3
    stt_device: str = "cpu"              # cpu, cuda, auto
    stt_compute_type: str = "int8"       # int8, float16, float32
    stt_language: str = "en"
    stt_vad: bool = True                 # Voice activity detection
    stt_beam_size: int = 1               # Beam size for decoding
    stt_best_of: int = 1                 # Number of candidates
    
    # LLM (your local Qwen)
    llm_endpoint: str = "http://localhost:11434/v1/chat/completions"
    llm_model: str = "qwen2.5-coder:32b"
    llm_temperature: float = 0.7
    llm_max_tokens: int = 2048
    llm_system_prompt: str = (
        "You are Jarvis, a voice-activated coding assistant. "
        "CRITICAL: Respond in 1-2 sentences MAX. No markdown, no code blocks. "
        "If user asks to run something, output ONLY the command to execute. "
        "If user asks a question, answer briefly."
    )
    llm_timeout_seconds: float = 30.0
    
    # TTS (Piper)
    tts_model: str = "en_US-lessac-medium"  # or your preferred voice
    tts_speaker_id: int = 0
    tts_length_scale: float = 1.0
    tts_noise_scale: float = 0.667
    tts_noise_w: float = 0.8
    tts_sample_rate: int = 22050
    
    # Audio
    sample_rate: int = 16000
    chunk_duration_ms: int = 100         # Process in 100ms chunks
    silence_threshold: float = 0.01      # VAD threshold
    min_speech_duration_ms: int = 500    # Minimum utterance length
    max_silence_duration_ms: int = 1000  # Stop after this much silence
    
    # Pipeline
    enable_streaming_llm: bool = False   # Stream LLM tokens (future)
    conversation_max_turns: int = 10     # Max history turns to keep
    
    @classmethod
    def from_env(cls) -> "VoiceConfig":
        """Create config from environment variables."""
        return cls(
            stt_model=os.getenv("VOICE_STT_MODEL", "base.en"),
            stt_device=os.getenv("VOICE_STT_DEVICE", "cpu"),
            stt_compute_type=os.getenv("VOICE_STT_COMPUTE_TYPE", "int8"),
            llm_endpoint=os.getenv("OLLAMA_URL", "http://localhost:11434") + "/v1/chat/completions",
            llm_model=os.getenv("VOICE_LLM_MODEL", "llama3.2:1b"),
            tts_model=os.getenv("VOICE_TTS_MODEL", "en_US-lessac-medium"),
            sample_rate=int(os.getenv("VOICE_SAMPLE_RATE", "16000")),
        )


class VoicePipeline:
    """
    Full voice pipeline: Audio -> STT -> LLM -> TTS -> Audio
    
    Usage:
        pipeline = VoicePipeline(config)
        async for audio_chunk in pipeline.process_turn(audio_chunks):
            # Send audio_chunk to browser via WebRTC
            await send_to_browser(audio_chunk)
    """
    
    def __init__(self, config: Optional[VoiceConfig] = None):
        self.config = config or VoiceConfig.from_env()
        self._stt_model = None
        self._tts_model = None
        self._vad = None
        self._initialized = False
        self._conversation_history: List[Dict[str, str]] = []
        self._lock = asyncio.Lock()
    
    async def initialize(self) -> None:
        """Lazy-load models on first use. Thread-safe."""
        async with self._lock:
            if self._initialized:
                return
            
            logger.info("Initializing voice pipeline...")
            
            # Initialize STT (faster-whisper)
            try:
                from faster_whisper import WhisperModel
                self._stt_model = WhisperModel(
                    self.config.stt_model,
                    device=self.config.stt_device,
                    compute_type=self.config.stt_compute_type
                )
                logger.info(f"STT model loaded: {self.config.stt_model}")
            except Exception as e:
                logger.error(f"Failed to load STT model: {e}")
                raise
            
            # Initialize VAD
            try:
                import webrtcvad
                self._vad = webrtcvad.Vad(2)  # Aggressiveness 0-3
                logger.info("VAD initialized")
            except Exception as e:
                logger.warning(f"VAD not available: {e}")
                self._vad = None
            
            # Initialize TTS (Piper)
            try:
                from piper import PiperVoice
                model_path = self._resolve_tts_model_path(self.config.tts_model)
                self._tts_model = PiperVoice.load(model_path)
                logger.info(f"TTS model loaded: {self.config.tts_model}")
            except Exception as e:
                logger.error(f"Failed to load TTS model: {e}")
                raise
            
            self._initialized = True
            logger.info("Voice pipeline initialized successfully")
    
    def _resolve_tts_model_path(self, model_name: str) -> str:
        """Resolve TTS model path - check local models dir first."""
        # Check backend/voice/models/
        local_path = os.path.join(os.path.dirname(__file__), "models", f"{model_name}.onnx")
        if os.path.exists(local_path):
            return local_path
        
        # Check if it's a full path
        if os.path.exists(model_name):
            return model_name
        
        # Try piper's default download location
        from piper import PiperVoice
        return model_name  # PiperVoice.load handles downloading
    
    def _add_to_history(self, role: str, content: str) -> None:
        """Add message to conversation history with size limit."""
        self._conversation_history.append({"role": role, "content": content})
        # Keep only last N turns (each turn = user + assistant)
        max_msgs = self.config.conversation_max_turns * 2
        if len(self._conversation_history) > max_msgs:
            self._conversation_history = self._conversation_history[-max_msgs:]
    
    def clear_history(self) -> None:
        """Clear conversation history."""
        self._conversation_history.clear()
    
    async def transcribe(self, audio_chunks: AsyncGenerator[bytes, None]) -> str:
        """
        Stream audio chunks -> transcribe when speech ends.
        Returns transcribed text.
        """
        await self.initialize()
        
        # Buffer audio chunks
        audio_buffer = bytearray()
        speech_detected = False
        silence_duration = 0
        chunk_samples = int(self.config.sample_rate * self.config.chunk_duration_ms / 1000)
        bytes_per_chunk = chunk_samples * 2  # 16-bit = 2 bytes
        
        async for chunk in audio_chunks:
            audio_buffer.extend(chunk)
            
            # VAD on each chunk (if available)
            if self._vad and len(chunk) >= bytes_per_chunk:
                # Process in VAD-sized chunks
                for i in range(0, len(chunk), bytes_per_chunk):
                    vad_chunk = chunk[i:i + bytes_per_chunk]
                    if len(vad_chunk) == bytes_per_chunk:
                        is_speech = self._vad.is_speech(vad_chunk, self.config.sample_rate)
                        if is_speech:
                            speech_detected = True
                            silence_duration = 0
                        elif speech_detected:
                            silence_duration += self.config.chunk_duration_ms
            
            # Stop after sufficient silence following speech
            if speech_detected and silence_duration >= self.config.max_silence_duration_ms:
                logger.debug(f"Silence detected after {silence_duration}ms, stopping capture")
                break
        
        # Check minimum speech duration
        min_bytes = self.config.min_speech_duration_ms * self.config.sample_rate * 2 / 1000
        if not speech_detected or len(audio_buffer) < min_bytes:
            logger.debug("Insufficient speech detected")
            return ""
        
        # Convert to numpy array for faster-whisper
        audio_np = np.frombuffer(audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0
        
        # Transcribe
        try:
            segments, info = self._stt_model.transcribe(
                audio_np,
                language=self.config.stt_language,
                vad_filter=self.config.stt_vad,
                beam_size=self.config.stt_beam_size,
                best_of=self.config.stt_best_of
            )
            
            text = " ".join(seg.text for seg in segments).strip()
            logger.info(f"STT ({info.language}, {info.language_probability:.2f}): '{text}'")
            return text
        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            return ""
    
    async def generate_response(self, user_text: str) -> str:
        """Call local LLM (Ollama/vLLM) for response."""
        import aiohttp
        
        # Build messages with history
        messages = [{"role": "system", "content": self.config.llm_system_prompt}]
        messages.extend(self._conversation_history)
        messages.append({"role": "user", "content": user_text})
        
        try:
            timeout = aiohttp.ClientTimeout(total=self.config.llm_timeout_seconds)
            async with aiohttp.ClientSession(timeout=timeout) as session:
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
                    if resp.status != 200:
                        error_text = await resp.text()
                        logger.error(f"LLM API error {resp.status}: {error_text}")
                        return f"Error: LLM returned {resp.status}"
                    
                    data = await resp.json()
                    response = data["choices"][0]["message"]["content"]
                    logger.info(f"LLM: '{response[:100]}...'")
                    return response
        except asyncio.TimeoutError:
            logger.error("LLM request timed out")
            return "Error: Request timed out"
        except Exception as e:
            logger.error(f"LLM request failed: {e}")
            return f"Error: {str(e)}"
    
    async def synthesize(self, text: str) -> AsyncGenerator[bytes, None]:
        try:
            # Piper generates in chunks
            syn_config = None
            if self._tts_model is not None:
                from piper.config import SynthesisConfig
                syn_config = SynthesisConfig(
                    speaker_id=self.config.tts_speaker_id,
                    length_scale=self.config.tts_length_scale,
                    noise_scale=self.config.tts_noise_scale,
                    noise_w_scale=self.config.tts_noise_w
                )
            
            for audio_chunk in self._tts_model.synthesize(
                text,
                syn_config=syn_config
            ):
                # Piper returns AudioChunk objects
                yield audio_chunk.audio_int16_bytes
        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
    
    async def process_turn(self, audio_chunks: AsyncGenerator[bytes, None]) -> AsyncGenerator[bytes, None]:
        """
        Full pipeline: audio -> STT -> LLM -> TTS -> audio
        Yields TTS audio chunks (int16 PCM).
        """
        # 1. STT
        user_text = await self.transcribe(audio_chunks)
        if not user_text:
            return
        
        # Add to history
        self._add_to_history("user", user_text)
        
        # 2. LLM
        response_text = await self.generate_response(user_text)
        if not response_text:
            return
        
        # Add to history
        self._add_to_history("assistant", response_text)
        
        # 3. TTS - stream audio back
        async for audio_chunk in self.synthesize(response_text):
            yield audio_chunk
    
    async def process_text_turn(self, text: str) -> AsyncGenerator[bytes, None]:
        """
        Process text input directly (bypass STT) - useful for testing.
        Yields TTS audio chunks.
        """
        if not text or not text.strip():
            return
        
        user_text = text.strip()
        self._add_to_history("user", user_text)
        
        response_text = await self.generate_response(user_text)
        if not response_text:
            return
        
        self._add_to_history("assistant", response_text)
        
        async for audio_chunk in self.synthesize(response_text):
            yield audio_chunk
    
    def get_conversation_history(self) -> List[Dict[str, str]]:
        """Get current conversation history."""
        return self._conversation_history.copy()
    
    async def shutdown(self) -> None:
        """Clean up resources."""
        self._stt_model = None
        self._tts_model = None
        self._vad = None
        self._initialized = False
        self._conversation_history.clear()
        logger.info("Voice pipeline shut down")


# Global pipeline instance (for sidecar integration)
_pipeline_instance: Optional[VoicePipeline] = None


def get_voice_pipeline(config: Optional[VoiceConfig] = None) -> VoicePipeline:
    """Get or create global voice pipeline instance."""
    global _pipeline_instance
    if _pipeline_instance is None:
        _pipeline_instance = VoicePipeline(config)
    return _pipeline_instance


async def shutdown_voice_pipeline() -> None:
    """Shutdown global voice pipeline."""
    global _pipeline_instance
    if _pipeline_instance is not None:
        await _pipeline_instance.shutdown()
        _pipeline_instance = None
