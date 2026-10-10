import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class CodexAdapter implements ICLIAdapter {
  id = 'codex' as const;
  name = 'Codex';

  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean {
    if (this.detectBuffer(bufferLines)) return true;
    const p = (processCli || '').toLowerCase();
    const a = (ttyAgent || '').toLowerCase();
    return p.includes('codex') || a.includes('codex');
  }

  detectBuffer(bufferLines: string[]): boolean {
    if (!bufferLines || bufferLines.length === 0) return false;
    const text = bufferLines.join('\n');
    return /\bcodex\b|openai-codex|codex-cli|\bopenai\s+codex\b/i.test(text);
  }

  parse(bufferLines: string[], _currentContext?: Partial<SessionContext>): CLIAdapterResult {
    const waitingForInput = /[?❯>$]\s*$/.test(bufferLines[bufferLines.length - 1] || '');

    // Look for task or activity in buffer
    let taskTitle: string | undefined;
    let currentActivity: string | undefined;
    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!taskTitle && /^(task|goal|implement|fix|refactor|create):\s*(.+)/i.test(line)) {
        taskTitle = line;
      }
      if (!currentActivity && /^(editing|reading|running|building|testing)\s+(.+)/i.test(line)) {
        currentActivity = line;
      }
      if (!recentAction && /(✓|✔|done|completed|created|modified)\s+(.+)/i.test(line)) {
        recentAction = line;
      }
      if (!error && /(error|failed|fatal|exception|traceback):/i.test(line)) {
        error = line;
      }
    }

    return {
      detected: true,
      cli: 'codex',
      cliName: 'Codex',
      state: error ? 'error' : (waitingForInput ? 'waiting_for_input' : 'running'),
      taskTitle: taskTitle || 'Codex Agent Session',
      currentActivity: currentActivity || (waitingForInput ? 'Waiting for prompt' : 'Processing instructions'),
      recentAction,
      error,
      waitingForInput,
    };
  }
}
