// ═══════════════════════════════════════════════════════════════════════════
// JARVIS CONTEXT RECONSTRUCTOR (Phase 3)
// 9-point session context reconstruction when assigned to an existing terminal.
// ═══════════════════════════════════════════════════════════════════════════

import type { SessionContext, JarvisWorkingMemory } from '../types';
import { TerminalManager } from '@/terminal/TerminalManager';

export class ContextReconstructor {
  /** Reconstructs structured memory from terminal buffer and session context */
  static reconstruct(ctx: SessionContext): JarvisWorkingMemory {
    const lines = TerminalManager.lastLines(ctx.terminalId, 40);
    const text = lines.join('\n');

    // 1. Project
    const project = ctx.workspaceName || ctx.cwd ? ctx.cwd.split('/').pop() || 'Unknown Project' : 'Unknown Project';

    // 2. CLI
    const cli = ctx.cliName || (ctx.detectedCli ? ctx.detectedCli.charAt(0).toUpperCase() + ctx.detectedCli.slice(1) : 'Antigravity');

    // 3. Task
    const task = ctx.currentTaskTitle || (
      lines.find((l) => /task|goal|fixing|implementing/i.test(l))?.trim() ||
      'Interactive Development Session'
    );

    // 4. What has already happened & 6. Commands
    const recentActions: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(✓|✔|done|created|updated|installed|compiled|built)/i.test(trimmed)) {
        if (!recentActions.includes(trimmed)) recentActions.push(trimmed);
      }
      if (/^[$%#]\s*(.+)/.test(trimmed)) {
        const cmd = trimmed.replace(/^[$%#]\s*/, '');
        if (!recentActions.includes(`Ran: ${cmd}`)) recentActions.push(`Ran: ${cmd}`);
      }
    }
    if (recentActions.length === 0 && ctx.recentActivity.length > 0) {
      recentActions.push(...ctx.recentActivity);
    }

    // 5. Files Changed
    const filesChanged: string[] = [];
    const fileMatches = text.matchAll(/(?:modified|created|editing|writing|wrote|file:)\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/gi);
    for (const match of fileMatches) {
      const f = match[1];
      if (f && !filesChanged.includes(f)) filesChanged.push(f);
    }

    // 7. Errors
    const errors: string[] = [];
    for (const line of lines) {
      if (/(error|failed|fatal|exception|traceback|SyntaxError|TypeError):/i.test(line)) {
        const err = line.trim();
        if (!errors.includes(err)) errors.push(err);
      }
    }
    if (errors.length === 0 && ctx.errors.length > 0) {
      errors.push(...ctx.errors.map((e) => e.message));
    }

    // 8. What is happening now
    const currentState = ctx.state === 'running'
      ? 'Process is executing'
      : ctx.state === 'waiting_for_input'
      ? 'Waiting for user input at prompt'
      : ctx.state === 'error'
      ? 'Process halted with error'
      : 'Idle';

    const currentActivity = ctx.currentActivity || 'Observing session';

    // 9. Likely next step
    let nextExpectedAction = 'Awaiting next instruction';
    if (errors.length > 0) {
      nextExpectedAction = `Investigate error: ${errors[errors.length - 1].slice(0, 60)}`;
    } else if (ctx.state === 'waiting_for_input') {
      nextExpectedAction = 'Supply next command or input prompt';
    } else if (ctx.state === 'running') {
      nextExpectedAction = 'Allow current process to finish execution';
    }

    const timeline: JarvisWorkingMemory['timeline'] = recentActions.map((action, i) => ({
      timestamp: Date.now() - (recentActions.length - i) * 60000,
      title: action,
      type: 'action',
      status: 'done',
    }));

    if (errors.length > 0) {
      timeline.push({
        timestamp: Date.now(),
        title: `Error: ${errors[errors.length - 1].slice(0, 50)}`,
        type: 'error',
        status: 'failed' as const,
      });
    }

    return {
      project,
      cli,
      session: ctx.terminalName,
      task,
      currentState,
      currentActivity,
      recentActions: recentActions.slice(-6),
      filesChanged: filesChanged.slice(-8),
      errors: errors.slice(-4),
      nextExpectedAction,
      timeline,
    };
  }

  /** Generates a human-readable session summary without hallucination */
  static formatSummary(memory: JarvisWorkingMemory): string {
    const parts: string[] = [];
    parts.push(`${memory.cli} is active in ${memory.project}.`);
    parts.push(`Current task: ${memory.task}.`);
    if (memory.filesChanged.length > 0) {
      parts.push(`Files involved: ${memory.filesChanged.join(', ')}.`);
    }
    if (memory.errors.length > 0) {
      parts.push(`Encountered error: ${memory.errors[memory.errors.length - 1]}.`);
      parts.push(`Next recommended step: ${memory.nextExpectedAction}.`);
    } else {
      parts.push(`Status: ${memory.currentState}.`);
    }
    return parts.join(' ');
  }
}
