import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class AntigravityAdapter implements ICLIAdapter {
  id = 'antigravity' as const;
  name = 'Antigravity';

  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean {
    const p = (processCli || '').toLowerCase();
    const a = (ttyAgent || '').toLowerCase();
    if (p.includes('antigravity') || p.includes('agy') || a.includes('antigravity') || a.includes('agy')) {
      return true;
    }
    return this.detectBuffer(bufferLines);
  }

  detectBuffer(bufferLines: string[]): boolean {
    if (!bufferLines || bufferLines.length === 0) return false;
    const text = bufferLines.join('\n');
    return /\bantigravity\b|\bagy\b|antigravity-cli|google\s+antigravity|google\s+deepmind\b/i.test(text);
  }

  parse(bufferLines: string[], _currentContext?: Partial<SessionContext>): CLIAdapterResult {
    const lastLine = bufferLines[bufferLines.length - 1] || '';
    const waitingForInput =
      /[❯>$?]\s*$/.test(lastLine) ||
      /type a message/i.test(lastLine) ||
      /waiting for/i.test(lastLine);

    let taskTitle: string | undefined;
    let currentActivity: string | undefined;
    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!taskTitle && /^(task|goal|objective|plan):\s*(.+)/i.test(line)) {
        taskTitle = line;
      }
      if (!currentActivity && /(thinking|editing|running|analyzing|generating|searching)/i.test(line)) {
        currentActivity = line;
      }
      if (!recentAction && /(✓|✔|done|completed|created|saved|applied)/i.test(line)) {
        recentAction = line;
      }
      if (!error && /(error|failed|fatal|exception|traceback):/i.test(line)) {
        error = line;
      }
    }

    return {
      detected: true,
      cli: 'antigravity',
      cliName: 'Antigravity',
      state: error ? 'error' : waitingForInput ? 'waiting_for_input' : 'running',
      taskTitle: taskTitle || 'Antigravity Session',
      currentActivity: currentActivity || (waitingForInput ? 'Awaiting prompt' : 'Executing turn'),
      recentAction,
      error,
      waitingForInput,
    };
  }
}
