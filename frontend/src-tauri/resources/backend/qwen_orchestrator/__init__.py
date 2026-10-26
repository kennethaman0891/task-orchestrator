"""Qwen Prime Orchestrator package for TTO.
Reverse-engineers Prime-Agent intelligence, profiles host hardware,
benchmarks local Ollama Qwen models, and orchestrates tasks across terminals.
"""

from .hardware import get_hardware_profile, HostHardwareProfile
from .ollama_engine import OllamaEngine, QwenModelBenchmark
from .prime_intelligence import PrimeIntelligenceEngine
from .router import QwenTaskRouter

__all__ = [
    "get_hardware_profile",
    "HostHardwareProfile",
    "OllamaEngine",
    "QwenModelBenchmark",
    "PrimeIntelligenceEngine",
    "QwenTaskRouter",
]
