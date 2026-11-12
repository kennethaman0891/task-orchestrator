# backend/visit_activity.py — map collaborator API calls onto the audit hooks
"""Collaborators use the same orchestrator APIs as the desktop app.

This module classifies those calls and records them through the existing
audit helpers, which attach the line to the open visit. It does not keep a
second log.
"""
from __future__ import annotations

import contextvars
import json
import re
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

actor_var: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("tto_visit_actor", default=None)

_SECRET_KEYS = {"pin", "password", "token", "authorization", "secret", "api_key", "smtp_password"}

_TTY_COMMAND = re.compile(r"^/api/terminals/([^/]+)/command$")
_TTY_LAUNCH = re.compile(r"^/api/terminals/([^/]+)/launch$")
_TTY_TASKS = re.compile(r"^/api/terminals/([^/]+)/tasks$")
_TTY_COMPLETE = re.compile(r"^/api/terminals/([^/]+)/tasks/([^/]+)/complete$")
_MSG = re.compile(r"^/api/opencode/session/([^/]+)/message")
_ANNOTATION = re.compile(r"^/api/annotations/")


def current_actor() -> Optional[dict]:
    return actor_var.get()


def _clip(value: Any, limit: int = 240) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def _json_body(raw: bytes) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _redact(data: Dict[str, Any]) -> Dict[str, Any]:
    clean = {}
    for key, value in data.items():
        if str(key).lower() in _SECRET_KEYS:
            continue
        if isinstance(value, (dict, list)):
            continue
        clean[key] = _clip(value, 180)
    return clean


def classify_request(method: str, path: str, status: int, raw_body: bytes = b"", query: str = "") -> Optional[Dict[str, Any]]:
    """Return an audit descriptor, or None when the call is not part of the visit story."""
    method = (method or "").upper()
    path = urlparse(path).path or path
    if path.startswith("/api/collab/heartbeat") or path.startswith("/api/collab/session"):
        return None
    if status in (401, 403):
        return {
            "event_type": "denied",
            "details": {"path": path, "method": method, "status": status},
            "dedupe": 0,
        }
    if status >= 400 and method != "GET":
        body = _json_body(raw_body)
        return {
            "event_type": "failed",
            "details": {"path": path, "method": method, "status": status, "summary": _clip(body.get("detail") or "")},
            "dedupe": 0,
        }
    if status >= 400:
        return None
    # Successful collab-router calls are already written by the audit helpers.
    if path.startswith("/api/collab/"):
        return None

    body = _json_body(raw_body)
    params = parse_qs(query or "")

    if method == "GET" and path.rstrip("/") == "/api/workspaces":
        return {"event_type": "workspace_open", "details": {"workspace_id": "list"}, "workspace_id": None, "dedupe": 600}
    if method == "PUT" and path.rstrip("/") == "/api/workspaces":
        count = len(body.get("workspaces") or []) if isinstance(body.get("workspaces"), list) else ""
        return {
            "event_type": "workspace_change",
            "details": {"what": "workspaces", "value": count or "updated"},
            "dedupe": 30,
        }
    if method == "POST" and path.rstrip("/") == "/api/terminal/open":
        return {
            "event_type": "terminal_open",
            "details": {"summary": _clip(body.get("cwd") or "new terminal")},
            "workspace_id": body.get("cwd") or None,
            "dedupe": 0,
        }
    match = _TTY_COMMAND.match(path) or _TTY_LAUNCH.match(path)
    if match and method == "POST":
        command = body.get("command") or ""
        return {
            "event_type": "command",
            "details": {"command": _clip(command, 400)},
            "tty": match.group(1),
            "dedupe": 0,
        }
    match = _TTY_TASKS.match(path)
    if match and method == "POST":
        desc = body.get("description") or body.get("task") or ""
        return {
            "event_type": "task_started",
            "details": {"description": _clip(desc, 400), "summary": _clip(desc)},
            "tty": match.group(1),
            "dedupe": 0,
        }
    match = _TTY_COMPLETE.match(path)
    if match and method == "POST":
        return {
            "event_type": "task_outcome",
            "details": {"task_id": match.group(2), "status": _clip(body.get("status") or "complete"), "summary": _clip(body.get("status") or "complete")},
            "tty": match.group(1),
            "dedupe": 0,
        }
    if method == "POST" and path.rstrip("/") == "/api/orchestrator/run":
        return {
            "event_type": "orchestrator_started",
            "details": {"task": _clip(body.get("task"), 400), "summary": _clip(body.get("task")), "workspace_id": body.get("workspace_id") or ""},
            "workspace_id": body.get("workspace_id") or None,
            "dedupe": 0,
        }
    if method == "POST" and path.rstrip("/") in ("/api/qwen/orchestrate", "/api/qwen/dispatch"):
        summary = body.get("prompt") or body.get("task") or path.rsplit("/", 1)[-1]
        return {
            "event_type": "qwen_task",
            "details": {"summary": _clip(summary), "path": path},
            "workspace_id": body.get("workspace_id") or None,
            "dedupe": 0,
        }
    if method == "POST" and path.rstrip("/") == "/api/orchestrator/agent/start":
        return {"event_type": "agent_task", "details": {"summary": "Agent started"}, "dedupe": 15}
    if method == "POST" and _MSG.match(path):
        text = body.get("message") or body.get("text") or body.get("content") or ""
        return {
            "event_type": "message",
            "details": {"message": _clip(text, 400)},
            "dedupe": 0,
        }
    if method == "POST" and _ANNOTATION.match(path):
        return {
            "event_type": "message",
            "details": {"message": _clip(body.get("text") or body.get("message") or "sent to agent")},
            "dedupe": 0,
        }
    if method in ("PUT", "POST", "PATCH", "DELETE") and path.startswith("/api/file"):
        file_path = body.get("path") or (params.get("path") or [""])[0]
        return {
            "event_type": "workspace_change",
            "details": {"what": method.lower() + " file", "value": _clip(file_path, 180)},
            "dedupe": 0,
        }
    if method in ("POST", "DELETE") and (path.startswith("/api/dir") or path.startswith("/api/git")):
        return {
            "event_type": "workspace_change",
            "details": {"what": path, "value": _clip(body.get("path") or body.get("message") or method)},
            "dedupe": 0,
        }
    return None


async def record_classified(username: str, item: Dict[str, Any]) -> None:
    from audit import audit_event
    await audit_event(
        username,
        item["event_type"],
        item.get("details") or {},
        workspace_id=item.get("workspace_id"),
        tty=item.get("tty"),
        dedupe_seconds=float(item.get("dedupe") or 0),
    )


async def note_orchestrator_outcome(run) -> None:
    """Called when a background orchestrator run finishes, if a visitor started it."""
    actor = current_actor()
    if not actor:
        return
    username = actor.get("email") or actor.get("username") or ""
    if not username:
        return
    status = getattr(run, "status", "") or ""
    task = getattr(run, "task", "") or ""
    error = getattr(run, "error", "") or ""
    from audit import audit_event
    await audit_event(
        username,
        "orchestrator_outcome",
        {"status": status, "task": str(task)[:240], "summary": status or "finished", "error": str(error)[:240]},
        workspace_id=getattr(run, "workspace_id", None) or None,
    )
