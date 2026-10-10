import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';

export class GenericShellAdapter implements ICLIAdapter {
  id = 'shell' as const;
  name = 'Generic Shell';

  private lastProcessCli?: string;

  detect(_bufferLines: string[], processCli?: string, _ttyAgent?: string): boolean {
    this.lastProcessCli = processCli;
    return true; // Fallback matches any terminal
  }

  parse(bufferLines: string[], _currentContext?: Partial<SessionContext>): CLIAdapterResult {
    const lastLine = bufferLines[bufferLines.length - 1] || '';
    const waitingForInput = /[$%#❯>]\s*$/.test(lastLine);

    let recentAction: string | undefined;
    let error: string | undefined;

    for (let i = bufferLines.length - 1; i >= 0; i--) {
      const line = bufferLines[i].trim();
      if (!error && /(error|failed|fatal|command not found|exit code [1-9])/i.test(line)) {
        error = line;
      }
      if (!recentAction && (line.startsWith('$') || line.startsWith('%'))) {
        recentAction = `Executed: ${line.substring(1).trim()}`;
      }
    }

    const p = (this.lastProcessCli || '').toLowerCase().trim();
    const effectiveCli = p && p !== 'zsh' && p !== 'bash' && p !== 'sh' && p !== 'unknown'
      ? p
      : 'shell';

    const cliName = effectiveCli === 'shell'
      ? 'Shell'
      : (effectiveCli.charAt(0).toUpperCase() + effectiveCli.slice(1));

    return {
      detected: true,
      cli: effectiveCli,
      cliName,
      state: error ? 'error' : (waitingForInput ? 'idle' : 'running'),
      taskTitle: effectiveCli === 'shell' ? 'Interactive Shell' : `${cliName} Session`,
      currentActivity: waitingForInput ? 'Ready for command' : `Running ${cliName}`,
      recentAction,
      error,
      waitingForInput,
    };
  }
}
