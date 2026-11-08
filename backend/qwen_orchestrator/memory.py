"""Durable Qwen run memory. The next plan reads a short block from this file.

The database is ~/.DPO/qwen_memory.sqlite unless QWEN_MEMORY_DB is set.
A missing or unreadable file means the plan proceeds with no memory.
"""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path
from typing import Optional


def memory_path() -> Path:
    override = (os.environ.get("QWEN_MEMORY_DB") or "").strip()
    if override:
        return Path(override)
    return Path.home() / ".DPO" / "qwen_memory.sqlite"


class QwenMemory:
    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path is not None else memory_path()

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.path), timeout=2)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id TEXT,
                workspace_id TEXT,
                workspace_name TEXT,
                project_path TEXT,
                runtime TEXT,
                model TEXT,
                strategy TEXT,
                user_goal TEXT,
                plan_json TEXT,
                status TEXT,
                created_at REAL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id TEXT,
                session_id TEXT,
                cli TEXT,
                action_type TEXT,
                command TEXT,
                outcome TEXT,
                error TEXT
            )
            """
        )
        return conn

    def record_run(
        self,
        *,
        plan_id: str,
        workspace_id: str,
        workspace_name: str,
        project_path: str,
        runtime: str,
        model: str,
        strategy: str,
        user_goal: str,
        plan_json: str,
        status: str,
    ) -> None:
        try:
            with self._connect() as conn:
                conn.execute("DELETE FROM runs WHERE plan_id = ?", (plan_id,))
                conn.execute(
                    """
                    INSERT INTO runs (
                        plan_id, workspace_id, workspace_name, project_path,
                        runtime, model, strategy, user_goal, plan_json, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        plan_id, workspace_id, workspace_name, project_path,
                        runtime, model, strategy, user_goal, plan_json, status, time.time(),
                    ),
                )
        except Exception as exc:
            print(f"[QwenMemory] record_run failed: {exc}", flush=True)

    def update_status(self, plan_id: str, status: str) -> None:
        try:
            with self._connect() as conn:
                conn.execute("UPDATE runs SET status = ? WHERE plan_id = ?", (status, plan_id))
        except Exception as exc:
            print(f"[QwenMemory] update_status failed: {exc}", flush=True)

    def record_steps(self, plan_id: str, steps: list) -> None:
        try:
            with self._connect() as conn:
                conn.execute("DELETE FROM steps WHERE plan_id = ?", (plan_id,))
                conn.executemany(
                    """
                    INSERT INTO steps (plan_id, session_id, cli, action_type, command, outcome, error)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            plan_id,
                            step.get("session_id") or "",
                            step.get("cli") or "",
                            step.get("action_type") or "",
                            step.get("command") or "",
                            step.get("outcome") or "",
                            step.get("error") or "",
                        )
                        for step in steps
                    ],
                )
        except Exception as exc:
            print(f"[QwenMemory] record_steps failed: {exc}", flush=True)

    def prompt_block(self, workspace_id: str = "", project_path: str = "", limit: int = 3) -> str:
        """Recent outcomes for this workspace only. Capped so the prompt stays small."""
        try:
            with self._connect() as conn:
                if (workspace_id or "").strip():
                    rows = conn.execute(
                        """
                        SELECT plan_id, user_goal, status, model FROM runs
                        WHERE workspace_id = ?
                        ORDER BY created_at DESC LIMIT ?
                        """,
                        (workspace_id, limit),
                    ).fetchall()
                elif (project_path or "").strip():
                    rows = conn.execute(
                        """
                        SELECT plan_id, user_goal, status, model FROM runs
                        WHERE project_path = ? AND (workspace_id IS NULL OR workspace_id = '')
                        ORDER BY created_at DESC LIMIT ?
                        """,
                        (project_path, limit),
                    ).fetchall()
                else:
                    return ""
                lines = []
                for plan_id, goal, status, model in rows:
                    steps = conn.execute(
                        """
                        SELECT session_id, cli, outcome, error FROM steps
                        WHERE plan_id = ? ORDER BY id
                        """,
                        (plan_id,),
                    ).fetchall()
                    step_bits = []
                    for session_id, cli, outcome, error in steps:
                        bit = f"{cli or 'cli'} {session_id}: {outcome or 'unknown'}"
                        if error:
                            bit += f" ({error})"
                        step_bits.append(bit)
                    detail = "; ".join(step_bits) if step_bits else "no steps"
                    lines.append(f"- [{status}] {model}: {goal} — {detail}")
        except Exception as exc:
            print(f"[QwenMemory] prompt_block failed: {exc}", flush=True)
            return ""
        text = "\n".join(lines)
        if len(text) > 1500:
            text = text[:1500].rstrip() + "…"
        return text
