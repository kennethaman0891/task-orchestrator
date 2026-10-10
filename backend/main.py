#!/usr/bin/env python3
"""DPO backend - FastAPI + WebSocket server for Terminal Task Orchestrator."""
import asyncio
import base64
import io
import ipaddress
import json
import os
import signal
import re
import shlex
import socket
import struct
import subprocess
import sys
import time
import shutil
import urllib.error
import urllib.request
from urllib.parse import urlparse, urljoin, quote
import httpx
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# POSIX-only modules — unavailable on Windows; gate all uses behind IS_POSIX.
IS_WINDOWS = os.name == "nt"
IS_POSIX = not IS_WINDOWS

if IS_POSIX:
    import fcntl
    import pty
    import termios
else:
    fcntl = None  # type: ignore[misc]
    pty = None  # type: ignore[misc]
    termios = None  # type: ignore[misc]

# Collab (remote collaboration) — stdlib + local modules
from collab_store import get_collab_store
from audit import get_audit_recorder, audit_event


def _ensure_path_environment() -> None:
    """Ensure PATH includes standard tool directories on macOS and Linux,
    even when launched from a GUI app environment (like /Applications/Task Orchestrator.app)
    which defaults to a restricted system-only PATH."""
    extra_dirs = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        os.path.expanduser("~/.local/bin"),
        os.path.expanduser("~/.cargo/bin"),
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ]
    cur_dirs = [d for d in os.environ.get("PATH", "").split(os.pathsep) if d]
    for d in extra_dirs:
        if os.path.isdir(d) and d not in cur_dirs:
            cur_dirs.insert(0, d)
    os.environ["PATH"] = os.pathsep.join(cur_dirs)


_ensure_path_environment()


def _load_dotenv_file() -> None:
    """Minimal .env loader (no dependency): reads KEY=VALUE lines from a .env
    next to this file and fills any env vars that aren't already set."""
    try:
        env_path = Path(__file__).resolve().parent / ".env"
        if not env_path.exists():
            return
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = val.strip().strip('"').strip("'")
    except Exception:
        pass


_load_dotenv_file()


def _kill_pid(pid: int, force: bool = False):
    """Terminate a process cross-platform. On Windows, force=True sends an
    immediate kill (no graceful SIGTERM equivalent). On POSIX, force=False is
    SIGTERM, force=True is SIGKILL."""
    if pid <= 0:
        return
    if IS_WINDOWS:
        # Windows has no SIGTERM/SIGKILL; use taskkill which mirrors POSIX:
        # without /F = graceful, with /F = forceful kill.
        flag = "/F" if force else ""
        subprocess.run(["taskkill", flag, "/PID", str(pid)],
                       capture_output=True, timeout=3)
    else:
        sig = signal.SIGKILL if force else signal.SIGTERM
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass


from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, UploadFile, File, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

# Import file watcher
from file_watcher import watch_directory, stop_watching, get_workspace_root

# Import blocked-path fragments for file endpoint protection
from remote.config import BLOCKED_PATH_FRAGMENTS

STATE_DIR = Path.home() / ".DPO"
STATE_FILE = STATE_DIR / "state.json"

CLOSED_GRACE_SECONDS = 30  # how long a missing terminal stays listed before being pruned

# Background task registry — keeps references so crashed loops can be restarted
_background_tasks: dict[str, asyncio.Task] = {}


def _run_with_restart(name: str, coro, delay: float = 5):
    """Run a background loop with auto-restart on crash (exponential backoff)."""
    async def _wrapped():
        retries = 0
        while True:
            try:
                await coro
            except Exception as exc:
                retries += 1
                wait = min(delay * (2 ** (retries - 1)), 60)
                print(f"[bg:{name}] crashed ({exc!r}), restarting in {wait:.0f}s (attempt {retries})", flush=True)
                await asyncio.sleep(wait)
            else:
                retries = 0  # reset on normal exit
            await asyncio.sleep(delay)

    task = asyncio.create_task(_wrapped())
    _background_tasks[name] = task
    return task


app = FastAPI(title="DPO", version="0.1.0")

# CORS + Origin policy.
#
# This server can spawn terminals and execute shell commands, so it must not be
# reachable by arbitrary web pages.  A wildcard ("*") would let ANY site the
# user visits drive the API on http://localhost:8765 (localhost CSRF / DNS
# rebinding).  Default to an explicit localhost + Tauri allowlist; override with
# TTO_CORS_ORIGINS (comma-separated).  Set TTO_CORS_ORIGINS=* to opt back into
# the old permissive behavior (not recommended).
_DEFAULT_CORS_ORIGINS = [
    "tauri://localhost",        # Tauri production webview (macOS)
    "https://tauri.localhost",  # Tauri production webview (Windows/Linux)
    "http://localhost:1420", "http://127.0.0.1:1420",  # Vite dev (Tauri default)
    "http://localhost:1421", "http://127.0.0.1:1421",  # Vite dev (this project)
    "http://localhost:5173", "http://127.0.0.1:5173",  # Vite standard dev
    "http://localhost:8765", "http://127.0.0.1:8765",  # dashboard served here
]
_cors_origins = [o.strip() for o in os.getenv("TTO_CORS_ORIGINS", ",".join(_DEFAULT_CORS_ORIGINS)).split(",") if o.strip()]
_allowed_origins = set(_cors_origins)
_cors_wildcard = "*" in _allowed_origins


def _origin_allowed(origin: Optional[str]) -> bool:
    """Whether a browser Origin may talk to this server.

    Missing/empty Origin is allowed on purpose: native clients (the Rust relay,
    the Python agent, curl) send no Origin.  Browsers ALWAYS send Origin on
    cross-site requests, so a page on evil.com hitting localhost:8765 is
    rejected.  TTO_CORS_ORIGINS=* disables the check.

    Additionally, when LAN access is enabled via collab settings, we allow
    same-host origins (i.e., http://<server-ip>:8765 from a browser on the LAN)
    because those are authenticated via token, not IP.
    """
    if _cors_wildcard or not origin:
        return True
    if origin in _allowed_origins:
        return True
    # LAN mode: allow same-host origins (authenticated via token)
    try:
        store = get_collab_store()
        if store.is_lan_allowed():
            # Parse origin and check if host matches this server's bound host
            from urllib.parse import urlparse
            parsed = urlparse(origin)
            if parsed.scheme in ("http", "https"):
                # Get the port from the origin
                origin_host = parsed.hostname
                origin_port = parsed.port or (443 if parsed.scheme == "https" else 80)
                # Check if this matches the port we're bound to
                if origin_port == int(os.environ.get("TTO_PORT", "8765")):
                    # Same-host origin in LAN mode - allow (token auth handles the rest)
                    return True
    except Exception:
        pass
    return False


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _cors_wildcard else _cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Security headers middleware
@app.middleware("http")
async def _security_headers_middleware(request: Request, call_next):
    """Add security headers to all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response



@app.middleware("http")
async def _origin_guard(request: Request, call_next):
    """Reject cross-origin browser requests to this command-executing server.

    Complements CORS: CORS only stops the browser from READING the response,
    but a 'simple' cross-site POST still reaches the handler and would execute.
    Enforced on state-changing methods only — safe methods (GET/HEAD/OPTIONS)
    are still protected from cross-origin READING by the CORS policy above, and
    scoping here avoids blocking same-origin navigations that omit an Origin.
    Requests with no Origin (native clients) always pass.
    """
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if not _origin_allowed(request.headers.get("origin")):
            return JSONResponse({"detail": "origin not allowed"}, status_code=403)
    return await call_next(request)


# Collab: Token auth middleware for non-loopback API requests
# This runs AFTER origin guard so origin is already validated
@app.middleware("http")
async def _collab_auth_middleware(request: Request, call_next):
    """
    Require valid collab token for non-loopback API requests.
    
    - Loopback (127.0.0.1, ::1, localhost): no token required (owner/desktop app)
    - Non-loopback: token required for /api/* except public endpoints
    - Public endpoints: /api/health, /api/collab/login, /api/version
    - Attaches collab_user to request.state if authenticated
    """
    client_host = request.client.host if request.client else "unknown"
    is_loopback = client_host in ("127.0.0.1", "::1", "localhost")
    
    # Skip non-API paths
    if not request.url.path.startswith("/api/"):
        return await call_next(request)
    
    # Public endpoints that don't require auth
    public_paths = ("/api/health", "/api/collab/login", "/api/version")
    if request.url.path in public_paths:
        return await call_next(request)
    
    # For non-loopback, require token
    if not is_loopback:
        # Check for token
        auth = request.headers.get("Authorization", "")
        token = None
        if auth.startswith("Bearer "):
            token = auth[7:]
        else:
            token = request.query_params.get("token")
        
        if not token:
            return JSONResponse({"detail": "Authentication required"}, status_code=401)
        
        store = get_collab_store()
        user = store.validate_token(token)
        if not user:
            return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)
        
        # Attach user to request state for endpoints to use
        request.state.collab_user = {
            "username": user.username,
            "permission": user.permission,
            "allowed_workspaces": user.allowed_workspaces,
        }
    
    return await call_next(request)


async def _ws_origin_ok(websocket: WebSocket) -> bool:
    """Reject a WebSocket handshake from a disallowed browser Origin.

    WebSockets are NOT covered by CORS, so without this any web page could open
    ws://localhost:8765/... and drive terminals.  Same policy as the HTTP guard:
    a present-but-disallowed Origin is refused; a missing Origin (native Rust
    relay / Python agent clients) is allowed."""
    origin = websocket.headers.get("origin")
    if _origin_allowed(origin):
        return True
    print(f"[ws] REJECTED origin={origin!r} allowed={_cors_origins} path={websocket.url.path}", flush=True)
    try:
        await websocket.close(code=1008, reason="origin not allowed")
    except Exception:
        pass
    return False


async def _ws_collab_auth(websocket: WebSocket) -> Optional[Dict]:
    """
    Validate collab token for non-loopback websocket connections.
    
    Returns collab_user dict if authenticated, None if loopback (owner),
    raises WebSocketDisconnect (closes connection) if auth required but missing/invalid.
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    is_loopback = client_host in ("127.0.0.1", "::1", "localhost")
    
    if is_loopback:
        return None  # Owner - no auth needed
    
    # Non-loopback: require token in query params (WS doesn't have headers easily)
    token = websocket.headers.get("authorization", "").replace("Bearer ", "") or websocket.query_params.get("token")
    if not token:
        # Also check Authorization header (some clients support it)
        auth = websocket.headers.get("authorization", "") or websocket.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    
    if not token:
        print(f"[ws] REJECTED no token from {client_host} path={websocket.url.path}", flush=True)
        try:
            await websocket.close(code=1008, reason="authentication required")
        except Exception:
            pass
        return None  # Will be treated as rejected
    
    store = get_collab_store()
    user = store.validate_token(token)
    if not user:
        print(f"[ws] REJECTED invalid token from {client_host} path={websocket.url.path}", flush=True)
        try:
            await websocket.close(code=1008, reason="invalid or expired token")
        except Exception:
            pass
        return None
    
    return {
        "username": user.username,
        "permission": user.permission,
        "allowed_workspaces": user.allowed_workspaces,
    }

@app.get("/api/health")
async def health():
    return JSONResponse({"status": "ok", "time": datetime.now(timezone.utc).isoformat() + "Z"})

# --- Version / Downloads -----------------------------------------------------

_VERSION_PATH = Path(__file__).resolve().parent / "version.json"

@app.get("/api/version")
async def get_version():
    """Return app version metadata including download URLs."""
    try:
        data = json.loads(_VERSION_PATH.read_text())
    except Exception:
        data = {"version": "0.1.0", "ok": False, "downloads": {}}
    return JSONResponse(data)

@app.get("/downloads")
async def downloads_page():
    """Serve the downloads landing page at /downloads (no trailing .html needed)."""
    # When bundled inside an .app: __file__ is Contents/Resources/backend/main.py,
    # so parent.parent.parent / "downloads.html" finds the bundled landing page.
    # When running from the dev tree: parent.parent / "frontend" / "dist" / ...
    _parent = Path(__file__).resolve().parent
    dist_path = _parent.parent.parent / "downloads.html"  # bundled in .app Resources/
    if not dist_path.exists():
        dist_path = _parent.parent / "frontend" / "dist" / "downloads.html"  # dev tree
    src_path = _parent.parent / "frontend" / "public" / "downloads.html"  # dev source
    for path in (dist_path, src_path):
        if path.exists():
            return FileResponse(path)
    return JSONResponse({"error": "downloads page not found"}, status_code=404)


@app.post("/api/notify")
async def send_notification(payload: dict):
    """Send a proactive notification.
    Body: { category: str, message: str }
    """
    message = payload.get("message", "")
    if not message:
        return JSONResponse({"ok": False, "error": "message required"}, status_code=400)
    sent = False
    try:
        from remote.notify import push
        await asyncio.to_thread(push, "system_error", message, "")  # best-effort WhatsApp too
    except Exception as exc:
        print(f"[notify] WhatsApp push failed: {exc}", flush=True)
    return JSONResponse({"ok": sent})


# --- /api/browse: frame-busting-header-stripping proxy --------------------
# The embedded browser iframe loads real sites through this proxy so that
# X-Frame-Options and Content-Security-Policy frame-ancestors directives
# are stripped before the response reaches the webview.

def _is_ip_private(ip_str: str) -> bool:
    """Return True if *ip_str* is a private / reserved / link-local address.

    Loopback (127.x, ::1) is intentionally NOT blocked: the whole point of the
    embedded browser in a dev tool is opening the developer's OWN localhost
    servers (Django runserver, Vite, Docker, APIs, dashboards…). LAN/private
    ranges remain blocked by default — a hostile page rendered through the
    proxy must not be able to probe the user's home network. Set
    TTO_ALLOW_PRIVATE_BROWSE=1 to also allow private/LAN targets.
    """
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return addr.is_private or addr.is_reserved or addr.is_link_local


def _browse_allow_private() -> bool:
    """Env opt-in: TTO_ALLOW_PRIVATE_BROWSE=1 .. LAN targets through /api/browse."""
    return os.environ.get("TTO_ALLOW_PRIVATE_BROWSE", "").strip().lower() in ("1", "true", "yes", "on")


def _validate_browse_url(raw_url: str) -> str:
    """Validate and normalise a /api/browse target URL.

    Raises ValueError with a user-facing message on any rejection.
    Returns the absolute URL string on success.
    """
    parsed = urlparse(raw_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http/https URLs are allowed")

    hostname = parsed.hostname or ""
    if not hostname:
        raise ValueError("Missing hostname")

    allow_private = _browse_allow_private()

    # Always block the cloud-metadata endpoints — even with private browsing
    # enabled — they are link-local and would hand provider credentials to any
    # page rendered through the proxy.
    if hostname in ("169.254.169.254", "metadata.google.internal", "metadata"):
        raise ValueError("Access to internal/loopback hosts is forbidden")

    # Loopback (localhost, 127.x, ::1) is ALWAYS allowed: it is the developer's
    # own machine, and the sidecar itself is bound to 127.0.0.1. No block here.

    # Default (private browsing OFF): block private/LAN hostnames before DNS.
    if not allow_private:
        # Handle 172.16-31.x.x range
        if hostname.startswith("172."):
            try:
                second = int(hostname.split(".")[1])
                if 16 <= second <= 31:
                    raise ValueError(
                        "Private/LAN addresses are blocked. "
                        "Set TTO_ALLOW_PRIVATE_BROWSE=1 to allow them."
                    )
            except (IndexError, ValueError):
                pass
        for prefix in ("10.", "192.168.", "169.254."):
            if hostname.startswith(prefix):
                raise ValueError(
                    "Private/LAN addresses are blocked. "
                    "Set TTO_ALLOW_PRIVATE_BROWSE=1 to allow them."
                )

    # Resolve the hostname and verify the IP isn't private (DNS rebinding guard).
    try:
        resolved = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for family, _, _, _, sockaddr in resolved:
            # Loopback resolutions (e.g. "localhost") are fine; the user owns them.
            try:
                if ipaddress.ip_address(sockaddr[0]).is_loopback:
                    continue
            except ValueError:
                pass
            if _is_ip_private(sockaddr[0]) and not allow_private:
                raise ValueError(
                    "Target resolves to a private/internal address. "
                    "Set TTO_ALLOW_PRIVATE_BROWSE=1 to allow it."
                )
    except ValueError:
        raise
    except Exception:
        raise ValueError("DNS resolution failed for the target hostname")

    return parsed.geturl()


# --- Navigation rewriting for proxied HTML --------------------------------
# Every page served through /api/browse runs these rewrites so that clicking
# a link or submitting a form INSIDE the proxied page stays inside the proxy:
# raw absolute URLs (which would send their own frame-blockers and blank the
# iframe) become /api/browse?url=<abs> — the exact URL form the frontend uses
# as the iframe src.  When that rewritten URL is later requested, it flows
# back through this endpoint and _validate_browse_url runs again, so the
# existing SSRF validation still guards every hop; there is no new hole.

# Schemes / link types that must never be proxied (left untouched).
_BROWSE_SKIP_PREFIXES = (
    "mailto:", "tel:", "javascript:", "data:", "ftp:", "file:", "about:",
)

# Matches a full <a>/<area>/<form> open tag (quote-aware so `>` inside an
# attribute value can't truncate the match).  Only these NAVIGATION tags are
# rewritten — <link>/<base>/<img> asset hrefs stay as-is and keep resolving
# against the injected <base href>.
_NAV_TAG_RE = re.compile(
    r"""<(?P<tag>a|area|form)\b(?P<attrs>(?:"[^"]*"|'[^']*'|[^"'>])*)>""",
    re.IGNORECASE,
)

# Matches href=/action= with a double-quoted, single-quoted or unquoted value.
_NAV_ATTR_RE = re.compile(
    r"""(?P<name>href|action)\s*=\s*(?P<value>"[^"]*"|'[^']*'|[^\s"'>]+)""",
    re.IGNORECASE,
)


def _document_base(url: str) -> str:
    """Directory-style <base href> for a document URL.

    A document at https://site/a/b (no trailing slash) lives in the
    https://site/a/ directory; a document at https://site/a/b/ already has a
    directory URL and root URLs stay as-is.  Query/fragment are dropped:
    <base> takes a directory, not a full URL.
    """
    parsed = urlparse(url)
    path = parsed.path or "/"
    if not path.endswith("/"):
        head, _sep, _tail = path.rpartition("/")
        path = head + "/"
    return parsed._replace(path=path, params="", query="", fragment="").geturl()


def _proxy_link_url(href: str, final_url: str) -> str:
    """Rewrite a navigation href so it stays inside the proxy.

    - Absolute http(s) URLs (https://en.wikipedia.org/...) become
      /api/browse?url=<urlencoded absolute>.
    - Relative URLs (/wiki/Foo, ../foo, //cdn.example/x) are first resolved
      against the FINAL post-redirect URL, then proxied the same way.
    - '#fragments', '', and non-http schemes (mailto:/tel:/javascript:/data:/)
      are left untouched — fragments stay same-page, special schemes must
      reach the browser directly.
    Returns the original value when no rewrite applies.
    """
    href = href.strip()
    if not href or href.startswith("#"):
        return href
    if href.lower().startswith(_BROWSE_SKIP_PREFIXES):
        return href
    absolute = urljoin(final_url, href)
    parsed = urlparse(absolute)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return href
    return "/api/browse?url=" + quote(absolute, safe="")


def _rewrite_attrs_in_tag(tag: str, final_url: str) -> str:
    """Rewrite href/action attribute values inside one <a>/<area>/<form> tag."""
    def _rewrite_attr(m: re.Match) -> str:
        name = m.group("name")
        raw = m.group("value")
        if raw[0] in "\"'":
            value = raw[1:-1]
            new = _proxy_link_url(value, final_url)
            if new != value:
                return f'{name}="{new}"'
        else:
            new = _proxy_link_url(raw, final_url)
            if new != raw:
                return f"{name}={new}"
        return m.group(0)

    return _NAV_ATTR_RE.sub(_rewrite_attr, tag)


def _rewrite_navigation(html: str, final_url: str) -> str:
    """Rewrite every <a href>/<area href>/<form action> in proxied HTML.

    Regex-based (no HTML parser dependency): scans only navigation tags, so
    the injected <base> and asset <link>/<img> hrefs are never touched.
    """
    def _rewrite_tag(m: re.Match) -> str:
        return _rewrite_attrs_in_tag(m.group(0), final_url)

    return _NAV_TAG_RE.sub(_rewrite_tag, html)


# --- /api/voice/transcribe: speech-to-text for the 🎤 mic button -------------
# The Tauri WKWebView has no Web Speech API, so the frontend captures audio
# (getUserMedia) and POSTs it here. We transcribe through the FIRST available
# provider, all keyed off credentials the user ALREADY has:
#   1. TTO_STT_URL + TTO_STT_KEY + TTO_STT_MODEL  (explicit override)
#   2. OpenRouter  (openai/gpt-audio-mini)        via opencode auth.json
# The response is normalized to {"text": ...} regardless of provider.

def _stt_provider() -> dict:
    """Pick the best available speech-to-text provider from local creds.

    Priority:
      1. TTO_STT_URL + TTO_STT_KEY + TTO_STT_MODEL  (explicit override)
      2. VoiceFlow / Groq Whisper (TTO_GROQ_API_KEY) — free tier, generous limit
      3. OpenRouter  (openai/gpt-audio-mini)        via opencode auth.json
    """
    url = os.environ.get("TTO_STT_URL", "").strip()
    if url:
        return {
            "url": url,
            "key": os.environ.get("TTO_STT_KEY", "").strip(),
            "model": os.environ.get("TTO_STT_MODEL", "").strip(),
            "provider": "custom",
        }
    groq_key = os.environ.get("TTO_GROQ_API_KEY", "").strip() or os.environ.get("GROQ_API_KEY", "").strip()
    if groq_key:
        return {
            "url": "https://api.groq.com/openai/v1/audio/transcriptions",
            "key": groq_key,
            "model": os.environ.get("TTO_STT_MODEL", "").strip() or "whisper-large-v3-turbo",
            "provider": "groq",
            "label": "VoiceFlow",
        }
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if openai_key:
        return {
            "url": "https://api.openai.com/v1/audio/transcriptions",
            "key": openai_key,
            "model": os.environ.get("TTO_STT_MODEL", "").strip() or "whisper-1",
            "provider": "openai",
            "label": "OpenAI Whisper",
        }
    try:
        auth_path = Path.home() / ".local" / "share" / "opencode" / "auth.json"
        auth = json.loads(auth_path.read_text())
        or_key = (auth.get("openrouter") or {}).get("key", "")
        if or_key:
            return {
                "url": "https://openrouter.ai/api/v1/chat/completions",
                "key": or_key,
                "model": "openai/gpt-audio-mini",
                "provider": "openrouter",
            }
    except Exception:
        pass
    return {}


def _stt_model_candidates(prov: dict) -> list:
    """Ordered model candidates for a provider. OpenRouter tries the configured
    model first, then a few audio-capable chat models, so a single 404 /
    'model not found' doesn't kill the mic button. Groq (VoiceFlow) tries the
    configured Whisper model first, then smaller Whisper models."""
    if prov.get("provider") == "openai":
        return [prov.get("model") or "whisper-1"]
    if prov.get("provider") == "openrouter":
        falls = [
            "openai/gpt-audio-mini",
            "openai/gpt-4o-audio-preview",
            "openai/gpt-4o-mini-audio-preview",
        ]
        out, seen = [], set()
        for m in ([prov.get("model") or ""] + falls):
            m = (m or "").strip()
            if m and m not in seen:
                seen.add(m)
                out.append(m)
        return out
    if prov.get("provider") == "groq":
        falls = ["whisper-large-v3-turbo", "whisper-large-v3", "whisper-medium", "whisper-small"]
        out, seen = [], set()
        for m in ([prov.get("model") or ""] + falls):
            m = (m or "").strip()
            if m and m not in seen:
                seen.add(m)
                out.append(m)
        return out
    m = (prov.get("model") or "").strip()
    return [m] if m else []


def _stt_format(content_type: str) -> str:
    """Map an upload Content-Type to the OpenAI input_audio format field."""
    ct = (content_type or "").lower()
    if "wav" in ct:
        return "wav"
    if "mpeg" in ct or "mp3" in ct:
        return "mp3"
    # WKWebView MediaRecorder emits audio/mp4 (AAC); OpenAI-format models
    # accept mp4 containers under the 'mp4' name on OpenRouter.
    if "mp4" in ct or "aac" in ct or "m4a" in ct:
        return "mp4"
    return "webm"


def _stt_to_wav(audio: bytes) -> bytes:
    """Normalize arbitrary recorded audio to 16 kHz mono WAV via ffmpeg.

    Every STT provider (OpenRouter, Whisper-compatible, LM Studio) accepts
    PCM WAV, while webm/mp4/AAC from MediaRecorders is frequently rejected.
    Returns the ORIGINAL bytes when ffmpeg is unavailable or conversion fails."""
    try:
        exe = shutil.which("ffmpeg")
        if not exe or not os.path.exists(exe):
            for cand in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"):
                if os.path.exists(cand):
                    exe = cand
                    break
        if not exe or not os.path.exists(exe):
            return audio
        proc = subprocess.run(
            [exe, "-nostdin", "-loglevel", "error", "-i", "-",
             "-ac", "1", "-ar", "16000", "-f", "wav", "-"],
            input=audio, capture_output=True, timeout=45,
        )
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout
    except Exception:
        pass
    return audio


def _stt_transcribe_multipart(url: str, key: str, wav: bytes, model: str) -> str:
    """Multipart form upload to OpenAI-compatible Whisper endpoints (Groq, OpenAI)."""
    boundary = "----TTOVoiceFlowBoundary"
    parts: list = []
    parts.append(
        ('--%s\r\nContent-Disposition: form-data; name="file"; '
         'filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n' % boundary).encode()
        + wav
        + b"\r\n"
    )
    parts.append(
        ('--%s\r\nContent-Disposition: form-data; name="model"\r\n\r\n%s\r\n' % (boundary, model)).encode()
    )
    parts.append(
        ('--%s\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n' % boundary).encode()
    )
    parts.append(("--%s--\r\n" % boundary).encode())
    body = b"".join(parts)

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": "Bearer %s" % key,
            "Content-Type": "multipart/form-data; boundary=%s" % boundary,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) VoiceFlow-TTO/2.3",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    text = (data or {}).get("text") or ""
    return text.strip()


def _stt_transcribe_groq(key: str, wav: bytes, model: str) -> str:
    return _stt_transcribe_multipart("https://api.groq.com/openai/v1/audio/transcriptions", key, wav, model)


def _stt_error(status_code: int, model: str, provider: str = "voice provider", extra: str = "") -> str:
    """Turn a raw provider HTTP status into a message the user can act on."""
    name = {"groq": "VoiceFlow (Groq Whisper)", "openrouter": "OpenRouter"}.get(provider, "Voice provider")
    if status_code in (401, 403):
        return (
            f"{name} rejected your key (HTTP {status_code}). "
            + (extra or "Check TTO_GROQ_API_KEY / opencode auth."))
    if status_code == 402:
        return f"{name} needs payment — add credits, then press 🎤 again."
    if status_code == 404:
        return f"{name} couldn't find model '{model}' (HTTP 404)."
    if status_code == 429:
        return f"{name} is rate-limited (429) — wait a bit and retry."
    return f"{name} error (HTTP {status_code}).{(' ' + extra) if extra else ''}"


@app.post("/api/voice/transcribe")
async def voice_transcribe(request: Request):
    """Transcribe an audio blob (webm/ogg/wav) to text for the mic button."""
    prov = _stt_provider()
    if not prov:
        raise HTTPException(
            503,
            "No speech-to-text provider configured. Add an OpenRouter key in "
            "opencode (opencode auth login) or set TTO_STT_URL/TTO_STT_KEY.",
        )
    ctype = request.headers.get("content-type", "application/octet-stream")
    audio = await request.body()
    if not audio:
        raise HTTPException(400, "Empty audio upload")
    if len(audio) > 25 * 1024 * 1024:
        raise HTTPException(413, "Audio too large (25 MB max)")

    # Normalize to WAV so provider format hangs disappear; fall back to the
    # original content type when normalization isn't possible.
    wav = _stt_to_wav(audio)
    b64 = base64.b64encode(wav).decode("ascii")
    fmt = "wav" if wav is not audio else _stt_format(ctype)

    candidates = _stt_model_candidates(prov)
    if not candidates:
        raise HTTPException(502, "Voice provider has no STT model configured.")

    errors: list = []
    if prov.get("provider") in ("groq", "openai"):
        # ── VoiceFlow / OpenAI path: multipart WAV upload to Whisper ──────────
        for model in candidates:
            try:
                endpoint = prov.get("url") or "https://api.groq.com/openai/v1/audio/transcriptions"
                text = _stt_transcribe_multipart(endpoint, prov["key"], wav, model)
                if text:
                    return {"ok": True, "text": text, "provider": prov["provider"], "model": model}
                errors.append(f"{model}: provider returned no text")
            except urllib.error.HTTPError as he:
                extra = ""
                try:
                    err_json = json.loads(he.read().decode("utf-8", "replace"))
                    msg = (err_json.get("error") or {}).get("message") or ""
                    if msg:
                        extra = msg[:220]
                except Exception:
                    pass
                if he.code in (401, 402, 403, 429):
                    raise HTTPException(502, _stt_error(he.code, model, prov["provider"], extra))
                errors.append(_stt_error(he.code, model, prov["provider"], extra))
            except Exception as exc:  # network / timeout / parse
                errors.append(f"{model}: {exc}")
        raise HTTPException(502, "Voice transcription failed: " + " | ".join(errors))

    for model in candidates:
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Transcribe this audio. Reply with ONLY the exact words spoken, no commentary."},
                        {"type": "input_audio", "input_audio": {"data": b64, "format": fmt}},
                    ],
                }
            ],
            "max_tokens": 800,
        }
        req = urllib.request.Request(
            prov["url"],
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {prov['key']}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
            text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "").strip()
            if text:
                return {"ok": True, "text": text, "provider": prov["provider"], "model": model}
            errors.append(f"{model}: provider returned no text")
        except urllib.error.HTTPError as he:
            # Hard stops: retrying other models won't fix bad keys or missing
            # credits. Soft stops (404 model / 400 format) try the next model.
            if he.code in (401, 402, 403, 429):
                raise HTTPException(502, _stt_error(he.code, model, prov.get("provider", "")))
            errors.append(_stt_error(he.code, model, prov.get("provider", "")))
        except Exception as exc:  # network / timeout / parse
            errors.append(f"{model}: {exc}")

    raise HTTPException(502, "Voice transcription failed: " + " | ".join(errors))


@app.get("/api/browse")
async def browse_proxy(url: str = ""):
    """Proxy a URL for embedding in the app iframe.

    Strips X-Frame-Options and Content-Security-Policy headers so the page
    can render inside the sidecar's iframe.  For HTML responses, injects a
    ``<base>`` tag (pointing at the FINAL post-redirect URL) so relative
    asset URLs resolve against the real site, and rewrites anchor hrefs and
    form actions so ALL navigation stays inside the proxy.
    """
    if not url or not url.strip():
        return JSONResponse({"error": "Missing url parameter"}, status_code=400)

    # ── Validate (scheme + SSRF) ──
    try:
        target_url = _validate_browse_url(url.strip())
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)

    # ── Fetch with manual redirect following to prevent SSRF bypass ──
    MAX_REDIRECTS = 10
    redirect_count = 0
    resp = None

    try:
        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(15.0),
            verify=True,
        ) as client:
            current_url = target_url
            while True:
                resp = await client.get(
                    current_url,
                    headers={
                        "User-Agent": (
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/120.0.0.0 Safari/537.36"
                        ),
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9",
                    },
                )
                if resp.is_redirect and "location" in resp.headers:
                    redirect_count += 1
                    if redirect_count > MAX_REDIRECTS:
                        return JSONResponse({"error": "Too many redirects"}, status_code=400)
                    next_url = urljoin(str(resp.url), resp.headers["location"])
                    try:
                        current_url = _validate_browse_url(next_url)
                    except ValueError as exc:
                        return JSONResponse(
                            {"error": f"Redirect blocked by security policy: {exc}"},
                            status_code=400,
                        )
                    continue
                break
    except Exception as exc:
        return JSONResponse({"error": f"Failed to fetch target: {exc}"}, status_code=502)

    # ── Size limit: 10MB max response ──
    MAX_RESPONSE_SIZE = 10 * 1024 * 1024  # 10MB
    content_length = len(resp.content)
    if content_length > MAX_RESPONSE_SIZE:
        return JSONResponse(
            {"error": f"Response too large: {content_length} bytes (max 10MB)"},
            status_code=413
        )

    # ── Build response headers (strip frame-busters) ──
    resp_headers: Dict[str, str] = {}
    for key, value in resp.headers.items():
        lower = key.lower()
        if lower in ("x-frame-options", "content-security-policy"):
            continue
        # httpx auto-decompresses response bodies, so the upstream
        # content-encoding/length no longer describe the bytes we serve.
        if lower in ("content-encoding", "content-length"):
            continue
        resp_headers[key] = value

    # ── Body: inject <base> (final URL) + rewrite navigation for HTML ──
    body = resp.content
    content_type = resp.headers.get("content-type", "")
    if "text/html" in content_type:
        # Use the FINAL url (after server-side redirects) as the base so
        # relative CSS/JS/images resolve; navigation links are separately
        # rewritten (see _rewrite_navigation) so clicks stay proxied.  The
        # rewritten /api/browse?url=... links re-enter this endpoint and
        # hit _validate_browse_url again, so the SSRF guard holds for every
        # hop users can take from the proxied page.
        final_url = str(resp.url)
        base_tag = f'<base href="{_document_base(final_url)}">'
        try:
            charset = resp.encoding or "utf-8"
            html = body.decode(charset, errors="replace")
            if "<head" in html.lower():
                html = re.sub(
                    r"(<head[^>]*>)",
                    rf"\1\n{base_tag}",
                    html,
                    count=1,
                    flags=re.IGNORECASE,
                )
            else:
                html = base_tag + "\n" + html
            html = _rewrite_navigation(html, final_url)
            body = html.encode(charset, errors="replace")
        except Exception:
            pass  # Non-decodable HTML — serve as-is

    return StreamingResponse(
        io.BytesIO(body),
        status_code=resp.status_code,
        media_type=content_type,
        headers=resp_headers,
    )


# --- Native session links (pushed by the desktop app) ----------------------
@app.post("/api/sessions")
async def sync_sessions(sessions: List[dict]):
    """Desktop app pushes its live native sessions: [{id, tty, cwd, agent, ...}].
    REPLACES the whole map (authoritative) so stale links from closed sessions or
    previous runs never linger. Lets mobile/remote clients resolve Rust session
    ids to sidecar ttys."""
    session_links.clear()
    for s in sessions:
        sid = s.get("id")
        if not sid:
            continue
        session_links[sid] = {
            "tty": s.get("tty") or "",
            "cwd": s.get("cwd") or "",
            "agent": s.get("agent") or "",
            "cli": s.get("cli") or "",
        }
    save_state()
    return {"ok": True, "count": len(sessions)}

@app.get("/api/sessions")
async def get_sessions():
    sessions = []
    for sid, link in session_links.items():
        entry = {"id": sid, **link}
        # Prefer the live scan's foreground CLI if we have it for this tty.
        tinfo = terminals.get(link.get("tty") or "")
        if tinfo is not None and tinfo.info.cli:
            entry["cli"] = tinfo.info.cli
        sessions.append(entry)
    return {"sessions": sessions}

# --- Shared workspace definitions (desktop -> mobile sync) ------------------
@app.get("/api/workspaces")
async def get_workspaces():
    """Workspaces = truth ON DISK (what voice creates) merged with stored state.

    Reads ~/tto-workspaces/* directories as the ground truth so a workspace
    created by voice ALWAYS appears, no matter which process or how fresh.
    """
    import os as _os
    home_ws = _os.path.expanduser("~/tto-workspaces")
    disk_names = set()
    try:
        if _os.path.isdir(home_ws):
            for name in _os.listdir(home_ws):
                p = _os.path.join(home_ws, name)
                if _os.path.isdir(p) and not name.startswith("."):
                    disk_names.add(name)
    except Exception:
        disk_names = set()

    disk_list = [{"name": n, "projectPath": _os.path.join(home_ws, n)} for n in sorted(disk_names)]
    return {"workspaces": disk_list}

@app.put("/api/workspaces")
async def put_workspaces(workspaces: List[dict]):
    """Merge incoming workspaces with existing ones.

    When the desktop app restarts it pushes stale localStorage data (pane tty
    = null) that would overwrite correct assignments.  To prevent that:
    - Any pane whose incoming tty is ``None`` but already has a valid tty on
      the sidecar keeps its existing tty.
    - If ALL incoming panes are None, skip this workspace entirely (it's
      clearly stale startup data).
    """
    existing_by_id = {w["id"]: w for w in stored_workspaces}
    merged: List[dict] = []
    for incoming in workspaces:
        wid = incoming.get("id")
        old = existing_by_id.get(wid)
        if old and "panes" in incoming and "panes" in old:
            # Check if ALL incoming panes are None — skip entirely
            all_none = all(not p.get("tty") for p in incoming.get("panes", []))
            has_valid = any(p.get("tty") for p in old.get("panes", []))
            if all_none and has_valid:
                # Keep the old workspace — incoming is stale
                merged.append(old)
                continue
            # Partial merge: preserve valid ttys where incoming is None
            old_panes = {p["id"]: p for p in old["panes"]}
            for pane in incoming.get("panes", []):
                pid = pane.get("id")
                old_pane = old_panes.get(pid)
                if old_pane and not pane.get("tty") and old_pane.get("tty"):
                    pane["tty"] = old_pane["tty"]
        merged.append(incoming)
    stored_workspaces[:] = merged
    save_state()
    return {"ok": True}

DIAG_LOG = Path.home() / ".local/share/tto/diag.log"

@app.post("/api/diag-log")
async def diag_log(request: Request):
    """Diagnostic sink: frontend posts boot/error events here so we can see why the page is blank."""
    try:
        body = await request.json()
        DIAG_LOG.parent.mkdir(parents=True, exist_ok=True)
        # Strip CR/LF from single-line fields so a caller can't forge log lines
        # (log injection).  `stack` is intentionally multi-line and kept as-is.
        def _oneline(v: Any, n: int) -> str:
            return str(v).replace("\r", " ").replace("\n", " ")[:n]
        source = _oneline(body.get("source", "?"), 64)
        payload = _oneline(body.get("message", body.get("args", "")), 500)
        stack = str(body.get("stack", ""))[:800]
        line = f"{datetime.now(timezone.utc).isoformat()}Z | {source} | {payload}"
        if stack and stack != "None":
            line += f"\n    STACK: {stack}"
        with open(DIAG_LOG, "a") as f:
            f.write(line + "\n")
    except Exception as e:
        with open(DIAG_LOG, "a") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()}Z | diag-log-error | {e}\n")
    return JSONResponse({"ok": True})

# In-memory state (persisted to JSON)
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

OPencode_DB = Path.home() / ".local/share/opencode/opencode.db"

def _clean_model_field(model: str) -> str:
    """opencode stores the model as a JSON descriptor like
    '{"id":"auto/coding:free","providerID":"omniroute",...}' in some rows and
    a plain 'provider/model' key in others.  UI code expects the plain key —
    normalize here so raw JSON never leaks into the UI."""
    model = (model or "").strip()
    if model.startswith("{"):
        try:
            d = json.loads(model)
            model = str(d.get("id") or d.get("modelID") or "")
        except Exception:
            m = re.search(r'"id"\s*:\s*"([^"]+)"', model)
            model = m.group(1) if m else ""
    return model.strip()


def get_session_tokens(directory: str):
    """Read token usage for the most recent opencode session in a directory."""
    if not OPencode_DB.exists() or not directory:
        return {"tokens_input": 0, "tokens_output": 0, "cost": 0.0, "model": "", "session_title": ""}
    try:
        import sqlite3
        conn = sqlite3.connect(f"file:{OPencode_DB}?mode=ro", uri=True)
        conn.execute("PRAGMA query_only=ON")
        row = conn.execute(
            "SELECT tokens_input, tokens_output, cost, model, title "
            "FROM session WHERE parent_id IS NULL AND directory=? "
            "ORDER BY time_updated DESC LIMIT 1",
            (directory,)
        ).fetchone()
        conn.close()
        if row:
            return {
                "tokens_input": row[0] or 0,
                "tokens_output": row[1] or 0,
                "cost": row[2] or 0.0,
                "model": _clean_model_field(row[3]),
                "session_title": row[4] or "",
            }
    except Exception:
        pass
    return {"tokens_input": 0, "tokens_output": 0, "cost": 0.0, "model": "", "session_title": ""}

# --- Token Usage Dashboard ---
TOKEN_THRESHOLD = 100_000  # hide models that have used fewer tokens than this
TOKEN_CACHE_TTL = 60       # seconds between opencode.db re-aggregations
token_config: Dict[str, Any] = {
    "limits": {
        "omniroute": 1_500_000_000,   # OmniRoute Local AI = 1.5B combined budget
        "freellmpool": 1_000_000_000,  # FreeLLMPool = 1B+ free tokens
        "llmbuffet": 800_000_000,      # LLMBuffet = 800M+ free tokens
    },
    "labels": {
        "omniroute": "OmniRoute Local AI",
        "freellmpool": "FreeLLMPool (1B+ free)",
        "llmbuffet": "LLMBuffet (800M+ free)",
    },
}
_token_cache: Dict[str, Any] = {"data": None, "ts": 0.0}

def _parse_model(model_json: str) -> tuple[str, str]:
    """Parse opencode model JSON -> (id, providerID)."""
    try:
        d = json.loads(model_json)
        return d.get("id", model_json), d.get("providerID", "opencode")
    except Exception:
        return model_json, "opencode"

def aggregate_token_usage() -> dict:
    """Aggregate token usage across ALL opencode sessions (top-level only),
    grouped by model+provider, applying configured limits and the 1-lakh rule.
    Counts input + output + reasoning tokens (cache reads/writes excluded —
    they are reused tokens, not new consumption)."""
    groups: Dict[str, dict] = {}
    if OPencode_DB.exists():
        try:
            import sqlite3
            conn = sqlite3.connect(f"file:{OPencode_DB}?mode=ro", uri=True)
            conn.execute("PRAGMA query_only=ON")
            rows = conn.execute(
                "SELECT model, "
                "COALESCE(SUM(tokens_input),0)+COALESCE(SUM(tokens_output),0)"
                "+COALESCE(SUM(tokens_reasoning),0) "
                "FROM session WHERE parent_id IS NULL GROUP BY model"
            ).fetchall()
            conn.close()
        except Exception:
            rows = []
        for model_json, used in rows:
            mid, provider = _parse_model(model_json)
            if provider == "omniroute":
                key = "omniroute"
            elif provider == "freellmpool":
                key = "freellmpool"
            elif provider == "llmbuffet":
                key = "llmbuffet"
            else:
                key = f"{provider}/{mid}"
            g = groups.setdefault(key, {"key": key, "name": mid, "provider": provider, "used": 0})
            g["used"] += used or 0
    limits = token_config.get("limits", {})
    labels = token_config.get("labels", {})
    # Budgeted providers must always appear even at 0 usage (e.g. FreeLLMPool, LLMBuffet)
    for key, limit in limits.items():
        groups.setdefault(key, {"key": key, "name": key, "provider": key, "used": 0})
    models = []
    total_used = 0
    total_limit = 0
    limited_used = 0
    for g in groups.values():
        limit = limits.get(g["key"])
        g["name"] = labels.get(g["key"]) or g["name"]
        g["limit"] = limit
        g["left"] = (limit - g["used"]) if limit is not None else None
        # Show models over the 1-lakh threshold OR any model with a configured limit
        if g["used"] >= TOKEN_THRESHOLD or limit is not None:
            models.append(g)
            total_used += g["used"]
            if limit is not None:
                total_limit += limit
                limited_used += g["used"]
    models.sort(key=lambda m: m["used"], reverse=True)
    return {
        "models": models,
        "totals": {
            "used": total_used,
            "available": total_limit,
            "left": total_limit - limited_used,
        },
        "threshold": TOKEN_THRESHOLD,
        "updated_at": time.time(),
    }

def get_token_usage_cached() -> dict:
    now = time.time()
    if _token_cache["data"] is None or now - _token_cache["ts"] > TOKEN_CACHE_TTL:
        _token_cache["data"] = aggregate_token_usage()
        _token_cache["ts"] = now
    return _token_cache["data"]

# --- Next-task suggestion via OmniRoute local LLM ---
OMNIROUTE_URL = os.environ.get("OMNIROUTE_URL", "http://localhost:20128/v1/chat/completions")
OMNIROUTE_SUGGEST_MODEL = os.environ.get("OMNIROUTE_SUGGEST_MODEL", "auto/coding:cheap")

_TRANSITIONS = r"^(however|also|additionally|moreover|in any case|in general|in any event|as a result|so|thus|therefore|but|and|then|now|anyway|ok|okay|alright|great|good|firstly|secondly),?\s+"

def _strip_transitions(s: str) -> str:
    prev = None
    while prev != s:
        prev = s
        s = re.sub(_TRANSITIONS, "", s, flags=re.I)
    return s


def _tty_label(tty: str) -> str:
    """Extract a human-readable label from a tty identifier, cross-platform."""
    if IS_WINDOWS:
        # Windows doesn't use ttys — just strip common prefixes
        return tty.replace("pts/", "").replace("tty", "") or f"TTY-{tty}"
    if tty.startswith("ttys"):
        return tty.replace("ttys", "")  # macOS: "ttys003" → "003"
    if tty.startswith("pts/"):
        return tty.replace("pts/", "")  # Linux: "pts/0" → "0"
    return tty or "terminal"


def _clean_suggestion(s: str, max_len: int = 160) -> str:
    if not s:
        return ""
    s = _strip_transitions(s)
    s = re.sub(r"[*_#`~\[\]()]", "", s).strip()
    s = re.sub(r"(high|medium|low)\s*priority", "", s, flags=re.I)
    s = re.sub(r"^(?:the\s+)?next\s*(?:task|step)\s*[:–-]\s*", "", s, flags=re.I).strip()
    s = re.sub(r"^\d+[.)]\s*", "", s).strip()
    s = re.sub(r"\s+", " ", s).strip(" :-–")
    s = re.split(r"[-–]\s*(?:why|why this|note|because)", s, maxsplit=1, flags=re.I)[0].strip().strip('"\'')
    if 5 <= len(s) <= max_len and not re.match(
        r"^(next task|next step|detailed steps|steps|suggested|recommended|here are|here is|here's|based on|"
        r"the following|the logical|the next|if you|in this|for a|depending|this is|that depends|let me|"
        r"you should|you can|you could|it's|its worth|great progress|good progress|awesome|why|why this|"
        r"note|because|how|what|which|there are|as a|your|it looks like|the rest|to get)\b", s, re.I
    ):
        return s
    return ""

def _extract_next_task(text: str, max_len: int = 160) -> str:
    """Routed models return verbose roadmaps; extract the single top next step.
    Prefers explicit 'Next Task:' lead-ins, then the first numbered/bulleted
    roadmap item, then the first substantive sentence."""
    if not text:
        return ""
    text = text.replace("\u00a0", " ")
    for pat in [
        r"(?:suggested(?:\s+immediate)?\s*next\s*step|recommended\s*next\s*step|next\s*(?:task|step))\s*[:–-]\s*([^\n]{3,220})",
        r"(?:start\s+(?:with|by)\s+)([^\n]{3,220})",
    ]:
        m = re.search(pat, text, re.I)
        if m:
            cand = _clean_suggestion(m.group(1), max_len)
            if cand:
                return cand
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for line in lines:
        pre = re.sub(r"^\s*#+\s*", "", line).strip()
        if re.match(r"(?:\d+[.)]\s*|\*\*|[-•*]\s*)", pre):
            cand = _clean_suggestion(pre, max_len)
            if cand:
                return cand
    para = re.sub(r"\s+", " ", re.sub(r"[*_#`~>]", "", text))
    for sent in re.split(r"(?<=[.!?])\s+", para):
        cand = _clean_suggestion(sent, max_len)
        if cand:
            return cand
    return para[:max_len]

def _omniroute_api_key() -> str:
    key = os.environ.get("OMNIROUTE_API_KEY", "")
    if key:
        return key
    env_file = STATE_DIR / ".omniroute.env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("OMNIROUTE_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""

def call_llm(system: str, user: str, model: str = OMNIROUTE_SUGGEST_MODEL, max_tokens: int = 300) -> str:
    """Call an OpenAI-compatible endpoint (OmniRoute local, SSE streaming) and return the text."""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.5,
    }
    req = urllib.request.Request(
        OMNIROUTE_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {_omniroute_api_key()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return ""
    # Non-streaming JSON response
    stripped = raw.lstrip()
    if stripped.startswith("{"):
        try:
            data = json.loads(raw)
            return (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        except Exception:
            return ""
    # SSE streaming response: accumulate delta.content
    parts = []
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        chunk = line[5:].strip()
        if chunk == "[DONE]":
            break
        try:
            obj = json.loads(chunk)
        except Exception:
            continue
        for choice in obj.get("choices", []):
            delta = choice.get("delta", {}) or {}
            content = delta.get("content")
            if content:
                parts.append(content)
    return "".join(parts).strip()

def suggest_next_task(tty: str) -> str:
    """Generate a next-task suggestion from session context + current task + history."""
    t = terminals[tty]
    context = (t.session_context or "").strip()
    cur = t.current_task
    cur_desc = cur.description if cur else ""
    cur_status = cur.status if cur else ""
    history_lines = []
    for h in t.history[-5:]:
        line = f"- {h.description}"
        if h.summary:
            line += f" (done: {h.summary})"
        history_lines.append(line)
    history = "\n".join(history_lines)
    if not context and not cur_desc and not history:
        return ""
    system = (
        "You are a task planner for an AI coding terminal. Based on the session context, "
        "the current task, and recent completed work, suggest the single most valuable NEXT task. "
        "Respond with ONLY the task description: 1-2 sentences, actionable and specific, "
        "written as a shell-friendly instruction. No preamble, no bullets, no quotes, no code blocks."
    )
    user = (
        f"Session context:\n{context}\n\n"
        f"Current task: {cur_desc} ({cur_status})\n\n"
        f"Recent work:\n{history}\n\n"
        f"What should the next task be?"
    )
    return _extract_next_task(call_llm(system, user))

def generate_session_summary(tty: str) -> str:
    """Generate a short 'what was done in this session' label from context + history."""
    t = terminals[tty]
    context = (t.session_context or "").strip()
    cur_desc = t.current_task.description if t.current_task else ""
    done = [h.description for h in t.history if h.status == "done"]
    history_lines = "\n".join(f"- {h.description}" for h in t.history[-6:])
    if not context and not cur_desc and not history_lines:
        return ""
    system = "You are a strict labeler."
    user = (
        f"Session context: {context}\n"
        f"Last task: {cur_desc}\n"
        f"Tasks: {', '.join(h.description for h in t.history[-6:])}\n"
        f"Output 3 words or fewer."
    )
    try:
        raw = call_llm(system, user, max_tokens=20)
    except Exception:
        return ""
    raw = raw.strip().splitlines()[0] if raw.strip() else ""
    label = re.sub(r"[*_#`\"'()\[\]{}]|\s+", lambda m: "" if m.group(0) in "*_#`\"'()[]{}" else " ", raw).strip()
    label = re.sub(r"\s+", " ", label)
    return label[:60]

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

class ConnectionManager:
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

manager = ConnectionManager()

# ── Developer City: project registry (3D city data foundation) ───────────────
# The city registry is additive: new /api/projects endpoints + a
# `projects_changed` message on the existing /ws dashboard channel.
# Any failure here must never break core sidecar boot.
try:
    from routers import projects as _projects_mod
    app.include_router(_projects_mod.router)
    _projects_mod.set_broadcaster(manager.broadcast_to_dashboards)
    print("[projects] registry mounted (/api/projects)")
except Exception as _e:  # noqa: BLE001
    print(f"[projects] registry init FAILED (city data layer disabled): {_e!r}")

# Collab (remote collaboration) — additive, never breaks core boot
# Ensure backend directory is on sys.path so routers can import collab_store, audit
import sys
_backend_dir = Path(__file__).resolve().parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

try:
    from routers import collab as _collab_mod
    app.include_router(_collab_mod.router)
    print("[collab] router mounted (/api/collab)")
except Exception as _e:  # noqa: BLE001
    print(f"[collab] router init FAILED (collab disabled): {_e!r}")



# Voice WebRTC Pipeline (fully local STT+LLM+TTS) — additive, never breaks core boot
try:
    from voice.pipeline import VoicePipeline, VoiceConfig, get_voice_pipeline
    from voice.webrtc_handler import VoiceWebRTCHandler, create_voice_webrtc_handler
    from routers import voice_webrtc as _voice_webrtc_mod
    
    # Create voice pipeline with config from environment
    voice_config = VoiceConfig.from_env()
    voice_pipeline = VoicePipeline(voice_config)
    
    # Create and start WebRTC handler
    voice_handler = VoiceWebRTCHandler(voice_pipeline)
    
    # Register with router
    _voice_webrtc_mod.set_voice_handler(voice_handler)
    
    # Include router
    app.include_router(_voice_webrtc_mod.router)
    
    # Start handler (will be awaited in startup)
    # We store it for later startup/shutdown
    app.state.voice_handler = voice_handler
    app.state.voice_pipeline = voice_pipeline
    
    print("[voice-webrtc] router mounted (/api/voice)")
except Exception as _e:  # noqa: BLE001
    print(f"[voice-webrtc] router init FAILED (voice pipeline disabled): {_e!r}")

terminals: Dict[str, TerminalState] = {}
terminal_windows: Dict[str, str] = {}  # tty -> Terminal.app window id
pending_cli: Dict[str, bool] = {}      # tty -> waiting for user to launch a CLI
tmux_pane_targets: Dict[str, str] = {} # tty -> tmux pane target (e.g. "session:0.0")
tmux_info: Dict[str, dict] = {}        # tty -> tmux session/window/pane info
_closed_ttys: set = set()              # ttys the user closed — scanner must not resurrect them
# tty -> model the running opencode was launched with ('' = bare/default launch).
# Refreshed by scan_terminals; lets the frontend watcher decide /exit + relaunch
# vs. launch based on REAL processes instead of a guess from the agent label.
opencode_models: Dict[str, str] = {}
# tty -> pid of the running opencode (0 = none).  Lets the watcher poll for a
# PID CHANGE after a model restart instead of mistaking a still-running old CLI
# (swallowed /exit) for a successful relaunch.
opencode_pids: Dict[str, int] = {}
# tty -> pid of Claude Code running on that tty (0 = none). Used by the
# frontend to show ASKING when the CLI pauses for a permission/question
# inside its TUI (Claude Code stores sessions separately from opencode).
claude_pids: Dict[str, int] = {}

# Native Rust sessions pushed by the desktop app: session_id -> {tty, cwd, agent}.
# Lets API calls that arrive with a Rust session id (e.g. from the mobile web
# UI, which only knows session ids from the shared workspace state) resolve to
# the sidecar terminal key. Persisted in state.json.
session_links: Dict[str, dict] = {}

# Shared workspace definitions (mobile/remote sync). The desktop app pushes its
# workspace state here; web/mobile clients read it so they see the SAME
# workspaces and terminals. Persisted in state.json.
stored_workspaces: List[dict] = []

def _resolve_tty(tty: str) -> str:
    """Resolve a Rust session id to the sidecar tty key (identity otherwise)."""
    link = session_links.get(tty)
    return link["tty"] if link and link.get("tty") else tty

def terminal_payload(tty: str, t: TerminalState) -> dict:
    return {
        "tty": tty,
        "agent": t.info.agent,
        "cli": t.info.cli,
        "cwd": t.info.cwd,
        "is_live": t.info.is_live,
        "tokens": get_session_tokens(t.info.cwd),
        "session_name": t.session_name or t.info.session_name,
        "window_name": t.info.window_name,
        "pane_title": t.info.pane_title,
        "session_context": t.session_context,
        "session_summary": t.session_summary,
        "pending_cli": pending_cli.get(tty, False),
        "live_output": t.live_output,
        "suggested_task": t.suggested_task,
        "model": t.model,
        "applied_model": t.applied_model,
        "opencode_running": tty in opencode_models,
        "opencode_model": opencode_models.get(tty) or "",
        "opencode_pid": opencode_pids.get(tty, 0),
        "claude_running": tty in claude_pids,
        "claude_pid": claude_pids.get(tty, 0),
        "opencode_status": _opencode_live_status(tty),
        "current_task": t.current_task.model_dump() if t.current_task else None,
        "next_task": t.next_task.model_dump() if t.next_task else None,
        "queue": [tk.model_dump() for tk in t.queue],
        "history": [tk.model_dump() for tk in t.history],
        "paused": t.paused,
        "registered_at": t.info.registered_at,
    }

def load_state():
    global terminals, token_config, session_links, stored_workspaces
    if STATE_FILE.exists():
        # A SIGKILL mid-write can leave ~/.DPO/state.json truncated, which used
        # to raise JSONDecodeError straight through startup and take the whole
        # sidecar down.  Losing persisted state is recoverable; failing to boot
        # is not — so warn and continue with empty state.
        try:
            data = json.loads(STATE_FILE.read_text())
            for tty, tdata in data.get("terminals", {}).items():
                terminals[tty] = TerminalState(**tdata)
                # A fresh app run must NOT resurrect task state — tasks were
                # delivered to sessions that died with the previous run, so old
                # tasks/queues/history would reappear as idle work after a
                # close/reopen. Only the user's per-terminal MODEL preference
                # survives; everything task-related starts clean.
                t = terminals[tty]
                t.current_task = None
                t.next_task = None
                t.queue = []
                # t.history is PERSISTED and restored — it is a log of COMPLETED
                # work that must survive restarts (the user expects to see every
                # completed task, even from days ago). Only live session state
                # (current_task/next_task/queue) starts clean because those tasks
                # were bound to sessions that died with the previous run.
                t.session_context = ""
                t.session_summary = ""
                t.suggested_task = ""
                t.applied_model = ""
                t.live_output = ""
            if isinstance(data.get("token_config"), dict):
                # Deep-merge so new default limits/labels survive saved overrides
                for key, val in data["token_config"].items():
                    if isinstance(val, dict) and isinstance(token_config.get(key), dict):
                        token_config[key].update(val)
                    else:
                        token_config[key] = val
            if isinstance(data.get("session_links"), dict):
                session_links.update(data["session_links"])
            if isinstance(data.get("workspaces"), list):
                stored_workspaces[:] = data["workspaces"]
            # Restore global current workspace
            if isinstance(data.get("agent_current_ws"), str):
                global _AGENT_CURRENT_WS
                _AGENT_CURRENT_WS = data["agent_current_ws"]
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"[WARN] Corrupt state file {STATE_FILE}, starting fresh: {e}",
                  file=sys.stderr, flush=True)

def save_state():
    STATE_DIR.mkdir(exist_ok=True)
    data = {"terminals": {}, "token_config": token_config,
            "session_links": session_links, "workspaces": stored_workspaces}
    # Persist global current workspace
    if _AGENT_CURRENT_WS:
        data["agent_current_ws"] = _AGENT_CURRENT_WS
    for tty, t in terminals.items():
        td = t.model_dump()
        td.pop("live_output", None)
        data["terminals"][tty] = td
    STATE_FILE.write_text(json.dumps(data, indent=2))

@app.on_event("startup")
async def startup():
    load_state()
    _session_load()
    _run_with_restart("scanner", scanner_loop(), delay=3)
    _run_with_restart("output", output_loop(), delay=1)
    _run_with_restart("completion", completion_loop(), delay=3)
    _start_remote_loops()
    start_agent_loop()  # start the agentic monitoring loop
    # File watcher started on-demand per workspace (not global home dir)
    print(f"[startup] remote_loop check: enabled={_remote_cfg.enabled if _remote_cfg else '??'}", flush=True)
    # Start collab audit recorder
    try:
        recorder = get_audit_recorder()
        await recorder.start()
        print("[collab] audit recorder started", flush=True)


    except Exception as e:
        print(f"[collab] audit recorder failed to start: {e}", flush=True)

    # Start voice WebRTC handler
    try:
        if hasattr(app.state, 'voice_handler') and app.state.voice_handler:
            await app.state.voice_handler.start()
            print("[voice-webrtc] handler started", flush=True)
    except Exception as e:
        print(f"[voice-webrtc] handler start failed: {e}", flush=True)



@app.on_event("shutdown")
async def shutdown():
    stop_agent_loop()
    save_state()
    try:
        from remote import sleep as sleep_mod
        sleep_mod.allow_sleep()
    except Exception:
        pass
    # Stop collab audit recorder
    try:
        recorder = get_audit_recorder()
        await recorder.stop()
        print("[collab] audit recorder stopped", flush=True)
    except Exception as e:
        print(f"[collab] audit recorder stop error: {e}", flush=True)
    # Stop voice WebRTC handler
    try:
        if hasattr(app.state, 'voice_handler') and app.state.voice_handler:
            await app.state.voice_handler.stop()
            print("[voice-webrtc] handler stopped", flush=True)
    except Exception as e:
        print(f"[voice-webrtc] handler stop error: {e}", flush=True)

    for task in list(_background_tasks.values()):
        task.cancel()
async def scanner_loop():
    """Periodically scan for active terminals and update state.  The 1s
    cadence keeps the frontend status badges near-instant: the opencode live
    status is DB-derived and NOT tied to terminal output, so it needs a
    frequent unconditional broadcast (the output loop only fires on change)."""
    while True:
        await scan_terminals()
        await broadcast_state()
        await asyncio.sleep(1)

async def output_loop():
    """Capture live terminal output every 1 second for all terminals with tmux panes."""
    while True:
        await asyncio.sleep(1)
        changed = False
        for tty, t in list(terminals.items()):
            pane = tmux_pane_targets.get(tty) or await find_tmux_pane(tty)
            if not pane:
                continue
            # Capture live_output for all terminals with panes
            live = await asyncio.to_thread(_capture_pane, pane)
            if live != t.live_output:
                t.live_output = live
                changed = True
            # Also update current_task.output if a task is running
            if t.current_task and t.current_task.status in ("running", "pending"):
                if live and live != t.current_task.output:
                    t.current_task.output = live
                    changed = True
        if changed:
            await broadcast_state()

def detect_agent(cmd: str) -> str:
    cmd_lower = cmd.lower()
    if "agent.py" in cmd_lower: return "tto-agent"
    if "opencode" in cmd_lower: return "opencode"
    if "prime-agent" in cmd_lower: return "prime-agent"
    if "claude" in cmd_lower:
        # Guard against merely mentioning claude (e.g. `echo hello claude`,
        # scripts that take a path under a claude-named dir) when it isn't an
        # actual claude launch. Fall back to a loose match for running claude
        # binaries (e.g. full paths) to keep dashboard labeling correct.
        try:
            toks = shlex.split(cmd)
        except Exception:
            toks = cmd.split()
        if _is_claude_launch(toks):
            return "claude"
        if toks and os.path.basename(toks[0]).lower() in ("claude", "claude.exe", "claude-code"):
            return "claude"
        if "claude" in cmd_lower and ("claude" in os.path.basename(toks[0]).lower() if toks else False):
            return "claude"
        return ""
    if "codex" in cmd_lower: return "codex"
    if "gemini" in cmd_lower: return "gemini"
    if "deepcode" in cmd_lower: return "deepcode"
    if "aider" in cmd_lower: return "aider"
    return ""

# General CLI detection — matches ANY recognizable terminal foreground tool by
# its command basename (not just AI agents). The frontend maps the returned
# value to a brand logo via CliLogo (frontend/src/lib/cliLogos.tsx).
def detect_cli(cmd: str) -> str:
    # AI agents first (reuse the existing guarded detection).
    a = detect_agent(cmd)
    if a:
        return a
    cmd_lower = cmd.lower()
    try:
        toks = shlex.split(cmd)
    except Exception:
        toks = cmd.split()
    if not toks:
        return ""
    base = os.path.basename(toks[0]).lower().strip()
    if base.startswith("-"):
        base = base[1:]
    # Map basename -> recognizable cli id (matches cliLogos.tsx keys).
    table = {
        "vim": "vim", "nvim": "nvim", "neovim": "nvim",
        "htop": "htop", "top": "top", "btop": "btop", "bottom": "btop", "btm": "btop",
        "tmux": "tmux",
        "python": "python", "python3": "python", "python3.12": "python",
        "python3.11": "python", "python3.13": "python",
        "node": "node", "nodejs": "node",
        "npm": "npm", "npx": "npm", "yarn": "npm", "pnpm": "npm",
        "git": "git",
        "docker": "docker",
        "zsh": "zsh", "bash": "bash", "sh": "bash", "fish": "bash",
        "cargo": "cargo", "rustc": "rust",
        "go": "go", "gcc": "gcc", "clang": "clang",
        "ssh": "ssh", "curl": "curl", "wget": "curl",
        "grep": "grep", "rg": "rg", "sed": "sed", "awk": "awk",
        "ls": "ls", "cat": "cat", "man": "man", "less": "less", "more": "less",
        "kubectl": "kubectl", "minikube": "kubernetes",
        "code": "vscode", "cursor": "cursor",
        # AI / coding agents
        "freebuff": "freebuff", "atomic-agent": "atomic-agent",
        "codeium": "codeium", "continue": "continue", "amp": "amp",
        "zed": "zed",
        # Shells & env
        "starship": "starship", "oh-my-zsh": "zsh",
        # Databases & infra
        "sqlite3": "sqlite", "mysql": "mysql", "psql": "postgresql",
        "redis-cli": "redis", "mongosh": "mongodb",
        # Rust / infra tooling
        "tarpaulin": "cargo-tarpaulin", "just": "just", "make": "make",
        "watch": "watch", "tail": "tail", "head": "head",
    }
    result = table.get(base)
    if result:
        return result
    # Catch-all: return the basename itself so the frontend always has
    # *something* to label the terminal with (fallback badge shows it).
    return base if base else ""

# Runners that can launch a CLI binary, where the launched tool is determined
# by the first non-runner argument (e.g. `npx claude`, `bunx claude`).
_CLAUDE_RUNNERS = {
    "npx", "npx.cmd", "npmx", "bunx", "bun", "npm", "yarn", "pnpm",
    "node", "deno", "bunx.cmd", "npx-cli",
}

# Flags that cause Claude Code to resume / fork an existing session. These are
# stripped so a launch ALWAYS starts a fresh session. Flags that take a value
# (session id / prompt) consume their following token too.
_CLAUDE_RESUME_FLAGS = {"--continue", "-c", "--resume", "-r"}
# Value-less resume-related flags.
_CLAUDE_RESUME_SINGLE_FLAGS = {"--fork-session", "--append-system-prompt"}


def _is_claude_launch(toks):
    """Return True if the given token list (a parsed command) launches Claude
    Code. Conservative: returns False for commands that merely mention 'claude'
    without actually invoking the claude binary/runner."""
    if not toks:
        return False
    base = os.path.basename(toks[0]).lower()
    # Direct claude invocation, e.g. `claude`, `claude code`, `./claude`,
    # `/usr/local/bin/claude`.
    if base == "claude" or base == "claude.exe":
        return True
    if base in _CLAUDE_RUNNERS:
        # Runner: the tool is the first non-flag, non-runner argument.
        for arg in toks[1:]:
            low = arg.lower()
            # Skip runner's own flags/values conservatively.
            if low.startswith("-"):
                continue
            if low in ("exec", "dlx", "run", "--", "x"):
                continue
            arg_base = os.path.basename(arg).lower()
            if arg_base == "claude" or arg_base == "claude-code" or "claude" in arg_base:
                return True
            # First non-flag, non-runner token that isn't claude-linked =>
            # not a claude launch.
            if "claude" not in arg_base:
                return False
        return False
    # Any other base command is not a claude launch.
    return False


def normalize_claude_fresh(command: str) -> str:
    """If `command` launches Claude Code, return a version that ALWAYS starts a
    fresh session (stripping/neutralizing any resume behavior). If the command
    does not launch claude, return it unchanged.

    Handles `claude`, `claude code`, and runner-wrapped launches such as
    `npx @anthropic-ai/claude-code`, `bunx claude`, `npm exec claude`,
    `yarn claude`, `pnpm claude`, `node claude.js`, etc."""
    command = command.strip()
    if not command:
        return command

    # Parse into tokens. shlex.split is preferred; fall back to a plain split
    # for unusual quoting so we never crash on a user command.
    try:
        tokens = shlex.split(command)
    except Exception:
        tokens = command.split()
    if not tokens:
        return command

    if not _is_claude_launch(tokens):
        return command

    # We are launching claude and must guarantee a fresh session.
    out = []
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        low = tok.lower()
        if low in _CLAUDE_RESUME_FLAGS:
            # Resume/continue flag. Consume a following value if present and
            # not itself a flag.
            i += 1
            if i < n and tokens[i] and not tokens[i].startswith("-"):
                i += 1  # drop the session-id value
            continue
        if low in ("--fork-session", "--append-system-prompt"):
            i += 1
            continue
        if low.startswith("--resume"):
            # --resume=abc123 form.
            i += 1
            continue
        out.append(tok)
        i += 1

    return shlex.join(out)


def _lsof_cwd(pid: str) -> str:
    """Best-effort resolve the current working directory of a process via lsof,
    run in a worker thread. Returns '' on any error."""
    try:
        r = subprocess.run(["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"],
                           capture_output=True, text=True, timeout=2)
        for line in r.stdout.splitlines():
            if line.startswith("n"):
                return line[1:]
    except Exception:
        pass
    return ""


async def scan_terminals():
    """Scan running processes for terminals with AI agents."""
    global tmux_info
    import subprocess, re
    try:
        ps = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: subprocess.run(
                    ["ps", "-axo", "tty=,pid=,stat=,command="],
                    capture_output=True, text=True, timeout=5,
                ).stdout
            ), timeout=6,
        )
    except (asyncio.TimeoutError, subprocess.TimeoutExpired):
        # ps hung (common when zombie processes exist in proc table).
        # Skip this scan cycle — the scanner_loop retries in 3 seconds.
        print("[scan] ps timed out — skipping cycle", flush=True)
        return
    
    # Get tmux pane info: tty, session_name, window_name, pane_title, pane_target
    tmux_info = {}
    try:
        tmux_out = await asyncio.to_thread(
            lambda: subprocess.run(
                ["tmux", "list-panes", "-a", "-F",
                 "#{pane_tty}|#{session_name}|#{window_name}|#{pane_title}|#{session_name}:#{window_index}.#{pane_index}"],
                capture_output=True, text=True, timeout=2
            ).stdout
        )
        for line in tmux_out.splitlines():
            parts = line.strip().split("|")
            if len(parts) >= 6:
                tty = parts[0].replace("/dev/", "")
                tmux_info[tty] = {
                    "session_name": parts[1],
                    "window_name": parts[2],
                    "pane_title": parts[3],
                    "pane_target": parts[5],
                }
    except Exception as exc:
        print(f"[scan] tmux parse failed: {exc}", flush=True)
    by_tty = {}
    for line in ps.splitlines():
        line = line.strip()
        m = re.match(r"(\S+)\s+(\d+)\s+(\S+)\s+(.+)", line)
        if not m: continue
        tty, pid, stat, cmd = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        if tty in ("??", "?"): continue
        by_tty.setdefault(tty, []).append({"pid": int(pid), "cmd": cmd, "stat": stat})

    # Which ttys run opencode right now, and with what model ('-m X' arg, or
    # '' for a bare launch = opencode's default model).  Ground truth for the
    # frontend delivery watcher's /exit + relaunch decision.
    # Track previous opencode_models to invalidate cache for newly detected ttys
    prev_opencode_models = dict(opencode_models)
    opencode_models.clear()
    opencode_pids.clear()
    claude_pids.clear()
    for tty, procs in by_tty.items():
        for p in procs:
            args = p["cmd"].split()
            if not args:
                continue
            # Match the opencode binary itself (argv[0]) OR a runner like
            # `npx opencode` / `bunx opencode` (argv[1]).
            base0 = args[0].split("/")[-1]
            arg1 = args[1].split("/")[-1] if len(args) >= 2 else ""
            is_claude = base0 == "claude" or (
                base0 in ("npx", "bunx", "npm", "yarn", "pnpm", "node", "bun", "deno")
                and arg1 == "claude"
            )
            if is_claude:
                claude_pids[tty] = p["pid"]
            if "opencode" not in base0 and (len(args) < 2 or "opencode" not in args[1]):
                continue
            model = ""
            for j in range(len(args) - 1):
                if args[j] == "-m":
                    model = args[j + 1]
                    break
            opencode_models[tty] = model
            opencode_pids[tty] = p["pid"]
            # Record the CLI's boot moment: a PID change (or first sighting)
            # means THIS terminal started a fresh opencode, which created its
            # own session — the anchor for per-terminal session attribution.
            prev = _opencode_boot.get(tty)
            if not prev or prev[0] != p["pid"]:
                _opencode_boot[tty] = (p["pid"], time.time())
            break
    # Invalidate cache for ttys that newly have opencode running
    # (prevents stale "off" state from being served after opencode starts)
    for tty in opencode_models:
        if tty not in prev_opencode_models:
            _opencode_live_cache.pop(tty, None)
    # Also invalidate cache for ttys where opencode is running but cache has "off"
    # (handles case where opencode was already running before sidecar restart)
    for tty in opencode_models:
        cached = _opencode_live_cache.get(tty)
        if cached and cached[1].get("state") == "off":
            _opencode_live_cache.pop(tty, None)
    # A tty whose opencode CLI exited (or restarted under a new PID) must
    # forget its old session commitment + boot anchor so the next launch
    # re-attributes to its own fresh session.
    for tty in list(_opencode_boot.keys()):
        if tty not in opencode_pids:
            _opencode_boot.pop(tty, None)
            _opencode_term_session.pop(tty, None)
            _opencode_live_cache.pop(tty, None)
    
    now = time.time()
    for tty, procs in by_tty.items():
        # A tty the user explicitly closed must NOT be resurrected by the scan.
        if tty in _closed_ttys:
            continue
        agent = None
        shell = None
        cli = ""   # foreground CLI (vim, htop, opencode, node, git, ...)
        for p in procs:
            a = detect_agent(p["cmd"])
            if a: agent = a
            # Check if command is a shell (zsh, bash, fish, etc.) - match anywhere in command basename
            cmd_base = p["cmd"].split()[0].split("/")[-1]
            if cmd_base.startswith("-"):
                cmd_base = cmd_base[1:]
            if cmd_base in ("zsh", "bash", "fish", "sh"): shell = p
            # Foreground process group shows '+' in STAT — that's the CLI the
            # user is actually running. Fall back to any non-shell process.
            stat = p.get("stat", "")
            is_fg = "+" in stat
            c = detect_cli(p["cmd"])
            if c and c != "tto-agent":
                # When idle, the foreground IS the shell -> show the shell logo.
                if cmd_base in ("zsh", "bash", "fish", "sh"):
                    if is_fg:
                        cli = cmd_base
                elif is_fg:
                    cli = c
                elif not cli:
                    cli = c
        
        if not shell:
            continue
        
        if tty not in terminals:
            terminals[tty] = TerminalState(info=TerminalInfo(
                tty=tty, agent=agent or "", pid=shell["pid"] if shell else procs[0]["pid"]
            ))
        
        t = terminals[tty]
        t.info.agent = agent or t.info.agent
        # An agent pane's foreground is usually NOT the agent itself: the agent
        # may run detached/split while the shell stays the foreground group
        # (stat '+'), or the agent's runtime child (opencode runs under `node`)
        # is what's visible. Prefer the agent brand over the idle shell/runtime
        # so the pane shows the recognizable tool the user launched. A REAL
        # foreground CLI (vim, htop, tmux, git, ...) still wins.
        if agent and cli in ("", "node", "nodejs", "zsh", "bash", "sh", "fish"):
            cli = agent
        if cli:
            t.info.cli = cli
        t.info.last_seen = now
        
        # Add tmux session/window/pane info
        if tty in tmux_info:
            t.info.session_name = tmux_info[tty]["session_name"]
            t.info.window_name = tmux_info[tty]["window_name"]
            t.info.pane_title = tmux_info[tty]["pane_title"]
            tmux_pane_targets[tty] = tmux_info[tty]["pane_target"]
        
        if shell:
            # Get cwd via lsof — run off-thread so the blocking subprocess
            # never stalls the event loop (this runs per-terminal each scan).
            try:
                cwd = await asyncio.to_thread(_lsof_cwd, str(shell["pid"]))
                if cwd:
                    t.info.cwd = cwd
            except Exception as exc:
                print(f"[scan] lsof cwd failed for {tty}: {exc}", flush=True)

    # Prune stale terminals: if a terminal has not been seen for a grace
    # period it is truly closed — remove it entirely so it stops appearing
    # in the dashboard, the sidebar and the assign dropdown.
    changed = False
    for tty, t in list(terminals.items()):
        if tty not in by_tty:
            t.info.is_live = False
            if t.info.last_seen is None:
                t.info.last_seen = now
            if now - t.info.last_seen > CLOSED_GRACE_SECONDS:
                del terminals[tty]
                terminal_windows.pop(tty, None)
                pending_cli.pop(tty, None)
                tmux_pane_targets.pop(tty, None)
                changed = True
        else:
            t.info.is_live = True
            t.info.last_seen = now
    # Auto-clear close-tombstones once the processes are confirmed gone, so a
    # brand-new terminal on that tty can be detected normally later.
    for tty in list(_closed_ttys):
        if tty not in by_tty:
            _closed_ttys.discard(tty)
    if changed:
        save_state()

async def broadcast_state():
    """Send current state to all web dashboard connections."""
    # Use the TTL-cached aggregation so we don't open a fresh SQLite read and
    # re-aggregate on every 3s broadcast; the cache refreshes on its own TTL.
    payload = {"type": "state", "timestamp": time.time(), "terminals": {}, "token_usage": get_token_usage_cached()}
    for tty, t in terminals.items():
        if not t.info.is_live:
            continue  # closed terminals are pruned, never broadcast
        payload["terminals"][tty] = terminal_payload(tty, t)
    _refresh_orchestration_statuses()
    payload["orchestrations"] = [
        r.model_dump()
        for r in sorted(orchestrations.values(), key=lambda r: r.created_at, reverse=True)[:20]
    ]
    await manager.broadcast_to_dashboards(payload)

# --- REST API ---

@app.get("/api/terminals")
async def get_terminals():
    await scan_terminals()
    result = {"terminals": {}, "token_usage": get_token_usage_cached()}
    for tty, t in terminals.items():
        if not t.info.is_live:
            continue  # closed terminals are pruned, never served
        result["terminals"][tty] = terminal_payload(tty, t)
    _refresh_orchestration_statuses()
    result["orchestrations"] = [
        r.model_dump()
        for r in sorted(orchestrations.values(), key=lambda r: r.created_at, reverse=True)[:20]
    ]
    return result

class LaunchCommand(BaseModel):
    command: str

def _as_script_str(s: str) -> str:
    """Escape a value as an AppleScript double-quoted string literal."""
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'

_TTY_RE = re.compile(r"^[A-Za-z0-9/_.-]+$")

def _valid_tty(tty: str) -> bool:
    """A tty identifier must be a simple device-path token (e.g. 'ttys003').

    tty values flow in from client-controlled sources (the /ws/terminal/{tty}
    path, the remote resolver) and get interpolated into osascript below, so
    reject anything containing quotes, newlines, or other AppleScript/shell
    metacharacters — that closes the injection without changing normal use."""
    return bool(tty) and len(tty) <= 64 and bool(_TTY_RE.match(tty))

_MODEL_RE = re.compile(r"^[A-Za-z0-9._:/@-]+$")

def _safe_model(model: str) -> str:
    """A model key is a provider/name token (e.g. 'opencode/deepseek-v4').

    Anything containing shell metacharacters is rejected (returns '') so it can
    never break out of the `opencode -m <model>` command line it is
    interpolated into.  An empty result routes callers to a bare `opencode`
    launch (the agent's default model), so a bad value degrades safely."""
    model = (model or "").strip()
    return model if model and len(model) <= 128 and _MODEL_RE.match(model) else ""

def _open_terminal_window(command: str = "exec zsh", cwd: str = "") -> tuple[Optional[str], Optional[str]]:
    """Open a new Terminal.app window that comes to the front.
    Runs a tmux session so the terminal stays alive and output is capturable.
    If cwd is provided, the tmux session starts in that directory.
    Returns (tty, window_id) or (None, None)."""
    uid = uuid.uuid4().hex[:8]
    session_name = f"tto-{uid}"
    # Start tmux in the workspace directory (or ~ if no cwd given).
    # cwd is shell-quoted: it can be an arbitrary path (incl. spaces or shell
    # metacharacters) and is interpolated into a `do script` command line.
    cd_prefix = f"cd {shlex.quote(cwd)} && " if cwd and os.path.isdir(cwd) else "cd ~ && "
    cmd = f"{cd_prefix}tmux new-session -s {session_name}"
    script = f'''
    tell application "Terminal"
        activate
        do script {_as_script_str(cmd)}
    end tell
    '''
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=8)
    except Exception:
        return None, None
    out = r.stdout.strip()
    m = re.search(r"window id (\d+)", out)
    if r.returncode != 0 or not m:
        return None, None
    wid = m.group(1)
    tty = _window_tty(wid)
    if tty:
        # Query tmux for the pane target of this new session
        try:
            pane_r = subprocess.run(
                ["tmux", "list-panes", "-t", session_name,
                 "-F", "#{session_name}:#{window_index}.#{pane_index}"],
                capture_output=True, text=True, timeout=3)
            if pane_r.returncode == 0 and pane_r.stdout.strip():
                tmux_pane_targets[tty] = pane_r.stdout.strip().splitlines()[0]
        except Exception:
            pass
    return tty, wid

def _window_tty(wid: str) -> Optional[str]:
    """Get the tty of a Terminal window by its id."""
    try:
        r = subprocess.run(
            ["osascript", "-e",
             f'tell application "Terminal" to get tty of window id {_as_script_str(wid)}'],
            capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip().replace("/dev/", "") or None
    except Exception:
        pass
    return None

def _find_window_by_tty(tty: str) -> Optional[str]:
    if not _valid_tty(tty):
        return None
    script = f'''
    tell application "Terminal"
        repeat with w in windows
            if (tty of w) ends with "/{tty}" then return id of w
        end repeat
        return ""
    end tell
    '''
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=5)
        return r.stdout.strip() or None
    except Exception:
        return None

def _find_tab_by_tty(tty: str) -> tuple[Optional[str], Optional[int]]:
    """Find the (window_id, tab_index) of the Terminal.app TAB whose tty matches.

    Multi-tab windows are common (Rust workspace panes share one window), so
    window-level targeting is ambiguous — `do script in window` spawns a NEW
    tab.  Targeting `tab N of window id W` runs the command in the EXACT tab,
    which is what task delivery needs.  Returns (None, None) when not found.
    """
    if not _valid_tty(tty):
        return None, None
    script = f'''
    tell application "Terminal"
        repeat with w in windows
            repeat with i from 1 to count of tabs of w
                if (tty of tab i of w) ends with "/{tty}" then
                    return (id of w as string) & "|" & (i as string)
                end if
            end repeat
        end repeat
        return ""
    end tell
    '''
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=5)
        out = r.stdout.strip()
        if not out or "|" not in out:
            return None, None
        wid, idx = out.split("|", 1)
        return wid, int(idx)
    except Exception:
        return None, None

class OpenTerminalRequest(BaseModel):
    cwd: str = ""

@app.post("/api/terminal/open")
async def open_terminal(payload: OpenTerminalRequest = OpenTerminalRequest()):
    """Open a new Terminal.app window (comes to the front), pre-register it, and
    broadcast immediately so a new card appears at the top of the dashboard.
    The card shows a CLI-launch input (opencode / claude / etc.).
    If cwd is provided, the terminal opens in that directory."""
    tty, wid = _open_terminal_window(cwd=payload.cwd)
    if not tty:
        raise HTTPException(500, "Failed to open terminal window")
    if tty not in terminals:
        terminals[tty] = TerminalState(info=TerminalInfo(tty=tty, agent="", pid=0))
    terminals[tty].info.is_live = True
    terminals[tty].info.last_seen = time.time()
    terminal_windows[tty] = wid
    pending_cli[tty] = True
    save_state()
    await broadcast_state()
    return {"ok": True, "tty": tty}

@app.post("/api/terminals/{tty}/launch")
async def launch_cli(tty: str, payload: LaunchCommand):
    """Launch a CLI (opencode, claude, codex, ...) inside the terminal window."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    command = payload.command.strip()
    if not command:
        raise HTTPException(422, "Command is required")
    # Guarantee Claude Code always launches a fresh session (strip resume).
    command = normalize_claude_fresh(command)
    # Prefer tmux send-keys (reliable, works inside tmux sessions)
    pane = tmux_pane_targets.get(tty)
    if pane:
        try:
            await asyncio.to_thread(
                subprocess.run,
                ["tmux", "send-keys", "-t", pane, command, "Enter"],
                capture_output=True, timeout=2
            )
        except Exception as e:
            raise HTTPException(500, f"Failed to launch: {e}")
    else:
        wid = terminal_windows.get(tty) or _find_window_by_tty(tty)
        if not wid:
            raise HTTPException(400, "Could not find the Terminal window for this terminal")
        script = f'''
        tell application "Terminal"
            do script {_as_script_str(command)} in window id {_as_script_str(wid)}
        end tell
        '''
        try:
            r = await asyncio.to_thread(
                subprocess.run,
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=8
            )
        except Exception as e:
            raise HTTPException(500, f"Failed to launch: {e}")
        if r.returncode != 0:
            raise HTTPException(500, f"Failed to launch: {r.stderr.strip()[:300]}")
    pending_cli[tty] = False
    save_state()
    await broadcast_state()
    return {"ok": True, "tty": tty, "command": command}

class SendFileRequest(BaseModel):
    file_path: str

class CommandRequest(BaseModel):
    command: str

@app.post("/api/terminals/{tty}/send-file")
async def send_file_to_terminal(tty: str, payload: SendFileRequest):
    """Send a file's contents into the terminal's PTY."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    file_path = payload.file_path.strip()
    if not file_path:
        raise HTTPException(400, "file_path is required")
    try:
        content = Path(file_path).read_bytes()
    except FileNotFoundError:
        raise HTTPException(404, f"File not found: {file_path}")
    except PermissionError:
        raise HTTPException(403, f"Permission denied: {file_path}")
    except OSError as e:
        raise HTTPException(500, f"Failed to read file: {e}")
    # Use tmux send-keys to paste the raw content into the pane (no Enter).
    pane = tmux_pane_targets.get(tty) or await find_tmux_pane(tty)
    if pane:
        try:
            await asyncio.to_thread(
                subprocess.run,
                ["tmux", "send-keys", "-l", content.decode("utf-8", "replace")],
                capture_output=True, timeout=5,
            )
            return {"success": True}
        except Exception as e:
            raise HTTPException(500, f"Failed to send to terminal: {e}")
    # Fallback: Terminal.app do-script with escaped content.
    wid, _ = _find_tab_by_tty(tty)
    if not wid:
        wid = terminal_windows.get(tty) or _find_window_by_tty(tty)
    if wid:
        escaped = _as_script_str(content.decode("utf-8", "replace"))
        script = f'''
        tell application "Terminal"
            do script {escaped} in window id {_as_script_str(wid)}
        end tell
        '''
        try:
            r = await asyncio.to_thread(
                subprocess.run,
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=8
            )
            if r.returncode != 0:
                raise HTTPException(500, f"Failed to send: {r.stderr.strip()[:300]}")
            return {"success": True}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Failed to send to terminal: {e}")
    raise HTTPException(500, "No tmux pane or Terminal.app window found for this tty")


@app.post("/api/terminals/{tty}/command")
async def send_command_to_terminal(tty: str, payload: CommandRequest):
    """Send a command string to a terminal."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    command = payload.command.strip()
    if not command:
        raise HTTPException(400, "command is required")
    # Guarantee Claude Code always launches a fresh session (strip resume).
    command = normalize_claude_fresh(command)
    try:
        await send_to_terminal_shell(tty, command)
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to send command: {e}")

@app.post("/api/terminals/{tty}/close")
async def close_terminal(tty: str):
    """Close a terminal for good: kill its tmux session, close its Terminal.app
    window, and as a fallback kill every process attached to the tty. The tty is
    tombstoned so the scanner cannot resurrect it. Removes it from the sidebar,
    kanban, cards and table instantly via broadcast."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    # 1) Kill the tmux session this tty belongs to (if any).
    pane = tmux_pane_targets.get(tty) or await find_tmux_pane(tty)
    if pane:
        session = pane.split(":")[0] if ":" in pane else pane
        try:
            await asyncio.to_thread(
                subprocess.run,
                ["tmux", "kill-session", "-t", session],
                capture_output=True, text=True, timeout=3
            )
        except Exception:
            pass
    # 2) Close the Terminal.app window if we can find it.
    wid = terminal_windows.get(tty) or _find_window_by_tty(tty)
    if wid:
        _close_window(wid)
    # 3) Fallback that always works: kill every process attached to the tty.
    _kill_processes_on_tty(tty)
    # 4) Tombstone + remove from state so the scanner can't resurrect it.
    _closed_ttys.add(tty)
    terminals.pop(tty, None)
    terminal_windows.pop(tty, None)
    pending_cli.pop(tty, None)
    tmux_pane_targets.pop(tty, None)
    save_state()
    await broadcast_state()
    return {"ok": True}

def _kill_processes_on_tty(tty: str):
    """SIGTERM every process attached to a tty (then SIGKILL stragglers)."""
    try:
        r = subprocess.run(["ps", "-axo", "tty=,pid="], capture_output=True, text=True, timeout=3)
        pids = []
        for line in r.stdout.splitlines():
            parts = line.strip().split()
            if len(parts) >= 2 and parts[0] == tty:
                try:
                    pids.append(int(parts[1]))
                except ValueError:
                    pass
        if not pids:
            return
        for pid in pids:
            try:
                _kill_pid(pid)  # SIGTERM first
            except Exception:
                pass
        time.sleep(0.5)
        for pid in pids:
            try:
                _kill_pid(pid, force=True)   # SIGKILL stragglers
            except Exception:
                pass
    except Exception:
        pass

async def find_tmux_pane(tty: str):
    """Find the tmux pane target for a given TTY."""
    try:
        result = await asyncio.to_thread(
            lambda: subprocess.run(
                ["tmux", "list-panes", "-a", "-F",
                 "#{pane_tty}|#{session_name}|#{window_name}|#{pane_title}|#{session_name}:#{window_index}.#{pane_index}"],
                capture_output=True, text=True, timeout=2
            ).stdout
        )
        for line in result.splitlines():
            parts = line.strip().split("|")
            if len(parts) == 6 and parts[0].replace("/dev/", "") == tty:
                return parts[5]
    except Exception:
        pass
    return None

def capture_terminal_output(tty: str, max_chars: int = 2000) -> str:
    """Capture the last terminal output from a tmux pane."""
    pane = tmux_pane_targets.get(tty) or find_tmux_pane(tty)
    if not pane:
        return ""
    return _capture_pane(pane, max_chars)

def _capture_pane(pane: str, max_chars: int = 2000) -> str:
    """Capture output from a specific tmux pane target."""
    try:
        r = subprocess.run(["tmux", "capture-pane", "-t", pane, "-p", "-e"],
                           capture_output=True, text=True, timeout=2)
        lines = r.stdout.splitlines()
        clean = []
        ansi = re.compile(r'\x1b\[[0-9;]*[mK]|\x1b\]0;[^\x07]*\x07')
        for line in lines[-30:]:
            line = ansi.sub('', line)
            line = line.rstrip()
            if line.strip():
                clean.append(line)
        text = "\n".join(clean)
        return text[-max_chars:]
    except Exception:
        return ""

async def send_to_terminal_shell(tty: str, command: str):
    """Send a command to a terminal — three-tier delivery.

    1. tmux send-keys  (fastest, for tmux sessions)
    2. Terminal.app `do script`  (no Accessibility permission needed — runs the
       command in the correct Terminal.app window; creates a new tab in that
       window which is an acceptable trade-off for guaranteed delivery)
    3. AppleScript keystroke  (types into the existing tab — requires macOS
       Accessibility permission for the Python process)

    For sidecar-discovered terminals (raw PTY in Terminal.app, not in tmux,
    not managed by Rust) path 2 is the reliable delivery mechanism.
    """
    # --- Path 1: tmux send-keys (fastest, works for tmux sessions) ---
    pane = tmux_pane_targets.get(tty) or await find_tmux_pane(tty)
    if pane:
        try:
            await asyncio.to_thread(
                subprocess.run,
                ["tmux", "send-keys", "-t", pane, command, "Enter"],
                capture_output=True, timeout=2
            )
            return True
        except Exception:
            pass

    # --- Path 2: Terminal.app `do script` targeting the EXACT tab ---
    # `do script "cmd" in tab N of window id W` runs the command in that tab's
    # shell — NO new tab, NO Accessibility permission.  Only used when the
    # tab can be located; otherwise falls back to window-level `do script`
    # (new tab — guaranteed delivery, imprecise) and then keystroke typing.
    wid, tab_idx = _find_tab_by_tty(tty)
    if not wid:
        wid = terminal_windows.get(tty) or await _find_window_by_tty(tty)
    if wid:
        escaped = _as_script_str(command)
        if tab_idx is not None:
            script = f'''
            tell application "Terminal"
                do script {escaped} in tab {tab_idx} of window id {_as_script_str(wid)}
            end tell
            '''
        else:
            script = f'''
            tell application "Terminal"
                do script {escaped} in window id {_as_script_str(wid)}
            end tell
            '''
        try:
            r = await asyncio.to_thread(
                subprocess.run,
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=5
            )
            if r.returncode == 0:
                return True
        except Exception:
            pass

    # --- Path 3: AppleScript keystroke (types into existing tab) ---
    # Requires macOS Accessibility permission — fallback of last resort.
    if wid:
        escaped_cmd = command.replace("\\", "\\\\").replace('"', '\\"')
        script = f'''
        tell application "Terminal"
            activate
            set targetWin to window id {_as_script_str(wid)}
            set index of targetWin to 1
            tell targetWin
                set frontmost to true
            end tell
        end tell
        delay 0.15
        tell application "System Events"
            keystroke "{escaped_cmd}"
            key code 36
        end tell
        '''
        try:
            await asyncio.to_thread(
                subprocess.run,
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=5
            )
            return True
        except Exception:
            pass

    return False

def build_delivery_plan(tty: str, task: Task) -> list[tuple[float, str]]:
    """Return the ordered [(delay_seconds, command), ...] sequence to type into
    a terminal for `task`, or [] when nothing should be typed.

    Plain task  → the description as-is (current behaviour).
    Task with a pinned `model` (decisions are based on LIVE processes, never
    on sticky/recorded state — a stale `applied_model` or agent label must
    not collapse the plan):
      - opencode RUNNING on the requested model → deliver straight into the
        CLI (no restart — the "don't kill the CLI" requirement).
      - opencode RUNNING on a different model → clean-restart it on the
        requested model first (`/exit` → wait → `opencode -m <model>` →
        wait → deliver the prompt).
      - another agent TUI running (prime-agent, aider…) → do NOT type — the
        command would be swallowed by that TUI.
      - idle shell → launch opencode on the model, wait for boot, deliver.
    """
    model = _safe_model(task.model)
    if not model:
        # No pinned model: deliver straight into a RUNNING agent.  When the
        # terminal is an idle shell (no opencode, no other TUI — e.g. a task
        # queued from the remote layer with no desktop watcher around),
        # LAUNCH the agent first so the task actually gets worked instead of
        # being typed into the void.  (Rust PTY sessions are still delivered
        # by the frontend watcher, which launches the agent itself.)
        if _opencode_pid_on_tty(tty):
            return [(0.0, task.description)]
        if _other_agent_running(tty):
            return []  # foreign TUI (prime-agent, aider…) — never type into it
        return [(0.0, "opencode"), (10.0, task.description)]
    t = terminals.get(tty)
    live_pid = _opencode_pid_on_tty(tty)
    # Learn the REAL applied model from the running process when we don't
    # have it recorded (fresh app/sidecar start, user-launched CLI, etc.).
    # Without this, the FIRST task on a freshly-started terminal would
    # restart the CLI even when it already runs the requested model.
    if live_pid and t and not t.applied_model:
        argv_model = _opencode_argv_model(tty)
        if argv_model is not None:
            t.applied_model = argv_model  # '' = bare launch (default model)
            save_state()
    recorded = t.applied_model if t else ""
    print(f"[plan] {tty} task={task.id[:8]} model={model!r} live_pid={live_pid} applied={recorded!r}", flush=True)
    if live_pid and recorded and recorded == model:
        # Already running on the requested model → straight delivery.
        return [(0.0, task.description)]
    if live_pid:
        # opencode is running on a DIFFERENT or UNKNOWN model (fresh/bare/
        # default launch — e.g. a wizard terminal started with plain
        # `opencode`). The task pins an explicit model, so the agent MUST run
        # on it: clean-restart before delivering the prompt. Unknown applied
        # model == bare launch == default model, which may differ from the
        # pinned one, so an unknown model is never treated as "already on the
        # requested model". Tasks WITHOUT a pinned model take the early return
        # above and never kill a running CLI.
        return [
            (0.0, "/exit"),
            (8.0, f"opencode -m {shlex.quote(model)}"),
            (10.0, task.description),
        ]
    # No opencode running: is another agent TUI still in the foreground?
    if _other_agent_running(tty):
        # Do not type into it — the task stays queued in state.
        return []
    # Idle shell → launch opencode on the model, then deliver.
    return [
        (0.0, f"opencode -m {shlex.quote(model)}"),
        (10.0, task.description),
    ]

def _opencode_argv_model(tty: str) -> Optional[str]:
    """Model the running opencode was launched with (`-m X`), or '' for a
    bare launch (default model).  None when no opencode runs on `tty`."""
    try:
        r = subprocess.run(
            ["ps", "-axo", "tty=,pid=,command="],
            capture_output=True, text=True, timeout=3,
        )
        for line in r.stdout.splitlines():
            parts = line.split(None, 2)
            if len(parts) >= 3 and parts[0] == tty:
                cmd = parts[2].strip()
                args = cmd.split()
                if not args:
                    continue
                if args[0].split("/")[-1] != "opencode":
                    continue
                for j in range(len(args) - 1):
                    if args[j] == "-m":
                        return args[j + 1]
                return ""
    except Exception:
        pass
    return None

@app.post("/api/terminals/{tty}/applied-model")
async def set_applied_model(tty: str, payload: dict):
    """Persist the model the agent was actually (re)launched with.  Called by
    the frontend watcher after it restarts a Rust PTY session on a model, so
    the truth survives app restarts and later tasks deliver straight in."""
    tty = _resolve_tty(tty)
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    t = terminals[tty]
    t.applied_model = (payload.get("model") or "").strip()
    save_state()
    await broadcast_state()
    return {"ok": True, "applied_model": t.applied_model}

@app.post("/api/terminals/reset-tasks")
async def reset_tasks():
    """Clear ALL task state across every registered terminal (current/next/
    queue/history/context/suggestions). Called by the desktop app ONCE on
    startup so a close/reopen never resurrects stale tasks — even when the
    sidecar itself survived the app restart (force-quit/crash orphans it and
    the app reuses whatever answers on :8765). The per-terminal MODEL
    preference is preserved."""
    for t in terminals.values():
        t.current_task = None
        t.next_task = None
        t.queue = []
        t.history = []
        t.session_context = ""
        t.session_summary = ""
        t.suggested_task = ""
        t.applied_model = ""
        t.live_output = ""
    save_state()
    await broadcast_state()
    return {"ok": True, "reset": len(terminals)}

def _other_agent_running(tty: str) -> bool:
    """True when a non-opencode agent TUI (prime-agent, aider, claude…) is
    currently attached to `tty` — typing into it would be swallowed."""
    try:
        r = subprocess.run(
            ["ps", "-axo", "tty=,pid=,command="],
            capture_output=True, text=True, timeout=3,
        )
        for line in r.stdout.splitlines():
            parts = line.split(None, 2)
            if len(parts) >= 3 and parts[0] == tty:
                a = detect_agent(parts[2])
                if a and a not in ("opencode", "tto-agent"):
                    return True
    except Exception:
        pass
    return False

# --- Auto-completion: mark a running task done when the agent finishes ---
# opencode writes every turn to ~/.local/share/opencode/opencode.db.  A
# COMPLETED turn ends with a `step-finish` part whose reason is "stop" on the
# newest message; while the agent is working (streaming a reply or running a
# long tool like `sleep 25`) that marker does not exist.  Watching for it
# (instead of an output-idle timeout) is precise: a long tool call does not
# touch the DB until it returns, so idle-detection would false-complete
# mid-task, while step-finish/stop only appears when the agent returned to
# the prompt.  Sessions are matched to terminals by the delivered prompt
# text, so parallel terminals sharing a cwd (orchestrator splits, "send to
# all") each resolve to their own session.
completion_watch: Dict[str, dict] = {}  # tty -> {task_id, session_id}
_TASK_MAX_RUNTIME_S = float(os.environ.get("TTO_TASK_MAX_RUNTIME_S", "3600"))  # 1h safety valve

# Terminal-pane screenshots (Workstream B proof).  The frontend captures the
# terminal-pane screenshot via canvas.toBlob() and POSTs it here.  The sidecar
# stores it as tty_<task_id>.png for the notify loop to attach to completion
# messages.
# xterm pane (incl. the time/date header bar) and POSTs the PNG here; the
# remote notification loop attaches tty_{task_id}.png to the completion msg.
SCREENSHOTS_DIR = Path(os.environ.get(
    "DPO_SCREENSHOTS_DIR", str(Path.home() / "Library" / "Application Support" / "tto" / "screenshots")
))


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _opencode_db():
    """Read-only connection to opencode's session DB, or None."""
    import sqlite3
    db = Path.home() / ".local/share/opencode/opencode.db"
    if not db.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        conn.execute("PRAGMA query_only=ON")
        return conn
    except Exception:
        return None


def _session_for_task(tty: str, task: Task) -> Optional[str]:
    """Find the opencode session that received this task's delivered prompt.

    Matches a user text part whose text starts with the task description
    (normalized, first 30 chars) in a session whose directory is the
    terminal's cwd, created after the task started.  Returns the session of
    the NEWEST such part, or None when the prompt hasn't landed yet (delivery
    in progress, agent still booting) — the watcher retries on the next tick."""
    t = terminals.get(tty)
    if not t or not t.info.cwd or not task.description:
        return None
    prefix = _norm_text(task.description)[:30]
    if len(prefix) < 8:
        return None
    start_s = task.started_at or task.created_at or (time.time() - 30)
    conn = _opencode_db()
    if not conn:
        return None
    try:
        rows = conn.execute(
            """
            SELECT p.session_id, p.time_created, p.data
            FROM part p
            WHERE p.session_id IN (
                SELECT id FROM session
                WHERE parent_id IS NULL AND directory = ?
            )
              AND p.time_created >= ?
              AND json_extract(p.data, '$.type') = 'text'
              AND EXISTS (
                  SELECT 1 FROM message m
                  WHERE m.id = p.message_id
                    AND json_extract(m.data, '$.role') = 'user'
              )
            ORDER BY p.time_created DESC
            LIMIT 500
            """,
            (t.info.cwd, int(start_s * 1000)),
        ).fetchall()
        best = None
        for sid, tc, data in rows:
            try:
                text = _norm_text(json.loads(data).get("text", ""))
            except Exception:
                continue
            if text.startswith(prefix):
                best = sid
                break  # rows are ordered newest-first
        return best
    except Exception:
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _turn_finished(sid: str, after_s: float) -> bool:
    """True when the session's newest message (created after the task started)
    ends with a step-finish part whose reason is 'stop' — the agent completed
    its turn and returned to the prompt.  A user message or a mid-turn
    assistant message (reasoning / tool / step-start / text) returns False."""
    conn = _opencode_db()
    if not conn:
        return False
    try:
        row = conn.execute(
            "SELECT id FROM message WHERE session_id=? AND time_created >= ? "
            "ORDER BY time_created DESC LIMIT 1",
            (sid, int(after_s * 1000)),
        ).fetchone()
        if not row:
            return False
        prow = conn.execute(
            "SELECT data FROM part WHERE message_id=? "
            "ORDER BY time_created DESC LIMIT 1",
            (row[0],),
        ).fetchone()
        if not prow:
            return False
        try:
            d = json.loads(prow[0])
        except Exception:
            return False
        return d.get("type") == "step-finish" and d.get("reason") == "stop"
    except Exception:
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ── Live opencode status (what the CLI is ACTUALLY doing right now) ────────
# opencode persists every session in ~/.local/share/opencode/opencode.db.
# While the agent works it continuously updates `part.time_updated` (streaming
# text/reasoning/tool parts); when its turn completes it stops writing. So:
#   - a part updated within the last ~12s  → 'working'
#   - newest message completed / user turn → 'waiting' (at the prompt)
#   - no recent session in this directory  → 'off'
# A short TTL cache keeps the per-second broadcast cheap.
_opencode_live_cache: Dict[str, tuple] = {}  # tty -> (ts, result)
_OPC_LIVE_TTL_S = 0.8
_OPC_LIVE_WORKING_MS = 12_000  # part update freshness => actively streaming
_OPC_LIVE_SESSION_MAX_MS = 24 * 60 * 60_000  # only sessions active in last 24 hours
# ── Per-terminal session attribution ────────────────────────────────────────
# Each terminal's opencode CLI shows ONE session.  Multiple terminals in the
# SAME directory must NOT share a status: terminal-2 done must stay STOPPED
# while terminal-3 works.  We therefore COMMIT each tty to a session id and
# never re-resolve to a "directory-freshest" session (that is the leak that
# made idle terminals follow busy ones).  A session is attributed to a tty by
# its CLI boot moment: a fresh `opencode` TUI creates its own session right
# after boot, so the session created around THIS terminal's boot belongs to
# THIS terminal.  The commitment is held while the session shows any activity
# (parts / user messages) within _OPC_SESSION_HOLD_MS, and drops when the
# CLI's PID changes (restart → new boot → new session).
_opencode_term_session: Dict[str, tuple] = {}   # tty -> (commit_ts, sid)
_opencode_boot: Dict[str, tuple] = {}           # tty -> (pid, boot_epoch_s)
_OPC_SESSION_HOLD_MS = 15 * 60_000

def _commit_opencode_session(tty: str, sid: str) -> None:
    if sid:
        _opencode_term_session[tty] = (time.time(), sid)

def _opencode_session_alive(conn, sid: str, cwd: str, now_s: float) -> bool:
    """Committed session still usable: exists, matches the terminal's cwd,
    and saw DB activity (parts or messages) within the hold window."""
    try:
        print(f"[DEBUG] Entered DB try block for {tty}", flush=True)
        row = conn.execute(
            "SELECT directory, time_updated, time_created FROM session WHERE id = ?",
            (sid,),
        ).fetchone()
        if not row or row[0] != cwd:
            return False
        _, up, created = row
        last = max(up or 0, created or 0)
        return bool(now_s * 1000 - last < _OPC_SESSION_HOLD_MS)
    except Exception:
        return False

def _resolve_opencode_session(conn, cwd: str, boot: tuple or None, committed_sid: str = "") -> str:
    """Attribute a session to THIS terminal, strongly anchored so a sibling
    terminal in the same directory can never take it over.

    Resolution order (each step returns the moment it matches):
      1. The session created at THIS terminal's CLI boot instant
         [boot-30s, boot+60s] — a fresh TUI creates its own session right
         then, and sibling terminals boot at different instants, so their
         sessions fall OUTSIDE this window.
      2. The tty's own committed session (back-port) when it still exists in
         this directory — statuses stay stuck to their own conversation even
         after the 15-min hold expires.
      3. The session most recently ACTIVE just before boot (a resumed one).
      4. The newest session in the directory — ONLY for ttys that have never
         had a session attributed (single-terminal directories stay correct).
    Sessions already committed to ANOTHER tty are never stolen."""
    boot_ts = boot[1] if boot else 0.0
    boot_ms = int(boot_ts * 1000)
    try:
        rows = conn.execute(
            "SELECT id, time_created, time_updated FROM session WHERE directory = ?",
            (cwd,),
        ).fetchall()
    except Exception:
        return ""
    taken = {
        sid for t, (_, sid) in _opencode_term_session.items() if t != committed_sid and sid
    }
    if boot_ts:
        for c in rows:
            if c[1] and boot_ms - 30_000 <= c[1] <= boot_ms + 60_000 and c[0] not in taken:
                return c[0]
    if committed_sid and any(c[0] == committed_sid for c in rows):
        return committed_sid
    if boot_ts:
        best = None
        for c in rows:
            if c[1] and c[1] <= boot_ms and c[2] and c[2] >= boot_ms - 5 * 60_000 and c[0] not in taken:
                if best is None or c[2] > best[2]:
                    best = c
        if best:
            return best[0]
    if not committed_sid:
        # Fresh tty that has never had a session: fall back to the newest
        # session in the directory (single-terminal directories stay correct;
        # the boot-anchor step above already handles the parallel case).
        rows.sort(key=lambda c: c[2] or 0, reverse=True)
        return rows[0][0] if rows else ""
    # A tty with a committed session keeps its own conversation even when
    # stale (never drifts to a sibling's session).
    return committed_sid

def _opencode_live_status(tty: str) -> dict:
    with open("/tmp/func_calls.log", "a") as f:
        f.write(f"_opencode_live_status called for {tty}\n")
        f.flush()
    print("=== UNIQUE MARKER: Function started ===", flush=True)
    now = time.time()
    cached = _opencode_live_cache.get(tty)
    if cached and now - cached[0] < _OPC_LIVE_TTL_S:
        print(f"[DEBUG _opencode_live_status] CACHE HIT for {tty}: state={cached[1].get('state')}, last_text_len={len(cached[1].get('last_text', ''))}", flush=True)
        return cached[1]
    print(f"[DEBUG _opencode_live_status] CACHE MISS for {tty}, cached={cached is not None}, ttl={_OPC_LIVE_TTL_S}", flush=True)
    result = {"state": "off", "last_update_ms": -1, "last_text": "", "session_id": "", "session_slug": "", "session_title": ""}
    t = terminals.get(tty)
    cwd = t.info.cwd if t and t.info.cwd else None
    # Only report live opencode state for terminals that actually RUN
    # opencode (process scan) or carry an in-flight app task. Without this
    # gate, every shell sitting in a directory with an active opencode
    # session would wrongly report the session's state.
    ct = t.current_task if t else None
    # Also check t.info.cli as fallback — the scanner sets this when it
    # detects opencode as the foreground CLI, even if opencode_models
    # hasn't been updated yet (cache timing issue).
    cli_is_opencode = (t.info.cli or "").lower() == "opencode"
    known_opencode = tty in opencode_models or cli_is_opencode or (ct is not None and ct.status == "running")
    print(f"[DEBUG _opencode_live_status] tty={tty} known_opencode={known_opencode} cli={t.info.cli} opencode_models={tty in opencode_models} cli_is_opencode={cli_is_opencode}")
    if not known_opencode:
        _opencode_live_cache[tty] = (now, result)
        return result
    print(f"[DEBUG] known_opencode=True for {tty}, proceeding to DB query")
    # Open the DB only when we have a directory to match (avoids leaking a
    # read-only sqlite fd for bare/unknown terminals on every 1s broadcast).
    conn = _opencode_db() if cwd else None
    if not conn:
        _opencode_live_cache[tty] = (now, result)
        return result
    try:
        sid = ""
        sess_ts = 0
        # 1) App task in flight → pin to the session holding its delivered
        #    prompt (unique per delivery) and commit it.  Correct under
        #    parallel same-cwd sessions.  Never steal a session that another
        #    tty already committed as its anchor (identical-prompt delivery).
        if ct and ct.status == "running" and ct.description:
            try:
                sid = _session_for_task(tty, ct) or ""
            except Exception:
                sid = ""
            if sid:
                others_take = {
                    s for t, (_, s) in _opencode_term_session.items() if t != tty and s
                }
                if sid in others_take:
                    sid = ""
            if sid:
                _commit_opencode_session(tty, sid)
        # 2) Otherwise the session committed to THIS terminal — used as-is
        #    while it is still alive.  This is the isolation guarantee: a
        #    second terminal working in the same directory never moves the
        #    first one, because we never look at "the freshest session"
        #    again.
        committed_sid = ""
        if not sid:
            committed = _opencode_term_session.get(tty)
            if committed:
                committed_sid = committed[1]
                if _opencode_session_alive(conn, committed_sid, cwd, now):
                    sid = committed_sid
        # 3) No task, no live commitment → attribute from THIS terminal's
        #    boot anchor (never a sibling's), back-porting the own committed
        #    session even when stale, and commit it.
        if not sid:
            boot = _opencode_boot.get(tty)
            sid = _resolve_opencode_session(conn, cwd, boot, committed_sid)
            if sid:
                _commit_opencode_session(tty, sid)
        if sid:
            trow = conn.execute(
                "SELECT time_updated FROM session WHERE id = ?", (sid,)
            ).fetchone()
            sess_ts = trow[0] if trow else 0
        if sid and sess_ts and now * 1000 - sess_ts < _OPC_LIVE_SESSION_MAX_MS:
            result["session_id"] = sid
            result["last_update_ms"] = sess_ts
            # Surface the opencode session's short slug + human title so the
            # UI can render a clean, short terminal name instead of the long
            # 29-char session id (e.g. ses_f75c638f4fferFPEGhlz7US1hR).
            try:
                srow = conn.execute(
                    "SELECT slug, title FROM session WHERE id = ?", (sid,)
                ).fetchone()
                if srow:
                    result["session_slug"] = (srow[0] or "").strip()
                    result["session_title"] = (srow[1] or "").strip()
            except Exception:
                pass
            # Newest message + whether its assistant turn finished.  opencode
            # writes ONE assistant message PER STEP: intermediate steps get
            # time.completed at step-end (reason='tool-calls'), only the FINAL
            # step closes with a step-finish part reason='stop'.  So a message
            # is "at the prompt" only when its last part is step-finish/stop.
            mrow = conn.execute(
                """SELECT id, json_extract(data, '$.role'),
                          json_extract(data, '$.time.completed')
                   FROM message WHERE session_id = ?
                   ORDER BY time_created DESC LIMIT 1""",
                (sid,),
            ).fetchone()
            role = mrow[1] if mrow else None
            completed = bool(mrow[2] if mrow and mrow[2] else None)
            if role == "assistant" and completed and mrow:
                lp = conn.execute(
                    """SELECT json_extract(data, '$.type'),
                              json_extract(data, '$.reason')
                       FROM part WHERE message_id = ?
                       ORDER BY time_created DESC, id DESC LIMIT 1""",
                    (mrow[0],),
                ).fetchone()
                at_prompt = bool(lp and lp[0] == "step-finish" and lp[1] == "stop")
            else:
                at_prompt = False
            # A fresh user message = the prompt landed = at the prompt (the
            # agent turn starts only after this message is written).
            if role == "user":
                result["state"] = "waiting"
            elif at_prompt:
                result["state"] = "waiting"
            else:
                # Mid-turn (streaming parts or a completed intermediate step)
                # → still working, unless nothing has been written for a long
                # while.
                prow = conn.execute(
                    "SELECT MAX(time_updated) FROM part WHERE session_id = ?",
                    (sid,),
                ).fetchone()
                last_part = prow[0] or 0
                if last_part:
                    result["last_update_ms"] = max(result["last_update_ms"], last_part)
                if last_part and now * 1000 - last_part < _OPC_LIVE_WORKING_MS:
                    result["state"] = "working"      # parts still streaming
                else:
                    result["state"] = "working"      # mid-turn, no completion yet
            # Most recent NON-EMPTY assistant text — the live question/status
            # preview. (opencode writes empty placeholder text parts while
            # streaming; skip them, anchor on time_created.)
            trow = conn.execute(
                """SELECT p.data FROM part p
                   JOIN message m ON p.message_id = m.id
                   WHERE p.session_id = ?
                     AND json_extract(p.data, '$.type') = 'text'
                     AND json_extract(m.data, '$.role') = 'assistant'
                     AND length(json_extract(p.data, '$.text')) > 1
                   ORDER BY p.time_created DESC, p.id DESC LIMIT 1""",
                (sid,),
            ).fetchone()
            if trow:
                try:
                    td = json.loads(trow[0])
                    result["last_text"] = (td.get("text") or "").strip()
                except Exception:
                    pass
    except Exception:
        result = {"state": "off", "last_update_ms": -1, "last_text": "", "session_id": "", "session_slug": "", "session_title": ""}
    finally:
        try:
            conn.close()
        except Exception:
            pass
    _opencode_live_cache[tty] = (now, result)
    print(f"[DEBUG] FINAL RETURN for {tty}: state={result.get('state')}, last_text_len={len(result.get('last_text', ''))}", flush=True)
    return result

async def completion_loop():
    """Every 3s: auto-complete running tasks whose agent turn finished.
    Resolves each terminal's opencode session once per task (the prompt text
    is unique per delivery), then completes when step-finish/stop appears.
    This is what stops tasks from showing 'running' forever after the agent
    already returned to the prompt.

    Safety valve: if the agent turn NEVER finishes (hung CLI, crashed agent,
    session never pinned) a task is auto-completed after _TASK_MAX_RUNTIME_S
    so the UI can never stick on 'running' indefinitely."""
    while True:
        try:
            now = time.time()
            for tty, t in list(terminals.items()):
                ct = t.current_task
                if not ct or ct.status != "running":
                    completion_watch.pop(tty, None)
                    continue
                started = ct.started_at or ct.created_at or now
                w = completion_watch.get(tty)
                if not w or w.get("task_id") != ct.id:
                    # (Re)pin the session for this task — the prompt must have
                    # landed for a session to exist; keep retrying until then.
                    sid = await asyncio.to_thread(_session_for_task, tty, ct)
                    if sid:
                        completion_watch[tty] = {"task_id": ct.id, "session_id": sid}
                    # No session after the max runtime → force-complete below.
                    if not sid and now - started > _TASK_MAX_RUNTIME_S:
                        completion_watch.pop(tty, None)
                        try:
                            await complete_task(tty, ct.id, summary="(auto-completed: no agent session)")
                        except Exception:
                            pass
                    continue
                sid = w.get("session_id")
                if not sid:
                    continue
                finished = await asyncio.to_thread(
                    _turn_finished, sid, ct.started_at or ct.created_at or time.time()
                )
                if finished:
                    completion_watch.pop(tty, None)
                    try:
                        await complete_task(tty, ct.id)
                    except Exception:
                        pass
                    continue
                # Turn in flight but far past the max runtime → complete anyway.
                if now - started > _TASK_MAX_RUNTIME_S:
                    completion_watch.pop(tty, None)
                    try:
                        await complete_task(tty, ct.id, summary="(auto-completed: runtime cap)")
                    except Exception:
                        pass
        except Exception:
            pass
        await asyncio.sleep(3)


async def _place_task(tty: str, task: Task) -> None:
    """Queue a task on a terminal and kick off delivery. Shared by the task
    API and the orchestrator so both go through the SAME pipeline (queue /
    promote / model-restart / delivery)."""
    t = terminals[tty]
    # While paused (remote /pause) tasks still queue but never auto-start;
    # /resume promotes the next one.  The running task is unaffected.
    if t.paused:
        if t.next_task is None:
            t.next_task = task
        else:
            t.queue.append(task)
    elif t.current_task is None:
        task.status = "running"
        task.started_at = time.time()
        t.current_task = task
    elif t.next_task is None:
        t.next_task = task
    else:
        t.queue.append(task)
    # A task that pins a model (e.g. Emergency To-do → Fitted Prompt with a
    # Target model selected) also sets the terminal's model so the session
    # state reflects it and delivery restarts the agent on it.
    if task.model:
        t.model = task.model
    save_state()
    await broadcast_state()
    # Send to agent: "run_task" when the task became the running current task
    # (agent executes it), otherwise "new_task" (queued — just notify).
    is_current = (
        t.current_task is not None
        and t.current_task.id == task.id
        and t.current_task.status == "running"
    )
    sent = await manager.send_to_terminal(
        tty, {"type": "run_task" if is_current else "new_task", "task": task.model_dump()}
    )
    # For Rust terminals (terminal-N), manager.send_to_terminal may fail because
    # Rust terminals don't have WebSocket connections — they use the command
    # relay.  Fall back to relay injection so remote tasks actually reach the
    # agent in the native PTY.
    if not sent and tty in _remote_rust_ttys():
        sent = await _remote_relay_send(
            "inject_command",
            tty=tty,
            command=task.description,
            task_id=task.id,
        )
    # Delivery plan: when a model is pinned, the terminal must FIRST run the
    # agent on that model (clean-restart if opencode is already running), THEN
    # receive the prompt.  Steps are (delay_seconds, command) so delivery can
    # pause for the agent to exit / boot between commands.
    plan = build_delivery_plan(tty, task)
    # Fire-and-forget: plan execution involves sleeps (18+ s for model
    # switching) and MUST NOT block the HTTP response.
    if plan:
        asyncio.create_task(_execute_delivery(tty, task, plan, sent))


@app.post("/api/terminals/{tty}/tasks")
async def add_task(tty: str, task: Task):
    tty = _resolve_tty(tty)
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    await _place_task(tty, task)
    return {"ok": True, "task": task.model_dump()}


# --- Orchestrator: split ONE task into per-terminal sub-tasks ---------------
# In-memory runs only (never persisted): on restart the orchestrator starts
# clean, matching the app's "no stale tasks" behavior.
orchestrations: Dict[str, "OrchestratorRun"] = {}


class OrchestratorSplit(BaseModel):
    tty: str = ""
    label: str = ""
    task_id: str = ""
    description: str = ""
    model: str = ""  # model assigned to this sub-task
    status: str = "queued"  # queued | running | done | blocked
    retry_count: int = 0  # how many times the agent retried this split


class OrchestratorRun(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    task: str = ""
    workspace_name: str = ""
    workspace_id: str = ""
    created_at: float = Field(default_factory=time.time)
    status: str = "planning"  # planning | dispatching | running | done | failed
    error: str = ""
    splits: List[OrchestratorSplit] = []
    agent_enabled: bool = False  # agentic layer on/off for this run
    agent_actions: List[Dict[str, Any]] = []  # log of autonomous actions taken
    summary: str = ""  # synthesized summary when all splits complete


# --- Agentic Layer: autonomous monitoring, recovery, and chaining -----------
# The agent loop runs in the background, watching all active orchestrator
# runs.  When it detects failures, stalls, or completions it takes autonomous
# action (retry, re-dispatch, chain dependent tasks, synthesize summary).

class AgentConfig(BaseModel):
    enabled: bool = True  # global on/off toggle
    auto_retry: bool = True  # auto-retry failed splits
    max_retries: int = 2  # max retries per split before giving up
    stall_timeout: float = 600  # seconds before a "running" split is considered stalled
    chain_mode: bool = True  # when a split completes, check for dependent work
    synthesis: bool = True  # auto-synthesize summary when all splits finish
    poll_interval: float = 15  # seconds between agent loop ticks
    # Auto "※ recap:" block (session summary + next-step suggestion) generated
    # in the background after a task completes. Disabled → the agent panel
    # card stays quiet; the manual summary/suggest endpoints still work.
    recap: bool = True

agent_config = AgentConfig()
agent_loop_task: Optional[asyncio.Task] = None  # type: ignore[assignment]


def _agent_action(run: "OrchestratorRun", action_type: str, message: str, split_id: str = "") -> None:
    """Record an autonomous agent action in the run's action log."""
    entry = {
        "type": action_type,
        "message": message,
        "timestamp": time.time(),
        "split_id": split_id,
    }
    run.agent_actions.append(entry)
    # Keep the log bounded (last 100 actions per run)
    if len(run.agent_actions) > 100:
        run.agent_actions = run.agent_actions[-100:]


async def _agent_tick() -> None:
    """One iteration of the agent monitoring loop.  Watches all active runs
    and takes autonomous action on failures, stalls, and completions."""
    if not agent_config.enabled:
        return
    now = time.time()
    for run in list(orchestrations.values()):
        if run.status not in ("running", "dispatching"):
            continue
        if not run.agent_enabled:
            continue
        changed = False
        all_done = True
        any_failed = False
        any_running = False
        for split in run.splits:
            # ── Sync status from live terminal state ──
            t = terminals.get(split.tty)
            if t:
                # Check current task
                if t.current_task and t.current_task.id == split.task_id:
                    new_status = t.current_task.status
                    if new_status != split.status:
                        split.status = new_status
                        changed = True
                elif t.next_task and t.next_task.id == split.task_id:
                    if split.status != "queued":
                        split.status = "queued"
                        changed = True
                elif any(q.id == split.task_id for q in t.queue):
                    if split.status != "queued":
                        split.status = "queued"
                        changed = True
                else:
                    # Check history
                    h = next((x for x in t.history if x.id == split.task_id), None)
                    if h and h.status != split.status:
                        split.status = h.status
                        changed = True

            # ── Track overall state ──
            if split.status not in ("done", "blocked"):
                all_done = False
            if split.status == "failed":
                any_failed = True
            if split.status in ("running", "queued"):
                any_running = True

            # ── Auto-retry on failure ──
            if split.status == "failed" and agent_config.auto_retry:
                if split.retry_count < agent_config.max_retries:
                    split.retry_count += 1
                    # Create a new task with retry context
                    retry_desc = (
                        f"[Agent retry #{split.retry_count}] {split.description}\n\n"
                        f"Note: The previous attempt at this task failed. "
                        f"Please complete the original task above. If you encounter "
                        f"an error, try an alternative approach."
                    )
                    retry_task = Task(description=retry_desc, model=split.model or "")
                    if t:
                        await _place_task(split.tty, retry_task)
                        split.task_id = retry_task.id
                        split.status = "queued"
                        _agent_action(run, "retry",
                            f"Retried split '{split.label}' on {split.tty} (attempt {split.retry_count}/{agent_config.max_retries})",
                            split_id=split.task_id)
                        changed = True
                else:
                    _agent_action(run, "give_up",
                        f"Split '{split.label}' on {split.tty} failed {split.retry_count} times — giving up",
                        split_id=split.task_id)

            # ── Stall detection ──
            if split.status == "running" and t and t.current_task:
                started = t.current_task.started_at or 0
                if started > 0 and (now - started) > agent_config.stall_timeout:
                    _agent_action(run, "stall_warning",
                        f"Split '{split.label}' on {split.tty} has been running for {int(now - started)}s (threshold: {int(agent_config.stall_timeout)}s)",
                        split_id=split.task_id)

        # ── Run-level transitions ──
        if all_done and run.splits:
            run.status = "done"
            _agent_action(run, "completed", "All splits finished — run marked done")
            changed = True
            # Auto-synthesize summary
            if agent_config.synthesis and not run.summary:
                summaries = []
                for split in run.splits:
                    t = terminals.get(split.tty)
                    if t:
                        h = next((x for x in t.history if x.id == split.task_id), None)
                        if h and h.summary:
                            summaries.append(f"[{split.label}] {h.summary}")
                if summaries:
                    run.summary = "\n".join(summaries)
                    _agent_action(run, "synthesis",
                        f"Synthesized summary from {len(summaries)} completed splits")
                    changed = True
        elif any_failed and not any_running and run.status == "running":
            # All non-failed splits are done, but some failed
            done_count = sum(1 for s in run.splits if s.status == "done")
            failed_count = sum(1 for s in run.splits if s.status in ("failed", "blocked"))
            if done_count + failed_count == len(run.splits):
                run.status = "done" if done_count > 0 else "failed"
                run.error = f"{failed_count} split(s) failed" if failed_count else ""
                _agent_action(run, "partial_complete",
                    f"Run finished: {done_count} done, {failed_count} failed")
                changed = True

        if changed:
            await broadcast_state()


async def _agent_loop() -> None:
    """Background loop that runs every `poll_interval` seconds."""
    while True:
        try:
            await asyncio.sleep(agent_config.poll_interval)
            await _agent_tick()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[agent-loop] tick error: {exc}", file=sys.stderr)
            await asyncio.sleep(5)


def start_agent_loop() -> None:
    """Start the background agent loop (idempotent)."""
    global agent_loop_task
    if agent_loop_task and not agent_loop_task.done():
        return
    agent_loop_task = asyncio.create_task(_agent_loop())


def stop_agent_loop() -> None:
    """Stop the background agent loop."""
    global agent_loop_task
    if agent_loop_task and not agent_loop_task.done():
        agent_loop_task.cancel()
        agent_loop_task = None


class OrchestratorTerminal(BaseModel):
    tty: str
    label: str = ""
    model: str = ""


class OrchestratorRunRequest(BaseModel):
    task: str
    workspace_name: str = ""
    workspace_id: str = ""
    terminals: List[OrchestratorTerminal]
    model: str = ""  # optional splitter model (opencode key)
    memory_context: str = ""  # workspace memory (TODOs, notes, context from CEO/memory view)
    agent_enabled: bool = False  # enable the agentic layer for this run


def _extract_json_array(text: str) -> List[str]:
    """Pull a JSON array of strings out of an LLM response (strips fences)."""
    m = re.search(r"\[[\s\S]*\]", text)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except Exception:
        return []
    return [str(x).strip() for x in data if isinstance(x, str) and x.strip()]


def _deterministic_split(task: str, n: int, labels: List[str] | None = None) -> List[str]:
    """Fallback splitter when no LLM is reachable.  Instead of blindly
    splitting sentences, tries to identify logical workstreams from the
    goal text (bullet points, numbered items, action verbs, "and" clauses)
    and distribute them across n terminals with clear, self-contained
    instructions.

    When splitting fails to produce enough sub-tasks, repeats the WHOLE
    task with a terminal-specific directive (e.g. 'Verify and test all
    changes') so every terminal has full context — never a truncated fragment."""
    labels = labels or [f"Terminal {i+1}" for i in range(n)]

    # --- Step 1: try to extract logical workstreams ---
    workstreams: List[str] = []

    # Bullet / numbered lines are strong signals
    lines = [re.sub(r"^\s*[-*•#]+\s*", "", l).strip()
             for l in task.splitlines() if l.strip()]
    # Numbered items like "1. Do X" or "1) Do X"
    numbered = re.findall(r"(?:^|\n)\s*\d+[.)]\s*(.+)", task)
    for item in numbered:
        cleaned = item.strip()
        if cleaned and cleaned not in lines:
            lines.append(cleaned)

    if len(lines) >= 2:
        workstreams = lines

    # If no bullets, try splitting on "and then", "also", semicolons
    if len(workstreams) < 2:
        parts = re.split(r"\b(?:and then|also|;\s*)\b", task, flags=re.IGNORECASE)
        parts = [p.strip().rstrip(",. ") for p in parts if p.strip()]
        if len(parts) >= 2:
            workstreams = parts

    # If still < 2, try action-verb sentences (imperatives)
    if len(workstreams) < 2:
        sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", task) if s.strip()]
        actions = [s for s in sents if re.match(
            r"^(?:create|build|add|fix|update|remove|delete|implement|write|setup|"
            r"install|configure|refactor|test|deploy|integrate|design|optimize|migrate|"
            r"review|check|audit|inspect|analyze|analyse|evaluate|validate|examine)\b",
            s, re.IGNORECASE)]
        if len(actions) >= 2:
            workstreams = actions
        elif len(sents) >= 2:
            workstreams = sents

    # --- Step 2: distribute workstreams across terminals ---
    if len(workstreams) >= n:
        buckets: List[List[str]] = [[] for _ in range(n)]
        for i, ws in enumerate(workstreams):
            buckets[i % n].append(ws)
        return ["; ".join(b) for b in buckets]

    if len(workstreams) >= 2 and len(workstreams) < n:
        # Fewer workstreams than terminals — split the longest ones
        buckets = [[] for _ in range(n)]
        for i, ws in enumerate(workstreams):
            buckets[i % n].append(ws)
        # Distribute remaining capacity by repeating the longest bucket's items
        for i in range(len(workstreams), n):
            longest = max(range(n), key=lambda j: len(buckets[j]))
            if buckets[longest]:
                last = buckets[longest][-1]
                buckets[i % n].append(f"Continue or verify: {last}")
        return ["; ".join(b) for b in buckets]

    # --- Step 3: last resort — chunk the text intelligently ---
    # Don't cut mid-sentence; split at sentence boundaries
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", task) if s.strip()]
    if len(sents) >= n:
        buckets = [[] for _ in range(n)]
        for i, s in enumerate(sents):
            buckets[i % n].append(s)
        return [" ".join(b) for b in buckets]

    # Absolute last resort: give every terminal the FULL task with a directive
    # specific to their role (so no terminal gets a truncated fragment).
    # Detect review/audit tasks — these should NOT get build-oriented directives.
    is_review = bool(re.search(
        r"\b(review|audit|inspect|check|examine|analyze|analyse|evaluate|"  
        r"validate|verify|look at|go through|read over|assess)\b",
        task, re.IGNORECASE,
    ))
    if is_review:
        # For review tasks, split by page/file/section if possible, otherwise
        # give each terminal the full task with a focus directive.
        review_directives = [
            "Review and report findings for:",
            "Check for issues, bugs, or improvements in:",
            "Analyze code quality and completeness of:",
            "Verify correctness and best practices in:",
            "Inspect for security, performance, and style issues in:",
            "Document any problems found in:",
        ]
    else:
        review_directives = [
            "Focus on the core implementation:",
            "Review, test, and verify all changes:",
            "Handle configuration, setup, and documentation:",
            "Fix any edge cases, errors, or quality issues:",
            "Check for consistency and completeness across all parts:",
            "Optimize performance and add helpful comments:",
        ]
    result = []
    for i in range(n):
        directive = review_directives[i % len(review_directives)]
        result.append(f"{directive}\n\n{task.strip()}")
    return result


def split_task_for_orchestration(
    task: str, n: int, model: str = "", labels: List[str] | None = None,
    **kwargs,
) -> List[str]:
    """Split a goal into n parallel sub-tasks, one per terminal.

    Primary: `opencode run` with a splitter model (verified working, returns
    clean JSON). Fallbacks: OmniRoute call_llm, then a deterministic split so
    the orchestrator ALWAYS works even when no LLM is reachable."""
    if n <= 1:
        return [task]
    labels = labels or [f"Terminal {i+1}" for i in range(n)]
    safe_model = _safe_model(model)
    # memory_context is passed via kwargs (not in the signature) for backward compat
    memory_context = kwargs.get("memory_context", "") if kwargs else ""

    terminal_list = "\n".join(f"  - Terminal {i+1} ({labels[i]}): active, ready for work"
                               for i in range(min(n, len(labels))))
    memory_block = ""
    if memory_context.strip():
        memory_block = (
            "\n\nWORKSPACE MEMORY (from the user's notes/TODOs/context for this workspace):\n"
            f"{memory_context}\n\n"
            "Use this memory as additional context when splitting tasks. "
            "If there are pending TODOs, consider incorporating them into the sub-tasks. "
            "If there is context about the workspace, use it to make sub-tasks more specific.\n"
        )
    system = (
        "You are an expert task orchestrator for a team of AI coding assistants.\n\n"
        "YOUR JOB: Analyze the user's goal deeply, understand the FULL context, "
        "and split the work into clear, self-contained sub-tasks — one per terminal.\n\n"
        "CRITICAL: Before splitting, UNDERSTAND the goal completely. "
        "Read every sentence. Think about what the user is REALLY asking for. "
        "Consider dependencies, order of operations, and what makes sense to parallelize.\n\n"
        "RULES:\n"
        f"1. There are {n} terminals available:\n{terminal_list}\n"
        "2. UNDERSTAND THE GOAL FIRST: What is the user actually trying to achieve? "
        "What are all the parts? What is the desired end state?\n"
        "3. Think about dependencies: which tasks must happen before others? "
        "Can any be done in parallel?\n"
        "CRITICAL — TASK TYPE MATTERS: Before splitting, determine the task TYPE:\n"
        "  • REVIEW/AUDIT/INSPECT tasks (e.g. 'review the HTML pages', 'check the CSS', "
        "    'audit the codebase'): The goal is to READ, ANALYZE, and REPORT. "
        "    DO NOT create new files, build new features, or write new code. "
        "    Split the work by giving each terminal a subset of items to review.\n"
        "  • BUILD/CREATE/IMPLEMENT tasks (e.g. 'build a todo app', 'add auth'): "
        "    Split into distinct workstreams (backend, frontend, database, etc.).\n"
        "  • MIXED tasks: Split the review portion and build portion separately — "
        "    don't let build sub-tasks expand beyond what was asked.\n\n"
        "4. Each sub-task must be a COMPLETE, INDEPENDENT instruction with FULL context — "
        "not a sentence fragment. Each terminal should be able to work without asking "
        "for more information.\n"
        "5. DO NOT INVENT WORK: If the goal is to review 4 pages, the sub-tasks should be "
        "reviewing specific pages — NOT building a review tool, creating a frontend, or "
        "writing backend APIs. Stick EXACTLY to what was asked.\n"
        "6. Each sub-task should start with an action verb appropriate to the task type: "
        "Review, Check, Audit for review tasks; Create, Build, Fix, Add for build tasks.\n"
        "7. Never split a sentence in half — if something can't be split, assign the whole "
        "thing to one terminal and give the others complementary work.\n"
        "8. If the goal is simple (one thing), give the primary terminal the full task and "
        "give secondary terminals verification/setup/related work — but only if the goal "
        "actually requires setup. A review task needs no setup sub-tasks.\n"
        "9. Include relevant file paths, function names, or specific technical details "
        "from the goal description in each sub-task.\n"
        "10. Each sub-task should be actionable: the terminal should know exactly what to do, "
        "where to look, and what the expected outcome is.\n"
        "11. When in doubt, do LESS. It is better to have 2 focused review sub-tasks and "
        "1 idle terminal than to have every terminal building things that weren't asked for."
        f"{memory_block}\n\n"
        f"Return ONLY a JSON array of exactly {n} strings. No prose, no code fences, no markdown."
    )
    prompt = f"Goal: {task}"
    # opencode's `run` takes a SINGLE prompt argument — there is no separate
    # system-prompt flag — so the full orchestration instructions must be folded
    # INTO the prompt. Previously only "Goal: <task>" was passed, so opencode was
    # never told to return a JSON array; its freeform reply never parsed and the
    # split silently fell through to the deterministic splitter on every run.
    full_prompt = (
        f"{system}\n\n{prompt}\n\n"
        f"Respond with ONLY a JSON array of exactly {n} strings — one sub-task "
        f"per terminal, in order. No prose, no explanation, no code fences."
    )

    # PRIMARY: OmniRoute local LLM (fast, streaming, usually < 30s). A slow
    # `opencode run` was leaving the board in "planning" for minutes.
    raw = call_llm(system, task, max_tokens=2000)
    items = _extract_json_array(raw)
    if len(items) >= n:
        return items[:n]

    # FALLBACK: `opencode run` — capped at 60s. The old 180s timeout let a hung
    # CLI block the whole orchestration; a hung run now falls through quickly.
    cmd = ["opencode", "run"]
    if safe_model:
        cmd += ["-m", safe_model]
    cmd.append(full_prompt)
    out = ""
    try:
        r = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=60,
        )
        out = r.stdout or ""
    except Exception:
        pass
    items = _extract_json_array(out)
    if len(items) >= n:
        return items[:n]
    return _deterministic_split(task, n, labels)


def _refresh_orchestration_statuses() -> None:
    """Re-derive every split's status from live terminal task state, and mark
    a run done when all its splits finished. Called on each broadcast."""
    now = time.time()
    stale: List[str] = []
    for rid, run in orchestrations.items():
        # Old finished runs are pruned after 15 minutes so the board never
        # shows yesterday's orchestrations ("old tasks keep showing").
        if run.status in ("done", "failed") and now - run.created_at > 900:
            stale.append(rid)
            continue
        finished = 0
        for split in run.splits:
            t = terminals.get(split.tty)
            if not t:
                continue
            tid = split.task_id
            if t.current_task and t.current_task.id == tid:
                split.status = t.current_task.status
            elif t.next_task and t.next_task.id == tid:
                split.status = "queued"
            elif any(q.id == tid for q in t.queue):
                split.status = "queued"
            else:
                h = next((x for x in t.history if x.id == tid), None)
                if h:
                    split.status = h.status
            if split.status in ("done", "blocked"):
                finished += 1
        if run.splits and finished == len(run.splits) and run.status == "running":
            run.status = "done"
    for rid in stale:
        orchestrations.pop(rid, None)


@app.post("/api/orchestrator/run")
async def orchestrator_run(req: OrchestratorRunRequest):
    """Split ONE task across the workspace's terminals and dispatch a real
    Task to each (same pipeline as the Task Center). Returns immediately with
    a planning run; the split + dispatch happen in the background so the UI
    can show splits landing live, one terminal at a time."""
    if not req.task.strip():
        raise HTTPException(400, "Task is empty")
    if not req.terminals:
        raise HTTPException(400, "No terminals selected")
    run = OrchestratorRun(
        task=req.task.strip(),
        workspace_name=req.workspace_name or "",
        workspace_id=req.workspace_id or "",
        agent_enabled=req.agent_enabled,
    )
    orchestrations[run.id] = run
    # Bound the in-memory run store so it can't grow without limit across many
    # orchestrations — keep the newest 50 and drop the oldest finished ones.
    if len(orchestrations) > 50:
        for old_id in sorted(
            orchestrations,
            key=lambda rid: orchestrations[rid].created_at,
        )[: len(orchestrations) - 50]:
            if orchestrations[old_id].status in ("done", "failed"):
                orchestrations.pop(old_id, None)
    if req.agent_enabled:
        _agent_action(run, "toggle", "Agentic layer enabled for this run")
        start_agent_loop()  # ensure the loop is running
    asyncio.create_task(_execute_orchestration(run, req))
    return {"ok": True, "run": run.model_dump()}


async def _execute_orchestration(run: OrchestratorRun, req: OrchestratorRunRequest) -> None:
    """Split the goal, then dispatch one sub-task per terminal in the
    background, broadcasting after each dispatch for a live preview."""
    try:
        n = len(req.terminals)
        labels = [t.label or t.tty for t in req.terminals]
        descriptions = await asyncio.to_thread(
            split_task_for_orchestration, run.task, n, req.model, labels,
            memory_context=req.memory_context,
        )
        run.status = "dispatching"
        for i, (info, desc) in enumerate(zip(req.terminals, descriptions)):
            tty = _resolve_tty(info.tty)
            if tty not in terminals:
                continue
            task = Task(description=desc, model=info.model or "")
            await _place_task(tty, task)
            run.splits.append(
                OrchestratorSplit(
                    tty=tty,
                    label=labels[i] if i < len(labels) else tty,
                    task_id=task.id,
                    description=desc,
                    model=info.model or "",
                    status=task.status,
                )
            )
            await broadcast_state()  # live: splits appear one by one
        run.status = "running" if run.splits else "failed"
        if not run.splits:
            run.error = "No terminals could receive tasks"
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)
    await broadcast_state()


@app.get("/api/orchestrator/runs")
async def get_orchestrator_runs(limit: int = 20, workspace_id: str = ""):
    """Recent orchestrator runs (most recent first) with live split statuses.

    Each workspace sees ONLY its own runs: when `workspace_id` is given,
    runs belonging to other workspaces are excluded."""
    _refresh_orchestration_statuses()
    runs = sorted(orchestrations.values(), key=lambda r: r.created_at, reverse=True)
    if workspace_id:
        runs = [r for r in runs if r.workspace_id == workspace_id]
    return {"runs": [r.model_dump() for r in runs[: max(1, min(limit, 50))]]}


@app.delete("/api/orchestrator/runs")
async def clear_orchestrator_runs(workspace_id: str = ""):
    """Clear the orchestrator board — removes all finished runs so stale
    orchestrations stop showing.  Running runs are left alone.  When
    `workspace_id` is given only that workspace's finished runs are cleared."""
    for rid in [
        r for r, run in orchestrations.items()
        if run.status in ("done", "failed", "planning")
        and (not workspace_id or run.workspace_id == workspace_id)
    ]:
        orchestrations.pop(rid, None)
    await broadcast_state()
    return {"ok": True, "cleared": True}


# --- Agentic Layer API endpoints -------------------------------------------

class AgentConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    auto_retry: Optional[bool] = None
    max_retries: Optional[int] = None
    stall_timeout: Optional[float] = None
    chain_mode: Optional[bool] = None
    synthesis: Optional[bool] = None
    poll_interval: Optional[float] = None
    recap: Optional[bool] = None


@app.get("/api/orchestrator/agent/config")
async def get_agent_config():
    """Return the current agent configuration."""
    return agent_config.model_dump()


@app.patch("/api/orchestrator/agent/config")
async def update_agent_config(req: AgentConfigUpdate):
    """Update agent configuration (partial update — only provided fields)."""
    data = req.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            setattr(agent_config, k, v)
    return {"ok": True, "config": agent_config.model_dump()}


@app.get("/api/orchestrator/agent/status")
async def get_agent_status():
    """Return agent loop status and a summary of active runs."""
    running_runs = [r for r in orchestrations.values() if r.status in ("running", "dispatching")]
    agent_runs = [r for r in running_runs if r.agent_enabled]
    total_actions = sum(len(r.agent_actions) for r in orchestrations.values())
    return {
        "loop_running": agent_loop_task is not None and not agent_loop_task.done(),
        "config": agent_config.model_dump(),
        "active_runs": len(running_runs),
        "agent_runs": len(agent_runs),
        "total_actions": total_actions,
    }


@app.patch("/api/orchestrator/run/{run_id}/agent")
async def toggle_run_agent(run_id: str, enabled: bool = True):
    """Enable or disable the agentic layer for a specific orchestrator run."""
    run = orchestrations.get(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    run.agent_enabled = enabled
    action_text = "enabled" if enabled else "disabled"
    _agent_action(run, "toggle", f"Agentic layer {action_text} for this run")
    await broadcast_state()
    return {"ok": True, "agent_enabled": run.agent_enabled}


@app.get("/api/orchestrator/run/{run_id}/actions")
async def get_run_actions(run_id: str, limit: int = 50):
    """Return the agent action log for a specific run."""
    run = orchestrations.get(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    actions = run.agent_actions[-limit:]
    return {"run_id": run_id, "actions": actions, "total": len(run.agent_actions)}


@app.post("/api/orchestrator/agent/start")
async def start_agent():
    """Manually start the background agent loop."""
    start_agent_loop()
    return {"ok": True, "running": True}


@app.post("/api/orchestrator/agent/stop")
async def stop_agent():
    """Stop the background agent loop."""
    stop_agent_loop()
    return {"ok": True, "running": False}


async def _execute_delivery(tty: str, task: Task, plan: list[tuple[float, str]], ws_sent: bool):
    """Run the delivery plan in the background so the task API returns
    immediately.  Delivers to sidecar-discovered terminals (Terminal.app
    tabs via do script, tmux via send-keys) ONLY.

    Rust PTY sessions are handled exclusively by the frontend watcher
    (App.tsx deliveredTasksRef) which types into the PTY via
    tauri.sendCommand.  The backend MUST NOT inject into Rust PTYs —
    doing so causes double delivery and CLI exits (the /exit from the
    model-switch plan races with the frontend watcher's plain-text
    injection)."""
    # Only deliver when the task is the current (running) task.  Queued
    # tasks must wait — the frontend watcher will deliver them when they
    # are promoted to current via complete_task.
    t = terminals.get(tty)
    if not t or not t.current_task or t.current_task.id != task.id:
        return
    print(f"[delivery] {tty} task={task.id[:8]} model={task.model!r} plan={plan}", flush=True)
    # Rust PTY sessions: the frontend watcher owns delivery.  Skip.
    is_rust_managed = any(
        v.get("tty") == tty for v in session_links.values()
    )
    if is_rust_managed:
        return
    # Sidecar terminals (Terminal.app tabs, tmux): deliver via shell.
    # Model-switch plans restart the agent — VERIFY the new process is up
    # before typing the prompt, otherwise the prompt is swallowed by the
    # dying/booting terminal and the task is lost (delivery race).
    try:
        old_pid = _opencode_pid_on_tty(tty)
        restarted = False  # only record applied_model when the relaunch VERIFIED
        for i, (delay, command) in enumerate(plan):
            if delay:
                await asyncio.sleep(delay)
            if i == 0 and old_pid and command.strip() == "/exit":
                # Typed /exit first — but a STUCK TUI (e.g. dead LLM provider
                # blocking its input loop) ignores keystrokes.  Give it a moment,
                # then SIGTERM (then SIGKILL) so the relaunch can proceed.
                await asyncio.sleep(1.5)
                pid = _opencode_pid_on_tty(tty)
                if pid == old_pid:
                    try:
                        _kill_pid(pid)
                    except Exception:
                        pass
                    await asyncio.sleep(3)
                    pid = _opencode_pid_on_tty(tty)
                    if pid == old_pid:
                        try:
                            _kill_pid(pid, force=True)
                        except Exception:
                            pass
                        await asyncio.sleep(1)
            sent = await send_to_terminal_shell(tty, command)
            print(f"[delivery] {tty} step {i}: sent={sent} cmd={command[:40]!r}", flush=True)
            # After a launch command (opencode [-m model]), wait until a NEW
            # opencode process owns the tty before the next step (the prompt).
            # Only then mark the model as applied — a failed relaunch must NOT
            # be recorded (it would collapse all later deliveries).
            is_launch = command.strip().startswith("opencode")
            if is_launch:
                ok = await _wait_for_new_opencode(tty, old_pid, timeout=30)
                restarted = ok
                print(f"[delivery] {tty} relaunch-verified={ok}", flush=True)
                if ok:
                    # Boot grace: MCP servers spin up ~5-7 s after the process
                    # appears; typing earlier gets swallowed by the boot.
                    await asyncio.sleep(4)
                else:
                    # The requested model failed to launch (bad key / provider
                    # config). NEVER leave the terminal dead — restore the CLI
                    # with a BARE launch, then let the prompt step deliver, so
                    # the task still runs and the CLI is not "closed".
                    print(f"[delivery] {tty} model launch failed — restoring bare opencode", flush=True)
                    await send_to_terminal_shell(tty, "opencode")
                    await _wait_for_new_opencode(tty, old_pid, timeout=30)
                    await asyncio.sleep(4)
    except Exception as exc:
        print(f"[delivery] {tty} EXCEPTION: {exc!r}", flush=True)
        raise
    # Record the model the agent now runs on — ONLY when the (re)launch was
    # verified, so subsequent tasks on the same model deliver straight into
    # the CLI without a pointless restart.
    if task.model and restarted:
        t.applied_model = task.model
        save_state()

def _opencode_pid_on_tty(tty: str) -> Optional[int]:
    """Return the PID of the opencode process attached to `tty`, if any."""
    try:
        r = subprocess.run(
            ["ps", "-axo", "tty=,pid=,comm="],
            capture_output=True, text=True, timeout=3,
        )
        for line in r.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[0] == tty and parts[2] == "opencode":
                return int(parts[1])
    except Exception:
        pass
    return None

async def _wait_for_new_opencode(tty: str, old_pid: Optional[int], timeout: float = 30) -> bool:
    """Poll until a NEW opencode process appears on `tty` (or timeout)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        pid = _opencode_pid_on_tty(tty)
        if pid and pid != old_pid:
            return True
        await asyncio.sleep(0.5)
    return False

@app.post("/api/terminals/{tty}/tasks/{task_id}/complete")
async def complete_task(tty: str, task_id: str, summary: str = ""):
    tty = _resolve_tty(tty)
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    t = terminals[tty]
    # Find task in current/next/queue
    task = None
    was_current = False
    if t.current_task and t.current_task.id == task_id:
        was_current = True
        task = t.current_task
        task.status = "done"
        task.completed_at = time.time()
        task.summary = summary
        t.history.append(task)
        # Promote next — unless the terminal is paused (remote /pause).
        if t.paused:
            pass
        elif t.next_task:
            t.current_task = t.next_task
            t.current_task.status = "running"
            t.current_task.started_at = time.time()
            t.next_task = None
            sent = await manager.send_to_terminal(tty, {"type": "run_task", "task": t.current_task.model_dump()})
            # Deliver via the FULL plan (model-switch aware) — never raw:
            # a promoted model-pinned task must restart the agent on that
            # model BEFORE the prompt, exactly like a freshly added task.
            plan = build_delivery_plan(tty, t.current_task)
            if plan:
                asyncio.create_task(_execute_delivery(tty, t.current_task, plan, sent))
        elif t.queue:
            t.current_task = t.queue.pop(0)
            t.current_task.status = "running"
            t.current_task.started_at = time.time()
            sent = await manager.send_to_terminal(tty, {"type": "run_task", "task": t.current_task.model_dump()})
            plan = build_delivery_plan(tty, t.current_task)
            if plan:
                asyncio.create_task(_execute_delivery(tty, t.current_task, plan, sent))
        else:
            t.current_task = None
    elif t.next_task and t.next_task.id == task_id:
        task = t.next_task
        task.status = "done"
        task.completed_at = time.time()
        task.summary = summary
        t.history.append(task)
        t.next_task = None
    else:
        for i, tk in enumerate(t.queue):
            if tk.id == task_id:
                task = t.queue.pop(i)
                task.status = "done"
                task.completed_at = time.time()
                task.summary = summary
                t.history.append(task)
                break
    if not task:
        raise HTTPException(404, "Task not found")
    save_state()
    await broadcast_state()
    # Auto-generate a next-task suggestion when the terminal goes idle
    # (no next task, no queue) right after the current task completes.
    # Fire-and-forget: the LLM call may take up to 90s and must NOT block
    # the complete endpoint (that would hang the UI + task pipeline).
    if was_current and t.current_task is None and not t.queue:
        asyncio.create_task(_background_suggestion(tty))
    # Refresh the session summary after any task completes so the card always
    # shows what the session has done so far. Also fire-and-forget.
    asyncio.create_task(_background_session_summary(tty))
    return {"ok": True}

async def _background_suggestion(tty: str):
    # "recap" off → no auto next-step suggestion (the "Next step:" recap line).
    if not agent_config.recap:
        return
    try:
        t = terminals.get(tty)
        if not t:
            return
        suggestion = await asyncio.to_thread(suggest_next_task, tty)
        if suggestion and tty in terminals and not terminals[tty].suggested_task:
            terminals[tty].suggested_task = suggestion
            save_state()
            await broadcast_state()
    except Exception:
        pass

async def _background_session_summary(tty: str):
    # "recap" off → no auto session-summary (the "※ recap:" line).
    if not agent_config.recap:
        return
    try:
        t = terminals.get(tty)
        if not t:
            return
        summary = await asyncio.to_thread(generate_session_summary, tty)
        if summary and tty in terminals and summary != terminals[tty].session_summary:
            terminals[tty].session_summary = summary
            save_state()
            await broadcast_state()
    except Exception:
        pass


def _capture_terminal_png(tty: str) -> bytes | None:
    """Capture the terminal pane as a PNG image.

    Tries tmux first (if the terminal runs in tmux), then falls back to the
    sidecar's captured live_output (which is always available).  Returns None
    only if both sources have no content.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print(f"[screenshot] Pillow not available for tty={tty}", flush=True)
        return None

    # Source 1: tmux capture (real terminal pixels if in tmux)
    pane = tmux_pane_targets.get(tty) or find_tmux_pane(tty)
    if not pane:
        # Log why the tmux pane wasn't found (useful for debugging)
        print(f"[screenshot] no tmux pane for tty={tty} (targets: {list(tmux_pane_targets.keys())[:5]}...)", flush=True)
    text = ""
    if pane:
        try:
            result = subprocess.run(
                ["tmux", "capture-pane", "-p", "-t", pane, "-S", "-50"],
                capture_output=True, text=True, timeout=3,
            )
            text = result.stdout
            if not text.strip():
                print(f"[screenshot] tmux capture EMPTY pane={pane!r} rc={result.returncode} stderr={result.stderr[:120]!r}", flush=True)
        except Exception as exc:
            print(f"[screenshot] tmux capture EXC pane={pane!r}: {exc}", flush=True)

    # Source 2: sidecar's captured live_output (always available)
    if not text.strip():
        t = terminals.get(tty)
        if t and t.live_output:
            text = t.live_output

    if not text.strip():
        print(f"[screenshot] no content for tty={tty} (tmux={'YES' if pane else 'NO'})", flush=True)
        return None

    # --- render the PNG ---
    FONT_SIZE = 14
    HDR_H = 30
    PAD = 8
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", FONT_SIZE)
        hdr_font = ImageFont.truetype("/System/Library/Fonts/SFNSText.ttf", 12)
    except Exception:
        font = ImageFont.load_default()
        hdr_font = font

    # Take the last 50 lines max (terminal scrollback)
    all_lines = text.rstrip("\n").split("\n")
    lines = all_lines[-50:]

    dummy = Image.new("RGB", (1, 1))
    draw = ImageDraw.Draw(dummy)
    max_w = max((draw.textlength(ln, font=font) for ln in lines), default=400)
    out_w = int(max_w + PAD * 2 + 1)
    out_h = HDR_H + len(lines) * (FONT_SIZE + 4) + PAD * 2

    img = Image.new("RGB", (out_w, out_h), "#1e1e2e")
    draw = ImageDraw.Draw(img)

    # header bar
    draw.rectangle([0, 0, out_w, HDR_H], fill="#181a1f")
    draw.rectangle([0, HDR_H - 2, out_w, HDR_H], fill="#ffd479")
    now = __import__("datetime").datetime.now()
    time_str = now.strftime("%H:%M:%S")
    date_str = now.strftime("%d/%m/%Y")
    hdr_text = f"TTO {tty} — {time_str} · {date_str}"
    draw.text((12, HDR_H // 2 - 1), hdr_text, fill="#e8e8ea", font=hdr_font)

    # terminal body
    y = HDR_H + PAD
    for ln in lines:
        draw.text((PAD, y), ln, fill="#e8e8ea", font=font)
        y += FONT_SIZE + 4

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    result = buf.getvalue()
    print(f"[screenshot] PNG captured tty={tty} lines={len(lines)} size={len(result)}", flush=True)
    return result


@app.post("/api/screenshot-diag")
async def screenshot_diag(payload: dict):
    """Diagnostic endpoint: the frontend reports WHY a capture failed (pane
    not found, tty→session map empty, etc.).  Logged here for debugging."""
    print(f"[screenshot-diag] {json.dumps(payload, default=str)[:500]}", flush=True)
    return {"ok": True}


@app.post("/api/terminals/{tty}/screenshot")
async def upload_terminal_screenshot(tty: str, request: Request):
    """Accept the terminal-pane screenshot PNG captured by the frontend and
    store it for the task-proof notification (Workstream B).  The body is the
    raw PNG bytes; the query string carries the task_id it belongs to."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    task_id = request.query_params.get("task_id", "")
    body = await request.body()
    if not body or len(body) < 100:  # a PNG header alone is 8 bytes + payload
        raise HTTPException(400, "Empty or too-small screenshot body")
    shots_dir = SCREENSHOTS_DIR
    shots_dir.mkdir(parents=True, exist_ok=True)
    name = f"{tty}_{task_id or 'none'}.png"
    path = shots_dir / name
    path.write_bytes(body)
    # Record the path on the task (found in current/history) so the
    # notification loop can attach it to the completion message.
    target = None
    if tty in terminals:
        t = terminals[tty]
        for cand in ([t.current_task] if t.current_task else []) + [t.next_task] + t.history + t.queue:
            if cand and task_id and cand.id == task_id:
                target = cand
                break
    if target:
        target.screenshot_path = str(path)
        save_state()
    print(f"[screenshot] saved {path} ({len(body)} bytes) task={task_id}", flush=True)
    return {"ok": True, "path": str(path)}

@app.patch("/api/terminals/{tty}/context")
async def update_context(tty: str, context: str):
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    if terminals[tty].current_task:
        terminals[tty].current_task.context = context
    save_state()
    await broadcast_state()
    return {"ok": True}

@app.patch("/api/terminals/{tty}/session-context")
async def update_session_context(tty: str, context: str):
    """Set persistent session context — survives task completion, carries to next task."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    terminals[tty].session_context = context
    save_state()
    await broadcast_state()
    return {"ok": True}

@app.post("/api/terminals/{tty}/session-summary/generate")
async def generate_summary(tty: str):
    """Generate a one-line summary of what was done in this session."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    summary = await asyncio.to_thread(generate_session_summary, tty)
    if summary:
        terminals[tty].session_summary = summary
        save_state()
        await broadcast_state()
    return {"ok": True, "summary": summary}

@app.patch("/api/terminals/{tty}/session-summary")
async def update_session_summary(tty: str, payload: dict):
    """Manually set the session summary label."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    summary = str(payload.get("summary", "")).strip()[:120]
    terminals[tty].session_summary = summary
    save_state()
    await broadcast_state()
    return {"ok": True, "summary": summary}

@app.patch("/api/terminals/{tty}/session-name")
async def update_session_name(tty: str, session_name: str):
    """Set a custom session name for any terminal (not just tmux)."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    terminals[tty].session_name = session_name
    save_state()
    # Fire-and-forget: don't block the event loop while sending a large state
    # payload to all dashboard WS clients (the scanner_loop's 3s broadcast
    # will carry the rename to any clients this one misses).
    asyncio.create_task(broadcast_state())
    return {"ok": True}

class TokenLimitUpdate(BaseModel):
    key: str
    limit: Optional[int] = None
    label: Optional[str] = None

@app.get("/api/token-usage")
async def get_token_usage():
    """Aggregated token usage per model across all sessions (cached 60s)."""
    return get_token_usage_cached()

# --- Available models (for the Task Center model selector) ------------------
_models_cache: Dict[str, Any] = {"data": None, "ts": 0.0}

@app.get("/api/models")
async def get_models():
    """List ALL models available to the installed agents via `opencode models`.
    Cached 120s. Falls back to the models seen in token usage if opencode is
    unavailable. Returns {models: [{key, provider}], recent: [key...]}."""
    global _models_cache
    now = time.time()
    if _models_cache["data"] and now - _models_cache["ts"] < 120:
        return _models_cache["data"]
    models: List[dict] = []
    try:
        r = subprocess.run(
            ["opencode", "models"], capture_output=True, text=True, timeout=25
        )
        for line in (r.stdout or "").splitlines():
            key = line.strip()
            if not key or key.startswith("#"):
                continue
            provider = key.split("/")[0] if "/" in key else "opencode"
            models.append({"key": key, "provider": provider})
    except Exception:
        pass
    if not models:
        # Fallback: whatever the token-usage aggregator has seen
        try:
            usage = aggregate_token_usage()
            for g in usage.get("models", []):
                models.append({"key": g.get("key", ""), "provider": g.get("provider", "opencode")})
        except Exception:
            pass
    # Recently used keys (pinned at the top of the picker)
    recent: List[str] = []
    try:
        usage = aggregate_token_usage()
        recent = [g.get("key", "") for g in usage.get("models", []) if g.get("key")]
    except Exception:
        pass
    data = {"models": models, "recent": recent, "updated_at": now}
    _models_cache = {"data": data, "ts": now}
    return data

# --- Model context/output limits (emergency to-do → fitted prompt) -----------
_limits_cache: Dict[str, Any] = {"data": None, "ts": 0.0}
DEFAULT_LIMIT = (4096, 1024)  # safe assumption for models with unknown limits

# Static fallbacks for common local/small models — only used when opencode's
# verbose model data and Ollama's /api/show can't provide real numbers.
STATIC_LIMITS: Dict[str, tuple[int, int]] = {
    "ollama/llama3.2:latest": (8192, 2048),
    "ollama/llama3.2:1b": (8192, 2048),
    "ollama/llama3.2:3b": (8192, 2048),
    "ollama/llama3-gradient:latest": (8192, 2048),
    "ollama/gemma4:latest": (32768, 16384),
    "ollama/glm-4.7-flash:latest": (32768, 4096),
    "ollama/qwen3-coder-64k:latest": (65536, 8192),
    "ollama/mistral:latest": (8192, 2048),
    "ollama/qwen2.5-coder:7b": (32768, 4096),
    "ollama/phi4-mini:latest": (8192, 2048),
}


def _parse_opencode_verbose_models() -> Dict[str, dict]:
    """Parse `opencode models --verbose` (bare key line + JSON object per model)
    into {key: {context, output}}. Returns {} on any failure."""
    limits: Dict[str, dict] = {}
    try:
        r = subprocess.run(
            ["opencode", "models", "--verbose"], capture_output=True, text=True, timeout=30
        )
    except Exception:
        return limits
    lines = (r.stdout or "").splitlines()
    n = len(lines)
    i = 0
    while i < n:
        key = lines[i].strip()
        # Skip JSON lines, indented lines, separators and comments.
        if not key or key.startswith(("{", "}", "#", '"', "  ", "\t")):
            i += 1
            continue
        if key in ("", "[", "]"):
            i += 1
            continue
        # Find the JSON object that follows this key line.
        j = i + 1
        while j < n and not lines[j].lstrip().startswith("{"):
            j += 1
        if j >= n:
            break
        depth = 0
        buf: List[str] = []
        k = j
        while k < n:
            depth += lines[k].count("{") - lines[k].count("}")
            buf.append(lines[k])
            if depth == 0:
                break
            k += 1
        try:
            obj = json.loads("\n".join(buf))
        except Exception:
            i = k + 1
            continue
        lim = obj.get("limit") or {}
        ctx = lim.get("context")
        out = lim.get("output")
        if ctx:
            limits[key] = {
                "context": int(ctx),
                "output": int(out) if out else max(512, int(ctx) // 8),
            }
        i = k + 1
    return limits


def _ollama_model_limits() -> Dict[str, dict]:
    """Query Ollama's /api/show for context_length of each installed model."""
    limits: Dict[str, dict] = {}
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=3) as resp:
            tags = json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception:
        return limits
    for m in tags.get("models", []):
        name = m.get("name", "")
        if not name:
            continue
        key = f"ollama/{name}"
        try:
            req = urllib.request.Request(
                "http://127.0.0.1:11434/api/show",
                data=json.dumps({"name": name}).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                info = json.loads(resp.read().decode("utf-8", errors="replace"))
            mi = info.get("model_info") or {}
            ctx = mi.get("llama.context_length") or mi.get("context_length")
            if ctx:
                limits[key] = {"context": int(ctx), "output": max(512, int(ctx) // 8)}
        except Exception:
            continue
    return limits


@app.get("/api/models/limits")
async def get_model_limits():
    """Per-model context window + output token limits.

    Sources (priority): `opencode models --verbose` JSON limits → Ollama
    /api/show (context_length) → static fallback table. Cached 120s.
    Returns {limits: {key: {context, output}}, unknown: [keys], default: {...}}."""
    global _limits_cache
    now = time.time()
    if _limits_cache["data"] and now - _limits_cache["ts"] < 120:
        return _limits_cache["data"]
    limits: Dict[str, dict] = {}
    try:
        limits.update(_parse_opencode_verbose_models())
    except Exception:
        pass
    try:
        limits.update(_ollama_model_limits())
    except Exception:
        pass
    for k, (ctx, out) in STATIC_LIMITS.items():
        limits.setdefault(k, {"context": ctx, "output": out})
    # Which known model keys have no limit info at all?
    unknown: List[str] = []
    try:
        mresp = await get_models()
        unknown = [m["key"] for m in mresp.get("models", []) if m.get("key") not in limits]
    except Exception:
        pass
    data = {
        "limits": limits,
        "unknown": unknown,
        "default": {"context": DEFAULT_LIMIT[0], "output": DEFAULT_LIMIT[1]},
        "updated_at": now,
    }
    _limits_cache = {"data": data, "ts": now}
    return data


def _est_tokens(text: str) -> int:
    """Deterministic token estimate (≈4 chars/token). Good enough for fit."""
    return max(1, int(len(text) / 4))


def _strip_bullet(s: str) -> str:
    s = s.strip()
    for pre in ("- ", "* ", "+ ", "• ", "-> ", "→ ", "– "):
        if s.startswith(pre):
            return s[len(pre):].strip()
    return s


def _compact_item(s: str, max_chars: int = 160) -> str:
    """Trim text to its core, collapsing whitespace and eliding the tail."""
    s = _strip_bullet(s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= max_chars:
        return s
    return s[:max_chars].rstrip(" ,;:-") + "…"


class TodoCompileRequest(BaseModel):
    todo_text: str
    model: str = ""
    context: Dict[str, Any] = {}


def build_fitted_todo_prompt(
    todo_text: str, model: str, ctx: Dict[str, Any], limits: Dict[str, dict]
) -> dict:
    """Compile a raw to-do list into a professional prompt that fits the target
    model's context window + output reserve. Compresses iteratively when the
    list is too long for the model."""
    items = [
        re.sub(r"\s+", " ", _strip_bullet(line))
        for line in todo_text.splitlines()
        if _strip_bullet(line)
    ]
    if not items:
        items = [re.sub(r"\s+", " ", todo_text.strip())] if todo_text.strip() else []

    context_limit, output_limit = DEFAULT_LIMIT
    if model and model in limits:
        context_limit = int(limits[model].get("context") or context_limit)
        output_limit = int(limits[model].get("output") or output_limit)
    reserve = min(output_limit, max(512, context_limit // 4))
    budget = max(256, context_limit - reserve)

    def make_ctx(verbosity: int) -> List[str]:
        """Context lines; verbosity 0=minimal, 1=normal, 2=full."""
        out: List[str] = []
        cwd = str(ctx.get("cwd") or "").strip()
        if cwd and verbosity >= 1:
            out.append(f"- Project: {_compact_item(cwd, 120)}")
        sc = str(ctx.get("session_context") or "").strip()
        if sc:
            out.append(f"- Session context: {_compact_item(sc, 300 if verbosity >= 2 else 180)}")
        cur = str(ctx.get("current_task") or "").strip()
        if cur:
            out.append(f"- In progress: {_compact_item(cur, 160 if verbosity >= 2 else 100)}")
        summ = str(ctx.get("summary") or "").strip()
        if summ and verbosity >= 1:
            out.append(f"- Summary: {_compact_item(summ, 160 if verbosity >= 2 else 100)}")
        hist = ctx.get("recent_history")
        if isinstance(hist, list) and hist and verbosity >= 2:
            joined = " → ".join(_compact_item(str(h), 80) for h in hist[:3])
            if joined:
                out.append(f"- Recent: {joined}")
        return out

    def build(items_: List[str], verbosity: int, tlen: int) -> tuple[str, List[str], int]:
        ctx_l = make_ctx(verbosity)
        trimmed = [_compact_item(it, tlen) for it in items_]
        parts = [
            "# OBJECTIVE",
            "Execute the to-do list below for the current project, in order. "
            "Do not stop until each item is done or explicitly blocked.",
            "",
        ]
        if ctx_l:
            parts.append("# CONTEXT")
            parts.extend(ctx_l)
            parts.append("")
        parts.append("# TASKS")
        for i, it in enumerate(trimmed, 1):
            parts.append(f"{i}. {it}")
        parts.append("")
        parts.append("# CONSTRAINTS")
        parts.append("- Work only on the listed tasks; do not invent extra work.")
        parts.append(f"- Keep the entire response within ~{reserve} output tokens; dense, no preamble.")
        parts.append("- Finish by listing each task number with a one-line result.")
        parts.append("")
        parts.append("# DEFINITION OF DONE")
        parts.append("Every task is completed or marked blocked with a concrete reason.")
        prompt = "\n".join(parts)
        return prompt, trimmed, _est_tokens(prompt)

    prompt, trimmed, est = build(items, 2, 160)
    original_est = est
    steps: List[str] = []
    dropped = 0

    if est > budget:
        steps.append(
            f"Raw prompt ≈ {est} tokens exceeds {model or 'default'} budget ({budget}) — compressing."
        )
        # Pass 1: tighter context
        if est > budget:
            prompt, trimmed, est = build(items, 1, 160)
            steps.append("Trimmed session context lines.")
        # Pass 2: shorter task items
        if est > budget:
            prompt, trimmed, est = build(items, 1, 110)
            steps.append("Compressed each to-do item to its core action.")
        # Pass 3: minimal context
        if est > budget:
            prompt, trimmed, est = build(items, 0, 110)
            steps.append("Dropped non-essential context.")
        # Pass 4: cut low-priority tasks from the tail
        if est > budget and len(trimmed) > 2:
            n = len(trimmed)
            while est > budget and len(trimmed) > 2:
                trimmed = trimmed[: len(trimmed) - 1]
                prompt, trimmed2, est = build(trimmed, 0, 110)
            dropped = n - len(trimmed)
            if dropped > 0:
                steps.append(
                    f"Kept the {len(trimmed)} highest-priority tasks; {dropped} lower-priority item(s) omitted to fit the context window."
                )
        if dropped > 0 and "# TASKS" in prompt:
            note = (
                f"(Note: {dropped} additional to-do item(s) were omitted to fit the model's context window.)"
            )
            prompt = prompt.replace(
                "\n# CONSTRAINTS", f"\n{note}\n\n# CONSTRAINTS", 1
            )

    fits = est <= budget
    return {
        "prompt": prompt,
        "stats": {
            "model": model,
            "est_tokens": est,
            "original_est": original_est,
            "context_limit": context_limit,
            "output_limit": output_limit,
            "reserve": reserve,
            "budget": budget,
            "fits": fits,
            "compressed": est < original_est,
            "dropped": dropped,
            "steps": steps,
        },
    }


@app.post("/api/todo/compile")
async def compile_todo(req: TodoCompileRequest):
    """Compile a raw to-do list into a professional prompt fitted to the
    selected model's context window + output limit (emergency use)."""
    if not req.todo_text.strip():
        raise HTTPException(400, "To-do list is empty")
    limits_resp = await get_model_limits()
    limits = limits_resp.get("limits", {})
    return build_fitted_todo_prompt(req.todo_text, req.model, req.context or {}, limits)


# --- Run command (IDE ▶ Run button) ---------------------------------------
class RunCommandRequest(BaseModel):
    command: str
    cwd: str = ""

_RUN_TIMEOUT_S = 90  # hard cap so a runaway command can never hang the HTTP request


def _is_long_running(command: str) -> bool:
    """Heuristic: commands the ▶ Run button should NOT use — dev servers that
    block forever (runserver, --reload, anything ending in 'dev').  For those
    the user must use the in-IDE terminal; /api/run caps them at 90s instead."""
    c = command.strip().lower()
    return "runserver" in c or "--reload" in c or c.endswith("dev")


def _run_shell_capture(command: str, cwd: Optional[str]) -> dict:
    """Run a shell command and capture stdout/stderr/exit code.  BLOCKING —
    callers must run it via asyncio.to_thread so the event loop stays free.
    The command is passed straight through to `bash -lc` (same trust model as
    /api/terminals/{tty}/command): no allowlist, the user's own machine."""
    start = time.time()
    timed_out = False
    stdout, stderr, exit_code = "", "", 0
    try:
        proc = subprocess.run(
            ["bash", "-lc", command],
            cwd=cwd or None,
            capture_output=True,
            text=True,
            timeout=_RUN_TIMEOUT_S,
        )
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        exit_code = proc.returncode
    except subprocess.TimeoutExpired as exc:
        # subprocess.run kills the child on timeout; partial output is on the
        # exception.  exit 124 = shell convention for "killed by timeout".
        timed_out = True
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        hint = (" (a dev server?) use the in-IDE terminal for long-running "
                "processes — /api/run only captures completed commands"
                if _is_long_running(command) else
                " — use the in-IDE terminal for long-running processes")
        if not stderr.strip():
            stderr = f"[timed out after {_RUN_TIMEOUT_S}s{hint}]"
        else:
            stderr = stderr.rstrip() + f"\n[timed out after {_RUN_TIMEOUT_S}s{hint}]"
        exit_code = 124
    except Exception as exc:
        stderr, exit_code = f"{exc}\n", 1
    return {
        "ok": True,
        "stdout": stdout,
        "stderr": stderr,
        "exitCode": exit_code,
        "exit_code": exit_code,  # snake_case mirror — CodeRunner.tsx reads data.exit_code
        "duration_ms": int((time.time() - start) * 1000),
        "timeout": timed_out,
    }


@app.post("/api/run")
async def run_command(payload: RunCommandRequest):
    """Run an arbitrary shell command locally and return its captured output.

    Used by the IDE's ▶ Run button (web mode).  Same trust model as the
    existing /api/terminals/{tty}/command endpoint: this server binds to
    127.0.0.1 by default and only a local/Tauri page may call it (origin
    guard), so the command is executed as-is via `bash -lc` with NO allowlist
    — `python3 manage.py migrate`, `gcc`, `javac`, whatever the user runs in
    their editor must Just Work.

    Long-running commands (dev servers) are capped at 90s and the response
    carries timeout:true so the frontend can tell the user to use the in-IDE
    terminal instead.
    """
    command = (payload.command or "").strip()
    if not command:
        raise HTTPException(400, detail="command is required")

    cwd = None
    if payload.cwd and payload.cwd.strip():
        try:
            cwd = Path(payload.cwd).resolve()
        except Exception:
            cwd = None
        if not cwd or not cwd.exists() or not cwd.is_dir():
            raise HTTPException(400, detail=f"cwd is not a valid directory: {payload.cwd}")

    result = await asyncio.to_thread(_run_shell_capture, command, str(cwd) if cwd else None)
    return JSONResponse(result)


@app.patch("/api/terminals/{tty}/model")
async def set_terminal_model(tty: str, model: str = ""):
    """Store the selected model for a terminal (session-id aware)."""
    tty = _resolve_tty(tty)
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    terminals[tty].model = (model or "").strip()
    save_state()
    await broadcast_state()
    return {"ok": True, "tty": tty, "model": terminals[tty].model}

@app.patch("/api/token-usage/limits")
async def update_token_limits(payload: TokenLimitUpdate):
    """Set/clear a model's token limit (and optional display label)."""
    token_config.setdefault("limits", {})
    token_config.setdefault("labels", {})
    if payload.label is not None:
        token_config["labels"][payload.key] = payload.label
    if payload.limit is not None:
        token_config["limits"][payload.key] = payload.limit
    elif payload.limit is None and payload.label is None:
        token_config["limits"].pop(payload.key, None)
    save_state()
    _token_cache["data"] = None  # invalidate cache
    return get_token_usage_cached()

@app.post("/api/terminals/{tty}/suggest-task")
async def suggest_task(tty: str):
    tty = _resolve_tty(tty)
    """Generate an AI-suggested next task from session context + history."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    suggestion = await asyncio.to_thread(suggest_next_task, tty)
    terminals[tty].suggested_task = suggestion
    save_state()
    await broadcast_state()
    return {"ok": True, "suggestion": suggestion}

@app.post("/api/terminals/{tty}/suggest-task/accept")
async def accept_suggestion(tty: str):
    tty = _resolve_tty(tty)
    """Turn the current suggestion into the real next task."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    t = terminals[tty]
    suggestion = (t.suggested_task or "").strip()
    if not suggestion:
        raise HTTPException(400, "No suggestion to accept")
    t.suggested_task = ""
    task = Task(description=suggestion, status="pending", created_at=time.time())
    if t.current_task is None:
        task.status = "running"
        task.started_at = time.time()
        t.current_task = task
    elif t.next_task is None:
        t.next_task = task
    else:
        t.queue.append(task)
    save_state()
    await broadcast_state()
    is_current = (
        t.current_task is not None
        and t.current_task.id == task.id
        and t.current_task.status == "running"
    )
    sent = await manager.send_to_terminal(
        tty, {"type": "run_task" if is_current else "new_task", "task": task.model_dump()}
    )
    if is_current:
        # Deliver via the FULL plan (model-switch aware) so a suggestion
        # accepted with a pinned model restarts the agent on that model.
        plan = build_delivery_plan(tty, task)
        if plan:
            asyncio.create_task(_execute_delivery(tty, task, plan, sent))
    elif not sent:
        await send_to_terminal_shell(tty, task.description)
    return {"ok": True, "task": task.model_dump()}

@app.post("/api/terminals/{tty}/suggest-task/dismiss")
async def dismiss_suggestion(tty: str):
    tty = _resolve_tty(tty)
    """Dismiss the current suggestion."""
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    terminals[tty].suggested_task = ""
    save_state()
    await broadcast_state()
    return {"ok": True}

# --- DEPRECATED: Terminal engine moved to Tauri/Rust (src-tauri/src/terminal/) ---
# The code below (PTY sessions, tmux attach, Terminal.app windows) is retained
# for backward-compatibility with agent.py but is NOT used by the native desktop
# app. New features go through Rust IPC (terminal_create, terminal_write, etc.).
# ---------------------------------------------------------------------------

class PtySession:
    """A real terminal session backed by a PTY running tmux attach."""
    def __init__(self, pane_id: str, session_name: str):
        self.pane_id = pane_id
        self.session_name = session_name
        self.master_fd: int = -1
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.cwd: str = str(Path.home())

    def set_winsize(self, cols: int, rows: int):
        """Resize the PTY via TIOCSWINSZ ioctl + force the tmux window to match."""
        if self.master_fd >= 0:
            try:
                winsize = struct.pack('HHHH', rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except Exception:
                pass
        # Belt-and-braces: tell tmux the new window size directly so the
        # attached window always matches the browser pane even if SIGWINCH
        # propagation is unreliable.
        try:
            subprocess.run(
                ["tmux", "resize-window", "-t", self.session_name,
                 "-x", str(cols), "-y", str(rows)],
                capture_output=True, timeout=2,
            )
        except Exception:
            pass

    def close(self):
        """Kill the PTY process."""
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.kill()
            except Exception:
                pass
        if self.master_fd >= 0:
            try:
                os.close(self.master_fd)
            except Exception:
                pass
            self.master_fd = -1

# Global registry of active PTY sessions (keyed by pane_id)
pty_sessions: Dict[str, PtySession] = {}
pane_windows: Dict[str, str] = {}  # pane_id -> Terminal.app window id

def embed_session_for(pane_id: str) -> str:
    return f"tto-p-{pane_id}"

def ensure_embed_session(pane_id: str, cwd: Optional[str] = None) -> str:
    """Create a detached tmux session for this pane (real, not virtual)."""
    session = embed_session_for(pane_id)
    r = subprocess.run(["tmux", "has-session", "-t", session], capture_output=True, timeout=2)
    if r.returncode != 0:
        cmd = ["tmux", "new-session", "-d", "-s", session, "-x", "120", "-y", "30"]
        if cwd:
            cmd += ["-c", cwd]
        cmd += [
            "/usr/bin/env",
            "COLORTERM=truecolor",
            "TERM=xterm-256color",
            "FORCE_COLOR=3",
            "CLICOLOR=1",
            "CLICOLOR_FORCE=1",
            "SHELL=/bin/zsh",
            "LANG=en_US.UTF-8",
            "/bin/zsh",
            "-l",
        ]
        tmux_env = dict(os.environ)
        tmux_env["TERM"] = "xterm-256color"
        tmux_env["COLORTERM"] = "truecolor"
        tmux_env["FORCE_COLOR"] = "3"
        tmux_env["CLICOLOR"] = "1"
        tmux_env["CLICOLOR_FORCE"] = "1"
        tmux_env["SHELL"] = "/bin/zsh"
        subprocess.run(cmd, capture_output=True, timeout=3, env=tmux_env)

        # Configure tmux session options for truecolor (RGB / 24-bit) and dynamic sizing
        subprocess.run(["tmux", "set-option", "-t", session, "default-terminal", "xterm-256color"], capture_output=True, timeout=2)
        subprocess.run(["tmux", "set-option", "-ga", "-t", session, "terminal-overrides", ",xterm-256color:Tc,screen-256color:Tc"], capture_output=True, timeout=2)
        subprocess.run(["tmux", "set-option", "-ga", "-t", session, "terminal-features", ",xterm-256color:RGB,screen-256color:RGB"], capture_output=True, timeout=2)
        subprocess.run(["tmux", "set-option", "-t", session, "-g", "window-size", "latest"], capture_output=True, timeout=2)

        # Persist truecolor environment variables for any processes spawned inside this tmux session
        for k, v in [
            ("COLORTERM", "truecolor"),
            ("TERM", "xterm-256color"),
            ("FORCE_COLOR", "3"),
            ("CLICOLOR", "1"),
            ("CLICOLOR_FORCE", "1"),
            ("SHELL", "/bin/zsh"),
        ]:
            subprocess.run(["tmux", "set-environment", "-t", session, k, v], capture_output=True, timeout=2)

    return session

def _open_real_window(session_name: str) -> Optional[str]:
    """Open a Terminal.app window attached to an existing tmux session.
    Returns the window id or None."""
    cmd = f"tmux attach -t {session_name}"
    script = f'''
    tell application "Terminal"
        activate
        do script {_as_script_str(cmd)}
    end tell
    '''
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=8)
        m = re.search(r"window id (\d+)", r.stdout.strip())
        if r.returncode == 0 and m:
            return m.group(1)
    except Exception:
        pass
    return None

async def _spawn_pty(session_name: str, cols: int, rows: int) -> tuple[int, asyncio.subprocess.Process]:
    """Spawn a real PTY running tmux attach -t session. Returns (master_fd, process)."""
    master_fd, slave_fd = pty.openpty()
    # Set initial size
    winsize = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

    def _setup_ctty():
        """Make the slave (fd 0) the controlling terminal so SIGWINCH reaches tmux."""
        try:
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        except Exception:
            pass

    # Keep master blocking — run_in_executor handles the blocking read
    # Spawn tmux attach as a real process attached to the slave PTY
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["FORCE_COLOR"] = "3"
    env["CLICOLOR"] = "1"
    env["CLICOLOR_FORCE"] = "1"
    env["SHELL"] = "/bin/zsh"
    tmux_bin = shutil.which("tmux") or "/opt/homebrew/bin/tmux" or "tmux"
    proc = await asyncio.create_subprocess_exec(
        tmux_bin, "attach", "-t", session_name,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=env,
        preexec_fn=_setup_ctty,
    )
    os.close(slave_fd)
    return master_fd, proc

class FileContent(BaseModel):
    path: str
    content: str

def _allowed_roots() -> List[Path]:
    """Finder-accessible roots: Home + Volumes + registered workspace project paths."""
    roots = [Path.home(), Path("/Volumes")]
    for ws in stored_workspaces:
        pp = (ws or {}).get("projectPath") or ""
        if pp:
            try:
                roots.append(Path(pp).expanduser().resolve())
            except Exception:
                pass
    return roots

# Operating system critical directories that cannot be deleted
_PROTECTED_SYSTEM_DIRS = {
    "/", "/bin", "/sbin", "/usr", "/usr/bin", "/usr/sbin",
    "/System", "/Library", "/private", "/private/etc", "/etc",
}


def _is_path_in_allowed_roots(path: Path) -> bool:
    """Check if a resolved path is within allowed roots (Home, Volumes, workspaces)."""
    try:
        resolved = path.resolve()
    except Exception:
        return False
    
    for root in _allowed_roots():
        try:
            resolved.relative_to(root.resolve())
            return True
        except ValueError:
            continue
    return False

def _is_blocked_path(p: Path) -> bool:
    """Security check for destructive or sensitive operations.
    Blocks access to sensitive files/directories (SSH keys, credentials, .env, etc.)
    while allowing project configuration files in user workspace."""
    path_str = str(p)
    for fragment in BLOCKED_PATH_FRAGMENTS:
        if fragment in path_str:
            return True
    return False

def _safe_path(p: str) -> Path:
    """Resolve any path accessible in macOS Finder.

    Expands '~', normalizes path traversal ('..'), and resolves symlinks.
    Supports absolute paths anywhere across the macOS filesystem accessible
    by the user (including /Users, /Volumes, /tmp, external disks, project roots)
    as well as relative paths.
    """
    if not p or not str(p).strip():
        raise HTTPException(400, "Path cannot be empty")

    clean = str(p).strip()
    expanded = os.path.expanduser(clean)
    if not os.path.isabs(expanded):
        expanded = os.path.join(str(Path.home()), expanded)

    norm = os.path.normpath(expanded)
    return Path(norm).resolve()

def _display_path(p: Path) -> str:
    """Return the absolute canonical path string for API responses."""
    return str(p.resolve())

@app.get("/api/files")
async def list_files(path: str = ""):
    """List files in the given path (relative to home directory).
    When path is empty, returns a 400 error — listing the home directory
    was a security concern and caused the FileBrowser to show ALL system files."""
    if not path or not path.strip():
        raise HTTPException(400, "Path is required — open a workspace with a project path to browse files")
    p = _safe_path(path)
    if _is_blocked_path(p):
        raise HTTPException(403, "Access denied: sensitive file")
    if not p.exists():
        raise HTTPException(404, "Path not found")
    if p.is_file():
        return {"path": _display_path(p), "files": [
            {"name": p.name, "is_dir": False, "size": p.stat().st_size, "mtime": p.stat().st_mtime}
        ]}
    items = []
    try:
        for child in sorted(p.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
            if _is_blocked_path(child):
                continue  # hide sensitive files from directory listings
            st = child.stat()
            items.append({
                "name": child.name,
                "is_dir": child.is_dir(),
                "size": st.st_size if child.is_file() else None,
                "mtime": st.st_mtime,
            })
    except PermissionError:
        raise HTTPException(403, "Permission denied")
    return {"path": _display_path(p), "files": items}

_DJANGO_SKIP_DIRS = {
    "node_modules", "venv", ".venv", "env", ".env", "__pycache__", ".git",
    ".idea", ".vscode", "dist", "build", "target", "site-packages",
    "Library", ".Trash", ".claude", ".cache", "node_modules.asar",
}


@app.get("/api/files/search")
async def search_project_files(path: str = "", query: str = "", limit: int = 100):
    """Recursively search for files matching a query within `path`.
    Returns matching files up to `limit`, pruning hidden/heavy directories."""
    if not path or not path.strip():
        raise HTTPException(400, "Path is required")
    if not query or not query.strip():
        return {"query": query, "results": [], "total": 0}

    root = _safe_path(path)
    if _is_blocked_path(root):
        raise HTTPException(403, "Access denied")
    if not root.exists() or not root.is_dir():
        raise HTTPException(404, "Directory not found")

    q = query.strip().lower()
    matches = []
    max_scan = 6000
    scanned = 0

    try:
        for dirpath, dirnames, filenames in os.walk(str(root)):
            # Prune skipped directories in-place so os.walk does not descend
            dirnames[:] = [
                d for d in dirnames
                if d not in _DJANGO_SKIP_DIRS and not d.startswith(".")
            ]

            for fname in filenames:
                scanned += 1
                if scanned > max_scan:
                    break
                if fname.startswith("."):
                    continue

                if q in fname.lower():
                    full_p = Path(dirpath) / fname
                    if _is_blocked_path(full_p):
                        continue
                    try:
                        rel = os.path.relpath(str(full_p), str(root))
                    except ValueError:
                        rel = fname
                    matches.append({
                        "name": fname,
                        "path": str(full_p),
                        "rel_path": rel,
                        "is_dir": False,
                    })
                    if len(matches) >= limit:
                        break

            if len(matches) >= limit or scanned > max_scan:
                break
    except PermissionError:
        pass
    except Exception as e:
        logger.warning(f"Error during file search in {path}: {e}")

    return {"query": query, "results": matches, "total": len(matches)}


@app.get("/api/django-root")
async def detect_django_root(path: str = ""):
    """Find the Django project root for a workspace path.

    A Django project's ``manage.py`` often lives in a subfolder rather than at
    the opened workspace root (e.g. opening ``~/Desktop/dd`` while the project
    is ``~/Desktop/dd/ecommerce/``).  Quick command buttons (runserver,
    migrate, …) must run from the folder that CONTAINS ``manage.py``.

    Search order (bounded, no recursion):
      1. ``<path>/manage.py``            — standard layout
      2. common nested roots             — ecommerce/backend/src/server/app
      3. other top-level subdirectories  — first that contains manage.py
    Returns ``{ root: "…", found: bool }`` with the absolute path of the
    Django root (the workspace itself when found there).
    """
    if not path or not path.strip():
        return {"root": None, "found": False}
    p = _safe_path(path)
    if not p.exists():
        return {"root": None, "found": False}
    if p.is_file():
        p = p.parent

    # Fast path: the workspace root itself is a Django project.
    if (p / "manage.py").is_file():
        return {"root": str(p), "found": True}

    # Common nested names first, then any other immediate subdirectory.
    preferred = ["backend", "src", "server", "app", "project", "django"]
    try:
        subdirs = sorted(
            (c for c in p.iterdir() if c.is_dir() and c.name not in _DJANGO_SKIP_DIRS),
            key=lambda c: (c.name.lower() not in preferred, c.name.lower()),
        )
    except PermissionError:
        subdirs = []

    checked = 0
    for sub in subdirs:
        if checked >= 25:
            break
        checked += 1
        if (sub / "manage.py").is_file():
            return {"root": str(sub), "found": True}
    return {"root": None, "found": False}


@app.get("/api/file")
async def get_file(path: str):
    p = _safe_path(path)
    if _is_blocked_path(p):
        raise HTTPException(403, "Access denied: sensitive file")
    if not p.exists() or not p.is_file():
        raise HTTPException(404, "File not found")
    try:
        # Check first 8KB for null byte to safely detect binary files
        with open(p, "rb") as f:
            chunk = f.read(8192)
            if b"\x00" in chunk:
                return {
                    "path": _display_path(p),
                    "content": "",
                    "is_binary": True,
                    "size": p.stat().st_size,
                }
        content = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return {
            "path": _display_path(p),
            "content": "",
            "is_binary": True,
            "size": p.stat().st_size,
        }
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"path": _display_path(p), "content": content, "is_binary": False}

@app.put("/api/file")
async def put_file(payload: FileContent):
    p = _safe_path(payload.path)
    if _is_blocked_path(p):
        raise HTTPException(403, "Access denied: sensitive file")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(payload.content, encoding="utf-8")
    return {"ok": True, "path": _display_path(p)}

# MIME type map for common image extensions
_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
}


@app.get("/api/file/blob")
async def get_file_blob(path: str):
    """Serve a file as raw binary — used for images and other non-text files.
    Returns 403 for sensitive paths and 404 for missing files, with
    Cache-Control: no-store to prevent the browser/webview from caching
    error responses (the main cause of 'images sometimes don't open').
    """
    try:
        if not path or not path.startswith('/'):
            raise HTTPException(422, "Path must be absolute (start with /)")
    except HTTPException:
        raise
    try:
        p = _safe_path(path)
    except HTTPException as exc:
        # Return 404 (not 403) for access-denied blob paths so the webview
        # doesn't cache a 403 and break future loads of the same URL.
        raise HTTPException(404, "File not found") from exc
    if _is_blocked_path(p):
        raise HTTPException(404, "File not found")
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    data = p.read_bytes()
    ext = p.suffix.lower()
    media_type = _IMAGE_MIME.get(ext, "application/octet-stream")
    # ETag from mtime+size lets the browser skip re-fetching unchanged images.
    import hashlib
    stat = p.stat()
    etag_val = hashlib.md5(f"{stat.st_mtime_ns}-{stat.st_size}".encode()).hexdigest()
    resp = StreamingResponse(io.BytesIO(data), media_type=media_type)
    resp.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
    resp.headers["ETag"] = f'"{etag_val}"'
    resp.headers["Content-Length"] = str(stat.st_size)
    return resp

@app.post("/api/file/rename")
async def rename_file(payload: dict):
    """Rename or move a file/directory.
    payload: {"path": "existing/path", "new_name": "new_name"}
    or {"path": "existing/path", "new_path": "existing/new/path"}
    """
    try:
        old_path = payload.get("path", "")
        new_name = payload.get("new_name", "")
        new_path = payload.get("new_path", "")

        if not old_path:
            raise HTTPException(400, "path is required")
        if not new_name and not new_path:
            raise HTTPException(400, "new_name or new_path is required")

        old = _safe_path(old_path)
        if _is_blocked_path(old):
            raise HTTPException(403, "Access denied: sensitive file")
        if not old.exists():
            raise HTTPException(404, "File not found")

        if new_path:
            new = _safe_path(new_path)
        else:
            # Rename within same directory
            parent = old.parent
            new = parent / new_name

        # Check for name collision
        if new.exists():
            raise HTTPException(409, "A file with that name already exists")

        old.rename(new)
        return JSONResponse({"ok": True, "path": _display_path(new)})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/dir/delete")
async def delete_dir(path: str = Query(...)):
    """Recursively delete a directory."""
    try:
        p = _safe_path(path)
        if str(p) in _PROTECTED_SYSTEM_DIRS or str(p) == "/":
            raise HTTPException(403, "Cannot delete protected system directory")
        if not p.exists():
            raise HTTPException(404, "Directory not found")
        if not p.is_dir():
            raise HTTPException(400, "Not a directory")
        import shutil
        shutil.rmtree(p)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# --- File creation ----------------------------------------------------------

@app.post("/api/file/create")
async def create_file(payload: FileContent):
    """Create a new file. Parent directories are auto-created.
    payload.path must be an absolute path (starting with /).
    payload.content is optional — empty string if omitted.
    """
    try:
        if not payload.path or not payload.path.startswith('/'):
            raise HTTPException(422, "Path must be absolute (start with /)")
        p = _safe_path(payload.path)
        if _is_blocked_path(p):
            raise HTTPException(403, "Access denied: sensitive file")
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists():
            raise HTTPException(409, f"File already exists: {p}")
        content = payload.content if hasattr(payload, "content") else ""
        p.write_text(content, encoding="utf-8")
        return {"ok": True, "path": _display_path(p)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/api/file/delete")
async def delete_file(path: str):
    """Delete a file or empty directory."""
    try:
        p = _safe_path(path)
        if str(p) in _PROTECTED_SYSTEM_DIRS or str(p) == "/":
            raise HTTPException(403, "Cannot delete protected system file or directory")
        if not p.exists():
            raise HTTPException(404, "Path not found")
        if p.is_dir():
            if any(p.iterdir()):
                raise HTTPException(400, "Directory not empty")
            p.rmdir()
        else:
            p.unlink()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# --- Directory creation -----------------------------------------------------

@app.post("/api/dir/create")
async def create_dir(payload: dict):
    """Create a directory (recursive).
    payload: {"path": "..."} — path must be absolute (start with /).
    """
    path_str = payload.get("path", "")
    try:
        if not path_str or not path_str.startswith('/'):
            raise HTTPException(422, "Path must be absolute (start with /)")
        p = _safe_path(path_str)
        p.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "path": _display_path(p)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


# --- Git helpers ------------------------------------------------------------

def _find_git_root(path: Path) -> Optional[Path]:
    """Walk up from path looking for a .git directory anywhere on the system."""
    p = path.resolve()
    current = p if p.is_dir() else p.parent
    while current != current.parent:
        if (current / ".git").exists():
            return current.resolve()
        current = current.parent
    return None


def _run_git(git_root: Path, args: list) -> tuple[int, str, str]:
    """Run a git command in the given repo root. Returns (rc, stdout, stderr)."""
    try:
        r = subprocess.run(
            ["git", *args],
            cwd=str(git_root),
            capture_output=True,
            text=True,
            timeout=10,
        )
        return r.returncode, r.stdout, r.stderr
    except Exception as e:
        return 1, "", str(e)


def _repo_root(workspace: str = "") -> Optional[Path]:
    """Locate the git repo the given workspace path belongs to.

    Git operations must run against the OPEN WORKSPACE repo, not \$HOME.  Falls
    back to the home directory only when no workspace path is supplied.
    """
    target = _safe_path(workspace) if (workspace or "").strip() else Path.home()
    repo = _find_git_root(target)
    if repo and not _is_path_in_allowed_roots(repo):
        # Repo found outside allowed roots - security boundary violation
        return None
    return repo
def _to_repo_relative(repo: Path, file_path: str) -> str:
    """Normalize a file spec to a path relative to the repo root.

    Accepts both absolute paths and paths already relative to the repo root
    (the format /api/git/status returns).  Handles the common case where the
    open workspace IS the repo root.
    """
    p = Path(file_path)
    if not p.is_absolute():
        return file_path
    try:
        return os.path.relpath(p.resolve(), repo.resolve())
    except ValueError:
        return file_path


@app.get("/api/git/status")
async def get_git_status(path: str = ""):
    """Return git status info for the given path (relative to home).
    Returns: branch, changed files with status (M=A, D=deleted, U=untracked, etc.)
    """
    try:
        target = _safe_path(path) if path else Path.home()
        git_root = _find_git_root(target)
        if not git_root:
            return {"in_repo": False}

        # Get branch name
        rc, stdout, _ = _run_git(git_root, ["rev-parse", "--abbrev-ref", "HEAD"])
        branch = stdout.strip() if rc == 0 else ""

        # Get porcelain status
        rc, stdout, _ = _run_git(git_root, ["status", "--porcelain=v1", "--branch"])
        files = []
        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            # `--branch` prepends metadata lines starting with '#' (e.g. the
            # "## main...upstream" header) — never treat those as file entries.
            if line.startswith("#"):
                continue
            # Porcelain format: "XY filename" or "XY filename -> destination"
            code = line[:2]
            rest = line[3:].strip()
            staged_code = code[0] if len(code) >= 1 else " "
            unstaged_code = code[1] if len(code) >= 2 else " "
            # Pick the most relevant status: staged takes precedence
            status = unstaged_code if unstaged_code != " " else staged_code
            # Map the status character
            status_map = {
                "A": "added",
                "M": "modified",
                "D": "deleted",
                "R": "renamed",
                "C": "copied",
                "U": "unmerged",
                "?": "untracked",
                "!": "ignored",
                " ": "unknown",
            }
            display_status = status_map.get(status, status)
            # Properly staged = index column (X) shows a real change letter.
            # Untracked ('??') and ignored ('!!') rows must NOT count as staged.
            staged = staged_code in ("A", "M", "D", "R", "C")
            # Clean the filename (remove leading space for renamed/copied)
            file_path = rest.split("->")[0].strip()
            files.append({"path": file_path, "status": display_status, "staged": staged})

        return {
            "in_repo": True,
            "branch": branch if branch else None,
            "files": files,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/git/init")
async def git_init(req: Request):
    """Initialize a git repository in the given workspace path.

    The Git panel shows an empty state when the workspace is not a repo — this
    lets the user bootstrap one without leaving the IDE. Refuses when a repo
    already exists (use status instead).

    Accepts the path as a `?path=` query param or as a JSON `{"path": …}`
    body (the frontend sends the body form).
    """
    path = ""
    try:
        body = await req.json()
        path = (body or {}).get("path", "")
    except Exception:
        path = req.query_params.get("path", "")
    if not path:
        path = req.query_params.get("path", "")
    if not path or not path.strip():
        raise HTTPException(400, "Path is required")
    target = _safe_path(path)
    if not target.exists():
        raise HTTPException(404, "Path not found")
    if not target.is_dir():
        raise HTTPException(400, "Path is not a directory")
    if _find_git_root(target) is not None:
        return {"ok": False, "message": "Already a git repository"}
    rc, out, err = _run_git(target, ["init"])
    if rc != 0:
        raise HTTPException(500, err or "git init failed")
    return {"ok": True, "message": "Repository initialized"}


@app.get("/api/git/branch")
async def get_git_branch(path: str = ""):
    """Return current branch name."""
    try:
        target = _safe_path(path) if path else Path.home()
        git_root = _find_git_root(target)
        if not git_root:
            return {"branch": None}
        rc, stdout, _ = _run_git(git_root, ["rev-parse", "--abbrev-ref", "HEAD"])
        branch = stdout.strip() if rc == 0 else ""
        return {"branch": branch if branch else None}
    except Exception:
        return {"branch": None}


# --- File watcher (on-demand per workspace) ---

@app.get("/api/watcher/start")
async def start_watcher(path: str = ""):
    """Start file watching for a specific directory."""
    try:
        target = _safe_path(path) if path else Path.home()
        from file_watcher import watch_directory
        asyncio.create_task(watch_directory(str(target), broadcast_state))
        return {"ok": True, "watching": str(target)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# --- Git diff, stage, unstage endpoints ---

@app.get("/api/git/diff")
async def get_git_diff(path: str = "", workspace: str = ""):
    """Return git diff for a specific file in the open workspace's repo.

    `path` is the file as reported by /api/git/status (repo-relative) or an
    absolute path.  `workspace` is the open workspace root used to locate the
    repo — otherwise the file is resolved against the home directory.
    """
    try:
        base = _safe_path(workspace) if (workspace or "").strip() else None
        cand = Path(path)
        if not cand.is_absolute():
            cand = (base or Path.home()) / path
        git_root = _find_git_root(cand)
        if not git_root:
            return {"diff": None, "error": "Not a git repo"}
        rel = _to_repo_relative(git_root, str(cand))
        rc, stdout, stderr = _run_git(git_root, ["diff", "HEAD", "--", rel])
        if rc == 0:
            return {"diff": stdout if stdout.strip() else None}
        return {"diff": None, "error": stderr.strip() or "No changes"}
    except HTTPException:
        raise
    except Exception as e:
        return {"diff": None, "error": str(e)}


@app.post("/api/git/stage")
async def stage_files(payload: dict = Body(default={})):
    """Stage files for commit in the OPEN WORKSPACE repo (not $HOME).

    Body: {paths: "a,b" | "", workspace: "/abs/ws"}.  Empty `paths` = stage all.
    """
    try:
        workspace = str(payload.get("workspace") or "")
        paths = str(payload.get("paths") or "")
        git_root = _repo_root(workspace)
        if not git_root:
            raise HTTPException(400, "Not a git repo — open a folder that contains .git")
        if not paths:
            # Stage all
            rc, _, stderr = _run_git(git_root, ["add", "."])
            if rc != 0:
                raise HTTPException(500, stderr.strip() or "git add failed")
        else:
            files = [_to_repo_relative(git_root, p.strip()) for p in paths.split(",") if p.strip()]
            rc, _, stderr = _run_git(git_root, ["add", "--"] + files)
            if rc != 0:
                raise HTTPException(500, stderr.strip() or "git add failed")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/git/unstage")
async def unstage_files(payload: dict = Body(default={})):
    """Unstage files (reset index) in the OPEN WORKSPACE repo.

    Body: {paths: "a,b" | "", workspace: "/abs/ws"}.  Empty `paths` = unstage all.
    """
    try:
        workspace = str(payload.get("workspace") or "")
        paths = str(payload.get("paths") or "")
        git_root = _repo_root(workspace)
        if not git_root:
            raise HTTPException(400, "Not a git repo — open a folder that contains .git")
        if not paths:
            rc, _, stderr = _run_git(git_root, ["reset"])
            if rc != 0:
                raise HTTPException(500, stderr.strip() or "git reset failed")
        else:
            files = [_to_repo_relative(git_root, p.strip()) for p in paths.split(",") if p.strip()]
            rc, _, stderr = _run_git(git_root, ["reset", "--"] + files)
            if rc != 0:
                raise HTTPException(500, stderr.strip() or "git reset failed")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# --- Project-wide search endpoint ---

@app.get("/api/search")
async def search_files(query: str = "", path: str = "", max_results: int = 100, names_only: bool = False):
    """Search file contents across workspace. Max depth 5, max 500 files scanned.

    names_only=True skips the content scan entirely and returns only FILENAME
    matches — the "search files by name" mode used by the sidebar."""
    try:
        search_root = _safe_path(path) if path else Path.home()
        if not search_root.exists():
            return {"results": []}
        
        query_lower = query.lower()
        results = []
        # Directories the walker must NEVER descend into (pruned before traversal).
        excluded = {
            "node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build",
            ".next", ".nuxt", "target", ".freebuff", "graphify-out",
            # Hygiene under a home root: caches / archives / system dirs.
            ".Trash", ".cache", "Caches", ".idea", ".vscode", "Pods",
            # Tool registries / package caches — never source code, huge in ~.
            ".npm", ".nvm", ".bun", ".cargo", ".rustup", ".gradle", ".m2",
            ".local", ".hermes", ".lmstudio", ".pnpm", "pnpm", ".yarn",
            ".conda", ".oh-my-zsh",
            # macOS app-data dirs (inside ~/Library) — never project source.
            "Application Support", "Containers",
        }
        # File suffixes that are binary / archive — skip without reading (cheap).
        binary_suffixes = {
            ".pyc", ".o", ".so", ".dll", ".exe", ".bin", ".map", ".min.js",
            ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
            ".jar", ".war", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns",
            ".pdf", ".woff", ".woff2", ".ttf",
        }
        scanned = 0
        # Scoped to a real workspace: scan generously (many projects nest deeper
        # than 5 levels / exceed 500 files, which made search silently return
        # nothing).  Un-scoped (whole-home) searches stay shallow + small so
        # they cannot walk the entire home tree.
        is_scoped = bool((path or "").strip())
        max_files = 5000 if is_scoped else 500
        max_depth = 12 if is_scoped else 5

        # os.walk with topdown=True lets us MUTATE dirnames in-place so the
        # walker never descends into excluded dirs — far cheaper than rglob
        # walking the whole tree and checking each file after the fact.
        for root, dirnames, filenames in os.walk(search_root, topdown=True):
            if scanned >= max_files:
                break
            # Relative depth of this directory from search_root.
            rel_root = os.path.relpath(root, search_root)
            depth = 0 if rel_root == os.curdir else len(rel_root.split(os.sep))
            
            # PRUNE excluded dirs + anything beyond max_depth so os.walk will
            # not recurse into them.
            pruned = []
            for d in dirnames:
                if d in excluded:
                    continue
                # Generic venv catch: hidden dot-dirs ending in
                # "venv"/"env" (.pyenv, .litellm-venv, .mlx-env, ...).
                if d.startswith(".") and (d.endswith("venv") or d.endswith("env")):
                    continue
                if depth + 1 > max_depth:
                    continue
                pruned.append(d)
            dirnames[:] = pruned
            
            for fname in filenames:
                if scanned >= max_files or len(results) >= max_results:
                    break
                # Files are one level deeper than their dir — keep the same
                # per-file depth cutoff the old rglob version used.
                if depth + 1 > max_depth:
                    continue
                suffix = os.path.splitext(fname)[1].lower()
                # macOS metadata file — never useful to search.
                if fname == ".DS_Store":
                    continue
                rel = os.path.join(rel_root, fname) if rel_root != os.curdir else fname
                fpath = os.path.join(root, fname)

                # NAME match — cheap, no file read, and deliberately checked
                # BEFORE the binary-suffix/sniff skips so users can find
                # binary/archive files (photo.png, bundle.zip) by name too.
                if query_lower in fname.lower():
                    results.append({
                        "file": str(fpath),
                        "line": 0,
                        "content": "",
                        "match": "",
                        "kind": "name",
                    })
                    if len(results) >= max_results:
                        break
                    continue

                # names_only mode: filename matches only — no content scan.
                if names_only:
                    continue

                # Skip binary / archive files by extension (cheap, no read).
                # Note splitext only splits the LAST dot, so .min.js is
                # handled by an explicit endswith below.
                if suffix in binary_suffixes or fname.endswith(".min.js"):
                    continue

                # Cheap binary sniff: a NUL byte in the first 2048 bytes means
                # it is almost certainly not a text file — skip it.
                try:
                    with open(fpath, "rb") as fh:
                        head = fh.read(2048)
                    if b"\x00" in head:
                        continue
                except OSError:
                    continue
                
                scanned += 1
                try:
                    content = head.decode("utf-8", errors="ignore")
                    if len(head) == 2048:
                        with open(fpath, "r", errors="ignore") as fh:
                            content = fh.read()
                    lines = content.split("\n")
                    for i, line in enumerate(lines, 1):
                        if query_lower in line.lower():
                            idx = line.lower().index(query_lower)
                            results.append({
                                "file": str(fpath),
                                "line": i,
                                "content": line.strip()[:200],
                                "match": line[max(0,idx-20):idx+len(query)+20].strip(),
                                "kind": "content",
                            })
                            if len(results) >= max_results:
                                break
                except (OSError, UnicodeDecodeError):
                    continue
        
        return {"results": results[:max_results], "scanned": scanned, "root": str(search_root)}
    except Exception as e:
        return {"results": [], "error": str(e)}


@app.post("/api/git/commit")
async def commit_changes(payload: dict = Body(default={})):
    """Create a git commit in the OPEN WORKSPACE repo with the given message.

    Body: {message: "...", workspace: "/abs/ws"}.  Committing $HOME's repo
    (the old behaviour) silently committed the wrong project whenever the open
    workspace differed from the home directory.
    """
    try:
        message = str(payload.get("message") or "").strip()
        workspace = str(payload.get("workspace") or "")
        if not message:
            raise HTTPException(400, "Commit message required")
        git_root = _repo_root(workspace)
        if not git_root:
            raise HTTPException(400, "Not a git repo — open a folder that contains .git")
        rc, _, stderr = _run_git(git_root, ["commit", "-m", message])
        if rc != 0:
            raise HTTPException(500, stderr.strip() or "Commit failed")
        return {"ok": True, "message": "Committed successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


# --- Project upload (workspace wizard) ---

import zipfile as _zipfile

@app.post("/api/project/upload")
async def upload_project(file: UploadFile = File(...)):
    """Accept a .zip project archive, extract it under ~/tto-projects/<uuid>/,
    and return the path to the extracted project root."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Only .zip archives are supported")
    base = Path.home() / "tto-projects"
    base.mkdir(parents=True, exist_ok=True)
    dest = base / uuid.uuid4().hex[:12]
    dest.mkdir(parents=True, exist_ok=True)
    zip_path = dest / file.filename
    try:
        content = await file.read()
        if len(content) > 500 * 1024 * 1024:  # 500 MB safety cap
            raise HTTPException(413, "Archive too large (max 500 MB)")
        zip_path.write_bytes(content)
        dest_resolved = dest.resolve()
        with _zipfile.ZipFile(zip_path) as zf:
            # Zip-slip guard: never write outside the destination root. Uses
            # path-component containment (relative_to), not a string prefix, so
            # a sibling dir like "<dest>-x" can't slip through a startswith().
            for member in zf.infolist():
                target = (dest / member.filename).resolve()
                if target != dest_resolved:
                    try:
                        target.relative_to(dest_resolved)
                    except ValueError:
                        raise HTTPException(400, f"Unsafe archive entry: {member.filename}")
            zf.extractall(dest)
        zip_path.unlink(missing_ok=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to extract archive: {e}")
    # If the archive had a single top-level folder, return THAT as the project
    # root so terminals open in the actual project directory.
    project_root = dest
    entries = [c for c in dest.iterdir() if c.name != "__MACOSX"]
    if len(entries) == 1 and entries[0].is_dir():
        project_root = entries[0]
    return {"ok": True, "path": str(project_root), "name": file.filename}

class PaneCreate(BaseModel):
    cwd: Optional[str] = None

@app.post("/api/term-panes")
async def create_term_pane(payload: PaneCreate | None = None):
    """Create a real tmux session for an in-browser xterm.js pane (no external window).
    If cwd is provided, the session starts in that directory."""
    pane_id = uuid.uuid4().hex[:8]
    cwd = payload.cwd if payload and payload.cwd else None
    # Validate cwd exists and is a directory
    if cwd and not os.path.isdir(cwd):
        cwd = None  # fallback to home
    session_name = ensure_embed_session(pane_id, cwd)
    return {"ok": True, "pane_id": pane_id, "session_name": session_name, "window_id": None, "cwd": cwd or str(Path.home())}

def _close_window(wid: str):
    """Close a Terminal.app window by its id."""
    if not wid:
        return
    try:
        subprocess.run(["osascript", "-e",
                        f'tell application "Terminal" to close window id {_as_script_str(wid)}'],
                       capture_output=True, text=True, timeout=5)
    except Exception:
        pass

@app.delete("/api/term-panes/{pane_id}")
async def delete_term_pane(pane_id: str):
    # Kill the PTY session if active
    if pane_id in pty_sessions:
        pty_sessions[pane_id].close()
        del pty_sessions[pane_id]
    if pane_id.startswith("att-"):
        # Attach panes mirror an existing real terminal — never kill the session,
        # just detach the browser PTY.
        return {"ok": True}
    # Close the real Terminal.app window we opened for this pane
    wid = pane_windows.pop(pane_id, None)
    _close_window(wid)
    # Kill the tmux session
    session = embed_session_for(pane_id)
    subprocess.run(["tmux", "kill-session", "-t", session], capture_output=True, timeout=2)
    # Remove from terminals dict if it was registered
    for tty in list(terminals.keys()):
        if terminals[tty].info.session_name == session:
            del terminals[tty]
            terminal_windows.pop(tty, None)
            pending_cli.pop(tty, None)
            tmux_pane_targets.pop(tty, None)
    save_state()
    return {"ok": True}

class PaneAttach(BaseModel):
    tty: str
    session_name: Optional[str] = None

@app.post("/api/term-panes/attach")
async def attach_term_pane(payload: PaneAttach):
    """Attach to an existing real terminal's tmux session for live control."""
    tty = payload.tty
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")
    # Find the tmux session for this tty
    pane = tmux_pane_targets.get(tty)
    if not pane:
        # Try to find via tmux_info
        for pty_key, info in tmux_info.items():
            if pty_key == tty:
                pane = info.get("pane_target")
                break
    if not pane:
        raise HTTPException(400, f"Terminal {tty} is not in tmux. Use 'Open new terminal' to create a real terminal instead.")
    # Extract session name from pane target (e.g. "session:0.0" -> "session")
    session_name = pane.split(":")[0] if ":" in pane else pane
    # Use the tty as the pane_id for attach
    pane_id = f"att-{tty}"
    return {"ok": True, "pane_id": pane_id, "session_name": session_name}

@app.websocket("/ws/term/{pane_id}")
async def term_websocket(websocket: WebSocket, pane_id: str):
    """Real PTY-based terminal: stream raw bytes between browser and tmux attach."""
    if not await _ws_origin_ok(websocket):
        return
    collab_user = await _ws_collab_auth(websocket)
    if collab_user is None and websocket.client and websocket.client.host not in ("127.0.0.1", "::1", "localhost"):
        # Auth failed, connection already closed by _ws_collab_auth
        return
    # Attach collab_user to websocket state for audit
    websocket.state.collab_user = collab_user
    await websocket.accept()
    # Determine session name
    if pane_id.startswith("att-"):
        # Attaching to an existing terminal
        tty = pane_id[4:]
        pane = tmux_pane_targets.get(tty)
        if not pane:
            await websocket.close(code=1008, reason="No tmux session")
            return
        session_name = pane.split(":")[0] if ":" in pane else pane
    elif pane_id in tmux_pane_targets:
        pane = tmux_pane_targets[pane_id]
        session_name = pane.split(":")[0] if ":" in pane else pane
    else:
        session_name = ensure_embed_session(pane_id)
    # Get initial size from first message
    cols, rows = 120, 30
    try:
        init_msg = await asyncio.wait_for(websocket.receive_json(), timeout=5)
        if init_msg.get("type") == "resize":
            cols = int(init_msg.get("cols", 120))
            rows = int(init_msg.get("rows", 30))
    except Exception:
        pass
    # Spawn real PTY
    master_fd, proc = await _spawn_pty(session_name, cols, rows)
    # Register PTY session
    pty_sessions[pane_id] = PtySession(pane_id, session_name)
    pty_sessions[pane_id].master_fd = master_fd
    pty_sessions[pane_id].proc = proc
    # Reader task: PTY master -> WebSocket (blocking read in executor thread)
    loop = asyncio.get_event_loop()
    async def pty_reader():
        while True:
            try:
                data = await loop.run_in_executor(None, os.read, master_fd, 65536)
                if not data:
                    break  # EOF — process exited
                await websocket.send_bytes(data)
            except BlockingIOError:
                continue  # no data yet, retry
            except (OSError, asyncio.CancelledError, WebSocketDisconnect):
                break
    read_task = asyncio.create_task(pty_reader())

    # TUI monitor: tmux always renders via the alternate screen buffer, so the
    # browser CANNOT detect TUIs from xterm state. Instead, poll the pane's
    # foreground command and push the truth over the WS as JSON control frames.
    # A pane sitting at a shell prompt is "normal"; anything else running
    # (opencode, claude, vim, htop, less…) is treated as a full-screen TUI so
    # the frontend can expand the pane and give it room to work.
    _SHELL_BASES = {"zsh", "bash", "sh", "fish", "dash", "ksh", "tcsh", "csh",
                    "ash", "login", "su", "sudo", "tmux", "env"}
    async def tui_monitor():
        last_active: Optional[bool] = None
        while True:
            try:
                res = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: subprocess.run(
                        ["tmux", "list-panes", "-t", session_name, "-F", "#{pane_current_command}"],
                        capture_output=True, text=True, timeout=2,
                    ),
                )
                cmd = (res.stdout or "").strip()
                base = cmd.split("/")[-1].lower() if cmd else ""
                active = bool(base) and base not in _SHELL_BASES
                if active != last_active:
                    last_active = active
                    try:
                        await websocket.send_json({"type": "tui", "active": active})
                    except Exception:
                        break
            except Exception:
                break
            await asyncio.sleep(1)
    monitor_task = asyncio.create_task(tui_monitor())
    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            text = msg.get("text")
            if not text:
                continue
            try:
                obj = json.loads(text)
            except Exception:
                continue
            t = obj.get("type")
            if t == "input":
                data = obj.get("data", "").encode("utf-8", "replace")
                if master_fd >= 0:
                    try:
                        os.write(master_fd, data)
                    except OSError:
                        break
            elif t == "resize":
                cols = int(obj.get("cols", 120))
                rows = int(obj.get("rows", 30))
                if pane_id in pty_sessions:
                    pty_sessions[pane_id].set_winsize(cols, rows)
    finally:
        read_task.cancel()
        monitor_task.cancel()
        # Clean up PTY
        if pane_id in pty_sessions:
            pty_sessions[pane_id].close()
            del pty_sessions[pane_id]

# --- WebSocket ---

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    if not await _ws_origin_ok(websocket):
        return
    collab_user = await _ws_collab_auth(websocket)
    if collab_user is None and websocket.client and websocket.client.host not in ("127.0.0.1", "::1", "localhost"):
        return
    websocket.state.collab_user = collab_user
    await manager.connect_dashboard(websocket)
    # Send initial state — use the cached terminals dict (refreshed every 3s
    # by scanner_loop).  Do NOT call scan_terminals() here: it runs blocking
    # subprocesses on the event loop and with many terminals can freeze it for
    # seconds, breaking both the WS connection and rename updates.
    await websocket.send_json({"type": "state", "timestamp": time.time(), "terminals": {
        tty: terminal_payload(tty, t)
        for tty, t in terminals.items() if t.info.is_live
    }, "token_usage": aggregate_token_usage()})
    try:
        while True:
            data = await websocket.receive_json()
            # Handle messages from dashboard if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.websocket("/ws/command-relay")
async def command_relay_websocket(websocket: WebSocket):
    """Desktop app connects here to receive command-injection requests.

    The sidecar can't inject into native Rust PTY sessions (only the Rust
    process holds the master fd).  When a task lands for a Rust-managed
    terminal and no agent WebSocket/tmux path exists, the sidecar forwards
    the command here and the desktop app types it via `terminal_send_command`.
    """
    if not await _ws_origin_ok(websocket):
        return
    await manager.connect_command_relay(websocket)
    try:
        while True:
            await websocket.receive_json()  # keep-alive; sidecar pushes one-way
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.websocket("/ws/terminal/{tty}")
async def terminal_websocket(websocket: WebSocket, tty: str):
    if not await _ws_origin_ok(websocket):
        return
    collab_user = await _ws_collab_auth(websocket)
    if collab_user is None and websocket.client and websocket.client.host not in ("127.0.0.1", "::1", "localhost"):
        return
    websocket.state.collab_user = collab_user
    await manager.connect_terminal(websocket, tty=tty)
    # Register or update terminal
    if tty not in terminals:
        terminals[tty] = TerminalState(info=TerminalInfo(tty=tty))
    terminals[tty].info.last_seen = time.time()
    # Send pending task if any
    t = terminals[tty]
    if t.current_task and t.current_task.status == "pending":
        await websocket.send_json({"type": "run_task", "task": t.current_task.model_dump()})
        t.current_task.status = "running"
        t.current_task.started_at = time.time()
    try:
        while True:
            data = await websocket.receive_json()
            # Handle task completion, status updates from terminal agent
            if data.get("type") == "task_complete":
                task_id = data.get("task_id")
                summary = data.get("summary", "")
                await complete_task(tty, task_id, summary)
    except WebSocketDisconnect:
        manager.disconnect(websocket, tty=tty)

@app.post("/api/shutdown")
async def api_shutdown():
    """Graceful shutdown — called by the Rust app on exit."""
    import signal, os
    async def _die():
        await asyncio.sleep(0.5)
        if IS_WINDOWS:
            # Windows has no SIGTERM; ask OS to terminate our own process.
            os._exit(0)
        else:
            os.kill(os.getpid(), signal.SIGTERM)
    asyncio.create_task(_die())
    return {"ok": True, "message": "Shutting down"}


# --- Remote control (WhatsApp via OpenWA) — optional subsystem -----------
# Clean, independent: reuses ONLY the existing pipelines through a bridge and
# never touches the Rust engine directly.  When disabled (or OpenWA offline)
# TTO behaves exactly as before — the import below is guarded so a missing
# remote package can never break the sidecar.
_remote = None
_remote_cfg = None

def _remote_rust_ttys() -> set:
    return {link.get("tty") for link in session_links.values() if link.get("tty")}

async def _remote_relay_send(kind: str, **payload) -> bool:
    """Send a control message to the desktop app over /ws/command-relay.
    The Rust relay handles: inject_command, raw_input, terminal_restart,
    terminal_close (all keyed by tty)."""
    relay = manager.command_relay
    if relay is None:
        return False
    try:
        await relay.send_json({"type": kind, **payload})
        return True
    except Exception:
        return False

def _remote_terminal_entries() -> list:
    """Stable, indexed view of live terminals for the remote layer."""
    rust_ttys = _remote_rust_ttys()
    rows = []
    for tty, t in terminals.items():
        if not t.info.is_live:
            continue
        p = terminal_payload(tty, t)
        status = "idle"
        if t.current_task:
            status = t.current_task.status if t.current_task.status in ("running", "blocked") else "waiting"
        sid = next((sid for sid, lk in session_links.items() if lk.get("tty") == tty), "")
        rows.append({
            "index": 0,  # filled below
            "tty": tty,
            "session_id": sid,
            # App-style label (e.g. "terminal-7") so remote numbers match what
            # the user sees in the Task Center; falls back to the tty.
            "label": sid or tty,
            "status": status,
            "paused": t.paused,
            "rust_managed": tty in rust_ttys,
            **{k: p.get(k) for k in ("agent", "cwd", "model", "opencode_running", "opencode_model", "current_task", "next_task", "queue", "history", "live_output")},
        })
    rows.sort(key=lambda r: r["tty"])
    for i, r in enumerate(rows, start=1):
        r["index"] = i
    return rows


def _remote_resolve(arg: str) -> Optional[dict]:
    """Resolve a remote terminal argument.  Precedence:
      1. App-style session label / tty / combined label (terminal-7 · ttys012)
      2. Bare number → the session named `terminal-<N>` FIRST (that is what
         the user sees in the Task Center), then the /terminals index.
      3. Raw tty id."""
    if not arg:
        return None
    entries = _remote_terminal_entries()
    arg = arg.strip()
    # 1. Explicit label matches.
    for e in entries:
        sid = e.get("session_id") or ""
        if sid and arg in (sid, e["label"], f"{sid} · {e['tty']}"):
            return e
    # 2. Bare number — the app numbers terminals by session name
    #    (terminal-1..N), so prefer that mapping over the sorted index.
    if arg.isdigit():
        hit = next((e for e in entries if e.get("session_id") == f"terminal-{arg}"), None)
        if hit:
            return hit
        return next((e for e in entries if e["index"] == int(arg)), None)
    # 3. Raw tty.
    return next((e for e in entries if e["tty"] == arg), None)

async def _remote_send_input(tty: str, text: str) -> bool:
    if tty in _remote_rust_ttys() and await _remote_relay_send("inject_command", tty=tty, command=text, task_id=""):
        return True
    # send_to_terminal_shell does blocking subprocess (tmux / osascript /
    # AppleScript) — must NOT run on the event loop or it freezes other
    # async tasks (delayed remote replies).
    return bool(await send_to_terminal_shell(tty, text))

async def _remote_raw_input(tty: str, data: str) -> bool:
    if tty in _remote_rust_ttys():
        return await _remote_relay_send("raw_input", tty=tty, data=data)
    return False

async def _remote_stop_terminal(tty: str) -> bool:
    """Interrupt (Ctrl+C) the terminal's foreground process."""
    if tty in _remote_rust_ttys():
        return await _remote_raw_input(tty, "\x03")
    pane = tmux_pane_targets.get(tty) or find_tmux_pane(tty)
    if pane:
        try:
            subprocess.run(["tmux", "send-keys", "-t", pane, "C-c"], capture_output=True, timeout=2)
            return True
        except Exception:
            pass
    return False

async def _remote_restart_terminal(tty: str) -> bool:
    if tty in _remote_rust_ttys():
        return await _remote_relay_send("terminal_restart", tty=tty)
    pane = tmux_pane_targets.get(tty) or find_tmux_pane(tty)
    if pane:
        try:
            subprocess.run(["tmux", "respawn-pane", "-t", pane], capture_output=True, timeout=2)
            return True
        except Exception:
            pass
    return False

async def _remote_close_terminal(tty: str) -> bool:
    if tty in _remote_rust_ttys():
        return await _remote_relay_send("terminal_close", tty=tty)
    pane = tmux_pane_targets.get(tty) or find_tmux_pane(tty)
    if pane:
        try:
            subprocess.run(["tmux", "kill-pane", "-t", pane], capture_output=True, timeout=2)
            return True
        except Exception:
            pass
    return False

async def _remote_pause_terminal(tty: str) -> bool:
    t = terminals.get(tty)
    if not t:
        return False
    t.paused = True
    save_state()
    await broadcast_state()
    return True

async def _remote_resume_terminal(tty: str) -> bool:
    t = terminals.get(tty)
    if not t:
        return False
    t.paused = False
    # Promote + deliver the next queued task now that we're unpaused.
    if t.current_task is None and (t.next_task or t.queue):
        nxt = t.next_task or t.queue.pop(0)
        t.next_task = None
        nxt.status = "running"
        nxt.started_at = time.time()
        t.current_task = nxt
        sent = await manager.send_to_terminal(tty, {"type": "run_task", "task": nxt.model_dump()})
        plan = build_delivery_plan(tty, nxt)
        if plan:
            asyncio.create_task(_execute_delivery(tty, nxt, plan, sent))
    save_state()
    await broadcast_state()
    return True

async def _remote_add_task(tty: str, desc: str, model: str) -> Optional[dict]:
    if tty not in terminals or not desc:
        return None
    try:
        from remote import sleep as _sleep_mod
        _sleep_mod.note_task_activity()
    except Exception:
        pass
    task = Task(description=desc, model=model or "")
    await _place_task(tty, task)
    return task.model_dump()

async def _remote_orchestrate(task: str, entries: list, model: str = "") -> str:
    """Orchestrate a task across available terminals from remote."""
    SEP = "────────────────"
    try:
        from remote import sleep as _sleep_mod
        _sleep_mod.note_task_activity()
    except Exception:
        pass
    terminals_list = [e for e in entries if e.get("tty")]
    n = len(terminals_list)
    if n == 0:
        return "❌ No terminals available for orchestration."
    labels = [e.get("label") or e.get("tty", "") for e in terminals_list]
    model_info = f" (splitter: {model})" if model else ""
    try:
        descriptions = await asyncio.to_thread(
            split_task_for_orchestration, task, n, model, labels
        )
    except Exception as exc:
        return f"❌ Split failed: {exc}"
    lines = [f"⚡ ORCHESTRATOR — {n} terminals\n{SEP}\n"]
    for i, (entry, desc) in enumerate(zip(terminals_list, descriptions)):
        tty = entry["tty"]
        label = entry.get("label") or tty
        if tty in terminals:
            t = Task(description=desc, model=entry.get("model", ""))
            await _place_task(tty, t)
            lines.append(f"#{entry.get('index', i+1)} {label}")
            lines.append(f"  → {desc[:100]}")
            lines.append("")
    lines.append(SEP)
    lines.append("✅ Tasks dispatched — I'll text the completed result when each finishes.")
    return "\n".join(lines)


# ── Agent Workspace helpers (Discord ↔ same opencode sessions as the web) ─
# The opencode server at :4097 holds the single source of truth for agent
# sessions.  The web UI and Discord read/write the SAME server, so creating
# a session from Discord is immediately visible in the browser and vice-versa.
# Completion signal: the newest message's info.finish == "stop".

_agent_notified: Dict[str, float] = {}  # session_id -> notified ts (dedup)

# ── Session short IDs ────────────────────────────────────────────────────
# Opencode session IDs are long UUIDs (ses_f6159e196ffeaPeocvKHYYaiWx) —
# short sequential numbers (1, 2, 3…) make them usable on mobile/Discord.
# Persisted to JSON so numbers survive restarts.
_SESSIONS: Dict[int, str] = {}   # short -> real opencode session id
_REAL_TO_SHORT: Dict[str, int] = {}  # real id -> short (dedup)
_SESSION_NEXT_ID = 1
_SESSION_FILE = STATE_DIR / "agent_sessions.json"

# ── Per-chat workspace state (Discord) ────────────────────────────────────
# Per-chat workspace state (Discord).  Keyed by chat_id
# (Discord user id string), value is the workspace name.
_AGENT_WS_BY_CHAT: Dict[str, str] = {}

# Global current workspace (fallback when no per-chat dock exists).
_AGENT_CURRENT_WS: Optional[str] = None


def _get_current_ws() -> Optional[str]:
    """Return the globally current workspace name (global fallback)."""
    return _AGENT_CURRENT_WS


def _set_current_ws(ws_name: str) -> None:
    """Set the globally current workspace name."""
    global _AGENT_CURRENT_WS
    _AGENT_CURRENT_WS = ws_name.strip() if ws_name else None
    _session_persist()


def _resolve_default_workspace() -> Optional[dict]:
    """Return the default workspace dict for voice/session creation.

    Priority: global current > most-recently-created > first available.
    """
    # 1. Global current workspace
    if _AGENT_CURRENT_WS:
        ref = _resolve_agent_workspace(_AGENT_CURRENT_WS)
        if ref:
            return ref
    # 2. Most recent from agent_workspaces (disk + stored merge)
    wss = _agent_workspaces()
    if wss:
        return wss[-1]
    # 3. Fallback to stored_workspaces directly
    if stored_workspaces:
        return stored_workspaces[-1]
    return None


def _session_persist() -> None:
    try:
        _SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SESSION_FILE.write_text(
            json.dumps({
                "next": _SESSION_NEXT_ID,
                "sessions": _SESSIONS,
                "discord_context": _AGENT_WS_BY_CHAT,
            }, indent=2)
        )
    except Exception:
        pass


def _session_load() -> None:
    """Load the short-id registry from disk (best-effort)."""
    global _SESSION_NEXT_ID, _SESSIONS, _REAL_TO_SHORT, _AGENT_WS_BY_CHAT
    try:
        if not _SESSION_FILE.exists():
            return
        data = json.loads(_SESSION_FILE.read_text())
        _SESSION_NEXT_ID = int(data.get("next", 1))
        _SESSIONS = {int(k): v for k, v in (data.get("sessions") or {}).items()}
        _REAL_TO_SHORT = {v: k for k, v in _SESSIONS.items()}
        # Load per-chat Discord workspace context
        _AGENT_WS_BY_CHAT = {str(k): str(v) for k, v in (data.get("discord_context") or {}).items()}
    except Exception:
        _SESSIONS = {}
        _REAL_TO_SHORT = {}
        _SESSION_NEXT_ID = 1

def _get_chat_ws(chat_id: str) -> Optional[str]:
    """Get the docked workspace name for a Discord chat.  Returns None if undocked."""
    ws = _AGENT_WS_BY_CHAT.get(str(chat_id))
    return ws if ws else None


def _set_chat_ws(chat_id: str, ws_name: str) -> None:
    """Set the docked workspace for a Discord chat.  Empty string = undock."""
    chat_id = str(chat_id)
    if ws_name and ws_name.strip():
        _AGENT_WS_BY_CHAT[chat_id] = ws_name.strip()
    else:
        _AGENT_WS_BY_CHAT.pop(chat_id, None)
    _session_persist()

def ws_scoped_resolve_to(sid_ref, ws: dict) -> Optional[dict]:
    """Resolve a session number against a specific workspace.

    Matches sessions whose cwd starts with the workspace's projectPath.
    sid_ref is a short session number (int or str).  Returns
    {"real": ..., "short": ...} or None.
    """
    if isinstance(sid_ref, str):
        sid_ref = sid_ref.strip().lstrip("#")
        if not sid_ref.isdigit():
            return None
        sid_ref = int(sid_ref)
    pp = (ws.get("projectPath") or "").rstrip("/")
    if not pp:
        return None
    real = _SESSIONS.get(int(sid_ref))
    if not real:
        return None
    # Check if this session's cwd matches the workspace
    # We need to check against live session data — use a best-effort cwd check
    # against the workspace path.  Since we don't store cwd in _SESSIONS,
    # we fall back to the opencode server to check.
    # For now, return the match if the short id exists (scoped checking is done
    # at the resolve_session level which has access to live session data).
    return {"real": real, "short": int(sid_ref)}


def _resolve_agent_workspace_by_id(ws_id) -> Optional[dict]:
    """Resolve a workspace by its id (int or str)."""
    ws_id_str = str(ws_id)
    for w in _agent_workspaces():
        if str(w.get("id")) == ws_id_str:
            return w
    return None




def _session_assign(real_id: str) -> Optional[int]:
    """Allocate a short number for a real opencode session id (dedup)."""
    global _SESSION_NEXT_ID
    if not real_id:
        return None
    existing = _REAL_TO_SHORT.get(real_id)
    if existing is not None:
        return existing
    short = _SESSION_NEXT_ID
    _SESSION_NEXT_ID += 1
    _SESSIONS[short] = real_id
    _REAL_TO_SHORT[real_id] = short
    _session_persist()
    return short


def _session_resolve(ref: str) -> Optional[dict]:
    """Resolve a user-supplied session reference to a session entry.

    Accepts: '1', '#1', '1.', '1)' or a full opencode id 'ses_…'.
    Returns {'short': int, 'real': str} or None when unresolvable.
    """
    ref = (ref or "").strip().lower()
    if not ref:
        return None
    candidate = ref.lstrip("#.). ")
    if candidate.isdigit():
        short = int(candidate)
        real = _SESSIONS.get(short)
        if real:
            return {"short": short, "real": real}
        return None  # number not in registry → tell user to /sessions
    # Full opencode ID (pastable from the web) — reverse lookup
    for short, real in _SESSIONS.items():
        if real.lower() == candidate:
            return {"short": short, "real": real}
    return None


class SessionNotInWorkspace(Exception):
    """Raised when a session number is not found in the docked workspace."""
    def __init__(self, n: int, ws: Optional[str]):
        self.n = n
        self.ws = ws
        super().__init__(f"Session #{n} not in workspace '{ws}'")


def resolve_session(chat_id: str, n: str) -> dict:
    """Resolve session number with per-chat workspace scoping.

    Rules:
    - Normalize: strip '#', must be all digits, else error.
    - If docked and session not found in workspace → error, no global fallback.
    - If undocked and exactly one global session matches → use it.
    - If undocked and multiple match → error, ask user to /use a workspace.
    Logs every resolution: chat_id, docked ws, requested n, resolved real id.
    """
    chat_id = str(chat_id)
    n_raw = (n or "").strip()
    # Normalize: strip '#', must be all digits
    n_clean = n_raw.lstrip("#")
    if not n_clean.isdigit():
        raise ValueError(f"Session must be a number, got: {n_raw!r}")
    n_int = int(n_clean)

    ws_name = _AGENT_WS_BY_CHAT.get(chat_id)

    if ws_name:
        # Docked: scope to workspace only — NO global fallback.
        # Check the session registry directly (workspace cwd scoping is
        # best-effort since we can't verify cwd without live opencode data).
        real = _SESSIONS.get(n_int)
        if real:
            print(f"[resolve] chat={chat_id} ws={ws_name} n={n_int} -> {real[:20]}", flush=True)
            return {"short": n_int, "real": real}
        raise SessionNotInWorkspace(n_int, ws_name)

    # Undocked: global resolve
    result = _session_resolve(n_clean)
    if result:
        print(f"[resolve] chat={chat_id} ws=global n={n_int} -> {result['real'][:20]}", flush=True)
        return result

    # Undocked and not found at all
    raise SessionNotInWorkspace(n_int, None)


def _session_meta(real_id: str) -> Optional[str]:
    """Short label like '#3' for a real id, or None if untracked."""
    short = _REAL_TO_SHORT.get(real_id)
    return f"#{short}" if short is not None else None


def _agent_workspaces() -> list:
    """Workspaces the Discord /workspaces command lists — mirrors the web drop-down.

    Reads ~/tto-workspaces/* directories as the ground truth (same as
    /api/workspaces) so a workspace created by voice OR web UI ALWAYS
    appears, no matter which process or how fresh.  Merges with
    stored_workspaces to preserve any metadata (id, color, etc.).
    """
    home_ws = os.path.expanduser("~/tto-workspaces")
    seen = set()
    out = []

    # 1. Scan disk directories (ground truth — what's actually on disk)
    try:
        if os.path.isdir(home_ws):
            for name in sorted(os.listdir(home_ws)):
                p = os.path.join(home_ws, name)
                if os.path.isdir(p) and not name.startswith("."):
                    seen.add(name.lower())
                    # Check stored_workspaces for metadata
                    meta = None
                    for w in stored_workspaces:
                        if (w.get("name") or "").lower() == name.lower():
                            meta = w
                            break
                    out.append({
                        "id": (meta or {}).get("id", f"ws-{name}"),
                        "name": name,
                        "projectPath": p,
                    })
    except Exception:
        pass

    # 2. Add any stored_workspaces whose directories still exist but weren't
    #    caught by the disk scan (e.g. custom paths outside ~/tto-workspaces)
    for w in stored_workspaces:
        p = (w.get("projectPath") or "").strip()
        if not p or not os.path.isdir(p):
            continue
        name = (w.get("name") or os.path.basename(p) or p)
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append({
            "id": w.get("id", ""),
            "name": name,
            "projectPath": p,
        })

    return out


def _resolve_agent_workspace(ref: str) -> Optional[dict]:
    """Match /ws-style ref: name (case-insensitive), id, or path fragment."""
    ref = (ref or "").strip().lower()
    for w in _agent_workspaces():
        if w["id"].lower() == ref:
            return w
        if (w.get("name") or "").lower() == ref:
            return w
        if ref and ref in (w.get("projectPath") or "").lower():
            return w
    # Exact-name fallback across ALL stored workspaces (even missing dirs —
    # directory may be created by opencode when it opens a session).
    for w in stored_workspaces:
        if (w.get("name") or "").strip().lower() == ref:
            p = (w.get("projectPath") or "").strip()
            return {"id": w.get("id", ""), "name": w.get("name", ref), "projectPath": p}
    return None


def _create_workspace(name: str) -> dict:
    """Create a new workspace directory + register in stored_workspaces."""
    ws_dir = Path.home() / "tto-workspaces" / name
    ws_dir.mkdir(parents=True, exist_ok=True)
    wid = f"ws-{name}"
    # Register in stored_workspaces if not already there
    existing = [w for w in stored_workspaces if (w.get("name") or "").lower() == name.lower()]
    if not existing:
        ws_entry = {"id": wid, "name": name, "projectPath": str(ws_dir)}
        stored_workspaces.append(ws_entry)
        save_state()
    return {"ok": True, "id": wid, "name": name, "projectPath": str(ws_dir)}


async def _create_agent_session(ws_ref: str, agent: str) -> dict:
    """POST /session on the opencode server with {agent, directory}."""
    ws = _resolve_agent_workspace(ws_ref)
    directory = (ws or {}).get("projectPath") or (ws_ref if os.path.isdir(ws_ref) else None)
    if not directory:
        return {"ok": False, "error": f"Workspace not found: {ws_ref}"}
    agent = (agent or "build").strip().lower()
    headers = _opencode_auth()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{_OPENCODE_URL}/session",
            headers=headers,
            json={"agent": agent, "directory": directory},
        )
        if resp.status_code >= 400:
            return {"ok": False, "error": f"opencode {resp.status_code}: {resp.text[:200]}"}
        data = resp.json()
    real_id = data.get("id", "")
    short = _session_assign(real_id)
    # Label the opencode session with the SAME short number used in Discord
    # (/new → #N, /go #N …) so it is instantly identifiable in the Agent
    # Workspace sidebar while working (e.g. "#1 · build · DPO").
    ws_name = (ws or {}).get("name") or ws_ref
    if real_id and short is not None:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                await client.patch(
                    f"{_OPENCODE_URL}/session/{real_id}",
                    headers=headers,
                    json={"title": f"#{short} · {agent} · {ws_name}"},
                )
        except Exception:
            pass  # cosmetic — session still works if the rename fails
    return {
        "ok": True,
        "session": data,
        "id": real_id,
        "short_id": short,
        "agent": agent,
        "directory": directory,
        "ws": ws_name,
    }


async def _v_create_agent_session(sess_label: str) -> dict:
    """VOICE LANE adapter (1 arg): "create session called X" → default workspace + build agent.

    The phone only supplies a label ("jarvis", "dogs setup", ...). This resolves the
    current default workspace exactly like `_v_create_workspace` does for names, then
    slots the new opencode session into it with the default build lane. Mirrors the
    proven `create_workspace` voice pattern so sessions show in the web UI on creation.
    """
    # 1. Resolve the default workspace the phone lane owns (same resolution dogs uses).
    ws_ref = None
    try:
        from remote import voice_msg as _vm
        ws_getter = _vm._b("resolve_default_workspace")
        if ws_getter:
            cand = ws_getter()
            if cand:
                ws_ref = cand.get("id") or cand.get("name") or cand.get("projectPath")
    except Exception:
        pass
    if not ws_ref:
        # Fall back: most recently created workspace (dogs when just made) —
        # resolved via the SAME proven `_b("resolve_default_workspace")` bridge
        # the create_workspace lane uses, NEVER a bare internal name (permanent).
        ws_ref = None
        try:
            default_getter = _b("resolve_default_workspace")
            if default_getter:
                d = default_getter()
                if d:
                    ws_ref = d.get("id") or d.get("name") or d.get("projectPath")
        except Exception:
            pass
        if not ws_ref:
            ws_list = _agent_workspaces() if callable(_agent_workspaces) else []
            if ws_list:
                ws_ref = ws_list[-1].get("id") or ws_list[-1].get("name")
            elif stored_workspaces:
                ws_ref = stored_workspaces[-1].get("id") or stored_workspaces[-1].get("name")

    # 2. Default build lane + go.
    agent = "build"
    if not ws_ref:
        return {"ok": False, "error": "No workspace yet — say \"create workspace called X\" first."}
    return await _create_agent_session(ws_ref, agent)


async def _send_agent_task(sid: str, content: str) -> dict:
    """Send a message to an opencode session and trigger agent execution.

    no_reply must be False so the server actually runs the agent.
    Timeout is generous (10 min) to cover long tasks; the caller should
    use asyncio.create_task() to avoid blocking Discord responses.
    """
    headers = _opencode_auth()
    body = {
        "parts": [{"type": "text", "text": content}],
        "no_reply": False,
    }
    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post(
            f"{_OPENCODE_URL}/session/{sid}/message",
            headers=headers,
            json=body,
        )
        ok = resp.status_code < 400
        return {"ok": ok, "status": resp.status_code, "error": "" if ok else resp.text[:200]}


async def _agent_abort(sid: str) -> dict:
    """Abort a running opencode session."""
    headers = _opencode_auth()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{_OPENCODE_URL}/session/{sid}/abort",
                headers=headers,
            )
            return {"ok": resp.status_code < 400}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _agent_sessions() -> dict:
    """List opencode sessions (mirror of the web sidebar)."""
    headers = _opencode_auth()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{_OPENCODE_URL}/session", headers=headers)
        if resp.status_code >= 400:
            return {"ok": False, "error": resp.text[:200], "sessions": []}
        sessions = resp.json()
    out = []
    for s in sessions or []:
        real_id = s.get("id", "")
        out.append({
            "id": real_id,
            "short_id": _REAL_TO_SHORT.get(real_id),
            "title": s.get("title") or s.get("id", ""),
            "agent": s.get("agent") or s.get("agentId") or "",
            "cwd": s.get("cwd") or s.get("directory") or "",
            "time": s.get("time") or {"created": 0, "updated": 0},
        })
    return {"ok": True, "sessions": out[:30]}


async def _agent_session(sid: str) -> dict:
    """Get summary for one session: todos + changed files + last text."""
    headers = _opencode_auth()
    summary: dict = {"todos": [], "files": [], "text": "", "finished": False, "agent": "", "title": "", "short_id": None}
    try:
        # Fetch session metadata first
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{_OPENCODE_URL}/session/{sid}", headers=headers)
            if resp.status_code < 400:
                s = resp.json()
                summary["agent"] = s.get("agent") or s.get("agentId") or ""
                summary["title"] = s.get("title") or sid
        summary["short_id"] = _REAL_TO_SHORT.get(sid)
        # Fetch messages
        async with httpx.AsyncClient(timeout=20) as client:
            # SINGULAR /message + limit — the plural /messages route returns
            # the SPA HTML shell (never JSON), which made every summary empty.
            resp = await client.get(
                f"{_OPENCODE_URL}/session/{sid}/message",
                headers=headers,
                params={"limit": 50},
            )
            if resp.status_code >= 400:
                return summary
            msgs = resp.json() or []
        # Scan assistant message parts
        for m in msgs or []:
            info = m.get("info") or {}
            # opencode nests role inside info (not top-level).
            if info.get("role") != "assistant":
                continue
            if str(info.get("finish")) == "stop":
                summary["finished"] = True
            for part in m.get("parts") or []:
                t = part.get("type")
                if t == "text" and part.get("text"):
                    summary["text"] = (summary["text"] + "\n" + part["text"]).strip()
                elif t == "todo":
                    todos = part.get("todos") or part.get("items") or []
                    for td in todos:
                        summary["todos"].append({
                            "text": td.get("text") or td.get("content") or "",
                            "done": td.get("done") or False,
                            "status": td.get("status") or ("completed" if td.get("done") else "pending"),
                        })
                elif t in ("file", "patch"):
                    fp = part.get("file") or part.get("path") or part.get("name") or ""
                    if fp:
                        summary["files"].append({
                            "path": fp,
                            "status": part.get("action") or part.get("status") or "changed",
                            "diff": (part.get("diff") or part.get("patch") or "")[:500],
                        })
        summary["files"] = _dedupe_files(summary["files"])
        summary["text"] = summary["text"][:2000]
        summary["todos"] = summary["todos"][:20]
        summary["files"] = summary["files"][:20]
    except Exception:
        pass
    return summary


def _dedupe_files(files: list) -> list:
    seen = set()
    out = []
    for f in files:
        key = f.get("path", "")
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


async def _agent_completed_sessions() -> list:
    """Sessions whose newest message finished (info.finish == 'stop').

    Scoped to Discord-tracked sessions only — web UI sessions are excluded
    so they don't spam the completion push. Uses the singular /message route
    (the plural /messages route returns the SPA HTML shell, never JSON) and
    reads role/finish from msg.info (opencode nests them there, not top-level).
    """
    headers = _opencode_auth()
    done = []
    # Only sessions the user created via Discord (/go, /new) get completion pings.
    target_ids = list(_SESSIONS.values())
    if not target_ids:
        return []
    for sid in target_ids:
        if not sid:
            continue
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                # SINGULAR /message + limit — returns real JSON message array.
                mr = await client.get(
                    f"{_OPENCODE_URL}/session/{sid}/message",
                    headers=headers,
                    params={"limit": 50},
                )
                if mr.status_code >= 400:
                    continue
                msgs = mr.json() or []
            # Check the LAST assistant message for completion signal
            for m in reversed(msgs or []):
                info = m.get("info") or {}
                if info.get("role") != "assistant":
                    continue
                if str(info.get("finish")) == "stop":
                    done.append({"id": sid})
                break  # only check the newest message
        except Exception:
            continue
    return done


async def _agent_notify_loop():
    """Poll opencode sessions every ~12s; on NEW completion push work-done."""
    while True:
        try:
            if _remote_cfg is None or not _remote_cfg.enabled:
                await asyncio.sleep(15)
                continue
            done = await _agent_completed_sessions()
            for s in done:
                sid = s.get("id", "")
                if not sid or sid in _agent_notified:
                    continue
                _agent_notified[sid] = time.time()
                if len(_agent_notified) > 200:
                    for k in list(_agent_notified)[:-200]:
                        _agent_notified.pop(k, None)
                summary = await _agent_session(sid)
                body = _format_agent_done(s, summary)
                try:
                    from remote.notify import push
                    sent = await asyncio.to_thread(push, "agent_done", body, "")
                    print(f"[notify] agent done sid={sid[:20]} pushed={sent}", flush=True)
                except Exception as exc:
                    print(f"[notify] agent done err: {exc!r}", flush=True)
        except Exception:
            pass
        await asyncio.sleep(12)


def _format_agent_done(session: dict, summary: dict) -> str:
    """Build a work-done proof message."""
    SEP2 = "────────────────"
    title = summary.get("title") or session.get("title") or session.get("id", "?")
    agent = summary.get("agent") or session.get("agent") or "build"
    real_id = session.get("id") or session.get("sessionId") or ""
    short = _REAL_TO_SHORT.get(real_id)
    short_label = f"#{short}" if short is not None else ""
    lines = [
        f"✅ AGENT SESSION COMPLETED",
        f"{SEP2}",
    ]
    if short_label:
        lines.append(f"Session: {short_label}  {title[:60]}")
    else:
        lines.append(f"Session: {title[:60]}")
    lines.append(f"Agent: {agent}")
    # Todos
    todos = summary.get("todos") or []
    if todos:
        done_count = sum(1 for t in todos if t.get("done"))
        lines.append(f"\n📋 TODOs ({done_count}/{len(todos)} done):")
        for t in todos:
            check = "✅" if t.get("done") else "⬜"
            lines.append(f"  {check} {(t.get('text') or '')[:80]}")
    # Changed files
    files = summary.get("files") or []
    if files:
        lines.append(f"\n📁 CHANGED FILES ({len(files)}):")
        for f in files:
            lines.append(f"  • {f.get('path', '?')}")
    # Last assistant text
    text = summary.get("text", "").strip()
    if text:
        # Show the last meaningful paragraph
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        last_text = paragraphs[-1] if paragraphs else text
        lines.append(f"\n💬 LAST REPLY:\n{last_text[:800]}")
    lines.append(f"\n{SEP2}")
    if short_label:
        lines.append(f"Re-run: /go {short_label} <task>")
    lines.append(f"🤖 Visible in the web Agent Workspace")
    return "\n".join(lines)


def _remote_bridge() -> dict:
    """The bridge the remote service uses to reach the EXISTING TTO logic."""
    return {
        "get_terminals": _remote_terminal_entries,
        "resolve_terminal": _remote_resolve,
        "send_input": _remote_send_input,
        "raw_input": _remote_raw_input,
        "stop_terminal": _remote_stop_terminal,
        "restart_terminal": _remote_restart_terminal,
        "close_terminal": _remote_close_terminal,
        "pause_terminal": _remote_pause_terminal,
        "resume_terminal": _remote_resume_terminal,
        "add_task": _remote_add_task,
        "orchestrate": _remote_orchestrate,  # async fn(task, entries, model="")
        "get_tasks": lambda tty: {
            "current_task": terminals[tty].current_task.model_dump() if tty in terminals and terminals[tty].current_task else None,
            "next_task": terminals[tty].next_task.model_dump() if tty in terminals and terminals[tty].next_task else None,
            "queue": [tk.model_dump() for tk in terminals[tty].queue] if tty in terminals else [],
            "history": [tk.model_dump() for tk in terminals[tty].history[-10:]] if tty in terminals else [],
        },
        "get_logs": lambda tty, lines: (terminals[tty].live_output if tty in terminals else "")[: lines * 300],
        "get_token_usage": get_token_usage_cached,
        "list_files": _remote_list_files,
        "get_workspaces": lambda: stored_workspaces,
        "get_overall": lambda: {"terminals": {tty: terminal_payload(tty, t) for tty, t in terminals.items() if t.info.is_live},
                                 "token_usage": get_token_usage_cached()},
        "agent_state": lambda: (True, manager.command_relay is not None),
        "rust_available": lambda: manager.command_relay is not None,
        "set_terminal_model": lambda tty, model: (
            setattr(terminals[tty], 'model', model.strip()) if tty in terminals else None,
            save_state() if tty in terminals else None,
        ),
        # ── Agent Workspace bridge (Discord ↔ opencode sessions) ───────────
        "agent_workspaces": _agent_workspaces,
        "create_workspace": _create_workspace,                # voice lane: create workspace
        "agent_resolve_session": _session_resolve,       # "1"/"#1"/"ses_…" -> {short,real}
        "create_agent_session": _v_create_agent_session,   # async
        "send_agent_task": _send_agent_task,               # async
        "agent_abort": _agent_abort,                       # async
        "agent_sessions": _agent_sessions,                 # async
        "agent_session": _agent_session,                   # async
        # ── Discord per-chat workspace bridges ────────────────────────────
        "resolve_session": resolve_session,                 # per-chat scoped resolver
        "agent_get_chat_ws": _get_chat_ws,                  # get docked ws for a chat
        "agent_set_chat_ws": _set_chat_ws,                  # set docked ws for a chat
        "agent_resolve_workspace": _resolve_agent_workspace, # ref -> workspace dict
        # ── Global current workspace (fallback when no per-chat dock) ─────
        "agent_current_ws": _get_current_ws,                # get global current ws name
        "agent_set_current_ws": _set_current_ws,            # set global current ws name
        "resolve_default_workspace": _resolve_default_workspace,  # default ws dict
    }

def _remote_list_files(path: str) -> Optional[dict]:
    """Home-scoped directory listing for /files (remote sandbox)."""
    try:
        home = Path.home().resolve()
        target = (home / (path or "")).resolve()
        # Use relative_to instead of startswith to prevent symlink bypass
        try:
            target.relative_to(home)
        except ValueError:
            return None
        if not target.exists():
            return None
        if target.is_file():
            return {"path": path or "", "files": [{"name": target.name, "is_dir": False, "size": target.stat().st_size}]}
        items = []
        for child in sorted(target.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower()))[:50]:
            try:
                st = child.stat()
                items.append({"name": child.name, "is_dir": child.is_dir(), "size": st.st_size if child.is_file() else None})
            except OSError:
                continue
        rel = str(target.relative_to(Path.home()))
        return {"path": rel if rel != "." else "", "files": items}
    except Exception:
        return None


async def remote_status_loop():
    """Refresh OpenWA + WhatsApp session status when remote is enabled."""
    while True:
        # Fast TCP reachability probe BEFORE any OpenWA call.  When nothing is
        # listening on 2785 the client falls back to blocking urllib retries
        # with time.sleep, which freezes the entire event loop for seconds on
        # every tick.  A refused connect returns instantly, so we can cheaply
        # back off instead of discovering the outage through a 6s stall.
        try:
            _sock = socket.create_connection(("127.0.0.1", 2785), timeout=0.5)
            _sock.close()
        except (ConnectionRefusedError, OSError, socket.timeout):
            await asyncio.sleep(30)  # nothing listening — check again in 30s
            continue
        try:
            if _remote is not None and _remote_cfg is not None and _remote_cfg.enabled:
                _remote.openwa_client.client.is_available()
                _remote.openwa_client.client.session_status()
        except Exception:
            pass
        await asyncio.sleep(15)

async def remote_notify_loop():
    """Proactive WhatsApp notifications (task complete/failed, agent waiting,
    terminal crash, system error) with per-task dedup + cooldowns.  Watches the
    EXISTING terminal/task state — no new task state is introduced."""
    print("[notify] notify loop started", flush=True)
    seen_history: Dict[str, set] = {}      # tty -> task ids already notified
    seen_pids: Dict[str, int] = {}         # tty -> last opencode pid
    last_output: Dict[str, str] = {}       # tty -> last live_output snapshot
    idle_since: Dict[str, float] = {}      # tty -> ts when output went quiet
    waiting_notified: Dict[str, float] = {}  # tty -> ts of last waiting notify
    last_system_error: str = ""
    while True:
        await asyncio.sleep(5)
        try:
            if _remote is None or _remote_cfg is None or not _remote_cfg.enabled:
                continue
            notify = _remote.notify
            rstate = _remote.models.state
            chats = _remote_cfg.allowed_chat_ids or _remote_cfg.allowed_phone_numbers
            chat = chats[0] if chats else ""
            print(f"[notify] tick: terminals={len(terminals)}, enabled={_remote_cfg.enabled}, chat={chat!r}", flush=True)
            for tty, t in list(terminals.items()):
                # 1. Task complete / failed (from history).
                for tk in list(t.history[-5:]):
                    done = seen_history.setdefault(tty, set())
                    if tk.id in done:
                        continue
                    done.add(tk.id)
                    label = _tty_label(tty)
                    duration = (tk.completed_at or time.time()) - (tk.started_at or tk.created_at or time.time())
                    if tk.status == "done":
                        # Give the frontend ~2s to capture + upload the proof
                        # screenshot (it fires the moment the done task appears
                        # in the dashboard state), so text + photo go together.
                        await asyncio.sleep(2.0)
                        sent_txt = await asyncio.to_thread(notify.push, "task_complete", notify.format_task_complete(label, tk.model_dump(), duration), chat)
                        print(f"[notify] task_complete tty={tty} task={tk.id} text_sent={sent_txt}", flush=True)
                        # Workstream B: attach the terminal screenshot proof (if
                        # the frontend captured one) as a proof photo.
                        try:
                            shot = tk.screenshot_path or ""
                            if not shot and SCREENSHOTS_DIR:
                                _p = SCREENSHOTS_DIR / f"{tty}_{tk.id}.png"
                                if _p.exists():
                                    shot = str(_p)
                            # Backend fallback: if the frontend didn't capture
                            # a screenshot, generate one from tmux + Pillow.
                            if not shot or not os.path.isfile(shot):
                                png = await asyncio.to_thread(_capture_terminal_png, tty)
                                if png and len(png) > 100:
                                    shot = str(SCREENSHOTS_DIR / f"{tty}_{tk.id}.png")
                                    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
                                    Path(shot).write_bytes(png)
                                    print(f"[notify] backend screenshot tty={tty} task={tk.id} size={len(png)}", flush=True)
                            if shot and os.path.isfile(shot):
                                print(f"[notify] photo tty={tty} task={tk.id} file={shot}", flush=True)
                        except Exception as exc:
                            print(f"[notify] photo error: {exc}", flush=True)
                    elif tk.status in ("blocked", "failed"):
                        await asyncio.to_thread(notify.push, "task_failed", notify.format_task_failed(label, tk.model_dump(), tk.summary), chat)
                # 2. Agent waiting: a running task whose captured output has not
                #    changed for ~2 minutes -> the agent is likely blocked/waiting.
                if t.current_task and t.current_task.status == "running":
                    out = t.live_output or ""
                    if last_output.get(tty) == out:
                        if tty not in idle_since:
                            idle_since[tty] = time.time()
                        elif time.time() - idle_since[tty] > 120 and time.time() - waiting_notified.get(tty, 0) > 900:
                            waiting_notified[tty] = time.time()
                            label = _tty_label(tty)
                            await asyncio.to_thread(notify.push, "agent_waiting", notify.format_agent_waiting(label, t.info.agent), chat)
                    else:
                        idle_since.pop(tty, None)
                    last_output[tty] = out
                else:
                    idle_since.pop(tty, None)
                    last_output.pop(tty, None)
                # 3. Terminal crash: an opencode we were watching disappeared
                #    while the terminal was still supposed to be live.
                pid = opencode_pids.get(tty, 0)
                prev = seen_pids.get(tty, 0)
                if prev and pid == 0 and t.info.is_live and time.time() - t.info.last_seen < 30:
                    label = _tty_label(tty)
                    await asyncio.to_thread(notify.push, "terminal_crash", notify.format_terminal_crash(label), chat)
                    seen_pids.pop(tty, None)
                elif pid and pid != prev:
                    seen_pids[tty] = pid
            # 4. System error: remote subsystem reported a problem (e.g. OpenWA
            #    went offline) — notify once per distinct error, cooldown-gated.
            err = rstate.last_error
            if err and err != last_system_error:
                last_system_error = err
                await asyncio.to_thread(notify.push, "system_error", notify.format_system_error(err), chat)
        except Exception as exc:
            print(f"[notify] tick error: {exc!r}", flush=True)
            pass

def _init_remote():
    """Import + register the remote subsystem. Never raises — remote is optional."""
    global _remote, _remote_cfg
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import remote  # noqa: F401
        from remote import webhook as remote_webhook
        from remote import service as remote_service
        from remote.config import load_config as rc_load
        _remote_cfg = rc_load()
        remote_service.register(_remote_bridge())
        app.include_router(remote_webhook.router)
        _remote = remote
        print(f"[remote] init OK: enabled={_remote_cfg.enabled}", flush=True)
    except Exception as exc:
        print(f"[remote] init skipped: {exc}")


async def _run_discord_bot(token: str) -> None:
    """Launch the Discord bot in a background task.

    Runs alongside FastAPI on the same event loop.  If the token is missing,
    logs "Discord bot disabled" and continues — TTO never breaks when Discord
    is off.
    """
    try:
        from remote import discord_bot
        bridge = {
            "agent_workspaces": _agent_workspaces,
            "agent_sessions": _agent_sessions,
            "agent_session": _agent_session,
            "create_agent_session": _v_create_agent_session,
            "create_workspace": _create_workspace,
            "send_agent_task": _send_agent_task,
            "agent_abort": _agent_abort,
            "agent_resolve_workspace": _resolve_agent_workspace,
            "resolve_session": resolve_session,
            "agent_get_chat_ws": _get_chat_ws,
            "agent_set_chat_ws": _set_chat_ws,
        }
        await discord_bot.run_bot(token, bridge)
    except Exception as exc:
        print(f"[discord] bot failed: {exc}", flush=True)


def _start_remote_loops():
    """Start the remote background loops (called from startup when enabled)."""
    try:
        if _remote_cfg is not None and _remote_cfg.enabled:
            asyncio.create_task(remote_status_loop())
            asyncio.create_task(remote_notify_loop())
            asyncio.create_task(_agent_notify_loop())
        # Sleep prevention: whenever remote is enabled, keep the system awake
        # so remote tasks never die to idle sleep.
        if _remote_cfg is not None and _remote_cfg.enabled:
            try:
                from remote import sleep as sleep_mod
                sleep_mod.prevent_sleep()
                asyncio.create_task(sleep_mod.sleep_housekeeping_loop())
            except Exception as exc:
                print(f"[sleep] startup hook failed: {exc}")
        # Discord bot (optional — TTO never breaks when Discord is off)
        discord_token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
        if discord_token:
            asyncio.create_task(_run_discord_bot(discord_token))
            print("[discord] bot starting", flush=True)
        else:
            print("[discord] bot disabled (DISCORD_BOT_TOKEN not set)", flush=True)
    except Exception as exc:
        print(f"[remote] loops skipped: {exc}")


# Mount the remote router at import time so the endpoints exist regardless of
# startup events (the loops start in startup()).
_init_remote()


# --- Static files ---
# When bundled inside an .app: backend lives at Contents/Resources/backend/,
# so parent.parent points to Contents/Resources/ which contains dist/.
# When running from the dev tree: parent.parent is the repo root.
_backend_parent = Path(__file__).resolve().parent
_frontend_dist_candidates = [
    _backend_parent.parent.parent / "dist",          # bundled: Contents/Resources/dist/
    _backend_parent.parent / "frontend" / "dist",     # dev tree
]
frontend_dir = next((p for p in _frontend_dist_candidates if p.exists()), None)
if frontend_dir and (frontend_dir / "assets").exists():
    assets_dir = frontend_dir / "assets"
    app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

# ── UI Inspector: send annotation context to agent terminal ──────────────────

class AnnotationTaskRequest(BaseModel):
    tty: str
    comment: str
    element_tag: str
    element_class: str
    component_name: str
    source_file: Optional[str]
    project_path: Optional[str]
    bounding_box: dict  # {x, y, w, h}


@app.post("/api/annotations/send-to-agent")
async def send_annotation_to_agent(req: AnnotationTaskRequest):
    """Create a rich-context task from a UI inspector annotation and deliver
    it to the specified terminal's agent (opencode, etc.)."""
    tty = _resolve_tty(req.tty)
    if tty not in terminals:
        raise HTTPException(404, "Terminal not found")

    # Build structured Markdown that the coding agent can parse
    ctx_lines = [
        "## UI Annotation",
        "",
        f"**Component:** {req.component_name or '(native DOM)'}",
        f"**DOM selector:** `{req.element_tag}.{req.element_class}`" if req.element_class else f"**DOM:** `{req.element_tag}`",
        f"**Source:** {req.source_file}" if req.source_file else "**Source:** *(unknown — run in dev mode for full resolution)*",
        f"**Project:** {req.project_path}" if req.project_path else "**Project:** *(not set)*",
        "",
        "### User Request",
        req.comment,
    ]
    description = "\n".join(ctx_lines)

    task = Task(id=str(uuid.uuid4()), description=description, status="pending")
    await _place_task(tty, task)
    return {"ok": True, "task_id": task.id}


# --- Go Live: static file server for project preview -----------------------

import subprocess as _subprocess
import threading as _threading
import signal as _signal
import socket as _socket

# Track running serve processes: {port: subprocess.Popen}
_serve_processes: dict[int, _subprocess.Popen] = {}
_serve_lock = _threading.Lock()


def _find_free_port(start: int = 18920) -> int:
    """Find an available port starting from `start`."""
    for port in range(start, start + 100):
        try:
            with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    return start


@app.post("/api/serve/start")
async def serve_start(payload: dict):
    """Start a static HTTP server for the given directory.
    payload: {"path": "/absolute/path/to/project", "port": 18920}
    Returns: {"ok": true, "port": 18920, "url": "http://127.0.0.1:18920"}
    """
    project_path = payload.get("path", "")
    requested_port = payload.get("port", 18920)

    if not project_path:
        raise HTTPException(400, "path is required")

    p = Path(project_path).resolve()
    if not p.exists() or not p.is_dir():
        raise HTTPException(400, f"Not a directory: {project_path}")

    port = int(requested_port)

    # Kill any existing server on this port
    with _serve_lock:
        old = _serve_processes.get(port)
        if old:
            try:
                old.terminate()
                old.wait(timeout=2)
            except Exception:
                try:
                    old.kill()
                except Exception:
                    pass
            _serve_processes.pop(port, None)

    # Find a free port if requested one is taken
    port = _find_free_port(port)

    # Start python3 -m http.server in the project directory
    try:
        proc = _subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
            cwd=str(p),
            stdout=_subprocess.DEVNULL,
            stderr=_subprocess.DEVNULL,
        )
        with _serve_lock:
            _serve_processes[port] = proc
        return {"ok": True, "port": port, "url": f"http://127.0.0.1:{port}"}
    except Exception as e:
        raise HTTPException(500, f"Failed to start server: {e}")


@app.post("/api/serve/stop")
async def serve_stop(payload: dict):
    """Stop the static server on the given port."""
    port = int(payload.get("port", 0))
    if not port:
        raise HTTPException(400, "port is required")
    with _serve_lock:
        proc = _serve_processes.pop(port, None)
    if proc:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        return {"ok": True, "message": f"Server on port {port} stopped"}
    return {"ok": True, "message": f"No server running on port {port}"}


@app.get("/api/serve/status")
async def serve_status():
    """Check which servers are running."""
    with _serve_lock:
        running = []
        for port, proc in list(_serve_processes.items()):
            if proc.poll() is None:
                running.append({"port": port, "pid": proc.pid})
            else:
                _serve_processes.pop(port, None)
    return {"servers": running}


# ── OpenCode Server Proxy ───────────────────────────────────────────────────
# Proxies requests from the frontend (via sidecar :8765) to the local
# OpenCode server (:4096). This avoids CORS issues since the browser
# talks to our sidecar, not directly to the OpenCode server.

_OPENCODE_URL = "http://127.0.0.1:4097"
_opencode_pw = os.environ.get("OPENCODE_SERVER_PASSWORD", "")

# If `opencode serve` was launched from a terminal with OPENCODE_SERVER_PASSWORD
# set, the password lives ONLY in that process's environment — the tto sidecar
# (spawned separately) cannot see it, so every proxied call would 401. Discover
# the password lazily from the running server process (same user) and cache it.
_opencode_pw_source = "env" if _opencode_pw else ""
_opencode_pw_cache_time = 0.0


def _discover_opencode_pw() -> str:
    """Best-effort: find the OpenCode server's password.

    Order: our own environment → stored config → the running `opencode serve`
    process environment (readable for the same user via `ps eww`).  Re-checks
    periodically so a server started AFTER the sidecar is picked up too.
    """
    global _opencode_pw, _opencode_pw_source, _opencode_pw_cache_time

    if _opencode_pw_source == "env":
        return _opencode_pw

    # Re-discover at most once per 30 s (cheap `ps` call, but no need to spam).
    now = time.time()
    if _opencode_pw and now - _opencode_pw_cache_time < 30:
        return _opencode_pw

    # 1. Persisted in ~/.DPO/opencode-password (written by a launcher).
    try:
        pw_file = STATE_DIR / "opencode-password"
        if pw_file.is_file():
            pw = pw_file.read_text().strip()
            if pw:
                _opencode_pw = pw
                _opencode_pw_source = "file"
                _opencode_pw_cache_time = now
                return pw
    except Exception:
        pass

    # 2. Read it from the running opencode server's own environment.
    try:
        out = subprocess.run(
            ["ps", "eww", "-A"], capture_output=True, text=True, timeout=5
        ).stdout
        for line in out.splitlines():
            if "opencode serve" not in line:
                continue
            m = re.search(r"OPENCODE_SERVER_PASSWORD=(\S+)", line)
            if m:
                _opencode_pw = m.group(1)
                _opencode_pw_source = "proc"
                _opencode_pw_cache_time = now
                return _opencode_pw
    except Exception:
        pass

    _opencode_pw_cache_time = now
    return _opencode_pw

# ── Nara → OmniRoute fallback ──────────────────────────────────────────────
# When the Nara Router (nararoute/*) is down/slow, automatically shift the
# whole session to OmniRoute Local AI using the user's chosen fallback model.
NARA_PROVIDER = "nararoute"
OMNIROUTE_FALLBACK_MODEL = "omniroute/auto/best-coding-fast"

# session_id -> model key to force (set after a Nara failure; persists until
# the session is deleted so every later message in that session uses OmniRoute).
_session_model_override: Dict[str, str] = {}


def _is_nara_model(model: str) -> bool:
    """True if the requested model routes through the Nara Router."""
    return bool(model) and model.split("/", 1)[0] == NARA_PROVIDER


def _effective_model(session_id: str, requested: str) -> str:
    """Return the model to actually use for a session (override wins)."""
    if session_id in _session_model_override:
        return _session_model_override[session_id]
    return requested


def _opencode_auth():
    """Return basic auth header value if password is set."""
    pw = _discover_opencode_pw()
    if pw:
        import base64
        credentials = f"opencode:{pw}"
        return {"Authorization": f"Basic {base64.b64encode(credentials.encode()).decode()}"}
    return {}


@app.get("/api/opencode/health")
async def opencode_health():
    """Check if the OpenCode server is running."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{_OPENCODE_URL}/global/health", headers=headers)
            return resp.json()
    except Exception as e:
        return {"healthy": False, "error": str(e)}


@app.get("/api/opencode/sessions")
async def opencode_sessions():
    """List all OpenCode sessions."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_OPENCODE_URL}/session", headers=headers)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


@app.post("/api/opencode/session")
async def opencode_create_session(payload: dict):
    """Create a new OpenCode session."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{_OPENCODE_URL}/session",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


@app.delete("/api/opencode/session/{session_id}")
async def opencode_delete_session(session_id: str):
    """Delete an OpenCode session."""
    _session_model_override.pop(session_id, None)
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(f"{_OPENCODE_URL}/session/{session_id}", headers=headers)
            return resp.json()
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


@app.patch("/api/opencode/session/{session_id}")
async def opencode_update_session(session_id: str, payload: dict):
    """Update a session (e.g. rename title)."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{_OPENCODE_URL}/session/{session_id}",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


class OpencodeMessagePayload(BaseModel):
    message: str
    model: str | None = None
    agent: str | None = None
    no_reply: bool = False
    system: str | None = None


async def _post_opencode_message(session_id: str, body: dict, *, timeout: float = 300) -> dict:
    """POST a message body to the OpenCode server, raising on failure.

    This is an internal helper — NOT a standalone HTTP endpoint.
    Callers should use `opencode_send_message` instead.
    """
    headers = _opencode_auth()
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"{_OPENCODE_URL}/session/{session_id}/message",
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        return resp.json()


def _build_opencode_body(payload: OpencodeMessagePayload, use_model: str, no_retry: bool) -> dict:
    """Build the OpenCode message body (OpenCode expects `parts`, not a flat key).

    Field names follow the OpenCode server API exactly: `parts`, `agent`,
    `system`, and `noReply` (camelCase) — a snake_case key like `no_retry` is
    rejected by the server with a 400.

    `model` must be sent as an OBJECT: this server (1.18.29) rejects the
    "provider/model" string shorthand with 400 "Expected object | null, got
    string at [model]".
    """
    body: dict = {"parts": [{"type": "text", "text": payload.message}]}
    if use_model:
        if "/" in use_model:
            provider, model_id = use_model.split("/", 1)
            body["model"] = {"providerID": provider, "modelID": model_id}
        else:
            body["model"] = use_model
    if payload.agent:
        body["agent"] = payload.agent
    if payload.system:
        body["system"] = payload.system
    body["noReply"] = no_retry
    return body


async def _send_with_nara_fallback(session_id: str, payload: OpencodeMessagePayload, *, no_retry: bool, timeout: float = 300) -> dict:
    """Send a message, automatically shifting to OmniRoute Local AI when the
    Nara Router is down/slow.

    - If the session already fell back, it keeps using the OmniRoute model.
    - If a Nara request fails (router down / auth / 5xx / timeout), the whole
      session is switched to OMNIROUTE_FALLBACK_MODEL (recorded), and the
      message is retried once with that model. The user chose "switch whole
      session" so every later message in the session also uses OmniRoute.
    """
    requested = payload.model or ""
    # Respect an active override (session already on OmniRoute).
    use_model = _effective_model(session_id, requested)
    body = _build_opencode_body(payload, use_model, no_retry)
    try:
        return await _post_opencode_message(session_id, body, timeout=timeout)
    except Exception:
        # Only attempt the Nara → OmniRoute shift when not already shifted and
        # the session is (or defaults to) a Nara model.
        overridden = session_id in _session_model_override
        if overridden or not (not requested or _is_nara_model(requested)):
            raise
        _session_model_override[session_id] = OMNIROUTE_FALLBACK_MODEL
        fallback_body = _build_opencode_body(payload, OMNIROUTE_FALLBACK_MODEL, no_retry)
        return await _post_opencode_message(session_id, fallback_body, timeout=timeout)


@app.post("/api/opencode/session/{session_id}/message")
async def opencode_send_message(session_id: str, payload: OpencodeMessagePayload):
    """Send a message to an OpenCode session (blocking — waits for response).

    OpenCode's server API expects a `parts` array (e.g. [{"type":"text","text":...}]),
    NOT a flat `message` key. Build the correct payload here.

    If the Nara Router is unavailable the session automatically shifts to the
    OmniRoute Local AI fallback model.
    """
    try:
        return await _send_with_nara_fallback(session_id, payload, no_retry=payload.no_reply)
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


@app.post("/api/opencode/session/{session_id}/message_async")
async def opencode_send_message_async(session_id: str, payload: OpencodeMessagePayload):
    """Send a message to an OpenCode session (non-blocking).

    Also applies the Nara → OmniRoute Local AI fallback on failure so the
    session keeps working even if the Nara Router is down.
    """
    try:
        await _send_with_nara_fallback(session_id, payload, no_retry=True, timeout=10)
        return {"ok": True}
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


@app.post("/api/opencode/session/{session_id}/message_stream")
async def opencode_send_message_stream(session_id: str, payload: OpencodeMessagePayload):
    """Send a message to an OpenCode session and STREAM the SSE response back
    to the client, instead of buffering the full generation.

    The Agent Workspace waited for the entire run before showing anything
    (up to 300s of "Thinking…"); with this endpoint the frontend receives
    token/part updates live as the agent generates.

    If the opencode server ignores `stream:true` and returns a plain JSON
    body, the reply is passed through as JSON so the client can take its
    standard blocking parse (no dead silent replies).
    """
    from fastapi.responses import StreamingResponse

    try:
        use_model = _effective_model(session_id, payload.model or "")
        body = _build_opencode_body(payload, use_model, no_retry=payload.no_reply)
        body["stream"] = True
        headers = _opencode_auth()
    except Exception:
        return JSONResponse(status_code=502, content={"error": "build failed"})

    client = httpx.AsyncClient(timeout=None)
    try:
        req = client.build_request(
            "POST",
            f"{_OPENCODE_URL}/session/{session_id}/message",
            headers=headers,
            json=body,
        )
        resp = await client.send(req, stream=True)
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "").lower()
        if "text/event-stream" not in content_type:
            # opencode returned a plain JSON reply — pass it through.
            raw = await resp.aread()
            text = raw.decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text)
            except Exception:
                parsed = {"raw": text}
            await client.aclose()
            return JSONResponse(status_code=200, content=parsed)

        async def stream():
            # SSE is framed as "data: <json>\n\n" — relay each line so the
            # frontend parses a clean event stream.
            #
            # NOTE: a client disconnect (tab switch, webview throttle, brief
            # network blip) must NOT abort the opencode run. Generation keeps
            # going server-side and the Agent Workspace rehydrates the finished
            # message on the next visit — killing the run here turned tab
            # switching into "my session stopped". The ONLY abort path is the
            # explicit Stop button (/abort endpoint).
            try:
                async for line in resp.aiter_lines():
                    if line.startswith("data:"):
                        yield line + "\n\n"
                    elif line.strip():
                        yield f"data: {line}\n\n"
            except Exception:
                # Client disconnected mid-stream — the opencode run continues
                # to completion server-side. Do NOT POST /abort here.
                pass
            finally:
                await client.aclose()

        return StreamingResponse(stream(), media_type="text/event-stream")
    except Exception as e:
        await client.aclose()
        return JSONResponse(status_code=502, content={"error": str(e)})


@app.post("/api/opencode/session/{session_id}/abort")
async def opencode_abort(session_id: str):
    """Abort a running OpenCode session."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{_OPENCODE_URL}/session/{session_id}/abort", headers=headers)
            return resp.json()
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


@app.get("/api/opencode/agents")
async def opencode_agents():
    """List available OpenCode agents."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{_OPENCODE_URL}/agent", headers=headers)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return []


@app.get("/api/opencode/sessions/status")
async def opencode_session_status():
    """Get status of all sessions."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{_OPENCODE_URL}/session/status", headers=headers)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return {}


@app.get("/api/opencode/sessions/{session_id}/messages")
async def opencode_list_messages(session_id: str, limit: int = 50):
    """List messages in a session."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{_OPENCODE_URL}/session/{session_id}/message",
                headers=headers,
                params={"limit": limit},
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})


@app.get("/api/opencode/sessions/{session_id}/todo")
async def opencode_get_todo(session_id: str):
    """Get todo list for a session."""
    try:
        headers = _opencode_auth()
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{_OPENCODE_URL}/session/{session_id}/todo", headers=headers)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return []


@app.get("/api/opencode/sessions/{session_id}/diff")
async def opencode_get_diff(session_id: str, message_id: str | None = None):
    """Get file diffs for a session."""
    try:
        headers = _opencode_auth()
        params = {}
        if message_id:
            params["messageID"] = message_id
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{_OPENCODE_URL}/session/{session_id}/diff",
                headers=headers,
                params=params,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return []


@app.get("/api/opencode/events")
async def opencode_events():
    """SSE endpoint — proxies the OpenCode event stream."""
    from fastapi.responses import StreamingResponse

    async def stream():
        headers = _opencode_auth()
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "GET", f"{_OPENCODE_URL}/event", headers=headers
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line.startswith("data:"):
                            yield line + "\n"
                        elif line.strip():
                            yield f"data: {line}\n\n"
        except Exception:
            pass

    return StreamingResponse(stream(), media_type="text/event-stream")

# ── UI Inspector
@app.get("/{path:path}", include_in_schema=False)
async def root(path: str):
    # Skip API routes — let them be handled by their specific handlers
    if path.startswith("api/"):
        return {"message": "DPO backend running", "docs": "/docs"}
    candidate = (frontend_dir / path).resolve()
    if path and candidate.is_file() and candidate.is_relative_to(frontend_dir):
        return FileResponse(candidate)
    index = frontend_dir / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"message": "DPO backend running", "docs": "/docs"}



def _kill_zombie_backends(target_port: int) -> None:
    """SIGKILL any orphaned main.py processes still holding `target_port`.

    DPO.app respawns the sidecar when it detects a crash or freeze.  If the
    old process is stuck in STAT U (uninterruptible kernel wait — caused by a
    hung subprocess such as `ps -axo`), it holds the port in ESTABLISHED state
    and the new sidecar is forced onto target_port+1.  The frontend then
    connects to the stale socket and shows 'disconnected' forever.

    This cleanup runs once at startup (before uvicorn binds) to break the
    cascade.  We only target our own repo path to avoid killing unrelated
    Python processes.
    """
    try:
        import subprocess as _sp
        me = os.getpid()
        own_repo = str(Path(__file__).resolve().parent)
        # Find all main.py processes (excluding self)
        r = _sp.run(
            ["ps", "-axo", "pid=,command="],
            capture_output=True, text=True, timeout=3,
        )
        for line in r.stdout.splitlines():
            parts = line.split(None, 1)
            if len(parts) != 2:
                continue
            try:
                pid = int(parts[0])
            except ValueError:
                continue
            if pid == me:
                continue
            cmd = parts[1]
            if "main.py" not in cmd or own_repo not in cmd:
                continue
            # Check if this zombie holds our port
            try:
                lr = _sp.run(
                    ["lsof", "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN"],
                    capture_output=True, text=True, timeout=2,
                )
                if str(target_port) in lr.stdout:
                    print(f"[startup] killing zombie PID {pid} on port {target_port}", flush=True)
                    os.kill(pid, signal.SIGKILL)
            except Exception:
                pass
    except Exception as exc:
        print(f"[startup] zombie cleanup failed: {exc}", flush=True)


if __name__ == "__main__":
    import uvicorn
    # Bind to localhost only by default (secure).  Set TTO_HOST=0.0.0.0 for LAN access.
    host = os.environ.get("TTO_HOST", "127.0.0.1")
    port = int(os.environ.get("TTO_PORT", "8765"))
    # Kill any orphaned main.py still holding our port (prevents the
    # zombie-squats-port → fallback-to-8766 → frontend-disconnected cascade).
    _kill_zombie_backends(port)
    uvicorn.run(app, host=host, port=port)


