"""TTO Remote Control — FastAPI router.

Mounts under /api/remote and exposes:

  POST /api/remote/whatsapp/webhook   — OpenWA incoming-message webhook
  GET  /api/remote/status             — status payload for the desktop UI
  POST /api/remote/test               — test the OpenWA connection
  POST /api/remote/refresh            — re-check OpenWA + WhatsApp session
  GET  /api/remote/health             — remote subsystem health
  GET  /api/remote/qr                 — QR data-URL when pairing is needed
  POST /api/remote/notify             — internal: push a proactive notification

Webhook flow: secret check → allowlist → idempotency → parse → dispatch →
reply via OpenWA.  Every failure is caught; a malformed webhook never raises.
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import service
from .auth import is_authorized_sender, rate_limit_exceeded, verify_webhook_secret
from .config import load_config, redact_secrets
from .models import WebhookEvent, state
from .openwa_client import client as openwa
from .parser import parse_message

router = APIRouter(prefix="/api/remote", tags=["remote"])


def _extract_event(payload: Dict[str, Any]) -> Optional[WebhookEvent]:
    """Normalize OpenWA's webhook payload into a WebhookEvent.

    OpenWA v0.20 delivers (verified against its source):
      {"event": "message.received", "timestamp": ISO,
       "sessionId": uuid, "idempotencyKey": ..., "deliveryId": ...,
       "data": {"id", "from", "author"?, "chatId", "body", "type",
                "timestamp", "fromMe", "isGroup", "contact"?, ...}}

    The `type` field is the message kind mapped by the engine ("chat" for
    plain text, "image"/"video"/... for media).  Legacy/flat shapes are still
    accepted for robustness.
    """
    data = payload.get("data")
    if isinstance(data, dict):
        sender = str(data.get("author") or data.get("from") or "")
        chat_id = str(data.get("chatId") or data.get("chat_id") or data.get("chat") or sender)
        msg_type = str(data.get("type") or payload.get("event") or "chat")
        if msg_type.startswith("message."):
            msg_type = msg_type[len("message."):]
        ts = data.get("timestamp") or payload.get("timestamp") or time.time()
        try:
            ts = float(ts)
        except (TypeError, ValueError):
            ts = time.time()
        return WebhookEvent(
            sender=sender,
            chat_id=chat_id,
            message_id=str(data.get("id") or ""),
            message_type=msg_type,
            body=str(data.get("body") or data.get("text") or ""),
            timestamp=ts,
            event=str(payload.get("event") or "message.received"),
            from_me=bool(data.get("fromMe")),
            raw=payload,
        )
    msg = payload.get("message") or {}
    if isinstance(msg, dict) and "text" in msg and "id" in msg:
        return WebhookEvent(
            sender=str(msg.get("sender") or msg.get("from") or msg.get("author") or ""),
            chat_id=str(msg.get("chat_id") or msg.get("chat") or ""),
            message_id=str(msg.get("id") or payload.get("message_id") or ""),
            message_type=str(msg.get("type") or payload.get("type") or "text"),
            body=str(msg.get("text") or msg.get("body") or ""),
            timestamp=float(msg.get("timestamp") or payload.get("timestamp") or time.time()),
            raw=payload,
        )
    # Flat shape.
    ev = WebhookEvent(
        sender=str(payload.get("sender") or payload.get("from") or ""),
        chat_id=str(payload.get("chat_id") or payload.get("chat") or ""),
        message_id=str(payload.get("message_id") or payload.get("id") or ""),
        message_type=str(payload.get("type") or payload.get("message_type") or "text"),
        body=str(payload.get("body") or payload.get("text") or ""),
        timestamp=float(payload.get("timestamp") or time.time()),
        raw=payload,
    )
    if ev.sender or ev.chat_id or ev.body:
        return ev
    return None


def _is_explicit_command(body: str) -> bool:
    """Loop guard for message.sent: only EXPLICIT commands (leading "/") or
    CONFIRM/CANCEL replies are ever acted on.  TTO's own replies never start
    with "/", so a reply containing a keyword (e.g. "TOKEN USAGE") can never
    re-trigger a command and loop forever."""
    body = (body or "").strip()
    if body.startswith("/"):
        return True
    return bool(re.match(r"^(?:CONFIRM|CANCEL)\b", body, re.I))


def _is_self_chat_send(data: Dict[str, Any]) -> bool:
    """True when an outgoing (message.sent) message is the account messaging
    ITSELF — the WhatsApp "Message yourself" chat.  WhatsApp addresses the
    account's own chat by its privacy LID (e.g. 218068491980857@lid), so the
    sender may be an LID that is NOT the phone number in the allowlist.

    Self-chat sends have from == to == chatId (all the account's own
    identity); a send into a friend's chat has to/chatId = the friend's JID.
    Returns False for anything that is not clearly self-addressed, so a stray
    command typed into a friend chat can never be acted on."""
    if not isinstance(data, dict):
        return False
    f = str(data.get("from") or "")
    t = str(data.get("to") or "")
    c = str(data.get("chatId") or data.get("chat") or "")
    if not f or not t:
        return False

    def norm(x: str) -> str:
        return x.split("@")[0]

    if norm(f) != norm(t):
        return False
    if c and norm(c) not in (norm(f), norm(t)):
        return False
    return True


def _reply_chat(ev: WebhookEvent, text: str) -> None:
    """Send the reply back through OpenWA (fire-and-forget on the running
    loop so the webhook response never blocks on the local HTTP call)."""
    import asyncio
    target = ev.chat_id or ev.sender
    if not target:
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(asyncio.to_thread(openwa.send_message, target, text))
    except Exception:
        pass


@router.post("/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    # Defense in depth: the router is mounted even when remote is disabled, so
    # refuse webhook delivery outright unless the subsystem is turned on.
    if not load_config().enabled:
        return JSONResponse({"ok": False, "error": "remote disabled"}, status_code=403)
    body_bytes = await request.body()
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "malformed json"}, status_code=400)

    # 1. Webhook secret / signature. OpenWA signs deliveries with
    #    `X-OpenWA-Signature: sha256=<hex HMAC over raw body>`; we also accept
    #    a plain `X-Webhook-Secret` for simpler setups.
    secret = (
        request.headers.get("X-OpenWA-Signature")
        or request.headers.get("X-Webhook-Secret")
        or request.headers.get("X-Webhook-Signature")
    )
    ok, err = verify_webhook_secret(secret, body_bytes)
    if not ok:
        state.last_error = err
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=403)

    # 2. Normalize the event.
    ev = _extract_event(payload)
    if not ev:
        return JSONResponse({"ok": False, "error": "no message"}, status_code=400)

    # 3. Only text messages are handled (ignore others safely).
    if ev.message_type != "text" and ev.message_type not in ("", "chat"):
        return JSONResponse({"ok": True, "ignored": ev.message_type})

    # 3b. message.sent = the account's OWN outgoing messages. Two sources:
    #   1. The user's "Message yourself" self-chat sends (what we want).
    #   2. TTO's own replies (outgoing sends) — MUST be ignored, or a reply
    #      containing a keyword (e.g. "TOKEN USAGE" contains "token") would
    #      re-trigger a command and loop forever.
    #
    # Loop-proof rule: message.sent is ONLY acted on when the body is an
    # EXPLICIT command (leading "/") or CONFIRM/CANCEL.  TTO's replies never
    # start with "/", so they can never re-enter the pipeline.  Natural
    # language is NOT mapped for outgoing sends — only for genuine incoming
    # messages where there is no self-reply to confuse.
    sent_self_chat = False
    if ev.event == "message.sent":
        if not ev.from_me:
            return JSONResponse({"ok": True, "ignored": "sent.not-from-me"})
        if not _is_explicit_command(ev.body):
            return JSONResponse({"ok": True, "ignored": "sent.not-a-command"})
        probe = parse_message(ev.body)
        if not probe.name:
            return JSONResponse({"ok": True, "ignored": "sent.not-a-command"})
        sent_self_chat = _is_self_chat_send(payload.get("data") or {})

    # 4. Sender allowlist.
    if ev.event == "message.sent":
        # The owner's self-chat send is authorized even though the sender is
        # the account's own LID (not the phone in the allowlist).  A command
        # typed into a FRIEND's chat is NOT the self-chat — never acted on.
        if not (sent_self_chat or is_authorized_sender(ev.sender, ev.chat_id)):
            return JSONResponse({"ok": True, "ignored": "sent.sender-not-allowed"})
    elif not is_authorized_sender(ev.sender, ev.chat_id):
        state.last_error = f"unauthorized sender {ev.sender}"
        return JSONResponse({"ok": False, "error": "sender not allowed"}, status_code=403)

    # 5. Idempotency — ignore already-processed message ids (OpenWA retries).
    if ev.message_id:
        now = time.time()
        state.processed_message_ids = {k: v for k, v in state.processed_message_ids.items() if now - v < 3600}
        if ev.message_id in state.processed_message_ids:
            return JSONResponse({"ok": True, "duplicate": True})
        state.processed_message_ids[ev.message_id] = now

    # 6. Rate limiting.
    if rate_limit_exceeded(ev.sender):
        _reply_chat(ev, "⏳ Too many commands — please wait a moment.")
        return JSONResponse({"ok": False, "error": "rate limited"}, status_code=429)

    # 7. Parse + dispatch.
    cmd = parse_message(ev.body)
    result = await service.dispatch(ev.sender, ev.chat_id, cmd)
    reply = result.reply
    if result.requires_confirmation:
        reply = result.reply  # already the confirmation message
    _reply_chat(ev, reply)
    return JSONResponse({"ok": True, "command": cmd.name, "confirmation": result.requires_confirmation})


_status_probe_at = 0.0  # last OpenWA probe timestamp (rate-limit friendliness)

@router.get("/status")
async def remote_status():
    cfg = load_config()
    if not cfg.enabled:
        return JSONResponse({"enabled": False, "openwa_connected": False, "config": cfg.redacted()})
    # Probe OpenWA at most every 30 s — the UI polls this endpoint constantly
    # and OpenWA throttles (10 req/s, 100 req/min).  Between probes we serve
    # the loop-refreshed state; session_status is STICKY so a throttled probe
    # never flickers paired to False.
    global _status_probe_at
    now = time.time()
    if now - _status_probe_at >= 30.0:
        _status_probe_at = now
        openwa.is_available()
        openwa.session_status()
    return JSONResponse(state.status_payload())


@router.get("/health")
async def remote_health():
    cfg = load_config()
    return JSONResponse({
        "enabled": cfg.enabled,
        "openwa_available": openwa.is_available() if cfg.enabled else False,
        "whatsapp_session": state.whatsapp_session,
        "paired": state.paired,
    })


@router.post("/test")
async def remote_test():
    cfg = load_config()
    if not cfg.enabled:
        return JSONResponse({"ok": False, "error": "remote disabled"}, status_code=400)
    import asyncio
    loop = asyncio.get_event_loop()

    def _do() -> dict:
        available = openwa.is_available()
        status = openwa.session_status() if available else {}
        return {
            "ok": available,
            "openwa_connected": available,
            "whatsapp": status,
            "message": "✅ OpenWA reachable" if available else f"❌ OpenWA unreachable: {openwa._last_error}",
        }

    try:
        return JSONResponse(await loop.run_in_executor(None, _do))
    except Exception:
        return JSONResponse({"ok": False, "message": "test failed"}, status_code=500)


@router.post("/profile")
async def remote_profile(name: str = "", picture_path: str = ""):
    """Set the TTO WhatsApp account's profile (name + picture). Intended for a
    DEDICATED TTO number — never run this on the user's main account.
    `picture_path` is a local image file read server-side (e.g. the app icon)."""
    cfg = load_config()
    if not cfg.enabled:
        return JSONResponse({"ok": False, "error": "remote disabled"}, status_code=400)
    import asyncio, base64, os
    loop = asyncio.get_event_loop()

    def _do() -> dict:
        result = {"ok": True}
        if name:
            result["name"] = openwa.set_profile_name(name)
        if picture_path:
            try:
                with open(picture_path, "rb") as f:
                    data = f.read()
                if not data:
                    return {"ok": False, "error": "empty picture file"}
                ext = os.path.splitext(picture_path)[1].lower()
                mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(ext, "image/png")
                result["picture"] = openwa.set_profile_picture(base64.b64encode(data).decode(), mime)
            except Exception as e:
                return {"ok": False, "error": f"picture failed: {e}"}
        return result

    try:
        return JSONResponse(await loop.run_in_executor(None, _do))
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/refresh")
async def remote_refresh():
    openwa.is_available()
    openwa.session_status()
    return JSONResponse(state.status_payload())


@router.post("/connect")
async def remote_connect():
    """One-shot pairing helper: ensure the session exists, start it (QR login),
    register the webhook, and return the QR data-URL. Safe to call repeatedly."""
    cfg = load_config()
    if not cfg.enabled:
        return JSONResponse({"ok": False, "error": "remote disabled"}, status_code=400)
    import asyncio
    loop = asyncio.get_event_loop()

    def _do() -> dict:
        if not openwa.is_available():
            return {"ok": False, "error": f"OpenWA unreachable: {openwa._last_error}"}
        openwa.start_session()          # ensure + start (QR login)
        webhook = openwa.register_webhook("http://127.0.0.1:8765/api/remote/whatsapp/webhook")
        qr = openwa.qr_base64()
        return {
            "ok": bool(qr),
            "qr": qr or None,
            "webhook": bool(webhook),
            "webhook_error": "" if webhook else (openwa._last_error or "unknown"),
            "session": state.whatsapp_session,
        }

    try:
        return JSONResponse(await loop.run_in_executor(None, _do))
    except Exception as e:  # pragma: no cover
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/qr")
async def remote_qr():
    cfg = load_config()
    if not cfg.enabled:
        return JSONResponse({"ok": False, "error": "remote disabled"}, status_code=400)
    import asyncio
    loop = asyncio.get_event_loop()

    def _do() -> dict:
        openwa.start_session()  # ensure the session exists + QR login started
        qr = openwa.qr_base64()
        return {"ok": bool(qr), "qr": qr or None}

    try:
        return JSONResponse(await loop.run_in_executor(None, _do))
    except Exception:
        return JSONResponse({"ok": False, "qr": None})


@router.post("/notify")
async def notify(chat_id: str = "", text: str = ""):
    """Internal: push a proactive notification to a configured chat."""
    cfg = load_config()
    if not cfg.enabled or not chat_id:
        return JSONResponse({"ok": False}, status_code=400)
    sent = openwa.send_message(chat_id, text)
    return JSONResponse({"ok": sent})


# Webhook URL the user must register in OpenWA (display helper).
def webhook_url() -> str:
    return "/api/remote/whatsapp/webhook"
