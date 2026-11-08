"""Nero spatial memory: a SQLite graph keyed by Developer City coordinates.

World x/z match CityGrid.plotWorldPosition. Height y is the scanned floor
index. Episodes are git commits and terminal task titles. Queries stay in
SQL; this module never loads the full graph into Python.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import sqlite3
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

GRID_SIZE = 8
GRID_SPACING = 14.0
SPAN_XZ = (GRID_SIZE - 1) * GRID_SPACING
SPAN_Y = 8.0
ALPHA = 0.6
MAX_CANDIDATES = 200
WALK_HOPS = 3
WALK_CAP = 500
GIT_LIMIT = 40
SUMMARY_CAP = 500

_last_examined = 0


def db_path() -> Path:
    override = os.environ.get("NEUROCITY_DB")
    if override:
        return Path(override)
    return Path.home() / ".tto-web" / "neurocity_graph.db"


def last_examined() -> int:
    """Rows the last recall loaded into Python. Tests use this as a cap check."""
    return _last_examined


def plot_world(plot_x: int, plot_y: int) -> tuple:
    """Match frontend/src/city/scene/CityGrid.tsx plotWorldPosition."""
    half = ((GRID_SIZE - 1) * GRID_SPACING) / 2
    return (plot_x * GRID_SPACING - half, 0.0, plot_y * GRID_SPACING - half)


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(conn)
    return conn


@contextmanager
def session() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            project_id TEXT NOT NULL,
            label TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS spatial (
            node_id TEXT PRIMARY KEY,
            x REAL NOT NULL,
            y REAL NOT NULL,
            z REAL NOT NULL,
            plot_x INTEGER NOT NULL,
            plot_y INTEGER NOT NULL,
            floor_index INTEGER
        );
        CREATE TABLE IF NOT EXISTS edges (
            src TEXT NOT NULL,
            dst TEXT NOT NULL,
            rel TEXT NOT NULL,
            PRIMARY KEY (src, dst, rel)
        );
        CREATE TABLE IF NOT EXISTS episodes (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            ts INTEGER NOT NULL,
            source TEXT NOT NULL,
            summary TEXT NOT NULL,
            tokens TEXT NOT NULL,
            dedupe_key TEXT NOT NULL UNIQUE,
            floor_index INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_episodes_proj_ts
            ON episodes(project_id, ts);
        CREATE TABLE IF NOT EXISTS cursors (
            project_id TEXT PRIMARY KEY,
            last_sha TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        """
    )


def _plot(project: Dict[str, Any]) -> tuple:
    plot = project.get("plot") or {}
    try:
        return int(plot.get("x", 0)), int(plot.get("y", 0))
    except (TypeError, ValueError):
        return 0, 0


def _json(obj: Dict[str, Any]) -> str:
    import json
    return json.dumps(obj, separators=(",", ":"))


def clean_summary(text: str) -> str:
    flat = " ".join((text or "").split())
    flat = re.sub(
        r"(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*\S+",
        r"\1=[redacted]",
        flat,
    )
    return flat[:SUMMARY_CAP]


def tokenize(*parts: str) -> str:
    words = set()
    for part in parts:
        if not part:
            continue
        for word in re.findall(r"[a-z0-9]+", part.lower()):
            if len(word) > 1:
                words.add(word)
    return " ".join(sorted(words))


def token_overlap(query: str, stored: str) -> float:
    q = set(tokenize(query).split())
    if not q:
        return 0.0
    s = set(tokenize(stored).split())
    return len(q & s) / len(q)


def closeness(ax: float, ay: float, az: float, bx: float, by: float, bz: float) -> tuple:
    """Normalized distance and inverted closeness in [0, 1]."""
    dx = (ax - bx) / SPAN_XZ
    dy = (ay - by) / SPAN_Y
    dz = (az - bz) / SPAN_XZ
    dist = math.sqrt(dx * dx + dy * dy + dz * dz)
    close = max(0.0, 1.0 - dist / math.sqrt(2.0))
    return dist, close


def relative_to_project(project_path: str, cwd: str) -> Optional[str]:
    base = (project_path or "").replace("\\", "/").rstrip("/")
    here = (cwd or "").replace("\\", "/").rstrip("/")
    if not base or not here:
        return None
    if here == base:
        return ""
    prefix = base + "/"
    if not here.startswith(prefix):
        return None
    return here[len(prefix):]


def _upsert_node(
    conn: sqlite3.Connection,
    node_id: str,
    kind: str,
    project_id: str,
    label: str,
    payload: Dict[str, Any],
    created_at: int,
) -> None:
    conn.execute(
        """
        INSERT INTO nodes (id, kind, project_id, label, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            label=excluded.label,
            payload_json=excluded.payload_json
        """,
        (node_id, kind, project_id, label, _json(payload), created_at),
    )


def _upsert_spatial(
    conn: sqlite3.Connection,
    node_id: str,
    x: float,
    y: float,
    z: float,
    plot_x: int,
    plot_y: int,
    floor_index: Optional[int],
) -> None:
    conn.execute(
        """
        INSERT INTO spatial (node_id, x, y, z, plot_x, plot_y, floor_index)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
            x=excluded.x, y=excluded.y, z=excluded.z,
            plot_x=excluded.plot_x, plot_y=excluded.plot_y,
            floor_index=excluded.floor_index
        """,
        (node_id, x, y, z, plot_x, plot_y, floor_index),
    )


def _edge(conn: sqlite3.Connection, src: str, dst: str, rel: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO edges (src, dst, rel) VALUES (?, ?, ?)",
        (src, dst, rel),
    )


def _floors(conn: sqlite3.Connection, project_id: str) -> List[Dict[str, Any]]:
    import json
    rows = conn.execute(
        """
        SELECT n.id, n.payload_json, s.floor_index
        FROM nodes n
        JOIN spatial s ON s.node_id = n.id
        WHERE n.project_id = ? AND n.kind = 'floor'
        """,
        (project_id,),
    ).fetchall()
    out = []
    for row in rows:
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        out.append({
            "id": row["id"],
            "folder": str(payload.get("folder") or ""),
            "floor_index": row["floor_index"],
        })
    return out


def match_floor(
    conn: sqlite3.Connection,
    project_id: str,
    folder: Optional[str],
    rel: Optional[str],
) -> tuple:
    best_id = None
    best_index = None
    best_len = -1
    for floor in _floors(conn, project_id):
        f_folder = floor["folder"].replace("\\", "/").strip("/")
        if not f_folder:
            continue
        hit = False
        if folder and folder.strip("/") == f_folder:
            hit = True
        if rel is not None:
            rel_norm = rel.strip("/")
            if rel_norm == f_folder or rel_norm.startswith(f_folder + "/"):
                hit = True
        if hit and len(f_folder) > best_len:
            best_id = floor["id"]
            best_index = floor["floor_index"]
            best_len = len(f_folder)
    return best_id, best_index


def dedupe_key(project_id: str, fields: Dict[str, Any]) -> str:
    source = fields.get("source") or ""
    if source == "git_commit" and fields.get("commit_sha"):
        raw = f"git_commit|{project_id}|{fields['commit_sha']}"
    elif source == "terminal_task" and fields.get("terminal_id") and fields.get("task_id"):
        raw = (
            f"terminal_task|{project_id}|{fields['terminal_id']}|"
            f"{fields['task_id']}|{fields.get('task_status') or ''}"
        )
    else:
        raw = f"{source}|{project_id}|{fields.get('summary') or ''}|{fields.get('ts') or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _record(conn: sqlite3.Connection, project: Dict[str, Any], fields: Dict[str, Any]) -> Dict[str, Any]:
    project_id = project["id"]
    summary = clean_summary(fields.get("summary") or "")
    if not summary:
        summary = fields.get("source") or "episode"
    ts = int(fields.get("ts") or time.time())
    source = str(fields.get("source") or "episode")
    key = dedupe_key(project_id, {**fields, "summary": summary, "ts": ts})
    episode_id = "ep-" + key[:24]

    rel = relative_to_project(project.get("path") or "", fields.get("cwd") or "")
    path_hint = fields.get("path") or ""
    folder = fields.get("floor_folder") or None
    floor_id, floor_index = match_floor(conn, project_id, folder, path_hint or rel)
    if floor_id is None and floor_index is None and fields.get("floor_index") is not None:
        try:
            floor_index = int(fields["floor_index"])
            candidate = f"floor:{project_id}:{floor_index}"
            row = conn.execute("SELECT id FROM nodes WHERE id=?", (candidate,)).fetchone()
            if row:
                floor_id = candidate
        except (TypeError, ValueError):
            floor_index = None

    px, py = _plot(project)
    wx, _, wz = plot_world(px, py)
    height = float(floor_index or 0)
    now = int(time.time())
    place_id = floor_id or f"building:{project_id}"

    tokens = tokenize(summary, path_hint, rel or "", folder or "")
    cur = conn.execute(
        """
        INSERT INTO episodes
            (id, node_id, project_id, ts, source, summary, tokens, dedupe_key, floor_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dedupe_key) DO NOTHING
        """,
        (episode_id, episode_id, project_id, ts, source, summary, tokens, key, floor_index),
    )
    created = cur.rowcount == 1
    if not created:
        return {"ok": True, "created": False, "id": episode_id}

    _upsert_node(
        conn, episode_id, "episode", project_id, summary[:80],
        {
            "source": source,
            "summary": summary,
            "commit_sha": fields.get("commit_sha") or None,
            "terminal_id": fields.get("terminal_id") or None,
            "task_id": fields.get("task_id") or None,
            "task_status": fields.get("task_status") or None,
        },
        now,
    )
    _upsert_spatial(conn, episode_id, wx, height, wz, px, py, floor_index)
    building_id = f"building:{project_id}"
    if not conn.execute("SELECT 1 FROM nodes WHERE id=?", (building_id,)).fetchone():
        _upsert_node(
            conn, building_id, "building", project_id,
            str(project.get("name") or project_id),
            {"path": project.get("path") or ""},
            now,
        )
        _upsert_spatial(conn, building_id, wx, 0.0, wz, px, py, None)
    _edge(conn, episode_id, place_id, "at")

    if floor_index is None:
        prev = conn.execute(
            """
            SELECT id FROM episodes
            WHERE project_id=? AND floor_index IS NULL AND id!=? AND ts<=?
            ORDER BY ts DESC LIMIT 1
            """,
            (project_id, episode_id, ts),
        ).fetchone()
    else:
        prev = conn.execute(
            """
            SELECT id FROM episodes
            WHERE project_id=? AND floor_index=? AND id!=? AND ts<=?
            ORDER BY ts DESC LIMIT 1
            """,
            (project_id, floor_index, episode_id, ts),
        ).fetchone()
    if prev:
        _edge(conn, episode_id, prev["id"], "follows")
    return {"ok": True, "created": True, "id": episode_id}


def record_episode(project: Dict[str, Any], fields: Dict[str, Any]) -> Dict[str, Any]:
    with session() as conn:
        return _record(conn, project, fields)


def upsert_structure(conn: sqlite3.Connection, project: Dict[str, Any], plan: Dict[str, Any]) -> Dict[str, int]:
    project_id = project["id"]
    px, py = _plot(project)
    wx, _, wz = plot_world(px, py)
    now = int(time.time())
    building_id = f"building:{project_id}"
    _upsert_node(
        conn, building_id, "building", project_id,
        str(project.get("name") or project_id),
        {"path": project.get("path") or ""},
        now,
    )
    _upsert_spatial(conn, building_id, wx, 0.0, wz, px, py, None)

    root = Path(project.get("path") or "")
    floors = 0
    files = 0
    for floor in plan.get("floors") or []:
        try:
            index = int(floor.get("index") if floor.get("index") is not None else floors)
        except (TypeError, ValueError):
            index = floors
        folder = str(floor.get("folder") or "")
        floor_id = f"floor:{project_id}:{index}"
        _upsert_node(
            conn, floor_id, "floor", project_id,
            str(floor.get("name") or folder or f"Floor {index}"),
            {"folder": folder, "category": floor.get("category") or ""},
            now,
        )
        _upsert_spatial(conn, floor_id, wx, float(index), wz, px, py, index)
        _edge(conn, building_id, floor_id, "contains")
        floors += 1
        seen = set()
        for obj in floor.get("objects") or []:
            if not isinstance(obj, dict):
                continue
            for key in ("file", "file2"):
                rel = obj.get(key)
                if not isinstance(rel, str) or not rel or rel in seen:
                    continue
                seen.add(rel)
                if not root or not (root / rel).is_file():
                    continue
                file_id = "file:" + hashlib.sha256(f"{project_id}|{rel}".encode()).hexdigest()[:24]
                _upsert_node(
                    conn, file_id, "file", project_id, Path(rel).name,
                    {"path": rel},
                    now,
                )
                _upsert_spatial(conn, file_id, wx, float(index), wz, px, py, index)
                _edge(conn, floor_id, file_id, "contains")
                files += 1
    return {"floors": floors, "files": files}


def _git_log(repo: str) -> List[Dict[str, Any]]:
    try:
        proc = subprocess.run(
            [
                "git", "-C", repo, "log",
                "--since=30 days ago",
                "-n", str(GIT_LIMIT),
                "--name-only",
                "--pretty=format:%x1e%H%x1f%ct%x1f%s",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0:
        return []
    commits = []
    for chunk in proc.stdout.split("\x1e"):
        chunk = chunk.strip()
        if not chunk:
            continue
        header, _, rest = chunk.partition("\n")
        parts = header.split("\x1f")
        if len(parts) < 3:
            continue
        sha, ts_raw, subject = parts[0], parts[1], parts[2]
        paths = [ln.strip() for ln in rest.splitlines() if ln.strip()]
        try:
            ts = int(ts_raw)
        except ValueError:
            ts = int(time.time())
        commits.append({"sha": sha, "ts": ts, "subject": subject, "paths": paths})
    return commits


def sync_git(conn: sqlite3.Connection, project: Dict[str, Any]) -> int:
    repo = project.get("path") or ""
    if not repo or repo.startswith("-") or not (Path(repo) / ".git").exists():
        return 0
    cursor = conn.execute(
        "SELECT last_sha FROM cursors WHERE project_id=?",
        (project["id"],),
    ).fetchone()
    last_sha = cursor["last_sha"] if cursor else ""
    commits = _git_log(repo)
    fresh: List[Dict[str, Any]] = []
    for commit in commits:
        if commit["sha"] == last_sha:
            break
        fresh.append(commit)
    added = 0
    for commit in reversed(fresh):
        path = commit["paths"][0] if commit["paths"] else ""
        result = _record(conn, project, {
            "source": "git_commit",
            "summary": commit["subject"],
            "commit_sha": commit["sha"],
            "path": path,
            "ts": commit["ts"],
        })
        if result.get("created"):
            added += 1
    if fresh:
        conn.execute(
            """
            INSERT INTO cursors (project_id, last_sha, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                last_sha=excluded.last_sha,
                updated_at=excluded.updated_at
            """,
            (project["id"], fresh[0]["sha"], int(time.time())),
        )
    return added


def ingest_project_plan(project: Dict[str, Any], plan: Dict[str, Any]) -> Dict[str, int]:
    with session() as conn:
        counts = upsert_structure(conn, project, plan)
        counts["commits_added"] = sync_git(conn, project)
        return counts


def _walk_episodes(conn: sqlite3.Connection, anchor_id: Optional[str]) -> List[str]:
    if not anchor_id:
        return []
    if not conn.execute("SELECT 1 FROM nodes WHERE id=?", (anchor_id,)).fetchone():
        return []
    seen = {anchor_id}
    frontier = [anchor_id]
    episodes: List[str] = []
    for _ in range(WALK_HOPS):
        nxt: List[str] = []
        if not frontier:
            break
        placeholders = ",".join("?" for _ in frontier)
        rows = conn.execute(
            f"""
            SELECT dst AS id FROM edges WHERE src IN ({placeholders})
            UNION
            SELECT src AS id FROM edges WHERE dst IN ({placeholders})
            """,
            (*frontier, *frontier),
        ).fetchall()
        for row in rows:
            nid = row["id"]
            if nid in seen:
                continue
            seen.add(nid)
            if len(seen) > WALK_CAP:
                return episodes
            nxt.append(nid)
        if nxt:
            marks = ",".join("?" for _ in nxt)
            kinds = conn.execute(
                f"SELECT id, kind FROM nodes WHERE id IN ({marks})",
                tuple(nxt),
            ).fetchall()
            episode_ids = {row["id"] for row in kinds if row["kind"] == "episode"}
            for nid in nxt:
                if nid in episode_ids:
                    episodes.append(nid)
        frontier = nxt
    return episodes


def _anchor_id(conn: sqlite3.Connection, project_id: str, floor_index: Optional[int]) -> Optional[str]:
    if floor_index is not None:
        fid = f"floor:{project_id}:{int(floor_index)}"
        if conn.execute("SELECT 1 FROM nodes WHERE id=?", (fid,)).fetchone():
            return fid
    bid = f"building:{project_id}"
    if conn.execute("SELECT 1 FROM nodes WHERE id=?", (bid,)).fetchone():
        return bid
    return None


def _rows_to_hits(
    conn: sqlite3.Connection,
    rows: List[sqlite3.Row],
    anchor: tuple,
    query: str,
) -> List[Dict[str, Any]]:
    if not rows:
        return []
    ids = [row["id"] for row in rows]
    marks = ",".join("?" for _ in ids)
    spatial = {
        row["node_id"]: row
        for row in conn.execute(
            f"SELECT * FROM spatial WHERE node_id IN ({marks})",
            tuple(ids),
        ).fetchall()
    }
    hits = []
    ax, ay, az = anchor
    for row in rows:
        point = spatial.get(row["id"])
        if point is not None:
            bx, by, bz = point["x"], point["y"], point["z"]
        else:
            bx, by, bz = ax, float(row["floor_index"] or 0), az
        dist, close = closeness(ax, ay, az, bx, by, bz)
        stored = f"{row['summary']} {row['tokens']}"
        overlap = token_overlap(query, stored)
        score = ALPHA * close + (1.0 - ALPHA) * overlap
        hits.append({
            "id": row["id"],
            "source": row["source"],
            "summary": row["summary"],
            "label": (row["summary"] or "")[:80],
            "ts": row["ts"],
            "floor_index": row["floor_index"],
            "distance": round(dist, 4),
            "score": round(score, 4),
        })
    hits.sort(key=lambda hit: (hit["score"], hit["ts"]), reverse=True)
    return hits


def recall(
    project: Dict[str, Any],
    floor_index: Optional[int],
    query: str,
    limit: int,
    days: int,
) -> List[Dict[str, Any]]:
    global _last_examined
    since = int(time.time()) - int(days) * 86400
    px, py = _plot(project)
    wx, _, wz = plot_world(px, py)
    anchor_y = float(floor_index or 0)
    with session() as conn:
        walked = _walk_episodes(conn, _anchor_id(conn, project["id"], floor_index))
        local_sql = """
            SELECT * FROM episodes
            WHERE project_id = ? AND ts >= ?
            ORDER BY CASE WHEN floor_index IS ? THEN 0 ELSE 1 END, ts DESC
            LIMIT ?
        """
        local = list(conn.execute(
            local_sql, (project["id"], since, floor_index, MAX_CANDIDATES),
        ).fetchall())
        have = {row["id"] for row in local}
        if walked:
            missing = [eid for eid in walked if eid not in have]
            if missing:
                marks = ",".join("?" for _ in missing)
                extra = conn.execute(
                    f"SELECT * FROM episodes WHERE id IN ({marks}) AND ts >= ?",
                    (*missing, since),
                ).fetchall()
                for row in extra:
                    if row["id"] not in have:
                        local.append(row)
                        have.add(row["id"])
        rows = local[:MAX_CANDIDATES]
        if len(rows) < limit:
            others = conn.execute(
                """
                SELECT * FROM episodes
                WHERE project_id != ? AND ts >= ?
                ORDER BY ts DESC
                LIMIT ?
                """,
                (project["id"], since, MAX_CANDIDATES),
            ).fetchall()
            for row in others:
                if row["id"] not in have:
                    rows.append(row)
                    have.add(row["id"])
                if len(rows) >= MAX_CANDIDATES:
                    break
        _last_examined = len(rows)
        ranked = _rows_to_hits(conn, rows, (wx, anchor_y, wz), query or "")
    return ranked[:limit]


def episode_count() -> int:
    with session() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM episodes").fetchone()
        return int(row["n"])
