// ═══════════════════════════════════════════════════════════════════════════
// Developer City — data contracts. Mirrors backend/routers/projects.py.
// The 3D scene is rendered ENTIRELY from these records; no project is
// hard-coded anywhere in the city code.
// ═══════════════════════════════════════════════════════════════════════════

export type ProjectType =
  | 'college'
  | 'ecommerce'
  | 'business'
  | 'portfolio'
  | 'saas'
  | 'custom';

export const PROJECT_TYPES: ProjectType[] = [
  'college', 'ecommerce', 'business', 'portfolio', 'saas', 'custom',
];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  college: 'College',
  ecommerce: 'E-commerce',
  business: 'Business',
  portfolio: 'Portfolio',
  saas: 'SaaS',
  custom: 'Custom',
};

export type ProjectStatus = 'active' | 'paused' | 'archived';
export type ProjectHealth = 'healthy' | 'degraded' | 'failed' | 'unknown';

/** Visual configuration of one building — pure data, user-editable. */
export interface BuildingConfig {
  buildingStyle: string;        // archetype key (defaults to project type)
  theme: string;                // one of THEMES
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  /** Auto-extracted brand palette {primary, secondary, accent} */
  brandColors: { primary: string; secondary: string; accent: string } | null;
  logo: string | null;          // file path / URL for the logo image
  texture: string | null;
  scale: number;
  rotation: number;            // degrees
  themeIndex: number;
  /**
   * Optional 8-slot user palette (null/empty slot = inherit theme cascade):
   *  0 facade   1 plinth/lower walls   2 glass/windows
   *  3 accent/roof features   4 window glow (lit)
   *  5 plaza ring (ground disc under the building)
   *  6 sign/logo plate background   7 trim (roof cap, antenna)
   */
  palette?: (string | null)[];
  /** Custom 3D model generated automatically from a user-uploaded image */
  customModel3d?: CustomModel3dConfig | null;
  /** Optional outbuildings, offsets in plot units from the main footprint. */
  subBuildings?: SubBuilding[];
}

export interface SubBuilding {
  id: string;
  name: string;
  dx: number;
  dz: number;
}

export interface CustomModel3dConfig {
  enabled: boolean;
  imageUrl: string;
  depth?: number;            // 0.2 to 2.0 (default 0.8)
  placement?: 'rooftop' | 'facade' | 'plaza'; // default 'rooftop'
  spinSpeed?: number;        // 0 = static, 1 = normal, 2 = fast
  scale?: number;            // 0.5 to 2.5 (default 1.0)
}

/** One floor = one level inside the building, rooms are its zones. */
export interface FloorSpec {
  name: string;
  rooms: string[];
}

export type FloorCategory = 'frontend' | 'backend' | 'rust' | 'ai' | 'devops' | 'docs' | 'custom';

export type FloorPlanObjectType =
  | 'workstation'
  | 'server_pod'
  | 'database_pod'
  | 'preview_billboard'
  | 'component_gallery'
  | 'agent_console'
  | 'pipeline_station'
  | 'blueprint_board'
  | 'lounge';

export interface FloorPlanObject {
  id: string;
  type: FloorPlanObjectType;
  title: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  file?: string;
  file2?: string;
  codeLines1?: string[];
  codeLines2?: string[];
  actionType?: string;
  actionLabel?: string;
  status?: string;
  details?: string;
  endpoints?: string[];
  docs?: string[];
  preview?: string[];
  commits?: string[];
}

export interface FloorPlanFloor {
  index: number;
  name: string;
  category: FloorCategory;
  role: string;
  folder: string;
  theme: string;
  accentColor: string;
  floorStyle: 'oak' | 'tile' | 'steel' | 'obsidian' | 'slate' | 'walnut';
  wallStyle: 'modern_white' | 'server_mesh' | 'dark_concrete' | 'wood_panel';
  description: string;
  objects: FloorPlanObject[];
}

export interface ProjectFloorPlan {
  project: {
    name: string;
    path: string;
    techStack: string[];
    topFolders: string[];
    gitBranch: string;
    totalFloors: number;
  };
  floors: FloorPlanFloor[];
}

export type InteriorViewMode = 'dollhouse' | 'walk-in';

export interface ProjectDeployInfo {
  target?: string;
  lastDeployedAt?: string;
  lastStatus?: string;
  url?: string;
  maintenance?: boolean;
  [k: string]: unknown;
}

/** A persisted project record (the city's atom). */
export interface Project {
  id: string;
  name: string;
  path: string;
  type: ProjectType;
  status: ProjectStatus;
  health: ProjectHealth;
  logo: string | null;
  screenshot: string | null;
  deploy: ProjectDeployInfo | null;
  floors: string[] | FloorSpec[];
  building: BuildingConfig;
  plot: { x: number; y: number };
  agent_snapshot: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

// ── Runtime agent state (NOT persisted — driven by the live sidecar) ──────
export type AgentBotStatus =
  | 'idle' | 'thinking' | 'working' | 'waiting'
  | 'completed' | 'failed' | 'offline';

export interface AgentBot {
  id: string;
  name: string;
  model: string;
  sessionId: string;      // Rust session id / tty
  terminalId: string;
  projectPath: string;
  status: AgentBotStatus;
  currentTask: string;
  room: string | null;    // interior zone this agent is placed in
  progress: number;       // 0..1
  tools: string[];
  recentActions: string[];
}

/** One Nero recall hit. Real git commit or terminal task, never a fabricated episode. */
export interface MemoryHit {
  id: string;
  source: string;
  summary: string;
  label: string;
  ts: number;
  floor_index: number | null;
  distance: number;
  score: number;
}

export interface MemoryFloor {
  projectId: string;
  floorIndex: number | null;
}

/** One primitive of a terminal car mesh. */
export interface CarPart {
  shape: 'box' | 'cylinder';
  size: [number, number, number];
  color: string;
  position: [number, number, number];
}

export interface CarSpec {
  kind: 'car';
  parts: CarPart[];
}

/** Live terminal rendered as a city vehicle. Not persisted. */
export interface TerminalCar {
  id: string;
  terminalId: string;
  workspaceId: string;
  projectId: string;
  projectPath: string;
  slotIndex: number;
  name: string;
  color: string;
  live: boolean;
  moving: boolean;
  agentName: string;
  modelName: string;
  cli: string;
  cwd: string;
  currentTask: { id: string; description: string; status: string; started_at: number | null } | null;
  history: { id: string; description: string; status: string; completed_at: number | null }[];
  queueCount: number;
  nextTask: boolean;
  paused: boolean;
  batchDispatched: boolean;
  tokensInput: number;
  tokensOutput: number;
}

export interface CityMeta {
  grid_size: number;
  grid_spacing: number;
  project_types: string[];
  default_floors: Record<string, string[]>;
  themes: string[];
}

/** Navigation context model: CITY → PROJECT → BUILDING → FLOOR → ROOM → WORKSPACE */
export type CityNavMode =
  | { mode: 'city' }
  | { mode: 'exterior'; projectId: string }
  | { mode: 'interior'; projectId: string; floorIndex: number; room: string | null }
  | { mode: 'car'; projectId: string; paneId: string; terminalId: string };

/** The 2D fallback map uses the same records. */
export function projectDisplayName(p: Project): string {
  return p.name || (p.path ? (p.path.split('/').filter(Boolean).pop() || 'Untitled') : 'Untitled');
}
