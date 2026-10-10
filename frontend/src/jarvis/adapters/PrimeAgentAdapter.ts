import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class PrimeAgentAdapter implements ICLIAdapter {
  id = 'prime' as const;
  name = 'Prime Agent';

  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean {
    if (this.detectBuffer(bufferLines)) return true;
    const p = (processCli || '').toLowerCase();
    const a = (ttyAgent || '').toLowerCase();
    return (
      p.includes('prime') ||
      p.includes('prime-agent') ||
      p.includes('primeagent') ||
      a.includes('prime') ||
      a.includes('prime-agent')
    );
  }

  detectBuffer(bufferLines: string[]): boolean {
    if (!bufferLines || bufferLines.length === 0) return false;
    const text = bufferLines.join('\n');
    return (
      /\bprime-agent\b/i.test(text) ||
      /\bprimeagent\b/i.test(text) ||
      /\bprime\s+intellect\b/i.test(text) ||
      /\bprime\s+run\b/i.test(text) ||
      /\bprime\s+task\b/i.test(text) ||
      /\bprime\s+agent\b/i.test(text) ||
      /prime\s*>/i.test(text)
    );
  }

  parse(bufferLines: string[], _currentContext?: Partial<SessionContext>): CLIAdapterResult {
    const lastLine = bufferLines[bufferLines.length - 1] || '';
    const waitingForInput = /[?❯>$]\s*$/.test(lastLine) || /prime\s*>\s*$/i.test(lastLine);

    // Look for task or activity in buffer
    let taskTitle: string | undefined;
    let currentActivity: string | undefined;
    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!taskTitle && /^(task|goal|implement|fix|refactor|create|run):\s*(.+)/i.test(line)) {
        taskTitle = line;
      }
      if (!currentActivity && /^(editing|reading|running|building|testing|thinking|executing)\s+(.+)/i.test(line)) {
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
      cli: 'prime',
      cliName: 'Prime Agent',
      state: error ? 'error' : (waitingForInput ? 'waiting_for_input' : 'running'),
      taskTitle: taskTitle || 'Prime Agent Session',
      currentActivity: currentActivity || (waitingForInput ? 'Waiting for prompt' : 'Executing task'),
      recentAction,
      error,
      waitingForInput,
    };
  }
}
