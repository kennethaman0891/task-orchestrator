"""TTO Remote Control — authorization.

Security layers:
1. Webhook secret / signature check (the OpenWA webhook must know the secret).
2. Sender allowlist: only configured chat ids AND/OR phone numbers control TTO.
3. Rate limiting: max N commands per minute per sender.
4. Permission classes (read / write / dangerous) enforced at the service layer.
"""
from __future__ import annotations

import hmac
import time
from typing import List, Optional, Tuple

from .config import load_config
from .models import state

# --- Webhook authentication -------------------------------------------------

def verify_webhook_secret(provided: Optional[str], body: bytes = b"") -> Tuple[bool, str]:
    """Verify the webhook request.

    Modes:
    - `X-Webhook-Secret` header equals OPENWA_WEBHOOK_SECRET (simple mode), or
    - OpenWA's `X-OpenWA-Signature` = `sha256=<hex HMAC-SHA256(secret, raw body)>`.
    When no secret is configured, webhook requests are rejected (fail closed).
    """
    cfg = load_config()
    if not cfg.webhook_secret:
        return False, "webhook not configured (set OPENWA_WEBHOOK_SECRET)"
    if not provided:
        return False, "missing webhook secret"
    if hmac.compare_digest(provided, cfg.webhook_secret):
        return True, ""
    # Signature mode: sha256=<hex> over the raw body.
    sig = provided
    if sig.startswith("sha256="):
        sig = sig[len("sha256="):].strip()
    try:
        expected = hmac.new(cfg.webhook_secret.encode(), body, "sha256").hexdigest()
        if hmac.compare_digest(sig.lower(), expected):
            return True, ""
    except Exception:
        pass
    return False, "invalid webhook secret/signature"


# --- Sender allowlist -------------------------------------------------------

def is_authorized_sender(sender: str, chat_id: str) -> bool:
    """A sender is authorized if EITHER their chat id or phone number is in
    the configured allowlist.  With no allowlist configured the remote is
    disabled (fail closed — never allow everyone)."""
    cfg = load_config()
    if not cfg.allowed_chat_ids and not cfg.allowed_phone_numbers:
        return False
    sender = (sender or "").strip()
    chat_id = (chat_id or "").strip()
    if chat_id and chat_id in cfg.allowed_chat_ids:
        return True
    # Phone numbers may arrive as +15551234 / 15551234 / "15551234@c.us".
    norm = sender.split("@")[0].strip().lstrip("+")
    for allowed in cfg.allowed_phone_numbers:
        if allowed.lstrip("+") == norm:
            return True
        if sender == allowed or chat_id == allowed:
            return True
    return False


# --- Rate limiting ----------------------------------------------------------

def rate_limit_exceeded(sender: str, limit_per_minute: Optional[int] = None) -> bool:
    """True when the sender has exceeded the per-minute command budget.

    Windows are per-sender with a 60 s sliding window; old hits are pruned
    opportunistically so the table never grows unbounded.
    """
    cfg = load_config()
    limit = limit_per_minute if limit_per_minute is not None else cfg.rate_limit_per_minute
    if limit <= 0:
        return False
    now = time.time()
    hits = state.rate_hits.setdefault(sender, [])
    hits = [t for t in hits if now - t < 60]
    state.rate_hits[sender] = hits
    if len(hits) >= limit:
        return True
    hits.append(now)
    return False


def reset_rate_limits() -> None:
    state.rate_hits.clear()
