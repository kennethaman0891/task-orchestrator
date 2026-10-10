#!/usr/bin/env python3
"""Global state management for tto-web backend.

This module centralizes all mutable application state that was previously
scattered throughout main.py. Import this module to access shared state.
"""
from typing import Dict, List, Optional, Set
from fastapi import WebSocket

# Import models here to avoid circular imports
from .models import TerminalState


class ConnectionManager:
    """Manages WebSocket connections for dashboard, terminals, and command relay."""

    def __init__(self):
        self.dashboard_connections: List[WebSocket] = []
        self.terminal_connections: Dict[str, WebSocket] = {}  # tty -> websocket
        self.command_relay: Optional[WebSocket] = None  # desktop app relay

    async def connect_dashboard(self, websocket: WebSocket):
        await websocket.accept()
        self.dashboard_connections.append(websocket)

    async def connect_terminal(self, websocket: WebSocket, tty: str):
        await websocket.accept()
        self.terminal_connections[tty] = websocket

    async def connect_command_relay(self, websocket: WebSocket):
        """Desktop app connects as a command relay — receives injection
        requests for terminals it can reach (Rust PTY sessions)."""
        await websocket.accept()
        self.command_relay = websocket

    def disconnect(self, websocket: WebSocket, tty: Optional[str] = None):
        if websocket in self.dashboard_connections:
            self.dashboard_connections.remove(websocket)
        if tty and tty in self.terminal_connections:
            del self.terminal_connections[tty]
        if websocket is self.command_relay:
            self.command_relay = None

    async def broadcast_to_dashboards(self, message: dict):
        dead = []
        for conn in self.dashboard_connections:
            try:
                await conn.send_json(message)
            except Exception:
                dead.append(conn)
        # Remove dead sockets so they don't cause repeated failures every
        # broadcast cycle (every 3 s from scanner_loop).
        for conn in dead:
            try:
                self.dashboard_connections.remove(conn)
            except ValueError:
                pass

    async def send_to_terminal(self, tty: str, message: dict) -> bool:
        if tty in self.terminal_connections:
            try:
                await self.terminal_connections[tty].send_json(message)
                return True
            except Exception:
                pass
        return False


# Global state instances
manager = ConnectionManager()

# Core terminal state
terminals: Dict[str, TerminalState] = {}
terminal_windows: Dict[str, str] = {}  # tty -> Terminal.app window id
pending_cli: Dict[str, bool] = {}      # tty -> waiting for user to launch a CLI
tmux_pane_targets: Dict[str, str] = {} # tty -> tmux pane target (e.g. "session:0.0")
tmux_info: Dict[str, dict] = {}        # tty -> tmux session/window/pane info
_closed_ttys: Set[str] = set()         # ttys the user closed — scanner must not resurrect them

# Model and PID tracking
opencode_models: Dict[str, str] = {}   # tty -> model the running opencode was launched with
opencode_pids: Dict[str, int] = {}     # tty -> pid of the running opencode
claude_pids: Dict[str, int] = {}       # tty -> pid of Claude Code running on that tty

# Native Rust session links (desktop app <-> sidecar)
session_links: Dict[str, dict] = {}    # session_id -> {tty, cwd, agent}

# Shared workspace definitions (mobile/remote sync)
stored_workspaces: List[dict] = []
