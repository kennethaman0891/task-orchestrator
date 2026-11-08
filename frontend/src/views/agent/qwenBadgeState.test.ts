import { qwenBadgeLabel, qwenBadgeState, pipelineRows } from './qwenBadgeState';

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

assert(qwenBadgeState({ loading: true, profile: null, error: null }) === 'checking', 'loading');
assert(qwenBadgeLabel('checking') === 'Checking', 'checking label');
assert(qwenBadgeState({ loading: false, profile: null, error: 'HTTP 401' }) === 'unreachable', 'thrown');
assert(qwenBadgeLabel('unreachable') === 'Unreachable', 'unreachable label');
assert(
  qwenBadgeState({ loading: false, profile: { ollama: { available: false } }, error: null }) === 'offline',
  'daemon down',
);
assert(
  qwenBadgeState({ loading: true, profile: { ollama: { available: true } }, error: 'later' }) === 'online',
  'keep last good profile',
);
assert(qwenBadgeLabel('online') === 'Ollama', 'online label');
assert(qwenBadgeLabel('offline') === 'Offline', 'offline label');

const rows = pipelineRows([
  { title: 'Ask', target_label: 'Codex', target_tty: 'sess-1', cli: 'codex', action_type: 'agent_prompt', command: 'Review auth', status: 'sent' },
  { title: 'Miss', target_tty: 'sess-2', cli: 'zsh', action_type: 'shell_command', command: 'npm test', status: 'failed', reasoning: 'Terminal is not open' },
]);
assert(rows[0].outcome === 'sent' && rows[0].cli === 'codex' && rows[0].index === 1, 'sent row');
assert(rows[1].outcome === 'failed' && rows[1].error === 'Terminal is not open', 'failed row');

console.log('qwenBadgeState.test.ts ok');
