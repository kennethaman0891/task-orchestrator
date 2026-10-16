// status.ts — Derive terminal task status from ground-truth CLI signals.
// Accurately differentiates RUNNING vs ASKING vs STOPPED / OVER across Claude Code,
// OpenAI Codex, OpenCode, Antigravity CLI, and generic shells.

import type { UnifiedTerminal } from '@/types';
import { TerminalManager } from '@/terminal/TerminalManager';
import { formatLiveDuration, formatTimeOfDay } from '@/lib/format';

export type TermStatus = 'empty' | 'closed' | 'running' | 'stopped' | 'over' | 'asking';

/** Minimal UnifiedTerminal for entries not yet in the map (all optional fields
 *  defaulted) — avoids repeating giant literal objects at call sites. */
export function minTerminal(tty: string): UnifiedTerminal {
  return {
    tty,
    agent: '',
    cli: '',
    cwd: '',
    is_live: false,
    tokens: { tokens_input: 0, tokens_output: 0, cost: 0, model: '' },
    session_name: tty,
    window_name: '',
    pane_title: tty,
    session_context: '',
    session_summary: '',
    pending_cli: false,
    live_output: '',
    suggested_task: '',
    current_task: null,
    next_task: null,
    queue: [],
    history: [],
    session_id: tty,
  };
}

/**
 * Derive the RIGHT-SIDE status for a terminal by inspecting live CLI state,
 * sidecar status, and terminal buffer ground truth.
 */
export function deriveTaskStatus(
  tty: string | null,
  entry: UnifiedTerminal | undefined,
  closed: boolean
): TermStatus {
  if (!tty) return 'empty';
  if (closed) return 'closed';
  if (!entry) return 'stopped';

  const st = (entry.current_task?.status ?? '').toLowerCase();
  const now = Date.now();
  const lastOut = TerminalManager.outputAt(tty);
  const hasRenderer = lastOut !== 0;

  // 1. App-level task reached terminal state
  if (['done', 'completed', 'success', 'succeeded', 'finished'].includes(st)) {
    TerminalManager.setWorkEnded(tty);
    return 'over';
  }
  if (['cancelled', 'canceled', 'blocked', 'failed', 'error'].includes(st)) {
    TerminalManager.setWorkEnded(tty);
    return 'stopped';
  }

  // 2. Fetch live terminal buffer
  const linesList = TerminalManager.lastLines(tty, 80);
  const recentLines = linesList.join('\n');
  const nonBlankLines = linesList.map((l) => l.trim()).filter(Boolean);
  const lastLine = nonBlankLines[nonBlankLines.length - 1] || '';
  const secondLastLine = nonBlankLines[nonBlankLines.length - 2] || '';
  const tail = `${secondLastLine}\n${lastLine}`;

  // 3. Identify active CLI type
  const cliLower = (entry.cli || '').toLowerCase().trim();
  const claude =
    cliLower.includes('claude') ||
    /claude\s+code|anthropics?\/claude|auto\s+mode|api usage billing/i.test(recentLines);
  const codex =
    cliLower.includes('codex') ||
    /\bcodex\b|openai-codex|codex-cli|\bopenai\s+codex\b/i.test(recentLines);
  const opencode =
    cliLower.includes('opencode') ||
    /\bopencode\b/i.test(recentLines);
  const antigravity =
    cliLower.includes('antigravity') ||
    cliLower === 'agy' ||
    cliLower === 'jetski' ||
    /\bantigravity\b|\bagy\b|google\s+antigravity|google\s+deepmind/i.test(recentLines);
  const cursor =
    cliLower.includes('cursor') ||
    /\bcursor\b/i.test(recentLines);
  const gemini =
    cliLower.includes('gemini') ||
    /\bgemini\b/i.test(recentLines);

  // 4. Genuine question or permission check
  // NOTE: Static tips, welcome banners, shortcuts, and root prompts are NOT questions!
  const hasInteractiveMenu =
    /([>❯*]\s*)?\d+[.)]\s+.+\n.*([>❯*]\s*)?\d+[.)]\s+/i.test(recentLines) || // 1. ... \n 2. ...
    /(\([yY]\/[nN]\)|\[[yY]\/[nN]\])/i.test(tail);

  const hasPermissionPhrase =
    /\b(allow tool execution|permission request|permission required|do you want to proceed|authorize tool|allow this action)\b/i.test(
      recentLines
    ) ||
    (/\b(proceed\?|continue\?|confirm\?|allow\s+.*\?)\b/i.test(tail) &&
      !/shortcuts|tips|hints/i.test(tail));

  const isGenuineQuestion =
    hasInteractiveMenu ||
    hasPermissionPhrase ||
    (/\?\s*$/.test(lastLine) && !/shortcuts|hints|\? for|tips|help/i.test(lastLine));

  // 5. OpenCode: ground truth from sidecar / OpenCode SQLite database
  const ocState: string = (entry as any)?.opencode_status?.state ?? 'off';
  const ocLastText: string = (entry as any)?.opencode_status?.last_text ?? '';
  const ocQuestion: boolean = Boolean(
    ocLastText.trim().endsWith('?') && !ocLastText.includes('? for shortcuts')
  );

  if (opencode || ocState !== 'off') {
    if (ocState === 'working') return 'running';
    if (ocState === 'waiting') {
      if (ocQuestion || isGenuineQuestion) return 'asking';
      return 'stopped';
    }
  }

  // 6. Claude Code (stabilized against status badge flickering during tool runs)
  if (claude) {
    const isAtPrompt = /[>❯]\s*$/.test(lastLine) || /^[>❯]\s*Try\s+["']/i.test(lastLine);
    const claudeWorking =
      /(thought for\s+\d+|thinking\.\.\.|\*\s+(update|explore|read|edit|bash|let me|write)|added \d+ line|removed \d+ line|running tool|executing bash|●\s+\w+\(|Investigating|Searching)/i.test(
        recentLines
      ) ||
      Boolean((entry as any)?.claude_running && !isAtPrompt) ||
      (now - lastOut < 3000 && !isAtPrompt);
    if (claudeWorking && !isAtPrompt) return 'running';
    if (isGenuineQuestion) return 'asking';
    // Sitting at idle prompt (e.g. > Try "..." or >> auto mode on or root prompt) -> STOPPED
    return 'stopped';
  }

  // 7. OpenAI Codex
  if (codex) {
    const codexIdle =
      /ask codex to do anything|for agents\s*·\s*\?\s*for shortcuts/i.test(recentLines) ||
      /[❯>$]\s*$/.test(lastLine);
    const codexWorking =
      /(?:editing|reading|running|building|testing)\s+\S+/i.test(recentLines) && !codexIdle;
    if (codexWorking) return 'running';
    if (isGenuineQuestion) return 'asking';
    return 'stopped';
  }

  // 8. Antigravity CLI
  if (antigravity) {
    const isAtPrompt = /[❯>$?]\s*$/.test(lastLine);
    const agyWorking =
      /(thinking|editing|running|analyzing|generating|searching|tool call|executing)/i.test(recentLines) ||
      (now - lastOut < 3000 && !isAtPrompt);
    if (agyWorking && !isAtPrompt) return 'running';
    if (isGenuineQuestion) return 'asking';
    return 'stopped';
  }

  // 9. Cursor and Gemini
  if (cursor || gemini) {
    const isAtPrompt = /[❯>$]\s*$/.test(lastLine);
    const working = now - lastOut < 3000 && !isAtPrompt;
    if (working) return 'running';
    if (isGenuineQuestion) return 'asking';
    return 'stopped';
  }

  // 9. App-tracked task in flight
  if (st.length > 0) {
    if (isGenuineQuestion) return 'asking';
    return 'running';
  }

  // 10. Generic shell process: streaming output without an idle shell prompt
  const idleShellPrompt =
    /^(?:(?:\([^)]+\)\s*)?[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+.*[$#%➜❯]|\$|%|>|❯)\s*$/.test(
      lastLine
    );
  if (hasRenderer && now - lastOut < 2000 && !idleShellPrompt) {
    return 'running';
  }

  if (isGenuineQuestion) return 'asking';

  return 'stopped';
}

/** Short label + color for a derived status. */
export function statusLabel(s: TermStatus): { text: string; color: string } {
  switch (s) {
    case 'running':
      return { text: 'RUNNING', color: '#22c55e' };
    case 'asking':
      return { text: 'ASKING', color: '#a855f7' };
    case 'stopped':
      return { text: 'STOPPED', color: '#64748b' };
    case 'over':
      return { text: 'OVER', color: '#3b82f6' };
    case 'closed':
      return { text: 'EXITED', color: '#475569' };
    default:
      return { text: 'EMPTY', color: '#334155' };
  }
}

/** Helper to retrieve live elapsed working duration and formatted timestamps for a terminal. */
export function getTerminalWorkDuration(
  tty: string,
  status: TermStatus
): {
  durationStr: string;
  startTs: number;
  endTs: number;
  startTimeFormatted: string;
  endTimeFormatted: string;
  isLive: boolean;
} {
  const start =
    TerminalManager.workStartedAt(tty) || TerminalManager.createdAt(tty) || Date.now();
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
    const endTs = ended > start ? ended : TerminalManager.outputAt(tty) || now;
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
