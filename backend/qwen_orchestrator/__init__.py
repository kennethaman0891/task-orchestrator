"""Qwen Prime Orchestrator package for TTO.
Reverse-engineers Prime-Agent intelligence, profiles host hardware,
benchmarks local Ollama Qwen models, and orchestrates tasks across terminals.
"""

from .hardware import get_hardware_profile, HostHardwareProfile
from .ollama_engine import OllamaEngine, QwenModelBenchmark, ollama_profile_section
from .prime_intelligence import PrimeIntelligenceEngine
from .router import QwenTaskRouter
from .local_runtimes import discover_local_runtimes, read_prefs, write_prefs
from .memory import QwenMemory

__all__ = [
    "get_hardware_profile",
    "HostHardwareProfile",
    "OllamaEngine",
    "QwenModelBenchmark",
    "ollama_profile_section",
    "PrimeIntelligenceEngine",
    "QwenTaskRouter",
    "discover_local_runtimes",
    "read_prefs",
    "write_prefs",
    "QwenMemory",
]
