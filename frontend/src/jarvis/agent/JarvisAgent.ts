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

export class JarvisAgent {
  public terminalId: string;
  public status: JarvisStatus = 'UNASSIGNED';
  public permissions: Set<JarvisPermission> = new Set(['OBSERVE', 'READ']);
  public workingMemory: JarvisWorkingMemory;
  public assignedAt: number = 0;
  public lastAction?: string;
  public pendingApproval?: JarvisAgentConfig['pendingApproval'];
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
