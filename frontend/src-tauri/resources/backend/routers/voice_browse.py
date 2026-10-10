#!/usr/bin/env python3
"""Voice and browsing router for tto-web.

Handles voice transcription and web browsing proxy endpoints.
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api", tags=["voice", "browse"])


@router.post("/voice/transcribe")
async def voice_transcribe(request: Request):
    """Transcribe voice message."""
    # Placeholder - full implementation in main.py
    return JSONResponse({"text": "", "provider": ""})


@router.get("/browse")
async def browse_proxy(url: str = ""):
    """Proxy web browsing requests."""
    # Placeholder - full implementation in main.py
    return JSONResponse({"html": "", "url": url})
