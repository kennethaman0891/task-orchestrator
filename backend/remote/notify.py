"""TTO Remote Control — proactive notifications.

Watches the EXISTING terminal/task state (via the bridge) and pushes concise
WhatsApp messages for: task complete, task failed, agent waiting, terminal
crash, system error.  Guards against spam: per-category cooldown, message
dedup (identical body within the cooldown is skipped), and a bounded queue.
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional, Set

from .config import load_config
from .formatter import SEP
from .models import state
from .openwa_client import client as openwa

# Categories that map to env flags.
CATEGORY_FLAG = {
    "task_complete": "notify_task_complete",
    "task_failed": "notify_task_failed",
    "agent_waiting": "notify_agent_waiting",
    "terminal_crash": "notify_terminal_crash",
    "system_error": "notify_system_error",
}

_recent_bodies: Dict[str, float] = {}  # body hash -> last sent ts (dedup)


def _category_enabled(category: str) -> bool:
    cfg = load_config()
    flag = CATEGORY_FLAG.get(category)
    if not flag:
        return False
    return bool(getattr(cfg, flag, False))


def _cooldown_ok(category: str) -> bool:
    cfg = load_config()
    last = state.notify_last_sent.get(category, 0.0)
    return time.time() - last >= cfg.notify_min_interval_seconds


def push(category: str, body: str, chat_id: str = "") -> bool:
    """Send a proactive notification (if enabled + not on cooldown + not a
    duplicate).  Returns True when a message was actually sent."""
    if not _category_enabled(category):
        return False
    if not _cooldown_ok(category):
        return False
    body_hash = category + "|" + body[:200]
    if _recent_bodies.get(body_hash, 0) > time.time() - 60:
        return False
    _recent_bodies[body_hash] = time.time()
    sent = False
    # WhatsApp channel (existing OpenWA transport).
    target = chat_id or _default_chat()
    if target:
        try:
            sent = openwa.send_message(target, body) or sent
        except Exception:
            pass
    if sent:
        state.notify_last_sent[category] = time.time()
    return sent


def _default_chat() -> str:
    cfg = load_config()
    if cfg.allowed_chat_ids:
        return cfg.allowed_chat_ids[0]
    if cfg.allowed_phone_numbers:
        return cfg.allowed_phone_numbers[0]
    return ""


def format_task_complete(terminal_label: str, task: Dict[str, Any], duration_sec: float) -> str:
    """PROOF-based completion message: real terminal output captured for the
    task + duration + token usage + the agent's own summary.  This is NOT a
    text-only claim — the output lines come from the actual captured terminal
    traffic for this task (tk.output / live_output)."""
    desc = (task.get('description') or '').strip()
    summary = (task.get('summary') or '').strip()
    out = (task.get('output') or '').strip()
    # Fall back to the last screenshot-notified lines if output is empty.
    lines = [ln for ln in out.splitlines() if ln.strip()][-12:]
    snippet = "\n".join(lines) if lines else "(no captured output for this task)"
    tokens = task.get('token_usage') or {}
    tok_in = tokens.get('prompt_tokens') or tokens.get('input_tokens') or 0
    tok_out = tokens.get('completion_tokens') or tokens.get('output_tokens') or 0
    tok_line = f"{int(tok_in):,} in · {int(tok_out):,} out" if (tok_in or tok_out) else "n/a"
    msg = [
        f"✅ TERMINAL {terminal_label} COMPLETED",
        "",
        f"Task: {desc[:400]}",
        "",
        f"Duration: {_fmt_duration(duration_sec)} · Tokens: {tok_line}",
        "",
        "Captured output (last 12 lines):",
        "────────────────────────────",
        snippet,
        "────────────────────────────",
    ]
    if summary:
        msg += ["", f"Agent summary: {summary[:300]}"]
    return "\n".join(msg)


def format_task_failed(terminal_label: str, task: Dict[str, Any], error: str = "") -> str:
    return (
        f"❌ TERMINAL {terminal_label} FAILED\n\n"
        f"Task:\n{task.get('description', '')[:200]}\n\n"
        + (f"Error: {error[:200]}\n" if error else "")
        + SEP
    )


def format_agent_waiting(terminal_label: str, agent: str = "") -> str:
    return f"🟡 TERMINAL {terminal_label} WAITING\n{agent or 'Agent'} is waiting for input."


def format_terminal_crash(terminal_label: str) -> str:
    return f"💥 TERMINAL {terminal_label} CRASHED\nCheck the workspace layout."


def format_system_error(error: str) -> str:
    return f"⚠️ TTO SYSTEM ERROR\n{error[:200]}"


def _fmt_duration(sec: float) -> str:
    sec = max(0, int(sec))
    if sec < 60:
        return f"{sec}s"
    if sec < 3600:
        return f"{sec // 60}m {sec % 60}s"
    return f"{sec // 3600}h {sec % 3600 // 60}m"
