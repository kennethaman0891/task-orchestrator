"""Tests for the Developer City project registry (backend/routers/projects.py).

Run with the backend's own interpreter: `python -m pytest backend/tests/test_projects.py`
or standalone: `python backend/tests/test_projects.py`.
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import projects as proj_mod


def build_client() -> TestClient:
    app = FastAPI()
    app.include_router(proj_mod.router)
    calls = []
    proj_mod.set_broadcaster(lambda m: calls.append(m))
    return TestClient(app)


def main() -> int:
    client = build_client()

    # meta endpoint
    r = client.get("/api/projects/__meta")
    assert r.status_code == 200, r.text
    meta = r.json()
    assert meta["grid_size"] == 8 and len(meta["themes"]) == 8

    # create
    r = client.post("/api/projects", json={"name": "Test College", "type": "college", "path": "/tmp/x"})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["floors"] == ["Frontend", "Backend", "CMS", "Database", "SEO", "Maintenance"]
    assert p["plot"]["x"] in range(8) and p["plot"]["y"] in range(8)
    assert p["building"]["buildingStyle"] == "college"

    # bad type rejected
    r = client.post("/api/projects", json={"name": "x", "type": "nope"})
    assert r.status_code == 400

    # list + get
    r = client.get("/api/projects")
    assert any(q["id"] == p["id"] for q in r.json()["projects"])
    assert client.get(f"/api/projects/{p['id']}").status_code == 200
    assert client.get("/api/projects/missing-id").status_code == 404

    # patch building config + floors
    r = client.patch(f"/api/projects/{p['id']}", json={
        "building": {"theme": "neon", "primaryColor": "#ff0080"},
        "floors": ["Frontend", "Database"],
        "health": "healthy",
    })
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["building"]["theme"] == "neon"
    assert got["building"]["primaryColor"] == "#ff0080"
    assert got["building"]["buildingStyle"] == "college"  # preserved on merge
    assert got["floors"] == ["Frontend", "Database"]
    assert got["health"] == "healthy"

    # snapshot
    r = client.post(f"/api/projects/{p['id']}/agent-snapshot",
                    json={"agents": [{"name": "claude", "status": "working"}]})
    assert r.status_code == 200

    # floor plan scan
    r = client.get(f"/api/projects/{p['id']}/floor-plan")
    assert r.status_code == 200
    plan = r.json()
    assert "floors" in plan
    assert len(plan["floors"]) > 0

    # custom scan endpoint
    r = client.post("/api/projects/scan-floor-plan", json={"path": str(BACKEND.parent)})
    assert r.status_code == 200
    cplan = r.json()
    assert "floors" in cplan
    assert any(f["category"] == "frontend" for f in cplan["floors"])

    # delete + 404 after
    assert client.delete(f"/api/projects/{p['id']}").status_code == 200
    assert client.get(f"/api/projects/{p['id']}").status_code == 404

    print("ALL PROJECT REGISTRY TESTS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
