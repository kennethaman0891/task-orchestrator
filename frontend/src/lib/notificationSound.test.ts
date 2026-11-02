import assert from 'node:assert/strict';
import {
  isNotificationSoundEnabled,
  setNotificationSoundEnabled,
  playNotificationSound,
} from './notificationSound';

// Test 1: SSR / Node fallback without window
// When window is undefined (or in Node default state), functions must not crash.
assert.doesNotThrow(() => {
  playNotificationSound();
  playNotificationSound('asking');
  playNotificationSound('stopped');
  playNotificationSound('info');
});

// Test 2: LocalStorage toggling
// Set up a mock window and localStorage for unit testing
const storageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => storageMap.set(key, val),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
};

// Mock AudioContext and nodes
const playedNotes: Array<{ freq: number; startTime: number; type: string }> = [];

class MockGainNode {
  gain = {
    setValueAtTime: (_val: number, _time: number) => {},
    exponentialRampToValueAtTime: (_val: number, _time: number) => {},
  };
  connect(_target: any) {}
  disconnect() {}
}

class MockOscillatorNode {
  type: OscillatorType = 'sine';
  frequency = {
    setValueAtTime: (freq: number, startTime: number) => {
      playedNotes.push({ freq, startTime, type: this.type });
    },
  };
  connect(_target: any) {}
  disconnect() {}
  start(_time?: number) {}
  stop(_time?: number) {}
  onended: (() => void) | null = null;
}

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 1.0;
  destination = {};

  createOscillator() {
    return new MockOscillatorNode() as unknown as OscillatorNode;
  }
  createGain() {
    return new MockGainNode() as unknown as GainNode;
  }
  resume = async () => {
    this.state = 'running';
  };
}

(globalThis as any).window = {
  AudioContext: MockAudioContext,
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: mockLocalStorage,
};
(globalThis as any).localStorage = mockLocalStorage;

// Test default state: enabled
assert.equal(isNotificationSoundEnabled(), true, 'Notification sounds should default to enabled');

// Toggle to false
setNotificationSoundEnabled(false);
assert.equal(isNotificationSoundEnabled(), false, 'Notification sounds should be disabled');
assert.equal(storageMap.get('tto_notification_sound'), 'false');

// When disabled, playNotificationSound should not play any notes
playedNotes.length = 0;
playNotificationSound('asking');
assert.equal(playedNotes.length, 0, 'No sound should play when disabled');

// Re-enable
setNotificationSoundEnabled(true);
assert.equal(isNotificationSoundEnabled(), true, 'Notification sounds should be enabled');
assert.equal(storageMap.get('tto_notification_sound'), 'true');

// Test 'asking' chime: E5 (659.25Hz) -> B5 (987.77Hz)
playedNotes.length = 0;
playNotificationSound('asking');
assert.equal(playedNotes.length, 2, 'Asking sound should play 2 ascending notes');
assert.equal(playedNotes[0].freq, 659.25, 'First note should be E5');
assert.equal(playedNotes[1].freq, 987.77, 'Second note should be B5');

// Test 'stopped' chime: A4 (440Hz) -> F#4 (369.99Hz)
playedNotes.length = 0;
playNotificationSound('stopped');
assert.equal(playedNotes.length, 2, 'Stopped sound should play 2 bell notes');
assert.equal(playedNotes[0].freq, 440.0, 'First note should be A4');
assert.equal(playedNotes[1].freq, 369.99, 'Second note should be F#4');

// Test 'info' ping: G5 (784Hz)
playedNotes.length = 0;
playNotificationSound('info');
assert.equal(playedNotes.length, 1, 'Info sound should play 1 note');
assert.equal(playedNotes[0].freq, 784.0, 'Info note should be G5');

// Test default argument: should play 'asking'
playedNotes.length = 0;
playNotificationSound();
assert.equal(playedNotes.length, 2, 'Default playNotificationSound() should play asking chime');
assert.equal(playedNotes[0].freq, 659.25);

console.log('All notification sound tests passed successfully.');
