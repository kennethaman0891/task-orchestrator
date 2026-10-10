# backend/routers/collab.py — Collab endpoints
import os, json, time, pathlib, secrets
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Request, WebSocket, Depends, Body, Query
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

class TerminalCommand(BaseModel):
    command: str
    workspace_id: Optional[str] = None

def get_client_ip(request: Request) -> str:
    """Get client IP, handling proxies."""
    if request.client:
        return request.client.host
    return "unknown"

def is_loopback(ip: str) -> bool:
    return ip in ("127.0.0.1", "::1", "localhost")

# Dependency: get collab user from token (for authenticated endpoints)
async def get_collab_user(request: Request):
    """Validate token from Authorization header or query param.
    Returns None if not authenticated or invalid.
    """
    auth = request.headers.get("Authorization", "")
    token = None
    if auth.startswith("Bearer "):
        token = auth[7:]
    else:
        token = request.query_params.get("token")
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

# ── Owner Account endpoints ──────────────────────────────────────────────────

@router.get("/owner")
async def get_owner():
    """Fetch current host/owner account profile."""
    store = get_collab_store()
    return {"owner": store.get_owner()}

@router.post("/owner")
async def set_owner(req: OwnerProfileRequest):
    """Create or update host/owner master profile."""
    store = get_collab_store()
    owner_dict = store.set_owner(req.email, req.name, req.instance_name or "", req.tagline or "", req.plan or "pro")
    await audit_event("owner", "owner_profile_updated", {"email": req.email, "name": req.name, "plan": req.plan})
    return {"owner": owner_dict}

@router.post("/owner/plan")
async def update_plan(req: PlanUpdateRequest):
    """Update active subscription plan (paid, pro, plus)."""
    store = get_collab_store()
    owner_dict = store.set_owner_plan(req.plan)
    await audit_event("owner", "owner_plan_updated", {"plan": req.plan})
    return {"owner": owner_dict, "plan": req.plan}

# ── Auth & Session endpoints ─────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, request: Request):
    """Login with Email/Username + PIN or Magic Invite Code."""
    from collections import defaultdict
    if not hasattr(login, '_failed_attempts'):
        login._failed_attempts = defaultdict(list)

    store = get_collab_store()
    ip = get_client_ip(request)
    identifier = (req.email or req.username or req.invite_code or "").strip()
    key = f"{ip}:{identifier}"
    now = time.time()

    # Rate limiting: max 5 failed attempts per 5 minutes per IP+identifier
    login._failed_attempts[key] = [
        t for t in login._failed_attempts[key]
        if now - t < 300
    ]

    if len(login._failed_attempts[key]) >= 5:
        await audit_event(identifier, "login_failed", {
            "reason": "rate_limited",
            "ip": ip,
            "attempts": len(login._failed_attempts[key])
        })
        raise HTTPException(429, "Too many login attempts. Please try again later.")

    # 1. Magic invite code login path
    if req.invite_code:
        inv = store.consume_invite(req.invite_code)
        if not inv:
            login._failed_attempts[key].append(now)
            await audit_event("invite", "login_failed", {"reason": "invalid_or_expired_invite", "ip": ip})
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

        token = store.create_token(user.username)
        if not token:
            raise HTTPException(500, "Failed to create session token")

        store.record_login(user.username)
        await audit_login(user.email or user.username, token[:8])
        if key in login._failed_attempts:
            del login._failed_attempts[key]

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
        await audit_event(identifier, "login_failed", {"reason": "user_not_found", "ip": ip})
        raise HTTPException(401, "Invalid email or PIN")

    if not req.pin or not user.check_pin(req.pin):
        login._failed_attempts[key].append(now)
        await audit_event(user.email or user.username, "login_failed", {"reason": "bad_pin", "ip": ip})
        raise HTTPException(401, "Invalid email or PIN")

    if key in login._failed_attempts:
        del login._failed_attempts[key]

    token = store.create_token(user.username)
    if not token:
        raise HTTPException(500, "Failed to create session token")

    store.record_login(user.username)
    await audit_login(user.email or user.username, token[:8])

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
async def logout(user: Dict = Depends(require_collab_user)):
    """Revoke current collaborator token."""
    store = get_collab_store()
    store.revoke_user_tokens(user["username"])
    await audit_logout(user.get("email") or user["username"])
    return {"ok": True}

# ── User management (owner only) ─────────────────────────────────────────────

@router.get("/users")
async def list_users(request: Request):
    """List all registered collaborators (owner view)."""
    store = get_collab_store()
    return {"users": [u.to_safe_dict() for u in store.list_users()]}

@router.post("/users")
async def create_user(req: UserCreate, request: Request):
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
async def update_user(username: str, req: UserUpdate, request: Request):
    store = get_collab_store()
    user = store.update_user(username, **{k: v for k, v in req.model_dump().items() if v is not None})
    if not user:
        raise HTTPException(404, "Collaborator not found")
    await audit_event("owner", "user_updated", {"username": username, **req.model_dump(exclude_none=True)})
    return user.to_safe_dict()

@router.post("/users/{username}/pin")
async def change_pin(username: str, req: PinChange, request: Request):
    store = get_collab_store()
    user = store.set_pin(username, req.new_pin)
    if not user:
        raise HTTPException(404, "Collaborator not found")
    await audit_event("owner", "pin_changed", {"username": username})
    return {"ok": True}

@router.post("/users/{username}/revoke")
async def revoke_user(username: str, request: Request):
    store = get_collab_store()
    if not store.revoke_user(username):
        raise HTTPException(404, "Collaborator not found")
    await audit_event("owner", "user_revoked", {"username": username})
    return {"ok": True}

@router.delete("/users/{username}")
async def delete_user(username: str, request: Request):
    store = get_collab_store()
    if not store.delete_user(username):
        raise HTTPException(404, "Collaborator not found")
    await audit_event("owner", "user_deleted", {"username": username})
    return {"ok": True}

# ── Invite generation & direct email dispatch ────────────────────────────────

@router.post("/invite")
async def create_or_send_invite(req: InviteRequest, request: Request):
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
async def get_settings(request: Request):
    store = get_collab_store()
    return store.get_settings()

@router.patch("/settings")
async def update_settings(req: SettingsRequest, request: Request):
    store = get_collab_store()
    updated = {}
    if req.lan_access is not None:
        updated.update(store.set_lan_access(req.lan_access))
    if req.log_on_desktop is not None:
        updated.update(store.set_log_on_desktop(req.log_on_desktop))
    await audit_event("owner", "settings_changed", updated)
    return updated

@router.post("/settings/smtp")
async def update_smtp(req: SmtpSettings):
    """Update SMTP email delivery settings."""
    store = get_collab_store()
    updated = store.update_smtp_settings(req.model_dump())
    await audit_event("owner", "smtp_settings_updated", {"enabled": req.enabled, "host": req.host})
    return updated

@router.post("/settings/smtp/test")
async def test_smtp(target_email: str = Body(..., embed=True)):
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
async def get_audit(username: str, workspace_id: Optional[str] = None, lines: int = 200, request: Request = None):
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
async def get_audit_txt(username: str, workspace_id: str, lines: int = 200, request: Request = None):
    """Get human-readable .txt audit for a workspace."""
    path = pathlib.Path(workspace_id) / ".tto-collab" / f"{username}-{time.strftime('%Y-%m-%d')}.txt"
    if not path.exists():
        return {"lines": []}

    with path.open("r", encoding="utf-8") as f:
        all_lines = f.readlines()

    return {"lines": all_lines[-lines:]}

@router.get("/presence")
async def get_presence(request: Request):
    """Get currently online collab users (owner view)."""
    store = get_collab_store()
    store.sweep_expired_tokens()

    active = []
    for token, t in store._tokens.items():
        if t.is_valid():
            u = store.get_user(t.username)
            if u:
                active.append({
                    "username": u.username,
                    "email": u.email or u.username,
                    "name": u.name or u.username,
                    "permission": u.permission,
                    "token_prefix": token[:8],
                })
    return {"users": active}
