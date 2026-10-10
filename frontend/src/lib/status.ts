// status.ts — Derive terminal task status from multiple signals.
// Ported from src-legacy/components/WorkspaceControlPanel.tsx

import type { UnifiedTerminal } from '@/types';
import { TerminalManager } from '@/terminal/TerminalManager';
import { formatLiveDuration, formatTimeOfDay } from '@/lib/format';

export type TermStatus = 'empty' | 'closed' | 'running' | 'stopped' | 'over' | 'asking';

/** Minimal UnifiedTerminal for entries not yet in the map (all optional fields
 *  defaulted) — avoids repeating giant literal objects at call sites. */
export function minTerminal(tty: string): UnifiedTerminal {
  return {
    tty,
    agent: '', cli: '', cwd: '', is_live: false,
    tokens: { tokens_input: 0, tokens_output: 0, cost: 0, model: '' },
    session_name: tty, window_name: '', pane_title: tty,
    session_context: '', session_summary: '',
    pending_cli: false, live_output: '', suggested_task: '',
    current_task: null, next_task: null, queue: [], history: [],
    session_id: tty,
  };
}

/**
 * Derive the RIGHT-SIDE status for a terminal by asking the CLI what it is
 * ACTUALLY doing — not by guessing from shell activity.
 */
export function deriveTaskStatus(
  tty: string | null,
  entry: UnifiedTerminal | undefined,
  closed: boolean,
): TermStatus {
  if (!tty) return 'empty';
  if (closed) return 'closed';
  if (!entry) return 'stopped';

  const st = (entry.current_task?.status ?? '').toLowerCase();
  const paused = false;

  const tui = TerminalManager.isTui(tty);
  const lastOut = TerminalManager.outputAt(tty);
  const hasRenderer = lastOut !== 0;
  const now = Date.now();

  const linesList = TerminalManager.lastLines(tty, 60);
  const recentLines = linesList.join('\n');
  const nonBlankLines = linesList.map((l) => l.trim()).filter(Boolean);
  const lastLine = nonBlankLines[nonBlankLines.length - 1] || '';
  const secondLastLine = nonBlankLines[nonBlankLines.length - 2] || '';

  const claude = (entry.cli || '').toLowerCase().includes('claude') ||
                 /claude\s+code|anthropics?\/claude|auto\s+mode|api usage billing|laguna-|thought for\s+\d+/i.test(recentLines);

  // Check if Claude Code is in an active working / thinking / tool execution state
  const claudeWorking = /(thought for\s+\d+|thinking\.\.\.|\*\s+(update|explore|read|edit|bash|let me|write)|added \d+ line|removed \d+ line|running tool)/i.test(recentLines);

  // Check if prompt is waiting for user or asking for permission
  const promptAsks =
    /^([❯>]{1,2})\s*$/.test(lastLine) ||
    /\?\s*\(y\/n\)/i.test(lastLine) ||
    /\b(allow|access permission|permit|proceed\?|continue\?|confirm\?|yes\/no|\(y\/n\))\b/i.test(lastLine) ||
    (secondLastLine.startsWith('>') && /auto mode on/i.test(lastLine));

  // Sidecar's opencode status
  const ocState: string = (entry as any)?.opencode_status?.state ?? 'off';
  const ocQuestion: boolean = Boolean((entry as any)?.opencode_status?.last_text?.toString().trim().endsWith('?'));

  // Output flowing within 6s = actively working
  const recentOutput = hasRenderer && now - lastOut < 6000;
  // Quiet gap 1-300s after output = CLI paused to ask/await input.
  const quietWindow = hasRenderer && now - lastOut > 1000 && now - lastOut < 300000;
  const taskInFlight = st.length > 0;
  const askedQuietly = tui && quietWindow && promptAsks && taskInFlight;
  const pausedAsking = quietWindow && promptAsks && (taskInFlight || ocState === 'working' || ocState === 'waiting' || claude);

  // Task reached terminal state
  if (['done', 'completed', 'success', 'succeeded', 'finished'].includes(st)) {
    TerminalManager.setWorkEnded(tty);
    return 'over';
  }
  if (['cancelled', 'canceled', 'blocked', 'failed', 'error', 'stopped'].includes(st) || paused) {
    TerminalManager.setWorkEnded(tty);
    return 'stopped';
  }

  // App-tracked task in flight
  if (taskInFlight) {
    return askedQuietly || pausedAsking || ocQuestion ? 'asking' : 'running';
  }

  // No app task. opencode signals
  if (ocState === 'working') {
    return askedQuietly || pausedAsking ? 'asking' : 'running';
  }
  if (ocState === 'waiting') {
    if (ocQuestion || pausedAsking || promptAsks) return 'asking';
    return 'stopped';
  }

  // Claude Code
  if (claude) {
    if (recentOutput || claudeWorking) return 'running';
    if (askedQuietly || pausedAsking || promptAsks) return 'asking';
    return 'asking'; // Ready at prompt
  }

  // opencode running but session reports off
  if (entry.opencode_running) return 'stopped';

  // Renderer + TUI rear guard
  if (recentOutput) return 'running';
  if (tui) return now - lastOut > 60000 ? 'stopped' : 'running';
  if (promptAsks && hasRenderer) return 'asking';

  return 'stopped';
}

/** Short label + color for a derived status. */
export function statusLabel(s: TermStatus): { text: string; color: string } {
  switch (s) {
    case 'running':  return { text: 'RUNNING', color: '#22c55e' };
    case 'asking':   return { text: 'ASKING',  color: '#a855f7' };
    case 'stopped':  return { text: 'STOPPED', color: '#ef4444' };
    case 'over':     return { text: 'OVER',    color: '#3b82f6' };
    case 'closed':   return { text: 'EXITED',  color: '#6b7280' };
    default:         return { text: 'EMPTY',   color: '#374151' };
  }
}

/** Helper to retrieve live elapsed working duration and formatted timestamps for a terminal. */
export function getTerminalWorkDuration(tty: string, status: TermStatus): {
  durationStr: string;
  startTs: number;
  endTs: number;
  startTimeFormatted: string;
  endTimeFormatted: string;
  isLive: boolean;
} {
  const start = TerminalManager.workStartedAt(tty) || TerminalManager.createdAt(tty) || Date.now();
  const ended = TerminalManager.workEndedAt(tty);
  const now = Date.now();
  const startTimeFormatted = formatTimeOfDay(start);

  if (status === 'running') {
    const elapsed = Math.max(0, now - start);
    return {
      durationStr: formatLiveDuration(elapsed),
      startTs: start,
      endTs: 0,
      startTimeFormatted,
      endTimeFormatted: '',
      isLive: true,
    };
  }

  if (status === 'asking') {
    const lastOut = TerminalManager.outputAt(tty);
    const waitingMs = lastOut > 0 ? Math.max(0, now - lastOut) : 0;
    return {
      durationStr: formatLiveDuration(waitingMs),
      startTs: start,
      endTs: 0,
      startTimeFormatted,
      endTimeFormatted: '',
      isLive: true,
    };
  }

  if (status === 'over' || status === 'stopped') {
    const endTs = ended > start ? ended : (TerminalManager.outputAt(tty) || now);
    const elapsed = Math.max(0, endTs - start);
    return {
      durationStr: formatLiveDuration(elapsed),
      startTs: start,
      endTs,
      startTimeFormatted,
      endTimeFormatted: formatTimeOfDay(endTs),
      isLive: false,
    };
  }

  return {
    durationStr: '',
    startTs: start,
    endTs: 0,
    startTimeFormatted,
    endTimeFormatted: '',
    isLive: false,
  };
}
