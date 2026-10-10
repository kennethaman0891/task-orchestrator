#!/usr/bin/env python3
"""Basic API endpoints router for tto-web.

Contains health checks, version info, downloads, and notification endpoints.
These are stateless endpoints that don't require terminal or session state.
"""
import json
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi import WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api", tags=["basic"])

# Version file path
_VERSION_PATH = Path(__file__).resolve().parent.parent / "version.json"


@router.get("/health")
async def health():
    """Health check endpoint."""
    return JSONResponse({"status": "ok", "time": datetime.now(timezone.utc).isoformat() + "Z"})


@router.get("/version")
async def get_version():
    """Return app version metadata including download URLs."""
    try:
        data = json.loads(_VERSION_PATH.read_text())
    except Exception:
        data = {"version": "0.1.0", "ok": False, "downloads": {}}
    return JSONResponse(data)


@router.get("/downloads")
async def downloads_page():
    """Serve the downloads landing page."""
    # Try the frontend dist first (built version), then the source public dir.
    base_path = Path(__file__).resolve().parent.parent.parent
    dist_path = base_path / "frontend" / "dist" / "downloads.html"
    src_path = base_path / "frontend" / "public" / "downloads.html"

    for path in (dist_path, src_path):
        if path.exists():
            return FileResponse(path)

    return JSONResponse({"error": "downloads page not found"}, status_code=404)


@router.post("/notify")
async def send_notification(payload: dict):
    """Send a proactive notification via WhatsApp."""
    message = payload.get("message", "")
    if not message:
        return JSONResponse({"ok": False, "error": "message required"}, status_code=400)

    sent = False
    try:
        from remote.notify import push
        await asyncio.to_thread(push, "system_error", message, "")
        sent = True
    except Exception as exc:
        print(f"[notify] WhatsApp push failed: {exc}", flush=True)

    return JSONResponse({"ok": sent})


@router.websocket("/ws/health")
async def websocket_health(websocket: WebSocket):
    """Simple WebSocket health check endpoint."""
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
            elif data == "disconnect":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
