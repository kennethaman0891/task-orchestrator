// Developer City — roads inside one project plot.
// Folder names in, segment offsets out. No filesystem and no React.

export interface RoadSegment {
  /** Stable: `${projectId}:root` or `${projectId}:${relativePath}`. */
  id: string;
  projectId: string;
  /** Folder basename only. Raw; not prettified. */
  name: string;
  /** '' for the project root. */
  relativePath: string;
  depth: 0 | 1 | 2;
  /** Offset from the plot center. Each axis stays in [-3.2, 3.2]. */
  x: number;
  z: number;
  rotY: number;
  length: number;
}

export const SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'venv',
  '.venv',
  'graphify-out',
];

const COLONY_CAP = 8;
const COLONY_X_MIN = -3.0;
const COLONY_X_MAX = 3.0;
const COLONY_Z = 5.0;
/** Depth-2 spur sits just in front of its colony. */
const DEPTH2_Z_STEP = 0.8;

function pathParts(relative: string | null): string[] {
  if (!relative) return [];
  return relative.split('/').filter((part) => part.length > 0);
}

function selectColonyNames(childNames: string[], activeRelative: string | null): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of childNames) {
    if (!name || seen.has(name) || SKIP_DIRS.includes(name)) continue;
    seen.add(name);
    names.push(name);
  }
  if (names.length <= COLONY_CAP) return names;

  const preferred = pathParts(activeRelative)[0];
  const preferredIndex = preferred ? names.indexOf(preferred) : -1;
  if (preferredIndex < 0 || preferredIndex < COLONY_CAP) return names.slice(0, COLONY_CAP);
  return [...names.slice(0, COLONY_CAP - 1), names[preferredIndex]];
}

/** Even x from -2.4 to 2.4. A single colony sits on the centerline. */
function fanX(index: number, count: number): number {
  if (count <= 1) return 0;
  return COLONY_X_MIN + ((COLONY_X_MAX - COLONY_X_MIN) * index) / (count - 1);
}

export function layoutDistrict(
  projectId: string,
  rootName: string,
  childNames: string[],
  activeRelative: string | null,
): RoadSegment[] {
  const root: RoadSegment = {
    id: `${projectId}:root`,
    projectId,
    name: rootName,
    relativePath: '',
    depth: 0,
    x: 0,
    z: 5.2,
    rotY: 0,
    length: 2.4,
  };

  const colonyNames = selectColonyNames(childNames, activeRelative);
  const colonies: RoadSegment[] = colonyNames.map((name, index) => ({
    id: `${projectId}:${name}`,
    projectId,
    name,
    relativePath: name,
    depth: 1,
    x: fanX(index, colonyNames.length),
    z: COLONY_Z,
    rotY: 0,
    length: 1.6,
  }));

  const segments: RoadSegment[] = [root, ...colonies];
  const parts = pathParts(activeRelative);
  if (parts.length >= 2) {
    const [folder, child] = parts;
    const colony = colonies.find((seg) => seg.relativePath === folder);
    if (colony && child) {
      segments.push({
        id: `${projectId}:${folder}/${child}`,
        projectId,
        name: child,
        relativePath: `${folder}/${child}`,
        depth: 2,
        x: colony.x,
        z: colony.z - DEPTH2_Z_STEP,
        rotY: 0,
        length: 1.2,
      });
    }
  }
  return segments;
}

function isPathPrefix(prefix: string, full: string): boolean {
  if (prefix === '') return true;
  return full === prefix || full.startsWith(`${prefix}/`);
}

function rootSegment(segments: RoadSegment[]): RoadSegment | null {
  return (
    segments.find((seg) => seg.depth === 0 && seg.relativePath === '') ??
    segments.find((seg) => seg.relativePath === '') ??
    null
  );
}

/**
 * Match a terminal cwd to the deepest laid-out street inside the project.
 * Outside the project path, returns null.
 */
export function segmentForCwd(
  projectPath: string,
  cwd: string,
  segments: RoadSegment[],
): RoadSegment | null {
  if (cwd === projectPath) return rootSegment(segments);

  const prefix = `${projectPath}/`;
  if (!cwd.startsWith(prefix)) return null;

  const relative = cwd.slice(prefix.length);
  let best: RoadSegment | null = null;
  for (const seg of segments) {
    if (!isPathPrefix(seg.relativePath, relative)) continue;
    if (
      !best ||
      seg.depth > best.depth ||
      (seg.depth === best.depth && seg.relativePath.length > best.relativePath.length)
    ) {
      best = seg;
    }
  }
  return best;
}
