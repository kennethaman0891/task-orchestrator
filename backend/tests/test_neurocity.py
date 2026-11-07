"""Nero spatial memory tests.

Run: `python backend/tests/test_neurocity.py`
The 100k case stays off unless NEUROCITY_SLOW=1.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

_ROOT = Path(tempfile.mkdtemp(prefix="neurocity-test-"))
os.environ["NEUROCITY_DB"] = str(_ROOT / "graph.db")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from neurocity_store import episode_count, ingest_project_plan, last_examined, db_path
from routers import neurocity as neuro_mod
from routers import projects as proj_mod


_SEEDED = []


def _reset_db() -> None:
    path = db_path()
    for candidate in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm")):
        if candidate.exists():
            candidate.unlink()


def _seed(pid: str, plot: dict, path: str = "") -> dict:
    record = {
        "id": pid,
        "name": pid,
        "path": path,
        "type": "custom",
        "plot": plot,
        "floors": [],
        "building": {},
    }
    proj_mod._projects[pid] = record
    _SEEDED.append(pid)
    return record


def _cleanup_projects() -> None:
    for pid in _SEEDED:
        proj_mod._projects.pop(pid, None)
    _SEEDED.clear()


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(neuro_mod.router)
    return TestClient(app)


def _floors() -> dict:
    return {
        "floors": [
            {"index": 0, "name": "Frontend", "folder": "frontend", "objects": []},
            {"index": 1, "name": "Backend", "folder": "backend", "objects": []},
            {"index": 2, "name": "Docs", "folder": "docs", "objects": []},
        ]
    }


def test_dedupe_and_routes() -> None:
    _reset_db()
    _seed("proj-a", {"x": 0, "y": 0}, path="/tmp/neurocity-missing-a")
    client = _client()
    body = {
        "project_id": "proj-a",
        "source": "git_commit",
        "summary": "fix auth",
        "commit_sha": "abc123",
        "floor_folder": "docs",
    }
    first = client.post("/api/neurocity/record", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["created"] is True
    second = client.post("/api/neurocity/record", json=body)
    assert second.status_code == 200, second.text
    assert second.json()["created"] is False
    assert episode_count() == 1

    missing = client.post("/api/neurocity/record", json={**body, "project_id": "missing"})
    assert missing.status_code == 404
    assert client.get("/api/neurocity/geodesic-recall", params={"project_id": "missing"}).status_code == 404


def test_empty_recall() -> None:
    _reset_db()
    _seed("proj-empty", {"x": 1, "y": 1})
    client = _client()
    res = client.get("/api/neurocity/geodesic-recall", params={"project_id": "proj-empty", "floor_index": 2})
    assert res.status_code == 200, res.text
    assert res.json()["hits"] == []


def test_recall_prefers_same_floor() -> None:
    _reset_db()
    near = _seed("proj-near", {"x": 0, "y": 0}, path="/tmp/neurocity-missing-near")
    far = _seed("proj-far", {"x": 7, "y": 7}, path="/tmp/neurocity-missing-far")
    ingest_project_plan(near, _floors())
    ingest_project_plan(far, _floors())
    client = _client()
    local = client.post("/api/neurocity/record", json={
        "project_id": "proj-near",
        "source": "git_commit",
        "summary": "note",
        "commit_sha": "local-sha",
        "floor_folder": "docs",
    })
    assert local.status_code == 200, local.text
    other = client.post("/api/neurocity/record", json={
        "project_id": "proj-far",
        "source": "git_commit",
        "summary": "auth route bug fix docs",
        "commit_sha": "far-sha",
        "floor_folder": "docs",
    })
    assert other.status_code == 200, other.text
    res = client.get("/api/neurocity/geodesic-recall", params={
        "project_id": "proj-near",
        "floor_index": 2,
        "q": "auth route bug fix docs",
        "limit": 5,
    })
    assert res.status_code == 200, res.text
    hits = res.json()["hits"]
    assert len(hits) >= 2
    assert hits[0]["id"] == local.json()["id"]
    assert hits[0]["score"] > hits[1]["score"]
    assert hits[0]["floor_index"] == 2


def test_thirty_day_window() -> None:
    _reset_db()
    _seed("proj-time", {"x": 2, "y": 2}, path="/tmp/neurocity-missing-time")
    client = _client()
    old_ts = int(time.time()) - 40 * 86400
    recent = client.post("/api/neurocity/record", json={
        "project_id": "proj-time",
        "source": "terminal_task",
        "summary": "recent task",
        "terminal_id": "tty1",
        "task_id": "task-new",
        "task_status": "running",
    })
    old = client.post("/api/neurocity/record", json={
        "project_id": "proj-time",
        "source": "terminal_task",
        "summary": "stale task",
        "terminal_id": "tty1",
        "task_id": "task-old",
        "task_status": "done",
        "ts": old_ts,
    })
    assert recent.status_code == 200 and old.status_code == 200
    res = client.get("/api/neurocity/geodesic-recall", params={
        "project_id": "proj-time",
        "days": 30,
    })
    ids = [hit["id"] for hit in res.json()["hits"]]
    assert recent.json()["id"] in ids
    assert old.json()["id"] not in ids


def test_git_sync_is_incremental() -> None:
    _reset_db()
    repo = Path(tempfile.mkdtemp(prefix="neurocity-repo-"))
    try:
        subprocess.check_call(["git", "init"], cwd=repo, stdout=subprocess.DEVNULL)
        subprocess.check_call(["git", "config", "user.email", "nero@test"], cwd=repo)
        subprocess.check_call(["git", "config", "user.name", "nero"], cwd=repo)
        docs = repo / "docs"
        docs.mkdir()
        (docs / "a.txt").write_text("hello\n")
        subprocess.check_call(["git", "add", "docs/a.txt"], cwd=repo)
        subprocess.check_call(["git", "commit", "-m", "add docs note"], cwd=repo, stdout=subprocess.DEVNULL)
        project = _seed("proj-git", {"x": 3, "y": 1}, path=str(repo))
        first = ingest_project_plan(project, _floors())
        assert first["commits_added"] == 1
        assert first["floors"] == 3
        second = ingest_project_plan(project, _floors())
        assert second["commits_added"] == 0
        assert episode_count() == 1
        client = _client()
        res = client.get("/api/neurocity/geodesic-recall", params={
            "project_id": "proj-git",
            "floor_index": 2,
            "q": "docs note",
        })
        hits = res.json()["hits"]
        assert hits and hits[0]["source"] == "git_commit"
        assert hits[0]["floor_index"] == 2
    finally:
        shutil.rmtree(repo, ignore_errors=True)


def test_slow_hundred_k() -> None:
    if os.environ.get("NEUROCITY_SLOW") != "1":
        print("skip 100k (set NEUROCITY_SLOW=1)")
        return
    import resource
    _reset_db()
    project = _seed("proj-bulk", {"x": 0, "y": 0})
    ingest_project_plan(project, _floors())
    from neurocity_store import session
    now = int(time.time())
    with session() as conn:
        conn.executemany(
            """
            INSERT INTO episodes
                (id, node_id, project_id, ts, source, summary, tokens, dedupe_key, floor_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    f"ep-bulk-{i}", f"ep-bulk-{i}", "proj-other", now,
                    "git_commit", "bulk", "bulk", f"dedupe-{i}", 0,
                )
                for i in range(100_000)
            ],
        )
    client = _client()
    res = client.get("/api/neurocity/geodesic-recall", params={"project_id": "proj-bulk", "limit": 5})
    assert res.status_code == 200
    assert last_examined() < 1000
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_mb = rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024
    assert rss_mb < 200, rss_mb


def main() -> int:
    try:
        test_dedupe_and_routes()
        test_empty_recall()
        test_recall_prefers_same_floor()
        test_thirty_day_window()
        test_git_sync_is_incremental()
        test_slow_hundred_k()
    finally:
        _cleanup_projects()
    print("ALL NEUROCITY TESTS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
