"""Reverse-Engineered Prime-Agent Intelligence Core.
Implements the Recursive Language Model (RLM) layered prompting system
(core, usage, opinionated, skills) to decompose tasks and route actions across terminals.
"""

import json
import os
import re
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from .ollama_engine import OllamaEngine


class PlannedSubtask(BaseModel):
    id: str = Field(default="", description="Unique identifier for the subtask")
    title: str = Field(..., description="Short descriptive title")
    target_tty: str = Field(default="", description="Target terminal TTY (e.g. ttys001)")
    target_label: str = Field(default="", description="Target terminal label or name")
    target_workspace: str = Field(default="", description="Target workspace ID or name")
    action_type: str = Field(default="shell_command", description="shell_command | agent_prompt | file_edit | verify")
    command: str = Field(..., description="Exact command or prompt to send to the terminal")
    cwd: Optional[str] = Field(default=None, description="Working directory for this task")
    reasoning: str = Field(default="", description="Why this subtask is assigned to this terminal")
    cli: str = Field(default="", description="CLI detected on this pane. Session id stays target_tty.")
    error: str = Field(default="", description="Why a send failed. Empty after a successful send.")
    status: str = Field(default="pending", description="pending | queued | running | sent | done | failed")


class PrimeOrchestrationPlan(BaseModel):
    plan_id: str
    user_goal: str
    selected_model: str
    thinking_process: str
    system_profile_summary: str = ""
    subtasks: List[PlannedSubtask] = []
    status: str = "planned"  # planned | executing | completed | failed
    created_at: float = Field(default_factory=lambda: 0.0)
    # None keeps older plans unlocked. A list, including [], is the only
    # set of ttys dispatch is allowed to type into.
    allowed_ttys: Optional[List[str]] = None


# ── Prime-Agent Layered Prompts (Reverse-Engineered) ──────────────────────────

PRIME_CORE_LAYER = """
# PRIME-AGENT INTELLIGENCE HARNESS (RLM CORE)

You are the Prime Orchestrator, an autonomous task orchestration engine operating
within Task Orchestrator (TTO). You control a fleet of real terminal sessions and workspaces.

Your mandate is to analyze complex, high-level developer requests, deconstruct them with
first-principles reasoning, and route concrete sub-tasks to the most appropriate terminals.

## PRINCIPLES OF EXECUTION
1. PROGRAMMATIC DECOMPOSITION: Break high-level goals into independent, executable units of work.
2. CONTEXTUAL GROUNDING: Always align actions with the existing workspace structure and terminal runtimes.
3. PRECISE ROUTING:
   - Terminals running interactive agent CLIs (Claude Code, OpenCode, Codex, Prime) receive natural instructions.
   - Terminals running bash/zsh shells receive clean, fully-formed, non-interactive shell commands.
   - Separate review/test tasks from build/modify tasks so they can run concurrently without race conditions.
"""

PRIME_USAGE_LAYER = """
## USAGE GUIDELINES & RIGOR
- NEVER INVENT FILES: Base your operations only on detected files, project types, and established conventions.
- DEPENDENCY ORDERING: Commands that produce dependencies (e.g. npm install, pip install, build) must precede runs.
- CLEAN EXECUTION: Never output markdown commentary inside terminal command strings. Each command must be ready to execute as-is.
- VERIFICATION CONTRACT: Every plan must contain at least one verification step (e.g. running unit tests, linting, git status check, or curl test).
"""

PRIME_OPINIONATED_LAYER = """
## OPINIONATED AUTONOMY & REASONING
- HIGH AGENCY: If a task has ambiguities, make reasonable, safe engineering assumptions and proceed rather than halting.
- STRUCTURED THINKING: Always articulate your thought process:
  1. Goal Analysis: What is the desired end state?
  2. Workspace & Terminal Mapping: Which terminal is best equipped for each subtask?
  3. Execution Sequence: What runs first, what runs in parallel?
  4. Risk Mitigation: Are there destructive commands that require isolation?
"""


def _roster_ids(terminals: Optional[List[Dict[str, Any]]]) -> List[str]:
    roster: List[str] = []
    seen = set()
    for term in terminals or []:
        tty = (term.get("tty") or term.get("id") or "").strip()
        if tty and tty not in seen:
            seen.add(tty)
            roster.append(tty)
    return roster


AGENT_CLIS = {
    "claude", "codex", "opencode", "gemini", "cursor", "qwen",
    "antigravity", "grok", "aider", "prime", "prime-agent",
}
SHELL_CLIS = {"shell", "zsh", "bash", "sh", "fish"}
NON_PROMPT_CLIS = {"vim", "nvim", "htop", "top", "btop", "tmux"}


def action_for_cli(cli: str) -> str:
    """Agent panes get a natural-language prompt. A known shell gets a command."""
    name = (cli or "").strip().lower()
    if name in SHELL_CLIS:
        return "shell_command"
    if name in AGENT_CLIS or name.startswith("claude"):
        return "agent_prompt"
    return "agent_prompt"


class PrimeIntelligenceEngine:
    def __init__(self, ollama_engine: Optional[OllamaEngine] = None):
        self.ollama = ollama_engine or OllamaEngine()

    def assemble_system_prompt(
        self,
        workspace_context: str,
        terminals_context: str,
        observer: str = "",
        memory: str = "",
    ) -> str:
        """Compose the full layered Prime-Agent system prompt."""
        observed = f"\n## SELECTED MODEL\n{observer}\n" if observer else ""
        remembered = f"\n## PRIOR OUTCOMES\n{memory}\n" if memory else ""
        return f"""{PRIME_CORE_LAYER}
{observed}{remembered}

{PRIME_USAGE_LAYER}

{PRIME_OPINIONATED_LAYER}

## ACTIVE WORKSPACE CONTEXT:
{workspace_context or "No active workspace selected. Use current directory."}

## ACTIVE TERMINAL ROSTER:
{terminals_context or "No live terminals open. Create or recommend a new terminal."}

## REQUIRED OUTPUT FORMAT:
Respond with a single JSON object. No conversational filler. Use this exact schema:
{{
  "thinking": "Step-by-step reasoning explaining how the goal is deconstructed and which terminals are chosen.",
  "subtasks": [
    {{
      "title": "Short title",
      "target_tty": "exact tty or terminal-N matching the roster (or empty if creating one)",
      "target_label": "terminal name or label",
      "target_workspace": "workspace name or id",
      "action_type": "shell_command" or "agent_prompt",
      "command": "the exact shell command or prompt string to type into that terminal",
      "reasoning": "brief justification for this assignment"
    }}
  ]
}}
"""

    def orchestrate_task(
        self,
        user_prompt: str,
        workspace: Optional[Dict[str, Any]] = None,
        terminals: Optional[List[Dict[str, Any]]] = None,
        model: Optional[str] = None,
        strategy: str = "fastest",
        runtime: str = "ollama",
        runtime_url: str = "",
        hardware_summary: str = "",
        memory_text: str = "",
    ) -> PrimeOrchestrationPlan:
        """Analyze user prompt and orchestrate tasks using the selected Qwen model."""
        import time
        import uuid

        plan_id = f"plan-{str(uuid.uuid4())[:8]}"
        roster = _roster_ids(terminals)

        if not roster:
            return PrimeOrchestrationPlan(
                plan_id=plan_id,
                user_goal=user_prompt,
                selected_model=(model or "").strip(),
                thinking_process="No terminals are open in this workspace.",
                subtasks=[],
                allowed_ttys=[],
                status="planned",
                created_at=time.time(),
            )

        # 1. Resolve optimal model. Never invent a tag that is not installed.
        selected_model = (model or "").strip()
        if selected_model.lower().startswith("ollama/"):
            selected_model = selected_model.split("/", 1)[1]
        if not selected_model:
            selected_model = self.ollama.select_optimal_model(strategy=strategy)
        if not selected_model:
            return PrimeOrchestrationPlan(
                plan_id=plan_id,
                user_goal=user_prompt,
                selected_model="",
                thinking_process="No local model is installed.",
                subtasks=[],
                allowed_ttys=roster,
                status="planned",
                created_at=time.time(),
            )

        # 2. Build Workspace Context
        ws_info = "Default Workspace"
        ws_path = os.getcwd()
        if workspace:
            ws_name = workspace.get("name", "Workspace")
            ws_path = workspace.get("projectPath") or workspace.get("path") or os.getcwd()
            ws_id = workspace.get("id", "ws-1")
            
            # List files in workspace
            file_sample = []
            try:
                if os.path.isdir(ws_path):
                    for item in os.listdir(ws_path)[:20]:
                        if not item.startswith("."):
                            file_sample.append(item)
            except Exception:
                pass

            ws_info = f"- ID: {ws_id}\n- Name: {ws_name}\n- Path: {ws_path}\n- Root Entries: {', '.join(file_sample[:15])}"

        # 3. Build Terminals Context
        term_lines = []
        if terminals and len(terminals) > 0:
            for t in terminals:
                tty = t.get("tty") or t.get("id") or "unknown"
                label = t.get("label") or t.get("name") or tty
                cli = t.get("cli") or t.get("agent") or "shell"
                cwd = t.get("cwd") or ws_path
                status = "busy" if t.get("current_task") else "idle"
                term_lines.append(f"  - [{tty}] \"{label}\" | CLI: {cli} | CWD: {cwd} | State: {status}")
            terms_info = "\n".join(term_lines)
        else:
            terms_info = "No live terminals open in this workspace."

        # 4. Assemble system prompt. The model sees its own name, the runtime, and prior runs.
        observer = (
            f"Runtime: {runtime or 'ollama'}\n"
            f"Model: {selected_model}\n"
            f"Hardware: {hardware_summary or 'unavailable'}\n"
            "Use the CLI field on each roster row. Do not treat an agent CLI as a shell."
        )
        system_prompt = self.assemble_system_prompt(
            ws_info, terms_info, observer=observer, memory=memory_text or "",
        )
        user_message = f"User Request: {user_prompt.strip()}"

        # 5. Call the model the user selected. A failure is a failed plan, not a pasted command.
        try:
            if (runtime or "ollama") != "ollama":
                from .local_runtimes import chat_completions
                response = chat_completions(
                    runtime_url,
                    selected_model,
                    system_prompt,
                    user_message,
                )
            else:
                response = self.ollama.generate_chat(
                    model=selected_model,
                    system_prompt=system_prompt,
                    user_prompt=user_message,
                    temperature=0.1,
                    max_tokens=3000,
                )
            raw_text = response.get("content", "")
            native_thinking = response.get("thinking", "")
        except Exception as exc:
            return PrimeOrchestrationPlan(
                plan_id=plan_id,
                user_goal=user_prompt,
                selected_model=selected_model,
                thinking_process=f"The selected model did not answer: {exc}",
                subtasks=[],
                allowed_ttys=roster,
                status="failed",
                created_at=time.time(),
            )

        # 6. Parse structured response
        parsed = self._extract_json_plan(raw_text)
        
        extracted_thinking = parsed.get("thinking") or native_thinking or "Deconstructed task across active workspace."
        raw_subtasks = parsed.get("subtasks", [])
        if not isinstance(raw_subtasks, list):
            raw_subtasks = []

        roster_by_tty = {}
        for term in terminals or []:
            tty = (term.get("tty") or term.get("id") or "").strip()
            if tty:
                roster_by_tty[tty] = term

        # Build PlannedSubtasks. An empty or foreign tty is dropped, not reassigned.
        subtasks: List[PlannedSubtask] = []
        for i, item in enumerate(raw_subtasks):
            if not isinstance(item, dict):
                continue
            sub_id = f"{plan_id}-{i+1}"
            title = item.get("title") or f"Subtask {i+1}"
            target_tty = (item.get("target_tty") or "").strip()
            target_label = item.get("target_label", "")
            target_ws = item.get("target_workspace") or (workspace.get("name") if workspace else "")
            cmd = (item.get("command") or "").strip()
            reasoning = item.get("reasoning", "")
            if not target_tty or target_tty not in roster or not cmd:
                continue
            term = roster_by_tty.get(target_tty) or {}
            cli = (term.get("cli") or "unknown").strip() or "unknown"
            if cli.lower() in NON_PROMPT_CLIS:
                continue
            if not target_label:
                target_label = term.get("label") or target_tty
            subtasks.append(
                PlannedSubtask(
                    id=sub_id,
                    title=title,
                    target_tty=target_tty,
                    target_label=target_label,
                    target_workspace=target_ws,
                    action_type=action_for_cli(cli),
                    command=cmd,
                    cwd=ws_path,
                    cli=cli,
                    reasoning=reasoning,
                    status="pending",
                )
            )

        if not subtasks:
            return PrimeOrchestrationPlan(
                plan_id=plan_id,
                user_goal=user_prompt,
                selected_model=selected_model,
                thinking_process=(
                    extracted_thinking
                    + " The reply had no subtask aimed at a checked pane in this workspace."
                ),
                system_profile_summary=f"Model: {selected_model}",
                subtasks=[],
                allowed_ttys=roster,
                status="failed",
                created_at=time.time(),
            )

        return PrimeOrchestrationPlan(
            plan_id=plan_id,
            user_goal=user_prompt,
            selected_model=selected_model,
            thinking_process=extracted_thinking,
            system_profile_summary=f"Model: {selected_model} (speed: {response.get('eval_tok_per_sec', 0)} tok/s)",
            subtasks=subtasks,
            allowed_ttys=roster,
            status="planned",
            created_at=time.time(),
        )

    def _extract_json_plan(self, text: str) -> Dict[str, Any]:
        """Robust extractor for JSON plan from model output."""
        text = text.strip()
        # Direct parse
        if text.startswith("{") and text.endswith("}"):
            try:
                return json.loads(text)
            except Exception:
                pass

        # Regex search for outer JSON object
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass

        # Search for code fence blocks
        fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
        if fence:
            try:
                return json.loads(fence.group(1))
            except Exception:
                pass

        return {}
