// Terminal cards for Qwen Prime. Membership is the workspace pane session id.

export interface QwenPaneRef {
  tty: string | null;
  label?: string;
}

export interface QwenWorkspaceRef {
  panes?: QwenPaneRef[];
}

export interface QwenTerminalRef {
  tty?: string;
  agent?: string;
  cli?: string;
  is_live?: boolean;
  session_name?: string;
  window_name?: string;
  pane_title?: string;
  current_task?: unknown;
}

export interface QwenWorkspaceTerminal {
  sessionId: string;
  tty: string;
  label: string;
  cli: string;
  busy: boolean;
}

export function terminalsForWorkspace(
  workspace: QwenWorkspaceRef | undefined | null,
  terminals: Record<string, QwenTerminalRef | undefined>,
): QwenWorkspaceTerminal[] {
  if (!workspace?.panes?.length) return [];
  const seen = new Set<string>();
  const result: QwenWorkspaceTerminal[] = [];
  for (const pane of workspace.panes) {
    const sessionId = pane.tty;
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const entry = terminals[sessionId];
    if (entry && entry.is_live === false) continue;
    const cli = entry?.cli || entry?.agent || 'shell';
    const label =
      pane.label ||
      entry?.session_name ||
      entry?.pane_title ||
      entry?.window_name ||
      sessionId;
    result.push({
      sessionId,
      tty: entry?.tty || sessionId,
      label,
      cli,
      busy: Boolean(entry?.current_task),
    });
  }
  return result;
}
