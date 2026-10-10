# backend/audit.py — audit recorder (JSONL + human .txt)
import os, json, time, pathlib, asyncio, atexit
from typing import Optional, Any, Dict, List
from dataclasses import dataclass, field, asdict

AUDIT_DIR = pathlib.Path.home() / ".local" / "share" / "tto" / "collab" / "audit"
AUDIT_DIR.mkdir(parents=True, exist_ok=True)

DESKTOP_DIR = pathlib.Path.home() / "Desktop"

@dataclass
class AuditEvent:
    timestamp: float
    username: str
    event_type: str  # "login", "logout", "workspace_open", "terminal_open", "command", "workspace_change", "setting_change", "message"
    details: Dict[str, Any] = field(default_factory=dict)
    workspace_id: Optional[str] = None
    tty: Optional[str] = None

    def to_jsonl(self) -> str:
        return json.dumps({
            "ts": self.timestamp,
            "user": self.username,
            "type": self.event_type,
            "details": self.details,
            "ws": self.workspace_id,
            "tty": self.tty,
        }, separators=(",", ":"), ensure_ascii=False)

    def to_txt_line(self, max_len: int = 200) -> str:
        ts_str = time.strftime("%H:%M:%S", time.localtime(self.timestamp))
        detail_str = ""
        if self.event_type == "command":
            cmd = self.details.get("command", "")
            detail_str = f"typed {cmd!r}"
            if len(detail_str) > max_len:
                detail_str = detail_str[:max_len] + "…"
        elif self.event_type == "workspace_open":
            detail_str = f"opened workspace {self.details.get('workspace_id', '')!r}"
        elif self.event_type == "terminal_open":
            detail_str = f"opened terminal {self.tty!r} in workspace {self.workspace_id!r}"
        elif self.event_type == "workspace_change":
            what = self.details.get("what", "")
            val = self.details.get("value", "")
            detail_str = f"changed workspace {self.workspace_id!r} {what} → {val!r}"
        elif self.event_type == "login":
            detail_str = f"LOGIN (LAN, token {self.details.get('token_prefix', '')})"
        elif self.event_type == "logout":
            detail_str = "LOGOUT"
        elif self.event_type == "message":
            msg = self.details.get("message", "")
            detail_str = f"message: {msg!r}"
            if len(detail_str) > max_len:
                detail_str = detail_str[:max_len] + "…"
        else:
            detail_str = json.dumps(self.details, ensure_ascii=False)
        ws = f" (ws: {self.workspace_id})" if self.workspace_id else ""
        return f"[{ts_str}] {detail_str}{ws}"

class AuditRecorder:
    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._writer())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def record(self, event: AuditEvent):
        """Thread-safe fire-and-forget."""
        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            pass  # drop under extreme load

    async def _writer(self):
        # Per-user JSONL files (account record)
        jsonl_handles: Dict[str, Any] = {}
        # Per-workspace txt files
        txt_handles: Dict[str, Any] = {}
        # Desktop txt handles
        desktop_handles: Dict[str, Any] = {}

        def _get_jsonl(username: str):
            if username not in jsonl_handles:
                path = AUDIT_DIR / f"{username}.jsonl"
                jsonl_handles[username] = path.open("a", encoding="utf-8")
            return jsonl_handles[username]

        def _get_txt(username: str, workspace_id: str):
            key = f"{username}@{workspace_id}"
            if key not in txt_handles:
                ws_dir = pathlib.Path(workspace_id) / ".tto-collab"
                ws_dir.mkdir(parents=True, exist_ok=True)
                path = ws_dir / f"{username}-{time.strftime('%Y-%m-%d')}.txt"
                txt_handles[key] = path.open("a", encoding="utf-8")
            return txt_handles[key]

        def _get_desktop(username: str):
            if username not in desktop_handles:
                path = DESKTOP_DIR / f"TTO-Collab-{username}-{time.strftime('%Y-%m-%d')}.txt"
                desktop_handles[username] = path.open("a", encoding="utf-8")
            return desktop_handles[username]

        from collab_store import get_collab_store
        store = get_collab_store()

        while self._running:
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                # Periodically sweep and flush
                for h in jsonl_handles.values():
                    h.flush()
                for h in txt_handles.values():
                    h.flush()
                for h in desktop_handles.values():
                    h.flush()
                continue

            try:
                # JSONL (account record)
                f = _get_jsonl(event.username)
                f.write(event.to_jsonl() + "\n")
                f.flush()

                # Workspace .txt
                if event.workspace_id:
                    try:
                        f2 = _get_txt(event.username, event.workspace_id)
                        f2.write(event.to_txt_line() + "\n")
                        f2.flush()
                    except Exception:
                        pass  # workspace may not be accessible

                # Desktop .txt (if enabled in settings)
                if store.is_desktop_log_allowed():
                    try:
                        f3 = _get_desktop(event.username)
                        f3.write(event.to_txt_line() + "\n")
                        f3.flush()
                    except Exception:
                        pass
            except Exception:
                pass  # never let audit break the app

        # Cleanup on stop
        for h in jsonl_handles.values():
            try: h.close()
            except: pass
        for h in txt_handles.values():
            try: h.close()
            except: pass
        for h in desktop_handles.values():
            try: h.close()
            except: pass

# Singleton
_audit_recorder: Optional[AuditRecorder] = None

def get_audit_recorder() -> AuditRecorder:
    global _audit_recorder
    if _audit_recorder is None:
        _audit_recorder = AuditRecorder()
    return _audit_recorder

async def audit_event(username: str, event_type: str, details: Dict[str, Any] = None, workspace_id: str = None, tty: str = None):
    """Convenience: record an audit event asynchronously."""
    recorder = get_audit_recorder()
    recorder.record(AuditEvent(
        timestamp=time.time(),
        username=username,
        event_type=event_type,
        details=details or {},
        workspace_id=workspace_id,
        tty=tty,
    ))

# Helper for common events
async def audit_login(username: str, token_prefix: str = None):
    await audit_event(username, "login", {"token_prefix": token_prefix or ""})

async def audit_logout(username: str):
    await audit_event(username, "logout")

async def audit_workspace_open(username: str, workspace_id: str):
    await audit_event(username, "workspace_open", {"workspace_id": workspace_id}, workspace_id=workspace_id)

async def audit_terminal_open(username: str, workspace_id: str, tty: str):
    await audit_event(username, "terminal_open", {}, workspace_id=workspace_id, tty=tty)

async def audit_command(username: str, workspace_id: str, tty: str, command: str):
    await audit_event(username, "command", {"command": command}, workspace_id=workspace_id, tty=tty)

async def audit_workspace_change(username: str, workspace_id: str, what: str, value: Any):
    await audit_event(username, "workspace_change", {"what": what, "value": value}, workspace_id=workspace_id)

async def audit_message(username: str, workspace_id: str, message: str):
    await audit_event(username, "message", {"message": message}, workspace_id=workspace_id)
