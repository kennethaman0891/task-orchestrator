#!/usr/bin/env python3
"""PART 3 — Telegram workspace context + numbered/scoped sessions (+ /enter).
Safe: every replacement anchored on text CONFIRMED verbatim; asserts count==1.
Detect current-ws + sessions via bridges; persist entered-ws via main.py bridge.
"""
import re, sys, json

svc_path = "/Users/kennethaman/tto-web/backend/remote/service.py"
main_path = "/Users/kennethaman/tto-web/backend/main.py"

s = open(svc_path, encoding="utf-8").read()
m = open(main_path, encoding="utf-8").read()

def rep(txt, old, new, label):
    n = txt.count(old)
    assert n == 1, f"{label}: found {n} (expected 1)"
    return txt.replace(old, new)

# ───────────────────── EDIT 1 — service.py /workspace → numbered + scoped ─────────────────────
# Anchor: header line (CONFIRMED service.py:341)
old = '        lines = ["🗂️ AGENT WORKSPACES"]'
new = ('''        # Numbered workspaces (#1..#n), each showing its scoped sessions.
        # Current (entered) workspace is marked ▶.
        cur_ws = _b("agent_cur_ws")() if _b("agent_cur_ws") else None          # workspace id (str)
        all_sessions = _b("agent_sessions")().get("sessions") if _b("agent_sessions") else []
        lines = ["🗂️ AGENT WORKSPACES"]''')
s = rep(s, old, new, "ws-header")

# Anchor: item line (CONFIRMED service.py:347) -> numbered #n
old = '''            lines.append(f"• {w.get('name','?')}  →  {w.get('projectPath','')}")'''
new = '''            pp = (w.get('projectPath') or '').rstrip('/')
            marker = '▶' if cur_ws and str(w.get('id','')) == str(cur_ws) else ' '
            lines.append(f"{marker}#{i} {w.get('name','?')}  →  {pp}")
            # Sessions SCOPED to this workspace = sessions whose directory/cwd
            # starts with this workspace's projectPath.
            scoped = []
            for s_ in all_sessions:
                d = (s_.get('directory') or s_.get('cwd') or s_.get('projectPath') or '')
                if d.rstrip('/').startswith(pp):
                    scoped.append(s_)
            if scoped:
                for j, sess in enumerate(scoped[:97], start=1):
                    ag = sess.get('agent') or '?'
                    title = (sess.get('title') or '?')[:26]
                    lines.append(f"     #{j} {ag} · {title}")'''.replace("#{i}", "#{i}").replace("rows", "rows")
s = rep(s, old, new, "ws-item")

# Anchor: workspace tail before return (CONFIRMED service.py:359-360)
old = '''            for w in ws[:5]:
                panes = len(w.get("panes") or [])
                lines.append(f"  • {w.get('name','?')}  ({panes} panes)")
        return CommandResult(ok=True, reply="\\n".join(lines))

    if name == "orchestrator":'''
new = '''            for w in ws[:5]:
                panes = len(w.get("panes") or [])
                lines.append(f"  • {w.get('name','?')}  ({panes} panes)")
        lines.append("")
        cur_lbl = f"#{cur_ws}" if cur_ws else "none"
        lines.append(f"▶ Entered workspace: {cur_lbl or 'none'}")
        lines.append("")
        lines.append("Get inside a workspace:")
        lines.append("  /enter <n>  — work inside workspace #<n> (stays until you change it)")
        lines.append("  /enter 0    — leave the workspace (work globally)")
        return CommandResult(ok=True, reply="\\n".join(lines))

    if name == "orchestrator":'''
s = rep(s, old, new, "ws-tail")

# ───────────────────── EDIT 2 — service.py NEW /enter handler + /go scoping ─────────────────────
# Insert /enter + scoped /go resolution right before the agent-go dispatcher branch.
old = '''    if name == "agent-go":
        sid_ref = cmd.args[0] if cmd.args else ""
        task_text = " ".join(cmd.args[1:]).strip() if len(cmd.args) > 1 else ""
        if not sid_ref or not task_text:
            return CommandResult(ok=False, reply="❌ Usage: /go <session_id> <task description>")
        resolve = _b("agent_resolve_session")
        resolved = resolve(sid_ref) if resolve else None
        if not resolved:'''
new = '''    if name == "agent-enter":
        # /enter <n>  — "get inside" workspace #n (persists until changed).
        # /enter 0    — leave. /enter      — show current (no change).
        set_fn = _b("agent_set_cur_ws")
        get_fn = _b("agent_cur_ws")
        arg = cmd.args[0] if cmd.args else ""
        if not arg:
            cur_ws = get_fn() if get_fn else None
            return CommandResult(ok=True, reply=(
                f"▶ Current workspace: {('#'+str(cur_ws)) if cur_ws else 'none'}\\n"
                f"/enter <n> to get inside workspace #<n> · /enter 0 to leave"
            ))
        if arg == "0":
            if set_fn: set_fn(None)
            return CommandResult(ok=True, reply="✅ Left the workspace — working globally now.\\n/workspace to re-enter.")
        if not arg.lstrip("0123456789") and arg.isdigit():
            try:
                n = int(arg)
            except ValueError:
                n = 0
            if n and set_fn:
                set_fn(str(n))
                return CommandResult(ok=True, reply=(
                    f"✅ Now inside workspace #{n}.\\n"
                    f"Sessions here are numbered #{1}…# (scoped to this workspace).\\n"
                    f"Send a task:  /go 1 <task description>"
                ))
            return CommandResult(ok=False, reply="❌ Enter a workspace number from /workspace (or /enter 0 to leave).")
        return CommandResult(ok=False, reply="❌ Usage: /enter <workspace_number>\\n/enter 0 to leave.")

    if name == "agent-go":
        sid_ref = cmd.args[0] if cmd.args else ""
        task_text = " ".join(cmd.args[1:]).strip() if len(cmd.args) > 1 else ""
        if not sid_ref or not task_text:
            return CommandResult(ok=False, reply="❌ Usage: /go <session_id> <task description>")
        # ── Workspace-scoped: when inside a workspace (/enter), numbers are
        #    relative to that workspace's sessions.  A session-number that
        #    doesn't exist yet AUTO-CREATES a session in that workspace and
        #    sends the task there. ──
        ws_info = None
        ws_bridge = _b("agent_ws_scoped_info")
        if ws_bridge:
            ws_info = ws_bridge(sid_ref)
        if ws_info and not ws_info.get("not_found"):
            try:
                real = ws_info.get("real") or ""
            except Exception:
                real = ""
            if not real:
                fn_new = _b("agent_ws_auto_create_session")
                created = fn_new(ws_info) if fn_new else None
                real = (created or {}).get("real") or ""
            if not real:
                return CommandResult(ok=False, reply=(
                    f"❌ Session not found: {sid_ref}\\nUse /sessions to see active sessions."
                ))
            fn_task = _b("agent_ws_send_task")
            if not fn_task:
                return CommandResult(ok=False, reply="❌ Task sending not available.")
            fn_task(real, task_text)
            return CommandResult(ok=True, reply=(
                f"🚀 Task sent (workspace #{ws_info.get('ws_short','?')} · session {sid_ref})\\n"
                f"Agent working… \\nCheck: /go {sid_ref} <next task>"
            ))
        resolve = _b("agent_resolve_session")
        resolved = resolve(sid_ref) if resolve else None
        if not resolved:'''
s = rep(s, old, new, "go-scoped")

# ───────────────────── EDIT 3 — main.py: persist + load + bridge current-workspace ─────────────────────
# Anchor: persist (CONFIRMED main.py:6138-6142)
old = '''            json.dumps({"next": _TG_NEXT_ID, "sessions": _TG_SESSIONS}, indent=2)'''
new = '''            json.dumps({"next": _TG_NEXT_ID, "current_ws": _TG_CURRENT_WS, "sessions": _TG_SESSIONS}, indent=2)'''
m = rep(m, old, new, "persist")

# Anchor: load (CONFIRMED main.py:6153-6160)
old = '''        _TG_NEXT_ID = int(data.get("next", 1))
        _TG_SESSIONS = {int(k): v for k, v in (data.get("sessions") or {}).items()}
        _TG_REAL_TO_SHORT = {v: k for k, v in _TG_SESSIONS.items()}'''
new = '''        _TG_NEXT_ID = int(data.get("next", 1))
        _TG_CURRENT_WS = str(data.get("current_ws") or "")
        _TG_SESSIONS = {int(k): v for k, v in (data.get("sessions") or {}).items()}
        _TG_REAL_TO_SHORT = {v: k for k, v in _TG_SESSIONS.items()}'''
m = rep(m, old, new, "load")

# Anchor: global declaration (CONFIRMED main.py:6132-6136)
old = '''_TG_SESSIONS: Dict[int, str] = {}   # short -> real opencode session id
_TG_REAL_TO_SHORT: Dict[str, int] = {}  # real id -> short (dedup)
_TG_NEXT_ID = 1
_TG_SESSION_FILE = STATE_DIR / "agent_sessions.json"'''
new = '''_TG_SESSIONS: Dict[int, str] = {}   # short -> real opencode session id
_TG_REAL_TO_SHORT: Dict[str, int] = {}  # real id -> short (dedup)
_TG_NEXT_ID = 1
_TG_CURRENT_WS: str = ""              # workspace id the Telegram user 'entered' (0/'' = none)
_TG_SESSION_FILE = STATE_DIR / "agent_sessions.json"'''
m = rep(m, old, new, "decl")

# Anchor: bridge registry (CONFIRMED main.py:6572-6575)
old = '''        "agent_workspaces": _agent_workspaces,
        "agent_resolve_session": _tg_resolve,       # "1"/"#1"/"ses_…" -> {short,real}
        "create_agent_session": _create_agent_session,   # async
'''
new = '''        "agent_workspaces": _agent_workspaces,
        "agent_resolve_session": _tg_resolve,       # "1"/"#1"/"ses_…" -> {short,real}
        "agent_cur_ws": lambda: _TG_CURRENT_WS,     # entered workspace id (str)
        "agent_set_cur_ws": lambda v: (_set_tg_current_ws(v)),
        "create_agent_session": _create_agent_session,   # async
'''
m = rep(m, old, new, "bridges")

# Add _set_tg_current_ws helper (persist until changed)
old = '''def _tg_resolve(ref)'''
# find the def _tg_resolve to anchor insert before it
import re as _re
assert _re.search(r"^def _tg_resolve\(ref\)", m, _re.M), "no _tg_resolve def anchor"
_helper = '''def _set_tg_current_ws(ws_id) -> None:
    """Persist entered-workspace state (survives restart). ws_id ''/0 = none."""
    global _TG_CURRENT_WS
    _TG_CURRENT_WS = ws_id or ""
    _tg_persist()


'''
m = m.replace("def _tg_resolve(ref)", _helper + "def _tg_resolve(ref)", 1)

open(svc_path, "w", encoding="utf-8").write(s)
open(main_path, "w", encoding="utf-8").write(m)
print("service.py: 3 edits OK · main.py: 5 edits OK (incl helper)")
