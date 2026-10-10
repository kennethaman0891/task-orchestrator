// Developer City — REST client for the project registry (sidecar API).
// Reuses the same base-URL resolution as the rest of the app.

import { apiBase, fetchWithTimeout, handle, imageBlobUrl, putFile } from '@/lib/api';
import type { BuildingConfig, CityMeta, Project } from '@/city/types';

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

/** URL for rendering a logo/screenshot stored by absolute path. */
export { imageBlobUrl, putFile };
