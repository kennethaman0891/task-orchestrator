"""Sleep prevention for remote control (Workstream A).

Prevents the OS from sleeping while TTO remote control is active, so tasks
dispatched from remote transports keep running.  Multi-platform:

- macOS:   `caffeinate -dims` subprocess (no deps, reliable)
- Linux:   `systemd-inhibit` subprocess (blocks idle + suspend)
- Windows: ctypes SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)

The module keeps a single child process for the prevention assert.  Turning
prevention OFF terminates the child (or clears the Windows flag), letting the
system sleep normally again.
"""

from __future__ import annotations

import asyncio
import atexit
import platform
import subprocess
import threading
import time
from typing import Optional

# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------

_asserted = False            # sleep prevention currently ON
_child: Optional[subprocess.Popen] = None
_lock = threading.Lock()
_ever_auto_used = False      # True once task-activity auto-assert ever ran
_last_activity = 0.0         # ts of last task activity (for auto-release)
_manual_prevent = False      # user explicitly said /sleep prevent

AUTO_RELEASE_AFTER_SECONDS = 300  # 5 min after last task activity

_SYSTEM = platform.system()

# --------------------------------------------------------------------------
# Platform helpers
# --------------------------------------------------------------------------


def _macos_assert() -> subprocess.Popen:
    # caffeinate -dims : prevent display sleep (-d), idle system sleep (-i),
    # disk idle (-m), and force a default currently-awake assertion (-s).
    return subprocess.Popen(
        ["caffeinate", "-dims"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _linux_assert() -> subprocess.Popen:
    # systemd-inhibit blocks idle + suspend for as long as the child runs.
    return subprocess.Popen(
        ["systemd-inhibit", "--what=idle:sleep", "--who=tto", "--why=remote task",
         "sleep", "infinity"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _windows_assert() -> None:
    # SetThreadExecutionState keeps the system + display required.
    import ctypes
    ES_CONTINUOUS = 0x80000000
    ES_SYSTEM_REQUIRED = 0x00000001
    ctypes.windll.kernel32.SetThreadExecutionState(
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    )


def _windows_release() -> None:
    import ctypes
    ES_CONTINUOUS = 0x80000000
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)


def _do_assert_locked() -> None:
    global _child
    if _SYSTEM == "Darwin":
        _child = _macos_assert()
    elif _SYSTEM == "Linux":
        _child = _linux_assert()
    elif _SYSTEM == "Windows":
        _windows_assert()


def _do_release_locked() -> None:
    global _child
    if _child is not None:
        try:
            _child.terminate()
            _child.wait(timeout=2)
        except Exception:
            try:
                _child.kill()
            except Exception:
                pass
        _child = None
    elif _SYSTEM == "Windows":
        _windows_release()


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------


def prevent_sleep() -> bool:
    """Turn sleep prevention ON. Idempotent — safe to call repeatedly."""
    global _asserted
    with _lock:
        if _asserted:
            _last_activity = time.time()
            return True
        try:
            _do_assert_locked()
            _asserted = True
            _last_activity = time.time()
            print("[sleep] sleep prevention ON", flush=True)
        except Exception as exc:
            print(f"[sleep] prevent_sleep failed: {exc}", flush=True)
            _asserted = False
        return _asserted


def allow_sleep() -> bool:
    """Turn sleep prevention OFF. Idempotent."""
    global _asserted
    with _lock:
        if not _asserted:
            return True
        try:
            _do_release_locked()
            _asserted = False
            print("[sleep] sleep prevention OFF", flush=True)
            return True
        except Exception as exc:
            print(f"[sleep] allow_sleep failed: {exc}", flush=True)
            return False


def sleep_preventing() -> bool:
    return _asserted


def prevent_manual() -> bool:
    """Explicit /sleep prevent — stays ON until /sleep allow or exit."""
    global _manual_prevent, _ever_auto_used
    with _lock:
        _manual_prevent = True
        _ever_auto_used = True
    return prevent_sleep()


def allow_manual() -> bool:
    """Explicit /sleep allow — cancels any prior /sleep prevent."""
    global _manual_prevent
    with _lock:
        _manual_prevent = False
    return allow_sleep()


def note_task_activity() -> None:
    """Call on every task dispatch / completion.  Auto-asserts prevention on
    first use and pushes the auto-release timer forward."""
    global _ever_auto_used, _last_activity
    with _lock:
        _last_activity = time.time()
        if not _ever_auto_used:
            _ever_auto_used = True
    prevent_sleep()


def release_if_idle() -> None:
    """Auto-release 5 min after last task activity UNLESS the user explicitly
    requested /sleep prevent (manual override wins)."""
    global _asserted
    with _lock:
        if not _asserted or _manual_prevent or not _ever_auto_used:
            return
        if time.time() - _last_activity >= AUTO_RELEASE_AFTER_SECONDS:
            _do_release_locked()
            _asserted = False
            print("[sleep] auto-release after idle window", flush=True)


async def sleep_housekeeping_loop() -> None:
    """Background enforcement of the auto-release timer."""
    while True:
        await asyncio.sleep(15)
        release_if_idle()


def status_line() -> str:
    """Human-readable sleep status for /status output."""
    if _asserted:
        how = "manual" if _manual_prevent else "auto (active task)"
        return f"Sleep: Prevented ({how}, caffeinate/systemd-inhibit active)"
    return "Sleep: Allowed (idle sleep enabled)"


@atexit.register
def _cleanup() -> None:
    allow_sleep()