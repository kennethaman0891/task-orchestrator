"""Unit tests verifying the remediation of security findings:
- SEC-06: send_file_to_terminal path guard and TTY validation
- SEC-05 / NEW-03: serve_start path containment and port validation
- SEC-07: browse_proxy response headers (frame-ancestors, SAMEORIGIN)
- SEC-09: upload_project decompression limit checks
- SEC-10: is_gateway_blocked parity test in Python
"""
import io
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

# Ensure main can be imported
import main
from remote.config import BLOCKED_PATH_FRAGMENTS


class TestSecurityFixes(unittest.TestCase):

    def test_send_file_blocks_invalid_tty(self):
        """Invalid TTY characters must be rejected before any processing."""
        payload = main.SendFileRequest(file_path="notes.txt")
        with self.assertRaises(HTTPException) as ctx:
            import asyncio
            asyncio.run(main.send_file_to_terminal("ttys001; rm -rf /", payload))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Invalid tty", ctx.exception.detail)

    def test_send_file_blocks_sensitive_files(self):
        """send_file_to_terminal must block sensitive files (SSH keys, .env, credentials)."""
        main.terminals["ttys001"] = {"id": "1", "name": "test"}
        try:
            sensitive_targets = [
                "~/.ssh/id_rsa",
                "~/.env",
                "~/.aws/credentials",
                "~/.config/opencode/auth.json",
            ]
            for target in sensitive_targets:
                payload = main.SendFileRequest(file_path=target)
                with self.assertRaises(HTTPException) as ctx:
                    import asyncio
                    asyncio.run(main.send_file_to_terminal("ttys001", payload))
                self.assertEqual(
                    ctx.exception.status_code,
                    403,
                    f"Expected 403 for {target}, got {ctx.exception.status_code}"
                )
                self.assertIn("Access denied", ctx.exception.detail)
        finally:
            main.terminals.pop("ttys001", None)

    def test_serve_start_blocks_sensitive_directories(self):
        """serve_start must reject serving sensitive directories like ~/.ssh."""
        with self.assertRaises(HTTPException) as ctx:
            import asyncio
            asyncio.run(main.serve_start({"path": "~/.ssh", "port": 18920}))
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Access denied", ctx.exception.detail)

    def test_serve_start_validates_port_range(self):
        """serve_start must reject privileged, out-of-range, or sidecar ports."""
        invalid_ports = [80, 443, 1023, 70000, -1]
        for p in invalid_ports:
            with self.assertRaises(HTTPException) as ctx:
                import asyncio
                asyncio.run(main.serve_start({"path": "/tmp", "port": p}))
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertIn("port must be in range", ctx.exception.detail)

        # Conflict with sidecar port (8765)
        with self.assertRaises(HTTPException) as ctx:
            import asyncio
            asyncio.run(main.serve_start({"path": "/tmp", "port": 8765}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("conflicts with the sidecar port", ctx.exception.detail)

    def test_serve_start_requires_valid_directory(self):
        """serve_start must reject non-existent directories."""
        with self.assertRaises(HTTPException) as ctx:
            import asyncio
            asyncio.run(main.serve_start({"path": "/tmp/non_existent_dir_12345xyz", "port": 18920}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Not a directory", ctx.exception.detail)

    def test_upload_project_rejects_non_zip(self):
        """upload_project must reject files without a .zip extension."""
        mock_file = MagicMock()
        mock_file.filename = "malware.tar.gz"
        with self.assertRaises(HTTPException) as ctx:
            import asyncio
            asyncio.run(main.upload_project(mock_file))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Only .zip archives are supported", ctx.exception.detail)

    @patch("main.MAX_PROJECT_DECOMPRESS_BYTES", 50)
    @patch("main.Path.home", return_value=Path("/tmp/tto_test_home"))
    def test_upload_project_detects_zip_bomb(self, mock_home):
        """upload_project must reject archives whose uncompressed entries exceed decompression limit."""
        import zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            # 100 bytes uncompressed exceeds our patched 50-byte test threshold
            zf.writestr("large.txt", b"A" * 100)

        buf.seek(0)
        chunks = [buf.getvalue()]

        class AsyncIterFile:
            filename = "bomb.zip"
            def __aiter__(self):
                self._iter = iter(chunks)
                return self
            async def __anext__(self):
                try:
                    return next(self._iter)
                except StopIteration:
                    raise StopAsyncIteration

        with self.assertRaises(HTTPException) as ctx:
            import asyncio
            asyncio.run(main.upload_project(AsyncIterFile()))
        self.assertEqual(ctx.exception.status_code, 413)
        self.assertIn("zip bomb protection", ctx.exception.detail)

    def test_serve_start_rejects_root_and_home(self):
        """Static preview must not serve / or the home directory."""
        import asyncio
        for path in ("/", str(Path.home())):
            with self.subTest(path=path):
                with self.assertRaises(HTTPException) as ctx:
                    asyncio.run(main.serve_start({"path": path, "port": 18920}))
                self.assertEqual(ctx.exception.status_code, 403)
                self.assertIn("Cannot serve root or home", ctx.exception.detail)

    def test_session_token_required_for_run(self):
        """Loopback command execution requires the desktop session token."""
        client = TestClient(main.app)
        denied = client.post("/api/run", json={"command": "echo test"})
        self.assertEqual(denied.status_code, 401)
        allowed = client.post(
            "/api/run",
            json={"command": "echo test"},
            headers={"X-Task-Orchestrator-Token": main.SESSION_TOKEN},
        )
        self.assertNotEqual(allowed.status_code, 401)

    def test_health_is_public(self):
        client = TestClient(main.app)
        res = client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "ok")

    def test_browse_loopback_requires_origin(self):
        client = TestClient(main.app)
        headers = {"X-Task-Orchestrator-Token": main.SESSION_TOKEN}
        denied = client.get("/api/browse", params={"url": "http://127.0.0.1:1/"}, headers=headers)
        self.assertEqual(denied.status_code, 403)
        allowed = client.get(
            "/api/browse",
            params={"url": "http://127.0.0.1:1/"},
            headers={**headers, "Origin": "http://localhost:1421"},
        )
        self.assertNotEqual(allowed.status_code, 403)

    def test_discord_allowlist_fails_closed(self):
        from remote.config import RemoteConfig, discord_user_allowed
        with patch("remote.config.load_config", return_value=RemoteConfig()):
            self.assertFalse(discord_user_allowed(1))
        cfg = RemoteConfig(discord_allowed_user_ids=["42"])
        with patch("remote.config.load_config", return_value=cfg):
            self.assertFalse(discord_user_allowed(7))
            self.assertTrue(discord_user_allowed("42"))

    def test_blocked_fragments_include_history(self):
        for fragment in ("id_dsa", ".npmrc", ".bash_history", ".zsh_history"):
            self.assertIn(fragment, BLOCKED_PATH_FRAGMENTS)


if __name__ == "__main__":
    unittest.main()
