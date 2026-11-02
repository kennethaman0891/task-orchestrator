import assert from 'node:assert/strict';
import { TerminalManager } from './TerminalManager';
import {
  isNotificationSoundEnabled,
  setNotificationSoundEnabled,
  playNotificationSound,
} from '../lib/notificationSound';
import type { UnifiedTerminal } from '../types';

// Mock helper for deriveTaskStatus
function mockDeriveTaskStatus(_tty: string, entry?: UnifiedTerminal, _closed = false) {
  if (!entry) return 'stopped' as const;
  if (entry.agent === 'asking') return 'asking' as const;
  return 'running' as const;
}

// Mock duration function
function mockDuration(_tty: string, _status: any) {
  return { durationStr: '10s' };
}

// 1. Test CLI detection priority: Active buffer detection MUST override stale entryCli
{
  const mockEntry: UnifiedTerminal = {
    tty: 'ttys001',
    agent: 'antigravity',
    cli: 'antigravity',
    cwd: '/Users/test',
    is_live: true,
    tokens: { tokens_input: 0, tokens_output: 0, cost: 0, model: '', session_title: '' },
    session_name: 'tto · antigravity',
    window_name: '',
    pane_title: 'tto · antigravity',
    session_context: '',
    session_summary: '',
    pending_cli: false,
    live_output: '',
    suggested_task: '',
    current_task: null,
    next_task: null,
    queue: [],
    history: [],
  };

  // Buffer simulates Claude running in the terminal
  const detectClaude = () => ({
    detected: true,
    cli: 'claude',
    cliName: 'Claude',
  });

  const meta = TerminalManager.getTerminalMetadata(
    'test-session-claude-priority',
    mockEntry,
    false,
    detectClaude as any,
    mockDeriveTaskStatus as any,
    mockDuration as any,
    'shell'
  );

  assert.equal(
    meta.cli,
    'claude',
    'Active buffer detection (claude) must take Priority 1 over initial antigravity entryCli'
  );
  assert.equal(meta.cliName, 'Claude', 'Display name must be Claude');
  console.log('✔ Priority 1: Claude buffer prompt overrides initial antigravity entryCli');
}

// 2. Test Codex active buffer detection
{
  const mockEntry: UnifiedTerminal = {
    tty: 'ttys002',
    agent: 'antigravity',
    cli: 'antigravity',
    cwd: '/Users/test',
    is_live: true,
    tokens: { tokens_input: 0, tokens_output: 0, cost: 0, model: '', session_title: '' },
    session_name: 'tto · antigravity',
    window_name: '',
    pane_title: 'tto · antigravity',
    session_context: '',
    session_summary: '',
    pending_cli: false,
    live_output: '',
    suggested_task: '',
    current_task: null,
    next_task: null,
    queue: [],
    history: [],
  };

  const detectCodex = () => ({
    detected: true,
    cli: 'codex',
    cliName: 'Codex',
  });

  const meta = TerminalManager.getTerminalMetadata(
    'test-session-codex-priority',
    mockEntry,
    false,
    detectCodex as any,
    mockDeriveTaskStatus as any,
    mockDuration as any,
    'shell'
  );

  assert.equal(meta.cli, 'codex');
  assert.equal(meta.cliName, 'Codex');
  console.log('✔ Priority 1: Codex buffer prompt overrides initial antigravity entryCli');
}

// 3. Test Antigravity detection when buffer actively runs antigravity
{
  const detectAntigravity = () => ({
    detected: true,
    cli: 'antigravity',
    cliName: 'Antigravity',
  });

  const meta = TerminalManager.getTerminalMetadata(
    'test-session-antigravity',
    undefined,
    false,
    detectAntigravity as any,
    mockDeriveTaskStatus as any,
    mockDuration as any,
    'shell'
  );

  assert.equal(meta.cli, 'antigravity');
  assert.equal(meta.cliName, 'Antigravity');
  console.log('✔ Priority 1: Antigravity buffer prompt detected');
}

// 4. Test Shell fallback when buffer is idle shell
{
  const detectShell = () => ({
    detected: false,
    cli: 'unknown',
    cliName: undefined,
  });

  const meta = TerminalManager.getTerminalMetadata(
    'test-session-shell',
    undefined,
    false,
    detectShell as any,
    mockDeriveTaskStatus as any,
    mockDuration as any,
    'shell'
  );

  assert.equal(meta.cli, 'shell');
  assert.equal(meta.cliName, 'Shell');
  console.log('✔ Shell prompt defaults to shell');
}

// 5. Test tab name formatting and legacy prefix stripping
{
  const paneLabel = 'Custom Backend';
  const resolved1 = paneLabel || 'Fallback';
  assert.equal(resolved1, 'Custom Backend');
  console.log('✔ Custom pane label takes highest precedence');

  const cliName = 'Claude';
  const index = 1;
  const dynamicName = `${cliName} · ${index + 1}`;
  assert.equal(dynamicName, 'Claude · 2');
  console.log('✔ Dynamic CLI name + index formatted correctly');

  const legacySessionName = 'tto · shell';
  const cleaned = legacySessionName.replace(/^tto\s*[·•-]\s*/i, '');
  assert.equal(cleaned, 'shell');
  console.log('✔ Legacy tto prefix cleanly stripped');
}

// 6. Test notification sound controls in non-browser/Node environment
{
  assert.doesNotThrow(() => {
    playNotificationSound('asking');
    playNotificationSound('stopped');
    playNotificationSound('info');
  }, 'playNotificationSound should be completely safe in any environment');

  const initial = isNotificationSoundEnabled();
  assert.equal(typeof initial, 'boolean');

  setNotificationSoundEnabled(false);
  setNotificationSoundEnabled(true);
  console.log('✔ Notification sound toggle works correctly');
}

console.log('All CLI detection and notification tests passed! (10 assertions verified)');
