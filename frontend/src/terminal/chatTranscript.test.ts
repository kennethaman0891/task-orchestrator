import assert from 'node:assert/strict';
import { AntigravityAdapter } from '../jarvis/adapters/AntigravityAdapter';
import {
  appendUserMessage,
  getTranscript,
  markPromptSelected,
  menuKeystrokes,
  promptNeedsEnter,
  resetTranscripts,
  snapshotTranscript,
  stripTerminalChrome,
} from './chatTranscript';

const splash = [
  'Antigravity CLI 1.4.6',
  'vkjames1963@gmail.com (Google AI Pro)',
  'Gemini 3.8 Flash (High)',
  '~/VoiceFlow',
  '>',
  '? for shortcuts',
];

const permission = [
  'Requesting permission for: run_command',
  'git status',
  'Run this command?',
  '1. Yes',
  '2. No',
];

resetTranscripts();

assert.deepEqual(stripTerminalChrome(splash, 'antigravity'), []);
assert.deepEqual(snapshotTranscript('splash', splash, 'antigravity'), []);

appendUserMessage('keep', 'fix the layout');
const afterSplash = snapshotTranscript('keep', splash, 'antigravity');
assert.equal(afterSplash.length, 1);
assert.equal(afterSplash[0].role, 'user');
assert.equal(afterSplash[0].textParts[0], 'fix the layout');
assert.equal(afterSplash.some((message) => /Antigravity CLI/.test(message.textParts.join(' '))), false);

const pending = snapshotTranscript('perm', permission, 'antigravity');
assert.equal(pending.length, 1);
assert.equal(pending[0].interactivePrompt?.resolved, false);
assert.equal(pending[0].interactivePrompt?.type, 'permission');
assert.equal(pending[0].interactivePrompt?.command, 'run_command');

const stillPending = snapshotTranscript('perm', splash, 'antigravity');
assert.equal(stillPending[0].interactivePrompt?.resolved, false);

const approved = snapshotTranscript('perm', splash, 'antigravity');
assert.equal(approved[0].interactivePrompt?.resolved, true);
assert.equal(approved[0].interactivePrompt?.selectedKey, 'approved');
assert.equal(approved.some((message) => message.interactivePrompt && !message.interactivePrompt.resolved), false);

snapshotTranscript('old', permission, 'antigravity');
snapshotTranscript('old', ['All done.'], 'antigravity');
const cleared = snapshotTranscript('old', ['All done.'], 'antigravity');
assert.equal(cleared.filter((message) => message.interactivePrompt && !message.interactivePrompt.resolved).length, 0);
assert.equal(cleared.some((message) => message.textParts[0] === 'All done.'), true);
assert.equal(cleared.some((message) => /1\. Allow/.test(message.textParts.join('\n'))), false);

appendUserMessage('tab-a', 'one');
appendUserMessage('tab-b', 'two');
assert.equal(getTranscript('tab-a')[0].textParts[0], 'one');
assert.equal(getTranscript('tab-b')[0].textParts[0], 'two');
assert.equal(getTranscript('tab-a').length, 1);

assert.deepEqual(menuKeystrokes('y', { enter: true }), ['y']);
assert.deepEqual(menuKeystrokes('N', { enter: true }), ['n']);
assert.deepEqual(menuKeystrokes('1', { enter: false }), ['1']);
assert.deepEqual(menuKeystrokes('1\r', { enter: true }), ['1', '\r']);
assert.deepEqual(menuKeystrokes('escape', { enter: true }), ['\x1b']);
assert.equal(promptNeedsEnter(['1. Yes', 'Enter to confirm'], 'antigravity'), true);
assert.equal(promptNeedsEnter(['1. Yes', '2. No'], 'antigravity'), false);
assert.equal(promptNeedsEnter(['1. Yes'], 'claude'), true);

snapshotTranscript('hold', permission, 'antigravity');
const heldId = getTranscript('hold')[0].interactivePrompt?.id || '';
const held = markPromptSelected('hold', heldId, '1');
assert.equal(held[0].interactivePrompt?.resolved, true);
assert.equal(held[0].interactivePrompt?.selectedKey, '1');
const stillHeld = snapshotTranscript('hold', permission, 'antigravity');
assert.equal(stillHeld[0].interactivePrompt?.resolved, true);
assert.equal(stillHeld[0].interactivePrompt?.selectedKey, '1');

const adapter = new AntigravityAdapter();
assert.equal(adapter.parse(splash).state, 'waiting_for_input');
assert.equal(adapter.parse(['Running the tests', '>']).state, 'running');
assert.equal(adapter.parse(['Requesting permission for: run_command', 'Run this command?']).state, 'waiting_for_input');

const grown = snapshotTranscript('stream', ['Checking the grid.'], 'antigravity');
const grownMore = snapshotTranscript('stream', ['Checking the grid.', 'The panes overlap.'], 'antigravity');
assert.equal(grownMore.length, 1);
assert.equal(grownMore[0].id, grown[0].id);
assert.match(grownMore[0].textParts[0], /panes overlap/);

console.log('chatTranscript tests passed');
