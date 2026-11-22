import assert from 'node:assert/strict';
import {
  summarizeTaskToShortName,
  extractTaskFromBuffer,
  getAutoTerminalName,
  clearAutoTerminalName,
} from './autoTerminalName';

// 1. Fresh / idle CLI screens produce undefined (keeps default "Antigravity · 1" / "OpenCode · 6")
{
  const idleAntigravity = [
    'Google Antigravity CLI v1.2.0',
    '? for shortcuts',
    '❯ [ ]',
  ];
  assert.equal(extractTaskFromBuffer(idleAntigravity, 'antigravity'), null);

  const idleOpenCode = [
    'OpenCode v0.4.1',
    'Ask anything',
    'tab agents · ctrl+p commands',
    '❯ ',
  ];
  assert.equal(extractTaskFromBuffer(idleOpenCode, 'opencode'), null);

  const idleClaude = [
    'Welcome to Claude Code',
    'Auto mode on · shift+tab to cycle',
    '> Try "refactor src/app.ts"',
    '❯ ',
  ];
  assert.equal(extractTaskFromBuffer(idleClaude, 'claude'), null);
}

// 2. Extracts concise task names across ANY CLI
{
  const agyLines = [
    'Antigravity',
    '❯ please fix the login authentication bug in the sidebar',
    'Thinking...',
    'Reading src/components/shell/Sidebar.tsx',
  ];
  assert.equal(extractTaskFromBuffer(agyLines, 'antigravity'), 'Fix Login Authentication Bug');

  const claudeLines = [
    'Claude Code',
    '> can you help me refactor the database connection pool',
    'Thought for 4s',
    '* Edit backend/db.py',
  ];
  assert.equal(extractTaskFromBuffer(claudeLines, 'claude'), 'Refactor Database Connection');

  const openCodeLines = [
    '│ OpenCode │',
    '│ › build a dark mode toggle for settings │',
    '│ Thinking... │',
  ];
  assert.equal(extractTaskFromBuffer(openCodeLines, 'opencode'), 'Build Dark Mode Toggle');

  const explicitTaskLines = [
    'Task: optimize API response caching for workspace list',
    'Running tests...',
  ];
  assert.equal(extractTaskFromBuffer(explicitTaskLines, 'codex'), 'Optimize API Response');
}

// 3. Ignores slash commands, trivial shell commands, and permission prompts
{
  assert.equal(summarizeTaskToShortName('/compact'), null);
  assert.equal(summarizeTaskToShortName('/help'), null);
  assert.equal(summarizeTaskToShortName('git status'), null);
  assert.equal(summarizeTaskToShortName('ls -la'), null);
  assert.equal(summarizeTaskToShortName('Do you want to proceed? [y/n]'), null);
  assert.equal(summarizeTaskToShortName('Requesting permission for: run_command'), null);
}

// 4. Sticky cache: keeps auto-name when prompt scrolls off-screen, updates on new task
{
  const tty = 'term-test-1';
  clearAutoTerminalName(tty);

  // Idle at t=100
  assert.equal(getAutoTerminalName(tty, ['❯ '], 'antigravity', 100), undefined);

  // User assigns task at t=200
  const name1 = getAutoTerminalName(
    tty,
    ['❯ add auto terminal naming feature', 'Thinking...'],
    'antigravity',
    200
  );
  assert.equal(name1, 'Add Auto Terminal Naming');

  // Long tool output scrolls prompt off-screen at t=300 -> stays sticky!
  const name2 = getAutoTerminalName(
    tty,
    ['Added 42 lines', 'Command exited with code 0', '✓ Done'],
    'antigravity',
    300
  );
  assert.equal(name2, 'Add Auto Terminal Naming');

  // User assigns a NEW task at t=400 -> updates!
  const name3 = getAutoTerminalName(
    tty,
    ['❯ fix CSS grid alignment issue', 'Editing GridView.tsx'],
    'antigravity',
    400
  );
  assert.equal(name3, 'Fix CSS Grid Alignment Issue');

  // Clear on dispose
  clearAutoTerminalName(tty);
  assert.equal(getAutoTerminalName(tty, ['❯ '], 'antigravity', 500), undefined);
}

console.log('✓ autoTerminalName tests passed');
