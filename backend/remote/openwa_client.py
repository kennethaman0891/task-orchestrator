"""TTO Remote Control — OpenWA HTTP client.

Talks to the EXTERNAL OpenWA service (https://github.com/rmyndharis/OpenWA)
over its HTTP REST API only.  OpenWA is optional: every method degrades
gracefully when it is offline.  Uses stdlib urllib (no third-party deps) with
short timeouts + bounded retries, and never logs secrets.

OpenWA v0.20 API surface used (verified against its openapi.json):
  GET  /api/health                              -> {status: "ok", version}
  GET  /api/sessions                            -> [{id, name, status, ...}]
  POST /api/sessions                            -> create {name} (id = UUID)
  POST /api/sessions/{id}/start                 -> start session (QR login)
  GET  /api/sessions/{id}/status                -> {status} (SessionStatus)
  GET  /api/sessions/{id}/qr                    -> {qrCode, status}
  POST /api/sessions/{id}/messages/send-text    -> {chatId, text}
  GET  /api/sessions/{id}/messages              -> recent messages
  POST /api/sessions/{id}/webhooks              -> {url, events, secret}

OpenWA sends webhook signature as header:
  X-OpenWA-Signature: sha256=<hex HMAC-SHA256 over raw body>
"""
from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from .config import load_config
from .models import state

# OpenWA SessionStatus values that mean "paired and usable".
_PAIRED_STATUSES = {"ready"}
# Statuses where a QR (or pairing code) is being shown / about to be.
_QR_STATUSES = {"initializing", "qr_ready", "authenticating", "action_required", "disconnected"}


class OpenWAClient:
    """Thin async-friendly client: HTTP calls run in a thread (never block)."""

    def __init__(self) -> None:
        self._last_error = ""

    # ---- low-level ---------------------------------------------------------

    def _request(self, method: str, path: str, payload: Optional[dict] = None, timeout: Optional[float] = None) -> Optional[dict]:
        cfg = load_config()
        url = cfg.openwa_base_url.rstrip("/") + path
        headers = {"Content-Type": "application/json"}
        if cfg.openwa_api_key:
            headers["Authorization"] = f"Bearer {cfg.openwa_api_key}"
        body = json.dumps(payload).encode() if payload is not None else None
        last_err: Optional[Exception] = None
        for attempt in range(cfg.openwa_retries + 1):
            try:
                req = urllib.request.Request(url, data=body, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=timeout or cfg.openwa_timeout) as resp:
                    raw = resp.read()
                    if not raw:
                        return {}
                    return json.loads(raw)
            except urllib.error.HTTPError as e:
                last_err = e
                try:
                    detail = e.read().decode("utf-8", "replace")[:200]
                except Exception:
                    detail = ""
                if 400 <= e.code < 500:
                    break  # don't retry client errors
            except Exception as e:  # ConnectionRefused, timeout, etc.
                last_err = e
            if attempt < cfg.openwa_retries:
                time.sleep(0.4 * (attempt + 1))
        self._last_error = f"{last_err}" if last_err else "unknown"
        return None

    # ---- OpenWA API --------------------------------------------------------

    def health(self) -> Optional[dict]:
        return self._request("GET", "/api/health", timeout=3)

    def is_available(self) -> bool:
        h = self.health()
        ok = bool(h and h.get("status") in ("ok", "OK", True))
        state.openwa_connected = ok
        if not ok:
            state.last_error = self._last_error or "OpenWA unreachable"
        return ok

    def sessions(self) -> List[dict]:
        res = self._request("GET", "/api/sessions")
        if isinstance(res, dict):
            return res.get("sessions") or res.get("data") or []
        return res or []

    def create_session(self, name: str) -> Optional[dict]:
        """Create a session by name (id is a UUID). Fails if the name exists."""
        return self._request("POST", "/api/sessions", {"name": name})

    def _session_id(self) -> str:
        """Resolve the configured session: OPENWA_SESSION_ID may be either the
        session UUID or its name; otherwise find/create the 'tto-remote' session
        by name. Returns '' when OpenWA is unreachable / creation failed."""
        cfg = load_config()
        wanted = (cfg.openwa_session_id or "tto-remote").strip()
        for s in self.sessions():
            if s.get("id") == wanted or s.get("name") == wanted:
                return s["id"]
        # Not found — create it (idempotent-ish: create fails gracefully if a
        # concurrent create won the race with a 4xx, which we treat as missing).
        created = self.create_session(wanted)
        if created and created.get("id"):
            state.whatsapp_session = wanted
            return created["id"]
        # Try one more listing in case the create raced.
        for s in self.sessions():
            if s.get("name") == wanted:
                return s["id"]
        return ""

    def start_session(self, session_id: str = "") -> Optional[dict]:
        sid = session_id or self._session_id()
        if not sid:
            return None
        return self._request("POST", f"/api/sessions/{urllib.parse.quote(sid)}/start")

    def session_qr(self, session_id: str = "") -> Optional[dict]:
        sid = session_id or self._session_id()
        if not sid:
            return None
        return self._request("GET", f"/api/sessions/{urllib.parse.quote(sid)}/qr")

    def send_message(self, chat_id: str, text: str) -> bool:
        """Send a text message into the conversation `chat_id` via the real
        OpenWA endpoint POST /api/sessions/{id}/messages/send-text."""
        if not text or not chat_id:
            return False
        sid = self._session_id()
        if not sid:
            return False
        res = self._request("POST", f"/api/sessions/{urllib.parse.quote(sid)}/messages/send-text",
                            {"chatId": chat_id, "text": text})
        if res is None:
            return False
        if isinstance(res, dict) and res.get("ok") is False:
            return False
        return True

    def list_webhooks(self, session_id: str = "") -> List[dict]:
        """All webhooks registered on the session (idempotency support)."""
        sid = session_id or self._session_id()
        if not sid:
            return []
        res = self._request("GET", f"/api/sessions/{urllib.parse.quote(sid)}/webhooks")
        if isinstance(res, list):
            return res
        return res.get("webhooks") or [] if isinstance(res, dict) else []

    def register_webhook(self, webhook_url: str, events: Optional[List[str]] = None) -> Optional[dict]:
        """Register the TTO webhook on the session (POST /api/sessions/{id}/webhooks).
        The webhook secret is included so OpenWA signs deliveries with it.
        Idempotent: if a webhook with the same URL already exists it is
        returned instead of creating a duplicate.  Returns None on error."""
        cfg = load_config()
        sid = self._session_id()
        if not sid:
            return None
        for existing in self.list_webhooks(sid):
            if existing.get("url") == webhook_url and existing.get("active") is not False:
                return existing
        # message.received = messages INTO the account; message.sent = the
        # account's OWN outgoing sends (covers the "Message yourself"
        # self-chat, which OpenWA classifies as outgoing).  The webhook
        # handler filters message.sent to real commands so our own replies
        # never loop back.
        payload: Dict[str, Any] = {"url": webhook_url, "events": events or ["message.received", "message.sent"]}
        if cfg.webhook_secret:
            payload["secret"] = cfg.webhook_secret
        res = self._request("POST", f"/api/sessions/{urllib.parse.quote(sid)}/webhooks", payload)
        if not isinstance(res, dict) or res.get("statusCode"):
            return None  # error payload — never report a failed register as success
        return res

    def delete_webhook(self, webhook_id: str) -> bool:
        sid = self._session_id()
        if not sid:
            return False
        res = self._request("DELETE", f"/api/sessions/{urllib.parse.quote(sid)}/webhooks/{urllib.parse.quote(webhook_id)}")
        return res is not None

    # ---- TTO account profile (the WhatsApp "bot" identity) ------------------

    def set_profile_name(self, name: str, session_id: str = "") -> bool:
        """Set the session account's display name (WhatsApp limit: 25 chars).
        Only meaningful on a DEDICATED TTO number — setting it on the user's
        main account would rename their own profile everywhere."""
        sid = session_id or self._session_id()
        if not sid:
            return False
        res = self._request("PUT", f"/api/sessions/{urllib.parse.quote(sid)}/profile/name",
                            {"name": name[:25]})
        return res is not None

    def set_profile_picture(self, base64_image: str, mimetype: str = "image/png", session_id: str = "") -> bool:
        """Set the session account's profile picture from base64 image data."""
        sid = session_id or self._session_id()
        if not sid:
            return False
        res = self._request("PUT", f"/api/sessions/{urllib.parse.quote(sid)}/profile/picture",
                            {"base64": base64_image, "mimetype": mimetype})
        return res is not None

    def list_webhooks(self) -> List[dict]:
        sid = self._session_id()
        if not sid:
            return []
        res = self._request("GET", f"/api/sessions/{urllib.parse.quote(sid)}/webhooks")
        if isinstance(res, dict):
            return res.get("webhooks") or res.get("data") or []
        return res or []

    def recent_messages(self, limit: int = 10) -> List[dict]:
        sid = self._session_id()
        if not sid:
            return []
        res = self._request("GET", f"/api/sessions/{urllib.parse.quote(sid)}/messages?limit={limit}")
        if isinstance(res, dict):
            return res.get("messages") or res.get("data") or []
        return res or []

    # ---- helpers -----------------------------------------------------------

    def qr_base64(self, session_id: str = "") -> Optional[str]:
        """Return the QR as a data-URL (for the desktop UI) or None."""
        res = self.session_qr(session_id)
        if not res:
            return None
        if isinstance(res, dict):
            img = res.get("qrCode") or res.get("qr") or res.get("image")
            if isinstance(img, str) and img.startswith("data:"):
                return img
            if isinstance(img, str):
                try:
                    return "data:image/png;base64," + base64.b64encode(base64.b64decode(img)).decode()
                except Exception:
                    return "data:image/png;base64," + img
        return None

    def session_status(self, session_id: str = "") -> Dict[str, Any]:
        """Query the session status and fold it into TTO's state (paired /
        qr_available). Source of truth is GET /api/sessions (the session
        entity carries `status`); the `GET .../status` route is WhatsApp
        stories, not session state, so it is deliberately not used.

        STICKY on failure: when OpenWA is unreachable or throttling (429) no
        valid status is returned, so the last known paired/qr state is kept
        instead of flickering to False."""
        cfg = load_config()
        sid = session_id or self._session_id()
        name = cfg.openwa_session_id or "tto-remote"
        state.whatsapp_session = name
        status = ""
        if sid:
            for s in self.sessions():
                if s.get("id") == sid:
                    status = str(s.get("status") or "")
                    break
        if status:
            state.last_status = status
            state.paired = status in _PAIRED_STATUSES
            state.qr_available = status in _QR_STATUSES
            if state.paired:
                state.last_error = ""
        return {"session_id": name, "status": state.last_status or "unknown",
                "paired": state.paired, "qr_available": state.qr_available}


client = OpenWAClient()
