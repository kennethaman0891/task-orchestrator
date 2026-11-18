# backend/routers/collab.py — Collab endpoints
import os, json, time, pathlib, secrets, threading
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Request, WebSocket, Depends, Body, Query, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field

# Import our store and audit
from collab_store import get_collab_store
from audit import (
    get_audit_recorder, audit_event, audit_login, audit_logout,
    audit_workspace_open, audit_terminal_open, audit_command,
    audit_workspace_change, audit_message, AUDIT_DIR
)

router = APIRouter(prefix="/api/collab", tags=["collab"])

# ── Pydantic models ──────────────────────────────────────────────────────────

class OwnerProfileRequest(BaseModel):
    email: str = Field(min_length=3, max_length=128)
    name: str = Field(min_length=1, max_length=64)
    instance_name: Optional[str] = Field(default="", max_length=128)
    tagline: Optional[str] = Field(default="", max_length=256)
    plan: Optional[str] = Field(default="pro", max_length=32)

class PlanUpdateRequest(BaseModel):
    plan: str = Field(pattern="^(paid|pro|plus)$")

class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=128)
    pin: str = Field(min_length=6, max_length=64)
    name: Optional[str] = Field(default=None, max_length=64)
    permission: str = Field(default="worker", pattern="^(viewer|worker)$")
    allowed_workspaces: List[str] = Field(default_factory=list)
    username: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    permission: Optional[str] = Field(default=None, pattern="^(viewer|worker)$")
    allowed_workspaces: Optional[List[str]] = None

class PinChange(BaseModel):
    new_pin: str = Field(min_length=6, max_length=64)

class LoginRequest(BaseModel):
    email: Optional[str] = None
    username: Optional[str] = None
    pin: Optional[str] = None
    invite_code: Optional[str] = None

class LoginResponse(BaseModel):
    token: str
    username: str
    email: str
    name: str
    permission: str
    allowed_workspaces: List[str]
    owner: Optional[dict] = None

class InviteRequest(BaseModel):
    email: str
    pin: Optional[str] = None
    send_email: bool = False
    base_url: Optional[str] = None

class SmtpSettings(BaseModel):
    enabled: bool = False
    host: str = ""
    port: int = 587
    username: str = ""
    password: str = ""
    use_tls: bool = True
    from_email: str = ""
    from_name: str = "Task Orchestrator Colab"

class SettingsRequest(BaseModel):
    lan_access: Optional[bool] = None
    log_on_desktop: Optional[bool] = None
    signin_alerts: Optional[bool] = None
    visit_retention_days: Optional[int] = Field(default=None, ge=0, le=3650)
    session_hours: Optional[int] = Field(default=None, ge=1, le=24 * 30)
    idle_minutes: Optional[int] = Field(default=None, ge=1, le=24 * 60)

class TunnelRequest(BaseModel):
    enabled: bool

class TerminalCommand(BaseModel):
    command: str
    workspace_id: Optional[str] = None

def get_client_ip(request: Request) -> str:
    """Client IP. Tunnel visitors are loopback at the socket, so use the forwarded address."""
    marked = getattr(getattr(request, "state", None), "tunnel_visitor_ip", None)
    if marked:
        return str(marked)
    try:
        from tunnel import tunnel_visitor_ip
        forwarded = tunnel_visitor_ip(request)
        if forwarded:
            return forwarded
    except Exception:
        pass
    if request.client:
        return request.client.host
    return "unknown"

def is_loopback(ip: str) -> bool:
    # "testclient" is Starlette's TestClient. It is this machine, same as main.py.
    return ip in ("127.0.0.1", "::1", "localhost", "testclient")

def _request_is_https(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    try:
        from tunnel import tunnel_visitor_ip
        if tunnel_visitor_ip(request) or getattr(request.state, "tunnel_visitor_ip", None):
            proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
            return proto == "https"
    except Exception:
        pass
    return False

def _set_session_cookie(response: Response, request: Request, token: str, ttl_seconds: float) -> None:
    """HttpOnly session cookie. Secure only when the visit arrived over HTTPS."""
    response.set_cookie(
        key="tto_collab_session",
        value=token,
        httponly=True,
        secure=_request_is_https(request),
        samesite="lax",
        max_age=max(60, int(ttl_seconds)),
        path="/",
    )

def _presented_token(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip() or None
    query_token = request.query_params.get("token")
    if query_token:
        return query_token
    cookie = request.cookies.get("tto_collab_session")
    if cookie:
        return cookie
    return None

def _owner_session_ok(request: Request) -> bool:
    """Desktop session token counts as the owner, including on loopback."""
    presented = (
        request.headers.get("x-task-orchestrator-token")
        or request.headers.get("x-task orchestrator-token")
        or request.query_params.get("session_token")
        or ""
    )
    if not presented:
        return False
    try:
        import main as main_mod
        expected = getattr(main_mod, "SESSION_TOKEN", "") or ""
        return bool(expected) and secrets.compare_digest(presented, expected)
    except Exception:
        return False

def _queue_signin_alert(user, ip: str, user_agent: str) -> None:
    from visit_store import parse_user_agent
    parsed = parse_user_agent(user_agent)

    def _send():
        try:
            get_collab_store().send_signin_alert(
                user.name or user.email or user.username,
                user.email or user.username,
                ip,
                parsed["browser"],
                parsed["os"],
                parsed["device"],
            )
        except Exception:
            pass

    threading.Thread(target=_send, daemon=True).start()

# Dependency: get collab user from token (for authenticated endpoints)
async def get_collab_user(request: Request):
    """Validate token from Authorization header or query param.
    Returns None if not authenticated or invalid.
    """
    token = _presented_token(request)
    if not token:
        return None
    store = get_collab_store()
    user = store.validate_token(token)
    if not user:
        return None
    return {
        "username": user.username,
        "email": user.email or user.username,
        "name": user.name or user.username,
        "permission": user.permission,
        "allowed_workspaces": user.allowed_workspaces,
    }

async def require_collab_user(request: Request):
    """Require valid collab token (401 if missing/invalid)."""
    user = await get_collab_user(request)
    if not user:
        raise HTTPException(401, "Invalid or expired token")
    return user

async def require_worker(user: Dict = Depends(require_collab_user)):
    """Require worker permission."""
    if user["permission"] != "worker":
        raise HTTPException(403, "Worker permission required")
    return user

async def require_owner(request: Request):
    """Owner endpoints: desktop session token, or loopback with no collaborator token.

    A collaborator bearer token is never enough, even from this machine.
    The desktop app sends the session token, so a leftover collaborator token
    in the same browser does not lock the owner out.
    """
    if _owner_session_ok(request):
        return {"role": "owner"}
    collab = await get_collab_user(request)
    if collab is not None:
        raise HTTPException(403, "Owner access required")
    if is_loopback(get_client_ip(request)):
        return {"role": "owner"}
    raise HTTPException(403, "Owner access required")

# ── Owner Account endpoints ──────────────────────────────────────────────────

@router.get("/owner")
async def get_owner(owner: Dict = Depends(require_owner)):
    """Fetch current host/owner account profile."""
    store = get_collab_store()
    return {"owner": store.get_owner()}

@router.post("/owner")
async def set_owner(req: OwnerProfileRequest, owner: Dict = Depends(require_owner)):
    """Create or update host/owner master profile."""
    store = get_collab_store()
    owner_dict = store.set_owner(req.email, req.name, req.instance_name or "", req.tagline or "", req.plan or "pro")
    await audit_event("owner", "owner_profile_updated", {"email": req.email, "name": req.name, "plan": req.plan})
    return {"owner": owner_dict}

@router.post("/owner/plan")
async def update_plan(req: PlanUpdateRequest, owner: Dict = Depends(require_owner)):
    """Update active subscription plan (paid, pro, plus)."""
    store = get_collab_store()
    owner_dict = store.set_owner_plan(req.plan)
    await audit_event("owner", "owner_plan_updated", {"plan": req.plan})
    return {"owner": owner_dict, "plan": req.plan}

# ── Auth & Session endpoints ─────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, request: Request, response: Response):
    """Login with Email/Username + PIN or Magic Invite Code."""
    from collections import defaultdict
    if not hasattr(login, '_failed_attempts'):
        login._failed_attempts = defaultdict(list)

    store = get_collab_store()
    ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent", "")
    identifier = (req.email or req.username or req.invite_code or "").strip()
    key = f"{ip}:{identifier}"
    ip_key = f"ip:{ip}"
    now = time.time()

    # Rate limiting: 5 failures / 5 minutes for one account, and 20 / 10 minutes
    # for the address, so rotating unknown emails does not walk around the limit.
    login._failed_attempts[key] = [t for t in login._failed_attempts[key] if now - t < 300]
    login._failed_attempts[ip_key] = [t for t in login._failed_attempts[ip_key] if now - t < 600]

    if len(login._failed_attempts[key]) >= 5 or len(login._failed_attempts[ip_key]) >= 20:
        await audit_event(identifier or ip, "login_failed", {
            "reason": "rate_limited",
            "ip": ip,
            "user_agent": user_agent,
            "attempts": len(login._failed_attempts[key]),
        })
        raise HTTPException(429, "Too many login attempts. Please try again later.")

    # 1. Magic invite code login path
    if req.invite_code:
        inv = store.consume_invite(req.invite_code)
        if not inv:
            login._failed_attempts[key].append(now)
            login._failed_attempts[ip_key].append(now)
            await audit_event(identifier or "invite", "login_failed", {
                "reason": "invalid_or_expired_invite", "ip": ip, "user_agent": user_agent,
            })
            raise HTTPException(401, "Invalid or expired invite link")

        user = store.get_user(inv.email)
        if not user:
            # Auto-create collaborator from invite record
            user = store.create_user(
                email=inv.email,
                pin=inv.pin,
                permission=inv.permission,
                allowed_workspaces=inv.allowed_workspaces
            )

        token = store.create_token(user.username, ttl_seconds=store.session_ttl_seconds())
        if not token:
            raise HTTPException(500, "Failed to create session token")

        store.record_login(user.username)
        from visit_store import get_visit_store
        get_visit_store().open_visit(
            username=user.username,
            email=user.email or user.username,
            name=user.name or user.username,
            ip=ip,
            user_agent=user_agent,
            token_prefix=token[:8],
            invite_code=req.invite_code,
            auth_method="invite",
        )
        await audit_login(user.email or user.username, token[:8])
        _queue_signin_alert(user, ip, user_agent)
        login._failed_attempts.pop(key, None)
        login._failed_attempts.pop(ip_key, None)
        _set_session_cookie(response, request, token, store.session_ttl_seconds())

        return LoginResponse(
            token=token,
            username=user.username,
            email=user.email or user.username,
            name=user.name or user.username,
            permission=user.permission,
            allowed_workspaces=user.allowed_workspaces,
            owner=store.get_owner()
        )

    # 2. Email / Username + PIN login path
    user = store.get_user(identifier)
    if not user:
        login._failed_attempts[key].append(now)
        login._failed_attempts[ip_key].append(now)
        await audit_event(identifier or "unknown", "login_failed", {
            "reason": "user_not_found", "ip": ip, "user_agent": user_agent,
        })
        raise HTTPException(401, "Invalid email or PIN")

    if not req.pin or not user.check_pin(req.pin):
        login._failed_attempts[key].append(now)
        login._failed_attempts[ip_key].append(now)
        await audit_event(user.email or user.username, "login_failed", {
            "reason": "bad_pin", "ip": ip, "user_agent": user_agent,
        })
        raise HTTPException(401, "Invalid email or PIN")

    login._failed_attempts.pop(key, None)
    login._failed_attempts.pop(ip_key, None)

    token = store.create_token(user.username, ttl_seconds=store.session_ttl_seconds())
    if not token:
        raise HTTPException(500, "Failed to create session token")

    store.record_login(user.username)
    from visit_store import get_visit_store
    get_visit_store().open_visit(
        username=user.username,
        email=user.email or user.username,
        name=user.name or user.username,
        ip=ip,
        user_agent=user_agent,
        token_prefix=token[:8],
        invite_code=None,
        auth_method="pin",
    )
    await audit_login(user.email or user.username, token[:8])
    _queue_signin_alert(user, ip, user_agent)
    _set_session_cookie(response, request, token, store.session_ttl_seconds())

    return LoginResponse(
        token=token,
        username=user.username,
        email=user.email or user.username,
        name=user.name or user.username,
        permission=user.permission,
        allowed_workspaces=user.allowed_workspaces,
        owner=store.get_owner()
    )

@router.get("/session")
async def get_session(user: Dict = Depends(require_collab_user)):
    """Return active collaborator profile and host owner details."""
    store = get_collab_store()
    user_obj = store.get_user(user["username"])
    return {
        "user": user_obj.to_safe_dict() if user_obj else user,
        "owner": store.get_owner()
    }

@router.post("/logout")
async def logout(response: Response, user: Dict = Depends(require_collab_user)):
    """Revoke current collaborator token and close the visit."""
    store = get_collab_store()
    store.revoke_user_tokens(user["username"])
    await audit_logout(user.get("email") or user["username"])
    from visit_store import get_visit_store
    visits = get_visit_store()
    visits.close_active_for_user(user["username"], "logout")
    visits.close_active_for_user(user.get("email") or user["username"], "logout")
    response.delete_cookie("tto_collab_session", path="/")
    return {"ok": True}

@router.post("/heartbeat")
async def heartbeat(request: Request, user: Dict = Depends(require_collab_user)):
    """Collaborator browsers call this while the tab is open."""
    activity = None
    try:
        body = await request.json()
        if isinstance(body, dict):
            activity = body.get("activity")
    except Exception:
        activity = None
    from visit_store import get_visit_store
    ok = get_visit_store().touch(user["username"], activity=str(activity)[:160] if activity else None)
    if not ok:
        raise HTTPException(401, "Session ended")
    return {"ok": True}

# ── User management (owner only) ─────────────────────────────────────────────

@router.get("/users")
async def list_users(request: Request, owner: Dict = Depends(require_owner)):
    """List all registered collaborators (owner view)."""
    store = get_collab_store()
    return {"users": [u.to_safe_dict() for u in store.list_users()]}

@router.post("/users")
async def create_user(req: UserCreate, request: Request, owner: Dict = Depends(require_owner)):
    """Add a new collaborator by email."""
    store = get_collab_store()
    try:
        user = store.create_user(
            email=req.email,
            pin=req.pin,
            name=req.name or "",
            permission=req.permission,
            allowed_workspaces=req.allowed_workspaces,
            username=req.username
        )

        # Generate immediate invite record
        invite_rec = store.create_invite(user.email, req.pin, user.permission, user.allowed_workspaces)
        host_header = request.headers.get("host", "localhost:8765")
        invite_url = f"http://{host_header}/login?email={user.email}&invite={invite_rec.code}"
        owner = store.get_owner() or {"name": "Host", "email": ""}
        text_data = store.generate_email_invite_text(
            user.email, invite_url, req.pin, owner.get("name", "Host"), owner.get("email", ""), user.permission
        )

        await audit_event("owner", "user_created", {
            "email": user.email,
            "name": user.name,
            "permission": req.permission,
            "allowed_workspaces": req.allowed_workspaces
        })

        return {
            "user": user.to_safe_dict(),
            "invite_code": invite_rec.code,
            "invite_url": invite_url,
            "email_subject": text_data["subject"],
            "email_body": text_data["body"]
        }
    except ValueError as e:
        raise HTTPException(400, str(e))

@router.patch("/users/{username}")
async def update_user(username: str, req: UserUpdate, request: Request, owner: Dict = Depends(require_owner)):
    store = get_collab_store()
    user = store.update_user(username, **{k: v for k, v in req.model_dump().items() if v is not None})
    if not user:
        raise HTTPException(404, "Collaborator not found")
    await audit_event("owner", "user_updated", {"username": username, **req.model_dump(exclude_none=True)})
    return user.to_safe_dict()

@router.post("/users/{username}/pin")
async def change_pin(username: str, req: PinChange, request: Request, owner: Dict = Depends(require_owner)):
    store = get_collab_store()
    user = store.set_pin(username, req.new_pin)
    if not user:
        raise HTTPException(404, "Collaborator not found")
    await audit_event("owner", "pin_changed", {"username": username})
    return {"ok": True}

@router.post("/users/{username}/revoke")
async def revoke_user(username: str, request: Request, owner: Dict = Depends(require_owner)):
    store = get_collab_store()
    if not store.revoke_user(username):
        raise HTTPException(404, "Collaborator not found")
    from visit_store import get_visit_store
    get_visit_store().close_active_for_user(username, "revoked")
    await audit_event("owner", "user_revoked", {"username": username})
    return {"ok": True}

@router.delete("/users/{username}")
async def delete_user(username: str, request: Request, owner: Dict = Depends(require_owner)):
    store = get_collab_store()
    from visit_store import get_visit_store
    get_visit_store().close_active_for_user(username, "revoked")
    if not store.delete_user(username):
        raise HTTPException(404, "Collaborator not found")
    await audit_event("owner", "user_deleted", {"username": username})
    return {"ok": True}

# ── Invite generation & direct email dispatch ────────────────────────────────

@router.post("/invite")
async def create_or_send_invite(req: InviteRequest, request: Request, owner: Dict = Depends(require_owner)):
    """Generate invite link and formatted email text, with optional direct SMTP sending."""
    store = get_collab_store()
    user = store.get_user(req.email)
    if not user:
        raise HTTPException(404, "Collaborator not found")

    pin_to_share = req.pin or "Set by administrator"
    invite_rec = store.create_invite(user.email, pin_to_share, user.permission, user.allowed_workspaces)

    host_header = request.headers.get("host", "localhost:8765")
    base_url = req.base_url or f"http://{host_header}"
    invite_url = f"{base_url}/login?email={user.email}&invite={invite_rec.code}"

    owner = store.get_owner() or {"name": "Host", "email": ""}
    text_data = store.generate_email_invite_text(
        user.email, invite_url, pin_to_share, owner.get("name", "Host"), owner.get("email", ""), user.permission
    )

    email_sent = False
    send_status = ""
    if req.send_email:
        email_sent, send_status = store.send_invite_email(
            user.email, invite_url, pin_to_share, owner.get("name", "Host"), owner.get("email", ""), user.permission
        )

    return {
        "invite_code": invite_rec.code,
        "invite_url": invite_url,
        "subject": text_data["subject"],
        "body": text_data["body"],
        "email_sent": email_sent,
        "send_status": send_status
    }

# ── Settings & SMTP ──────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings(request: Request, owner: Dict = Depends(require_owner)):
    store = get_collab_store()
    return store.get_settings()

@router.patch("/settings")
async def update_settings(req: SettingsRequest, request: Request, owner: Dict = Depends(require_owner)):
    store = get_collab_store()
    updated = {}
    if req.lan_access is not None:
        updated = store.set_lan_access(req.lan_access)
    if req.log_on_desktop is not None:
        updated = store.set_log_on_desktop(req.log_on_desktop)
    if req.signin_alerts is not None:
        updated = store.set_signin_alerts(req.signin_alerts)
    if req.visit_retention_days is not None:
        updated = store.set_visit_retention_days(req.visit_retention_days)
    if req.session_hours is not None:
        updated = store.set_session_hours(req.session_hours)
    if req.idle_minutes is not None:
        updated = store.set_idle_minutes(req.idle_minutes)
    safe_log = {k: v for k, v in (updated or {}).items() if k != "smtp"}
    await audit_event("owner", "settings_changed", safe_log)
    return updated or store.get_settings()

@router.post("/settings/smtp")
async def update_smtp(req: SmtpSettings, owner: Dict = Depends(require_owner)):
    """Update SMTP email delivery settings."""
    store = get_collab_store()
    updated = store.update_smtp_settings(req.model_dump())
    await audit_event("owner", "smtp_settings_updated", {"enabled": req.enabled, "host": req.host})
    return updated

@router.post("/settings/smtp/test")
async def test_smtp(target_email: str = Body(..., embed=True), owner: Dict = Depends(require_owner)):
    """Test SMTP connection by sending a test ping email."""
    store = get_collab_store()
    owner = store.get_owner() or {"name": "Host", "email": "host@local"}
    ok, msg = store.send_invite_email(
        target_email,
        "http://localhost:8765/login?test=1",
        "TEST-PIN",
        owner.get("name", "Host"),
        owner.get("email", ""),
        "worker"
    )
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg}

# ── Remote workspace & terminal access ───────────────────────────────────────

@router.get("/workspaces")
async def list_workspaces(user: Dict = Depends(require_collab_user)):
    """List workspaces the collab user can access."""
    store = get_collab_store()
    user_obj = store.get_user(user["username"])
    allowed = user_obj.allowed_workspaces if user_obj else []
    return {"allowed": allowed, "all_workspaces": len(allowed) == 0}

@router.post("/terminals/{tty}/command")
async def inject_command(tty: str, req: TerminalCommand, user: Dict = Depends(require_worker)):
    """Inject a command into a terminal (worker only)."""
    if req.workspace_id:
        store = get_collab_store()
        u = store.get_user(user["username"])
        if u and u.allowed_workspaces and req.workspace_id not in u.allowed_workspaces:
            raise HTTPException(403, "Not allowed in this workspace")

    try:
        from main import _remote_relay_send, _remote_rust_ttys, send_to_terminal_shell
        if tty in _remote_rust_ttys():
            ok = await _remote_relay_send("inject_command", tty=tty, command=req.command, task_id="")
            if not ok:
                raise HTTPException(500, "Relay unavailable")
        else:
            await send_to_terminal_shell(tty, req.command)

        await audit_command(user.get("email") or user["username"], req.workspace_id or "unknown", tty, req.command)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to inject command: {e}")

@router.post("/terminals/{tty}/input")
async def terminal_input(tty: str, data: str = Body(..., embed=True), user: Dict = Depends(require_worker)):
    """Send raw input to a sidecar PTY terminal."""
    from main import pty_sessions
    session = pty_sessions.get(tty)
    if not session or session.master_fd < 0:
        raise HTTPException(404, "Terminal not found or not a sidecar PTY")

    try:
        os.write(session.master_fd, data.encode("utf-8", "replace"))
        await audit_command(user.get("email") or user["username"], "sidecar", tty, data[:200])
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to write: {e}")

# ── Audit & Presence ─────────────────────────────────────────────────────────

@router.get("/audit/{username}")
async def get_audit(username: str, workspace_id: Optional[str] = None, lines: int = 200, request: Request = None, owner: Dict = Depends(require_owner)):
    """Get recent audit lines for a user."""
    store = get_collab_store()
    user_obj = store.get_user(username)
    if not user_obj:
        raise HTTPException(404, "User not found")

    path = AUDIT_DIR / f"{username}.jsonl"
    if not path.exists():
        return {"events": []}

    out = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                out.append(json.loads(line))
            except:
                pass

    if workspace_id:
        out = [e for e in out if e.get("ws") == workspace_id]

    return {"events": out[-lines:]}

@router.get("/audit/{username}/txt")
async def get_audit_txt(username: str, workspace_id: str, lines: int = 200, request: Request = None, owner: Dict = Depends(require_owner)):
    """Get human-readable .txt audit for a workspace."""
    path = pathlib.Path(workspace_id) / ".tto-collab" / f"{username}-{time.strftime('%Y-%m-%d')}.txt"
    if not path.exists():
        return {"lines": []}

    with path.open("r", encoding="utf-8") as f:
        all_lines = f.readlines()

    return {"lines": all_lines[-lines:]}

@router.get("/presence")
async def get_presence(request: Request, owner: Dict = Depends(require_owner)):
    """Who is signed in right now, and what they are doing."""
    store = get_collab_store()
    from visit_store import get_visit_store, sweep_from_settings
    try:
        sweep_from_settings()
    except Exception:
        pass
    store.sweep_expired_tokens()
    visits = get_visit_store()

    active = []
    for token, t in store._tokens.items():
        if t.is_valid():
            u = store.get_user(t.username)
            if u:
                visit = visits.active_visit_for(u.username) or {}
                active.append({
                    "username": u.username,
                    "email": u.email or u.username,
                    "name": u.name or u.username,
                    "permission": u.permission,
                    "token_prefix": token[:8],
                    "visit_id": visit.get("id"),
                    "current_activity": visit.get("current_activity") or "Signed in",
                    "ip": visit.get("ip") or "",
                    "browser": visit.get("browser") or "",
                    "os": visit.get("os") or "",
                    "device": visit.get("device") or "",
                    "signed_in_at": visit.get("signed_in_at"),
                    "last_seen_at": visit.get("last_seen_at"),
                })
    return {"users": active}


def _visit_filters(
    person: str = "",
    q: str = "",
    status: str = "",
    start: Optional[float] = None,
    end: Optional[float] = None,
) -> Dict[str, Any]:
    return {
        "person": person or "",
        "query": q or "",
        "status": status or "",
        "start": start,
        "end": end,
        "limit": 500,
    }


@router.get("/visits")
async def list_visits(
    person: str = "",
    q: str = "",
    status: str = "",
    start: Optional[float] = None,
    end: Optional[float] = None,
    owner: Dict = Depends(require_owner),
):
    """Current and past collaborator visits, plus failed sign-ins when asked."""
    from visit_store import get_visit_store, sweep_from_settings
    try:
        sweep_from_settings()
    except Exception:
        pass
    visits = get_visit_store().list_visits(**_visit_filters(person, q, status, start, end))
    return {"visits": visits}


@router.get("/visits/export")
async def export_visits(
    format: str = Query("csv", pattern="^(csv|html|pdf)$"),
    person: str = "",
    q: str = "",
    status: str = "",
    start: Optional[float] = None,
    end: Optional[float] = None,
    id: Optional[str] = None,
    owner: Dict = Depends(require_owner),
):
    """Download one visit, or the current filter, as CSV, HTML, or PDF."""
    from visit_store import get_visit_store
    store = get_visit_store()
    if id:
        rows = store.collect_for_export([item for item in id.split(",") if item])
    else:
        rows = store.collect_for_export(**_visit_filters(person, q, status, start, end))
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if format == "html":
        html = store.export_html(rows)
        return HTMLResponse(html, headers={"Content-Disposition": f'attachment; filename="visitor-records-{stamp}.html"'})
    if format == "pdf":
        pdf = store.export_pdf(rows)
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="visitor-records-{stamp}.pdf"'},
        )
    csv_text = store.export_csv(rows)
    return PlainTextResponse(
        "\ufeff" + csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="visitor-records-{stamp}.csv"'},
    )


@router.get("/visits/{visit_id}")
async def get_visit(visit_id: str, owner: Dict = Depends(require_owner)):
    from visit_store import get_visit_store
    visit = get_visit_store().get_visit(visit_id)
    if not visit:
        raise HTTPException(404, "Visit not found")
    return {"visit": visit}


@router.post("/visits/{visit_id}/end")
async def end_visit(visit_id: str, owner: Dict = Depends(require_owner)):
    """Force-end an active visit and its sign-in."""
    from visit_store import get_visit_store
    visits = get_visit_store()
    current = visits.get_visit(visit_id)
    if not current or current.get("kind") != "visit":
        raise HTTPException(404, "Visit not found")
    if current.get("status") == "active":
        get_collab_store().revoke_token_prefix(current.get("username") or "", current.get("token_prefix") or "")
        current = visits.close_visit(visit_id, "revoked") or current
    return {"ok": True, "visit": current}


@router.get("/access")
async def access_info(owner: Dict = Depends(require_owner)):
    """LAN addresses and the optional public HTTPS link."""
    from tunnel import access_snapshot
    store = get_collab_store()
    snap = access_snapshot(store.is_lan_allowed())
    settings = store.get_settings()
    snap["signin_alerts"] = bool(settings.get("signin_alerts"))
    snap["visit_retention_days"] = store.retention_days()
    snap["session_hours"] = int(settings.get("session_hours") or 168)
    snap["idle_minutes"] = int(settings.get("idle_minutes") or 30)
    return snap


@router.post("/tunnel")
async def set_public_tunnel(req: TunnelRequest, owner: Dict = Depends(require_owner)):
    """Turn the opt-in HTTPS public link on or off."""
    from tunnel import get_tunnel_manager, sidecar_port
    manager = get_tunnel_manager()
    if req.enabled:
        status = manager.start(port=sidecar_port())
        if not status.get("running"):
            raise HTTPException(400, status.get("error") or "Could not start the public link")
        return status
    return manager.stop()
