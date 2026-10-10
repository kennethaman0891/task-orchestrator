import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class QwenAdapter implements ICLIAdapter {
  id = 'qwen' as const;
  name = 'Qwen';

  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean {
    const p = (processCli || '').toLowerCase();
    const a = (ttyAgent || '').toLowerCase();
    if (p.includes('qwen') || a.includes('qwen')) return true;

    const text = bufferLines.join('\n');
    return /qwen-cli|qwen2\.5|tongyi\s+qianwen/i.test(text);
  }

  parse(bufferLines: string[], _currentContext?: Partial<SessionContext>): CLIAdapterResult {
    const lastLine = bufferLines[bufferLines.length - 1] || '';
    const waitingForInput = /[❯>$]\s*$/.test(lastLine);

    let taskTitle: string | undefined;
    let currentActivity: string | undefined;
    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!taskTitle && /^(task|prompt|query):\s*(.+)/i.test(line)) {
        taskTitle = line;
      }
      if (!currentActivity && /(reasoning|generating|tool\s+call)/i.test(line)) {
        currentActivity = line;
      }
      if (!recentAction && /(✓|finished|output stream ended)/i.test(line)) {
        recentAction = line;
      }
      if (!error && /(error|exception|failed)/i.test(line)) {
        error = line;
      }
    }

    return {
      detected: true,
      cli: 'qwen',
      cliName: 'Qwen',
      state: error ? 'error' : (waitingForInput ? 'waiting_for_input' : 'running'),
      taskTitle: taskTitle || 'Qwen Session',
      currentActivity: currentActivity || (waitingForInput ? 'Waiting for prompt' : 'Generating code'),
      recentAction,
      error,
      waitingForInput,
    };
  }
}
