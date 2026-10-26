"""Host Hardware Profiler for Qwen Model Orchestrator.
Detects Apple Silicon SoC, Unified Memory (UMA), CPU cores, and compute limits.
"""

import os
import platform
import shutil
import subprocess
from typing import Optional
from pydantic import BaseModel, Field

try:
    import psutil  # type: ignore
except ImportError:
    psutil = None


class HostHardwareProfile(BaseModel):
    os_name: str = Field(..., description="Operating System Name (Darwin, Linux, Windows)")
    architecture: str = Field(..., description="CPU Architecture (arm64, x86_64)")
    chip_brand: str = Field(..., description="Processor / Chip Brand (e.g. Apple M5 Pro)")
    cpu_cores: int = Field(..., description="Total Logical CPU Cores")
    total_ram_gb: float = Field(..., description="Total Unified Memory / RAM in GB")
    available_ram_gb: float = Field(..., description="Available / Free RAM in GB")
    has_metal: bool = Field(default=False, description="Whether Apple Metal GPU acceleration is supported")
    metal_version: str = Field(default="", description="Metal version (e.g. Metal 4)")
    disk_free_gb: float = Field(default=0.0, description="Free disk storage in GB")
    safe_max_model_bytes: int = Field(default=0, description="Safe maximum model size in bytes")
    recommended_model_tier: str = Field(default="7b", description="Recommended model tier based on RAM")
    hardware_summary: str = Field(default="", description="Human-readable hardware summary")


def get_hardware_profile() -> HostHardwareProfile:
    """Analyze the host machine and return a comprehensive hardware profile."""
    system = platform.system()
    machine = platform.machine()
    
    # 1. CPU Brand
    cpu_brand = platform.processor() or machine
    if system == "Darwin":
        try:
            out = subprocess.check_output(
                ["sysctl", "-n", "machdep.cpu.brand_string"],
                timeout=1, stderr=subprocess.DEVNULL
            ).decode().strip()
            if out:
                cpu_brand = out
        except Exception:
            pass

    # 2. CPU Cores
    cores = os.cpu_count() or 1
    if system == "Darwin":
        try:
            out = subprocess.check_output(
                ["sysctl", "-n", "hw.ncpu"],
                timeout=1, stderr=subprocess.DEVNULL
            ).decode().strip()
            if out and out.isdigit():
                cores = int(out)
        except Exception:
            pass

    # 3. RAM in GB
    total_ram_bytes = 0
    if system == "Darwin":
        try:
            out = subprocess.check_output(
                ["sysctl", "-n", "hw.memsize"],
                timeout=1, stderr=subprocess.DEVNULL
            ).decode().strip()
            if out and out.isdigit():
                total_ram_bytes = int(out)
        except Exception:
            pass

    if total_ram_bytes == 0 and psutil is not None:
        try:
            total_ram_bytes = psutil.virtual_memory().total
        except Exception:
            pass

    if total_ram_bytes == 0:
        total_ram_bytes = 16 * (1024**3)  # Safe fallback 16 GB

    total_ram_gb = round(total_ram_bytes / (1024**3), 1)

    # 4. Available RAM
    avail_ram_bytes = total_ram_bytes // 2
    if psutil is not None:
        try:
            avail_ram_bytes = psutil.virtual_memory().available
        except Exception:
            pass
    elif system == "Darwin":
        # Estimate via vm_stat if psutil not present
        try:
            vm = subprocess.check_output(["vm_stat"], timeout=1, stderr=subprocess.DEVNULL).decode()
            free_pages = 0
            for line in vm.splitlines():
                if "Pages free:" in line or "Pages speculative:" in line or "Pages inactive:" in line:
                    parts = line.split(":")
                    if len(parts) > 1:
                        free_pages += int(parts[1].strip().rstrip("."))
            avail_ram_bytes = free_pages * 4096
        except Exception:
            pass

    available_ram_gb = round(avail_ram_bytes / (1024**3), 1)

    # 5. Metal GPU
    has_metal = False
    metal_version = ""
    if system == "Darwin" and machine in ("arm64", "aarch64"):
        has_metal = True
        metal_version = "Metal 4 (Unified Memory)"

    # 6. Disk space
    disk_free_gb = 0.0
    try:
        usage = shutil.disk_usage("/")
        disk_free_gb = round(usage.free / (1024**3), 1)
    except Exception:
        pass

    # 7. Safe max model size and recommended tier
    # Maintain at least 5-6 GB for macOS, window manager, and IDE
    headroom_bytes = 6 * (1024**3)
    safe_max_model_bytes = max(2 * (1024**3), total_ram_bytes - headroom_bytes)

    if total_ram_gb >= 24:
        recommended_tier = "30b" if available_ram_gb >= 18 else "9b"
    elif total_ram_gb >= 16:
        recommended_tier = "9b"
    else:
        recommended_tier = "7b"

    summary = f"{cpu_brand} • {cores} Cores • {total_ram_gb} GB UMA"
    if has_metal:
        summary += " • Metal GPU"

    return HostHardwareProfile(
        os_name=system,
        architecture=machine,
        chip_brand=cpu_brand,
        cpu_cores=cores,
        total_ram_gb=total_ram_gb,
        available_ram_gb=available_ram_gb,
        has_metal=has_metal,
        metal_version=metal_version,
        disk_free_gb=disk_free_gb,
        safe_max_model_bytes=safe_max_model_bytes,
        recommended_model_tier=recommended_tier,
        hardware_summary=summary,
    )
