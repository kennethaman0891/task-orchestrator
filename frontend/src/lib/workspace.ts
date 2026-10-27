// ═══════════════════════════════════════════════════════════════════════════
// tto Workspace State — ported from legacy, same localStorage persistence
// ═══════════════════════════════════════════════════════════════════════════

export type TemplateKey = 1 | 2 | 3 | 4 | 6 | 8 | 9 | 10 | 12 | 14 | 16;

export interface Pane {
  id: string;
  tty: string | null;
  label?: string;
  sizeMode?: GridMode;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  template: TemplateKey;
  panes: Pane[];
  idePanes?: Pane[];
  projectPath?: string;
  command?: string;
  /** Optional user-uploaded favicon/logo (a data URL). Shown in the sidebar
   *  and mirrored onto this workspace's city building. */
  logo?: string;
  autoExpandTui?: boolean;
  layoutMode?: GridMode;
  gridFocusMode?: boolean;
  trackCols?: number[];
  trackRows?: number[];
  skipWelcomeBanner?: boolean;
}

export type View = 'workspace' | 'city' | 'colab' | 'grid' | 'dashboard' | 'ide' | 'kanban' | 'cards' | 'planner' | 'agent' | 'devices' | 'django-reviewer' | 'wizard' | 'settings';

export type GridMode = 'auto' | 'grid' | 'compact' | 'large';

export interface TemplateInfo {
  label: string;
  cols: number;
  rows: number;
}

export const TEMPLATES: Record<TemplateKey, TemplateInfo> = {
  1: { label: 'Single', cols: 1, rows: 1 },
  2: { label: 'Split', cols: 2, rows: 1 },
  3: { label: 'Triple', cols: 3, rows: 1 },
  4: { label: 'Quad', cols: 2, rows: 2 },
  6: { label: 'Six', cols: 3, rows: 2 },
  8: { label: 'Eight', cols: 4, rows: 2 },
  9: { label: 'Nine', cols: 3, rows: 3 },
  10: { label: 'Ten', cols: 5, rows: 2 },
  12: { label: 'Twelve', cols: 4, rows: 3 },
  14: { label: 'Fourteen', cols: 5, rows: 3 },
  16: { label: 'Sixteen', cols: 4, rows: 4 },
};

export const GRID_MODES: { key: GridMode; label: string; hint: string }[] = [
  { key: 'auto', label: 'Auto', hint: 'Adapts columns to window size' },
  { key: 'grid', label: 'Grid', hint: 'Uses the template layout' },
  { key: 'compact', label: 'Compact', hint: 'Fits more terminals' },
  { key: 'large', label: 'Large', hint: 'Fewer, bigger terminals' },
];

export const THEMES = [
  { name: 'dark', label: 'Dark (Default)' },
  { name: 'GitHub Dark', label: 'GitHub Dark' },
  { name: 'Dracula', label: 'Dracula' },
  { name: 'Nord', label: 'Nord' },
  { name: 'One Dark Pro', label: 'One Dark Pro' },
  { name: 'Monokai Pro', label: 'Monokai Pro' },
  { name: 'Solarized Dark', label: 'Solarized Dark' },
  { name: 'Slate', label: 'Slate Executive' },
  { name: 'Emerald Studio', label: 'Emerald Studio' },
  { name: 'Neon Tokyo', label: 'Neon Tokyo' },
  { name: 'Synthwave', label: 'Synthwave' },
  { name: 'Solarized Light', label: 'Solarized Light' },
  { name: 'Paper', label: 'Paper (Light)' },
  { name: 'Custom', label: 'Custom Theme' },
];

export const GRID_GAP = 6;

export function templateCols(tpl: TemplateKey): number {
  return TEMPLATES[tpl]?.cols || 2;
}

export function templateLabel(tpl: TemplateKey): string {
  return TEMPLATES[tpl]?.label || `${tpl}`;
}

export function gridMins(mode: GridMode): { minW: number; minH: number } {
  switch (mode) {
    // Compact fits more columns. The floor stays tall enough for a header
    // plus several terminal rows; extra panes scroll instead of collapsing.
    case 'compact': return { minW: 220, minH: 200 };
    // Large is two columns at most, each at least this tall.
    case 'large': return { minW: 420, minH: 320 };
    case 'grid': return { minW: 260, minH: 220 };
    default: return { minW: 280, minH: 220 };
  }
}

/** Pixel track minimums for the live grid. Rows never shrink below minH. */
export function gridTracks(opts: {
  mode: GridMode;
  cols: number;
  rows: number;
  width: number;
  height: number;
  gap?: number;
  pad?: number;
}): { colMin: number; rowMin: number; needsScroll: boolean } {
  const { mode, cols, rows, width, height } = opts;
  const gap = opts.gap ?? GRID_GAP;
  const pad = opts.pad ?? 12;
  const { minW, minH } = gridMins(mode);
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  const gapsW = Math.max(0, safeCols - 1) * gap;
  const gapsH = Math.max(0, safeRows - 1) * gap;
  const share = Math.max(1, Math.floor(Math.max(0, innerW - gapsW) / safeCols));
  // Hold the mode floor when the column is at least that wide. On a narrower
  // window, use the share so overflow-x stays hidden and the last column is
  // not clipped. 1fr still grows tracks when there is free width.
  const colMin = Math.min(minW, share);
  const needsScroll = safeRows * minH + gapsH > innerH;
  return { colMin, rowMin: minH, needsScroll };
}

// Counter for generating sequential workspace names when no project path is given
let _workspaceCounter = 1;

export function newWorkspace(
  name?: string,
  template: TemplateKey = 4,
  projectPath?: string,
  command?: string,
): Workspace {
  const cols = templateCols(template);
  const rows = Math.max(1, Math.ceil(template / cols));
  const id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const colors = ['#4a9eff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

  const cleanPath = projectPath?.trim().replace(/^["']|["']$/g, '') || undefined;

  // Derive a meaningful name: project path basename > explicit name > sequential counter
  let wsName = name;
  if (!wsName && cleanPath) {
    wsName = cleanPath.split(/[/\\]/).filter(Boolean).pop() || cleanPath;
  }
  if (!wsName) {
    wsName = `Workspace ${_workspaceCounter++}`;
  }

  return {
    id,
    name: wsName,
    color: colors[Math.floor(Math.random() * colors.length)],
    template,
    panes: Array.from({ length: template }, (_, i) => ({
      id: `p-${id}-${i}`,
      tty: null,
    })),
    idePanes: [
      {
        id: `ide-${id}-0`,
        tty: null,
        label: 'IDE Terminal 1',
      },
    ],
    projectPath: cleanPath,
    command: command?.trim() || undefined,
    autoExpandTui: true,
    layoutMode: 'auto',
    skipWelcomeBanner: true,
    trackCols: Array.from({ length: cols }, () => 1),
    trackRows: Array.from({ length: rows }, () => 1),
  };
}

// ── Persistence ───────────────────────────────────────────────────────

export function loadWorkspaces(): Workspace[] {
  if (typeof window === 'undefined') return [newWorkspace()];
  try {
    const raw = localStorage.getItem('tto-workspaces');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((ws: Workspace) => ({
          ...ws,
          idePanes: ws.idePanes && ws.idePanes.length > 0
            ? ws.idePanes
            : [{ id: `ide-${ws.id}-0`, tty: null, label: 'IDE Terminal 1' }],
        }));
      }
    }
  } catch {}
  return [newWorkspace()];
}

export function saveWorkspaces(ws: Workspace[]): void {
  try { localStorage.setItem('tto-workspaces', JSON.stringify(ws)); } catch {}
}

export function loadActiveWs(): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem('tto-active-ws') || ''; } catch { return ''; }
}

export function saveActiveWs(id: string): void {
  try { localStorage.setItem('tto-active-ws', id); } catch {}
}

// Aliases used by App.tsx
export const loadActiveWsId = loadActiveWs;
export const saveActiveWsId = saveActiveWs;

export function loadTheme(): string {
  if (typeof window === 'undefined') return 'dark';
  try { return localStorage.getItem('tto-theme') || 'dark'; } catch { return 'dark'; }
}

export function saveTheme(name: string): void {
  try { localStorage.setItem('tto-theme', name); } catch {}
}

// ── Grid math ─────────────────────────────────────────────────────────

export type GridDensity = 'fit' | 'scrollable';

function resolveTemplate(template: TemplateKey | number): TemplateKey {
  return (template in TEMPLATES ? template : 4) as TemplateKey;
}

function packByMinWidth(paneCount: number, width: number, minW: number): { cols: number; rows: number } {
  const cols = Math.min(paneCount, Math.max(1, Math.floor((width + GRID_GAP) / (minW + GRID_GAP))));
  return { cols, rows: Math.max(1, Math.ceil(paneCount / cols)) };
}

function autoLayout(paneCount: number, width: number, height: number): { cols: number; rows: number } {
  if (paneCount === 2) {
    return width < 680 && height > 700 ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 };
  }
  if (paneCount === 3) {
    return width >= 1050 ? { cols: 3, rows: 1 } : { cols: 2, rows: 2 };
  }
  if (paneCount === 4) return { cols: 2, rows: 2 };
  if (paneCount === 5 || paneCount === 6) return { cols: 3, rows: 2 };
  if (paneCount === 7 || paneCount === 8) {
    return width >= 1200 ? { cols: 4, rows: 2 } : { cols: 3, rows: 3 };
  }
  if (paneCount === 9) return { cols: 3, rows: 3 };
  if (paneCount === 10) {
    return width >= 1200 ? { cols: 5, rows: 2 } : { cols: 4, rows: 3 };
  }
  if (paneCount <= 12) return { cols: 4, rows: 3 };
  if (paneCount <= 14) {
    return width >= 1350 ? { cols: 5, rows: 3 } : { cols: 4, rows: 4 };
  }
  if (paneCount <= 16) return { cols: 4, rows: 4 };

  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const aspect = w / h;
  let cols = Math.round(Math.sqrt(paneCount * aspect));
  const maxCols = Math.max(1, Math.floor(width / 110));
  cols = Math.max(1, Math.min(maxCols, cols, paneCount));
  return { cols, rows: Math.max(1, Math.ceil(paneCount / cols)) };
}

export function computeGridLayout(opts: {
  paneCount: number;
  width: number;
  height: number;
  mode: GridMode;
  density: GridDensity;
  template: TemplateKey;
}): { cols: number; rows: number } {
  const { paneCount, width, height, mode, template } = opts;

  if (paneCount <= 1) return { cols: 1, rows: 1 };

  if (width <= 0 || height <= 0) {
    const cols = mode === 'grid' ? (TEMPLATES[resolveTemplate(template)]?.cols || 2) : 1;
    return { cols: Math.max(1, cols), rows: Math.max(1, Math.ceil(paneCount / Math.max(1, cols))) };
  }

  if (mode === 'compact') return packByMinWidth(paneCount, width, gridMins('compact').minW);
  if (mode === 'large') {
    // "Fewer, bigger terminals": never more than two columns. Further panes
    // add rows and the view scrolls at gridMins('large').minH.
    const packed = packByMinWidth(paneCount, width, gridMins('large').minW);
    const cols = Math.min(2, packed.cols);
    return { cols, rows: Math.max(1, Math.ceil(paneCount / cols)) };
  }
  if (mode === 'grid') {
    const cols = TEMPLATES[resolveTemplate(template)]?.cols || 2;
    return { cols, rows: Math.max(1, Math.ceil(paneCount / cols)) };
  }

  const laid = autoLayout(paneCount, width, height);
  const fitCols = Math.max(
    1,
    Math.floor((Math.max(width, 1) + GRID_GAP) / (gridMins('auto').minW + GRID_GAP)),
  );
  const cols = Math.max(1, Math.min(laid.cols, fitCols, paneCount));
  return { cols, rows: Math.max(1, Math.ceil(paneCount / cols)) };
}

export function paintedGridSlots(opts: {
  template: TemplateKey;
  paneCount: number;
  filledCount: number;
  cols: number;
  mode: GridMode;
}): number {
  const { template, paneCount, filledCount, cols, mode } = opts;
  const base = Math.max(filledCount, mode === 'grid' ? template : filledCount);
  const rowComplete = Math.max(1, cols) * Math.ceil(base / Math.max(1, cols));
  const templateFloor = mode === 'grid' ? template : 0;
  return Math.min(16, Math.max(templateFloor, paneCount, rowComplete, filledCount, 1));
}

export function computeResponsiveLayout(
  containerWidth: number,
  containerHeight: number,
  paneCount: number,
  mode: GridMode,
  template: TemplateKey = 4,
): { cols: number; rows: number; minW: number; minH: number } {
  const { minW, minH } = gridMins(mode);
  const { cols, rows } = computeGridLayout({
    paneCount,
    width: containerWidth,
    height: containerHeight,
    mode,
    density: 'fit',
    template,
  });
  return { cols, rows, minW, minH };
}
