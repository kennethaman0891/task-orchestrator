// ═══════════════════════════════════════════════════════════════════════════
// JARVIS PER-TERMINAL AGENT (Phase 2 & Phase 3)
// Explicitly assigned per-terminal autonomous developer agent.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  JarvisStatus,
  JarvisPermission,
  JarvisAgentConfig,
  SessionContext,
  JarvisWorkingMemory,
} from '../types';
import { ContextReconstructor } from './ContextReconstructor';
import { TerminalManager } from '@/terminal/TerminalManager';
import { eventBus } from '../eventBus';
import {
  detectTerminalPrompt,
  detectTaskCompletion,
  type DetectedTerminalPrompt,
} from '../terminalPromptDetector';
import { sessionContextStore } from '../contextStore';

export class JarvisAgent {
  public terminalId: string;
  public status: JarvisStatus = 'UNASSIGNED';
  public permissions: Set<JarvisPermission> = new Set(['OBSERVE', 'READ']);
  public workingMemory: JarvisWorkingMemory;
  public assignedAt: number = 0;
  public lastAction?: string;
  public pendingApproval?: JarvisAgentConfig['pendingApproval'];
  public isCallActive: boolean = false;
  public callStartedAt?: number;
  public pendingPrompt: DetectedTerminalPrompt | null = null;
  public lastSpokenPromptId: string | null = null;
  public hasTaskInFlight: boolean = false;
  public taskStartedAt: number = 0;
  public onPromptDetected?: (prompt: DetectedTerminalPrompt) => void;
  public onTaskFinished?: (summary: string) => void;
  public onChange?: () => void;

  constructor(terminalId: string, initialContext?: SessionContext) {
    this.terminalId = terminalId;
    if (initialContext) {
      this.workingMemory = ContextReconstructor.reconstruct(initialContext);
    } else {
      this.workingMemory = {
        project: 'Unknown',
        cli: 'Shell',
        session: terminalId,
        task: 'Unassigned',
        currentState: 'Idle',
        currentActivity: 'Standing by',
        recentActions: [],
        filesChanged: [],
        errors: [],
        nextExpectedAction: 'Assign Jarvis to start observing',
        timeline: [],
      };
    }
  }

  /** Explicitly assign Jarvis to this terminal with user-selected permissions */
  assign(permissions: JarvisPermission[] = ['OBSERVE', 'READ', 'EXECUTE', 'CONTROL'], currentContext?: SessionContext): void {
    this.permissions = new Set(permissions);
    this.status = 'OBSERVING';
    this.assignedAt = Date.now();

    if (currentContext) {
      this.workingMemory = ContextReconstructor.reconstruct(currentContext);
    }

    eventBus.emit(
      'jarvis_assigned',
      this.terminalId,
      'Jarvis Assigned',
      `Assigned with permissions: ${Array.from(this.permissions).join(', ')}`,
      { permissions: Array.from(this.permissions) },
    );

    this.addTimelineItem('Jarvis assigned to terminal', 'system');
    this.onChange?.();
  }

  /** Unassign Jarvis from this terminal */
  unassign(): void {
    this.status = 'UNASSIGNED';
    this.permissions = new Set(['OBSERVE']);
    this.addTimelineItem('Jarvis unassigned', 'system');
    this.onChange?.();
  }

  /** Set permissions dynamically */
  setPermissions(perms: JarvisPermission[]): void {
    this.permissions = new Set(perms);
    this.addTimelineItem(`Permissions updated: ${perms.join(', ')}`, 'system');
    this.onChange?.();
  }

  /** Voice Call: Start an interactive OpenDots voice call with this terminal agent */
  startCall(): void {
    if (this.status === 'UNASSIGNED') {
      this.assign(['OBSERVE', 'READ', 'EXECUTE', 'CONTROL']);
    }
    this.isCallActive = true;
    this.callStartedAt = Date.now();
    this.lastSpokenPromptId = null;
    this.pendingPrompt = null;
    this.hasTaskInFlight = false;
    this.addTimelineItem('Voice call connected with Jarvis', 'system');
    eventBus.emit(
      'jarvis_voice_received',
      this.terminalId,
      'Voice Call Connected',
      'Live voice session established',
      { mode: 'call_active' },
    );
    this.onChange?.();
  }

  /** Voice Call: End active voice call session */
  endCall(): void {
    if (!this.isCallActive) return;
    const duration = this.callStartedAt
      ? Math.max(0, Math.round((Date.now() - this.callStartedAt) / 1000))
      : 0;
    this.isCallActive = false;
    this.callStartedAt = undefined;
    this.pendingPrompt = null;
    this.hasTaskInFlight = false;
    this.addTimelineItem(`Voice call ended (${duration}s)`, 'system');
    if (this.status === 'WORKING') {
      this.status = 'OBSERVING';
    }
    this.onChange?.();
  }

  /**
   * Actively observes the terminal buffer during a live voice call to detect
   * permissions, interactive questions, and completion of work.
   */
  checkTerminalObservation(): {
    prompt?: DetectedTerminalPrompt;
    isCompleted?: boolean;
    completedSummary?: string;
  } {
    const lines = TerminalManager.lastLines(this.terminalId, 35);
    const ctx = sessionContextStore.get(this.terminalId);
    const cliName = ctx?.cliName || this.workingMemory.cli || 'Antigravity';

    // 1. Detect interactive permission or question
    const detected = detectTerminalPrompt(lines, cliName);
    if (detected) {
      this.pendingPrompt = detected;
      const isNewPrompt = detected.id !== this.lastSpokenPromptId;
      if (isNewPrompt) {
        this.lastSpokenPromptId = detected.id;
        this.status = 'WAITING';
        this.addTimelineItem(`Permission requested: ${detected.command || detected.question}`, 'system');
        this.onPromptDetected?.(detected);
        this.onChange?.();
        return { prompt: detected };
      }
      return { prompt: detected };
    } else {
      if (this.pendingPrompt) {
        this.pendingPrompt = null;
        this.onChange?.();
      }
    }

    // 2. Detect completion of active task
    const completion = detectTaskCompletion(lines, this.hasTaskInFlight, this.taskStartedAt);
    if (completion.isCompleted) {
      this.hasTaskInFlight = false;
      this.status = 'COMPLETED';
      const summary = completion.summary || 'Task completed successfully.';
      this.addTimelineItem(`Task completed: ${summary}`, 'action');
      this.onTaskFinished?.(summary);
      this.onChange?.();
      return { isCompleted: true, completedSummary: summary };
    }

    return {};
  }

  /**
   * Voice Call Turn: Processes transcribed speech from the user during a live call.
   * Understands terminal context (CLI type, cwd, recent buffer, errors),
   * executes appropriate actions, and returns a natural 1-2 sentence spoken response.
   */
  async processVoiceTurn(speechText: string): Promise<{ response: string; executedCommand?: string }> {
    const text = speechText.trim();
    if (!text) {
      return { response: "I'm listening. Speak your instruction for this terminal." };
    }

    if (this.status === 'UNASSIGNED') {
      this.assign(['OBSERVE', 'READ', 'EXECUTE', 'CONTROL']);
    }

    const lower = text.toLowerCase();

    // ── 0. Priority: Answering Active Permission or Question Prompt ──
    if (this.pendingPrompt) {
      const prompt = this.pendingPrompt;

      // Affirmative / Yes / Option 1
      if (/^(yes|yep|yeah|sure|allow|approve|run|go ahead|proceed|confirm|ok|okay|1|one)\b/i.test(lower)) {
        const opt = prompt.options.find((o) => o.key === '1' || /yes|allow|run/i.test(o.label)) || prompt.options[0];
        const val = opt ? opt.value : '1';
        await TerminalManager.sendMenuSelection(this.terminalId, val);
        this.pendingPrompt = null;
        this.hasTaskInFlight = true;
        this.taskStartedAt = Date.now();
        this.status = 'WORKING';
        this.addTimelineItem(`Voice permission granted: ${opt?.label || 'Option 1'}`, 'action');
        this.onChange?.();
        return {
          response: `Approved option 1. Running the command now.`,
          executedCommand: `selected ${val}`,
        };
      }

      // Always Allow / Option 2
      if (/^(always|always allow|2|two)\b/i.test(lower)) {
        const opt = prompt.options.find((o) => o.key === '2' || /always/i.test(o.label));
        const val = opt ? opt.value : '2';
        await TerminalManager.sendMenuSelection(this.terminalId, val);
        this.pendingPrompt = null;
        this.hasTaskInFlight = true;
        this.taskStartedAt = Date.now();
        this.status = 'WORKING';
        this.addTimelineItem(`Voice permission granted: Always allow`, 'action');
        this.onChange?.();
        return {
          response: `Approved and saved to always allow. Continuing.`,
          executedCommand: `selected ${val}`,
        };
      }

      // Negative / Cancel / Reject / Option 4
      if (/^(no|nope|cancel|deny|reject|abort|stop|don't|dont|4|four)\b/i.test(lower)) {
        const opt = prompt.options.find((o) => o.key === '4' || /cancel|no/i.test(o.label));
        const val = opt ? opt.value : '4';
        await TerminalManager.sendMenuSelection(this.terminalId, val);
        this.pendingPrompt = null;
        this.status = 'OBSERVING';
        this.addTimelineItem('Voice permission denied: Cancelled', 'action');
        this.onChange?.();
        return {
          response: `Cancelled the command.`,
          executedCommand: 'cancel',
        };
      }

      // Explicit numeric selection: 1, 2, 3, 4, 5
      const numMatch = lower.match(/\b(1|2|3|4|5|one|two|three|four|five)\b/i);
      if (numMatch) {
        const map: Record<string, string> = {
          one: '1', two: '2', three: '3', four: '4', five: '5',
          '1': '1', '2': '2', '3': '3', '4': '4', '5': '5',
        };
        const digit = map[numMatch[1].toLowerCase()] || '1';
        const opt = prompt.options.find((o) => o.key === digit);
        await TerminalManager.sendMenuSelection(this.terminalId, opt ? opt.value : digit);
        this.pendingPrompt = null;
        this.hasTaskInFlight = true;
        this.taskStartedAt = Date.now();
        this.status = 'WORKING';
        this.addTimelineItem(`Voice option selected: ${digit}`, 'action');
        this.onChange?.();
        return {
          response: `Selected option ${digit}. Continuing.`,
          executedCommand: `selected ${digit}`,
        };
      }
    }

    // Direct terminal process control (stop / cancel / kill)
    if (/^(stop|pause|halt|cancel|kill|abort)\b/i.test(text)) {
      this.hasTaskInFlight = false;
      await this.stop();
      return { response: "Interrupted the running process.", executedCommand: "stop" };
    }

    // ── 1. Autonomous Agentic Reasoning via Backend /api/jarvis/reason ──
    const ctx = sessionContextStore.get(this.terminalId);
    const cliName = ctx?.cliName || this.workingMemory.cli || 'Antigravity';
    const cwd = ctx?.cwd || '';
    const buffer = TerminalManager.lastLines(this.terminalId, 45).join('\n');

    try {
      const apiHost = window.location.hostname || '127.0.0.1';
      const reasonRes = await fetch(`http://${apiHost}:8765/api/jarvis/reason`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminal_id: this.terminalId,
          user_message: text,
          cli_name: cliName,
          project: this.workingMemory.project,
          cwd,
          buffer,
          working_memory: {
            current_state: this.workingMemory.currentState,
            current_activity: this.workingMemory.currentActivity,
            errors: this.workingMemory.errors,
            recent_actions: this.workingMemory.recentActions,
            files_changed: this.workingMemory.filesChanged,
          },
          pending_prompt: this.pendingPrompt,
        }),
      });

      if (reasonRes.ok) {
        const reasoning = await reasonRes.json();
        const spoken = reasoning.spoken_response || `Received: ${text}`;
        const cmd = reasoning.action_command || '';
        const shouldExec = Boolean(reasoning.should_execute);
        const intent = reasoning.intent || 'advice';

        // Intent: Advice, Explanation, Status, or Permission Guidance
        if (intent === 'advice' || !shouldExec) {
          this.addTimelineItem(`Jarvis: "${spoken}"`, 'action');
          this.onChange?.();
          return { response: spoken };
        }

        // Intent: Orchestrating Antigravity CLI or AI Agent
        if (intent === 'orchestrate_cli' || intent === 'orchestrate') {
          const promptToSend = cmd || text;
          this.addTimelineItem(`Orchestrating ${cliName}: "${promptToSend}"`, 'task');
          this.workingMemory.task = promptToSend;
          this.status = 'WORKING';
          this.hasTaskInFlight = true;
          this.taskStartedAt = Date.now();
          this.onChange?.();
          await TerminalManager.sendPrompt(this.terminalId, promptToSend);
          return { response: spoken, executedCommand: promptToSend };
        }

        // Intent: Execute shell command
        if (intent === 'execute_shell' || intent === 'execute') {
          const shellCmd = cmd || text;
          this.addTimelineItem(`Shell: "${shellCmd}"`, 'task');
          this.status = 'WORKING';
          this.hasTaskInFlight = true;
          this.taskStartedAt = Date.now();
          this.onChange?.();
          await this.executeCommand(shellCmd);
          return { response: spoken, executedCommand: shellCmd };
        }
      }
    } catch (e) {
      console.warn('[JarvisAgent] Backend reasoning error, using local fallback:', e);
    }

    // ── 2. Local Fallback Heuristics (if backend is unreachable) ──
    const cliLower = (cliName || '').toLowerCase();
    const isAiCli = /antigravity|agy|claude|codex|opencode|prime|cursor|gemini|qwen|copilot/.test(cliLower);

    this.addTimelineItem(`Voice: "${text}"`, 'task');
    this.workingMemory.task = text;

    // Direct Intent: Continue task
    if (/^(continue|keep going|proceed|next|go on)\b/i.test(text)) {
      this.status = 'WORKING';
      this.hasTaskInFlight = true;
      this.taskStartedAt = Date.now();
      this.onChange?.();
      await this.continueTask();
      return { response: "Continuing the current task.", executedCommand: "continue" };
    }

    // Direct Intent: Run test suite
    if (/^(run\s+(the\s+)?tests?|test\s+suite|check\s+tests)\b/i.test(text)) {
      this.status = 'WORKING';
      this.hasTaskInFlight = true;
      this.taskStartedAt = Date.now();
      this.onChange?.();
      await this.runTests();
      return { response: "Starting the test suite now.", executedCommand: "test" };
    }

    // Direct Intent: Investigate error
    if (/^(check\s+why|why\s+did\s+it\s+fail|investigate|debug|fix\s+error)\b/i.test(text)) {
      const expl = await this.investigateError();
      return { response: expl, executedCommand: "investigate" };
    }

    // Status queries
    if (/\b(status|what('s|\s+is)\s+running|how('s|\s+is)\s+it\s+going|any\s+errors?)\b/i.test(text)) {
      const err = this.workingMemory.errors[0];
      const state = this.workingMemory.currentState.toLowerCase();
      const proj = this.workingMemory.project !== 'Unknown' ? this.workingMemory.project : 'this project';
      if (err) {
        return { response: `${cliName} is in ${state} state on ${proj}. Notice error: ${err.slice(0, 100)}.` };
      }
      return { response: `${cliName} is in ${state} state on ${proj}. Activity: ${this.workingMemory.currentActivity}.` };
    }

    // If running an AI CLI (Antigravity CLI, etc.), deliver prompt directly
    if (isAiCli) {
      this.status = 'WORKING';
      this.hasTaskInFlight = true;
      this.taskStartedAt = Date.now();
      this.onChange?.();
      await TerminalManager.sendPrompt(this.terminalId, text);
      return {
        response: `Sent instruction to ${cliName}: "${text}". Watching for output.`,
        executedCommand: text,
      };
    }

    // General developer instruction: execute in shell
    this.status = 'WORKING';
    this.hasTaskInFlight = true;
    this.taskStartedAt = Date.now();
    this.onChange?.();
    await this.executeCommand(text);
    return { response: `Executing: ${text}`, executedCommand: text };
  }

  /** Assign a specific developer task or prompt directly to this agent */
  async assignTask(taskDescription: string): Promise<boolean> {
    const desc = taskDescription.trim();
    if (!desc) return false;
    if (this.status === 'UNASSIGNED') {
      this.assign(['OBSERVE', 'READ', 'EXECUTE', 'CONTROL']);
    }
    this.workingMemory.task = desc;
    this.status = 'WORKING';
    this.addTimelineItem(`Assigned task: ${desc}`, 'task');
    this.onChange?.();

    const cliLower = (this.workingMemory.cli || '').toLowerCase();
    const isAiCli = /antigravity|agy|claude|codex|opencode|prime|cursor|gemini|qwen|copilot/.test(cliLower);

    // If running an AI CLI, feed prompt directly to CLI agent
    if (isAiCli) {
      return this.sendInput(`${desc}\r`);
    }

    // Route command into the real PTY
    return this.executeCommand(desc);
  }

  can(permission: JarvisPermission): boolean {
    return this.permissions.has(permission);
  }

  /** Sync working memory with live context */
  syncContext(ctx: SessionContext): void {
    if (this.status === 'UNASSIGNED') return;

    // Update state based on terminal
    if (ctx.state === 'error' && this.status !== 'ERROR') {
      this.status = 'ERROR';
    } else if (ctx.state === 'waiting_for_input' && this.status === 'WORKING') {
      this.status = 'WAITING';
    } else if (ctx.state === 'running' && (this.status === 'OBSERVING' || this.status === 'WAITING')) {
      this.status = 'WORKING';
    } else if (ctx.state === 'idle' && this.status === 'WORKING') {
      this.status = 'OBSERVING';
    }

    // Refresh memory while preserving explicit user task
    const prevTask = this.workingMemory?.task;
    this.workingMemory = ContextReconstructor.reconstruct(ctx);
    if (prevTask && prevTask !== 'Unassigned' && prevTask !== 'Interactive Development Session') {
      this.workingMemory.task = prevTask;
    }
  }

  /** Send raw input to real PTY */
  async sendInput(input: string): Promise<boolean> {
    if (!this.can('EXECUTE') && !this.can('CONTROL')) {
      console.warn(`[Jarvis ${this.terminalId}] Blocked sendInput: Missing EXECUTE or CONTROL permission`);
      return false;
    }

    await TerminalManager.write(this.terminalId, input);
    this.lastAction = `Sent input: ${input.slice(0, 30)}`;
    this.addTimelineItem(`Sent input to terminal: ${input.trim()}`, 'action');
    eventBus.emit(
      'jarvis_action_taken',
      this.terminalId,
      'PTY Input Sent',
      input.trim(),
    );
    this.onChange?.();
    return true;
  }

  /** Execute a full command followed by Enter in real PTY */
  async executeCommand(cmd: string): Promise<boolean> {
    if (!this.can('EXECUTE') && !this.can('CONTROL')) {
      this.requestApproval('execute_command', cmd, `Execute shell command: ${cmd}`);
      return false;
    }

    this.status = 'WORKING';
    try {
      await TerminalManager.sendCommand(this.terminalId, cmd);
    } catch {
      await TerminalManager.write(this.terminalId, `${cmd}\r`);
    }
    this.lastAction = `Executed: ${cmd}`;
    this.addTimelineItem(`Ran command: ${cmd}`, 'action');
    eventBus.emit(
      'command_started',
      this.terminalId,
      `Command started: ${cmd}`,
      cmd,
    );
    this.onChange?.();
    return true;
  }

  /** Request explicit user approval for a high-impact action */
  requestApproval(action: string, command: string | undefined, description: string): void {
    this.status = 'NEEDS_APPROVAL';
    this.pendingApproval = {
      id: `appr-${Date.now()}`,
      action,
      command,
      description,
      timestamp: Date.now(),
    };
    this.addTimelineItem(`Requested approval: ${description}`, 'approval');
    eventBus.emit(
      'waiting_for_input',
      this.terminalId,
      'Approval Required',
      description,
    );
    this.onChange?.();
  }

  /** Approve pending action */
  async approvePending(): Promise<void> {
    if (!this.pendingApproval) return;
    const { command } = this.pendingApproval;
    this.pendingApproval = undefined;
    this.status = 'WORKING';
    if (command) {
      try {
        await TerminalManager.sendCommand(this.terminalId, command);
      } catch {
        await TerminalManager.write(this.terminalId, `${command}\r`);
      }
      this.addTimelineItem(`Approved & executed: ${command}`, 'action');
    }
    this.onChange?.();
  }

  /** Reject pending action */
  rejectPending(): void {
    this.pendingApproval = undefined;
    this.status = 'OBSERVING';
    this.addTimelineItem('Action rejected by user', 'approval');
    this.onChange?.();
  }

  /** Interrupt/stop the active process safely */
  async stop(): Promise<void> {
    if (!this.can('CONTROL')) {
      console.warn(`[Jarvis ${this.terminalId}] Blocked stop: Missing CONTROL permission`);
      return;
    }
    // Send Ctrl+C (\x03)
    await TerminalManager.write(this.terminalId, '\x03');
    this.status = 'STOPPED';
    this.addTimelineItem('Interrupted process (Ctrl+C)', 'action');
    this.onChange?.();
  }

  /** Task Continuity: Continue active task */
  async continueTask(): Promise<boolean> {
    this.status = 'WORKING';
    this.addTimelineItem('Continuing current task...', 'continuity');

    let res: boolean;
    // If CLI is waiting for prompt, send a continuation prompt
    if (this.workingMemory.cli.toLowerCase().includes('claude') || this.workingMemory.cli.toLowerCase().includes('codex') || this.workingMemory.cli.toLowerCase().includes('opencode')) {
      res = await this.sendInput('continue\r');
    } else {
      res = await this.sendInput('\r');
    }
    this.onChange?.();
    return res;
  }

  /** Task Continuity: Run project tests */
  async runTests(cwd?: string): Promise<boolean> {
    this.status = 'WORKING';
    this.addTimelineItem('Starting test suite...', 'continuity');

    // Run tests according to project type
    const cmd = cwd && cwd.includes('tauri') ? 'cargo test' : 'npm test';
    const res = await this.executeCommand(cmd);
    this.onChange?.();
    return res;
  }

  /** Task Continuity: Investigate recent errors */
  async investigateError(): Promise<string> {
    this.status = 'WORKING';
    const error = this.workingMemory.errors[0] || 'Unknown error in buffer';
    const explanation = `Investigating error: "${error}". Checking recent output and buffer history.`;
    this.addTimelineItem(`Investigating error: ${error.slice(0, 40)}`, 'continuity');

    if (this.workingMemory.cli.toLowerCase().includes('claude') || this.workingMemory.cli.toLowerCase().includes('codex') || this.workingMemory.cli.toLowerCase().includes('opencode')) {
      await this.sendInput(`Check why the previous command failed: ${error.slice(0, 80)}\n`);
    }

    this.onChange?.();
    return explanation;
  }

  private addTimelineItem(title: string, type: string): void {
    this.workingMemory.timeline.unshift({
      timestamp: Date.now(),
      title,
      type,
      status: 'done',
    });
    if (this.workingMemory.timeline.length > 25) {
      this.workingMemory.timeline.pop();
    }
  }

  getConfig(): JarvisAgentConfig {
    return {
      terminalId: this.terminalId,
      assignedAt: this.assignedAt,
      status: this.status,
      permissions: Array.from(this.permissions),
      workingMemory: this.workingMemory,
      lastAction: this.lastAction,
      pendingApproval: this.pendingApproval,
    };
  }
}
