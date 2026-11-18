# backend/visit_store.py — persistent collaborator visit records
"""One record per collaborator sign-in, with a hash-chained activity timeline.

Records live in SQLite under the app data dir (next to the collab store) so
they survive restarts. Each event's hash covers the previous hash, so editing
a line in the database is detectable. The key used for the hash stays in a
sibling file, not inside the database.
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import os
import sqlite3
import threading
import time
import uuid
import pathlib
from typing import Any, Dict, Iterable, List, Optional

COLLAB_DIR = pathlib.Path.home() / ".local" / "share" / "tto" / "collab"
GENESIS = "0" * 64

# Heartbeats are expected about every 20s. Three misses means the tab is gone.
DEFAULT_TAB_CLOSE_SECONDS = 75


def parse_user_agent(ua: str) -> Dict[str, str]:
    """Turn a User-Agent into browser, operating system, and device. Stdlib only."""
    text = ua or ""
    device = "Desktop"
    if "iPad" in text or "Tablet" in text:
        device = "Tablet"
    elif "Mobi" in text or "Android" in text:
        device = "Phone"
    browser = "Unknown browser"
    if "Edg/" in text or "Edge/" in text:
        browser = "Edge"
    elif "OPR/" in text or "Opera" in text:
        browser = "Opera"
    elif "Chrome/" in text or "CriOS/" in text:
        browser = "Chrome"
    elif "Firefox/" in text or "FxiOS/" in text:
        browser = "Firefox"
    elif "Safari/" in text:
        browser = "Safari"
    elif text.lower().startswith("curl/"):
        browser = "curl"
        device = "Script"
    os_name = "Unknown system"
    if "Windows" in text:
        os_name = "Windows"
    elif "Mac OS X" in text or "Macintosh" in text:
        os_name = "macOS"
    elif "Android" in text:
        os_name = "Android"
    elif "iPhone" in text or "iPad" in text or "iOS" in text:
        os_name = "iOS"
    elif "Linux" in text or "X11" in text:
        os_name = "Linux"
    return {"browser": browser, "os": os_name, "device": device}


def _stable_ts(value: Any) -> str:
    """Fixed-point timestamp so hashing does not depend on float text."""
    try:
        return f"{float(value):.3f}"
    except (TypeError, ValueError):
        return "0.000"


def _canon(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _chain(key: bytes, prev: str, payload: Dict[str, Any]) -> str:
    material = (prev + "\n" + _canon(payload)).encode("utf-8")
    return hmac.new(key, material, hashlib.sha256).hexdigest()


_ACTIVITY = {
    "login": "Signed in",
    "logout": "Signing out",
    "workspace_open": "Opened a workspace",
    "terminal_open": "Opened a terminal",
    "command": "Ran a command",
    "workspace_change": "Changed a workspace",
    "message": "Sent a message",
    "orchestrator_started": "Started an orchestrator task",
    "orchestrator_outcome": "Orchestrator task finished",
    "qwen_task": "Ran a Qwen task",
    "task_started": "Started a task",
    "task_outcome": "Task finished",
    "agent_task": "Started an agent task",
    "denied": "Action was denied",
    "failed": "Action failed",
    "login_failed": "Sign-in failed",
}


def activity_label(event_type: str, details: Optional[Dict[str, Any]] = None) -> str:
    details = details or {}
    base = _ACTIVITY.get(event_type, event_type.replace("_", " "))
    extra = details.get("summary") or details.get("command") or details.get("description") or details.get("task") or ""
    extra = str(extra).replace("\n", " ").strip()
    if extra:
        if len(extra) > 80:
            extra = extra[:79] + "…"
        return f"{base}: {extra}"
    return base


class VisitStore:
    def __init__(self, db_path: pathlib.Path):
        self.path = pathlib.Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.key_path = self.path.parent / "visit_key"
        self._lock = threading.Lock()
        self._key = self._load_key()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_db()

    def _load_key(self) -> bytes:
        if self.key_path.exists():
            data = self.key_path.read_bytes().strip()
            if len(data) >= 32:
                return data
        key = os.urandom(32)
        self.key_path.write_bytes(key.hex().encode("ascii"))
        try:
            os.chmod(self.key_path, 0o600)
        except OSError:
            pass
        return self.key_path.read_bytes().strip()

    def _init_db(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS visits (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                name TEXT NOT NULL,
                invite_code TEXT,
                auth_method TEXT,
                ip TEXT,
                user_agent TEXT,
                browser TEXT,
                os TEXT,
                device TEXT,
                signed_in_at REAL NOT NULL,
                last_seen_at REAL NOT NULL,
                last_activity_at REAL NOT NULL,
                signed_out_at REAL,
                end_reason TEXT,
                status TEXT NOT NULL,
                token_prefix TEXT,
                current_activity TEXT,
                chain_head TEXT NOT NULL,
                record_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS visit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                visit_id TEXT NOT NULL,
                ts REAL NOT NULL,
                event_type TEXT NOT NULL,
                details_json TEXT NOT NULL,
                workspace_id TEXT,
                tty TEXT,
                prev_hash TEXT NOT NULL,
                event_hash TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_visit ON visit_events(visit_id, id);
            CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(username, signed_in_at);
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                identifier TEXT,
                reason TEXT,
                ip TEXT,
                user_agent TEXT,
                browser TEXT,
                os TEXT,
                device TEXT
            );
            """
        )
        self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ── identity hashing ────────────────────────────────────────────────

    def _identity(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "name": row["name"],
            "invite_code": row["invite_code"] or "",
            "auth_method": row["auth_method"] or "",
            "ip": row["ip"] or "",
            "user_agent": row["user_agent"] or "",
            "browser": row["browser"] or "",
            "os": row["os"] or "",
            "device": row["device"] or "",
            "signed_in_at": _stable_ts(row["signed_in_at"]),
            "token_prefix": row["token_prefix"] or "",
        }

    def _record_hash(self, identity: Dict[str, Any], chain_head: str) -> str:
        payload = dict(identity)
        payload["chain_head"] = chain_head
        return _chain(self._key, GENESIS, payload)

    def _row(self, visit_id: str) -> Optional[sqlite3.Row]:
        return self._conn.execute("SELECT * FROM visits WHERE id = ?", (visit_id,)).fetchone()

    # ── writes ──────────────────────────────────────────────────────────

    def open_visit(
        self,
        *,
        username: str,
        email: str,
        name: str,
        ip: str,
        user_agent: str,
        token_prefix: str = "",
        invite_code: Optional[str] = None,
        auth_method: str = "pin",
        signed_in_at: Optional[float] = None,
    ) -> Dict[str, Any]:
        now = float(signed_in_at if signed_in_at is not None else time.time())
        parsed = parse_user_agent(user_agent)
        visit_id = uuid.uuid4().hex
        identity = {
            "id": visit_id,
            "username": username,
            "email": email or username,
            "name": name or email or username,
            "invite_code": invite_code or "",
            "auth_method": auth_method or "",
            "ip": ip or "",
            "user_agent": user_agent or "",
            "browser": parsed["browser"],
            "os": parsed["os"],
            "device": parsed["device"],
            "signed_in_at": _stable_ts(now),
            "token_prefix": token_prefix or "",
        }
        chain_head = _chain(self._key, GENESIS, {"kind": "visit", **identity})
        record_hash = self._record_hash(identity, chain_head)
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO visits (
                    id, username, email, name, invite_code, auth_method, ip, user_agent,
                    browser, os, device, signed_in_at, last_seen_at, last_activity_at,
                    signed_out_at, end_reason, status, token_prefix, current_activity,
                    chain_head, record_hash
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    visit_id, identity["username"], identity["email"], identity["name"],
                    identity["invite_code"], identity["auth_method"], identity["ip"],
                    identity["user_agent"], identity["browser"], identity["os"], identity["device"],
                    now, now, now, None, None, "active", identity["token_prefix"],
                    "Signed in", chain_head, record_hash,
                ),
            )
            self._conn.commit()
        return self.get_visit(visit_id) or {}

    def append_event(
        self,
        visit_id: str,
        event_type: str,
        details: Optional[Dict[str, Any]] = None,
        workspace_id: Optional[str] = None,
        tty: Optional[str] = None,
        ts: Optional[float] = None,
        dedupe_seconds: float = 0,
    ) -> Optional[int]:
        details = details or {}
        now = ts if ts is not None else time.time()
        with self._lock:
            row = self._row(visit_id)
            if row is None or row["status"] != "active":
                return None
            if dedupe_seconds > 0:
                prev_evt = self._conn.execute(
                    """
                    SELECT ts, event_type, details_json, workspace_id, tty
                    FROM visit_events WHERE visit_id = ? ORDER BY id DESC LIMIT 1
                    """,
                    (visit_id,),
                ).fetchone()
                if prev_evt and prev_evt["event_type"] == event_type:
                    same = (
                        prev_evt["details_json"] == _canon(details)
                        and (prev_evt["workspace_id"] or None) == (workspace_id or None)
                        and (prev_evt["tty"] or None) == (tty or None)
                        and (now - float(prev_evt["ts"])) < dedupe_seconds
                    )
                    if same:
                        return None
            prev = row["chain_head"]
            payload = {
                "visit_id": visit_id,
                "ts": _stable_ts(now),
                "type": event_type,
                "details": details,
                "ws": workspace_id,
                "tty": tty,
            }
            event_hash = _chain(self._key, prev, payload)
            cur = self._conn.execute(
                """
                INSERT INTO visit_events (
                    visit_id, ts, event_type, details_json, workspace_id, tty, prev_hash, event_hash
                ) VALUES (?,?,?,?,?,?,?,?)
                """,
                (visit_id, now, event_type, _canon(details), workspace_id, tty, prev, event_hash),
            )
            identity = self._identity(row)
            record_hash = self._record_hash(identity, event_hash)
            label = activity_label(event_type, details)
            self._conn.execute(
                """
                UPDATE visits
                SET chain_head = ?, record_hash = ?, last_seen_at = ?, last_activity_at = ?,
                    current_activity = ?
                WHERE id = ?
                """,
                (event_hash, record_hash, now, now, label, visit_id),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    def touch(self, username: str, activity: Optional[str] = None, now: Optional[float] = None) -> bool:
        """Heartbeat. Refreshes last-seen without counting as real work."""
        stamp = now if now is not None else time.time()
        with self._lock:
            row = self._active_row(username)
            if row is None:
                return False
            if activity:
                self._conn.execute(
                    "UPDATE visits SET last_seen_at = ?, current_activity = ? WHERE id = ?",
                    (stamp, str(activity)[:160], row["id"]),
                )
            else:
                self._conn.execute(
                    "UPDATE visits SET last_seen_at = ? WHERE id = ?",
                    (stamp, row["id"]),
                )
            self._conn.commit()
            return True

    def close_visit(self, visit_id: str, reason: str, ts: Optional[float] = None) -> Optional[Dict[str, Any]]:
        now = ts if ts is not None else time.time()
        with self._lock:
            row = self._row(visit_id)
            if row is None or row["status"] != "active":
                return self._public_visit(row) if row else None
            prev = row["chain_head"]
            details = {"reason": reason}
            payload = {
                "visit_id": visit_id,
                "ts": _stable_ts(now),
                "type": "visit_ended",
                "details": details,
                "ws": None,
                "tty": None,
            }
            event_hash = _chain(self._key, prev, payload)
            self._conn.execute(
                """
                INSERT INTO visit_events (
                    visit_id, ts, event_type, details_json, workspace_id, tty, prev_hash, event_hash
                ) VALUES (?,?,?,?,?,?,?,?)
                """,
                (visit_id, now, "visit_ended", _canon(details), None, None, prev, event_hash),
            )
            identity = self._identity(row)
            record_hash = self._record_hash(identity, event_hash)
            self._conn.execute(
                """
                UPDATE visits
                SET status = 'ended', end_reason = ?, signed_out_at = ?,
                    last_seen_at = ?, chain_head = ?, record_hash = ?,
                    current_activity = ?
                WHERE id = ?
                """,
                (reason, now, now, event_hash, record_hash, activity_label("visit_ended", details), visit_id),
            )
            self._conn.commit()
            closed = self._row(visit_id)
        self._mirror_end(closed, reason, now)
        return self._public_visit(closed) if closed else None

    def _mirror_end(self, row: Optional[sqlite3.Row], reason: str, ts: float) -> None:
        if row is None:
            return
        try:
            from audit import queue_mirror
            queue_mirror(
                row["email"] or row["username"],
                "visit_ended",
                {"reason": reason},
                visit_id=row["id"],
                timestamp=ts,
            )
        except Exception:
            pass

    def close_active_for_user(self, username: str, reason: str, ts: Optional[float] = None) -> List[str]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT id FROM visits
                WHERE status = 'active' AND (username = ? OR email = ?)
                """,
                (username, username),
            ).fetchall()
            ids = [r["id"] for r in rows]
        closed = []
        for visit_id in ids:
            if self.close_visit(visit_id, reason, ts=ts):
                closed.append(visit_id)
        return closed

    def record_failed_login(
        self,
        identifier: str,
        reason: str,
        ip: str,
        user_agent: str = "",
        ts: Optional[float] = None,
    ) -> int:
        parsed = parse_user_agent(user_agent)
        stamp = ts if ts is not None else time.time()
        with self._lock:
            cur = self._conn.execute(
                """
                INSERT INTO login_attempts (ts, identifier, reason, ip, user_agent, browser, os, device)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (
                    stamp, identifier or "", reason or "", ip or "", user_agent or "",
                    parsed["browser"], parsed["os"], parsed["device"],
                ),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    # ── reads ───────────────────────────────────────────────────────────

    def _active_row(self, username: str) -> Optional[sqlite3.Row]:
        return self._conn.execute(
            """
            SELECT * FROM visits
            WHERE status = 'active' AND (username = ? OR email = ?)
            ORDER BY signed_in_at DESC LIMIT 1
            """,
            (username, username),
        ).fetchone()

    def active_visit_for(self, username: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._active_row(username)
            return self._public_visit(row) if row else None

    def _events(self, visit_id: str) -> List[Dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM visit_events WHERE visit_id = ? ORDER BY id ASC",
            (visit_id,),
        ).fetchall()
        out = []
        for row in rows:
            try:
                details = json.loads(row["details_json"])
            except Exception:
                details = {"raw": row["details_json"]}
            out.append({
                "id": row["id"],
                "visit_id": row["visit_id"],
                "ts": row["ts"],
                "type": row["event_type"],
                "details": details,
                "workspace_id": row["workspace_id"],
                "tty": row["tty"],
                "prev_hash": row["prev_hash"],
                "event_hash": row["event_hash"],
            })
        return out

    def _duration(self, row: sqlite3.Row, now: Optional[float] = None) -> int:
        end = row["signed_out_at"]
        if end is None:
            end = now if now is not None else time.time()
        return max(0, int(float(end) - float(row["signed_in_at"])))

    def verify_row(self, row: sqlite3.Row, events: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        events = events if events is not None else self._events(row["id"])
        identity = self._identity(row)
        prev = _chain(self._key, GENESIS, {"kind": "visit", **identity})
        for event in events:
            payload = {
                "visit_id": event["visit_id"],
                "ts": _stable_ts(event["ts"]),
                "type": event["type"],
                "details": event["details"],
                "ws": event["workspace_id"],
                "tty": event["tty"],
            }
            expected = _chain(self._key, prev, payload)
            if expected != event["event_hash"] or event["prev_hash"] != prev:
                return {"ok": False, "reason": "An activity line does not match the record."}
            prev = expected
        if prev != row["chain_head"]:
            return {"ok": False, "reason": "The visit no longer matches its activity."}
        if self._record_hash(identity, prev) != row["record_hash"]:
            return {"ok": False, "reason": "The visit details were changed."}
        ended = [e for e in events if e["type"] == "visit_ended"]
        if row["status"] == "ended":
            if not ended:
                return {"ok": False, "reason": "This visit is marked finished but has no ending line."}
            if (ended[-1]["details"] or {}).get("reason") != row["end_reason"]:
                return {"ok": False, "reason": "The recorded ending does not match the visit."}
        elif ended:
            return {"ok": False, "reason": "This visit is still open but already has an ending line."}
        return {"ok": True, "reason": "Verified"}

    def _public_visit(self, row: Optional[sqlite3.Row], with_events: bool = False, now: Optional[float] = None) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        events = self._events(row["id"]) if with_events or True else []
        # Always verify. Event load is the same work either way for a single visit.
        check = self.verify_row(row, events)
        data = {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "name": row["name"],
            "invite_code": row["invite_code"] or "",
            "auth_method": row["auth_method"] or "",
            "ip": row["ip"] or "",
            "user_agent": row["user_agent"] or "",
            "browser": row["browser"] or "",
            "os": row["os"] or "",
            "device": row["device"] or "",
            "signed_in_at": row["signed_in_at"],
            "last_seen_at": row["last_seen_at"],
            "last_activity_at": row["last_activity_at"],
            "signed_out_at": row["signed_out_at"],
            "end_reason": row["end_reason"],
            "status": row["status"],
            "token_prefix": row["token_prefix"] or "",
            "current_activity": row["current_activity"] or "",
            "duration_seconds": self._duration(row, now=now),
            "event_count": len(events),
            "verified": bool(check["ok"]),
            "verify_reason": check["reason"],
            "kind": "visit",
        }
        if with_events:
            data["events"] = events
        return data

    def get_visit(self, visit_id: str) -> Optional[Dict[str, Any]]:
        if visit_id.startswith("attempt-"):
            return self._attempt_as_visit(visit_id[len("attempt-"):])
        with self._lock:
            row = self._row(visit_id)
            if row is None:
                return None
            return self._public_visit(row, with_events=True)

    def _attempt_as_visit(self, attempt_id: str) -> Optional[Dict[str, Any]]:
        try:
            numeric = int(attempt_id)
        except ValueError:
            return None
        with self._lock:
            row = self._conn.execute("SELECT * FROM login_attempts WHERE id = ?", (numeric,)).fetchone()
        if row is None:
            return None
        return self._public_attempt(row)

    def _public_attempt(self, row: sqlite3.Row) -> Dict[str, Any]:
        reason = row["reason"] or "failed"
        return {
            "id": f"attempt-{row['id']}",
            "username": row["identifier"] or "",
            "email": row["identifier"] or "",
            "name": row["identifier"] or "Unknown",
            "invite_code": "",
            "auth_method": "failed",
            "ip": row["ip"] or "",
            "user_agent": row["user_agent"] or "",
            "browser": row["browser"] or "",
            "os": row["os"] or "",
            "device": row["device"] or "",
            "signed_in_at": row["ts"],
            "last_seen_at": row["ts"],
            "last_activity_at": row["ts"],
            "signed_out_at": row["ts"],
            "end_reason": reason,
            "status": "failed",
            "token_prefix": "",
            "current_activity": activity_label("login_failed", {"reason": reason}),
            "duration_seconds": 0,
            "event_count": 1,
            "verified": None,
            "verify_reason": "",
            "kind": "attempt",
            "events": [{
                "id": row["id"],
                "visit_id": f"attempt-{row['id']}",
                "ts": row["ts"],
                "type": "login_failed",
                "details": {"reason": reason, "ip": row["ip"] or ""},
                "workspace_id": None,
                "tty": None,
            }],
        }

    def list_visits(
        self,
        *,
        person: str = "",
        query: str = "",
        status: str = "",
        start: Optional[float] = None,
        end: Optional[float] = None,
        limit: int = 200,
        now: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """status: '' | active | ended | failed | logout | idle_timeout | tab_close | revoked | all"""
        include_attempts = status in ("failed", "all", "")
        # Default list is real visits. "all" adds failed attempts. "failed" is attempts only.
        include_visits = status != "failed"
        people = (person or "").strip().lower()
        q = (query or "").strip().lower()
        results: List[Dict[str, Any]] = []
        with self._lock:
            if include_visits:
                sql = "SELECT * FROM visits WHERE 1=1"
                args: List[Any] = []
                if status == "active":
                    sql += " AND status = 'active'"
                elif status == "ended":
                    sql += " AND status = 'ended'"
                elif status in ("logout", "idle_timeout", "tab_close", "revoked"):
                    sql += " AND end_reason = ?"
                    args.append(status)
                if start is not None:
                    sql += " AND signed_in_at >= ?"
                    args.append(float(start))
                if end is not None:
                    sql += " AND signed_in_at <= ?"
                    args.append(float(end))
                sql += " ORDER BY signed_in_at DESC LIMIT ?"
                args.append(int(limit))
                for row in self._conn.execute(sql, args).fetchall():
                    item = self._public_visit(row, with_events=False, now=now)
                    if item and self._matches(item, people, q):
                        results.append(item)
            if include_attempts and status in ("failed", "all"):
                sql = "SELECT * FROM login_attempts WHERE 1=1"
                args = []
                if start is not None:
                    sql += " AND ts >= ?"
                    args.append(float(start))
                if end is not None:
                    sql += " AND ts <= ?"
                    args.append(float(end))
                sql += " ORDER BY ts DESC LIMIT ?"
                args.append(int(limit))
                for row in self._conn.execute(sql, args).fetchall():
                    item = self._public_attempt(row)
                    if self._matches(item, people, q):
                        results.append(item)
        results.sort(key=lambda item: float(item.get("signed_in_at") or 0), reverse=True)
        return results[:limit]

    def _matches(self, item: Dict[str, Any], person: str, query: str) -> bool:
        if person:
            hay = f"{item.get('username','')} {item.get('email','')} {item.get('name','')}".lower()
            if person not in hay:
                return False
        if query:
            blob = " ".join(str(item.get(k) or "") for k in (
                "username", "email", "name", "ip", "browser", "os", "device", "current_activity", "end_reason",
            )).lower()
            if query not in blob:
                return False
        return True

    # ── maintenance ─────────────────────────────────────────────────────

    def sweep(
        self,
        now: Optional[float] = None,
        *,
        tab_close_seconds: float = DEFAULT_TAB_CLOSE_SECONDS,
        idle_seconds: float = 1800,
    ) -> List[Dict[str, str]]:
        """Close active visits that went idle or whose browser tab stopped checking in."""
        stamp = now if now is not None else time.time()
        with self._lock:
            rows = list(self._conn.execute("SELECT * FROM visits WHERE status = 'active'").fetchall())
        closed: List[Dict[str, str]] = []
        for row in rows:
            idle_for = stamp - float(row["last_activity_at"])
            silent_for = stamp - float(row["last_seen_at"])
            if idle_for >= idle_seconds:
                reason = "idle_timeout"
            elif silent_for >= tab_close_seconds:
                reason = "tab_close"
            else:
                continue
            self.close_visit(row["id"], reason, ts=stamp)
            closed.append({"id": row["id"], "username": row["username"], "reason": reason, "token_prefix": row["token_prefix"] or ""})
        return closed

    def purge(self, retention_days: int, now: Optional[float] = None) -> int:
        """Delete ended visits (and failed attempts) older than retention_days.

        Zero keeps everything. Active visits are never deleted.
        """
        if retention_days <= 0:
            return 0
        stamp = now if now is not None else time.time()
        cutoff = stamp - (retention_days * 86400)
        with self._lock:
            old = self._conn.execute(
                "SELECT id FROM visits WHERE status = 'ended' AND signed_in_at < ?",
                (cutoff,),
            ).fetchall()
            ids = [r["id"] for r in old]
            if ids:
                marks = ",".join("?" for _ in ids)
                self._conn.execute(f"DELETE FROM visit_events WHERE visit_id IN ({marks})", ids)
                self._conn.execute(f"DELETE FROM visits WHERE id IN ({marks})", ids)
            attempts = self._conn.execute("DELETE FROM login_attempts WHERE ts < ?", (cutoff,))
            self._conn.commit()
            return len(ids) + int(attempts.rowcount or 0)

    # ── export ──────────────────────────────────────────────────────────

    def collect_for_export(self, visit_ids: Optional[Iterable[str]] = None, **filters: Any) -> List[Dict[str, Any]]:
        if visit_ids:
            items = []
            for visit_id in visit_ids:
                item = self.get_visit(visit_id)
                if item:
                    items.append(item)
            return items
        summaries = self.list_visits(**filters)
        full = []
        for summary in summaries:
            item = self.get_visit(summary["id"])
            if item:
                full.append(item)
        return full

    def export_csv(self, visits: List[Dict[str, Any]]) -> str:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "visit_id", "status", "ended_how", "name", "email", "username", "invite",
            "ip", "browser", "os", "device", "signed_in", "last_seen", "signed_out",
            "duration_seconds", "verified", "event_time", "event", "event_details",
            "workspace", "terminal",
        ])
        for visit in visits:
            events = visit.get("events") or [{}]
            for event in events:
                writer.writerow([
                    visit.get("id"),
                    visit.get("status"),
                    _reason_label(visit.get("end_reason")),
                    visit.get("name"),
                    visit.get("email"),
                    visit.get("username"),
                    visit.get("invite_code"),
                    visit.get("ip"),
                    visit.get("browser"),
                    visit.get("os"),
                    visit.get("device"),
                    _fmt_ts(visit.get("signed_in_at")),
                    _fmt_ts(visit.get("last_seen_at")),
                    _fmt_ts(visit.get("signed_out_at")),
                    visit.get("duration_seconds"),
                    visit.get("verified"),
                    _fmt_ts(event.get("ts")) if event else "",
                    event.get("type") if event else "",
                    json.dumps(event.get("details") or {}, ensure_ascii=False) if event else "",
                    event.get("workspace_id") if event else "",
                    event.get("tty") if event else "",
                ])
        return buf.getvalue()

    def export_html(self, visits: List[Dict[str, Any]], title: str = "Visitor records") -> str:
        blocks = []
        for visit in visits:
            blocks.append(_html_visit(visit))
        body = "\n".join(blocks) or "<p>No visits match this filter.</p>"
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{_esc(title)}</title>
<style>
  body {{ font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; margin: 32px; }}
  h1 {{ font-size: 22px; margin-bottom: 4px; }}
  h2 {{ font-size: 16px; margin: 0 0 8px; }}
  .meta {{ color: #444; font-family: sans-serif; font-size: 13px; line-height: 1.5; }}
  .visit {{ border: 1px solid #ccc; border-radius: 8px; padding: 16px 18px; margin: 18px 0; page-break-inside: avoid; }}
  .badge {{ display: inline-block; font-family: sans-serif; font-size: 11px; padding: 2px 8px; border-radius: 99px; border: 1px solid #bbb; }}
  .ok {{ color: #146c36; border-color: #146c36; }}
  .bad {{ color: #9b1c1c; border-color: #9b1c1c; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 12px; font-family: sans-serif; font-size: 12px; }}
  th, td {{ text-align: left; border-bottom: 1px solid #e5e5e5; padding: 6px 8px; vertical-align: top; }}
  th {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }}
  @media print {{ body {{ margin: 12px; }} .visit {{ break-inside: avoid; }} }}
</style>
</head>
<body>
<h1>{_esc(title)}</h1>
<p class="meta">Printed from Task Orchestrator Colab Hub. Each visit lists what that person did, in order.</p>
{body}
</body>
</html>
"""

    def export_pdf(self, visits: List[Dict[str, Any]], title: str = "Visitor records") -> bytes:
        lines = [title, "Task Orchestrator Colab Hub", ""]
        for visit in visits:
            lines.append(_pdf_heading(visit))
            lines.append(
                f"  {visit.get('browser') or 'Unknown browser'} on {visit.get('os') or 'unknown system'}"
                f" · {visit.get('device') or ''} · {visit.get('ip') or 'unknown address'}"
            )
            lines.append(
                f"  Signed in {_fmt_ts(visit.get('signed_in_at'))}"
                f" · duration {visit.get('duration_seconds') or 0}s"
                f" · {_reason_label(visit.get('end_reason')) or visit.get('status')}"
            )
            verified = visit.get("verified")
            if verified is True:
                lines.append("  Record check: verified")
            elif verified is False:
                lines.append(f"  Record check: failed — {visit.get('verify_reason') or ''}")
            lines.append("  Activity:")
            events = visit.get("events") or []
            if not events:
                lines.append("    (no activity lines)")
            for event in events:
                detail = event.get("details") or {}
                summary = activity_label(event.get("type") or "", detail)
                lines.append(f"    {_fmt_ts(event.get('ts'))}  {summary}")
            lines.append("")
        if len(lines) == 3:
            lines.append("No visits match this filter.")
        return _simple_pdf(lines)


def _fmt_ts(ts: Optional[float]) -> str:
    if not ts:
        return ""
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(float(ts)))
    except (TypeError, ValueError, OSError):
        return ""


def _reason_label(reason: Optional[str]) -> str:
    return {
        "logout": "Signed out",
        "idle_timeout": "Idle timeout",
        "tab_close": "Tab closed",
        "revoked": "Ended by the owner",
        "user_not_found": "Unknown email",
        "bad_pin": "Wrong PIN",
        "invalid_or_expired_invite": "Invite link not valid",
        "rate_limited": "Too many attempts",
    }.get(reason or "", reason or "")


def _esc(text: Any) -> str:
    return (str(text or "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def _html_visit(visit: Dict[str, Any]) -> str:
    verified = visit.get("verified")
    if verified is True:
        badge = '<span class="badge ok">Verified</span>'
    elif verified is False:
        badge = f'<span class="badge bad">Check failed</span>'
    else:
        badge = ""
    rows = []
    for event in visit.get("events") or []:
        rows.append(
            "<tr>"
            f"<td>{_esc(_fmt_ts(event.get('ts')))}</td>"
            f"<td>{_esc(activity_label(event.get('type') or '', event.get('details') or {}))}</td>"
            f"<td>{_esc(event.get('workspace_id') or '')}</td>"
            f"<td>{_esc(event.get('tty') or '')}</td>"
            "</tr>"
        )
    table = (
        "<table><thead><tr><th>When</th><th>What happened</th><th>Workspace</th><th>Terminal</th></tr></thead>"
        f"<tbody>{''.join(rows) or '<tr><td colspan=\"4\">No activity lines</td></tr>'}</tbody></table>"
    )
    invite = visit.get("invite_code") or ""
    invite_line = f"Invite used: {_esc(invite)}<br/>" if invite else "Signed in with email and PIN.<br/>"
    return f"""
<section class="visit">
  <h2>{_esc(visit.get('name') or visit.get('email'))} {badge}</h2>
  <div class="meta">
    {_esc(visit.get('email'))} · {_esc(visit.get('username'))}<br/>
    {invite_line}
    {_esc(visit.get('browser'))} on {_esc(visit.get('os'))} ({_esc(visit.get('device'))})<br/>
    Address: {_esc(visit.get('ip') or 'unknown')}<br/>
    Signed in {_esc(_fmt_ts(visit.get('signed_in_at')))}
    · last seen {_esc(_fmt_ts(visit.get('last_seen_at')))}
    · {_esc(_reason_label(visit.get('end_reason')) or visit.get('status'))}
    · {int(visit.get('duration_seconds') or 0)} seconds
  </div>
  {table}
</section>
"""


def _pdf_heading(visit: Dict[str, Any]) -> str:
    name = visit.get("name") or visit.get("email") or "Visitor"
    return f"{name}  ({visit.get('email') or ''})  [{visit.get('id')}]"


def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _simple_pdf(lines: List[str]) -> bytes:
    """A small multi-page PDF of plain text. No third-party library."""
    page_size = 46
    pages = [lines[i:i + page_size] for i in range(0, max(len(lines), 1), page_size)] or [[]]
    objects: List[bytes] = []

    def add(data: bytes) -> int:
        objects.append(data)
        return len(objects)

    font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    content_ids = []
    for page_lines in pages:
        commands = ["BT", "/F1 10 Tf", "14 TL", "48 780 Td"]
        for line in page_lines:
            safe = _pdf_escape(line)[:220]
            commands.append(f"({safe}) Tj")
            commands.append("T*")
        commands.append("ET")
        stream = "\n".join(commands).encode("latin-1", "replace")
        content_ids.append(add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"))
    pages_id = len(objects) + 1 + len(content_ids)
    page_ids = []
    for content_id in content_ids:
        page_ids.append(len(objects) + 1)
        objects.append(
            (
                f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 612 792] "
                f"/Contents {content_id} 0 R /Resources << /Font << /F1 {font_id} 0 R >> >> >>"
            ).encode("latin-1")
        )
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    pages_obj_id = add(f"<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>".encode("latin-1"))
    catalog_id = add(f"<< /Type /Catalog /Pages {pages_obj_id} 0 R >>".encode("latin-1"))

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{index} 0 obj\n".encode("latin-1"))
        out.write(obj)
        out.write(b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    out.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.write(f"{offset:010d} 00000 n \n".encode("latin-1"))
    out.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("latin-1")
    )
    return out.getvalue()


def attach_audit_event(
    username: str,
    event_type: str,
    details: Optional[Dict[str, Any]] = None,
    workspace_id: Optional[str] = None,
    tty: Optional[str] = None,
    timestamp: Optional[float] = None,
    dedupe_seconds: float = 0,
) -> Optional[Dict[str, Any]]:
    """Attach an audit-hook event to the caller's open visit. Never raises.

    Returns {"visit_id", "recorded"}. recorded is False when a duplicate was
    skipped, so the desktop mirror can skip it too. None means the helper
    failed and the caller should still mirror the line.
    """
    try:
        store = get_visit_store()
        details = dict(details or {})
        if event_type == "login_failed":
            store.record_failed_login(
                identifier=username,
                reason=str(details.get("reason") or ""),
                ip=str(details.get("ip") or ""),
                user_agent=str(details.get("user_agent") or ""),
                ts=timestamp,
            )
            return {"visit_id": None, "recorded": True}
        if not username or username == "owner":
            return {"visit_id": None, "recorded": True}
        active = store.active_visit_for(username)
        if not active:
            return {"visit_id": None, "recorded": True}
        event_id = store.append_event(
            active["id"],
            event_type,
            details,
            workspace_id=workspace_id,
            tty=tty,
            ts=timestamp,
            dedupe_seconds=dedupe_seconds,
        )
        if dedupe_seconds > 0 and event_id is None:
            return {"visit_id": active["id"], "recorded": False}
        return {"visit_id": active["id"] if event_id else None, "recorded": True}
    except Exception:
        return None


_visit_store: Optional[VisitStore] = None


def get_visit_store() -> VisitStore:
    global _visit_store
    if _visit_store is None:
        COLLAB_DIR.mkdir(parents=True, exist_ok=True)
        _visit_store = VisitStore(COLLAB_DIR / "visits.sqlite")
    return _visit_store


def set_visit_store(store: Optional[VisitStore]) -> None:
    global _visit_store
    _visit_store = store


def sweep_from_settings() -> List[Dict[str, str]]:
    """Close stale visits using the owner's idle setting, then drop old records."""
    try:
        from collab_store import get_collab_store
        settings_store = get_collab_store()
        idle = settings_store.idle_timeout_seconds()
        retention = settings_store.retention_days()
    except Exception:
        idle = 1800
        retention = 90
    store = get_visit_store()
    closed = store.sweep(idle_seconds=idle)
    if closed:
        try:
            from collab_store import get_collab_store
            accounts = get_collab_store()
            for item in closed:
                accounts.revoke_token_prefix(item["username"], item.get("token_prefix") or "")
        except Exception:
            pass
    try:
        store.purge(retention)
    except Exception:
        pass
    return closed
