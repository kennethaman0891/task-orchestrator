import type { TerminalEntry, Task, TokenUsage } from '../types';
import { apiBase } from './base';

/** Prefix a relative /api path with the sidecar origin in Tauri mode. */
function api(path: string): string {
  return `${apiBase()}${path}`;
}

/**
 * Strip a trailing `:N` line-number suffix from a filesystem path.
 *
 * Defends against `path:line` strings (e.g. a terminal file link or an editor
 * "open at line" reference) leaking into a filesystem/git API call as a bare
 * path — which the sidecar rejects with 400/403. Only strips when the suffix is
 * a pure line reference (`:digits` at the very end); real paths never end in a
 * bare `:digits`.
 */
function sanitizePath(path: string): string {
  if (!path) return path;
  // Match a trailing `:digits` (optionally followed by a closing paren like
  // vim's `file.py:12` or `file.py(line 12)`). Don't touch windows drive letters
  // (`C:\`) or the `:` in `~/Desktop:0` style bugs beyond the very end.
  return path.replace(/:\d+\s*\)?$/, '');
}

/** Default fetch timeout (ms) — prevents hanging when sidecar is unresponsive. */
const FETCH_TIMEOUT_MS = 10000;

/** Fetch wrapper with automatic timeout via AbortController. */
function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  return fetch(input, { ...init, signal }).finally(() => clearTimeout(id));
}

export interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number | null;
  mtime: number;
}

export interface GitStatus {
  in_repo: boolean;
  branch: string | null;
  files: Array<{ path: string; status: string; staged?: boolean }>;
}

export function getGitStatus(workspacePath = ''): Promise<GitStatus> {
  const clean = sanitizePath(workspacePath);
  const q = clean ? `?path=${encodeURIComponent(clean)}` : '';
  return fetchWithTimeout(api(`/api/git/status${q}`)).then((res) => handle<GitStatus>(res));
}

export interface GitDiffResponse {
  diff: string | null;
  error?: string;
}

export function getGitDiff(filepath: string, workspace = ''): Promise<GitDiffResponse> {
  const q = workspace
    ? `path=${encodeURIComponent(sanitizePath(filepath))}&workspace=${encodeURIComponent(workspace)}`
    : `path=${encodeURIComponent(sanitizePath(filepath))}`;
  return fetchWithTimeout(api(`/api/git/diff?${q}`)).then((res) => handle<GitDiffResponse>(res));
}

/** Stage one or more files (comma-separated) in the OPEN WORKSPACE repo.
 *  Empty `paths` = stage all.  The workspace root must accompany every call so
 *  git never operates on $HOME's repo instead of the project the user opened. */
export function stageFiles(paths: string, workspace = ''): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/git/stage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, workspace }),
  }).then((res) => handle<{ ok: boolean }>(res));
}

export function unstageFiles(paths: string, workspace = ''): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/git/unstage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, workspace }),
  }).then((res) => handle<{ ok: boolean }>(res));
}

export interface GitCommitResult {
  ok: boolean;
  message?: string;
  error?: string;
  detail?: string;
}

/** Commit staged changes in the OPEN WORKSPACE repo. */
export function commitGit(message: string, workspace = ''): Promise<GitCommitResult> {
  return fetchWithTimeout(api('/api/git/commit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, workspace }),
  }).then((res) => handle<GitCommitResult>(res));
}

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

export function searchFiles(query: string, searchPath = ''): Promise<{ results: SearchResult[] }> {
  const q = searchPath
    ? `?query=${encodeURIComponent(query)}&path=${encodeURIComponent(searchPath)}&max_results=100`
    : `?query=${encodeURIComponent(query)}&max_results=100`;
  return fetchWithTimeout(api(`/api/search${q}`)).then((res) =>
    handle<{ results: SearchResult[] }>(res),
  );
}

export interface FileList {
  path: string;
  files: FileEntry[];
}

export interface FileContent {
  path: string;
  content: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
      else if (j.message) msg = j.message;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface TerminalsResponse {
  terminals: Record<string, TerminalEntry>;
  token_usage?: TokenUsage;
}

export function getTerminals(): Promise<TerminalsResponse> {
  return fetchWithTimeout(api('/api/terminals')).then((res) => handle<TerminalsResponse>(res));
}

/** Poll until the sidecar reports opencode running on `tty` with a NEW pid
 *  (or timeout). Used after a model restart so the prompt is only typed once
 *  the fresh CLI has actually booted — a fixed sleep lets the prompt get
 *  swallowed by the boot (or typed into a bare shell, which "closes" the CLI
 *  flow). Passing the pre-restart pid also catches a swallowed `/exit`: the
 *  old opencode lingering is NOT treated as a successful relaunch.
 *
 *  Returns true when opencode runs with a pid different from `oldPid` (or any
 *  pid when `oldPid` is 0 = nothing was running before). */
export async function waitForOpencodeBoot(
  tty: string,
  oldPid: number,
  timeoutMs = 30000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const d = await getTerminals();
      const t = d.terminals[tty] as
        (TerminalEntry & { opencode_running?: boolean; opencode_pid?: number }) | undefined;
      if (t?.opencode_running) {
        const pid = t.opencode_pid || 0;
        if (oldPid === 0 || (pid !== 0 && pid !== oldPid)) return true;
      }
    } catch {
      /* sidecar busy — retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export function openTerminal(cwd = ''): Promise<{ ok: boolean; tty: string }> {
  return fetchWithTimeout(api('/api/terminal/open'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  }).then((res) => handle<{ ok: boolean; tty: string }>(res));
}

export function createTermPane(): Promise<{
  ok: boolean;
  pane_id: string;
  session_name: string;
  window_id: string | null;
}> {
  return fetch(api('/api/term-panes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then((res) =>
    handle<{ ok: boolean; pane_id: string; session_name: string; window_id: string | null }>(res),
  );
}

export function deleteTermPane(paneId: string): Promise<{ ok: boolean }> {
  return fetch(api(`/api/term-panes/${paneId}`), {
    method: 'DELETE',
  }).then((res) => handle<{ ok: boolean }>(res));
}

export function attachTermPane(
  tty: string,
): Promise<{ ok: boolean; pane_id: string; session_name: string }> {
  return fetch(api('/api/term-panes/attach'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tty }),
  }).then((res) => handle<{ ok: boolean; pane_id: string; session_name: string }>(res));
}

export function launchCli(
  tty: string,
  command: string,
): Promise<{ ok: boolean; tty: string; command: string }> {
  return fetch(api(`/api/terminals/${tty}/launch`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  }).then((res) => handle<{ ok: boolean; tty: string; command: string }>(res));
}

export function addTask(
  tty: string,
  description: string,
  model = '',
): Promise<{ ok: boolean; task: Task }> {
  return fetch(api(`/api/terminals/${tty}/tasks`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description,
      status: 'pending',
      ...(model ? { model } : {}),
    }),
  }).then((res) => handle<{ ok: boolean; task: Task }>(res));
}

export function completeTask(tty: string, taskId: string, summary = ''): Promise<{ ok: boolean }> {
  return fetch(
    api(`/api/terminals/${tty}/tasks/${taskId}/complete?summary=${encodeURIComponent(summary)}`),
    {
      method: 'POST',
    },
  ).then((res) => handle<{ ok: boolean }>(res));
}

export function updateContext(tty: string, context: string): Promise<{ ok: boolean }> {
  return fetch(api(`/api/terminals/${tty}/context?context=${encodeURIComponent(context)}`), {
    method: 'PATCH',
  }).then((res) => handle<{ ok: boolean }>(res));
}

export function updateSessionContext(tty: string, context: string): Promise<{ ok: boolean }> {
  return fetch(
    api(`/api/terminals/${tty}/session-context?context=${encodeURIComponent(context)}`),
    {
      method: 'PATCH',
    },
  ).then((res) => handle<{ ok: boolean }>(res));
}

// --- Remote / mobile sync --------------------------------------------------
// The desktop app pushes its native session links + workspace definitions so
// web/mobile clients see the same workspaces and can route tasks by session id.

export interface RemoteSessionLink {
  id: string;
  tty: string;
  cwd?: string;
  agent?: string;
}

export function pushSessions(sessions: RemoteSessionLink[]): Promise<{ ok: boolean }> {
  return fetch(api('/api/sessions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessions),
  })
    .then((res) => handle<{ ok: boolean }>(res))
    .catch(() => ({ ok: false }));
}

export async function fetchRemoteSessions(): Promise<RemoteSessionLink[]> {
  const r = await fetchWithTimeout(api('/api/sessions'));
  const d = await handle<{ sessions?: RemoteSessionLink[] }>(r);
  return Array.isArray(d.sessions) ? d.sessions : [];
}

export function pushWorkspaces(workspaces: unknown[]): Promise<{ ok: boolean }> {
  return fetch(api('/api/workspaces'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workspaces),
  })
    .then((res) => handle<{ ok: boolean }>(res))
    .catch(() => ({ ok: false }));
}

export async function fetchRemoteWorkspaces(): Promise<unknown[]> {
  const r = await fetchWithTimeout(api('/api/workspaces'));
  const d = await handle<{ workspaces?: unknown[] }>(r);
  return Array.isArray(d.workspaces) ? d.workspaces : [];
}

// --- Available models (Task Center model selector) --------------------------

export interface AvailableModel {
  key: string;
  provider: string;
}

export interface ModelsResponse {
  models: AvailableModel[];
  recent: string[];
  updated_at: number;
}

export async function fetchModels(): Promise<ModelsResponse> {
  const r = await fetchWithTimeout(api('/api/models'));
  const d = await handle<ModelsResponse>(r);
  return {
    models: Array.isArray(d.models) ? d.models : [],
    recent: Array.isArray(d.recent) ? d.recent : [],
    updated_at: d.updated_at || 0,
  };
}

export interface CliModelRow {
  id: string;
  label: string;
}

export async function fetchCliInstalled(): Promise<Record<string, boolean>> {
  const r = await fetchWithTimeout(api('/api/cli-models'), {}, 15000);
  const d = await handle<{ installed?: Record<string, boolean> }>(r);
  return d.installed || {};
}

export async function fetchCliModelRows(cliId: string): Promise<CliModelRow[]> {
  const r = await fetchWithTimeout(
    api(`/api/cli-models?cli=${encodeURIComponent(cliId)}`),
    {},
    30000,
  );
  const d = await handle<{ models?: CliModelRow[] }>(r);
  return Array.isArray(d.models) ? d.models.filter((m) => m && m.id) : [];
}

export function setTerminalModel(tty: string, model: string): Promise<{ ok: boolean }> {
  return fetch(api(`/api/terminals/${tty}/model?model=${encodeURIComponent(model)}`), {
    method: 'PATCH',
  })
    .then((res) => handle<{ ok: boolean }>(res))
    .catch(() => ({ ok: false }));
}

/** Persist the model the agent was ACTUALLY (re)launched with — the watcher
 *  reports it after a model restart so the truth survives app restarts and
 *  later tasks on the same model deliver straight in (no CLI kill). */
export function setTerminalAppliedModel(tty: string, model: string): Promise<{ ok: boolean }> {
  return fetch(api(`/api/terminals/${tty}/applied-model`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
    .then((res) => handle<{ ok: boolean }>(res))
    .catch(() => ({ ok: false }));
}

/** Clear ALL task state on the sidecar — the desktop app calls this once on
 *  startup so a close/reopen never resurrects stale tasks, even against a
 *  long-lived/orphaned sidecar that outlived the previous app run. */
export function resetTerminalTasks(): Promise<{ ok: boolean }> {
  return fetch(api('/api/terminals/reset-tasks'), {
    method: 'POST',
  })
    .then((res) => handle<{ ok: boolean }>(res))
    .catch(() => ({ ok: false }));
}

// --- Model limits + emergency to-do → fitted prompt -------------------------

export interface ModelLimit {
  context: number;
  output: number;
}

export interface ModelLimitsResponse {
  limits: Record<string, ModelLimit>;
  unknown: string[];
  default: ModelLimit;
  updated_at: number;
}

export async function fetchModelLimits(): Promise<ModelLimitsResponse> {
  const r = await fetch(api('/api/models/limits'));
  const d = await r.json();
  return {
    limits: d.limits || {},
    unknown: Array.isArray(d.unknown) ? d.unknown : [],
    default: d.default || { context: 4096, output: 1024 },
    updated_at: d.updated_at || 0,
  };
}

export interface TodoContext {
  cwd?: string;
  session_context?: string;
  current_task?: string;
  summary?: string;
  recent_history?: string[];
}

export interface TodoCompileStats {
  model: string;
  est_tokens: number;
  original_est: number;
  context_limit: number;
  output_limit: number;
  reserve: number;
  budget: number;
  fits: boolean;
  compressed: boolean;
  dropped: number;
  steps: string[];
}

export interface TodoCompileResponse {
  prompt: string;
  stats: TodoCompileStats;
}

export function compileTodo(
  todoText: string,
  model: string,
  context: TodoContext,
): Promise<TodoCompileResponse> {
  return fetch(api('/api/todo/compile'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todo_text: todoText, model, context }),
  }).then((res) => handle<TodoCompileResponse>(res));
}

export interface OrchestratorTerminalInput {
  tty: string;
  label: string;
  model?: string;
}

export function runOrchestrator(
  task: string,
  workspaceId: string,
  workspaceName: string,
  terminals: OrchestratorTerminalInput[],
  model = '',
  memoryContext = '',
  agentEnabled = false,
): Promise<{ ok: boolean; run: import('../types').OrchestratorRun }> {
  return fetch(api('/api/orchestrator/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      terminals,
      model,
      memory_context: memoryContext,
      agent_enabled: agentEnabled,
    }),
  }).then((res) => handle<{ ok: boolean; run: import('../types').OrchestratorRun }>(res));
}

export function getOrchestratorRuns(
  workspaceId = '',
): Promise<{ runs: import('../types').OrchestratorRun[] }> {
  const q = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return fetch(api(`/api/orchestrator/runs${q}`)).then((res) =>
    handle<{ runs: import('../types').OrchestratorRun[] }>(res),
  );
}

export function getModels(): Promise<{ models: string[] }> {
  return fetch(api('/api/models')).then((res) => handle<{ models: string[] }>(res));
}

export function clearOrchestratorRuns(workspaceId = ''): Promise<{ ok: boolean }> {
  const q = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return fetch(api(`/api/orchestrator/runs${q}`), { method: 'DELETE' }).then((res) =>
    handle<{ ok: boolean }>(res),
  );
}

// --- Remote control (WhatsApp via OpenWA) ----------------------------------

export interface RemoteStatus {
  enabled: boolean;
  openwa_connected: boolean;
  whatsapp_session: string;
  paired: boolean;
  qr_available: boolean;
  last_command: string;
  last_activity: number;
  last_error: string;
  config?: {
    has_api_key: boolean;
    has_webhook_secret: boolean;
    allowed_chat_ids: string[];
    allowed_phone_numbers: string[];
    rate_limit_per_minute: number;
    confirm_ttl_seconds: number;
    notifications: {
      task_complete: boolean;
      task_failed: boolean;
      agent_waiting: boolean;
      terminal_crash: boolean;
      system_error: boolean;
    };
  };
}

export function fetchRemoteStatus(): Promise<RemoteStatus> {
  return fetch(api('/api/remote/status')).then((res) => handle<RemoteStatus>(res));
}

export function remoteTestConnection(): Promise<{
  ok: boolean;
  message: string;
  whatsapp?: unknown;
}> {
  return fetch(api('/api/remote/test'), { method: 'POST' }).then((res) =>
    handle<{ ok: boolean; message: string; whatsapp?: unknown }>(res),
  );
}

export function remoteRefresh(): Promise<RemoteStatus> {
  return fetch(api('/api/remote/refresh'), { method: 'POST' }).then((res) =>
    handle<RemoteStatus>(res),
  );
}

export function remoteGetQR(): Promise<{ ok: boolean; qr: string | null }> {
  return fetch(api('/api/remote/qr')).then((res) =>
    handle<{ ok: boolean; qr: string | null }>(res),
  );
}

export interface RemoteConnectResult {
  ok: boolean;
  qr?: string | null;
  webhook?: boolean;
  webhook_error?: string;
  session?: string;
  error?: string;
}

/** One-shot pairing: ensure the session exists, start QR login, register the
 *  webhook, and return the QR data-URL. */
export function remoteConnect(): Promise<RemoteConnectResult> {
  return fetch(api('/api/remote/connect'), { method: 'POST' }).then((res) =>
    handle<RemoteConnectResult>(res),
  );
}

export function generateSessionSummary(tty: string): Promise<{ ok: boolean; summary: string }> {
  return fetch(api(`/api/terminals/${tty}/session-summary/generate`), {
    method: 'POST',
  }).then((res) => handle<{ ok: boolean; summary: string }>(res));
}

export function updateSessionSummary(tty: string, summary: string): Promise<{ ok: boolean }> {
  return fetch(api(`/api/terminals/${tty}/session-summary`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary }),
  }).then((res) => handle<{ ok: boolean }>(res));
}

export function updateSessionName(tty: string, sessionName: string): Promise<{ ok: boolean }> {
  return fetch(
    api(`/api/terminals/${tty}/session-name?session_name=${encodeURIComponent(sessionName)}`),
    {
      method: 'PATCH',
    },
  ).then((res) => handle<{ ok: boolean }>(res));
}

export function getTokenUsage(): Promise<TokenUsage> {
  return fetch(api('/api/token-usage')).then((res) => handle<TokenUsage>(res));
}

export function updateTokenLimit(
  key: string,
  limit: number | null,
  label?: string,
): Promise<TokenUsage> {
  const body: Record<string, unknown> = { key, limit };
  if (label !== undefined) body.label = label;
  return fetch(api('/api/token-usage/limits'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => handle<TokenUsage>(res));
}

export function suggestTask(tty: string): Promise<{ ok: boolean; suggestion: string }> {
  return fetch(api(`/api/terminals/${tty}/suggest-task`), { method: 'POST' }).then((res) =>
    handle<{ ok: boolean; suggestion: string }>(res),
  );
}

export function acceptSuggestion(tty: string): Promise<{ ok: boolean; task: Task }> {
  return fetch(api(`/api/terminals/${tty}/suggest-task/accept`), { method: 'POST' }).then((res) =>
    handle<{ ok: boolean; task: Task }>(res),
  );
}

export function dismissSuggestion(tty: string): Promise<{ ok: boolean }> {
  return fetch(api(`/api/terminals/${tty}/suggest-task/dismiss`), { method: 'POST' }).then((res) =>
    handle<{ ok: boolean }>(res),
  );
}

export function listFiles(path = ''): Promise<FileList> {
  return fetchWithTimeout(api(`/api/files?path=${encodeURIComponent(sanitizePath(path))}`)).then(
    (res) => handle<FileList>(res),
  );
}

/** Locate the Django project root (the folder containing manage.py) for a
 *  workspace path. Returns { root, found } where root is an absolute path or
 *  null when no manage.py is present. */
export function findDjangoRoot(path: string): Promise<{ root: string | null; found: boolean }> {
  return fetchWithTimeout(
    api(`/api/django-root?path=${encodeURIComponent(sanitizePath(path))}`),
  ).then((res) => handle<{ root: string | null; found: boolean }>(res));
}

export function initGitRepo(path: string): Promise<{ ok: boolean; message?: string }> {
  return fetchWithTimeout(api('/api/git/init'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then((res) => handle<{ ok: boolean; message?: string }>(res));
}

export function getFile(path: string): Promise<FileContent> {
  return fetchWithTimeout(api(`/api/file?path=${encodeURIComponent(sanitizePath(path))}`)).then(
    (res) => handle<FileContent>(res),
  );
}

export function putFile(path: string, content: string): Promise<{ ok: boolean }> {
  return fetchWithTimeout(api('/api/file'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  }).then((res) => handle<{ ok: boolean }>(res));
}

/** Upload a .zip project archive to the sidecar; returns the extracted path. */
export function uploadProject(file: File): Promise<{ ok: boolean; path: string; name: string }> {
  const form = new FormData();
  form.append('file', file);
  return fetchWithTimeout(
    api('/api/project/upload'),
    {
      method: 'POST',
      body: form,
    },
    30000,
  ).then((res) => handle<{ ok: boolean; path: string; name: string }>(res));
}

export function sendNotification(category: string, message: string): Promise<{ ok: boolean }> {
  return fetch(api('/api/notify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, message }),
  }).then((res) => handle<{ ok: boolean }>(res));
}

// ── UI Inspector: send annotation context to agent terminal ───────────────────

export interface AnnotationPayload {
  comment: string;
  elementTag: string;
  elementClass: string;
  componentName: string;
  sourceFile?: string;
  projectPath?: string;
  boundingBox: { x: number; y: number; w: number; h: number };
}

export function sendAnnotationToAgent(
  tty: string,
  payload: AnnotationPayload,
): Promise<{ ok: boolean; task_id: string }> {
  return fetch(api('/api/annotations/send-to-agent'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tty, ...payload }),
  }).then((res) => handle<{ ok: boolean; task_id: string }>(res));
}

// ── File Content Cache ──────────────────────────────────────────────────────
// Simple in-memory cache to avoid re-fetching unchanged files.
const fileCache = new Map<string, { content: string; mtime: number }>();

export function getCachedFile(path: string): string | null {
  const entry = fileCache.get(path);
  return entry?.content ?? null;
}

export function setCachedFile(path: string, content: string, mtime?: number): void {
  fileCache.set(path, { content, mtime: mtime ?? Date.now() });
}

export function invalidateFileCache(path?: string): void {
  if (path) {
    fileCache.delete(path);
  } else {
    fileCache.clear();
  }
}

// --- Agentic Layer API -----------------------------------------------------

import type { AgentConfig, AgentStatus } from '../types';

export function fetchAgentConfig(): Promise<AgentConfig> {
  return fetch(api('/api/orchestrator/agent/config')).then((res) => handle<AgentConfig>(res));
}

export function updateAgentConfig(
  config: Partial<AgentConfig>,
): Promise<{ ok: boolean; config: AgentConfig }> {
  return fetch(api('/api/orchestrator/agent/config'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }).then((res) => handle<{ ok: boolean; config: AgentConfig }>(res));
}

export function fetchAgentStatus(): Promise<AgentStatus> {
  return fetch(api('/api/orchestrator/agent/status')).then((res) => handle<AgentStatus>(res));
}

export function toggleRunAgent(
  runId: string,
  enabled: boolean,
): Promise<{ ok: boolean; agent_enabled: boolean }> {
  return fetch(api(`/api/orchestrator/run/${runId}/agent?enabled=${enabled}`), {
    method: 'PATCH',
  }).then((res) => handle<{ ok: boolean; agent_enabled: boolean }>(res));
}

export function getRunActions(
  runId: string,
  limit = 50,
): Promise<{ run_id: string; actions: import('../types').AgentAction[]; total: number }> {
  return fetch(api(`/api/orchestrator/run/${runId}/actions?limit=${limit}`)).then((res) =>
    handle<{ run_id: string; actions: import('../types').AgentAction[]; total: number }>(res),
  );
}

export function startAgentLoop(): Promise<{ ok: boolean; running: boolean }> {
  return fetch(api('/api/orchestrator/agent/start'), { method: 'POST' }).then((res) =>
    handle<{ ok: boolean; running: boolean }>(res),
  );
}

export function stopAgentLoop(): Promise<{ ok: boolean; running: boolean }> {
  return fetch(api('/api/orchestrator/agent/stop'), { method: 'POST' }).then((res) =>
    handle<{ ok: boolean; running: boolean }>(res),
  );
}
