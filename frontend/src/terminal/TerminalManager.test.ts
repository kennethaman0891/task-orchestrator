import assert from 'node:assert/strict';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

import { TerminalManager } from './TerminalManager';

async function runTests() {
  console.log('Testing TerminalManager write queue & resilience...');

  // Setup mock handle
  const sessionId = 'test-session-resilience';
  const deliveredChunks: Uint8Array[] = [];
  const normalBuffer = { type: 'normal' };
  const mockTerm = {
    cols: 80,
    rows: 24,
    buffer: {
      active: normalBuffer,
      normal: normalBuffer,
    },
    write: (data: Uint8Array, cb?: () => void) => {
      deliveredChunks.push(data);
      if (cb) cb();
    },
    dispose: () => {},
  } as any;

  const mockHost = {
    isConnected: true,
    remove: () => {},
  } as any;

  TerminalManager.register({
    sessionId,
    term: mockTerm,
    host: mockHost,
  });

  const h = TerminalManager.get(sessionId);
  assert.ok(h, 'Handle should be registered');
  assert.equal(h.attached, false, 'Should start detached');

  // Test 1: Normal write flow
  const writeCalls: { id: string; data: number[] }[] = [];
  TerminalManager._setIpcForTesting(async (cmd, args) => {
    if (cmd === 'terminal_write') {
      writeCalls.push(args as any);
      return;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });

  await TerminalManager.write(sessionId, 'hello');
  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0].id, sessionId);
  assert.deepEqual(writeCalls[0].data, Array.from(new TextEncoder().encode('hello')));
  console.log('✓ Normal write completed successfully');

  // Test 2: Write timeout and queue unblocking
  TerminalManager._writeTimeoutMs = 100; // Use 100ms for fast test execution
  let warnCalled = false;
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (args[0]?.includes('[TerminalManager] write timed out for')) {
      warnCalled = true;
    }
    originalWarn(...args);
  };

  // Mock invoke that hangs for 'hang' and succeeds for 'followup'
  TerminalManager._setIpcForTesting(async (cmd, args: any) => {
    if (cmd === 'terminal_write') {
      const text = new TextDecoder().decode(new Uint8Array(args.data));
      if (text === 'hang') {
        // Return a promise that never resolves (simulating backpressured PTY)
        return new Promise(() => {});
      }
      writeCalls.push(args);
      return;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });

  const t0 = Date.now();
  // Queue the hanging write followed immediately by a followup write
  const p1 = TerminalManager.write(sessionId, 'hang');
  const p2 = TerminalManager.write(sessionId, 'followup');

  // Both promises should resolve! p1 settles on timeout, p2 executes and completes
  await Promise.all([p1, p2]);
  const elapsed = Date.now() - t0;

  console.warn = originalWarn;

  assert.ok(warnCalled, 'Warning should have been logged for write timeout');
  assert.ok(elapsed >= 90 && elapsed < 1000, `Elapsed time should be around 100ms (was ${elapsed}ms)`);
  assert.equal(writeCalls[writeCalls.length - 1].data[0], new TextEncoder().encode('f')[0]);
  console.log('✓ Write timeout guard resolved hung write and unblocked queued followup write');

  // Reset timeout back to default 2000ms
  TerminalManager._writeTimeoutMs = 2000;

  // Test 3: attachToPty with scrollback replay
  const scrollbackData = Array.from(new TextEncoder().encode('scrollback buffer content\n'));
  let attachedWithChannels: any = null;
  class MockChannel {
    onmessage: ((data: any) => void) | null = null;
  }

  TerminalManager._setIpcForTesting(async (cmd, args: any) => {
    if (cmd === 'terminal_get_scrollback') {
      return scrollbackData;
    }
    if (cmd === 'terminal_attach') {
      attachedWithChannels = args;
      return;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  }, MockChannel);

  await TerminalManager.attachToPty(sessionId);
  assert.equal(h.attached, true, 'h.attached should be true after successful attachToPty');
  assert.ok(attachedWithChannels, 'terminal_attach should be called');

  // Wait briefly for queue delivery of scrollback
  await new Promise((r) => setTimeout(r, 60));
  const deliveredText = deliveredChunks.map((c) => new TextDecoder().decode(c)).join('');
  assert.ok(deliveredText.includes('scrollback buffer content'), 'Scrollback should have been replayed into queue');
  console.log('✓ attachToPty replayed scrollback into queue');

  // Test 4: Exit channel handling
  assert.ok(attachedWithChannels.onExit, 'Exit channel should have been provided');
  let exitFired = false;
  h.onExit = () => { exitFired = true; };
  attachedWithChannels.onExit.onmessage();
  assert.equal(h.attached, false, 'h.attached should be false after exit');
  assert.equal(exitFired, true, 'onExit callback should have fired');
  console.log('✓ Exit channel resets h.attached and fires onExit');

  // Test 5: attachToPty failure handling
  TerminalManager._setIpcForTesting(async (cmd) => {
    if (cmd === 'terminal_get_scrollback') return [];
    if (cmd === 'terminal_attach') throw new Error('Attach simulated failure');
    throw new Error(`Unexpected command: ${cmd}`);
  }, MockChannel);

  await TerminalManager.attachToPty(sessionId);
  assert.equal(h.attached, false, 'h.attached must remain false if terminal_attach fails');
  console.log('✓ attachToPty sets h.attached to false on failure');

  // Test 6: Concurrent attachToPty calls share the in-flight promise
  let attachCallCount = 0;
  TerminalManager._setIpcForTesting(async (cmd) => {
    if (cmd === 'terminal_get_scrollback') return [];
    if (cmd === 'terminal_attach') {
      attachCallCount++;
      await new Promise((r) => setTimeout(r, 50));
      return;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  }, MockChannel);

  await Promise.all([
    TerminalManager.attachToPty(sessionId),
    TerminalManager.attachToPty(sessionId),
  ]);
  assert.equal(attachCallCount, 1, 'Concurrent attachToPty should join the same in-flight attach promise');
  assert.equal(h.attached, true, 'h.attached should be true after completion');
  console.log('✓ Concurrent attachToPty calls coalesce into single attach call');

  // Cleanup
  TerminalManager.unregister(sessionId);
  assert.equal(TerminalManager.get(sessionId), undefined, 'Session should be unregistered');
  console.log('✓ All TerminalManager write queue & resilience tests passed!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
