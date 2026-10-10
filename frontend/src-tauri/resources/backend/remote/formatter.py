"""TTO Remote Control — message formatting.

Everything sent to WhatsApp is built here: concise, mobile-friendly, emoji
allowed, truncated.  Logs are capped; token numbers are real (from the
existing token-usage pipeline).
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

SEP = "────────────────"


def _age(sec: float) -> str:
    sec = max(0, int(sec))
    if sec < 60:
        return f"{sec}s"
    if sec < 3600:
        return f"{sec // 60}m"
    return f"{sec // 3600}h {sec % 3600 // 60}m"


def _num(n: float) -> str:
    n = float(n or 0)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(int(n))


def help_message() -> str:
    return (
        "🤖 TTO REMOTE — COMMANDS\n\n"
        "AGENT WORKSPACE\n"
        "• /workspace — list workspaces\n"
        "• /new <workspace> [agent] — create session\n"
        "• /go <id> <task> — send task (e.g. /go 1 add a README)\n"
        "• /sessions — list sessions (numbered)\n"
        "• /session <id> — session detail + todos\n"
        "• /abort <id> — stop a running session\n"
        "• /enter <#> — enter a workspace (persists until /enter 0)\n\n"
        "SYSTEM\n"
        "• /status — overall state\n"
        "• /health — system check\n"
        "• /tokens — usage stats\n"
        "• /sleep prevent|allow\n\n"
        f"{SEP}\n"
        "Tip: sessions created from here appear\n"
        "in the TTO Agent Workspace (same server)."
    )


def status_message(overall: Dict[str, Any], sidecar_ok: bool, rust_ok: bool, remote_ok: bool) -> str:
    terms = overall.get("terminals", {})
    live = [t for t in terms.values() if t.get("is_live")]
    active = sum(1 for t in live if t.get("current_task") and t["current_task"].get("status") == "running")
    idle = sum(1 for t in live if not t.get("current_task"))
    agents = sum(1 for t in live if t.get("agent"))
    tasks_running = active
    tasks_queued = sum(len(t.get("queue") or []) + (1 if t.get("next_task") else 0) for t in live)
    tasks_done = sum(len(t.get("history") or []) for t in live)
    tok = overall.get("token_usage", {})
    lines = [
        "🖥️ TTO STATUS",
        f"{'🟢' if sidecar_ok else '🔴'} Sidecar {'online' if sidecar_ok else 'offline'}",
        f"{'🟢' if rust_ok else '🔴'} Rust engine {'connected' if rust_ok else 'unavailable'}",
        f"{'🟢' if remote_ok else '🔴'} WhatsApp remote {'connected' if remote_ok else 'offline'}",
        "",
        "Terminals",
        f"{len(live)} active · {idle} idle · {active} running",
        "",
        "Agents",
        f"{agents} active",
        "",
        "Tasks",
        f"{tasks_running} running · {tasks_queued} queued · {tasks_done} completed",
    ]
    if tok:
        lines += ["", "Tokens", f"input {_num(tok.get('total_input', 0))} · output {_num(tok.get('total_output', 0))}"]
    lines += ["", SEP, "Last update: " + time.strftime("%H:%M:%S")]
    return "\n".join(lines)


def terminals_message(entries: List[Dict[str, Any]], page: int = 1, per_page: int = 10) -> str:
    if not entries:
        return "🖥️ No terminals detected."
    total = len(entries)
    pages = max(1, -(-total // per_page))
    page = max(1, min(page, pages))
    start = (page - 1) * per_page
    chunk = entries[start:start + per_page]
    lines = [f"🖥️ TTO TERMINALS  ({page}/{pages})"]
    for i, e in enumerate(chunk, start=start + 1):
        status = e.get("status", "idle")
        dot = {"running": "🟢", "waiting": "🟡", "blocked": "🔴", "idle": "⚪"}.get(status, "⚪")
        agent = (e.get("agent") or "Idle").title()
        task = (e.get("current_task") or {}).get("description", "")
        line = f"{i:02d} {dot} {agent}"
        if task:
            line += f"\n   {task[:70]}"
        lines.append(line)
    if pages > 1:
        lines.append(f"\nPage {page}/{pages} — /terminals {page + 1}")
    return "\n".join(lines)


def terminal_message(e: Dict[str, Any], index: int) -> str:
    ct = e.get("current_task") or {}
    nt = e.get("next_task") or {}
    queue = e.get("queue") or []
    status = e.get("status", "idle")
    dot = {"running": "🟢", "waiting": "🟡", "blocked": "🔴", "idle": "⚪"}.get(status, "⚪")
    # Lead with the app-style session label (terminal-7 · ttys012) so the
    # reply matches what the user sees in the Task Center; fall back to the
    # numbered index for terminals without a session name.
    sid = e.get("session_id") or ""
    head = f"{sid} · {e.get('tty')}" if sid else f"Terminal #{index}"
    lines = [
        f"{head}  {dot} {status.upper()}",
        f"Agent: {(e.get('agent') or 'shell').title()}",
    ]
    if e.get("cwd"):
        lines.append(f"CWD: {e['cwd'][:80]}")
    if e.get("model"):
        lines.append(f"Model: {e['model']}")
    if ct:
        lines += [
            "",
            "TASK",
            ct.get("description", ""),
            f"Started: {_age(time.time() - (ct.get('started_at') or time.time()))} ago",
        ]
    if nt:
        lines += ["", "NEXT", nt.get("description", "")]
    if queue:
        lines.append(f"QUEUE ({len(queue)}): " + " · ".join(q.get("description", "")[:40] for q in queue[:3]))
    if e.get("opencode_running"):
        lines.append(f"\nAgent CLI: 🟢 opencode ({e.get('opencode_model') or 'default'})")
    return "\n".join(lines)


def logs_message(log_text: str, max_lines: int) -> str:
    if not log_text:
        return "No captured output for this terminal."
    lines = log_text.splitlines()
    if len(lines) > max_lines:
        lines = lines[-max_lines:]
        out = ["… (truncated)"] + lines
    else:
        out = lines
    return "📄 LAST OUTPUT\n" + "\n".join(out[-max_lines:])[:3000]


def tasks_message(entries: List[Dict[str, Any]], active_only: bool) -> str:
    rows = []
    for i, e in enumerate(entries, start=1):
        ct = e.get("current_task") or {}
        if not ct:
            continue
        if active_only and ct.get("status") != "running":
            continue
        rows.append(f"{i:02d} {ct.get('status','?').upper()} — {ct.get('description','')[:60]}")
    if not rows:
        return "No active tasks." if active_only else "No tasks."
    return "📋 TASKS\n" + "\n".join(rows)


def task_message(e: Dict[str, Any], index: int, task: Dict[str, Any], position: str) -> str:
    return (
        f"Task on terminal #{index} ({position})\n\n"
        f"Status: {task.get('status','?').upper()}\n"
        f"Task: {task.get('description','')}\n"
        f"Created: {_age(time.time() - (task.get('created_at') or time.time()))} ago\n"
        + (f"Summary: {task.get('summary','')[:200]}\n" if task.get("summary") else "")
    )


def confirmation_message(token: str, command: str, target: str, details: str, ttl: int) -> str:
    return (
        "⚠️ CONFIRMATION REQUIRED\n\n"
        f"{command.upper()} {target or ''}\n"
        f"{details}\n\n"
        "This action cannot be undone.\n\n"
        f"Reply: CONFIRM {token}\n"
        f"or: CANCEL\n\n"
        f"Expires in {ttl}s"
    )


def files_message(files: List[Dict[str, Any]], path: str) -> str:
    if not files:
        return f"📁 {path or '~'} — empty"
    lines = [f"📁 {path or '~'}"]
    for f in files:
        icon = "📁" if f.get("is_dir") else "📄"
        name = f.get("name", "")
        if f.get("is_dir"):
            lines.append(f"{icon} {name}/")
        else:
            size = f.get("size") or 0
            lines.append(f"{icon} {name}  ({_num(size)}B)")
    return "\n".join(lines[:25]) + ("\n…" if len(files) > 25 else "")


def tokens_message(usage: Dict[str, Any]) -> str:
    lines = ["📊 TOKEN USAGE"]
    groups = usage.get("groups") or {}
    if groups:
        for g in sorted(groups.values(), key=lambda x: -(x.get("input", 0) + x.get("output", 0)))[:6]:
            label = g.get("label") or g.get("model") or "?"
            lines.append(f"{label}\n  in {_num(g.get('input',0))} · out {_num(g.get('output',0))}")
    total_in = sum(g.get("input", 0) for g in groups.values())
    total_out = sum(g.get("output", 0) for g in groups.values())
    lines.append(f"\nTotal: in {_num(total_in)} · out {_num(total_out)}")
    limits = usage.get("limits") or {}
    for key, lim in limits.items():
        used = lim.get("used", 0) or 0
        cap = lim.get("limit", 0) or 1
        pct = min(100, int(used / cap * 100))
        lines.append(f"{lim.get('label') or key}: {pct}% used")
    return "\n".join(lines)


def agents_message(entries: List[Dict[str, Any]]) -> str:
    rows = []
    for i, e in enumerate(entries, start=1):
        if not e.get("agent"):
            continue
        status = e.get("status", "idle")
        dot = {"running": "🟢", "waiting": "🟡", "blocked": "🔴", "idle": "⚪"}.get(status, "⚪")
        task = (e.get("current_task") or {}).get("description", "")
        line = f"{i:02d} {dot} {e['agent'].title()} — term {e.get('tty')}"
        if task:
            line += f"\n   Task: {task[:60]}"
        rows.append(line)
    return "🤖 AGENTS\n" + "\n".join(rows[:20]) if rows else "No agents detected."
