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
    case 'compact': return { minW: 220, minH: 140 };
    case 'large': return { minW: 420, minH: 280 };
    case 'grid': return { minW: 300, minH: 200 };
    default: return { minW: 280, minH: 180 };
  }
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

export function computeResponsiveLayout(
  containerWidth: number,
  containerHeight: number,
  paneCount: number,
  mode: GridMode,
): { cols: number; rows: number; minW: number; minH: number } {
  const { minW, minH } = gridMins(mode);

  if (containerWidth <= 0 || containerHeight <= 0) {
    return { cols: templateCols(Math.min(paneCount, 16) as TemplateKey), rows: Math.ceil(paneCount / templateCols(Math.min(paneCount, 16) as TemplateKey)), minW, minH };
  }

  const maxCols = Math.max(1, Math.floor((containerWidth + GRID_GAP) / (minW + GRID_GAP)));
  const cols = Math.min(maxCols, paneCount);
  const rows = Math.ceil(paneCount / cols);
  return { cols, rows, minW, minH };
}
