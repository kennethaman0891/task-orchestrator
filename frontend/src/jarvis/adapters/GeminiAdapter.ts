import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class GeminiAdapter implements ICLIAdapter {
  id = 'gemini' as const;
  name = 'Gemini CLI';

  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean {
    if (this.detectBuffer(bufferLines)) return true;
    const p = (processCli || '').toLowerCase();
    const a = (ttyAgent || '').toLowerCase();
    return p.includes('gemini') || a.includes('gemini');
  }

  detectBuffer(bufferLines: string[]): boolean {
    if (!bufferLines || bufferLines.length === 0) return false;
    const text = bufferLines.join('\n');
    return /gemini-cli|google-genai|\bgemini\s+model\b|\bgemini\s+cli\b/i.test(text);
  }

  parse(bufferLines: string[], _currentContext?: Partial<SessionContext>): CLIAdapterResult {
    const lastLine = bufferLines[bufferLines.length - 1] || '';
    const waitingForInput = /[❯>]\s*$/.test(lastLine) || /press enter/i.test(lastLine);

    let taskTitle: string | undefined;
    let currentActivity: string | undefined;
    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!taskTitle && /^(task|goal|query):\s*(.+)/i.test(line)) {
        taskTitle = line;
      }
      if (!currentActivity && /(generating|analyzing|calling tool|reading context)/i.test(line)) {
        currentActivity = line;
      }
      if (!recentAction && /(✓|success|stream completed|wrote file)/i.test(line)) {
        recentAction = line;
      }
      if (!error && /(quota exceeded|api error|failed|traceback)/i.test(line)) {
        error = line;
      }
    }

    return {
      detected: true,
      cli: 'gemini',
      cliName: 'Gemini CLI',
      state: error ? 'error' : (waitingForInput ? 'waiting_for_input' : 'running'),
      taskTitle: taskTitle || 'Gemini CLI Session',
      currentActivity: currentActivity || (waitingForInput ? 'Awaiting user input' : 'Streaming response'),
      recentAction,
      error,
      waitingForInput,
    };
  }
}
