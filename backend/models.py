#!/usr/bin/env python3
"""Pydantic models for tto-web backend."""
import uuid
import time
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class TerminalInfo(BaseModel):
    tty: str
    agent: str = ""
    cli: str = ""  # foreground CLI detected by the process scan (vim, htop, opencode, node, git, ...)
    cwd: str = ""
    pid: int = 0
    session_name: str = ""  # tmux session name
    window_name: str = ""   # tmux window name
    pane_title: str = ""    # tmux pane title
    is_live: bool = True    # true if terminal currently open
    registered_at: float = Field(default_factory=time.time)
    last_seen: float = Field(default_factory=time.time)


class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    description: str
    status: str = "pending"  # pending, running, done, blocked
    created_at: float = Field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    summary: str = ""
    context: str = ""
    output: str = ""  # captured terminal output for this task
    model: str = ""   # model the task must run under ("" = terminal default)
    screenshot_path: str = ""  # PNG proof captured by the frontend at completion


class TerminalState(BaseModel):
    info: TerminalInfo
    current_task: Optional[Task] = None
    next_task: Optional[Task] = None
    history: List[Task] = []
    queue: List[Task] = []
    session_context: str = ""   # persistent context/description for this session
    session_summary: str = ""   # one-word/short summary of what was done in this session
    session_name: str = ""      # user-set session name (overrides tmux)
    model: str = ""             # selected model (provider/model key from /api/models)
    applied_model: str = ""     # model the running agent was last (re)started with
    live_output: str = ""       # last captured terminal output (updated every 1s)
    suggested_task: str = ""    # AI-suggested next task (generated from context/history)
    paused: bool = False        # remote /pause: queued tasks do not auto-start


class LaunchCommand(BaseModel):
    command: str


class OpenTerminalRequest(BaseModel):
    command: Optional[str] = None
    cwd: Optional[str] = None
    title: Optional[str] = None


class SendFileRequest(BaseModel):
    path: str
    content: str


class CommandRequest(BaseModel):
    command: str
    workdir: Optional[str] = None


class OrchestratorSplit(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class OrchestratorRun(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class AgentConfig(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class OrchestratorTerminal(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class OrchestratorRunRequest(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class AgentConfigUpdate(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class TokenLimitUpdate(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class TodoCompileRequest(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class RunCommandRequest(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class FileContent(BaseModel):
    content: str
    encoding: str = "utf-8"


class PaneCreate(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class PaneAttach(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class AnnotationTaskRequest(BaseModel):
    # Placeholder - actual fields depend on usage
    pass


class OpencodeMessagePayload(BaseModel):
    # Placeholder - actual fields depend on usage
    message: str
    session_id: str


class SessionNotInWorkspace(Exception):
    """Raised when a session is not found in the requested workspace."""
    pass
