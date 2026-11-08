"""Automated tests for Qwen Prime Orchestrator (supports both unittest and pytest)."""

import asyncio
import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path

from backend.qwen_orchestrator.hardware import get_hardware_profile, HostHardwareProfile
from backend.qwen_orchestrator.ollama_engine import (
    OllamaEngine,
    OllamaProbe,
    QwenModelBenchmark,
    ollama_profile_section,
)
from backend.qwen_orchestrator.prime_intelligence import (
    PrimeIntelligenceEngine,
    PrimeOrchestrationPlan,
    PlannedSubtask,
)
from backend.qwen_orchestrator.router import QwenTaskRouter
from backend.qwen_orchestrator.local_runtimes import lmstudio_chat_models, read_prefs
from backend.qwen_orchestrator.memory import QwenMemory


class TestQwenOrchestrator(unittest.TestCase):
    def test_hardware_profiling(self):
        """Verify hardware profiler returns valid host specifications."""
        profile = get_hardware_profile()
        self.assertIsInstance(profile, HostHardwareProfile)
        self.assertGreaterEqual(profile.cpu_cores, 1)
        self.assertGreater(profile.total_ram_gb, 0)
        self.assertGreater(len(profile.chip_brand), 0)
        self.assertGreater(len(profile.hardware_summary), 0)
        self.assertGreater(profile.safe_max_model_bytes, 0)
        self.assertIn(profile.recommended_model_tier, ("7b", "9b", "14b", "30b"))

    def test_qwen_model_benchmark_sorting(self):
        """Verify model benchmarks identify fastest and agentic models."""
        engine = OllamaEngine()
        models = [
            QwenModelBenchmark(
                model_name="qwen2.5-coder:7b",
                eval_tok_per_sec=88.5,
                prompt_eval_tok_per_sec=320.0,
                status="benchmarked",
            ),
            QwenModelBenchmark(
                model_name="qwen3.5-agentic:latest",
                eval_tok_per_sec=45.2,
                prompt_eval_tok_per_sec=210.0,
                is_agentic=True,
                has_thinking=True,
                status="benchmarked",
            ),
            QwenModelBenchmark(
                model_name="qwen3-coder:30b",
                eval_tok_per_sec=22.1,
                prompt_eval_tok_per_sec=140.0,
                status="benchmarked",
            ),
        ]

        fastest = engine.select_optimal_model(strategy="fastest", installed=models)
        self.assertEqual(fastest, "qwen2.5-coder:7b")

        reasoning = engine.select_optimal_model(strategy="reasoning", installed=models)
        self.assertEqual(reasoning, "qwen3.5-agentic:latest")

    def test_prime_intelligence_prompt_assembly(self):
        """Verify layered system prompt contains core, usage, and opinionated layers."""
        engine = PrimeIntelligenceEngine()
        sys_prompt = engine.assemble_system_prompt(
            workspace_context="Workspace: MyProject (/tmp/test)",
            terminals_context="ttys001: Claude Code",
        )
        self.assertIn("PRIME-AGENT INTELLIGENCE HARNESS", sys_prompt)
        self.assertIn("PRINCIPLES OF EXECUTION", sys_prompt)
        self.assertIn("USAGE GUIDELINES & RIGOR", sys_prompt)
        self.assertIn("OPINIONATED AUTONOMY & REASONING", sys_prompt)
        self.assertIn("MyProject", sys_prompt)
        self.assertIn("Claude Code", sys_prompt)

    def test_prime_intelligence_json_extraction(self):
        """Verify extraction of plan JSON from text, markdown fences, and raw strings."""
        engine = PrimeIntelligenceEngine()

        raw_json = '{"thinking": "Decomposing task", "subtasks": [{"title": "Run tests", "target_tty": "ttys001", "command": "pytest"}]}'
        parsed = engine._extract_json_plan(raw_json)
        self.assertEqual(parsed.get("thinking"), "Decomposing task")
        self.assertEqual(len(parsed.get("subtasks", [])), 1)

        fenced_json = 'Here is the plan:\n```json\n{"thinking": "Fenced plan", "subtasks": [{"title": "Lint", "target_tty": "ttys002", "command": "npm run lint"}]}\n```'
        parsed_fenced = engine._extract_json_plan(fenced_json)
        self.assertEqual(parsed_fenced.get("thinking"), "Fenced plan")
        self.assertEqual(len(parsed_fenced.get("subtasks", [])), 1)

    def test_qwen_task_router(self):
        """Verify task router registers plans, retrieves them, and executes dispatch."""
        router = QwenTaskRouter()
        plan = PrimeOrchestrationPlan(
            plan_id="plan-test-123",
            user_goal="Test router execution",
            selected_model="qwen2.5-coder:7b",
            thinking_process="Testing dispatch pipeline",
            subtasks=[
                PlannedSubtask(
                    id="plan-test-123-1",
                    title="Task 1",
                    target_tty="ttys001",
                    command="echo 1",
                ),
                PlannedSubtask(
                    id="plan-test-123-2",
                    title="Task 2",
                    target_tty="ttys002",
                    command="echo 2",
                ),
            ],
            status="planned",
        )

        router.register_plan(plan)
        retrieved = router.get_plan("plan-test-123")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.plan_id, "plan-test-123")

        dispatched = []

        async def fake_sender(tty: str, cmd: str):
            dispatched.append((tty, cmd))

        async def run_dispatch():
            return await router.dispatch_plan("plan-test-123", terminal_sender=fake_sender)

        result = asyncio.run(run_dispatch())
        self.assertTrue(result["ok"])
        self.assertEqual(result["dispatched_count"], 2)
        self.assertEqual(len(dispatched), 2)
        self.assertEqual(dispatched[0], ("ttys001", "echo 1"))
        self.assertEqual(dispatched[1], ("ttys002", "echo 2"))
        self.assertEqual(plan.status, "sent")


def _hw(safe_bytes: int, tier: str = "7b") -> HostHardwareProfile:
    return HostHardwareProfile(
        os_name="Darwin",
        architecture="arm64",
        chip_brand="Test Chip",
        cpu_cores=8,
        total_ram_gb=24,
        available_ram_gb=18,
        safe_max_model_bytes=safe_bytes,
        recommended_model_tier=tier,
    )


class TestLocalModelSelection(unittest.TestCase):
    def test_installed_models_keep_non_qwen(self):
        engine = OllamaEngine()
        engine.list_models = lambda: [
            {
                "name": "llama3.2:latest",
                "size": 200 * 1024 * 1024,
                "details": {"family": "llama", "parameter_size": "3B"},
            },
            {
                "name": "qwen2.5-coder:7b",
                "size": int(round(4.36 * 1024**3)),
                "details": {"family": "qwen2", "parameter_size": "7B"},
            },
        ]
        installed = engine.get_installed_models()
        self.assertEqual(
            [m.model_name for m in installed],
            ["llama3.2:latest", "qwen2.5-coder:7b"],
        )
        self.assertFalse(installed[0].is_qwen)
        self.assertEqual(installed[0].size_formatted, "200 MB")
        self.assertTrue(installed[1].is_qwen)
        self.assertEqual(installed[1].size_formatted, "4.36 GB")
        self.assertEqual(
            [m.model_name for m in engine.get_qwen_models()],
            ["qwen2.5-coder:7b"],
        )

    def test_fastest_skips_model_larger_than_ram(self):
        engine = OllamaEngine()
        gb = 1024**3
        models = [
            QwenModelBenchmark(
                model_name="qwen2.5-coder:7b",
                parameter_size="7B",
                size_bytes=4 * gb,
                is_qwen=True,
            ),
            QwenModelBenchmark(
                model_name="llama3:70b",
                parameter_size="70B",
                size_bytes=40 * gb,
                is_qwen=False,
            ),
        ]
        picked = engine.select_optimal_model("fastest", installed=models, hardware=_hw(18 * gb, "30b"))
        self.assertEqual(picked, "qwen2.5-coder:7b")
        self.assertIn("llama3:70b", [m.model_name for m in models])

    def test_fastest_prefers_smaller_fitting_tier(self):
        engine = OllamaEngine()
        gb = 1024**3
        models = [
            QwenModelBenchmark(model_name="qwen-coder:30b", parameter_size="30B", size_bytes=18 * gb, is_qwen=True),
            QwenModelBenchmark(model_name="qwen-coder:14b", parameter_size="14B", size_bytes=9 * gb, is_qwen=True),
        ]
        picked = engine.select_optimal_model("fastest", installed=models, hardware=_hw(24 * gb, "30b"))
        self.assertEqual(picked, "qwen-coder:14b")

    def test_benchmarked_fastest_ignores_oversized_speed(self):
        engine = OllamaEngine()
        gb = 1024**3
        models = [
            QwenModelBenchmark(model_name="small", parameter_size="7B", size_bytes=4 * gb, eval_tok_per_sec=40),
            QwenModelBenchmark(model_name="huge", parameter_size="70B", size_bytes=40 * gb, eval_tok_per_sec=200),
        ]
        picked = engine.select_optimal_model("fastest", installed=models, hardware=_hw(18 * gb))
        self.assertEqual(picked, "small")

    def test_reasoning_picks_agentic_model_that_fits(self):
        engine = OllamaEngine()
        gb = 1024**3
        models = [
            QwenModelBenchmark(model_name="qwen2.5-coder:7b", parameter_size="7B", size_bytes=4 * gb, is_qwen=True),
            QwenModelBenchmark(
                model_name="qwen3.5-agentic:latest",
                parameter_size="9B",
                size_bytes=6 * gb,
                is_qwen=True,
                is_agentic=True,
            ),
        ]
        picked = engine.select_optimal_model("reasoning", installed=models, hardware=_hw(18 * gb, "9b"))
        self.assertEqual(picked, "qwen3.5-agentic:latest")

    def test_empty_install_does_not_query_ollama(self):
        engine = OllamaEngine()

        def boom():
            raise AssertionError("select_optimal_model queried Ollama")

        engine.get_installed_models = boom  # type: ignore[method-assign]
        self.assertEqual(engine.select_optimal_model("fastest", installed=[]), "")
        self.assertEqual(engine.select_optimal_model("reasoning", installed=[], hardware=_hw(8 * 1024**3)), "")

    def test_empty_roster_does_not_invent_a_terminal(self):
        engine = PrimeIntelligenceEngine()
        plan = engine.orchestrate_task("audit the repo", terminals=[], model="qwen2.5-coder:7b")
        self.assertEqual(plan.subtasks, [])
        dumped = plan.model_dump_json()
        self.assertNotIn("ttys001", dumped)
        self.assertNotIn("ttys001", plan.thinking_process)
        self.assertIn("No terminals", plan.thinking_process)

    def test_orchestrate_drops_tty_outside_roster(self):
        engine = PrimeIntelligenceEngine()

        def fake_chat(**_kwargs):
            return {
                "content": json.dumps({
                    "thinking": "split the work",
                    "subtasks": [
                        {"title": "bad", "target_tty": "ttys999", "command": "echo bad"},
                        {"title": "good", "target_tty": "sess-1", "command": "echo ok"},
                    ],
                }),
                "thinking": "",
                "eval_tok_per_sec": 10,
            }

        engine.ollama.generate_chat = fake_chat  # type: ignore[method-assign]
        plan = engine.orchestrate_task(
            "go",
            terminals=[{"tty": "sess-1", "label": "Pane A", "cli": "zsh"}],
            model="qwen2.5-coder:7b",
        )
        self.assertEqual([s.target_tty for s in plan.subtasks], ["sess-1"])
        self.assertEqual(plan.allowed_ttys, ["sess-1"])

    def test_router_skips_tty_outside_roster(self):
        router = QwenTaskRouter()
        plan = PrimeOrchestrationPlan(
            plan_id="plan-allow",
            user_goal="stay inside the workspace",
            selected_model="qwen2.5-coder:7b",
            thinking_process="roster lock",
            allowed_ttys=["ttys001"],
            subtasks=[
                PlannedSubtask(id="a", title="ok", target_tty="ttys001", command="echo 1"),
                PlannedSubtask(id="b", title="no", target_tty="ttys999", command="echo bad"),
            ],
        )
        router.register_plan(plan)
        dispatched = []

        async def fake_sender(tty: str, cmd: str):
            dispatched.append((tty, cmd))

        result = asyncio.run(router.dispatch_plan("plan-allow", terminal_sender=fake_sender))
        self.assertEqual(dispatched, [("ttys001", "echo 1")])
        self.assertNotIn(("ttys999", "echo bad"), dispatched)
        self.assertTrue(result["ok"])
        self.assertEqual(result["dispatched_count"], 1)


class TestOllamaProbe(unittest.TestCase):
    def test_hanging_peer_times_out(self):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        stop = threading.Event()

        def hold():
            server.settimeout(0.2)
            while not stop.is_set():
                try:
                    conn, _addr = server.accept()
                except OSError:
                    continue
                conn.settimeout(2)
                try:
                    time.sleep(2)
                finally:
                    conn.close()

        thread = threading.Thread(target=hold, daemon=True)
        thread.start()
        engine = OllamaEngine(f"http://127.0.0.1:{port}", connect_timeout=0.2, read_timeout=0.3)
        started = time.time()
        try:
            probe = engine.probe()
        finally:
            stop.set()
            server.close()
        elapsed = time.time() - started
        self.assertFalse(probe.ok)
        self.assertEqual(probe.reason, "timeout")
        self.assertLess(elapsed, 2.0)

    def test_connection_refused_is_not_retried_into_a_long_wait(self):
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        engine = OllamaEngine(f"http://127.0.0.1:{port}", connect_timeout=0.3, read_timeout=5.0)
        started = time.time()
        probe = engine.probe()
        elapsed = time.time() - started
        self.assertFalse(probe.ok)
        self.assertEqual(probe.reason, "refused")
        self.assertLess(elapsed, 1.5)

    def test_offline_profile_does_not_list_models(self):
        engine = OllamaEngine("http://127.0.0.1:9")

        def boom():
            raise AssertionError("listed models while the probe was down")

        engine.probe = lambda: OllamaProbe(  # type: ignore[method-assign]
            ok=False,
            reason="refused",
            version="unavailable",
            url="http://127.0.0.1:9",
            error="ConnectionRefusedError",
        )
        engine.get_installed_models = boom  # type: ignore[method-assign]
        section = ollama_profile_section(engine)
        self.assertFalse(section["ollama"]["available"])
        self.assertEqual(section["ollama"]["version"], "unavailable")
        self.assertEqual(section["ollama"]["reason"], "refused")
        self.assertEqual(section["models"], [])
        self.assertEqual(section["models_status"], "skipped")


class TestPlanDoesNotPaste(unittest.TestCase):
    def test_chat_error_does_not_paste_the_prompt(self):
        engine = PrimeIntelligenceEngine()

        def boom(**_kwargs):
            raise RuntimeError("offline")

        engine.ollama.generate_chat = boom  # type: ignore[method-assign]
        prompt = "audit the repo and run the tests"
        plan = engine.orchestrate_task(
            prompt,
            terminals=[{"tty": "sess-1", "cli": "codex"}, {"tty": "sess-2", "cli": "zsh"}],
            model="qwen2.5-coder:7b",
        )
        self.assertEqual(plan.subtasks, [])
        self.assertEqual(plan.status, "failed")
        self.assertEqual(plan.user_goal, prompt)

    def test_prose_reply_does_not_split_or_paste(self):
        engine = PrimeIntelligenceEngine()

        def prose(**_kwargs):
            return {"content": "Sure, I will look around the repository.", "thinking": "", "eval_tok_per_sec": 1}

        engine.ollama.generate_chat = prose  # type: ignore[method-assign]
        prompt = "audit the repo and run the tests"
        plan = engine.orchestrate_task(
            prompt,
            terminals=[{"tty": "sess-1", "cli": "codex"}],
            model="llama3.2:latest",
        )
        self.assertEqual(plan.subtasks, [])
        self.assertEqual(plan.status, "failed")
        self.assertEqual(plan.user_goal, prompt)
        self.assertNotIn("sess-1", "".join(step.command for step in plan.subtasks))

    def test_codex_roster_stays_codex(self):
        engine = PrimeIntelligenceEngine()

        def fake_chat(**kwargs):
            self.assertIn("CLI: codex", kwargs["system_prompt"])
            self.assertIn("Model: llama3.2:latest", kwargs["system_prompt"])
            return {
                "content": json.dumps({
                    "thinking": "one pane",
                    "subtasks": [{
                        "title": "Ask Codex",
                        "target_tty": "sess-1",
                        "command": "Review the auth middleware",
                        "action_type": "shell_command",
                    }],
                }),
                "thinking": "",
                "eval_tok_per_sec": 1,
            }

        engine.ollama.generate_chat = fake_chat  # type: ignore[method-assign]
        plan = engine.orchestrate_task(
            "review auth",
            terminals=[{"tty": "sess-1", "label": "Codex", "cli": "codex"}],
            model="llama3.2:latest",
            memory_text="prior goal: fix the badge",
        )
        self.assertEqual(len(plan.subtasks), 1)
        self.assertEqual(plan.subtasks[0].cli, "codex")
        self.assertEqual(plan.subtasks[0].action_type, "agent_prompt")
        self.assertNotEqual(plan.subtasks[0].command, "review auth")

    def test_package_does_not_call_the_word_splitter(self):
        root = Path(__file__).resolve().parents[1] / "qwen_orchestrator"
        text = "\n".join(path.read_text() for path in root.glob("*.py"))
        self.assertNotIn("_deterministic_split", text)


class TestLocalRuntimesAndMemory(unittest.TestCase):
    def test_lmstudio_keeps_only_loaded_chat_models(self):
        names = lmstudio_chat_models({
            "data": [
                {"id": "qwen3.5-9b-mlx", "type": "llm", "state": "not-loaded"},
                {"id": "text-embedding-nomic", "type": "embeddings", "state": "loaded"},
                {"id": "qwen2.5-7b-instruct", "type": "llm", "state": "loaded"},
            ]
        })
        self.assertEqual(names, ["qwen2.5-7b-instruct"])

    def test_dead_pref_file_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            import os
            os.environ["QWEN_PREFS_PATH"] = str(Path(tmp) / "missing.json")
            try:
                self.assertEqual(read_prefs(), {"runtime": "", "model": ""})
            finally:
                os.environ.pop("QWEN_PREFS_PATH", None)

    def test_memory_block_is_workspace_scoped(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = QwenMemory(Path(tmp) / "qwen.sqlite")
            store.record_run(
                plan_id="p1",
                workspace_id="ws-a",
                workspace_name="A",
                project_path="/a",
                runtime="ollama",
                model="llama3.2:latest",
                strategy="fastest",
                user_goal="fix the badge",
                plan_json="{}",
                status="sent",
            )
            store.record_steps("p1", [{
                "session_id": "sess-1",
                "cli": "codex",
                "action_type": "agent_prompt",
                "command": "look at the badge",
                "outcome": "sent",
                "error": "",
            }])
            store.record_run(
                plan_id="p2",
                workspace_id="ws-b",
                workspace_name="B",
                project_path="/b",
                runtime="ollama",
                model="llama3.2:latest",
                strategy="fastest",
                user_goal="foreign goal",
                plan_json="{}",
                status="sent",
            )
            block = store.prompt_block(workspace_id="ws-a")
            self.assertIn("fix the badge", block)
            self.assertNotIn("foreign goal", block)
            self.assertEqual(store.prompt_block(workspace_id="missing"), "")

    def test_missing_memory_file_does_not_raise_on_read(self):
        store = QwenMemory(Path(tempfile.mkdtemp()) / "nope" / "qwen.sqlite")
        self.assertEqual(store.prompt_block(workspace_id="ws"), "")

    def test_client_results_keep_the_failure_and_skip_a_second_writer(self):
        router = QwenTaskRouter()
        plan = PrimeOrchestrationPlan(
            plan_id="plan-client",
            user_goal="Review auth",
            selected_model="qwen2.5-7b-instruct",
            thinking_process="",
            subtasks=[
                PlannedSubtask(
                    id="a",
                    title="Ask",
                    target_tty="sess-1",
                    cli="codex",
                    command="Review auth",
                    action_type="agent_prompt",
                ),
                PlannedSubtask(
                    id="b",
                    title="Miss",
                    target_tty="sess-2",
                    cli="codex",
                    command="npm test",
                    action_type="agent_prompt",
                ),
            ],
        )
        router.register_plan(plan)
        result = router.apply_client_results("plan-client", [
            {"id": "a", "status": "sent"},
            {"id": "b", "status": "failed", "error": "Terminal is not open"},
        ])
        self.assertTrue(result["ok"])
        self.assertEqual(result["plan_status"], "partial")
        self.assertEqual(result["dispatched_count"], 1)
        self.assertEqual(plan.subtasks[0].status, "sent")
        self.assertEqual(plan.subtasks[0].error, "")
        self.assertEqual(plan.subtasks[1].status, "failed")
        self.assertEqual(plan.subtasks[1].error, "Terminal is not open")

        missed = PrimeOrchestrationPlan(
            plan_id="plan-miss",
            user_goal="Review auth",
            selected_model="qwen2.5-7b-instruct",
            thinking_process="",
            subtasks=[PlannedSubtask(id="only", title="Ask", target_tty="sess-1", command="Review auth")],
        )
        router.register_plan(missed)
        empty = router.apply_client_results("plan-miss", [])
        self.assertFalse(empty["ok"])
        self.assertEqual(empty["plan_status"], "failed")
        self.assertEqual(missed.subtasks[0].error, "only was not sent")

        with tempfile.TemporaryDirectory() as tmp:
            store = QwenMemory(Path(tmp) / "qwen.sqlite")
            store.record_run(
                plan_id="plan-client",
                workspace_id="ws-a",
                workspace_name="A",
                project_path="/a",
                runtime="ollama",
                model="qwen2.5-7b-instruct",
                strategy="fastest",
                user_goal="Review auth",
                plan_json="{}",
                status="partial",
            )
            store.record_steps("plan-client", [
                {
                    "session_id": step.target_tty,
                    "cli": step.cli,
                    "action_type": step.action_type,
                    "command": step.command,
                    "outcome": step.status,
                    "error": step.error,
                }
                for step in plan.subtasks
            ])
            block = store.prompt_block(workspace_id="ws-a")
            self.assertIn("Review auth", block)
            self.assertIn("Terminal is not open", block)
            self.assertIn("sess-1", block)


if __name__ == "__main__":
    unittest.main()
