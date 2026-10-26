import assert from 'node:assert/strict';
import { terminalsForWorkspace, type QwenTerminalRef } from './qwenWorkspaceTerminals';

const projectPath = '/Users/kennethaman/clone';

const terminals: Record<string, QwenTerminalRef & { cwd?: string }> = {
  'sess-a': {
    tty: 'ttys003',
    cli: 'zsh',
    is_live: true,
    session_name: 'build',
    cwd: '/tmp',
  },
  ttys003: { tty: 'ttys003', cli: 'zsh', is_live: true },
  '/dev/ttys003': { tty: 'ttys003', cli: 'zsh', is_live: true },
  'sess-dead': { tty: 'ttys009', is_live: false },
  'sess-other': { tty: 'ttys010', cli: 'codex', is_live: true },
  ttys050: { tty: 'ttys050', cwd: projectPath, is_live: true, cli: 'zsh' },
};

const cloneCards = terminalsForWorkspace(
  {
    panes: [
      { tty: 'sess-a', label: 'Build' },
      { tty: null },
      { tty: 'sess-dead', label: 'Old' },
      { tty: 'sess-a', label: 'duplicate' },
    ],
  },
  terminals,
);

assert.deepEqual(cloneCards.map((card) => card.sessionId), ['sess-a']);
assert.equal(cloneCards[0].tty, 'ttys003');
assert.equal(cloneCards[0].label, 'Build');
assert.equal(cloneCards[0].cli, 'zsh');
assert.equal(cloneCards.some((card) => card.tty === 'ttys050'), false);
assert.equal(cloneCards.some((card) => card.sessionId === 'sess-dead'), false);
assert.equal(cloneCards.some((card) => card.sessionId === 'sess-other'), false);

const otherWorkspace = terminalsForWorkspace(
  { panes: [{ tty: 'sess-other', label: 'Review' }] },
  terminals,
);
assert.deepEqual(otherWorkspace.map((card) => card.sessionId), ['sess-other']);

assert.deepEqual(terminalsForWorkspace({ panes: [] }, terminals), []);
assert.deepEqual(terminalsForWorkspace(null, terminals), []);

console.log('qwenWorkspaceTerminals.test.ts ok');
