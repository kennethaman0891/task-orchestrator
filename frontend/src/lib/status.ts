// status.ts — Derive terminal task status from ground-truth CLI signals.
// Accurately differentiates RUNNING vs ASKING vs IDLE vs STOPPED / OVER across Claude Code,
// OpenAI Codex, OpenCode, Antigravity CLI, and generic shells.

import type { UnifiedTerminal } from '@/types';
import { TerminalManager } from '@/terminal/TerminalManager';
import { formatLiveDuration, formatTimeOfDay } from '@/lib/format';

export type TermStatus = 'empty' | 'closed' | 'running' | 'stopped' | 'over' | 'asking' | 'idle';

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
/**
 * Universal Prompt Entry Pattern:
 * Matches any prompt character or prompt prefix across:
 * - Shells: `$ `, `% `, `# `, `> `, `❯ `, `➜ `, `→ `, `» `, `user@host:path$ `
 * - REPLs: `>>> `, `... `, `In [1]: `, `(Pdb) `, `php > `, `irb...>`, `julia>`, `ghci>`, `Prelude>`
 * - Database CLIs: `sqlite> `, `mysql> `, `mariadb> `, `postgres=# `, `mydb=> `, `127.0.0.1:6379> `, `mongosh>`
 * - Agent CLIs: `> [ ]`, `> Try "..."`, `codex>`, `opencode>`, `aider>`, `ollama>`, `claude>`, `antigravity>`, `agy>`
 */
const UNIVERSAL_PROMPT_ENTRY_RE =
  /^(?:(?:\([^)]+\)\s*)?[a-zA-Z0-9_.-]+@[^:]+:.*[$#%➜❯→»]\s*|[a-zA-Z0-9_.-]+@\S+\s+\S.*[$#%➜❯→»]\s*|[$#%➜❯→»]\s*|>>>\s*|\.\.\.\s*|In\s*\[\d+\]:\s*|\(Pdb\)\s*|[>❯]\s*(?:\[\s*\]|Try\s+["'].*|type\s+a\s+message.*|ask\s+anything.*|Ask\s+Codex\b.*|what\s+would\s+you\s+like.*)|(?:sqlite|mysql|mariadb|postgres|psql|redis|mongosh|php|irb|julia|ghci|aider|ollama|claude|codex|opencode|antigravity|agy|gemini)\s*>\s*|[a-zA-Z0-9_.-]+(?:=[#>]|[-#>]|\(#\))\s*|[a-zA-Z0-9_.:-]+>\s*|[>❯]\s*)$/i;

/**
 * Universal Accessory / Footer Pattern:
 * Lines that may sit immediately underneath an idle prompt:
 * - Mode indicators: `>> auto mode on (shift+tab)`, `bypass permissions`, `compact mode`
 * - Shortcuts: `? for shortcuts`, `Press ? to see keyboard shortcuts`, `ctrl+c to exit`, `esc to interrupt`
 * - Cost / Info: `Cost: $...`, `API Usage Billing`, `Context: ...`, `Tokens: ...`
 * - Box borders: `╰───╯`, `─────`, etc.
 */
const UNIVERSAL_FOOTER_RE =
  /^(?:>>\s*auto\s+mode\b|shift\+tab\b|\?\s*for\s*shortcuts\b.*|.*\?\s*shortcuts\b.*|.*\benter\/esc\b.*|.*\bdefault\s+[·•]\s+\S+.*|press\s*\?\s*to\s*see\b|esc\s*to\s*(?:interrupt|cancel)\b|ctrl\+[a-z]\s*(?:commands|to)\b|tab\s*agents\b|\/help\b|bypass\s*permissions\b|compact\s*mode\b|api\s*usage\s*billing\b|cost:\s*\$\d+|context:\s*\d+|tokens?:\s*\d+|[─━═\-_+]{3,}|[╭╮╰╯│┌┐└┘├┤┬┴┼]+.*)$/i;

/**
 * Universal Question / Permission Pattern:
 * Matches interactive yes/no questions, permissions, numbered menus, password prompts.
 */
function isUniversalQuestion(tailLines: string[], lastLine: string): boolean {
  const tailText = tailLines.join('\n');

  // 1. Interactive choice / numbered menu (e.g. 1. Yes \n 2. No)
  if (/([>❯*]\s*)?\d+[.)]\s+.+\n.*([>❯*]\s*)?\d+[.)]\s+/i.test(tailText)) {
    return true;
  }

  // 2. Binary confirmations: [y/N], (y/n), (yes/no)
  if (
    /(?:\([yY]\/[nN]\)|\[[yY]\/[nN]\]|\[[yY]\s*\/\s*[nN]\]|\(yes\/no\))\s*$/i.test(lastLine) ||
    /(?:\([yY]\/[nN]\)|\[[yY]\/[nN]\]|\[[yY]\s*\/\s*[nN]\]|\(yes\/no\))\s*$/i.test(tailText)
  ) {
    return true;
  }

  // 3. Permission phrases
  if (
    /\b(?:allow tool execution|permission request|permission required|do you want to proceed|authorize tool|allow this action|allow bash command|do you want to continue|apply this change\?)\b/i.test(
      tailText
    )
  ) {
    return true;
  }

  // 4. Password / Input prompts
  if (/(?:password|passphrase|enter\s+value|input|choice):\s*$/i.test(lastLine)) {
    return true;
  }

  // 5. Explicit question endings (excluding static tips like '? for shortcuts')
  if (/\?\s*$/.test(lastLine) && !/shortcuts|hints|\? for|tips|help|keyboard/i.test(lastLine)) {
    return true;
  }

  return false;
}

/**
 * Check if the terminal buffer is sitting at an idle prompt zone.
 * Scans the last 6 non-blank lines: if a prompt entry line is found and all
 * lines beneath it are recognized accessory footers, the CLI is ready.
 */
function isAtUniversalPrompt(rawLines: string[]): boolean {
  const nonBlankLines = rawLines.map((l) => l.trim()).filter(Boolean);
  if (nonBlankLines.length === 0) return true;
  const zone = nonBlankLines.slice(-6);

  // Scan backwards from bottom of zone
  for (let i = zone.length - 1; i >= 0; i--) {
    const line = zone[i];
    if (UNIVERSAL_PROMPT_ENTRY_RE.test(line)) {
      // Check that all lines following this prompt line are valid footers
      const followingAreFooters = zone
        .slice(i + 1)
        .every((f) => UNIVERSAL_FOOTER_RE.test(f) || f.startsWith('>') || f.startsWith('>>'));
      if (followingAreFooters) {
        return true;
      }
    }
  }

  // Fallback for single line prompt or prompt with trailing auto mode
  const lastLine = zone[zone.length - 1] || '';
  const secondLastLine = zone[zone.length - 2] || '';
  if (/^[>❯$]\s*$/.test(lastLine)) return true;
  if (
    /^[>❯]\s*(?:Try\s+["']|\[\s*\])/i.test(secondLastLine) &&
    UNIVERSAL_FOOTER_RE.test(lastLine)
  ) {
    return true;
  }

  return false;
}

/**
 * Derive the RIGHT-SIDE status for ANY terminal CLI by inspecting live buffer
 * boundaries, active process state, and ground-truth signals.
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

  // 1. App-level task reached terminal state — sidecar only, no buffer walk
  if (['done', 'completed', 'success', 'succeeded', 'finished'].includes(st)) {
    TerminalManager.setWorkEnded(tty);
    return 'over';
  }
  if (['cancelled', 'canceled', 'blocked', 'failed', 'error'].includes(st)) {
    TerminalManager.setWorkEnded(tty);
    return 'stopped';
  }

  // 2. Fetch live terminal buffer (prompt / question detection only)
  const linesList = TerminalManager.lastLines(tty, 80);
  const nonBlankLines = linesList.map((l) => l.trim()).filter(Boolean);
  const lastLine = nonBlankLines[nonBlankLines.length - 1] || '';
  const recentTailLines = nonBlankLines.slice(-15);
  const recentTail = recentTailLines.join('\n');

  // 3. Check for genuine question or permission request FIRST
  const isQuestion = isUniversalQuestion(recentTailLines, lastLine);
  if (isQuestion) {
    return 'asking';
  }

  // 4. OpenCode SQLite sidecar check (if active)
  const ocState: string = (entry as any)?.opencode_status?.state ?? 'off';
  if (ocState === 'working') {
    return 'running';
  }
  if (ocState === 'waiting') {
    return 'idle';
  }

  // 5. Universal Prompt Zone Check: a live CLI at its prompt is ready, not failed.
  const atPrompt = isAtUniversalPrompt(nonBlankLines);
  if (atPrompt) {
    return 'idle';
  }

  // 6. App-tracked task in flight
  if (st.length > 0) {
    return 'running';
  }

  // 7. Active Work Markers in recent turn (last 15 lines only, NOT 80-line history)
  const hasActiveWorkMarkers =
    /(?:thought for\s+\d+|thinking\.\.\.|\*\s+(?:update|explore|read|edit|bash|write)\b|running tool\b|executing bash\b|generating\b|analyzing\b|searching\b|compiling\b|building\b|testing\b|fetching\b|downloading\b|installing\b|press esc to interrupt)/i.test(
      recentTail
    );
  if (hasActiveWorkMarkers) {
    return 'running';
  }

  // 8. Live output streaming without an idle prompt (active command in progress)
  const now = Date.now();
  const lastOut = TerminalManager.outputAt(tty);
  if (lastOut !== 0 && now - lastOut < 2500) {
    return 'running';
  }

  // Alive, quiet, and not a failed task. Antigravity's bare ">" welcome
  // screen lands here when the footer shares a line with the model name.
  return 'idle';
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
    case 'idle':
      return { text: 'IDLE', color: '#94a3b8' };
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
  lastTaskDurationStr?: string;
  isLive: boolean;
} {
  const start = TerminalManager.workStartedAt(tty);
  const ended = TerminalManager.workEndedAt(tty);
  const now = Date.now();
  const startTimeFormatted = start > 0 ? formatTimeOfDay(start) : '';

  if (status === 'running') {
    const startTs = start > 0 ? start : now;
    const elapsed = Math.max(0, now - startTs);
    return {
      durationStr: formatLiveDuration(elapsed),
      startTs,
      endTs: 0,
      startTimeFormatted: formatTimeOfDay(startTs),
      endTimeFormatted: '',
      isLive: true,
    };
  }

  if (status === 'asking') {
    const lastOut = TerminalManager.outputAt(tty);
    const waitingMs = lastOut > 0 ? Math.max(0, now - lastOut) : 0;
    return {
      durationStr: formatLiveDuration(waitingMs),
      startTs: start > 0 ? start : now,
      endTs: 0,
      startTimeFormatted: startTimeFormatted || formatTimeOfDay(now),
      endTimeFormatted: '',
      isLive: true,
    };
  }

  if (status === 'over') {
    const endTs = ended > start ? ended : TerminalManager.outputAt(tty) || now;
    const elapsed = start > 0 ? Math.max(0, endTs - start) : 0;
    return {
      durationStr: elapsed > 0 ? formatLiveDuration(elapsed) : '',
      startTs: start,
      endTs,
      startTimeFormatted,
      endTimeFormatted: formatTimeOfDay(endTs),
      isLive: false,
    };
  }

  if (status === 'stopped' || status === 'idle') {
    // The pill is the word itself (STOPPED or IDLE). A finished turn still
    // reports lastTaskDurationStr for the tooltip.
    let lastTaskDurationStr = '';
    let endTs = 0;
    if (start > 0 && ended > start) {
      endTs = ended;
      lastTaskDurationStr = formatLiveDuration(ended - start);
    }
    return {
      durationStr: '',
      startTs: start,
      endTs,
      startTimeFormatted,
      endTimeFormatted: endTs > 0 ? formatTimeOfDay(endTs) : '',
      lastTaskDurationStr,
      isLive: false,
    };
  }

  return {
    durationStr: '',
    startTs: 0,
    endTs: 0,
    startTimeFormatted: '',
    endTimeFormatted: '',
    isLive: false,
  };
}
