// Ready-prompt fixtures for deriveTaskStatus. Run from frontend/:
//   node --experimental-strip-types src/lib/status.fixture.ts
//   npx tsx src/lib/status.fixture.ts
import { TerminalManager } from '@/terminal/TerminalManager';
import { deriveTaskStatus, minTerminal, statusLabel, type TermStatus } from '@/lib/status';
import type { UnifiedTerminal } from '@/types';

const oldOutput = Date.now() - 10_000;
const freshOutput = Date.now();

const antigravity = [
  'Antigravity CLI 1.4.5',
  '>',
  '? for shortcuts          Gemini 3.8 Flash · medium',
];

function alive(overrides: Partial<UnifiedTerminal> = {}): UnifiedTerminal {
  return { ...minTerminal('tty-1'), is_live: true, ...overrides };
}

function check(
  name: string,
  lines: string[],
  outputAt: number,
  expected: TermStatus,
  opts: { entry?: UnifiedTerminal; closed?: boolean; tty?: string | null } = {},
): void {
  const prevLines = TerminalManager.lastLines;
  const prevOut = TerminalManager.outputAt;
  TerminalManager.lastLines = () => lines;
  TerminalManager.outputAt = () => outputAt;
  try {
    const tty = opts.tty === undefined ? 'tty-1' : opts.tty;
    const entry = opts.entry === undefined ? alive() : opts.entry;
    const got = deriveTaskStatus(tty, entry, opts.closed ?? false);
    if (got !== expected) {
      throw new Error(`${name}: expected ${expected}, got ${got}`);
    }
    console.log(`ok  ${name}`);
  } finally {
    TerminalManager.lastLines = prevLines;
    TerminalManager.outputAt = prevOut;
  }
}

check('antigravity splash', antigravity, oldOutput, 'idle');
check('claude prompt', ['❯', '? for shortcuts'], oldOutput, 'idle');
check('claude try footer', ['❯ Try "fix the tests"', '? for shortcuts'], oldOutput, 'idle');
check('codex named prompt', ['codex>'], oldOutput, 'idle');
check('codex ask anything', ['> ask anything'], oldOutput, 'idle');
check('gemini prompt', ['gemini>'], oldOutput, 'idle');
check(
  'opencode waiting',
  ['anything'],
  oldOutput,
  'idle',
  { entry: alive({ opencode_status: { state: 'waiting', last_update_ms: 0, last_text: '' } }) },
);
check(
  'opencode working',
  ['opencode>'],
  oldOutput,
  'running',
  { entry: alive({ opencode_status: { state: 'working', last_update_ms: 0, last_text: '' } }) },
);
check('zsh prompt', ['kenneth@host ~/Region5 %'], oldOutput, 'idle');
check('bare shell prompt', ['$'], oldOutput, 'idle');
check('antigravity fresh output still idle', antigravity, freshOutput, 'idle');
check('thinking marker', ['thinking...'], oldOutput, 'running');
check('running tool marker', ['running tool: bash'], oldOutput, 'running');
check('permission question', ['Do you want to proceed?'], oldOutput, 'asking');
check(
  'codex welcome',
  [
    '>_ OpenAI Codex (v0.163.0)',
    '> Ask Codex to do anything',
    'gemma4 default · ~/Region5',
    'enter/esc latest · ? shortcuts',
  ],
  oldOutput,
  'idle',
);
check(
  'codex welcome fresh redraw',
  ['> Ask Codex to do anything', 'gemma4 default · ~/Region5', 'enter/esc latest · ? shortcuts'],
  freshOutput,
  'idle',
);
check('failed task', ['>'], oldOutput, 'stopped', {
  entry: alive({ current_task: { status: 'failed' } as unknown as UnifiedTerminal['current_task'] }),
});
check('closed session', ['>'], oldOutput, 'closed', { closed: true });
check('no tty', [], oldOutput, 'empty', { tty: null });

const idleLabel = statusLabel('idle');
if (idleLabel.text !== 'IDLE') {
  throw new Error(`statusLabel text: expected IDLE, got ${idleLabel.text}`);
}
if (idleLabel.color === '#64748b') {
  throw new Error('IDLE reuses the STOPPED color');
}
if (statusLabel('stopped').text !== 'STOPPED' || statusLabel('stopped').color !== '#64748b') {
  throw new Error('STOPPED label changed');
}
console.log('ok  status labels');
console.log('all status fixtures passed');
