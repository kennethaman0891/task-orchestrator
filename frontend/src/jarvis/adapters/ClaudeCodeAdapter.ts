import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class ClaudeCodeAdapter implements ICLIAdapter {
  id = 'claude' as const;
  name = 'Claude Code';

  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean {
    // 1. Buffer evidence is the active ground truth of what is rendered on screen
    if (this.detectBuffer(bufferLines)) return true;

    // 2. Metadata fallback when buffer is empty/initializing
    const p = (processCli || '').toLowerCase();
    const a = (ttyAgent || '').toLowerCase();
    return p.includes('claude') || a.includes('claude');
  }

  detectBuffer(bufferLines: string[]): boolean {
    if (!bufferLines || bufferLines.length === 0) return false;
    const text = bufferLines.join('\n');
    return /claude\s+code\s+v\d+|anthropics?\/claude\b|welcome to claude\b|\bauto mode on\b|shift\+tab to cycle\b|thought for\s+\d+|bypass permissions\b|compact mode\b|api usage billing\b|security-review\b/i.test(text);
  }


  parse(bufferLines: string[], _currentContext?: Partial<SessionContext>): CLIAdapterResult {
    // Check non-empty lines at bottom
    const nonBlank = bufferLines.map((l) => l.trim()).filter(Boolean);
    const lastLine = nonBlank[nonBlank.length - 1] || '';
    const secondLastLine = nonBlank[nonBlank.length - 2] || '';

    // Check if Claude Code is in an active working / thinking / tool execution state
    const isWorking = bufferLines.some((l) =>
      /(thought for\s+\d+|thinking\.\.\.|\*\s+(update|explore|read|edit|bash|let me|write)|added \d+ line|removed \d+ line|running tool)/i.test(l)
    );

    // Waiting for user prompt or permission prompt
    const waitingForInput =
      !isWorking &&
      (/^([❯>]{1,2})\s*$/.test(lastLine) ||
       /\?\s*\(y\/n\)/i.test(lastLine) ||
       /\b(do you want to proceed|allow\s+)/i.test(lastLine) ||
       (secondLastLine.startsWith('>') && /auto mode on/i.test(lastLine)));

    let taskTitle: string | undefined;
    let currentActivity: string | undefined;
    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!taskTitle && /^(objective|task|prompt):\s*(.+)/i.test(line)) {
        taskTitle = line;
      }
      if (!currentActivity && /(thought for\s+\d+|thinking\.\.\.|running tool|executing bash|editing file|reading file|\*\s+\w+)/i.test(line)) {
        currentActivity = line;
      }
      if (!recentAction && /(✓|tool result|viewed file|updated|created file|added \d+ line)/i.test(line)) {
        recentAction = line;
      }
      if (!error && /(error|failed|rejected|exit code [1-9])/i.test(line)) {
        error = line;
      }
    }

    return {
      detected: true,
      cli: 'claude',
      cliName: 'Claude Code',
      state: error ? 'error' : (waitingForInput ? 'waiting_for_input' : 'running'),
      taskTitle: taskTitle || 'Claude Code Session',
      currentActivity: currentActivity || (waitingForInput ? 'Waiting for prompt' : 'Active turn execution'),
      recentAction,
      error,
      waitingForInput,
    };
  }
}
