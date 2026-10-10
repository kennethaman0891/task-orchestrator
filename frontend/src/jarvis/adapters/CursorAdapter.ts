import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class CursorAdapter implements ICLIAdapter {
  id = 'cursor' as const;
  name = 'Cursor';

  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean {
    const p = (processCli || '').toLowerCase();
    const a = (ttyAgent || '').toLowerCase();
    if (p.includes('cursor') || a.includes('cursor')) {
      return true;
    }
    return this.detectBuffer(bufferLines);
  }

  detectBuffer(bufferLines: string[]): boolean {
    if (!bufferLines || bufferLines.length === 0) return false;
    const text = bufferLines.join('\n');
    return /cursor-agent|\bcursor\s+ai\b|\bcursor-cli\b/i.test(text);
  }

  parse(bufferLines: string[], _currentContext?: Partial<SessionContext>): CLIAdapterResult {
    const lastLine = bufferLines[bufferLines.length - 1] || '';
    const waitingForInput = /[❯>$?]\s*$/.test(lastLine);

    let taskTitle: string | undefined;
    let currentActivity: string | undefined;
    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!taskTitle && /^(task|goal|implement):\s*(.+)/i.test(line)) {
        taskTitle = line;
      }
      if (!currentActivity && /(editing|generating|running|indexing)/i.test(line)) {
        currentActivity = line;
      }
      if (!recentAction && /(✓|done|applied)/i.test(line)) {
        recentAction = line;
      }
      if (!error && /(error|failed|fatal):/i.test(line)) {
        error = line;
      }
    }

    return {
      detected: true,
      cli: 'cursor',
      cliName: 'Cursor',
      state: error ? 'error' : waitingForInput ? 'waiting_for_input' : 'running',
      taskTitle: taskTitle || 'Cursor Agent Session',
      currentActivity: currentActivity || (waitingForInput ? 'Awaiting prompt' : 'Generating code'),
      recentAction,
      error,
      waitingForInput,
    };
  }
}
