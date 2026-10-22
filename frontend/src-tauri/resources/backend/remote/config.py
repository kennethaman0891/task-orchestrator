"""TTO Remote Control — configuration.

Loads settings from environment variables, with a lightweight stdlib `.env`
parser (no third-party dependency so OpenWA stays a purely optional external
service).  Secrets are never printed anywhere: `__str__`/`redacted()` mask
them and the audit log redacts values via `redact_secrets()`.

``DISCORD_ALLOWED_USER_IDS`` is a space-, comma-, or semicolon-separated list
of numeric Discord user IDs. An empty list rejects every Discord user.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

# Keys that must never appear in logs / UI values.
_SECRET_KEYS = {
    "OPENWA_API_KEY",
    "OPENWA_WEBHOOK_SECRET",
    "OPENWA_SESSION_TOKEN",
}

# Sensitive path fragments that /files must always block (in addition to the
# existing home-scoped traversal guard in main.py).
BLOCKED_PATH_FRAGMENTS = (
    ".ssh",
    ".gnupg",
    ".aws",
    ".config/opencode",
    "credentials",
    ".env",
    "id_rsa",
    "id_ed25519",
    "id_dsa",
    ".npmrc",
    ".bash_history",
    ".zsh_history",
    ".netrc",
    "key.pem",
    "secret",
    ".tto-web/state.json",
)


def load_dotenv(path: str | Path | None = None) -> None:
    """Minimal .env loader — the sidecar's config file is AUTHORITATIVE.

    Values declared in .env override anything inherited in the environment.
    This is deliberate: a stray exported variable left in a shell
    silently broke remote delivery before; for a desktop-app sidecar
    the .env file is the single source of truth.

    Searches, in order: an explicit path, the project root, and the project's
    backend directory.  Comments (#), blank lines and KEY=value / export KEY=value
    forms are supported.  Values may be single/double quoted.
    """
    candidates: List[Path] = []
    if path:
        candidates.append(Path(path))
    root = Path(__file__).resolve().parent.parent.parent  # ~/tto-web
    candidates += [root / ".env", root / "backend" / ".env"]
    for p in candidates:
        if not p.exists():
            continue
        try:
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[len("export "):].strip()
                if "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                    val = val[1:-1]
                if key:
                    os.environ[key] = val
        except OSError:
            pass
        break  # only the first existing candidate wins


load_dotenv()


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_list(name: str) -> List[str]:
    raw = os.environ.get(name, "")
    return [x.strip() for x in re.split(r"[,\s;]+", raw) if x.strip()]


@dataclass
class RemoteConfig:
    # Master switch — the whole subsystem stays dormant when False.
    enabled: bool = False

    # OpenWA connection.
    openwa_base_url: str = "http://127.0.0.1:2785"
    openwa_api_key: str = ""
    openwa_session_id: str = ""
    openwa_timeout: float = 8.0
    openwa_retries: int = 2

    # Webhook + authorization.
    webhook_secret: str = ""
    allowed_chat_ids: List[str] = field(default_factory=list)
    allowed_phone_numbers: List[str] = field(default_factory=list)
    discord_allowed_user_ids: List[str] = field(default_factory=list)

    # Command policy.
    rate_limit_per_minute: int = 30
    confirm_ttl_seconds: int = 60
    logs_max_lines: int = 200
    logs_default_lines: int = 30

    # Proactive notifications.
    notify_task_complete: bool = True
    notify_task_failed: bool = True
    notify_agent_waiting: bool = True
    notify_terminal_crash: bool = True
    notify_system_error: bool = True
    notify_min_interval_seconds: int = 30  # cooldown per category

    # Audit.
    audit_log_path: str = ""

    @property
    def remote_enabled(self) -> bool:
        return self.enabled

    @property
    def secret_values(self) -> List[str]:
        return [v for v in (self.openwa_api_key, self.webhook_secret) if v]

    def redacted(self) -> Dict[str, object]:
        """Safe status payload — never contains secret values."""
        return {
            "enabled": self.enabled,
            "openwa_base_url": self.openwa_base_url,
            "openwa_session_id": self.openwa_session_id,
            "has_api_key": bool(self.openwa_api_key),
            "has_webhook_secret": bool(self.webhook_secret),
            "allowed_chat_ids": [redact_secrets(c, self.secret_values) for c in self.allowed_chat_ids],
            "allowed_phone_numbers": [redact_secrets(p, self.secret_values) for p in self.allowed_phone_numbers],
            "rate_limit_per_minute": self.rate_limit_per_minute,
            "confirm_ttl_seconds": self.confirm_ttl_seconds,
            "notifications": {
                "task_complete": self.notify_task_complete,
                "task_failed": self.notify_task_failed,
                "agent_waiting": self.notify_agent_waiting,
                "terminal_crash": self.notify_terminal_crash,
                "system_error": self.notify_system_error,
            },
        }


def load_config() -> RemoteConfig:
    return RemoteConfig(
        enabled=_env_bool("TTO_REMOTE_ENABLED", False) or _env_bool("OPENWA_ENABLED", False),
        openwa_base_url=os.environ.get("OPENWA_BASE_URL", "http://127.0.0.1:2785").rstrip("/"),
        openwa_api_key=os.environ.get("OPENWA_API_KEY", ""),
        openwa_session_id=os.environ.get("OPENWA_SESSION_ID", ""),
        openwa_timeout=float(os.environ.get("OPENWA_TIMEOUT", "8")),
        openwa_retries=_env_int("OPENWA_RETRIES", 2),
        webhook_secret=os.environ.get("OPENWA_WEBHOOK_SECRET", ""),
        allowed_chat_ids=_env_list("OPENWA_ALLOWED_CHAT_IDS"),
        allowed_phone_numbers=_env_list("OPENWA_ALLOWED_PHONE_NUMBERS"),
        discord_allowed_user_ids=_env_list("DISCORD_ALLOWED_USER_IDS"),
        rate_limit_per_minute=_env_int("TTO_REMOTE_RATE_LIMIT", 30),
        confirm_ttl_seconds=_env_int("TTO_REMOTE_CONFIRM_TTL", 60),
        logs_max_lines=max(1, min(_env_int("TTO_REMOTE_LOGS_MAX", 200), 500)),
        logs_default_lines=max(1, _env_int("TTO_REMOTE_LOGS_DEFAULT", 30)),
        notify_task_complete=_env_bool("TTO_REMOTE_NOTIFY_TASK_COMPLETE", True),
        notify_task_failed=_env_bool("TTO_REMOTE_NOTIFY_TASK_FAILED", True),
        notify_agent_waiting=_env_bool("TTO_REMOTE_NOTIFY_AGENT_WAITING", True),
        notify_terminal_crash=_env_bool("TTO_REMOTE_NOTIFY_TERMINAL_CRASH", True),
        notify_system_error=_env_bool("TTO_REMOTE_NOTIFY_SYSTEM_ERROR", True),
        notify_min_interval_seconds=_env_int("TTO_REMOTE_NOTIFY_MIN_INTERVAL", 30),
        audit_log_path=os.environ.get("TTO_REMOTE_AUDIT_LOG", ""),

    )


def discord_user_allowed(user_id: object) -> bool:
    """Fail closed: an empty allowlist rejects every Discord user."""
    allowed = load_config().discord_allowed_user_ids
    return bool(allowed) and str(user_id) in allowed


def redact_secrets(text: str, secrets: List[str]) -> str:
    """Replace any secret substring in `text` with **** (for logs / UI)."""
    out = text
    for secret in secrets:
        if secret and secret in out:
            out = out.replace(secret, "****")
    return out
