# backend/collab_store.py — user/token/owner/invite store (stdlib only)
import os, json, hashlib, secrets, time, pathlib, smtplib
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict, field
from email.message import EmailMessage

COLLAB_DIR = pathlib.Path.home() / ".local" / "share" / "tto" / "collab"
COLLAB_DIR.mkdir(parents=True, exist_ok=True)

OWNER_FILE = COLLAB_DIR / "owner.json"
USERS_FILE = COLLAB_DIR / "users.json"
TOKENS_FILE = COLLAB_DIR / "tokens.json"
INVITES_FILE = COLLAB_DIR / "invites.json"
SETTINGS_FILE = COLLAB_DIR / "settings.json"

def _hash_pin(pin: str, salt: Optional[bytes] = None) -> tuple[str, str]:
    """Return (hash_hex, salt_hex) using PBKDF2-HMAC-SHA256 (stdlib)."""
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 100_000)
    return dk.hex(), salt.hex()

def _verify_pin(pin: str, hash_hex: str, salt_hex: str) -> bool:
    calc, _ = _hash_pin(pin, bytes.fromhex(salt_hex))
    return secrets.compare_digest(calc, hash_hex)

@dataclass
class OwnerProfile:
    email: str
    name: str
    instance_name: str = ""
    tagline: str = ""
    plan: str = "pro"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)

@dataclass
class CollabUser:
    username: str
    pin_hash: str
    pin_salt: str
    permission: str  # "viewer" | "worker"
    allowed_workspaces: List[str]  # empty = all
    email: str = ""
    name: str = ""
    created_at: float = field(default_factory=time.time)
    last_login_at: float = 0.0
    revoked: bool = False

    def check_pin(self, pin: str) -> bool:
        return _verify_pin(pin, self.pin_hash, self.pin_salt)

    def to_safe_dict(self) -> dict:
        display_email = self.email or self.username
        display_name = self.name or (display_email.split("@")[0] if "@" in display_email else display_email)
        return {
            "username": self.username,
            "email": display_email,
            "name": display_name,
            "permission": self.permission,
            "allowed_workspaces": self.allowed_workspaces,
            "created_at": self.created_at,
            "last_login_at": self.last_login_at,
            "revoked": self.revoked,
        }

@dataclass
class CollabToken:
    token: str
    username: str
    created_at: float = field(default_factory=time.time)
    expires_at: float = field(default_factory=lambda: time.time() + 7 * 86400)

    def is_valid(self) -> bool:
        return time.time() < self.expires_at

@dataclass
class InviteRecord:
    code: str
    email: str
    pin: str
    permission: str = "worker"
    allowed_workspaces: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    expires_at: float = field(default_factory=lambda: time.time() + 7 * 86400)
    used: bool = False

    def is_valid(self) -> bool:
        return not self.used and time.time() < self.expires_at

    def to_dict(self) -> dict:
        return asdict(self)

class CollabStore:
    def __init__(self, base_dir: Optional[pathlib.Path] = None):
        self._users: Dict[str, CollabUser] = {}
        self._tokens: Dict[str, CollabToken] = {}
        self._owner: Optional[OwnerProfile] = None
        self._invites: Dict[str, InviteRecord] = {}
        self._settings: dict = {
            "lan_access": False,
            "log_on_desktop": True,
            "signin_alerts": False,
            "visit_retention_days": 90,
            "session_hours": 168,
            "idle_minutes": 30,
            "smtp": {
                "enabled": False,
                "host": "",
                "port": 587,
                "username": "",
                "password": "",
                "use_tls": True,
                "from_email": "",
                "from_name": "Task Orchestrator Colab",
            }
        }
        base = pathlib.Path(base_dir) if base_dir else COLLAB_DIR
        base.mkdir(parents=True, exist_ok=True)
        self.base_dir = base
        self.owner_file = base / "owner.json"
        self.users_file = base / "users.json"
        self.tokens_file = base / "tokens.json"
        self.invites_file = base / "invites.json"
        self.settings_file = base / "settings.json"
        self._load()

    def _load(self):
        # owner
        if self.owner_file.exists():
            try:
                data = json.loads(self.owner_file.read_text(encoding="utf-8"))
                if "plan" not in data:
                    data["plan"] = "pro"
                self._owner = OwnerProfile(**data)
            except Exception:
                pass

        # users
        if self.users_file.exists():
            try:
                data = json.loads(self.users_file.read_text(encoding="utf-8"))
                for u in data.get("users", []):
                    # Handle backward compatibility for records without email/name/last_login_at
                    clean_u = {
                        "username": u.get("username", ""),
                        "pin_hash": u.get("pin_hash", ""),
                        "pin_salt": u.get("pin_salt", ""),
                        "permission": u.get("permission", "worker"),
                        "allowed_workspaces": u.get("allowed_workspaces", []),
                        "email": u.get("email", u.get("username", "")),
                        "name": u.get("name", ""),
                        "created_at": u.get("created_at", time.time()),
                        "last_login_at": u.get("last_login_at", 0.0),
                        "revoked": u.get("revoked", False),
                    }
                    self._users[clean_u["username"]] = CollabUser(**clean_u)
            except Exception:
                pass

        # tokens
        if self.tokens_file.exists():
            try:
                data = json.loads(self.tokens_file.read_text(encoding="utf-8"))
                for t in data.get("tokens", []):
                    self._tokens[t["token"]] = CollabToken(**t)
            except Exception:
                pass

        # invites
        if self.invites_file.exists():
            try:
                data = json.loads(self.invites_file.read_text(encoding="utf-8"))
                for inv in data.get("invites", []):
                    self._invites[inv["code"]] = InviteRecord(**inv)
            except Exception:
                pass

        # settings
        if self.settings_file.exists():
            try:
                data = json.loads(self.settings_file.read_text(encoding="utf-8"))
                self._settings.update(data)
            except Exception:
                pass

    def _save_owner(self):
        if self._owner:
            self.owner_file.write_text(json.dumps(self._owner.to_dict(), indent=2), encoding="utf-8")
        elif self.owner_file.exists():
            self.owner_file.unlink(missing_ok=True)

    def _save_users(self):
        self.users_file.write_text(json.dumps({"users": [asdict(u) for u in self._users.values()]}, indent=2), encoding="utf-8")

    def _save_tokens(self):
        self.tokens_file.write_text(json.dumps({"tokens": [asdict(t) for t in self._tokens.values()]}, indent=2), encoding="utf-8")

    def _save_invites(self):
        self.invites_file.write_text(json.dumps({"invites": [asdict(i) for i in self._invites.values()]}, indent=2), encoding="utf-8")

    def _save_settings(self):
        self.settings_file.write_text(json.dumps(self._settings, indent=2), encoding="utf-8")

    # --- Owner Profile ---
    def get_owner(self) -> Optional[dict]:
        return self._owner.to_dict() if self._owner else None

    def set_owner(self, email: str, name: str, instance_name: str = "", tagline: str = "", plan: Optional[str] = None) -> dict:
        now = time.time()
        created = self._owner.created_at if self._owner else now
        display_name = name.strip() or email.split("@")[0]
        inst_name = instance_name.strip() or f"{display_name}'s Task Orchestrator"
        current_plan = plan or (self._owner.plan if self._owner else "pro")
        self._owner = OwnerProfile(
            email=email.strip().lower(),
            name=display_name,
            instance_name=inst_name,
            tagline=tagline.strip(),
            plan=current_plan,
            created_at=created,
            updated_at=now
        )
        self._save_owner()
        return self._owner.to_dict()

    def set_owner_plan(self, plan: str) -> dict:
        if not self._owner:
            return self.set_owner("host@local", "Administrator", plan=plan)
        self._owner.plan = plan
        self._owner.updated_at = time.time()
        self._save_owner()
        return self._owner.to_dict()

    # --- Users ---
    def create_user(
        self,
        email: str,
        pin: str,
        name: str = "",
        permission: str = "worker",
        allowed_workspaces: Optional[List[str]] = None,
        username: Optional[str] = None
    ) -> CollabUser:
        clean_email = email.strip().lower()
        if not clean_email or "@" not in clean_email:
            # Fallback if someone supplied a username without @
            user_key = (username or clean_email).strip().lower()
        else:
            user_key = clean_email

        if user_key in self._users or self.get_user(clean_email):
            raise ValueError(f"User with email/username '{clean_email}' already exists")
        if len(pin) < 6:
            raise ValueError("PIN must be at least 6 characters")
        if permission not in ("viewer", "worker"):
            raise ValueError("Permission must be 'viewer' or 'worker'")
        h, s = _hash_pin(pin)
        display_name = name.strip() or clean_email.split("@")[0]
        user = CollabUser(
            username=user_key,
            email=clean_email,
            name=display_name,
            pin_hash=h,
            pin_salt=s,
            permission=permission,
            allowed_workspaces=allowed_workspaces or []
        )
        self._users[user_key] = user
        self._save_users()
        return user

    def get_user(self, identifier: str) -> Optional[CollabUser]:
        if not identifier:
            return None
        # Check direct key
        u = self._users.get(identifier)
        if u and not u.revoked:
            return u
        # Check by email or username case-insensitively
        low = identifier.lower().strip()
        for user in self._users.values():
            if not user.revoked and (user.username.lower() == low or user.email.lower() == low):
                return user
        return None

    def list_users(self) -> List[CollabUser]:
        return [u for u in self._users.values() if not u.revoked]

    def revoke_user(self, identifier: str) -> bool:
        u = self.get_user(identifier)
        if not u:
            return False
        u.revoked = True
        to_del = [tok for tok, t in self._tokens.items() if t.username == u.username]
        for tok in to_del:
            del self._tokens[tok]
        self._save_users()
        self._save_tokens()
        return True

    def delete_user(self, identifier: str) -> bool:
        u = self.get_user(identifier)
        if not u:
            return False
        key = u.username
        if key in self._users:
            del self._users[key]
        to_del = [tok for tok, t in self._tokens.items() if t.username == key]
        for tok in to_del:
            del self._tokens[tok]
        self._save_users()
        self._save_tokens()
        return True

    def update_user(self, identifier: str, **fields) -> Optional[CollabUser]:
        u = self.get_user(identifier)
        if not u:
            return None
        for k, v in fields.items():
            if hasattr(u, k) and k not in ("username", "pin_hash", "pin_salt"):
                setattr(u, k, v)
        self._save_users()
        return u

    def set_pin(self, identifier: str, new_pin: str) -> Optional[CollabUser]:
        u = self.get_user(identifier)
        if not u or u.revoked:
            return None
        if len(new_pin) < 6:
            raise ValueError("PIN must be at least 6 characters")
        h, s = _hash_pin(new_pin)
        u.pin_hash, u.pin_salt = h, s
        self._save_users()
        return u

    def record_login(self, identifier: str) -> None:
        u = self.get_user(identifier)
        if u:
            u.last_login_at = time.time()
            self._save_users()

    # --- Invites & Magic Links ---
    def create_invite(
        self,
        email: str,
        pin: str,
        permission: str = "worker",
        allowed_workspaces: Optional[List[str]] = None
    ) -> InviteRecord:
        clean_email = email.strip().lower()
        code = secrets.token_urlsafe(24)
        rec = InviteRecord(
            code=code,
            email=clean_email,
            pin=pin,
            permission=permission,
            allowed_workspaces=allowed_workspaces or []
        )
        self._invites[code] = rec
        self._save_invites()
        return rec

    def get_invite(self, code: str) -> Optional[InviteRecord]:
        inv = self._invites.get(code)
        if inv and inv.is_valid():
            return inv
        return None

    def consume_invite(self, code: str) -> Optional[InviteRecord]:
        inv = self._invites.get(code)
        if not inv or not inv.is_valid():
            return None
        inv.used = True
        self._save_invites()
        return inv

    # --- Tokens ---
    def create_token(self, identifier: str, ttl_seconds: Optional[float] = None) -> Optional[str]:
        u = self.get_user(identifier)
        if not u:
            return None
        token = secrets.token_urlsafe(32)
        ttl = 7 * 86400 if ttl_seconds is None else max(60.0, float(ttl_seconds))
        self._tokens[token] = CollabToken(
            token=token,
            username=u.username,
            expires_at=time.time() + ttl,
        )
        self._save_tokens()
        return token

    def revoke_token_prefix(self, identifier: str, prefix: str) -> int:
        """Revoke tokens for this user whose value starts with prefix.

        An empty prefix revokes every token for the user. Returns how many
        tokens were removed.
        """
        u = self._find_user_any(identifier)
        if not u:
            return 0
        to_del = [
            tok for tok, t in self._tokens.items()
            if t.username == u.username and (not prefix or tok.startswith(prefix))
        ]
        for tok in to_del:
            del self._tokens[tok]
        if to_del:
            self._save_tokens()
        return len(to_del)

    def _find_user_any(self, identifier: str) -> Optional[CollabUser]:
        """Look up a user even if they have been revoked."""
        if not identifier:
            return None
        u = self._users.get(identifier)
        if u:
            return u
        low = identifier.lower().strip()
        for user in self._users.values():
            if user.username.lower() == low or (user.email or "").lower() == low:
                return user
        return None

    def validate_token(self, token: str) -> Optional[CollabUser]:
        t = self._tokens.get(token)
        if not t or not t.is_valid():
            return None
        u = self.get_user(t.username)
        return u

    def revoke_token(self, token: str) -> bool:
        if token in self._tokens:
            del self._tokens[token]
            self._save_tokens()
            return True
        return False

    def revoke_user_tokens(self, identifier: str):
        u = self.get_user(identifier)
        if not u:
            return
        to_del = [tok for tok, t in self._tokens.items() if t.username == u.username]
        for tok in to_del:
            del self._tokens[tok]
        self._save_tokens()

    def sweep_expired_tokens(self):
        now = time.time()
        to_del = [tok for tok, t in self._tokens.items() if t.expires_at < now]
        for tok in to_del:
            del self._tokens[tok]
        if to_del:
            self._save_tokens()

    # --- Email Invites & SMTP ---
    def generate_email_invite_text(
        self,
        to_email: str,
        invite_url: str,
        pin: str,
        host_name: str,
        host_email: str,
        permission: str = "worker"
    ) -> dict:
        role_label = "Worker (Full Terminal Access)" if permission == "worker" else "Viewer (Read-Only Observer)"
        subject = f"Invitation to collaborate on {host_name}'s Task Orchestrator"
        body = (
            f"Hi,\n\n"
            f"{host_name} ({host_email}) has invited you to collaborate on their Task Orchestrator instance.\n\n"
            f"Direct Login Link:\n"
            f"{invite_url}\n\n"
            f"Your Credentials:\n"
            f"• Email: {to_email}\n"
            f"• Access PIN: {pin}\n"
            f"• Role: {role_label}\n\n"
            f"Simply click the Direct Login Link in any web browser to enter the active workspaces.\n\n"
            f"— Task Orchestrator Colab Hub"
        )
        return {"subject": subject, "body": body}

    def send_invite_email(
        self,
        to_email: str,
        invite_url: str,
        pin: str,
        host_name: str,
        host_email: str,
        permission: str = "worker"
    ) -> Tuple[bool, str]:
        smtp_cfg = self._settings.get("smtp", {})
        if not smtp_cfg.get("enabled"):
            return False, "SMTP is not enabled in Colab Settings"
        host = smtp_cfg.get("host")
        port = int(smtp_cfg.get("port", 587))
        username = smtp_cfg.get("username", "")
        password = smtp_cfg.get("password", "")
        from_email = smtp_cfg.get("from_email") or host_email or username
        from_name = smtp_cfg.get("from_name", "Task Orchestrator Colab")
        use_tls = smtp_cfg.get("use_tls", True)

        if not host or not from_email:
            return False, "SMTP host or sender email is missing"

        text_data = self.generate_email_invite_text(to_email, invite_url, pin, host_name, host_email, permission)

        msg = EmailMessage()
        msg["Subject"] = text_data["subject"]
        msg["From"] = f"{from_name} <{from_email}>"
        msg["To"] = to_email
        msg.set_content(text_data["body"])

        try:
            if port == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=10)
            else:
                server = smtplib.SMTP(host, port, timeout=10)
                if use_tls:
                    server.starttls()
            if username and password:
                server.login(username, password)
            server.send_message(msg)
            server.quit()
            return True, "Email sent successfully"
        except Exception as e:
            return False, f"Failed to send email: {e}"

    def send_signin_alert(
        self,
        visitor_name: str,
        visitor_email: str,
        ip: str,
        browser: str,
        os_name: str,
        device: str,
        when_ts: Optional[float] = None,
    ) -> Tuple[bool, str]:
        """Email the owner when a visitor signs in. No-op unless the toggle and SMTP are on."""
        if not self.get_settings().get("signin_alerts"):
            return False, "Sign-in alerts are off"
        owner = self.get_owner() or {}
        to_email = (owner.get("email") or "").strip()
        if not to_email or "@" not in to_email:
            return False, "Owner email is not set"
        when = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(when_ts or time.time()))
        subject = f"Someone signed in to your Task Orchestrator — {visitor_name or visitor_email}"
        body = (
            f"{visitor_name or visitor_email} ({visitor_email}) just signed in to your Task Orchestrator.\n\n"
            f"When: {when}\n"
            f"From: {ip or 'unknown'}\n"
            f"Using: {browser or 'unknown browser'} on {os_name or 'unknown system'} ({device or 'device'})\n\n"
            f"If you do not recognize this visit, open Colab Hub, find the visit, and choose Block this person.\n\n"
            f"— Task Orchestrator Colab Hub"
        )
        return self._send_plain_email(to_email, subject, body)

    def _send_plain_email(self, to_email: str, subject: str, body: str) -> Tuple[bool, str]:
        smtp_cfg = self._settings.get("smtp", {})
        if not smtp_cfg.get("enabled"):
            return False, "SMTP is not enabled in Colab Settings"
        host = smtp_cfg.get("host")
        port = int(smtp_cfg.get("port", 587))
        username = smtp_cfg.get("username", "")
        password = smtp_cfg.get("password", "")
        owner = self.get_owner() or {}
        from_email = smtp_cfg.get("from_email") or owner.get("email") or username
        from_name = smtp_cfg.get("from_name", "Task Orchestrator Colab")
        use_tls = smtp_cfg.get("use_tls", True)
        if not host or not from_email:
            return False, "SMTP host or sender email is missing"
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{from_email}>"
        msg["To"] = to_email
        msg.set_content(body)
        try:
            if port == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=10)
            else:
                server = smtplib.SMTP(host, port, timeout=10)
                if use_tls:
                    server.starttls()
            if username and password:
                server.login(username, password)
            server.send_message(msg)
            server.quit()
            return True, "Email sent successfully"
        except Exception as e:
            return False, f"Failed to send email: {e}"

    # --- Settings ---
    def get_settings(self) -> dict:
        data = dict(self._settings)
        data.setdefault("signin_alerts", False)
        data.setdefault("visit_retention_days", 90)
        data.setdefault("session_hours", 168)
        data.setdefault("idle_minutes", 30)
        return data

    def session_ttl_seconds(self) -> float:
        try:
            hours = int(self.get_settings().get("session_hours") or 168)
        except (TypeError, ValueError):
            hours = 168
        hours = max(1, min(hours, 24 * 30))
        return float(hours * 3600)

    def idle_timeout_seconds(self) -> float:
        try:
            minutes = int(self.get_settings().get("idle_minutes") or 30)
        except (TypeError, ValueError):
            minutes = 30
        minutes = max(1, min(minutes, 24 * 60))
        return float(minutes * 60)

    def retention_days(self) -> int:
        try:
            days = int(self.get_settings().get("visit_retention_days") if self.get_settings().get("visit_retention_days") is not None else 90)
        except (TypeError, ValueError):
            days = 90
        return max(0, min(days, 3650))

    def set_lan_access(self, enabled: bool) -> dict:
        self._settings["lan_access"] = enabled
        self._save_settings()
        return self.get_settings()

    def set_log_on_desktop(self, enabled: bool) -> dict:
        self._settings["log_on_desktop"] = enabled
        self._save_settings()
        return self.get_settings()

    def set_signin_alerts(self, enabled: bool) -> dict:
        self._settings["signin_alerts"] = bool(enabled)
        self._save_settings()
        return self.get_settings()

    def set_visit_retention_days(self, days: int) -> dict:
        self._settings["visit_retention_days"] = max(0, min(int(days), 3650))
        self._save_settings()
        return self.get_settings()

    def set_session_hours(self, hours: int) -> dict:
        self._settings["session_hours"] = max(1, min(int(hours), 24 * 30))
        self._save_settings()
        return self.get_settings()

    def set_idle_minutes(self, minutes: int) -> dict:
        self._settings["idle_minutes"] = max(1, min(int(minutes), 24 * 60))
        self._save_settings()
        return self.get_settings()

    def update_smtp_settings(self, smtp_cfg: dict) -> dict:
        current_smtp = self._settings.get("smtp", {})
        current_smtp.update(smtp_cfg)
        self._settings["smtp"] = current_smtp
        self._save_settings()
        return self.get_settings()

    # --- Lan access check ---
    def is_lan_allowed(self) -> bool:
        return bool(self._settings.get("lan_access", False))

    def is_desktop_log_allowed(self) -> bool:
        return bool(self._settings.get("log_on_desktop", True))

# Singleton
_collab_store: Optional[CollabStore] = None

def get_collab_store() -> CollabStore:
    global _collab_store
    if _collab_store is None:
        _collab_store = CollabStore()
    return _collab_store
