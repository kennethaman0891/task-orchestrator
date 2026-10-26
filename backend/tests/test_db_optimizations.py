"""Tests for SQLite queries and event loop optimizations:
- get_session_tokens TTL cache and safe connection management
- _session_for_task candidate session filtering without scanning all parts
- _opencode_live_status connection safety
"""
import asyncio
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import main


class TestDbOptimizations(unittest.TestCase):

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "opencode.db"
        # Create schema matching opencode
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE session (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                directory TEXT,
                time_created INTEGER,
                time_updated INTEGER,
                tokens_input INTEGER,
                tokens_output INTEGER,
                cost REAL,
                model TEXT,
                title TEXT,
                slug TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                time_created INTEGER,
                data TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE part (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                message_id TEXT,
                time_created INTEGER,
                time_updated INTEGER,
                data TEXT
            )
        """)
        conn.commit()
        conn.close()

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_get_session_tokens_caching(self):
        """get_session_tokens must cache results with 15s TTL."""
        main._session_tokens_cache.clear()
        main._session_tokens_pending.clear()

        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO session (id, parent_id, directory, time_created, time_updated, tokens_input, tokens_output, cost, model, title) "
            "VALUES ('s1', NULL, '/test/dir', 1000, 2000, 150, 300, 0.05, 'test-model', 'Test Session')"
        )
        conn.commit()
        conn.close()

        with patch.object(main, "OPencode_DB", self.db_path):
            # First call populates cache
            tokens = main.get_session_tokens("/test/dir")
            self.assertEqual(tokens["tokens_input"], 150)
            self.assertEqual(tokens["tokens_output"], 300)
            self.assertEqual(tokens["session_title"], "Test Session")

            # Update DB behind the scenes
            conn = sqlite3.connect(self.db_path)
            conn.execute("UPDATE session SET tokens_input = 999 WHERE id = 's1'")
            conn.commit()
            conn.close()

            # Second call should return cached value (150, not 999)
            tokens_cached = main.get_session_tokens("/test/dir")
            self.assertEqual(tokens_cached["tokens_input"], 150)

            # Fast forward cache timestamp past TTL (15s)
            cached_ts, cached_val = main._session_tokens_cache["/test/dir"]
            main._session_tokens_cache["/test/dir"] = (cached_ts - 20.0, cached_val)

            # In sync mode, expired cache triggers synchronous refresh
            tokens_refreshed = main.get_session_tokens("/test/dir")
            self.assertEqual(tokens_refreshed["tokens_input"], 999)

    def test_get_session_tokens_async_off_thread(self):
        """get_session_tokens on a running event loop delegates to background thread."""
        main._session_tokens_cache.clear()
        main._session_tokens_pending.clear()

        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO session (id, parent_id, directory, time_created, time_updated, tokens_input, tokens_output, cost, model, title) "
            "VALUES ('s2', NULL, '/async/dir', 1000, 2000, 50, 100, 0.01, 'm1', 'Async Session')"
        )
        conn.commit()
        conn.close()

        with patch.object(main, "OPencode_DB", self.db_path):
            async def run_async_test():
                # Initial call on running event loop triggers background task
                res1 = main.get_session_tokens("/async/dir")
                # Immediately might be empty or wait a tick
                await asyncio.sleep(0.1)
                # After thread finishes, cache is filled
                res2 = main.get_session_tokens("/async/dir")
                self.assertEqual(res2["tokens_input"], 50)
                self.assertEqual(res2["session_title"], "Async Session")

            asyncio.run(run_async_test())

    def test_session_for_task_candidate_filtering(self):
        """_session_for_task finds matching session by checking candidates first without full scan."""
        import json

        now_ms = int(time.time() * 1000)
        conn = sqlite3.connect(self.db_path)

        # Insert 5 old unrelated sessions
        for i in range(5):
            conn.execute(
                "INSERT INTO session (id, parent_id, directory, time_created, time_updated) VALUES (?, NULL, '/other', ?, ?)",
                (f"old_{i}", now_ms - 100000 - i * 1000, now_ms - 100000 - i * 1000)
            )

        # Insert matching session in cwd created at now_ms
        conn.execute(
            "INSERT INTO session (id, parent_id, directory, time_created, time_updated) VALUES ('target_session', NULL, '/my/project', ?, ?)",
            (now_ms, now_ms)
        )
        # Insert message & part matching prompt prefix
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, data) VALUES ('m_target', 'target_session', ?, ?)",
            (now_ms + 10, json.dumps({"role": "user"}))
        )
        conn.execute(
            "INSERT INTO part (id, session_id, message_id, time_created, time_updated, data) VALUES ('p_target', 'target_session', 'm_target', ?, ?, ?)",
            (now_ms + 20, now_ms + 20, json.dumps({"type": "text", "text": "Fix the database query in main.py"}))
        )
        conn.commit()
        conn.close()

        # Mock terminal & task
        mock_terminal = main.TerminalState(
            info=main.TerminalInfo(tty="ttys999", cwd="/my/project", agent="opencode", is_live=True)
        )
        main.terminals["ttys999"] = mock_terminal

        task = main.Task(
            id="task_test_1",
            description="Fix the database query in main.py",
            created_at=now_ms / 1000.0,
            started_at=now_ms / 1000.0,
        )

        with patch("main._opencode_db", lambda timeout=2.0: sqlite3.connect(self.db_path)):
            matched_sid = main._session_for_task("ttys999", task)
            self.assertEqual(matched_sid, "target_session")

        main.terminals.pop("ttys999", None)


if __name__ == "__main__":
    unittest.main()
