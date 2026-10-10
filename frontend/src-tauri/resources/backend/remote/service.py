"""TTO Remote Control — command service.

Executes parsed commands against the EXISTING TTO APIs via a thin `bridge`
that main.py registers (so the remote package stays independent + testable and
never duplicates terminal/task logic).  WhatsApp is a thin remote-control
interface — all real work happens through bridge calls that main.py implements
with the existing pipelines.
"""
from __future__ import annotations

import re
import time
from typing import Any, Callable, Dict, List, Optional

from . import formatter
from .confirmations import cancel_for, consume_confirmation, create_confirmation, resolve_confirmation
from .models import AuditEntry, CommandResult, ParsedCommand, log_audit, state
from .parser import usage_error_message, usage_hint_for
from .safety import SafetyLevel, classify_shell, is_read_only_path

# The bridge is a plain object with callables, registered by main.py:
#   bridge.get_terminals()            -> List[dict]
#   bridge.resolve_terminal(arg)      -> Optional[dict]  (id/tty/session -> entry)
#   bridge.send_input(tty, text)      -> bool
#   bridge.raw_input(tty, data)       -> bool
#   bridge.stop_terminal(tty)         -> bool   (Ctrl+C / interrupt)
#   bridge.restart_terminal(tty)      -> bool
#   bridge.close_terminal(tty)        -> bool
#   bridge.add_task(tty, desc, model) -> Optional[dict]
#   bridge.complete_task(tty, tid)    -> bool
#   bridge.pause_terminal(tty)        -> bool
#   bridge.resume_terminal(tty)       -> bool
#   bridge.get_tasks(tty)             -> dict (current/next/queue/history)
#   bridge.get_logs(tty, lines)       -> str
#   bridge.get_token_usage()          -> dict
#   bridge.list_files(path)           -> dict {path, files[]}
#   bridge.get_workspaces()           -> List[dict]
#   bridge.get_overall()              -> dict (terminals + token_usage)
#   bridge.agent_state()              -> (sidecar_ok, rust_ok)
#   bridge.rust_available()           -> bool
bridge: Any = None


def register(b: Any) -> None:
    global bridge
    bridge = b


def _audit(sender: str, cmd: ParsedCommand, result: CommandResult, target: str = "", confirmation: str = "") -> None:
    entry = AuditEntry(
        sender=sender,
        command=f"/{cmd.name}" + (" " + cmd.raw if cmd.raw else ""),
        terminal=target,
        result=result.reply[:120],
        success=result.ok,
        confirmation=confirmation,
        duration_ms=result.duration_ms,
    )
    log_audit(entry)


async def dispatch(sender: str, chat_id: str, cmd: ParsedCommand) -> CommandResult:
    """Execute a parsed command for an authorized sender."""
    if bridge is None:
        return CommandResult(ok=False, reply="Remote service not initialized.")
    t0 = time.time()

    if not cmd.name:
        return _finish(sender, cmd, CommandResult(
            ok=False,
            reply="❌ Unknown command. " + usage_error_message(),
        ), t0)
    if cmd.name == "usage_error":
        hint = usage_hint_for(cmd.usage_for)
        if hint:
            reply = f"❌ /{cmd.usage_for} is missing something.\n\nCorrect usage:\n{hint}\n\nFull list: /help"
        else:
            reply = "❌ " + usage_error_message()
        return _finish(sender, cmd, CommandResult(ok=False, reply=reply), t0)

    # ── dangerous commands require confirmation ───────────────────────────
    if cmd.name in ("pause", "resume", "restart", "stop", "kill", "shutdown"):
        return await _dangerous_flow(sender, cmd, t0)

    # ── confirm / cancel ──────────────────────────────────────────────────
    if cmd.name == "confirm":
        return await _do_confirm(sender, cmd, t0)
    if cmd.name == "cancel":
        n = cancel_for(sender)
        return _finish(sender, cmd, CommandResult(ok=True, reply=f"Cancelled {n} pending confirmation(s)."), t0)

    # ── read commands ─────────────────────────────────────────────────────
    try:
        result = await _execute_read_write(sender, cmd)
    except Exception as e:  # never let one command crash the loop
        result = CommandResult(ok=False, reply=f"❌ Command failed: {e}")
    return _finish(sender, cmd, result, t0)


def _finish(sender: str, cmd: ParsedCommand, result: CommandResult, t0: float) -> CommandResult:
    result.duration_ms = round((time.time() - t0) * 1000, 1)
    if result.ok or result.requires_confirmation:
        state.note_command(f"/{cmd.name} " + cmd.raw)
    _audit(sender, cmd, result, confirmation=result.confirmation_token or ("requested" if result.requires_confirmation else ""))
    return result


async def _dangerous_flow(sender: str, cmd: ParsedCommand, t0: float) -> CommandResult:
    """Create a confirmation for the dangerous action and return instructions."""
    # shutdown has no target.
    if cmd.name == "shutdown":
        details = "Shut down the TTO backend service?"
        conf = create_confirmation(sender, "shutdown", "", details)
        return CommandResult(
            ok=False, requires_confirmation=True,
            confirmation_token=conf.token,
            reply=formatter.confirmation_message(conf.token, "shutdown", "", details, int(conf.expires_at - conf.created_at)),
        )
    entry = _resolve(cmd.args[0] if cmd.args else "")
    if not entry:
        return _finish(sender, cmd, CommandResult(ok=False, reply=f"❌ Terminal #{cmd.args[0] if cmd.args else '?'} does not exist."), t0)
    target = entry["tty"]
    label = entry.get("label") or target
    details = (
        f"Agent: {entry.get('agent') or 'shell'}\n"
        f"Task: {((entry.get('current_task') or {}).get('description') or '—')[:60]}\n"
        + (f"Runtime: {formatter._age(time.time() - (entry.get('current_task') or {}).get('started_at', time.time()))}\n" if entry.get("current_task") else "")
    )
    conf = create_confirmation(sender, cmd.name, target, details)
    return CommandResult(
        ok=False, requires_confirmation=True,
        confirmation_token=conf.token,
        reply=formatter.confirmation_message(conf.token, cmd.name, label, details, int(conf.expires_at - conf.created_at)),
    )


async def _do_confirm(sender: str, cmd: ParsedCommand, t0: float) -> CommandResult:
    token = cmd.args[0]
    conf = resolve_confirmation(sender, token)
    if not conf:
        return _finish(sender, cmd, CommandResult(ok=False, reply="❌ Invalid or expired confirmation token."), t0)
    consume_confirmation(token)
    action = conf.command
    target = conf.target

    if action == "shutdown":
        await shutdown_backend()
        return _finish(sender, cmd, CommandResult(ok=True, reply="🛑 TTO backend shutting down."), t0)

    fn = _b("resolve_terminal")
    entry = (fn(target) if fn else None) or ({"tty": target} if target else None)
    if not entry:
        return _finish(sender, cmd, CommandResult(ok=False, reply=f"❌ Terminal #{target} no longer exists."), t0)
    tty = entry["tty"]

    ok = False
    msg = ""
    if action == "restart":
        ok = bool(await _b("restart_terminal")(tty))
        msg = "♻️ Terminal restarted." if ok else "❌ Could not restart terminal."
    elif action == "stop":
        ok = bool(await _b("stop_terminal")(tty))
        msg = "⏹️ Stop signal sent to terminal." if ok else "❌ Could not send stop signal."
    elif action == "kill":
        ok = bool(await _b("close_terminal")(tty))
        msg = "💀 Terminal closed." if ok else "❌ Could not close terminal."
    elif action == "pause":
        ok = bool(await _b("pause_terminal")(tty))
        msg = "⏸️ Terminal paused — queued tasks will not auto-start." if ok else "❌ Could not pause terminal."
    elif action == "resume":
        ok = bool(await _b("resume_terminal")(tty))
        msg = "▶️ Terminal resumed." if ok else "❌ Could not resume terminal."
    elif action == "run":
        # Dangerous shell command that was confirmed — re-classify as a guard
        # (confirmation does not bypass the safety policy).
        text = conf.details.split("Command: ", 1)[-1].split("\n")[0].strip()
        level = classify_shell(text)
        if level == SafetyLevel.BLOCKED:
            msg = f"⛔ {text[:80]} is still blocked."
        else:
            ok = bool(await _b("send_input")(tty, text))
            msg = f"✅ Sent to terminal #{entry.get('index', 0)}:\n{text[:120]}" if ok else "❌ Could not send input."
    else:
        msg = f"❌ Unknown confirmed action: {action}"
    return _finish(sender, cmd, CommandResult(ok=ok, reply=msg), t0)


def _b(name: str):
    """Fetch a bridge callable (the bridge is a dict registered by main.py)."""
    if bridge is None:
        return None
    fn = bridge.get(name) if isinstance(bridge, dict) else getattr(bridge, name, None)
    return fn


def _resolve(arg: str) -> Optional[dict]:
    fn = _b("resolve_terminal")
    return fn(arg) if fn else None


async def shutdown_backend() -> None:
    """Confirmed /shutdown — graceful SIGTERM of the sidecar process."""
    import asyncio
    import os
    import signal
    try:
        loop = asyncio.get_running_loop()
        loop.call_later(0.5, lambda: os.kill(os.getpid(), signal.SIGTERM))
    except Exception:
        pass


async def _execute_read_write(sender: str, cmd: ParsedCommand) -> CommandResult:
    name = cmd.name

    if name == "help":
        return CommandResult(ok=True, reply=formatter.help_message())

    if name == "health":
        sidecar_ok, rust_ok = _b("agent_state")()
        return CommandResult(ok=True, reply=(
            f"🟢 TTO health\nSidecar: {'🟢' if sidecar_ok else '🔴'}\n"
            f"Rust engine: {'🟢' if rust_ok else '🔴'}\n"
            f"WhatsApp: {'🟢' if state.openwa_connected else '🔴'}"
        ))

    if name == "status":
        overall = _b("get_overall")()
        sidecar_ok, rust_ok = _b("agent_state")()
        reply = formatter.status_message(overall, sidecar_ok, rust_ok, state.openwa_connected)
        try:
            from . import sleep as _sleep_mod
            reply += "\n" + _sleep_mod.status_line()
        except Exception:
            pass
        return CommandResult(ok=True, reply=reply)

    if name == "terminals":
        page = int(cmd.args[0]) if cmd.args and cmd.args[0].isdigit() else 1
        entries = _b("get_terminals")()
        return CommandResult(ok=True, reply=formatter.terminals_message(entries, page))

    if name == "terminal":
        entry = _resolve(cmd.args[0])
        if not entry:
            return CommandResult(ok=False, reply=f"❌ Terminal #{cmd.args[0]} does not exist.")
        return CommandResult(ok=True, reply=formatter.terminal_message(entry, entry.get("index", 0)))

    if name == "logs":
        entry = _resolve(cmd.args[0])
        if not entry:
            return CommandResult(ok=False, reply=f"❌ Terminal #{cmd.args[0]} does not exist.")
        lines = int(cmd.args[1]) if len(cmd.args) > 1 and cmd.args[1].isdigit() else 0
        max_lines = lines or 30
        max_lines = max(1, min(max_lines, 200))
        return CommandResult(ok=True, reply=formatter.logs_message(_b("get_logs")(entry["tty"], max_lines), max_lines))

    if name == "tasks":
        active_only = (cmd.args[0].lower() in ("active", "running")) if cmd.args else False
        return CommandResult(ok=True, reply=formatter.tasks_message(_b("get_terminals")(), active_only))

    if name == "task":
        entry = _resolve(cmd.args[0])
        if not entry:
            return CommandResult(ok=False, reply=f"❌ Terminal #{cmd.args[0]} does not exist.")
        tasks = _b("get_tasks")(entry["tty"])
        ct = tasks.get("current_task")
        if not ct:
            return CommandResult(ok=True, reply=f"No task on terminal #{entry.get('index', 0)}.")
        return CommandResult(ok=True, reply=formatter.task_message(entry, entry.get("index", 0), ct, "current"))

    if name == "queue":
        entry = _resolve(cmd.args[0])
        if not entry:
            return CommandResult(ok=False, reply=f"❌ Terminal #{cmd.args[0]} does not exist.")
        desc = " ".join(cmd.args[1:]).strip()
        if not desc:
            return CommandResult(ok=False, reply="❌ Usage: /queue <id> <task text>")
        task = await _b("add_task")(entry["tty"], desc, "")
        if not task:
            return CommandResult(ok=False, reply="❌ Could not queue task.")
        return CommandResult(ok=True, reply=f"✅ Queued on terminal #{entry.get('index', 0)}:\n{desc[:120]}")

    if name == "next":
        entry = _resolve(cmd.args[0])
        if not entry:
            return CommandResult(ok=False, reply=f"❌ Terminal #{cmd.args[0]} does not exist.")
        if len(cmd.args) > 1:
            desc = " ".join(cmd.args[1:]).strip()
            task = await _b("add_task")(entry["tty"], desc, "")
            if not task:
                return CommandResult(ok=False, reply="❌ Could not set task.")
            return CommandResult(ok=True, reply=f"✅ Next task set on terminal #{entry.get('index', 0)}:\n{desc[:120]}")
        tasks = _b("get_tasks")(entry["tty"])
        nt = tasks.get("next_task")
        if nt:
            return CommandResult(ok=True, reply=f"Next: {nt.get('description','')[:120]}")
        return CommandResult(ok=True, reply="No next task queued.")

    if name in ("run", "input"):
        entry = _resolve(cmd.args[0])
        if not entry:
            return CommandResult(ok=False, reply=f"❌ Terminal #{cmd.args[0]} does not exist.")
        text = " ".join(cmd.args[1:]).strip()
        if not text:
            return CommandResult(ok=False, reply=f"❌ Usage: /{name} <id> <command>")
        # Both /run and /input inject text into the terminal shell, so BOTH must
        # pass the safety classifier (previously /input bypassed it entirely).
        level = classify_shell(text)
        if level == SafetyLevel.BLOCKED:
            return CommandResult(ok=False, reply=f"⛔ Blocked command. {text[:80]} is not allowed via remote.")
        if level == SafetyLevel.DANGEROUS:
            conf = create_confirmation(sender, "run", entry["tty"], f"Command: {text}\nOn terminal #{entry.get('index', 0)}")
            return CommandResult(
                ok=False, requires_confirmation=True, confirmation_token=conf.token,
                reply=formatter.confirmation_message(conf.token, "run", entry.get("label") or entry["tty"], f"Command: {text[:120]}", int(conf.expires_at - conf.created_at)),
            )
        ok = bool(await _b("send_input")(entry["tty"], text))
        return CommandResult(ok=ok, reply=f"✅ Sent to terminal #{entry.get('index', 0)}:\n{text[:120]}" if ok else "❌ Could not send input.")

    if name == "files":
        path = cmd.args[0] if cmd.args else ""
        if not is_read_only_path(path):
            return CommandResult(ok=False, reply="⛔ Path not allowed.")
        res = _b("list_files")(path)
        if not res:
            return CommandResult(ok=False, reply=f"❌ Path not found: {path or '~'}")
        return CommandResult(ok=True, reply=formatter.files_message(res.get("files", []), res.get("path", path)))

    if name == "tokens":
        return CommandResult(ok=True, reply=formatter.tokens_message(_b("get_token_usage")()))

    if name == "agents":
        return CommandResult(ok=True, reply=formatter.agents_message(_b("get_terminals")()))

    if name == "workspace":
        agent_ws = _b("agent_workspaces")()
        if not agent_ws:
            return CommandResult(ok=True, reply="No agent workspaces configured.")
        ws_list = ["🗂️ AGENT WORKSPACES"]
        for i, w in enumerate(agent_ws[:10], start=1):
            header = f"  #{i} {w.get('name','?')}  →  {w.get('projectPath','')}"
            ws_list.append(header)
        ws_list.append("")
        ws_list.append("Use /new <workspace> [agent] to create a session.")
        return CommandResult(ok=True, reply="\n".join(ws_list))

    if name == "orchestrator":
        # /orchestrator [model:<model_key>] <task description>
        # The model: prefix sets the splitter model (the AI that plans the split).
        task_text = " ".join(cmd.args).strip()
        if not task_text:
            return CommandResult(ok=False, reply=(
                "❌ Usage: /orchestrator <task description>\n"
                "   or: /orchestrator model:<model_key> <task description>\n\n"
                "Examples:\n"
                "  /orchestrator Build a REST API for user management\n"
                "  /orchestrator model:opencode/deepseek-v4-flash-free Build auth system\n"
                "\nUse /models to see available models."
            ))
        # Extract optional model: prefix
        splitter_model = ""
        model_match = re.match(r'^model:(\S+)\s+', task_text)
        if model_match:
            splitter_model = model_match.group(1)
            task_text = task_text[model_match.end():].strip()
        if not task_text:
            return CommandResult(ok=False, reply="❌ Task description is empty.")
        entries = _b("get_terminals")()
        if not entries:
            return CommandResult(ok=False, reply="❌ No terminals available.")
        fn = _b("orchestrate")
        if not fn:
            return CommandResult(ok=False, reply="❌ Orchestrator not available.")
        result = await fn(task_text, entries, splitter_model)
        if not result:
            return CommandResult(ok=False, reply="❌ Orchestrator failed.")
        return CommandResult(ok=True, reply=result)

    if name == "model":
        # /model <terminal_number> <model_key> — set a terminal's model
        if len(cmd.args) < 2:
            # List current models
            entries = _b("get_terminals")()
            lines = ["🤖 TERMINAL MODELS"]
            for e in entries:
                model = e.get('model') or 'auto (default)'
                lines.append(f"  #{e.get('index', 0)} {e.get('label', e.get('tty', ''))}: {model}")
            lines.append("")
            lines.append("Usage: /model <terminal_number> <model_key>")
            lines.append("Use /models to see available model keys.")
            return CommandResult(ok=True, reply="\n".join(lines))
        # /model 3 opencode/deepseek-v4-flash-free
        entry = _resolve(cmd.args[0])
        if not entry:
            return CommandResult(ok=False, reply=f"❌ Terminal #{cmd.args[0]} does not exist.")
        model_key = cmd.args[1]
        # Store the model preference via the bridge (sets terminal.model in state)
        try:
            set_model_fn = _b("set_terminal_model")
            if set_model_fn:
                import asyncio as _aio
                await _aio.to_thread(set_model_fn, entry["tty"], model_key)
            else:
                # Fallback: direct API call
                import urllib.request as _urllib_req
                req = _urllib_req.Request(
                    f"http://127.0.0.1:8765/api/terminals/{entry['tty']}/model",
                    data=model_key.encode(),
                    headers={"Content-Type": "text/plain"},
                    method="PATCH",
                )
                _urllib_req.urlopen(req, timeout=5)
        except Exception:
            pass
        return CommandResult(ok=True, reply=f"✅ Terminal #{entry.get('index', 0)} model set to: {model_key}")

    if name == "sleep":
        from . import sleep as _sleep
        arg = (cmd.args[0] if cmd.args else "").strip().lower()
        if arg in ("prevent", "on", "hold", "yes", "1"):
            _sleep.prevent_manual()
            return CommandResult(ok=True, reply=(
                "😴 Sleep prevention is now ON.\n"
                "The system will NOT go to sleep (caffeinate active).\n"
                "Use /sleep allow to let it sleep normally again."
            ))
        if arg in ("allow", "off", "release", "no", "0"):
            _sleep.allow_manual()
            return CommandResult(ok=True, reply=(
                "😴 Sleep prevention is now OFF.\n"
                "The system may sleep normally when idle."
            ))
        # No arg / unknown → report status
        return CommandResult(ok=True, reply=_sleep.status_line())

    # ── Agent Workspace commands (Discord ↔ opencode sessions) ───────────

    if name == "agent-new":
        ws_ref = cmd.args[0] if cmd.args else ""
        agent = cmd.args[1] if len(cmd.args) > 1 else "build"
        if not ws_ref:
            return CommandResult(ok=False, reply="❌ Usage: /new <workspace> [agent]\nUse /workspace to list workspaces.")
        fn = _b("create_agent_session")
        if not fn:
            return CommandResult(ok=False, reply="❌ Agent session creation not available.")
        result = await fn(ws_ref, agent)
        if not result.get("ok"):
            return CommandResult(ok=False, reply=f"❌ Could not create session: {result.get('error', 'unknown')}")
        ws_name = result.get("ws") or ws_ref
        short = result.get("short_id")
        short_label = f"#{short}" if short is not None else (result.get("id") or "?")[:16]
        return CommandResult(ok=True, reply=(
            f"✅ Session created\n"
            f"{short_label} · {agent} · {ws_name}\n\n"
            f"Send a task:\n"
            f"/go {short_label} <task description>\n\n"
            f"Also visible in the TTO Agent Workspace."
        ))

    if name == "agent-enter":
        ws_arg = cmd.args[0] if cmd.args else ""
        fn_set = _b("agent_set_current_ws")
        fn_ws = _b("agent_current_ws")
        if not fn_set or not fn_ws:
            return CommandResult(ok=False, reply="❌ Workspace context not available.")
        if ws_arg == "0":
            fn_set(0)
            return CommandResult(ok=True, reply="✅ Left workspace. /go works globally again.")
        if not ws_arg:
            cur = fn_ws()
            label = f"#{cur}" if cur else "none"
            return CommandResult(ok=True, reply=(
                f"Current workspace: {label}\n"
                f"/enter <#> to get inside · /enter 0 to leave"
            ))
        if not ws_arg.lstrip("-").isdigit():
            return CommandResult(ok=False, reply="❌ Usage: /enter <workspace#>\nUse /workspace to list.")
        n = int(ws_arg)
        ws_fn = _b("agent_workspaces")
        agent_ws = ws_fn() if ws_fn else []
        if not 0 <= n <= len(agent_ws):
            return CommandResult(ok=False, reply=f"❌ No workspace #{n}. Use /workspace.")
        ws_name = (agent_ws[n-1].get('name','?')) if n >= 1 else "global"
        fn_set(n)
        if n == 0:
            return CommandResult(ok=True, reply="✅ Left workspace. /go works globally again.")
        return CommandResult(ok=True, reply=(
            f"✅ Now inside workspace #{n}: {ws_name}\n"
            f"Sessions start at #1 here.\n"
            f"/enter 0 to leave.\n"
            f"Task: /go <n> <task> — creates a session in this workspace."
        ))

    if name == "agent-go":
        sid_ref = cmd.args[0] if cmd.args else ""
        task_text = " ".join(cmd.args[1:]).strip() if len(cmd.args) > 1 else ""
        if not sid_ref or not task_text:
            return CommandResult(ok=False, reply="❌ Usage: /go <session_id> <task description>")
        resolve = _b("agent_resolve_session")
        resolved = resolve(sid_ref) if resolve else None
        if not resolved:
            return CommandResult(ok=False, reply=(
                f"❌ Session not found: {sid_ref}\n"
                f"Send a voice note or tap the newest 🎙️ panel and say “use <workspace>”."
            ))
        fn_send = _b("send_agent_task")
        if not fn_send:
            return CommandResult(ok=False, reply="❌ Agent task sending not available.")
        # Fire-and-forget: the opencode server blocks for the full agent
        # run (up to 10 min).  Launch as a background task so /go returns
        # immediately; the notify loop picks up completion.
        import asyncio
        real_sid = resolved["real"]
        asyncio.create_task(_safe_send_task(fn_send, real_sid, task_text))
        return CommandResult(ok=True, reply=(
            f"✅ Task dispatched\n"
            f"#{resolved['short']} · {task_text[:100]}\n\n"
            f"Check status: /session {resolved['short']}"
        ))


    if name == "agent-sessions":
        fn = _b("agent_sessions")
        if not fn:
            return CommandResult(ok=False, reply="❌ Agent sessions not available.")
        result = await fn()
        sessions = result.get("sessions") or []
        if not sessions:
            return CommandResult(ok=True, reply="No agent sessions.\nUse /new <workspace> to create one.")
        lines = ["🤖 AGENT SESSIONS"]
        tracked = [s for s in sessions if s.get("short_id") is not None]
        untracked = [s for s in sessions if s.get("short_id") is None]
        if tracked:
            for s in tracked:
                agent = s.get("agent") or "?"
                short = s["short_id"]
                t = s.get("time") or {}
                updated = t.get("updated") or 0
                age_str = formatter._age(time.time() - updated) if updated else ""
                title = (s.get("title") or s.get("id", ""))[:40]
                lines.append(f"#{short} {agent} — {title}  {age_str}")
            lines.append("")
        if untracked:
            lines.append(f"Web sessions ({len(untracked)}):")
            for s in untracked[:8]:
                agent = s.get("agent") or "?"
                title = (s.get("title") or s.get("id", ""))[:40]
                lines.append(f"  ○ {agent} — {title}")
            if len(untracked) > 8:
                lines.append(f"  … +{len(untracked) - 8} more")
        lines.append("\nUse /session <id> for details.\n/web sessions listed for reference only.")
        return CommandResult(ok=True, reply="\n".join(lines))

    if name == "agent-session":
        sid_ref = cmd.args[0] if cmd.args else ""
        if not sid_ref:
            return CommandResult(ok=False, reply="❌ Usage: /session <session_id>")
        resolve = _b("agent_resolve_session")
        resolved = resolve(sid_ref) if resolve else None
        if not resolved:
            return CommandResult(ok=False, reply=(
                f"❌ Session not found: {sid_ref}\n"
                f"Send a voice note or tap the newest 🎙️ panel and say “use <workspace>”."
            ))
        fn = _b("agent_session")
        if not fn:
            return CommandResult(ok=False, reply="❌ Agent session detail not available.")
        summary = await fn(resolved["real"])
        lines = [f"📋 Session #{resolved['short']}: {(summary.get('title') or sid_ref)[:50]}"]
        lines.append(f"Agent: {summary.get('agent') or '?'}")
        lines.append(f"Status: {'✅ completed' if summary.get('finished') else '⏳ running'}")
        todos = summary.get("todos") or []
        if todos:
            done_count = sum(1 for t in todos if t.get("done"))
            lines.append(f"\n📋 TODOs ({done_count}/{len(todos)}):")
            for t in todos[:8]:
                check = "✅" if t.get("done") else "⬜"
                lines.append(f"  {check} {(t.get('text') or '')[:70]}")
        files = summary.get("files") or []
        if files:
            lines.append(f"\n📁 Files ({len(files)}):")
            for f in files[:8]:
                lines.append(f"  • {f.get('path', '?')}")
        text = summary.get("text", "").strip()
        if text:
            paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
            last_text = paragraphs[-1] if paragraphs else text
            lines.append(f"\n💬 Reply:\n{last_text[:600]}")
            lines.append(f"\n🎙️ Say 'abort' to stop.")
        return CommandResult(ok=True, reply="\n".join(lines))

    if name == "agent-abort":
        sid_ref = cmd.args[0] if cmd.args else ""
        if not sid_ref:
            return CommandResult(ok=False, reply="❌ Usage: Say the session’s name — e.g. “abort jarvis”.")
        resolve = _b("agent_resolve_session")
        resolved = resolve(sid_ref) if resolve else None
        if not resolved:
            return CommandResult(ok=False, reply=(
                f"❌ Session not found: {sid_ref}\n"
                f"Send a voice note or tap the newest 🎙️ panel and say “use <workspace>”."
            ))
        fn = _b("agent_abort")
        if not fn:
            return CommandResult(ok=False, reply="❌ Agent abort not available.")
        result = await fn(resolved["real"])
        if result.get("ok"):
            return CommandResult(ok=True, reply=f"⏹️ Session #{resolved['short']} aborted.")
        return CommandResult(ok=False, reply=f"❌ Could not abort session: {result.get('error', 'unknown')}")

    return CommandResult(ok=False, reply=f"❌ Command /{name} not implemented.")


async def _safe_send_task(fn_send, sid: str, task_text: str) -> None:
    """Run send_agent_task in a background task with error logging."""
    print(f"[agent] background task started sid={sid[:16]}", flush=True)
    try:
        result = await fn_send(sid, task_text)
        print(f"[agent] background task done sid={sid[:16]} result={result}", flush=True)
    except Exception as exc:
        print(f"[agent] background task error sid={sid}: {exc!r}", flush=True)
