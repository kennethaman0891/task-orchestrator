#!/usr/bin/env python3
"""Projects registry for the Developer City (TTO 3D layer).

A project is a first-class record: every website/app the user maintains gets
its own entry, its own city plot, and its own building configuration. The
registry is the single source of truth for the 3D city — nothing in the
frontend hard-codes projects.

Storage: JSON file at backend/data/projects.json (loaded at import, written
through an in-memory copy on every mutation). The frontend receives
`projects_changed` messages over the existing /ws dashboard channel.
"""
import asyncio
import json
import os
import time
import inspect
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/projects", tags=["projects"])

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"

# ── City grid geometry (must match the frontend CityGrid) ───────────────────
GRID_SIZE = 8          # 8 x 8 plots
GRID_SPACING = 14.0    # world units between plot centres

PROJECT_TYPES = [
    "college", "ecommerce", "business", "portfolio", "saas", "custom",
]

DEFAULT_FLOORS: Dict[str, List[str]] = {
    "college":     ["Frontend", "Backend", "CMS", "Database", "SEO", "Maintenance"],
    "ecommerce":   ["Storefront", "Products", "Orders", "Payments", "Database", "Deployment", "AI Agents"],
    "business":    ["Frontend", "Backend", "Database", "Deployment", "SEO", "Maintenance"],
    "portfolio":   ["Work", "About", "CMS", "Deployment"],
    "saas":        ["Frontend", "API", "Database", "AI Agents", "Deployment", "Infrastructure"],
    "custom":      ["Frontend", "Backend", "Database", "Deployment", "Testing", "Maintenance"],
}

THEME_IDS = ["midnight", "neon", "sandstone", "glass", "forest", "mono", "sunset", "ice"]


def default_building(p_type: str) -> Dict[str, Any]:
    """Default building config generated from the project type.

    A project must never be visually empty: archetype + theme + default
    colors come from the type. Brand colors are layered on top later.
    """
    return {
        "buildingStyle": p_type if p_type in PROJECT_TYPES else "custom",
        "theme": THEME_IDS[0],
        "primaryColor": None,
        "secondaryColor": None,
        "accentColor": None,
        "brandColors": None,
        "logo": None,
        "texture": None,
        "scale": 1.0,
        "rotation": 0.0,
        "themeIndex": 0,
        "customModel3d": None,
    }


def default_record() -> Dict[str, Any]:
    return {
        "id": "proj-" + uuid.uuid4().hex[:10],
        "name": "New Project",
        "path": "",
        "type": "custom",
        "status": "active",
        "health": "unknown",
        "logo": None,
        "screenshot": None,
        "deploy": None,
        "floors": list(DEFAULT_FLOORS["custom"]),
        "building": default_building("custom"),
        "plot": None,
        "agent_snapshot": None,
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
    }


# ── In-memory store + persistence ────────────────────────────────────────────
_lock = asyncio.Lock()
_projects: Dict[str, Dict[str, Any]] = {}


def _load() -> None:
    global _projects
    if PROJECTS_FILE.exists():
        try:
            raw = json.loads(PROJECTS_FILE.read_text())
            _projects = raw.get("projects", {})
        except Exception:
            _projects = {}
    else:
        _projects = {}
    # Backfill plot assignments for pre-existing records.
    _assign_missing_plots()


def _save() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = PROJECTS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"projects": _projects}, indent=1))
    os.replace(str(tmp), str(PROJECTS_FILE))


def _next_free_slot(occupied: set) -> Dict[str, int]:
    for y in range(GRID_SIZE):
        for x in range(GRID_SIZE):
            if (x, y) not in occupied:
                return {"x": x, "y": y}
    # Grid full — keep stacking outside the nominal grid (city can grow).
    return {"x": 0, "y": GRID_SIZE + 1}


def _assign_missing_plots() -> None:
    occupied = set()
    for p in _projects.values():
        if p.get("plot"):
            occupied.add((p["plot"]["x"], p["plot"]["y"]))
    for p in _projects.values():
        if not p.get("plot"):
            slot = _next_free_slot(occupied)
            p["plot"] = slot
            occupied.add((slot["x"], slot["y"]))


# ── Change broadcast (wired by main.py after router mount) ──────────────────
_broadcaster = None


def set_broadcaster(fn) -> None:
    """main.py passes `manager.broadcast_to_dashboards` here. Keeps this
    module importable/testable without the whole app."""
    global _broadcaster
    _broadcaster = fn


async def _broadcast(action: str, project_id: Optional[str] = None) -> None:
    if _broadcaster is None:
        return
    res = _broadcaster({
        "type": "projects_changed",
        "action": action,
        "project_id": project_id,
        "ts": int(time.time()),
    })
    if inspect.isawaitable(res):
        await res


_load()


# ── Request models ────────────────────────────────────────────────────────────
class ProjectIn(BaseModel):
    name: str = "New Project"
    path: str = ""
    type: str = "custom"
    status: str = "active"
    health: Optional[str] = "unknown"
    logo: Optional[str] = None
    screenshot: Optional[str] = None
    deploy: Optional[Dict[str, Any]] = None
    floors: Optional[List[str]] = None
    building: Optional[Dict[str, Any]] = None
    plot: Optional[Dict[str, int]] = None


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    path: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None
    health: Optional[str] = None
    logo: Optional[str] = None
    screenshot: Optional[str] = None
    deploy: Optional[Dict[str, Any]] = None
    floors: Optional[List[str]] = None
    building: Optional[Dict[str, Any]] = None
    plot: Optional[Dict[str, int]] = None
    agent_snapshot: Optional[Dict[str, Any]] = None


@router.get("")
async def list_projects() -> Dict[str, Any]:
    return {"projects": list(_projects.values())}


# ── City grid constants (shared contract with the frontend) ─────────────────
# NOTE: registered BEFORE the /{project_id} routes so it is not swallowed.
@router.get("/__meta")
async def city_meta() -> Dict[str, Any]:
    return {
        "grid_size": GRID_SIZE,
        "grid_spacing": GRID_SPACING,
        "project_types": PROJECT_TYPES,
        "default_floors": DEFAULT_FLOORS,
        "themes": THEME_IDS,
    }


@router.get("/{project_id}")
async def get_project(project_id: str) -> Dict[str, Any]:
    p = _projects.get(project_id)
    if p is None:
        raise HTTPException(404, "project not found")
    return p


@router.post("")
async def create_project(body: ProjectIn) -> Dict[str, Any]:
    if body.type not in PROJECT_TYPES:
        raise HTTPException(400, f"type must be one of {PROJECT_TYPES}")
    async with _lock:
        rec = default_record()
        rec["id"] = "proj-" + uuid.uuid4().hex[:10]
        rec["name"] = body.name or rec["name"]
        rec["path"] = body.path
        rec["type"] = body.type
        rec["status"] = body.status
        rec["health"] = body.health or "unknown"
        rec["logo"] = body.logo
        rec["screenshot"] = body.screenshot
        rec["deploy"] = body.deploy
        rec["floors"] = list(body.floors) if body.floors else list(DEFAULT_FLOORS.get(body.type, DEFAULT_FLOORS["custom"]))
        rec["building"] = default_building(body.type)
        if body.building:
            rec["building"] = {**rec["building"], **body.building}
        if body.plot:
            rec["plot"] = {"x": int(body.plot.get("x", 0)), "y": int(body.plot.get("y", 0))}
        else:
            occupied = {(q["plot"]["x"], q["plot"]["y"]) for q in _projects.values() if q.get("plot")}
            rec["plot"] = _next_free_slot(occupied)
        _projects[rec["id"]] = rec
        _save()
    await _broadcast("created", rec["id"])
    return rec


@router.patch("/{project_id}")
async def patch_project(project_id: str, body: ProjectPatch) -> Dict[str, Any]:
    async with _lock:
        p = _projects.get(project_id)
        if p is None:
            raise HTTPException(404, "project not found")
        data = body.model_dump(exclude_unset=True)
        if "type" in data and data["type"] is not None and data["type"] not in PROJECT_TYPES:
            raise HTTPException(400, f"type must be one of {PROJECT_TYPES}")
        if "building" in data and data["building"] is not None:
            p["building"] = {**p.get("building", default_building(p.get("type", "custom"))), **data.pop("building")}
        if "plot" in data and data["plot"] is not None:
            data["plot"] = {"x": int(data["plot"].get("x", 0)), "y": int(data["plot"].get("y", 0))}
        for k, v in data.items():
            p[k] = v
        p["updated_at"] = int(time.time())
        _save()
    await _broadcast("updated", project_id)
    return p


@router.delete("/{project_id}")
async def delete_project(project_id: str) -> Dict[str, Any]:
    async with _lock:
        p = _projects.pop(project_id, None)
        if p is None:
            raise HTTPException(404, "project not found")
        _save()
    await _broadcast("deleted", project_id)
    return {"ok": True, "id": project_id}


@router.post("/{project_id}/agent-snapshot")
async def save_agent_snapshot(project_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """Persist the last-known agent set for a building (recovery/persistence)."""
    async with _lock:
        p = _projects.get(project_id)
        if p is None:
            raise HTTPException(404, "project not found")
        p["agent_snapshot"] = body
        p["updated_at"] = int(time.time())
        _save()
    await _broadcast("snapshot", project_id)
    return {"ok": True, "id": project_id}


