// Developer City — central state (zustand). The 3D scene reads from here;
// everything the city shows is data. Modules:
//   projects — registry records (loaded from the sidecar, live-updated)
//   nav      — CITY → PROJECT → BUILDING → FLOOR → ROOM → WORKSPACE machine
//   agents   — live agent bots (mapped from real sidecar/Jarvis state)
//   camera   — where the rig should look
//   filters  — city-wide search/filter

import { create } from 'zustand';
import type { AgentBot, CarSpec, CityNavMode, Project, ProjectStatus, ProjectType, TerminalCar, InteriorViewMode, FloorPlanObject } from '@/city/types';
import { parseCarSpec } from '@/city/scene/carSpec';

export interface CityFilters {
  query: string;
  types: ProjectType[];      // empty = all
  statuses: ProjectStatus[]; // empty = all
  agentActive: boolean;
}

export interface CameraTarget {
  x: number; y: number; z: number;
  lookX: number; lookY: number; lookZ: number;
  /** nonce so the rig re-flies even to the same spot */
  nonce: number;
}

interface CityStore {
  // ── data ──
  projects: Record<string, Project>;
  projectOrder: string[];
  loaded: boolean;
  loadError: string | null;
  setProjects: (list: Project[]) => void;
  upsertProject: (p: Project) => void;
  removeProject: (id: string) => void;
  setLoaded: (loaded: boolean, error?: string | null) => void;

  // ── navigation (history stack so "exit" pops one level) ──
  nav: CityNavMode;
  navHistory: CityNavMode[];
  goExterior: (projectId: string) => void;
  goInterior: (projectId: string, floorIndex: number, room?: string | null) => void;
  goCar: (projectId: string, paneId: string, terminalId: string) => void;
  exitOneLevel: () => void;
  exitToCity: () => void;

  // ── selection ──
  selectedProjectId: string | null;
  selectedAgentId: string | null;
  selectProject: (id: string | null) => void;
  selectAgent: (id: string | null) => void;

  // ── terminal cars (live, keyed by car.id) ──
  terminalCars: Record<string, TerminalCar>;
  setTerminalCars: (list: TerminalCar[]) => void;
  selectedTerminalCarId: string | null;
  selectTerminalCar: (id: string | null) => void;
  /** Checked parts list per pane. Missing key means the built-in sedan. */
  carSpecs: Record<string, CarSpec>;
  setCarSpec: (paneId: string, spec: CarSpec | null) => void;

  /** First-level folders and temp files for each project plot. */
  plotDistricts: Record<string, { dirs: string[]; files: { name: string }[] }>;
  setPlotDistricts: (map: Record<string, { dirs: string[]; files: { name: string }[] }>) => void;

  // ── camera ──
  cameraTarget: CameraTarget | null;
  setCameraTarget: (t: Omit<CameraTarget, 'nonce'>) => void;
  clearCameraTarget: () => void;

  // ── interior view mode (dollhouse overview vs walk-in first person) ──
  interiorViewMode: InteriorViewMode;
  setInteriorViewMode: (m: InteriorViewMode) => void;
  activeObjectInspection: FloorPlanObject | null;
  setActiveObjectInspection: (obj: FloorPlanObject | null) => void;

  // ── filters ──
  filters: CityFilters;
  setFilters: (f: Partial<CityFilters>) => void;

  // ── agents (live) ──
  agents: Record<string, AgentBot>;
  setAgents: (list: AgentBot[]) => void;

  // ── user avatar (foundation: name + accent; appearance customisation later) ──
  userAvatar: { name: string; color: string };
  setUserAvatar: (a: { name?: string; color?: string }) => void;

  // ── current sidebar workspace (path of the workspace the user is in) ──
  activeWorkspacePath: string | null;
  setActiveWorkspacePath: (path: string | null) => void;

  // ── building context menu (right-click in 3D → DOM menu in CityView) ──
  contextMenu: { projectId: string; x: number; y: number } | null;
  openContextMenu: (projectId: string, x: number, y: number) => void;
  closeContextMenu: () => void;

  // ── city mood: day (blue sky) / night ──
  cityMood: 'day' | 'night';
  setCityMood: (m: 'day' | 'night') => void;

  // ── city features (traffic, nature, birds) ──
  showTraffic: boolean;
  setShowTraffic: (s: boolean) => void;
  showNature: boolean;
  setShowNature: (s: boolean) => void;
  showBirds: boolean;
  setShowBirds: (s: boolean) => void;
}

const initialNav: CityNavMode = { mode: 'city' };
const CAR_SPECS_KEY = 'tto-city-car-specs';

function loadCarSpecs(): Record<string, CarSpec> {
  try {
    const raw = localStorage.getItem(CAR_SPECS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const specs: Record<string, CarSpec> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const result = parseCarSpec(value);
      if (result.spec) specs[id] = result.spec;
    }
    return specs;
  } catch {
    return {};
  }
}

export const useCityStore = create<CityStore>((set, get) => ({
  projects: {},
  projectOrder: [],
  loaded: false,
  loadError: null,

  setProjects: (list) => set({
    projects: Object.fromEntries(list.map((p) => [p.id, p])),
    projectOrder: list.map((p) => p.id),
  }),
  upsertProject: (p) => {
    const cur = get();
    const projects = { ...cur.projects, [p.id]: p };
    const order = cur.projectOrder.includes(p.id) ? cur.projectOrder : [...cur.projectOrder, p.id];
    set({ projects, projectOrder: order });
  },
  removeProject: (id) => {
    const cur = get();
    const projects = { ...cur.projects };
    delete projects[id];
    const nav = cur.nav.mode === 'city' ? cur.nav : { mode: 'city' as const };
    set({
      projects,
      projectOrder: cur.projectOrder.filter((x) => x !== id),
      nav,
      navHistory: [],
      selectedProjectId: cur.selectedProjectId === id ? null : cur.selectedProjectId,
    });
  },
  setLoaded: (loaded, error = null) => set({ loaded, loadError: error }),

  nav: initialNav,
  navHistory: [],
  goExterior: (projectId) => set((s) => ({
    nav: { mode: 'exterior', projectId },
    navHistory: [...s.navHistory, s.nav],
    selectedProjectId: projectId,
  })),
  goInterior: (projectId, floorIndex, room = null) => set((s) => {
    const alreadyInside = s.nav.mode === 'interior' && s.nav.projectId === projectId;
    return {
      nav: { mode: 'interior' as const, projectId, floorIndex, room },
      navHistory: alreadyInside ? s.navHistory : [...s.navHistory, s.nav],
      selectedProjectId: projectId,
    };
  }),
  goCar: (projectId, paneId, terminalId) => set((s) => ({
    nav: { mode: 'car', projectId, paneId, terminalId },
    navHistory: [...s.navHistory, s.nav],
  })),
  exitOneLevel: () => set((s) => {
    const history = [...s.navHistory];
    const prev = history.pop();
    if (!prev) return { nav: { mode: 'city' as const }, navHistory: [], interiorViewMode: 'dollhouse', activeObjectInspection: null };
    return { nav: prev, navHistory: history, interiorViewMode: prev.mode === 'interior' ? s.interiorViewMode : 'dollhouse', activeObjectInspection: null };
  }),
  exitToCity: () => set({ nav: { mode: 'city' }, navHistory: [], selectedProjectId: null, interiorViewMode: 'dollhouse', activeObjectInspection: null }),

  selectedProjectId: null,
  selectedAgentId: null,
  selectProject: (id) => set({ selectedProjectId: id }),
  selectAgent: (id) => set({ selectedAgentId: id }),

  terminalCars: {},
  setTerminalCars: (list) => set({
    terminalCars: Object.fromEntries(list.map((c) => [c.id, c])),
  }),
  selectedTerminalCarId: null,
  selectTerminalCar: (id) => set({ selectedTerminalCarId: id }),
  carSpecs: loadCarSpecs(),
  setCarSpec: (paneId, spec) => set((s) => {
    const carSpecs = { ...s.carSpecs };
    if (spec) carSpecs[paneId] = spec;
    else delete carSpecs[paneId];
    try { localStorage.setItem(CAR_SPECS_KEY, JSON.stringify(carSpecs)); } catch { /* ignore */ }
    return { carSpecs };
  }),
  plotDistricts: {},
  setPlotDistricts: (map) => set({ plotDistricts: map }),

  cameraTarget: null,
  setCameraTarget: (t) => set((s) => ({
    cameraTarget: { ...t, nonce: (s.cameraTarget?.nonce ?? 0) + 1 },
  })),
  clearCameraTarget: () => set({ cameraTarget: null }),

  interiorViewMode: 'dollhouse',
  setInteriorViewMode: (mode) => set({ interiorViewMode: mode }),
  activeObjectInspection: null,
  setActiveObjectInspection: (obj) => set({ activeObjectInspection: obj }),

  filters: { query: '', types: [], statuses: [], agentActive: false },
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),

  agents: {},
  setAgents: (list) => set({ agents: Object.fromEntries(list.map((a) => [a.id, a])) }),

  userAvatar: { name: 'You', color: '#4f8ff7' },
  setUserAvatar: (a) => set((st) => ({ userAvatar: { ...st.userAvatar, ...a } })),

  activeWorkspacePath: null,
  setActiveWorkspacePath: (path) => set({ activeWorkspacePath: path }),

  contextMenu: null,
  openContextMenu: (projectId, x, y) => set({ contextMenu: { projectId, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),

  cityMood: loadCityMood(),
  setCityMood: (m) => {
    try { localStorage.setItem('tto-city-mood', m); } catch { /* ignore */ }
    set({ cityMood: m });
  },

  showTraffic: true,
  setShowTraffic: (s) => set({ showTraffic: s }),
  showNature: true,
  setShowNature: (s) => set({ showNature: s }),
  showBirds: true,
  setShowBirds: (s) => set({ showBirds: s }),
}));

function loadCityMood(): 'day' | 'night' {
  try { return localStorage.getItem('tto-city-mood') === 'day' ? 'day' : 'night'; }
  catch { return 'night'; }
}

/** Projects passing the active filters — the only list the scene renders. */
export function visibleProjectIds(projects: Record<string, Project>, order: string[], filters: CityFilters): string[] {
  const q = filters.query.trim().toLowerCase();
  return order.filter((id) => {
    const p = projects[id];
    if (!p) return false;
    if (filters.types.length > 0 && !filters.types.includes(p.type)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(p.status)) return false;
    if (q) {
      const hay = `${p.name} ${p.path} ${p.type}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
