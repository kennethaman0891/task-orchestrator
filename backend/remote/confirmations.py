"""TTO Remote Control — confirmation system.

Dangerous commands are never executed immediately.  The service creates a
Confirmation bound to: sender + command + target + token + expiry.  Only the
same sender can confirm (via `CONFIRM <token>`), and only within the TTL.
Tokens are single-use — after use (or expiry) they are removed.
"""
from __future__ import annotations

import secrets
import time
from typing import Optional

from .config import load_config
from .models import Confirmation, state


def create_confirmation(sender: str, command: str, target: str = "", details: str = "") -> Confirmation:
    cfg = load_config()
    token = secrets.token_hex(3).upper()  # short, WhatsApp-friendly (e.g. 9F2A1C)
    conf = Confirmation(
        token=token,
        sender=sender,
        command=command,
        target=target,
        details=details,
        expires_at=time.time() + cfg.confirm_ttl_seconds,
    )
    state.confirmations[token] = conf
    _prune()
    return conf


def _prune() -> None:
    now = time.time()
    for token in [t for t, c in state.confirmations.items() if c.expired]:
        state.confirmations.pop(token, None)


def resolve_confirmation(sender: str, token: str) -> Optional[Confirmation]:
    """Return the confirmation if valid for THIS sender and not expired."""
    _prune()
    conf = state.confirmations.get(token.upper())
    if not conf:
        return None
    if conf.sender != sender:
        return None
    if conf.expired:
        state.confirmations.pop(token.upper(), None)
        return None
    return conf


def consume_confirmation(token: str) -> None:
    state.confirmations.pop(token.upper(), None)


def pending_for(sender: str) -> list:
    """Active confirmations belonging to a sender (for /cancel + display)."""
    _prune()
    return [c for c in state.confirmations.values() if c.sender == sender]


def cancel_for(sender: str) -> int:
    _prune()
    removed = [t for t, c in state.confirmations.items() if c.sender == sender]
    for t in removed:
        state.confirmations.pop(t, None)
    return len(removed)
