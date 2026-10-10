"""TTO Remote Control — command parser.

Turns a WhatsApp message into a structured, safe `ParsedCommand`.  Only
whitelisted command names are recognized; everything else is rejected as
"unknown".  Natural-language queries (Phase 7) are mapped to the closest
deterministic command here so the AI layer never bypasses validation.
"""
from __future__ import annotations

import re
from typing import List, Optional

from .models import ParsedCommand

# command name -> (aliases, permission class, arity)
# arity: (min, max) positional args; -1 max = unlimited
COMMANDS = {
    "help":       (["?", "h"], "read", (0, 0)),
    "status":     (["st"], "read", (0, 0)),
    "terminals":  (["term", "terms", "list"], "read", (0, 1)),
    "terminal":   (["t"], "read", (1, 1)),
    "logs":       (["log"], "read", (1, 2)),
    "tasks":      (["tasklist"], "read", (0, 1)),
    "task":       (["tk"], "read", (1, 1)),
    "run":        (["exec"], "write", (2, -1)),
    "input":      (["type"], "write", (2, -1)),
    "queue":      (["q", "add"], "write", (2, -1)),
    "next":       (["n"], "write", (1, -1)),
    "pause":      (["p"], "dangerous", (1, 1)),
    "resume":     (["r"], "dangerous", (1, 1)),
    "restart":    (["reboot-term"], "dangerous", (1, 1)),
    "stop":       (["halt"], "dangerous", (1, 1)),
    "kill":       (["k"], "dangerous", (1, 1)),
    "shutdown":   (["poweroff"], "dangerous", (0, 0)),
    "files":      (["ls", "dir"], "read", (0, 1)),
    "tokens":     (["token", "usage"], "read", (0, 0)),
    "agents":     (["agent"], "read", (0, 0)),
    "workspace":  (["ws", "workspaces"], "read", (0, 0)),
    "health":     (["ping"], "read", (0, 0)),
    "orchestrator": (["orch", "split"], "write", (1, -1)),
    "model":       (["setmodel", "set-model"], "write", (0, -1)),
    "sleep":       (["sleeptoggle"], "write", (0, 1)),
    "confirm":    ([], "dangerous", (1, 1)),
    "cancel":     ([], "read", (0, 0)),
    # ── Agent Workspace commands (Discord ↔ opencode sessions) ──────────
    "agent-new":    (["new", "ns"], "write", (1, 2)),      # /new <workspace> [agent]
    "agent-go":     (["go", "task-send"], "write", (2, -1)), # /go <session_id> <task text>
    "agent-sessions": (["sessions", "ss"], "read", (0, 0)),  # /sessions
    "agent-session":  (["session", "si"], "read", (1, 1)),   # /session <id>
    "agent-enter":   (["enter", "enter-ws"], "write", (0, 1)),  # /enter <workspace#>
    "agent-abort":    (["abort"], "write", (1, 1)),           # /abort <session_id>
}

# Per-command usage examples — used for the targeted usage-error reply.
USAGE_HINTS = {
    "help":      "/help",
    "status":    "/status",
    "terminals": "/terminals  [page]",
    "terminal":  "/terminal 7",
    "logs":      "/logs 7 40",
    "tasks":     "/tasks active",
    "task":      "/task 7",
    "run":       "/run 7 npm test",
    "input":     "/input 7 hello world",
    "queue":     "/queue 7 fix the authentication bug",
    "next":      "/next 7",
    "pause":     "/pause 7",
    "resume":    "/resume 7",
    "restart":   "/restart 7",
    "stop":      "/stop 7",
    "kill":      "/kill 7",
    "shutdown":  "/shutdown",
    "files":     "/files  [path]",
    "tokens":    "/tokens",
    "agents":    "/agents",
    "workspace": "/workspace",
    "health":    "/health",
    "orchestrator": "/orchestrator [model:<key>] <task description>",
    "model":      "/model [terminal_number] [model_key]",
    "sleep":      "/sleep prevent | /sleep allow | /sleep",
    "confirm":   "CONFIRM <token>",
    "cancel":    "CANCEL",
    # Agent Workspace commands
    "agent-new":    "/new <workspace> [agent]  e.g. /new tto-journey build",
    "agent-go":     "/go <session_id> <task>  e.g. /go abc123 add a README",
    "agent-sessions": "/sessions",
    "agent-session":  "/session <session_id>",
    "agent-enter":    "/enter <workspace#> | /enter 0 to leave",
    "agent-abort":    "/abort <session_id>",
}


def usage_hint_for(name: str) -> str:
    """One-line correct usage for the given command name ("" when unknown)."""
    return USAGE_HINTS.get(name, "")


# Natural-language triggers -> (command, args) — Phase 7 (deterministic mapping;
# the AI interpretation layer above can emit these same commands).  Ordered
# most-specific first; destructive intents are deliberately NOT mapped here —
# they must come through the explicit slash command + confirmation flow.
NL_MAP = [
    (re.compile(r"\bwhat(?:'s| is)? (?:terminal|term) (\d+).*?(?:doing|status|state|up to)\b", re.I), "terminal", 1),
    (re.compile(r"\bwhat(?:'s| is)? (?:the )?(?:terminal|term)s? (?:status|state|doing)\b", re.I), "status", 0),
    (re.compile(r"\bhow (?:are|is).*?(?:terminals|agents).*?(?:doing|health)\b", re.I), "status", 0),
    (re.compile(r"\b(?:show|list|tell me).*?(?:agents|terminals).*?(?:stuck|waiting|idle|running)\b", re.I), "agents", 0),
    (re.compile(r"\btoken(?:s)?\b", re.I), "tokens", 0),
    (re.compile(r"\b(?:show|list).*?(?:tasks|queue)\b", re.I), "tasks", 0),
]


def _strip_command_prefix(text: str) -> str:
    """Return (lowered head, remainder) after any leading /command token."""
    text = text.strip()
    if not text.startswith("/"):
        return "", text
    parts = text.split(maxsplit=1)
    head = parts[0][1:].lower()
    rest = parts[1].strip() if len(parts) > 1 else ""
    return head, rest


def parse_message(text: str) -> ParsedCommand:
    """Parse a WhatsApp message into a ParsedCommand.

    Never raises for malformed input — unknown/empty text yields a command
    with name "" (caller replies with /help guidance).
    """
    raw = (text or "").strip()
    cmd = ParsedCommand(raw=raw)

    # 1. Direct slash command.
    head, rest = _strip_command_prefix(raw)
    if head:
        name = _resolve_name(head)
        if not name:
            return cmd  # unknown command
        args = _split_args(rest)
        return _build(cmd, name, args, rest)

    # 2. Confirmation replies ("CONFIRM KILL 12", "CONFIRM <token>").
    m = re.match(r"^\s*CONFIRM\s+(\S+)\s*$", raw, re.I)
    if m:
        return _build(cmd, "confirm", [m.group(1)], rest)

    if re.match(r"^\s*CANCEL\s*$", raw, re.I):
        return _build(cmd, "cancel", [], "")

    # 3. Natural-language mapping (Phase 7, deterministic).
    for pattern, name, argcount in NL_MAP:
        m = pattern.search(raw)
        if m:
            args = [m.group(i) for i in range(1, argcount + 1)] if argcount else []
            return _build(cmd, name, args, rest)
    return cmd


def _resolve_name(head: str) -> str:
    for name, (aliases, _perm, _arity) in COMMANDS.items():
        if head == name or head in aliases:
            return name
    return ""


def _split_args(rest: str) -> List[str]:
    if not rest:
        return []
    # Respect simple quoting: "foo bar" stays one arg.
    parts = re.findall(r'"(?:[^"]*)"|\S+', rest)
    return [p.strip('"') for p in parts]


def _build(cmd: ParsedCommand, name: str, args: List[str], rest: str) -> ParsedCommand:
    aliases, permission, (min_args, max_args) = COMMANDS[name]
    if len(args) < min_args:
        cmd.name = "usage_error"
        cmd.args = args
        cmd.raw = rest
        cmd.usage_for = name
        return cmd
    if max_args != -1 and len(args) > max_args:
        # e.g. /terminals 1 extra — trailing junk is ignored for read cmds
        # but rejected for write commands to avoid ambiguity.
        if permission != "read":
            cmd.name = "usage_error"
            cmd.args = args
            cmd.raw = rest
            cmd.usage_for = name
            return cmd
        args = args[:max_args]
    cmd.name = name
    cmd.args = args
    cmd.raw = rest
    cmd.permission = permission
    return cmd


def usage_error_message() -> str:
    return ("❌ Usage: /help for the full command list.\n"
            "Most commands look like: /terminal 7, /logs 7 40, "
            "/run 7 npm test, /queue 7 fix the bug")
