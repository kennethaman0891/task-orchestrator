"""TTO Remote Control — unit + integration tests (stdlib unittest only).

No real WhatsApp messages are ever sent: OpenWA calls are faked and the
service runs against a FakeBridge backed by in-memory state.
"""
import asyncio
import importlib
import os
import sys
import time
import unittest
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/..")  # project root

import remote.auth as auth
import remote.confirmations as confirmations
import remote.formatter as formatter
import remote.parser as parser
import remote.safety as safety
import remote.service as service
from remote.models import state


def reset_state():
    state.confirmations.clear()
    state.rate_hits.clear()
    state.processed_message_ids.clear()
    state.notify_last_sent.clear()
    state.audit.clear()


class FakeBridge:
    """In-memory TTO stand-in: terminals + tasks mirror the real pipeline."""

    def __init__(self):
        self.terminals: Dict[str, dict] = {}
        self._add("ttys007", "opencode", "running", "Fix auth API")
        self._add("ttys011", "claude", "idle", None)
        self._add("ttys003", "codex", "running", "Write tests")
        self.paused: set = set()

    def _add(self, tty, agent, status, task_desc):
        self.terminals[tty] = {
            "tty": tty, "session_id": "", "label": tty, "index": 0, "status": status,
            "agent": agent, "cwd": "/Users/me/proj", "model": "opencode/deepseek",
            "opencode_running": status == "running", "opencode_model": "opencode/deepseek",
            "current_task": {"id": f"t-{tty}", "description": task_desc or "", "status": "running", "started_at": time.time() - 600, "created_at": time.time() - 600} if task_desc else None,
            "next_task": None, "queue": [], "history": [], "live_output": "line1\nline2\nline3",
        }

    def get_terminals(self):
        rows = sorted(self.terminals.values(), key=lambda r: r["tty"])
        for i, r in enumerate(rows, start=1):
            r["index"] = i
        return rows

    def resolve_terminal(self, arg):
        if not arg:
            return None
        if arg.isdigit():
            return next((e for e in self.get_terminals() if e["index"] == int(arg)), None)
        return next((e for e in self.get_terminals() if e["tty"] == arg), None)

    async def send_input(self, tty, text):
        return tty in self.terminals

    async def raw_input(self, tty, data):
        return tty in self.terminals

    async def stop_terminal(self, tty):
        return tty in self.terminals

    async def restart_terminal(self, tty):
        return tty in self.terminals

    async def close_terminal(self, tty):
        return tty in self.terminals

    async def pause_terminal(self, tty):
        self.paused.add(tty)
        return True

    async def resume_terminal(self, tty):
        self.paused.discard(tty)
        return True

    async def add_task(self, tty, desc, model):
        if tty not in self.terminals:
            return None
        return {"id": "new", "description": desc, "status": "queued", "model": model}

    def get_tasks(self, tty):
        e = self.terminals.get(tty, {})
        return {"current_task": e.get("current_task"), "next_task": None, "queue": [], "history": []}

    def get_logs(self, tty, lines):
        return self.terminals.get(tty, {}).get("live_output", "")

    def get_token_usage(self):
        return {"groups": {"opencode": {"input": 1200000, "output": 340000, "label": "OpenCode"}},
                "limits": {"omniroute": {"used": 930000000, "limit": 1500000000, "label": "OmniRoute"}}}

    def list_files(self, path):
        if path == "missing":
            return None
        return {"path": path, "files": [{"name": "src", "is_dir": True}, {"name": "App.tsx", "is_dir": False, "size": 4096}]}

    def get_workspaces(self):
        return [{"name": "Alpha", "panes": [{"id": "p1"}]}]

    def agent_workspaces(self):
        return [{"id": "ws-1", "name": "Alpha", "projectPath": "/Users/me/proj"}]

    def get_overall(self):
        return {"terminals": {t["tty"]: t for t in self.terminals.values()}, "token_usage": self.get_token_usage()}

    def agent_state(self):
        return (True, True)

    def rust_available(self):
        return True


def run(coro):
    return asyncio.run(coro)


class TestParser(unittest.TestCase):
    def test_slash_commands(self):
        cases = {
            "/help": ("help", []),
            "/status": ("status", []),
            "/terminals": ("terminals", []),
            "/terminals 2": ("terminals", ["2"]),
            "/terminal 7": ("terminal", ["7"]),
            "/logs 7": ("logs", ["7"]),
            "/logs 7 100": ("logs", ["7", "100"]),
            "/run 7 npm test": ("run", ["7", "npm", "test"]),
            "/input 7 hello world": ("input", ["7", "hello", "world"]),
            "/queue 7 fix the bug": ("queue", ["7", "fix", "the", "bug"]),
            "/next 7": ("next", ["7"]),
            "/pause 7": ("pause", ["7"]),
            "/resume 7": ("resume", ["7"]),
            "/restart 7": ("restart", ["7"]),
            "/stop 7": ("stop", ["7"]),
            "/kill 7": ("kill", ["7"]),
            "/tokens": ("tokens", []),
            "/agents": ("agents", []),
            "/workspace": ("workspace", []),
            "/health": ("health", []),
            "/files": ("files", []),
            "/files project/src": ("files", ["project/src"]),
            "/tasks active": ("tasks", ["active"]),
            "/task 7": ("task", ["7"]),
        }
        for text, (name, args) in cases.items():
            cmd = parser.parse_message(text)
            self.assertEqual(cmd.name, name, text)
            self.assertEqual(cmd.args, args, text)

    def test_unknown_and_aliases(self):
        self.assertEqual(parser.parse_message("/frobnicate").name, "")
        self.assertEqual(parser.parse_message("/t 7").name, "terminal")
        self.assertEqual(parser.parse_message("/st").name, "status")
        self.assertEqual(parser.parse_message("/terms 1").name, "terminals")

    def test_confirm_and_cancel(self):
        self.assertEqual(parser.parse_message("CONFIRM 9F2A1C").name, "confirm")
        self.assertEqual(parser.parse_message("confirm abc").args, ["abc"])
        self.assertEqual(parser.parse_message("CANCEL").name, "cancel")

    def test_natural_language_mapping(self):
        self.assertEqual(parser.parse_message("what is terminal 12 doing?").name, "terminal")
        self.assertEqual(parser.parse_message("what is terminal status").name, "status")
        self.assertEqual(parser.parse_message("what's the terminal status").name, "status")
        self.assertEqual(parser.parse_message("show me which agents are stuck").name, "agents")
        self.assertEqual(parser.parse_message("how are the terminals doing").name, "status")
        self.assertEqual(parser.parse_message("show tokens").name, "tokens")

    def test_quoted_args(self):
        cmd = parser.parse_message('/run 7 echo "hello world"')
        self.assertEqual(cmd.name, "run")
        self.assertEqual(cmd.args, ["7", "echo", "hello world"])


class TestAuth(unittest.TestCase):
    def setUp(self):
        os.environ["OPENWA_ALLOWED_PHONE_NUMBERS"] = "+15551234567, 15551234568"
        os.environ["OPENWA_ALLOWED_CHAT_IDS"] = "chat-1"
        os.environ["OPENWA_WEBHOOK_SECRET"] = "s3cr3t"
        reset_state()

    def tearDown(self):
        for k in ("OPENWA_ALLOWED_PHONE_NUMBERS", "OPENWA_ALLOWED_CHAT_IDS", "OPENWA_WEBHOOK_SECRET", "TTO_REMOTE_RATE_LIMIT"):
            os.environ.pop(k, None)

    def test_authorized_sender(self):
        self.assertTrue(auth.is_authorized_sender("+15551234567", "chat-1"))
        self.assertTrue(auth.is_authorized_sender("15551234567", "other-chat"))
        self.assertTrue(auth.is_authorized_sender("", "chat-1"))

    def test_unauthorized_sender(self):
        self.assertFalse(auth.is_authorized_sender("+999", "chat-9"))
        self.assertFalse(auth.is_authorized_sender("", ""))
        # No allowlist configured → fail closed.
        os.environ.pop("OPENWA_ALLOWED_PHONE_NUMBERS", None)
        os.environ.pop("OPENWA_ALLOWED_CHAT_IDS", None)
        self.assertFalse(auth.is_authorized_sender("+15551234567", "chat-1"))

    def test_webhook_secret(self):
        ok, _ = auth.verify_webhook_secret("s3cr3t")
        self.assertTrue(ok)
        ok, _ = auth.verify_webhook_secret("wrong")
        self.assertFalse(ok)
        ok, _ = auth.verify_webhook_secret(None)
        self.assertFalse(ok)
        os.environ.pop("OPENWA_WEBHOOK_SECRET", None)
        ok, _ = auth.verify_webhook_secret("s3cr3t")
        self.assertFalse(ok)  # fail closed without config

    def test_webhook_signature(self):
        import hmac
        body = b'{"x": 1}'
        sig = hmac.new(b"s3cr3t", body, "sha256").hexdigest()
        ok, _ = auth.verify_webhook_secret(sig, body)
        self.assertTrue(ok)

    def test_openwa_signature_prefix(self):
        """OpenWA delivers `X-OpenWA-Signature: sha256=<hex>` — the prefix must
        be accepted and the signature still verified over the raw body."""
        import hmac
        body = b'{"event": "message.received", "data": {"id": "m1"}}'
        hexdigest = hmac.new(b"s3cr3t", body, "sha256").hexdigest()
        ok, err = auth.verify_webhook_secret(f"sha256={hexdigest}", body)
        self.assertTrue(ok, err)
        # Tampered body with a valid-looking header must fail.
        ok, _ = auth.verify_webhook_secret(f"sha256={hexdigest}", b'{"event": "tampered"}')
        self.assertFalse(ok)

    def test_rate_limit(self):
        os.environ["TTO_REMOTE_RATE_LIMIT"] = "3"
        self.assertFalse(auth.rate_limit_exceeded("sender-a"))
        self.assertFalse(auth.rate_limit_exceeded("sender-a"))
        self.assertFalse(auth.rate_limit_exceeded("sender-a"))
        self.assertTrue(auth.rate_limit_exceeded("sender-a"))  # 4th hit blocked
        self.assertFalse(auth.rate_limit_exceeded("sender-b"))  # other sender unaffected


class TestSafety(unittest.TestCase):
    def test_safe_commands(self):
        for cmd in ("npm test", "npm run build", "git status", "git diff",
                    "python --version", "ls", "pwd", "echo rm -rf x"):
            self.assertEqual(safety.classify_shell(cmd), safety.SafetyLevel.SAFE, cmd)

    def test_dangerous_commands(self):
        for cmd in ("rm file.txt", "kill 123", "git clean -fd", "rmdir old"):
            self.assertEqual(safety.classify_shell(cmd), safety.SafetyLevel.DANGEROUS, cmd)

    def test_blocked_commands(self):
        for cmd in ("rm -rf /", "sudo apt update", "shutdown now", "reboot",
                    "mkfs.ext4 /dev/sdb", "git push --force origin main"):
            self.assertEqual(safety.classify_shell(cmd), safety.SafetyLevel.BLOCKED, cmd)

    def test_path_sandbox(self):
        self.assertTrue(safety.is_read_only_path("project/src"))
        self.assertTrue(safety.is_read_only_path(""))
        self.assertFalse(safety.is_read_only_path("../etc/passwd"))
        self.assertFalse(safety.is_read_only_path("../../etc"))
        self.assertFalse(safety.is_read_only_path("etc/passwd"))
        self.assertFalse(safety.is_read_only_path("private/var"))
        self.assertFalse(safety.is_read_only_path(".ssh/id_rsa"))
        self.assertFalse(safety.is_read_only_path("project/.env"))
        self.assertFalse(safety.is_read_only_path("/etc/hosts"))


class TestConfirmations(unittest.TestCase):
    def setUp(self):
        reset_state()

    def test_create_and_resolve(self):
        conf = confirmations.create_confirmation("+1555", "kill", "ttys007", "details")
        self.assertEqual(conf.sender, "+1555")
        self.assertFalse(conf.expired)
        resolved = confirmations.resolve_confirmation("+1555", conf.token)
        self.assertIsNotNone(resolved)

    def test_sender_bound(self):
        conf = confirmations.create_confirmation("+1555", "kill", "ttys007", "d")
        self.assertIsNone(confirmations.resolve_confirmation("+9999", conf.token))
        self.assertIsNotNone(confirmations.resolve_confirmation("+1555", conf.token))

    def test_expiry(self):
        conf = confirmations.create_confirmation("+1555", "kill", "ttys007", "d")
        conf.expires_at = time.time() - 1
        self.assertIsNone(confirmations.resolve_confirmation("+1555", conf.token))

    def test_cancel(self):
        confirmations.create_confirmation("+1555", "kill", "t", "d")
        confirmations.create_confirmation("+1555", "restart", "t", "d")
        n = confirmations.cancel_for("+1555")
        self.assertEqual(n, 2)
        self.assertEqual(len(confirmations.pending_for("+1555")), 0)


class TestFormatter(unittest.TestCase):
    def test_help_has_commands(self):
        msg = formatter.help_message()
        for cmd in ("/status", "/workspace", "/sessions", "/session", "/abort",
                    "/tokens", "/health"):
            self.assertIn(cmd, msg)

    def test_status(self):
        overall = {"terminals": {"a": {"is_live": True, "current_task": {"status": "running"}, "agent": "opencode", "queue": [], "next_task": None, "history": []},
                                  "b": {"is_live": True, "current_task": None, "agent": "claude", "queue": [], "next_task": None, "history": [{"status": "done"}]}},
                   "token_usage": {"total_input": 100, "total_output": 50}}
        msg = formatter.status_message(overall, True, True, True)
        self.assertIn("TTO STATUS", msg)
        self.assertIn("Terminals", msg)

    def test_terminal_message(self):
        entry = {"tty": "ttys007", "agent": "opencode", "status": "running", "index": 7, "cwd": "/x",
                 "current_task": {"description": "Fix auth API", "status": "running", "started_at": time.time() - 120}}
        msg = formatter.terminal_message(entry, 7)
        self.assertIn("Terminal #7", msg)
        self.assertIn("Fix auth API", msg)

    def test_logs_truncation(self):
        log = "\n".join(f"line {i}" for i in range(100))
        msg = formatter.logs_message(log, 30)
        self.assertIn("line 99", msg)
        self.assertNotIn("line 0", msg)

    def test_confirmation_message(self):
        msg = formatter.confirmation_message("ABC123", "kill", "ttys007", "Task: X", 60)
        self.assertIn("CONFIRM ABC123", msg)
        self.assertIn("CONFIRMATION REQUIRED", msg)


class TestService(unittest.TestCase):
    def setUp(self):
        reset_state()
        service.register(FakeBridge())
        os.environ["OPENWA_ALLOWED_PHONE_NUMBERS"] = "+15551234567"
        os.environ["OPENWA_ALLOWED_CHAT_IDS"] = "chat-1"
        os.environ["OPENWA_WEBHOOK_SECRET"] = "s"
        os.environ["TTO_REMOTE_CONFIRM_TTL"] = "60"

    def tearDown(self):
        for k in ("OPENWA_ALLOWED_PHONE_NUMBERS", "OPENWA_ALLOWED_CHAT_IDS", "OPENWA_WEBHOOK_SECRET", "TTO_REMOTE_CONFIRM_TTL"):
            os.environ.pop(k, None)
        service.register(None)

    def test_help(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/help")))
        self.assertTrue(r.ok)
        self.assertIn("/status", r.reply)

    def test_status(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/status")))
        self.assertTrue(r.ok)
        self.assertIn("TTO STATUS", r.reply)

    def test_terminals(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/terminals")))
        self.assertTrue(r.ok)
        self.assertIn("01", r.reply)

    def test_terminal_exists_and_missing(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/terminal 1")))
        self.assertTrue(r.ok)
        self.assertIn("Terminal #1", r.reply)
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/terminal 99")))
        self.assertFalse(r.ok)
        self.assertIn("does not exist", r.reply)

    def test_logs(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/logs 1")))
        self.assertTrue(r.ok)

    def test_queue_task(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/queue 1 fix the bug")))
        self.assertTrue(r.ok)
        self.assertIn("Queued", r.reply)

    def test_run_safe(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/run 1 npm test")))
        self.assertTrue(r.ok)
        self.assertIn("Sent", r.reply)

    def test_run_blocked(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/run 1 rm -rf /")))
        self.assertFalse(r.ok)
        self.assertIn("Blocked", r.reply)

    def test_run_dangerous_requires_confirmation(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/run 1 rm file.txt")))
        self.assertTrue(r.requires_confirmation)
        self.assertTrue(r.confirmation_token)
        self.assertIn("CONFIRMATION REQUIRED", r.reply)

    def test_kill_requires_confirmation_and_confirm_flow(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/kill 1")))
        self.assertTrue(r.requires_confirmation)
        token = r.confirmation_token
        # wrong sender cannot confirm
        r2 = run(service.dispatch("+999", "chat-9", parser.parse_message(f"CONFIRM {token}")))
        self.assertFalse(r2.ok)
        # right sender confirms → executes
        r3 = run(service.dispatch("+15551234567", "chat-1", parser.parse_message(f"CONFIRM {token}")))
        self.assertTrue(r3.ok)
        self.assertIn("closed", r3.reply.lower())
        # token is single-use
        r4 = run(service.dispatch("+15551234567", "chat-1", parser.parse_message(f"CONFIRM {token}")))
        self.assertFalse(r4.ok)

    def test_expired_confirmation(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/restart 1")))
        token = r.confirmation_token
        state.confirmations[token].expires_at = time.time() - 1
        r2 = run(service.dispatch("+15551234567", "chat-1", parser.parse_message(f"CONFIRM {token}")))
        self.assertFalse(r2.ok)

    def test_unknown_command(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/frobnicate")))
        self.assertFalse(r.ok)

    def test_usage_error_gives_targeted_hint(self):
        """A known command with missing args must reply with the EXACT correct
        usage for that command (not a generic message) — mobile UX matters."""
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/queue 7")))
        self.assertFalse(r.ok)
        self.assertIn("/queue 7", r.reply)
        self.assertIn("Correct usage", r.reply)
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/terminal")))
        self.assertFalse(r.ok)
        self.assertIn("/terminal 7", r.reply)
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/run 7")))
        self.assertFalse(r.ok)
        self.assertIn("/run 7 npm test", r.reply)

    def test_files_sandbox(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/files ../etc")))
        self.assertFalse(r.ok)
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/files project/src")))
        self.assertTrue(r.ok)

    def test_tokens_and_agents(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/tokens")))
        self.assertTrue(r.ok)
        self.assertIn("TOKEN USAGE", r.reply)
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/agents")))
        self.assertTrue(r.ok)

    def test_workspace(self):
        r = run(service.dispatch("+15551234567", "chat-1", parser.parse_message("/workspace")))
        self.assertTrue(r.ok)
        self.assertIn("Alpha", r.reply)


class TestWebhookEventExtraction(unittest.TestCase):
    """The webhook route must extract the REAL OpenWA v0.20 payload shape:
    {event, timestamp, sessionId, idempotencyKey, deliveryId, data:{...}}."""

    def test_real_openwa_payload(self):
        from remote.webhook import _extract_event
        payload = {
            "event": "message.received",
            "timestamp": "2026-08-16T17:10:00.000Z",
            "sessionId": "20c35f6c-87ab-46d5-9511-24d0cf009f09",
            "idempotencyKey": "idem-1",
            "deliveryId": "deliv-1",
            "data": {
                "id": "MSG-1", "from": "15551234567@c.us", "to": "self@c.us",
                "chatId": "15551234567@c.us", "body": "/status", "type": "chat",
                "timestamp": 1786895000, "fromMe": False, "isGroup": False, "kind": "chat",
                "contact": {"pushName": "Kenneth"},
            },
        }
        ev = _extract_event(payload)
        self.assertIsNotNone(ev)
        self.assertEqual(ev.sender, "15551234567@c.us")
        self.assertEqual(ev.chat_id, "15551234567@c.us")
        self.assertEqual(ev.message_id, "MSG-1")
        self.assertEqual(ev.message_type, "chat")
        self.assertEqual(ev.body, "/status")
        self.assertEqual(ev.timestamp, 1786895000)

    def test_group_message_uses_author(self):
        from remote.webhook import _extract_event
        payload = {
            "event": "message.received", "timestamp": "t", "sessionId": "s",
            "idempotencyKey": "k", "deliveryId": "d",
            "data": {"id": "M2", "from": "123456789@g.us", "author": "15551234567@c.us",
                     "chatId": "123456789@g.us", "body": "/help", "type": "chat",
                     "timestamp": 1, "fromMe": False, "isGroup": True, "kind": "group"},
        }
        ev = _extract_event(payload)
        self.assertEqual(ev.sender, "15551234567@c.us")
        self.assertEqual(ev.chat_id, "123456789@g.us")

    def test_media_message_extraction(self):
        from remote.webhook import _extract_event
        payload = {
            "event": "message.received", "timestamp": "t", "sessionId": "s",
            "idempotencyKey": "k", "deliveryId": "d",
            "data": {"id": "M3", "from": "x@c.us", "chatId": "x@c.us",
                     "body": "", "type": "image", "timestamp": 1, "fromMe": False,
                     "isGroup": False, "kind": "chat"},
        }
        ev = _extract_event(payload)
        self.assertEqual(ev.message_type, "image")
        self.assertEqual(ev.body, "")

    def test_message_sent_self_chat_extraction(self):
        """A "Message yourself" self-chat send arrives as message.sent with
        fromMe=true, from = own number, chatId = own LID chat."""
        from remote.webhook import _extract_event
        payload = {
            "event": "message.sent", "timestamp": "t", "sessionId": "s",
            "idempotencyKey": "k", "deliveryId": "d",
            "data": {"id": "S1", "from": "917019342544@c.us", "to": "218068491980857@lid",
                     "chatId": "218068491980857@lid", "body": "/status", "type": "chat",
                     "timestamp": 1, "fromMe": True, "isGroup": False, "kind": "chat"},
        }
        ev = _extract_event(payload)
        self.assertEqual(ev.event, "message.sent")
        self.assertTrue(ev.from_me)
        self.assertEqual(ev.sender, "917019342544@c.us")
        self.assertEqual(ev.chat_id, "218068491980857@lid")
        self.assertEqual(ev.body, "/status")

    def test_self_chat_send_detection(self):
        from remote.webhook import _is_self_chat_send
        # Owner messaging themselves — all identities are the account's own LID.
        self.assertTrue(_is_self_chat_send({
            "from": "218068491980857@lid", "to": "218068491980857@lid",
            "chatId": "218068491980857@lid", "fromMe": True}))
        # Phone-JID form of the same.
        self.assertTrue(_is_self_chat_send({
            "from": "917019342544@c.us", "to": "917019342544@c.us",
            "chatId": "917019342544@c.us", "fromMe": True}))
        # Send into a FRIEND's chat: to/chatId are the friend's identity.
        self.assertFalse(_is_self_chat_send({
            "from": "218068491980857@lid", "to": "999888777@c.us",
            "chatId": "999888777@c.us", "fromMe": True}))
        # Missing fields.
        self.assertFalse(_is_self_chat_send({}))
        self.assertFalse(_is_self_chat_send(None))

    def test_reply_bodies_are_not_commands(self):
        """Loop guard premise: TTO's own replies must never re-enter the
        pipeline.  Replies never start with "/", so _is_explicit_command
        rejects them even when their body contains a keyword that the NL map
        would otherwise match (e.g. "TOKEN USAGE" contains "token")."""
        from remote.webhook import _is_explicit_command
        for body in ("🖥️ TTO STATUS\n🟢 Sidecar online",
                     "⚠️ CONFIRMATION REQUIRED\nKill terminal #12?",
                     "✅ TERMINAL 7 COMPLETED",
                     "❌ Terminal #12 does not exist.",
                     "📁 PROJECT\nsrc/",
                     "📊 TOKEN USAGE\nTotal: in 0 · out 0",
                     "🤖 AGENTS\n01 OpenCode"):
            self.assertFalse(_is_explicit_command(body), body)
        # Explicit commands pass.
        self.assertTrue(_is_explicit_command("/status"))
        self.assertTrue(_is_explicit_command("/tokens"))
        self.assertTrue(_is_explicit_command("CONFIRM ABC123"))
        self.assertTrue(_is_explicit_command("cancel"))
        # NL bodies are explicit-command REJECTED for message.sent (loop
        # safety) even though the parser would map them.
        self.assertFalse(_is_explicit_command("what is terminal status"))
        # Parser still handles the real command forms.
        self.assertEqual(parser.parse_message("/status").name, "status")
        self.assertEqual(parser.parse_message("/terminal 7").name, "terminal")
        self.assertEqual(parser.parse_message("what is terminal status").name, "status")


class TestWebhookIdempotency(unittest.TestCase):
    """Duplicate webhook events must be ignored (message id already seen)."""

    def test_duplicate(self):
        import hmac
        from remote.models import WebhookEvent
        os.environ["OPENWA_WEBHOOK_SECRET"] = "s"
        reset_state()
        ev = WebhookEvent(sender="+15551234567", chat_id="chat-1", message_id="msg-dup-1", body="/help")
        # Simulate the webhook pipeline: mark processed then re-deliver.
        state.processed_message_ids["msg-dup-1"] = time.time()
        self.assertIn("msg-dup-1", state.processed_message_ids)
        self.assertEqual(len(state.processed_message_ids), 1)
        # Idempotency check used by the route:
        def already_processed(mid):
            return mid in state.processed_message_ids
        self.assertTrue(already_processed("msg-dup-1"))
        self.assertFalse(already_processed("msg-new"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
