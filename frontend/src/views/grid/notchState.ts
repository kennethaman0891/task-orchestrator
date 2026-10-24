export type NotchMode = 'island' | 'rail' | 'orb';
export type NotchDock =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'tl'
  | 'tr'
  | 'bl'
  | 'br'
  | 'float';

export interface NotchState {
  mode: NotchMode;
  dock: NotchDock;
  x: number;
  y: number;
  lastExpanded: 'island' | 'rail';
}

export const NOTCH_STORAGE_KEY = 'tto-grid-notch';
export const NOTCH_EDGE_PX = 28;
export const NOTCH_MARGIN = 8;
export const ISLAND_H = 36;
export const RAIL_W = 36;
export const ORB_SIZE = 40;

const OLD_COLLAPSED_KEY = 'tto-grid-notch-collapsed';
const OLD_POS_KEY = 'tto-grid-notch-pos';

export interface SnapNotchInput {
  x: number;
  y: number;
  vw: number;
  vh: number;
  notchW: number;
  notchH: number;
  edgePx?: number;
  currentMode?: NotchMode;
  currentDock?: NotchDock;
}

function clamp(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, n));
}

function getWindow(): (Window & { localStorage: Storage }) | null {
  try {
    if (typeof window !== 'undefined' && window) return window;
    const w = (globalThis as { window?: Window }).window;
    return w ?? null;
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  try {
    const ls = getWindow()?.localStorage ?? (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function defaultState(): NotchState {
  const w = getWindow();
  const vw = w && typeof w.innerWidth === 'number' ? w.innerWidth : 1440;
  return {
    mode: 'island',
    dock: 'top',
    x: Math.max(NOTCH_MARGIN, Math.floor((vw - 440) / 2)),
    y: 12,
    lastExpanded: 'island',
  };
}

function isNotchMode(v: unknown): v is NotchMode {
  return v === 'island' || v === 'rail' || v === 'orb';
}

function isDock(v: unknown): v is NotchDock {
  return (
    v === 'top' ||
    v === 'bottom' ||
    v === 'left' ||
    v === 'right' ||
    v === 'tl' ||
    v === 'tr' ||
    v === 'bl' ||
    v === 'br' ||
    v === 'float'
  );
}

function isLastExpanded(v: unknown): v is 'island' | 'rail' {
  return v === 'island' || v === 'rail';
}

function parseStored(raw: string | null): NotchState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NotchState>;
    if (!isNotchMode(parsed.mode)) return null;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    const fallback = defaultState();
    return {
      mode: parsed.mode,
      dock: isDock(parsed.dock) ? parsed.dock : fallback.dock,
      x: parsed.x,
      y: parsed.y,
      lastExpanded: isLastExpanded(parsed.lastExpanded) ? parsed.lastExpanded : 'island',
    };
  } catch {
    return null;
  }
}

function cleanupOld(storage: Storage): void {
  try {
    storage.removeItem(OLD_COLLAPSED_KEY);
    storage.removeItem(OLD_POS_KEY);
  } catch {
    /* ignore quota / private-mode */
  }
}

/** Snap the notch to an edge, corner, or keep the current interior mode. */
export function snapNotch({
  x,
  y,
  vw,
  vh,
  notchW,
  notchH,
  edgePx = NOTCH_EDGE_PX,
  currentMode = 'island',
  currentDock = 'float',
}: SnapNotchInput): { mode: NotchMode; dock: NotchDock; x: number; y: number } {
  const w = Math.max(1, notchW);
  const h = Math.max(1, notchH);
  const nearLeft = x <= edgePx;
  const nearRight = x + w >= vw - edgePx;
  const nearTop = y <= edgePx;
  const nearBottom = y + h >= vh - edgePx;
  const nearH = nearLeft || nearRight;
  const nearV = nearTop || nearBottom;

  if (nearH && nearV) {
    const dock: NotchDock = nearTop
      ? nearLeft
        ? 'tl'
        : 'tr'
      : nearLeft
        ? 'bl'
        : 'br';
    const orbX = nearLeft ? NOTCH_MARGIN : vw - ORB_SIZE - NOTCH_MARGIN;
    const orbY = nearTop ? NOTCH_MARGIN : vh - ORB_SIZE - NOTCH_MARGIN;
    return {
      mode: 'orb',
      dock,
      x: clamp(orbX, NOTCH_MARGIN, vw - ORB_SIZE - NOTCH_MARGIN),
      y: clamp(orbY, NOTCH_MARGIN, vh - ORB_SIZE - NOTCH_MARGIN),
    };
  }

  if (nearH) {
    const dock: NotchDock = nearLeft ? 'left' : 'right';
    const railX = nearLeft ? NOTCH_MARGIN : vw - RAIL_W - NOTCH_MARGIN;
    return {
      mode: 'rail',
      dock,
      x: clamp(railX, NOTCH_MARGIN, vw - RAIL_W - NOTCH_MARGIN),
      y: clamp(y, NOTCH_MARGIN, vh - h - NOTCH_MARGIN),
    };
  }

  if (nearV) {
    const dock: NotchDock = nearTop ? 'top' : 'bottom';
    const islandY = nearTop ? NOTCH_MARGIN : vh - ISLAND_H - NOTCH_MARGIN;
    return {
      mode: 'island',
      dock,
      x: clamp(x, NOTCH_MARGIN, vw - w - NOTCH_MARGIN),
      y: clamp(islandY, NOTCH_MARGIN, vh - ISLAND_H - NOTCH_MARGIN),
    };
  }

  return {
    mode: currentMode,
    dock: currentDock,
    x: clamp(x, NOTCH_MARGIN, vw - w - NOTCH_MARGIN),
    y: clamp(y, NOTCH_MARGIN, vh - h - NOTCH_MARGIN),
  };
}

export function saveNotchState(state: NotchState): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(NOTCH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private-mode */
  }
}

export function migrateNotchState(): NotchState {
  const storage = getStorage();
  if (!storage) return defaultState();

  const existing = parseStored(storage.getItem(NOTCH_STORAGE_KEY));
  if (existing) {
    cleanupOld(storage);
    return existing;
  }

  let collapsed = false;
  try {
    collapsed = storage.getItem(OLD_COLLAPSED_KEY) === 'true';
  } catch {
    collapsed = false;
  }

  let x: number | undefined;
  let y: number | undefined;
  try {
    const raw = storage.getItem(OLD_POS_KEY);
    if (raw) {
      const pos = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof pos.x === 'number' && typeof pos.y === 'number' && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        x = pos.x;
        y = pos.y;
      }
    }
  } catch {
    /* ignore bad pos JSON */
  }

  const fallback = defaultState();
  const state: NotchState = {
    mode: collapsed ? 'orb' : 'island',
    dock: collapsed ? 'float' : 'top',
    x: x ?? fallback.x,
    y: y ?? fallback.y,
    lastExpanded: 'island',
  };

  saveNotchState(state);
  cleanupOld(storage);
  return state;
}

export function loadNotchState(): NotchState {
  return migrateNotchState();
}
