"""Nero recall API. Mounted beside the project registry. A failure here
must not break sidecar boot — main.py wraps the import.
"""
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from neurocity_store import ingest_project_plan, recall, record_episode
except ImportError:  # packaged as backend.*
    from backend.neurocity_store import ingest_project_plan, recall, record_episode

try:
    from routers import projects as projects_mod
except ImportError:
    from backend.routers import projects as projects_mod

router = APIRouter(prefix="/api/neurocity", tags=["neurocity"])


class RecordIn(BaseModel):
    project_id: str
    source: str
    summary: str = ""
    cwd: Optional[str] = None
    floor_folder: Optional[str] = None
    floor_index: Optional[int] = None
    terminal_id: Optional[str] = None
    task_id: Optional[str] = None
    task_status: Optional[str] = None
    commit_sha: Optional[str] = None
    path: Optional[str] = None
    ts: Optional[int] = None


def _project_or_404(project_id: str) -> Dict[str, Any]:
    project = projects_mod.project_record(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    return project


@router.post("/record")
def record(body: RecordIn) -> Dict[str, Any]:
    """Store one real episode. Summary is capped. PTY output is not accepted."""
    if body.source not in ("git_commit", "terminal_task"):
        raise HTTPException(400, "source must be git_commit or terminal_task")
    project = _project_or_404(body.project_id)
    return record_episode(project, body.model_dump())


@router.post("/sync/{project_id}")
def sync_project(project_id: str) -> Dict[str, Any]:
    """Refresh floor nodes and commits newer than the stored cursor."""
    project = _project_or_404(project_id)
    try:
        from project_scanner import scan_project
    except ImportError:
        from backend.project_scanner import scan_project
    path = project.get("path") or ""
    # scan_project falls back to the process cwd when the path is missing.
    # That would write this repo into the wrong building.
    if not path or not os.path.isdir(path):
        raise HTTPException(404, "project path not found")
    plan = scan_project(path)
    counts = ingest_project_plan(project, plan)
    return {"ok": True, **counts}


@router.get("/geodesic-recall")
def geodesic_recall(
    project_id: str,
    floor_index: Optional[int] = None,
    q: str = "",
    limit: int = 5,
    days: int = 30,
) -> Dict[str, Any]:
    """Top episodes near this building floor. Empty graph returns hits: []."""
    if limit < 1 or limit > 20:
        raise HTTPException(400, "limit must be 1..20")
    if days < 1 or days > 3650:
        raise HTTPException(400, "days out of range")
    project = _project_or_404(project_id)
    hits = recall(project, floor_index=floor_index, query=q, limit=limit, days=days)
    return {"hits": hits}


def ingest_scanned_plan(project: Dict[str, Any], plan: Dict[str, Any]) -> None:
    """Called from the floor-plan route. Swallows nothing; the caller guards it."""
    ingest_project_plan(project, plan)
