"""
Voice Pipeline Package for TTO Sidecar
"""

from .pipeline import VoicePipeline, VoiceConfig, get_voice_pipeline, shutdown_voice_pipeline
from .webrtc_handler import VoiceWebRTCHandler, VoiceSession, create_voice_webrtc_handler, create_voice_routes

__all__ = [
    "VoicePipeline",
    "VoiceConfig", 
    "get_voice_pipeline",
    "shutdown_voice_pipeline",
    "VoiceWebRTCHandler",
    "VoiceSession",
    "create_voice_webrtc_handler",
    "create_voice_routes",
]

__version__ = "0.1.0"
