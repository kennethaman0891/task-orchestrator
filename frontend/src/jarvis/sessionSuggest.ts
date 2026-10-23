import { apiBase } from '@/lib/api';
import { deriveTaskStatus } from '@/lib/status';
import { TerminalManager } from '@/terminal/TerminalManager';
import type { UnifiedTerminal } from '@/types';
import { jarvisManager } from './agent/JarvisManager';

const SAME_LINE_GAP_MS = 180_000;
const MIN_GAP_MS = 20_000;

let inflight = false;
const lastTry = new Map<string, { at: number; line: string }>();

export type SuggestOutcome =
  | { kind: 'skip' }
  | { kind: 'fail' }
  | { kind: 'ok'; suggestion: string; spoken: string };

export function screenTail(id: string): { buffer: string; line: string } {
  const lines = TerminalManager.getBufferText(id, 80);
  const text = lines.join('\n').trim();
  const buffer = text.length > 4000 ? text.slice(-4000) : text;
  const nonBlank = lines.map((l) => l.trim()).filter(Boolean);
  return { buffer, line: nonBlank[nonBlank.length - 1] || '' };
}

export function sessionIsWorking(id: string, entry?: UnifiedTerminal): boolean {
  if (!entry) return false;
  if (entry.opencode_status?.state === 'working') return true;
  if (entry.current_task?.status === 'running') return true;
  return deriveTaskStatus(id, entry, false) === 'running';
}

/** One model suggestion for a working terminal that has no user task. Never writes the PTY. */
export async function requestSessionSuggestion(opts: {
  terminalId: string;
  entry?: UnifiedTerminal;
  cwd?: string;
  cliName?: string;
}): Promise<SuggestOutcome> {
  const agent = jarvisManager.getAgent(opts.terminalId);
  if (agent.userGaveTask || agent.pendingPrompt) return { kind: 'skip' };
  if (!sessionIsWorking(opts.terminalId, opts.entry)) return { kind: 'skip' };

  const { buffer, line } = screenTail(opts.terminalId);
  if (!buffer) return { kind: 'skip' };

  const now = Date.now();
  const prev = lastTry.get(opts.terminalId);
  if (prev && now - prev.at < MIN_GAP_MS) return { kind: 'skip' };
  if (prev && prev.line === line && now - prev.at < SAME_LINE_GAP_MS) return { kind: 'skip' };
  if (inflight) return { kind: 'skip' };

  inflight = true;
  lastTry.set(opts.terminalId, { at: now, line });
  try {
    const res = await fetch(`${apiBase()}/api/terminals/${encodeURIComponent(opts.terminalId)}/suggest-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buffer,
        cwd: opts.cwd || opts.entry?.cwd || '',
        cli_name: opts.cliName || opts.entry?.cli || '',
      }),
    });
    if (!res.ok) return { kind: 'fail' };
    const data = await res.json();
    const suggestion = String(data.suggestion || '').trim();
    const spoken = String(data.spoken || '').trim();
    if (!suggestion) return { kind: 'fail' };
    if (opts.entry?.suggested_task && opts.entry.suggested_task === suggestion) {
      return { kind: 'ok', suggestion, spoken: '' };
    }
    return { kind: 'ok', suggestion, spoken: spoken || suggestion };
  } catch {
    return { kind: 'fail' };
  } finally {
    inflight = false;
  }
}
