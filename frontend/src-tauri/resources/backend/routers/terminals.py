#!/usr/bin/env python3
"""Terminals router for tto-web.

Handles terminal lifecycle: open, close, command execution, file transfer.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api", tags=["terminals"])


@router.get("/terminals")
async def get_terminals():
    """Get all terminals."""
    # Placeholder - full implementation in main.py
    return JSONResponse({"terminals": []})


@router.post("/terminal/open")
async def open_terminal():
    """Open a new terminal."""
    # Placeholder - full implementation in main.py
    return JSONResponse({"ok": True})


@router.post("/terminals/{tty}/launch")
async def launch_cli(tty: str):
    """Launch CLI in existing terminal."""
    # Placeholder - full implementation in main.py
    return JSONResponse({"ok": True})


@router.post("/terminals/{tty}/send-file")
async def send_file_to_terminal(tty: str):
    """Send file to terminal."""
    # Placeholder - full implementation in main.py
    return JSONResponse({"ok": True})


@router.post("/terminals/{tty}/command")
async def send_command_to_terminal(tty: str):
    """Send command to terminal."""
    # Placeholder - full implementation in main.py
    return JSONResponse({"ok": True})


@router.post("/terminals/{tty}/close")
async def close_terminal(tty: str):
    """Close terminal."""
    # Placeholder - full implementation in main.py
    return JSONResponse({"ok": True})
