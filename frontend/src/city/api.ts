// Developer City — REST client for the project registry (sidecar API).
// Reuses the same base-URL resolution as the rest of the app.

import { apiBase, fetchWithTimeout, handle, imageBlobUrl, putFile } from '@/lib/api';
import type { BuildingConfig, CityMeta, MemoryHit, Project, ProjectFloorPlan } from '@/city/types';

const TIMEOUT_MS = 10000;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(`${apiBase()}${path}`, init, TIMEOUT_MS);
  return handle<T>(res);
}

export function listProjects(): Promise<{ projects: Project[] }> {
  return req('/api/projects');
}

export function getProject(id: string): Promise<Project> {
  return req(`/api/projects/${encodeURIComponent(id)}`);
}

export function createProject(
  // `building` may be a PARTIAL config: the server merges it over the type's defaults.
  body: Omit<Partial<Project>, 'building'> & { building?: Partial<BuildingConfig> },
): Promise<Project> {
  return req('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function patchProject(
  // `building` may be PARTIAL: the server merges it over the stored config.
  id: string,
  body: Omit<Partial<Project>, 'building'> & {
    building?: Partial<BuildingConfig>;
    agent_snapshot?: Record<string, unknown>;
  },
): Promise<Project> {
  return req(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string): Promise<{ ok: boolean }> {
  return req(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function saveAgentSnapshot(id: string, snapshot: Record<string, unknown>): Promise<{ ok: boolean }> {
  return req(`/api/projects/${encodeURIComponent(id)}/agent-snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
}

export function getCityMeta(): Promise<CityMeta> {
  return req('/api/projects/__meta');
}

export function recallMemory(
  projectId: string,
  floorIndex: number | null,
  q = '',
): Promise<{ hits: MemoryHit[] }> {
  const params = new URLSearchParams({ project_id: projectId, q, limit: '5', days: '30' });
  if (floorIndex !== null) params.set('floor_index', String(floorIndex));
  return req(`/api/neurocity/geodesic-recall?${params.toString()}`);
}

export function recordEpisode(body: {
  project_id: string;
  source: 'git_commit' | 'terminal_task';
  summary: string;
  cwd?: string;
  floor_folder?: string;
  terminal_id?: string;
  task_id?: string;
  task_status?: string;
  ts?: number;
}): Promise<{ ok: boolean; created: boolean; id: string }> {
  return req('/api/neurocity/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getProjectFloorPlan(id: string): Promise<ProjectFloorPlan> {
  return req(`/api/projects/${encodeURIComponent(id)}/floor-plan`);
}

export function scanProjectFloorPlan(path: string): Promise<ProjectFloorPlan> {
  return req('/api/projects/scan-floor-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

/** Fixed sample mesh. The sentence is accepted by the server and ignored. */
export function requestCityCarSpec(kind: 'car' | 'street', sentence: string): Promise<unknown> {
  return req('/api/city/car-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, sentence }),
  });
}

/** URL for rendering a logo/screenshot stored by absolute path. */
export { imageBlobUrl, putFile };
