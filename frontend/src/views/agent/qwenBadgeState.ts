// Visible status of the Qwen header probe. Offline is only a completed
// profile whose Ollama daemon did not answer. A thrown fetch is Unreachable.

export type QwenBadgeState = 'checking' | 'online' | 'offline' | 'unreachable';

export function qwenBadgeState(input: {
  loading: boolean;
  profile: { ollama: { available: boolean } } | null;
  error: string | null;
}): QwenBadgeState {
  if (!input.profile && input.loading) return 'checking';
  if (!input.profile && input.error) return 'unreachable';
  if (!input.profile) return 'checking';
  return input.profile.ollama.available ? 'online' : 'offline';
}

export function qwenBadgeLabel(state: QwenBadgeState): string {
  if (state === 'checking') return 'Checking';
  if (state === 'online') return 'Ollama';
  if (state === 'offline') return 'Offline';
  return 'Unreachable';
}

export interface PipelineRow {
  index: number;
  title: string;
  label: string;
  cli: string;
  action: string;
  command: string;
  outcome: 'pending' | 'sent' | 'failed';
  error: string;
}

export function pipelineRows(subtasks: Array<{
  title: string;
  target_label?: string;
  target_tty: string;
  cli?: string;
  action_type: string;
  command: string;
  status: string;
  reasoning?: string;
  error?: string;
}>): PipelineRow[] {
  return subtasks.map((step, index) => {
    const outcome = step.status === 'sent' || step.status === 'done'
      ? 'sent'
      : step.status === 'failed'
        ? 'failed'
        : 'pending';
    return {
      index: index + 1,
      title: step.title,
      label: step.target_label || step.target_tty,
      cli: step.cli || '',
      action: step.action_type,
      command: step.command,
      outcome,
      error: outcome === 'failed' ? (step.error || step.reasoning || '') : '',
    };
  });
}

const BLOCKED_CLIS = new Set(['vim', 'nvim', 'htop', 'top', 'btop', 'tmux']);

export function dispatchBlockReason(cli: string, busy: boolean, open: boolean): string {
  const name = (cli || '').toLowerCase();
  if (BLOCKED_CLIS.has(name)) return `${name} is not a prompt target`;
  if (busy) return 'Terminal is busy';
  if (!open) return 'Terminal is not open';
  return '';
}
