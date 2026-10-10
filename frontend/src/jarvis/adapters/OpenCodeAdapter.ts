import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class OpenCodeAdapter implements ICLIAdapter {
  id = 'opencode' as const;
  name = 'OpenCode';

  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean {
    // 1. Buffer evidence is the active ground truth of what is rendered on screen
    if (this.detectBuffer(bufferLines)) return true;

    // 2. Metadata fallback when buffer is empty/initializing
    const p = (processCli || '').toLowerCase();
    const a = (ttyAgent || '').toLowerCase();
    return p.includes('opencode') || a.includes('opencode');
  }

  detectBuffer(bufferLines: string[]): boolean {
    if (!bufferLines || bufferLines.length === 0) return false;
    const text = bufferLines.join('\n');
    // ONLY patterns exclusive to OpenCode UI — nothing that Claude Code also renders.
    // Removed: `try "..."` (Claude Code shows `try "refactor <filepath>"` suggestions)
    // Removed: `/effort` (too generic, could appear in any CLI output)
    return /opencode|ask anything\b|tab agents\b|ctrl\+p commands\b|build\s*[·•]\s*\S+\s+\S+|plan\s*[·•]\s*\S+\s+\S+|\/connect\s+to\s+add|\b\d+\s*mcp\s*\/status|mcp\s*\/status\s*\d+\.\d+\.\d+/i.test(text);
  }

  parse(bufferLines: string[], currentContext?: Partial<SessionContext>): CLIAdapterResult {
    const lastLine = bufferLines[bufferLines.length - 1] || '';
    const waitingForInput = /[❯>]\s*$/.test(lastLine) || /waiting for input/i.test(lastLine) || /ask anything/i.test(lastLine);

    let taskTitle: string | undefined = currentContext?.currentTaskTitle;
    let currentActivity: string | undefined;
    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!taskTitle && /^(task|objective):\s*(.+)/i.test(line)) {
        taskTitle = line;
      }
      if (!currentActivity && /(thinking|editing|building|executing)/i.test(line)) {
        currentActivity = line;
      }
      if (!recentAction && /(✓|done|saved|applied diff)/i.test(line)) {
        recentAction = line;
      }
      if (!error && /(failed|error|exception)/i.test(line)) {
        error = line;
      }
    }

    return {
      detected: true,
      cli: 'opencode',
      cliName: 'OpenCode',
      state: error ? 'error' : (waitingForInput ? 'waiting_for_input' : 'running'),
      taskTitle: taskTitle || 'OpenCode Autonomous Session',
      currentActivity: currentActivity || (waitingForInput ? 'Idle at prompt' : 'Executing turn'),
      recentAction,
      error,
      waitingForInput,
    };
  }
}

