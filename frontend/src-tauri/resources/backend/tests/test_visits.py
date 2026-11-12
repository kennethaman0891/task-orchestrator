"""Visitor records: lifecycle, timeline, idle close, owner-only access, export, hashes."""
import os
import tempfile
import time
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import collab_store
import visit_store
from audit import AuditEvent
from collab_store import CollabStore
from routers import collab as collab_router
from tunnel import TunnelManager, access_snapshot, find_cloudflared
from visit_activity import classify_request
from visit_store import VisitStore


class VisitTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.accounts = CollabStore(self.base / "collab")
        self.visits = VisitStore(self.base / "collab" / "visits.sqlite")
        collab_store._collab_store = self.accounts
        visit_store.set_visit_store(self.visits)
        if hasattr(collab_router.login, "_failed_attempts"):
            collab_router.login._failed_attempts.clear()
        app = FastAPI()
        app.include_router(collab_router.router)
        self.owner = TestClient(app)
        self.visitor = TestClient(app, client=("203.0.113.10", 4242))

    def tearDown(self):
        try:
            self.visits.close()
        except Exception:
            pass
        visit_store.set_visit_store(None)
        collab_store._collab_store = None
        self.tmp.cleanup()

    def _invite_user(self, email="ada@example.com", pin="correct-pin", name="Ada Lovelace"):
        user = self.accounts.create_user(email, pin, name=name, permission="worker")
        return user

    def _login(self, client, email="ada@example.com", pin="correct-pin", ua="Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0"):
        return client.post(
            "/api/collab/login",
            json={"email": email, "pin": pin},
            headers={"User-Agent": ua},
        )


class TestVisitLifecycle(VisitTestCase):
    def test_login_command_logout_timeline(self):
        self._invite_user()
        res = self._login(self.visitor)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertTrue(body["token"])
        self.assertIn("tto_collab_session", res.cookies)

        listed = self.owner.get("/api/collab/visits")
        self.assertEqual(listed.status_code, 200, listed.text)
        visits = listed.json()["visits"]
        self.assertEqual(len(visits), 1)
        visit = visits[0]
        self.assertEqual(visit["email"], "ada@example.com")
        self.assertEqual(visit["name"], "Ada Lovelace")
        self.assertEqual(visit["status"], "active")
        self.assertEqual(visit["ip"], "203.0.113.10")
        self.assertEqual(visit["browser"], "Chrome")
        self.assertEqual(visit["os"], "Linux")
        self.assertTrue(visit["verified"])
        self.assertGreaterEqual(visit["duration_seconds"], 0)

        import asyncio
        from audit import audit_command
        asyncio.run(audit_command("ada@example.com", "/work/demo", "ttyS1", "echo hello-visit"))

        detail = self.owner.get(f"/api/collab/visits/{visit['id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        full = detail.json()["visit"]
        types = [event["type"] for event in full["events"]]
        self.assertIn("login", types)
        self.assertIn("command", types)
        command = next(event for event in full["events"] if event["type"] == "command")
        self.assertEqual(command["details"]["command"], "echo hello-visit")
        self.assertEqual(command["tty"], "ttyS1")
        self.assertTrue(full["verified"])

        token = body["token"]
        out = self.visitor.post("/api/collab/logout", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(out.status_code, 200, out.text)
        closed = self.owner.get(f"/api/collab/visits/{visit['id']}").json()["visit"]
        self.assertEqual(closed["status"], "ended")
        self.assertEqual(closed["end_reason"], "logout")
        self.assertIsNotNone(closed["signed_out_at"])
        self.assertTrue(closed["verified"])
        self.assertGreaterEqual(closed["duration_seconds"], 0)
        ended = [event for event in closed["events"] if event["type"] == "visit_ended"]
        self.assertEqual(ended[-1]["details"]["reason"], "logout")

    def test_failed_logins_keep_ip(self):
        self._invite_user()
        unknown = self.visitor.post("/api/collab/login", json={"email": "nobody@example.com", "pin": "wrong-pin"})
        self.assertEqual(unknown.status_code, 401)
        bad = self.visitor.post("/api/collab/login", json={"email": "ada@example.com", "pin": "not-the-pin"})
        self.assertEqual(bad.status_code, 401)
        failed = self.owner.get("/api/collab/visits", params={"status": "failed"}).json()["visits"]
        reasons = {item["end_reason"] for item in failed}
        self.assertIn("user_not_found", reasons)
        self.assertIn("bad_pin", reasons)
        self.assertTrue(all(item["ip"] == "203.0.113.10" for item in failed))
        # A normal visit list does not mix failed attempts in.
        self.assertEqual(self.owner.get("/api/collab/visits").json()["visits"], [])

    def test_idle_timeout_and_tab_close(self):
        self._invite_user()
        self.assertEqual(self._login(self.visitor).status_code, 200)
        visit_id = self.owner.get("/api/collab/visits").json()["visits"][0]["id"]
        now = time.time()
        # Recent heartbeat, but no real work for a long time.
        self.visits._conn.execute(
            "UPDATE visits SET last_activity_at = ?, last_seen_at = ? WHERE id = ?",
            (now - 4000, now - 5, visit_id),
        )
        self.visits._conn.commit()
        closed = self.visits.sweep(now=now, idle_seconds=1800, tab_close_seconds=75)
        self.assertEqual(closed[0]["reason"], "idle_timeout")
        ended = self.visits.get_visit(visit_id)
        self.assertEqual(ended["end_reason"], "idle_timeout")
        self.assertTrue(ended["verified"])

        # A second visit that was active and then the tab stopped checking in.
        self.accounts.revoke_user("ada@example.com")
        self.accounts._users["ada@example.com"].revoked = False
        self.accounts._save_users()
        self.assertEqual(self._login(self.visitor).status_code, 200)
        second = [item for item in self.owner.get("/api/collab/visits").json()["visits"] if item["status"] == "active"][0]
        now = time.time()
        self.visits._conn.execute(
            "UPDATE visits SET last_activity_at = ?, last_seen_at = ? WHERE id = ?",
            (now - 10, now - 120, second["id"]),
        )
        self.visits._conn.commit()
        closed = self.visits.sweep(now=now, idle_seconds=1800, tab_close_seconds=75)
        self.assertEqual(closed[0]["id"], second["id"])
        self.assertEqual(closed[0]["reason"], "tab_close")
        self.assertEqual(self.visits.get_visit(second["id"])["end_reason"], "tab_close")

    def test_owner_can_end_and_revoke_blocks_collaborator_routes(self):
        self._invite_user()
        token = self._login(self.visitor).json()["token"]
        visit_id = self.owner.get("/api/collab/visits").json()["visits"][0]["id"]

        denied = self.visitor.get("/api/collab/visits", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(denied.status_code, 403)
        denied_settings = self.visitor.get("/api/collab/settings", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(denied_settings.status_code, 403)
        # No token at all, from outside this machine.
        self.assertEqual(self.visitor.get("/api/collab/visits").status_code, 403)

        ended = self.owner.post(f"/api/collab/visits/{visit_id}/end")
        self.assertEqual(ended.status_code, 200, ended.text)
        self.assertEqual(ended.json()["visit"]["end_reason"], "revoked")
        # The sign-in no longer works.
        again = self.visitor.get("/api/collab/session", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(again.status_code, 401)

        self.accounts.revoke_user("ada@example.com")
        self.accounts._users["ada@example.com"].revoked = False
        self.accounts._save_users()
        token = self._login(self.visitor).json()["token"]
        blocked = self.owner.post("/api/collab/users/ada@example.com/revoke")
        self.assertEqual(blocked.status_code, 200, blocked.text)
        active = [item for item in self.owner.get("/api/collab/visits").json()["visits"] if item["status"] == "active"]
        self.assertEqual(active, [])

    def test_export_and_hash(self):
        self._invite_user()
        self._login(self.visitor)
        import asyncio
        from audit import audit_command
        asyncio.run(audit_command("ada@example.com", "/work/demo", "ttyS1", "ls -la"))
        visit = self.owner.get("/api/collab/visits").json()["visits"][0]
        csv_res = self.owner.get("/api/collab/visits/export", params={"format": "csv", "id": visit["id"]})
        self.assertEqual(csv_res.status_code, 200, csv_res.text)
        self.assertIn("text/csv", csv_res.headers["content-type"])
        self.assertIn(visit["id"], csv_res.text)
        self.assertIn("ls -la", csv_res.text)
        self.assertIn("Ada Lovelace", csv_res.text)

        html_res = self.owner.get("/api/collab/visits/export", params={"format": "html", "id": visit["id"]})
        self.assertEqual(html_res.status_code, 200)
        self.assertIn("Ada Lovelace", html_res.text)
        self.assertIn("ls -la", html_res.text)
        self.assertIn("Verified", html_res.text)

        pdf_res = self.owner.get("/api/collab/visits/export", params={"format": "pdf", "id": visit["id"]})
        self.assertEqual(pdf_res.status_code, 200)
        self.assertTrue(pdf_res.content.startswith(b"%PDF"))
        self.assertIn(b"%%EOF", pdf_res.content)

        # Tampering with an activity line breaks verification.
        self.visits._conn.execute(
            "UPDATE visit_events SET details_json = ? WHERE visit_id = ? AND event_type = 'command'",
            ('{"command":"rm -rf /"}', visit["id"]),
        )
        self.visits._conn.commit()
        tampered = self.visits.get_visit(visit["id"])
        self.assertFalse(tampered["verified"])
        self.assertIn("activity", tampered["verify_reason"].lower())

    def test_retention_purges_old_ended_visits_only(self):
        opened = self.visits.open_visit(
            username="old@example.com", email="old@example.com", name="Old",
            ip="198.51.100.4", user_agent="curl/8.0", auth_method="pin",
            signed_in_at=time.time() - 100 * 86400,
        )
        self.visits.close_visit(opened["id"], "logout", ts=time.time() - 99 * 86400)
        recent = self.visits.open_visit(
            username="new@example.com", email="new@example.com", name="New",
            ip="198.51.100.5", user_agent="curl/8.0",
        )
        self.visits.record_failed_login("ghost@example.com", "bad_pin", "198.51.100.9", ts=time.time() - 100 * 86400)
        removed = self.visits.purge(30)
        self.assertGreaterEqual(removed, 2)
        self.assertIsNone(self.visits.get_visit(opened["id"]))
        self.assertIsNotNone(self.visits.get_visit(recent["id"]))
        self.assertEqual(self.visits.list_visits(status="failed"), [])

    def test_desktop_line_includes_visit_id(self):
        line = AuditEvent(
            timestamp=time.time(),
            username="ada@example.com",
            event_type="command",
            details={"command": "pwd"},
            visit_id="abc123visit",
            tty="ttyS0",
        ).to_txt_line()
        self.assertIn("[visit abc123visit]", line)
        self.assertIn("pwd", line)

    def test_activity_classifier_reuses_audit_types(self):
        command = classify_request(
            "POST", "/api/terminals/ttyS0/command", 200,
            b'{"command":"git status"}',
        )
        self.assertEqual(command["event_type"], "command")
        self.assertEqual(command["details"]["command"], "git status")
        denied = classify_request("POST", "/api/terminals/ttyS0/command", 403, b"{}")
        self.assertEqual(denied["event_type"], "denied")
        started = classify_request("POST", "/api/orchestrator/run", 200, b'{"task":"ship the report","workspace_id":"ws1"}')
        self.assertEqual(started["event_type"], "orchestrator_started")
        self.assertEqual(started["workspace_id"], "ws1")
        # Secrets are not copied into the timeline.
        hidden = classify_request("POST", "/api/file", 200, b'{"path":"notes.txt","pin":"secret-pin"}')
        self.assertNotIn("pin", hidden["details"])


class TestTunnelAndLan(unittest.TestCase):
    def test_missing_cloudflared_is_a_clean_no(self):
        manager = TunnelManager()
        # Point the lookup at an empty directory so a machine that happens to
        # have cloudflared still exercises the "not installed" path.
        empty = tempfile.mkdtemp()
        old = os.environ.get("PATH")
        os.environ["PATH"] = empty
        try:
            self.assertIsNone(find_cloudflared())
            status = manager.start(port=9, timeout=0.2)
        finally:
            if old is None:
                os.environ.pop("PATH", None)
            else:
                os.environ["PATH"] = old
        self.assertFalse(status["available"])
        self.assertFalse(status["running"])
        self.assertIsNone(status["url"])
        self.assertIn("cloudflared", status["error"])

    def test_access_snapshot_lists_urls_only_when_lan_is_on(self):
        off = access_snapshot(False)
        self.assertEqual(off["lan_urls"], [])
        self.assertTrue(off["localhost_url"].startswith("http://127.0.0.1:"))
        on = access_snapshot(True)
        self.assertIsInstance(on["lan_urls"], list)
        for url in on["lan_urls"]:
            self.assertTrue(url.startswith("http://"))
            self.assertNotIn("127.0.0.1", url)


if __name__ == "__main__":
    unittest.main()
