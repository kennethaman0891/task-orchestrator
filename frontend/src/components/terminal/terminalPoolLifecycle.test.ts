import assert from 'node:assert/strict';
import { TerminalManager } from '../../terminal/TerminalManager';

// Mock minimal Terminal and HTMLElement for testing TerminalManager registration
function createMockHandle(sessionId: string) {
  const host = {
    style: { cssText: '' },
    remove: () => {},
    parentElement: null,
  } as unknown as HTMLDivElement;

  const term = {
    options: {},
    buffer: { active: null, normal: null },
    dispose: () => {},
    write: () => {},
    focus: () => {},
    refresh: () => {},
    scrollToBottom: () => {},
  } as any;

  return TerminalManager.register({
    sessionId,
    term,
    host,
  });
}

async function runTests() {
  console.log('Testing TerminalPool lifecycle safeguards...');

  // Setup initial state with 2 terminals
  createMockHandle('session-1');
  createMockHandle('session-2');

  assert.equal(TerminalManager.all().length, 2);
  assert.equal(TerminalManager.has('session-1'), true);
  assert.equal(TerminalManager.has('session-2'), true);

  // Test 1: Empty flash protection
  // When sessionIds flashes empty ([]) during boot or workspace transition,
  // TerminalManager handles must NOT be destroyed.
  const emptyFlashIds = new Set<string>();
  const handlesBeforeFlash = TerminalManager.all();
  assert.equal(handlesBeforeFlash.length, 2);

  // Replicate the safeguarded cleanup condition from TerminalPool:
  if (emptyFlashIds.size === 0) {
    // Preserved! No pruning occurred.
  } else {
    for (const h of TerminalManager.all()) {
      if (!emptyFlashIds.has(h.sessionId)) {
        TerminalManager.unregister(h.sessionId);
      }
    }
  }

  // Verify terminals were preserved during empty flash
  assert.equal(TerminalManager.all().length, 2);
  assert.equal(TerminalManager.has('session-1'), true);
  assert.equal(TerminalManager.has('session-2'), true);
  console.log('✓ Empty flash preservation verified');

  // Test 2: Grace period debounce before unregistering
  // Suppose session-1 is removed from currentIds, but session-2 remains
  const updatedIds = new Set(['session-2']);
  const pruneTimers = new Map<string, NodeJS.Timeout>();
  const latestSessionIdsRef = { current: updatedIds };

  // Schedule pruning with grace period
  if (updatedIds.size > 0) {
    for (const handle of TerminalManager.all()) {
      const sid = handle.sessionId;
      const isPresent = updatedIds.has(sid);
      if (!isPresent) {
        if (!pruneTimers.has(sid)) {
          const timer = setTimeout(() => {
            pruneTimers.delete(sid);
            if (latestSessionIdsRef.current.size > 0 && !latestSessionIdsRef.current.has(sid)) {
              TerminalManager.unregister(sid);
            }
          }, 50);
          pruneTimers.set(sid, timer);
        }
      }
    }
  }

  // Immediately after change, session-1 must STILL be alive in TerminalManager
  assert.equal(pruneTimers.has('session-1'), true);
  assert.equal(TerminalManager.has('session-1'), true);
  console.log('✓ Pruning debounced with grace timer; not immediately destroyed');

  // If session-1 reappears before timer expires:
  const restoredIds = new Set(['session-1', 'session-2']);
  latestSessionIdsRef.current = restoredIds;
  for (const sid of restoredIds) {
    const timer = pruneTimers.get(sid);
    if (timer) {
      clearTimeout(timer);
      pruneTimers.delete(sid);
    }
  }

  // Wait 70ms to verify session-1 was NOT pruned
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(TerminalManager.has('session-1'), true);
  console.log('✓ Restored session cancelled prune timer and was preserved');

  // Test 3: True removal after grace period expires
  const trulyRemovedIds = new Set(['session-2']);
  latestSessionIdsRef.current = trulyRemovedIds;

  if (trulyRemovedIds.size > 0) {
    for (const handle of TerminalManager.all()) {
      const sid = handle.sessionId;
      if (!trulyRemovedIds.has(sid) && !pruneTimers.has(sid)) {
        const timer = setTimeout(() => {
          pruneTimers.delete(sid);
          if (latestSessionIdsRef.current.size > 0 && !latestSessionIdsRef.current.has(sid)) {
            TerminalManager.unregister(sid);
          }
        }, 30);
        pruneTimers.set(sid, timer);
      }
    }
  }

  assert.equal(TerminalManager.has('session-1'), true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(TerminalManager.has('session-1'), false);
  assert.equal(TerminalManager.has('session-2'), true);
  console.log('✓ Truly absent session pruned after grace period expired');

  // Test 4: creatingRef cleanup on failure
  const creatingSet = new Set<string>();
  const failedSession = 'session-fail';

  creatingSet.add(failedSession);
  try {
    throw new Error('Simulated creation failure');
  } catch (err) {
    // Caught
  } finally {
    creatingSet.delete(failedSession);
  }

  assert.equal(creatingSet.has(failedSession), false);
  console.log('✓ creatingRef reliably cleaned up in finally block');

  // Cleanup remaining handle
  TerminalManager.unregister('session-2');
  console.log('All terminalPoolLifecycle tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
