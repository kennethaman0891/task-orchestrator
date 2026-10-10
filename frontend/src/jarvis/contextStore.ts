// ═══════════════════════════════════════════════════════════════════════════
// JARVIS SESSION CONTEXT STORE (Phase 1)
// Normalizes and tracks live session context across all active terminals.
// ═══════════════════════════════════════════════════════════════════════════

import type { SessionContext } from './types';
import { detectCLI } from './adapters';
import { eventBus } from './eventBus';
import { TerminalManager } from '@/terminal/TerminalManager';
import type { UnifiedTerminal } from '@/types';
import type { Workspace } from '@/lib/workspace';

type ContextListener = (contexts: Record<string, SessionContext>) => void;

class SessionContextStore {
  private contexts: Record<string, SessionContext> = {};
  private listeners: Set<ContextListener> = new Set();
  private pollInterval: number | null = null;
  private prevLineHashes: Record<string, string> = {};

  constructor() {
    this.startPolling();
  }

  subscribe(listener: ContextListener): () => void {
    this.listeners.add(listener);
    listener(this.contexts);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getAll(): Record<string, SessionContext> {
    return { ...this.contexts };
  }

  get(terminalId: string): SessionContext | undefined {
    return this.contexts[terminalId];
  }

  renameTerminal(terminalId: string, name: string): void {
    const ctx = this.contexts[terminalId];
    if (ctx) {
      ctx.terminalName = name;
      this.notify();
    }
  }

  /** Update or create a normalized context from live terminal & workspace data */
  syncTerminal(
    sessionId: string,
    term?: UnifiedTerminal,
    activeWorkspace?: Workspace,
  ): SessionContext {
    const existing = this.contexts[sessionId];
    const now = Date.now();

    // 1. Extract buffer lines from real xterm instance
    const lines = TerminalManager.lastLines(sessionId, 25);
    const lineHash = lines.join('|');
    const hasNewOutput = this.prevLineHashes[sessionId] !== lineHash;
    this.prevLineHashes[sessionId] = lineHash;

    // 2. Run CLI adapter detection
    const parsed = detectCLI(lines, term?.cli, term?.agent, existing);

    // 3. Emit events when state or activity changes
    if (existing && existing.detectedCli !== parsed.cli && parsed.cli !== 'unknown') {
      eventBus.emit(
        'cli_detected',
        sessionId,
        `Detected ${parsed.cliName}`,
        `CLI changed to ${parsed.cliName} on session ${sessionId}`,
        { cli: parsed.cli },
      );
    }

    if (parsed.error && (!existing || existing.errors[existing.errors.length - 1]?.message !== parsed.error)) {
      eventBus.emit(
        'error_detected',
        sessionId,
        'Terminal error detected',
        parsed.error,
        { error: parsed.error },
      );
    }

    if (parsed.waitingForInput && (!existing || existing.state !== 'waiting_for_input')) {
      eventBus.emit(
        'waiting_for_input',
        sessionId,
        'Waiting for input',
        `Process is ready at prompt on session ${sessionId}`,
      );
    }

    // 4. Assemble recent activity list
    const recentActivity = existing ? [...existing.recentActivity] : [];
    if (parsed.recentAction && !recentActivity.includes(parsed.recentAction)) {
      recentActivity.unshift(parsed.recentAction);
      if (recentActivity.length > 10) recentActivity.pop();
    }

    // 5. Build recent errors list
    const errors = existing ? [...existing.errors] : [];
    if (parsed.error && (!errors.length || errors[errors.length - 1].message !== parsed.error)) {
      errors.unshift({ timestamp: now, message: parsed.error });
      if (errors.length > 5) errors.pop();
    }

    const startTs = existing?.sessionStartTimestamp || (term?.registered_at ? term.registered_at * 1000 : now);
    const lastActivity = hasNewOutput ? now : (existing?.lastActivityTimestamp || now);

    const pane = activeWorkspace?.panes?.find((p) => p.tty === sessionId);
    const resolvedTerminalName = pane?.label || existing?.terminalName || term?.session_name || sessionId;

    const updated: SessionContext = {
      terminalId: sessionId,
      workspaceId: activeWorkspace?.id || 'default',
      workspaceName: activeWorkspace?.name || 'Workspace',
      terminalName: resolvedTerminalName,
      cwd: term?.cwd || activeWorkspace?.projectPath || '',
      processInfo: {
        tty: term?.tty || sessionId,
        shell: term?.agent,
      },
      detectedCli: parsed.cli,
      cliName: parsed.cliName,
      sessionStartTimestamp: startTs,
      lastActivityTimestamp: lastActivity,
      elapsedMs: Math.max(0, now - startTs),
      state: parsed.state || (hasNewOutput ? 'running' : 'idle'),
      currentTaskTitle: parsed.taskTitle || existing?.currentTaskTitle || term?.current_task?.description,
      currentActivity: parsed.currentActivity || (hasNewOutput ? 'Producing output' : 'Idle'),
      recentCommands: existing?.recentCommands || [],
      recentActivity,
      relevantFiles: existing?.relevantFiles || [],
      errors,
    };

    this.contexts[sessionId] = updated;
    this.notify();
    return updated;
  }

  private notify(): void {
    for (const l of this.listeners) {
      try { l(this.contexts); } catch (e) { console.error('[SessionContextStore] notify error:', e); }
    }
  }

  private startPolling(): void {
    if (typeof window === 'undefined') return;
    this.pollInterval = window.setInterval(() => {
      // Re-calculate elapsed times periodically
      const now = Date.now();
      let changed = false;
      for (const id in this.contexts) {
        const ctx = this.contexts[id];
        ctx.elapsedMs = Math.max(0, now - ctx.sessionStartTimestamp);
        changed = true;
      }
      if (changed) this.notify();
    }, 1000);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export const sessionContextStore = new SessionContextStore();
