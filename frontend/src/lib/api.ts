// ═══════════════════════════════════════════════════════════════════════════
// tto API Client — ported from legacy, cleaned up
// ═══════════════════════════════════════════════════════════════════════════

import type { TokenUsage, Task } from '@/types';
import { appendSessionToken } from './sessionAuth';

// ── Base URL resolution ───────────────────────────────────────────────

const SIDECAR_PORT = 8765;

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window;
}

let livePort: number | null = null;

export function apiBase(): string {
  if (!isTauri()) return '';
  return `http://127.0.0.1:${livePort ?? SIDECAR_PORT}`;
}

export function wsBase(): string {
  if (isTauri()) return `ws://127.0.0.1:${livePort ?? SIDECAR_PORT}`;
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}

export function setLivePort(port: number) { livePort = port; }

/** Build the raw-image URL for a given file path — used directly as <img src>. */
export function imageBlobUrl(path: string): string {
  return appendSessionToken(`${apiBase()}/api/file/blob?path=${encodeURIComponent(sanitizePath(path))}`);
}

function api(path: string): string { return `${apiBase()}${path}`; }

// ── Fetch with timeout ────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10000;

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;

  const headers = new Headers(init.headers || {});
  if (typeof window !== 'undefined' && !headers.has('Authorization')) {
    const token = localStorage.getItem('tto_collab_token');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  return fetch(input, { ...init, headers, signal }).finally(() => clearTimeout(id));
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
      else if (j.message) msg = j.message;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function sanitizePath(path: string): string {
  if (!path) return path;
  return path.replace(/:\d+\s*\)?$/, '');
}

// ── Terminals ─────────────────────────────────────────────────────────

export function getTerminals(): Promise<{ terminals: Record<string, any>; token_usage?: TokenUsage }> {
  return fetchWithTimeout(api('/api/terminals')).then((r) => handle(r));
}

export function openTerminal(cwd = ''): Promise<{ ok: boolean; tty: string }> {
  return fetchWithTimeout(api('/api/terminal/open'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  }).then((r) => handle(r));
}

// ── Files ─────────────────────────────────────────────────────────────

export interface FileEntry { name: string; is_dir: boolean; size: number | null; mtime: number; }

export function listFiles(path = ''): Promise<{ path: string; files: FileEntry[] }> {
  return fetchWithTimeout(api(`/api/files?path=${encodeURIComponent(sanitizePath(path))}`)).then((r) => handle(r));
}

export interface GetFileResponse {
  path: string;
  content: string;
  is_binary?: boolean;
  size?: number;
}

export function getFile(path: string): Promise<GetFileResponse> {
  return fetchWithTimeout(api(`/api/file?path=${encodeURIComponent(sanitizePath(path))}`)).then((r) => handle(r));
}

export interface FileSearchResult {
  name: string;
  path: string;
  rel_path: string;
  is_dir: boolean;
}

export function searchProjectFiles(
  path: string,
  query: string,
  limit = 100
): Promise<{ query: string; results: FileSearchResult[]; total: number }> {
  const clean = sanitizePath(path);
  return fetchWithTimeout(
    api(`/api/files/search?path=${encodeURIComponent(clean)}&query=${encodeURIComponent(query)}&limit=${limit}`)
  ).then((r) => handle(r));
}

export function putFile(path: string, content: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/file'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  }).then((r) => handle(r));
}

export function createFile(path: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/file/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then((r) => handle(r));
}

export function renameFile(path: string, newName: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/file/rename'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, new_name: newName }),
  }).then((r) => handle(r));
}

export function deleteFile(path: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api(`/api/file/delete?path=${encodeURIComponent(sanitizePath(path))}`), {
    method: 'DELETE',
  }).then((r) => handle(r));
}

export function createDir(path: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/dir/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then((r) => handle(r));
}

// ── Git ───────────────────────────────────────────────────────────────

export interface GitStatus {
  in_repo: boolean;
  branch: string | null;
  files: Array<{ path: string; status: string; staged?: boolean }>;
}

export function getGitStatus(workspacePath = ''): Promise<GitStatus> {
  const clean = sanitizePath(workspacePath);
  const q = clean ? `?path=${encodeURIComponent(clean)}` : '';
  return fetchWithTimeout(api(`/api/git/status${q}`)).then((r) => handle(r));
}

export function getGitDiff(filepath: string): Promise<{ diff: string | null }> {
  return fetchWithTimeout(api(`/api/git/diff?path=${encodeURIComponent(sanitizePath(filepath))}`)).then((r) => handle(r));
}

export function stageFiles(paths: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/git/stage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  }).then((r) => handle(r));
}

export function unstageFiles(paths: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/git/unstage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  }).then((r) => handle(r));
}

export function commitGit(message: string): Promise<{ ok: boolean; error?: string }> {
  return fetchWithTimeout(api('/api/git/commit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  }).then((r) => handle(r));
}

export function initGitRepo(path: string): Promise<{ ok: boolean; message?: string }> {
  return fetchWithTimeout(api('/api/git/init'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then((r) => handle(r));
}

// ── Search ────────────────────────────────────────────────────────────

export interface SearchResult { file: string; line: number; content: string; match: string; }

export function searchFiles(query: string, searchPath = ''): Promise<{ results: SearchResult[] }> {
  const q = searchPath
    ? `?query=${encodeURIComponent(query)}&path=${encodeURIComponent(searchPath)}&max_results=100`
    : `?query=${encodeURIComponent(query)}&max_results=100`;
  return fetchWithTimeout(api(`/api/search${q}`)).then((r) => handle(r));
}

// ── Tasks ─────────────────────────────────────────────────────────────

export function addTask(tty: string, description: string, model = ''): Promise<{ ok: boolean; task: Task }> {
  return fetchWithTimeout(api(`/api/terminals/${tty}/tasks`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, status: 'pending', ...(model ? { model } : {}) }),
  }).then((r) => handle(r));
}

export function completeTask(tty: string, taskId: string, summary = ''): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api(`/api/terminals/${tty}/tasks/${taskId}/complete?summary=${encodeURIComponent(summary)}`), { method: 'POST' }).then((r) => handle(r));
}

export function resetTerminalTasks(): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/terminals/reset-tasks'), { method: 'POST' }).then((r) => handle(r));
}

/** Accept the AI-suggested task for a terminal. */
export function acceptSuggestedTask(tty: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api(`/api/terminals/${tty}/suggest-task/accept`), { method: 'POST' }).then((r) => handle(r));
}

/** Dismiss the AI-suggested task for a terminal. */
export function dismissSuggestedTask(tty: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api(`/api/terminals/${tty}/suggest-task/dismiss`), { method: 'POST' }).then((r) => handle(r));
}

// ── Token Usage ───────────────────────────────────────────────────────

export function getTokenUsage(): Promise<TokenUsage> {
  return fetchWithTimeout(api('/api/token-usage')).then((r) => handle(r));
}

// ── Remote Sessions / Workspaces ──────────────────────────────────────

export interface RemoteSessionLink { id: string; tty: string; cwd?: string; agent?: string; }

export function pushSessions(sessions: RemoteSessionLink[]): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/sessions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessions),
  }).then((r) => handle<{ ok: boolean }>(r)).catch((): { ok: boolean } => ({ ok: false }));
}

export function fetchRemoteSessions(): Promise<RemoteSessionLink[]> {
  return fetchWithTimeout(api('/api/sessions')).then(async (r) => {
    const d = await handle<{ sessions?: RemoteSessionLink[] }>(r);
    return Array.isArray(d.sessions) ? d.sessions : [];
  });
}

export function pushWorkspaces(workspaces: unknown[]): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/workspaces'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workspaces),
  }).then((r) => handle<{ ok: boolean }>(r)).catch((): { ok: boolean } => ({ ok: false }));
}

export function fetchRemoteWorkspaces(): Promise<unknown[]> {
  return fetchWithTimeout(api('/api/workspaces')).then(async (r) => {
    const d = await handle<{ workspaces?: unknown[] }>(r);
    return Array.isArray(d.workspaces) ? d.workspaces : [];
  });
}

// ── Models ────────────────────────────────────────────────────────────

export async function fetchModels(): Promise<{ models: Array<{ key: string; provider: string }>; recent: string[] }> {
  const r = await fetchWithTimeout(api('/api/models'));
  const d = await handle<{ models?: any[]; recent?: string[] }>(r);
  return { models: Array.isArray(d.models) ? d.models : [], recent: Array.isArray(d.recent) ? d.recent : [] };
}

// ── Orchestrator ──────────────────────────────────────────────────────

export function runOrchestrator(task: string, workspaceId: string, terminals: Array<{ tty: string; label: string }>, model = ''): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/orchestrator/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, workspace_id: workspaceId, terminals, model }),
  }).then((r) => handle(r));
}

// ── Remote Control ────────────────────────────────────────────────────

export function fetchRemoteStatus(): Promise<any> {
  return fetchWithTimeout(api('/api/remote/status')).then((r) => handle(r));
}

export function remoteConnect(): Promise<{ ok: boolean; qr?: string | null; error?: string }> {
  return fetchWithTimeout(api('/api/remote/connect'), { method: 'POST' }).then((r) => handle(r));
}

// ── Session Management ────────────────────────────────────────────────

export function updateSessionName(tty: string, name: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api(`/api/terminals/${tty}/session-name?session_name=${encodeURIComponent(name)}`), { method: 'PATCH' }).then((r) => handle(r));
}

export function generateSessionSummary(tty: string): Promise<{ ok: boolean; summary: string }> {
  return fetchWithTimeout(api(`/api/terminals/${tty}/session-summary/generate`), { method: 'POST' }).then((r) => handle(r));
}

// ── Launch CLI ────────────────────────────────────────────────────────

export function launchCli(tty: string, command: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api(`/api/terminals/${tty}/launch`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  }).then((r) => handle(r));
}

// Export internal helpers for use by other modules (e.g., collab.ts)
export { fetchWithTimeout, handle };
