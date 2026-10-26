"""Task Dispatcher & Terminal Router for Qwen Prime Orchestrator.
Dispatches planned subtasks to target terminals and tracks execution progress.
"""

import asyncio
import inspect
import time
from typing import Dict, List, Any, Optional, Callable
from .prime_intelligence import PrimeOrchestrationPlan, PlannedSubtask


class QwenTaskRouter:
    def __init__(self):
        self._plans: Dict[str, PrimeOrchestrationPlan] = {}

    def register_plan(self, plan: PrimeOrchestrationPlan) -> None:
        """Store a plan in the router registry."""
        self._plans[plan.plan_id] = plan
        # Retain last 30 plans
        if len(self._plans) > 30:
            oldest_keys = sorted(self._plans.keys(), key=lambda k: self._plans[k].created_at)[:len(self._plans)-30]
            for k in oldest_keys:
                self._plans.pop(k, None)

    def get_plan(self, plan_id: str) -> Optional[PrimeOrchestrationPlan]:
        """Retrieve a plan by its ID."""
        return self._plans.get(plan_id)

    def list_plans(self, limit: int = 15) -> List[PrimeOrchestrationPlan]:
        """List recent orchestration plans, newest first."""
        plans = sorted(self._plans.values(), key=lambda p: p.created_at, reverse=True)
        return plans[:limit]

    async def dispatch_plan(
        self,
        plan_id: str,
        subtasks_to_run: Optional[List[PlannedSubtask]] = None,
        terminal_sender: Optional[Callable[[str, str], Any]] = None,
    ) -> Dict[str, Any]:
        """Dispatch subtasks to their target terminals."""
        plan = self._plans.get(plan_id)
        if not plan:
            return {"ok": False, "error": f"Plan {plan_id} not found"}

        tasks = subtasks_to_run or plan.subtasks
        dispatched_count = 0
        errors = []

        plan.status = "executing"

        allowed = None if plan.allowed_ttys is None else set(plan.allowed_ttys)

        for task in tasks:
            tty = task.target_tty
            cmd = task.command.strip()
            if not tty or not cmd:
                task.status = "failed"
                errors.append(f"Missing TTY or command for task {task.id}")
                continue
            if allowed is not None and tty not in allowed:
                task.status = "failed"
                errors.append(f"TTY {tty} is outside the workspace roster")
                continue

            try:
                task.status = "queued"
                if terminal_sender is not None:
                    # Async or sync call
                    if inspect.iscoroutinefunction(terminal_sender):
                        await terminal_sender(tty, cmd)
                    else:
                        terminal_sender(tty, cmd)
                task.status = "running"
                dispatched_count += 1
            except Exception as exc:
                task.status = "failed"
                errors.append(f"Failed to dispatch to {tty}: {exc}")

        if dispatched_count > 0 and len(errors) == 0:
            plan.status = "completed"
        elif dispatched_count > 0:
            plan.status = "partial"
        else:
            plan.status = "failed"

        return {
            "ok": dispatched_count > 0,
            "dispatched_count": dispatched_count,
            "errors": errors,
            "plan_status": plan.status,
        }
