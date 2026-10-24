import assert from 'node:assert/strict';
import {
  snapNotch,
  migrateNotchState,
  loadNotchState,
  saveNotchState,
  NOTCH_STORAGE_KEY,
} from './notchState';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as { window?: unknown; localStorage?: unknown }).localStorage = storage;
(globalThis as { window?: unknown }).window = Object.assign(globalThis, {
  localStorage: storage,
  innerWidth: 1440,
  innerHeight: 900,
});

const VW = 1440;
const VH = 900;
const ISLAND_W = 420;
const ISLAND_H = 36;

const left = snapNotch({
  x: 8,
  y: 400,
  vw: VW,
  vh: VH,
  notchW: ISLAND_W,
  notchH: ISLAND_H,
});
assert.equal(left.mode, 'rail', `left-edge snap was ${left.mode}`);
assert.equal(left.dock, 'left');

const top = snapNotch({
  x: 500,
  y: 10,
  vw: VW,
  vh: VH,
  notchW: ISLAND_W,
  notchH: ISLAND_H,
});
assert.equal(top.mode, 'island', `top-edge snap was ${top.mode}`);
assert.equal(top.dock, 'top');

const corner = snapNotch({
  x: 8,
  y: 8,
  vw: VW,
  vh: VH,
  notchW: ISLAND_W,
  notchH: ISLAND_H,
});
assert.equal(corner.mode, 'orb', `top-left corner snap was ${corner.mode}`);
assert.equal(corner.dock, 'tl');

const right = snapNotch({
  x: VW - ISLAND_W - 4,
  y: 400,
  vw: VW,
  vh: VH,
  notchW: ISLAND_W,
  notchH: ISLAND_H,
});
assert.equal(right.mode, 'rail');
assert.equal(right.dock, 'right');

const bottom = snapNotch({
  x: 500,
  y: VH - ISLAND_H - 4,
  vw: VW,
  vh: VH,
  notchW: ISLAND_W,
  notchH: ISLAND_H,
});
assert.equal(bottom.mode, 'island');
assert.equal(bottom.dock, 'bottom');

const interior = snapNotch({
  x: 400,
  y: 300,
  vw: VW,
  vh: VH,
  notchW: ISLAND_W,
  notchH: ISLAND_H,
  currentMode: 'rail',
  currentDock: 'left',
});
assert.equal(interior.mode, 'rail', 'interior should keep current mode');
assert.equal(interior.dock, 'left');

storage.clear();
storage.setItem('tto-grid-notch-collapsed', 'true');
storage.setItem('tto-grid-notch-pos', JSON.stringify({ x: 120, y: 80 }));
const migrated = migrateNotchState();
assert.equal(migrated.mode, 'orb', `collapsed migrate was ${migrated.mode}`);
assert.equal(migrated.x, 120);
assert.equal(migrated.y, 80);
assert.equal(storage.getItem('tto-grid-notch-collapsed'), null, 'old collapsed key should be removed');
assert.equal(storage.getItem('tto-grid-notch-pos'), null, 'old pos key should be removed');
const persisted = storage.getItem(NOTCH_STORAGE_KEY);
assert.ok(persisted, 'migrated state should be written to tto-grid-notch');
assert.equal(JSON.parse(persisted!).mode, 'orb');

storage.clear();
storage.setItem('tto-grid-notch-collapsed', 'true');
const collapsedOnly = migrateNotchState();
assert.equal(collapsedOnly.mode, 'orb');

storage.clear();
saveNotchState({
  mode: 'rail',
  dock: 'right',
  x: 10,
  y: 20,
  lastExpanded: 'rail',
});
const loaded = loadNotchState();
assert.equal(loaded.mode, 'rail');
assert.equal(loaded.dock, 'right');
assert.equal(loaded.lastExpanded, 'rail');

console.log('grid notch layout checks passed');
