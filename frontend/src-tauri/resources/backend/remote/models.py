"""TTO Remote Control — data models (stdlib dataclasses, no pydantic needed)."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class WebhookEvent:
    """A normalized incoming message event from OpenWA's webhook."""

    sender: str = ""            # phone number or chat participant id
    chat_id: str = ""           # chat id (group or 1:1)
    message_id: str = ""        # unique message id (used for idempotency)
    message_type: str = "text"  # text | image | audio | video | document | ...
    body: str = ""              # text body (empty for non-text)
    timestamp: float = 0.0
    event: str = "message.received"  # which OpenWA event fired
    from_me: bool = False            # True for the account's own (self-chat) sends
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ParsedCommand:
    """A safe, structured command parsed from a WhatsApp message."""

    name: str = ""            # canonical command name (e.g. "terminal")
    args: List[str] = field(default_factory=list)
    raw: str = ""             # original message text
    action: str = ""          # canonical action when applicable (input|queue|pause|...)
    target: str = ""          # resolved terminal key (tty or session id)
    # permission class assigned at parse time: read | write | dangerous
    permission: str = "read"
    # when name == "usage_error", the command that was attempted (for targeted help)
    usage_for: str = ""
    # text that must follow CONFIRM <TOKEN> to authorize a dangerous action
    confirmation_hint: str = ""


@dataclass
class Confirmation:
    token: str
    sender: str
    command: str
    target: str = ""
    details: str = ""
    created_at: float = field(default_factory=time.time)
    expires_at: float = 0.0

    @property
    def expired(self) -> bool:
        return time.time() > self.expires_at


@dataclass
class CommandResult:
    ok: bool
    reply: str
    requires_confirmation: bool = False
    confirmation_token: str = ""
    duration_ms: float = 0.0
    error: str = ""


@dataclass
class AuditEntry:
    timestamp: float = field(default_factory=time.time)
    sender: str = ""
    command: str = ""
    terminal: str = ""
    result: str = ""
    success: bool = True
    confirmation: str = ""
    duration_ms: float = 0.0


def log_audit(entry: "AuditEntry") -> None:
    """Record an audit entry in memory AND append to the configured audit log
    file (TTO_REMOTE_AUDIT_LOG) when set.  Never writes secrets: command text
    is capped and the sender id is already allowlisted (not a credential)."""
    state.audit.append(entry)
    if len(state.audit) > 500:
        state.audit = state.audit[-500:]
    path = os.environ.get("TTO_REMOTE_AUDIT_LOG", "")
    if not path:
        return
    try:
        line = (
            f"{datetime.utcnow().isoformat()}Z | sender={entry.sender} | "
            f"cmd={entry.command[:80]} | term={entry.terminal} | "
            f"result={entry.result[:100]} | ok={entry.success} | "
            f"conf={entry.confirmation or '-'} | dur={entry.duration_ms}ms"
        )
        with open(path, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


@dataclass
class RemoteState:
    """Runtime state for the remote subsystem (never persisted secrets)."""

    last_command: str = ""
    last_activity: float = 0.0
    last_error: str = ""
    openwa_connected: bool = False
    whatsapp_session: str = ""          # session label, not a token
    paired: bool = False
    qr_available: bool = False
    last_status: str = ""             # last session status string observed
    processed_message_ids: Dict[str, float] = field(default_factory=dict)  # idempotency
    confirmations: Dict[str, Confirmation] = field(default_factory=dict)
    rate_hits: Dict[str, List[float]] = field(default_factory=dict)  # sender -> timestamps
    notify_last_sent: Dict[str, float] = field(default_factory=dict)  # category -> ts
    audit: List[AuditEntry] = field(default_factory=list)

    def note_command(self, command: str) -> None:
        self.last_command = command
        self.last_activity = time.time()

    def status_payload(self) -> Dict[str, Any]:
        from .config import load_config
        cfg = load_config()
        return {
            "enabled": cfg.enabled,
            "openwa_connected": self.openwa_connected,
            "whatsapp_session": self.whatsapp_session,
            "paired": self.paired,
            "qr_available": self.qr_available,
            "last_command": self.last_command,
            "last_activity": self.last_activity,
            "last_error": self.last_error,
            "config": cfg.redacted(),
        }


# Shared singleton — imported by every remote module.
state = RemoteState()
