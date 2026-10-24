import assert from 'node:assert/strict';
import { decideCallDelivery } from './callDelivery';

const task = decideCallDelivery({
  utterance: 'add a logout button',
  intent: 'advice',
  shouldExecute: false,
  actionCommand: '',
  spoken: 'Antigravity is idle.',
  modelOk: true,
});
assert.equal(task.deliver, true);
assert.equal(task.command, 'add a logout button');

const refined = decideCallDelivery({
  utterance: 'fix the login bug',
  intent: 'orchestrate_cli',
  shouldExecute: true,
  actionCommand: 'Fix the type error in Login.tsx',
  spoken: 'I am sending one instruction.',
  modelOk: true,
});
assert.equal(refined.deliver, true);
assert.equal(refined.command, 'Fix the type error in Login.tsx');

const please = decideCallDelivery({
  utterance: 'please update the readme',
  intent: 'advice',
  shouldExecute: false,
  actionCommand: '',
  spoken: '',
  modelOk: false,
});
assert.equal(please.deliver, true);
assert.equal(please.command, 'please update the readme');

const question = decideCallDelivery({
  utterance: 'what is on the screen?',
  intent: 'orchestrate_cli',
  shouldExecute: true,
  actionCommand: 'what is on the screen?',
  spoken: 'The screen shows a type error.',
  modelOk: true,
});
assert.equal(question.deliver, false);
assert.equal(question.command, '');

const how = decideCallDelivery({
  utterance: 'how do I fix the login',
  intent: 'orchestrate_cli',
  shouldExecute: true,
  actionCommand: 'fix the login',
  spoken: 'Here is why it failed.',
  modelOk: true,
});
assert.equal(how.deliver, false);

const hello = decideCallDelivery({
  utterance: 'hello',
  intent: 'advice',
  shouldExecute: false,
  actionCommand: '',
  spoken: 'I am here.',
  modelOk: true,
});
assert.equal(hello.deliver, false);

console.log('callDelivery checks passed');
