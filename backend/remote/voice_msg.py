"""T2 Voice → local Whisper → session task (buttons-first, zero slash typing).

A Discord voice-message is a small .ogg attachment (opus). We transcribe it
LOCALLY with faster-whisper (installed: 1.2.1, ffmpeg present) and push the
text into the currently-docked agent session — the same dispatch bus the
panel buttons use. No cloud, no keys, no slash typing.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile

log = logging.getLogger("remote.voice")

_whisper_model = None  # lazy: model loaded on first voice message
_bridge: dict = {}     # populated by install_listener()


def _b(name: str):
    """Fetch a bridge callable by name."""
    fn = _bridge.get(name) if isinstance(_bridge, dict) else getattr(_bridge, name, None)
    return fn


def _model():
    """Lazily load the small local Whisper model once."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        log.info("T2: loading Whisper small model (first voice message)...")
        _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
        log.info("T2: Whisper model loaded")
    return _whisper_model


def _transcribe_ogg(data: bytes) -> str:
    """Transcribe opus(.ogg) bytes with local Whisper → plain text."""
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=".ogg")
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        model = _model()
        segments, _ = model.transcribe(tmp, language=None, vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip()
    finally:
        if tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass


def _get_docked_session(chat_id: str):
    """Find the most recent session in the docked workspace for this chat."""
    get_ws = _b("agent_get_chat_ws")
    if not get_ws:
        return None
    ws_name = get_ws(chat_id)
    if not ws_name:
        # fallback: try global workspace
        ws_fn = _b("agent_current_ws")
        ws_name = ws_fn() if ws_fn else None
    if not ws_name:
        return None
    # Resolve workspace to get path
    resolve_ws = _b("agent_resolve_workspace")
    ws = resolve_ws(ws_name) if resolve_ws else None
    ws_path = (ws.get("projectPath") or "").rstrip("/") if ws else ""
    # List sessions and find one in this workspace
    sess_fn = _b("agent_sessions")
    if not sess_fn:
        return None
    try:
        import asyncio as _a
        # sess_fn may be async or sync
        if _a.iscoroutinefunction(sess_fn):
            result = _a.get_event_loop().run_until_complete(sess_fn())
        else:
            result = sess_fn()
    except Exception:
        return None
    if not result.get("ok"):
        return None
    sessions = result.get("sessions", [])
    # Filter to workspace
    scoped = [
        s for s in sessions
        if ws_path and (s.get("cwd") or "").rstrip("/").startswith(ws_path)
    ] or sessions
    # Pick the most recent session
    if not scoped:
        return None
    # Prefer running, then most recently updated
    for s in scoped:
        if (s.get("status") or "").lower() in ("running", "streaming"):
            return s.get("id")
    # fallback: first session (most recent)
    return scoped[0].get("id") if scoped else None


# ── wiring contract exposed so create_bot() can register this in on_message ──
def install_listener(bot, bridge: dict) -> None:
    """Wire the voice→text handler via bot.add_listener()."""
    global _bridge
    _bridge = bridge

    @bot.listen("on_message")
    async def on_voice_message(message):
        # Ignore bot's own messages
        if message.author.bot:
            return
        # Only flat audio (Discord voice messages arrive as .ogg attachments)
        att = None
        for a in (message.attachments or []):
            if (a.filename or "").lower().endswith((".ogg", ".opus", ".mp3", ".wav", ".m4a")) or \
               (a.content_type or "").startswith("audio/"):
                att = a
                break
        if att is None:
            return

        # React so user knows we're processing
        try:
            await message.add_reaction("🎙️")
        except Exception:
            pass

        # Pull the audio bytes locally (never leaves the machine)
        try:
            raw = await att.read()
        except Exception as e:
            log.warning("T2 voice read failed: %s", e)
            await message.channel.send("❌ Couldn't read that voice file — try again?")
            return

        # Transcribe (CPU-bound → run in thread)
        try:
            text = await asyncio.to_thread(_transcribe_ogg, raw)
        except Exception as e:
            log.warning("T2 transcribe failed: %s", e)
            await message.channel.send(f"❌ Transcription failed: {e}")
            return

        if not text:
            await message.channel.send("🤔 I couldn't hear anything in that voice message — try speaking closer to the mic?")
            return

        # ── INTENT PARSER: voice text → action → real result ──
        chat_id = str(message.author.id)
        text_lower = text.lower().strip()
        result_msg = ""

        # 1. CREATE WORKSPACE: "create workspace/workspace called X"
        m_create_ws = re.search(r'(?:create|make|new)\s+(?:a\s+)?(?:workspace|ws)\s+(?:called|named|named)\s+(.+?)(?:\.|$)', text_lower)
        if not m_create_ws:
            m_create_ws = re.search(r'(?:create|make|new)\s+(?:a\s+)?(?:workspace|ws)\s+(.+?)(?:\.|$)', text_lower)
        if m_create_ws:
            ws_name = m_create_ws.group(1).strip().strip('"').strip("'")
            try:
                create_ws = _b("create_workspace")
                if create_ws:
                    result = create_ws(ws_name)
                    result_msg = f"✅ Created workspace **{ws_name}**" if result.get("ok") else f"❌ Failed: {result.get('error', 'unknown')}"
                else:
                    # Fallback: use the opencode API directly
                    result_msg = f"🎙️ Heard: **{text}**\n💡 Workspace creation not yet wired in bridge."
            except Exception as e:
                result_msg = f"❌ Error creating workspace: {e}"
            await message.channel.send(f"🎙️ Heard: **{text}**\n{result_msg}")
            return

        # 2. CREATE SESSION: "create session/session called X"
        m_new_session = re.search(r'(?:create|make|new)\s+(?:a\s+)?(?:session|session)\s+(?:called|named|named)\s+(.+?)(?:\.|$)', text_lower)
        if not m_new_session:
            m_new_session = re.search(r'(?:create|make|new)\s+(?:a\s+)?(?:session)\s+(.+?)(?:\.|$)', text_lower)
        if m_new_session:
            sess_name = m_new_session.group(1).strip().strip('"').strip("'")
            # Voice gives ONE name → bridge it directly to the opencode session
            # sidecar (:4097) the TTO web UI reads — NO arity mismatch possible.
            try:
                ws_dir = _resolve_default_ws_dir()
                if not ws_dir:
                    result_msg = f"❌ No workspace yet — say *\"create workspace called X\"* first."
                else:
                    result = _create_session_on_sidecar(ws_dir, sess_name)
                    if result.get("ok"):
                        result_msg = f"✅ Session **#{sess_name}** created (id: `{result.get('short_id','?')}` · in *{result.get('ws_name','?')}*)"
                    else:
                        result_msg = f"❌ Failed: {result.get('error','unknown')}"
            except Exception as e:
                result_msg = f"❌ Session creation error: {e}"
            await message.channel.send(f"🎙️ Heard: **{text}**\n{result_msg}")
            return

        # 3. DISPATCH TASK: "dispatch/task/go/send task to X: Y" or just free text
        m_dispatch = re.search(r'(?:dispatch|send|run|go|execute|task)\s+(?:to\s+)?(\w+)\s*(?::|say|with|that|that)\s*(.+?)(?:\.|$)', text_lower)
        if m_dispatch:
            session = m_dispatch.group(1)
            task_text = m_dispatch.group(2).strip().strip('"').strip("'")
            try:
                resolve_fn = _b("resolve_session")
                send_fn = _b("send_agent_task")
                if resolve_fn and send_fn:
                    resolved = resolve_fn(chat_id, session)
                    result = await send_fn(resolved.get("real", ""), task_text)
                    if result.get("ok"):
                        result_msg = f"✅ Task dispatched to session **{session}**"
                    else:
                        result_msg = f"❌ Dispatch failed: {result.get('error', 'unknown')}"
                else:
                    result_msg = f"🎙️ Heard: **{text}**\n💡 Dispatch not yet wired in bridge."
            except Exception as e:
                result_msg = f"❌ Dispatch error: {e}"
            await message.channel.send(f"🎙️ Heard: **{text}**\n{result_msg}")
            return

        # 4. ABORT: "abort X"
        m_abort = re.search(r'(?:abort|stop|cancel|kill)\s+(.+?)(?:\.|$)', text_lower)
        if m_abort:
            session = m_abort.group(1).strip().strip('"').strip("'")
            try:
                resolve_fn = _b("resolve_session")
                abort_fn = _b("agent_abort")
                if resolve_fn and abort_fn:
                    resolved = resolve_fn(chat_id, session)
                    result = abort_fn(resolved.get("real", ""))
                    result_msg = f"🛑 Aborted session **{session}**" if result.get("ok") else f"❌ Abort failed: {result.get('error', 'unknown')}"
                else:
                    result_msg = f"🎙️ Heard: **{text}**\n💡 Abort not yet wired in bridge."
            except Exception as e:
                result_msg = f"❌ Abort error: {e}"
            await message.channel.send(f"🎙️ Heard: **{text}**\n{result_msg}")
            return

        # 5. FALLBACK: dispatch to active session if one exists
        real_id = await asyncio.to_thread(_get_docked_session, chat_id)
        if real_id:
            send_fn = _b("send_agent_task")
            if send_fn:
                try:
                    result = await send_fn(real_id, f"[voice] {text}")
                    if result.get("ok"):
                        await message.channel.send(
                            f"🎙️ Heard: **{text}**\n→ dispatched to agent session"
                        )
                    else:
                        await message.channel.send(
                            f"🎙️ Heard: **{text}**\n❌ Dispatch failed: {result.get('error', 'unknown')}"
                        )
                    return
                except Exception as e:
                    log.warning("T2 dispatch failed: %s", e)
                    await message.channel.send(
                        f"🎙️ Heard: **{text}**\n❌ Dispatch error: {e}"
                    )
                    return

        # 6. FINAL FALLBACK: no session, no matching intent
        await message.channel.send(
            f"🎙️ Heard: **{text}**\n💡 Say:\n• *\"create workspace called X\"*\n• *\"create session called X\"*\n• *\"dispatch to X: do Y\"*\n• *\"abort X\"*\n"
        )
