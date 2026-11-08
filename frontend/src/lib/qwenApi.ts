/**
 * Qwen Prime Orchestrator API Client.
 * Connects to sidecar endpoints (/api/qwen/*) for hardware profiling,
 * local model discovery, planning, and dispatch recording.
 */

import { isTauri } from './api';
import { apiBaseAsync } from '@/api/base';
import { sessionAuthReady } from './sessionAuth';

export interface QwenHardwareProfile {
  os_name: string;
  architecture: string;
  chip_brand: string;
  cpu_cores: number;
  total_ram_gb: number;
  available_ram_gb: number;
  has_metal: boolean;
  metal_version: string;
  disk_free_gb: number;
  safe_max_model_bytes: number;
  recommended_model_tier: string;
  hardware_summary: string;
}

export interface QwenModelBenchmark {
  model_name: string;
  size_bytes: number;
  size_formatted: string;
  parameter_size: string;
  quantization_level: string;
  is_qwen: boolean;
  is_fastest: boolean;
  is_agentic: boolean;
  eval_tok_per_sec: number;
  prompt_eval_tok_per_sec: number;
  total_duration_ms: number;
  load_duration_ms: number;
  eval_tokens: number;
  prompt_tokens: number;
  has_thinking: boolean;
  status: 'ready' | 'benchmarked' | 'failed';
}

export interface LocalRuntime {
  runtime: string;
  base_url: string;
  models: string[];
  latency_ms: number;
  error: string | null;
}

export interface QwenPrefs {
  runtime: string;
  model: string;
}

export interface QwenSystemProfileResponse {
  hardware: QwenHardwareProfile;
  ollama: {
    available: boolean;
    version: string;
    url: string;
    reason?: 'ok' | 'refused' | 'timeout' | 'http' | string;
    error?: string | null;
  };
  qwen_models: QwenModelBenchmark[];
  /** Every installed Ollama model. Absent on older sidecars. */
  local_models?: QwenModelBenchmark[];
  models_status?: 'listed' | 'empty' | 'skipped' | 'failed' | string;
  inventory_error?: string | null;
  recommendations: {
    fastest: string;
    reasoning: string;
  };
  /** Present on current sidecars. Older builds omit it. */
  runtimes?: LocalRuntime[];
  prefs?: QwenPrefs;
}

export interface PlannedSubtask {
  id: string;
  title: string;
  target_tty: string;
  target_label: string;
  target_workspace: string;
  action_type: string;
  command: string;
  cwd?: string;
  cli?: string;
  reasoning: string;
  error?: string;
  status: 'pending' | 'queued' | 'running' | 'sent' | 'done' | 'failed';
}

export interface PrimeOrchestrationPlan {
  plan_id: string;
  user_goal: string;
  selected_model: string;
  thinking_process: string;
  system_profile_summary: string;
  subtasks: PlannedSubtask[];
  status: 'planned' | 'executing' | 'completed' | 'failed' | 'sent' | 'partial';
  created_at: number;
  /** Session ids this plan is allowed to type into. */
  allowed_ttys?: string[] | null;
}

export type QwenFailKind = 'network' | 'timeout' | 'unauthorized' | 'http' | 'parse';

export class QwenRequestError extends Error {
  readonly kind: QwenFailKind;
  readonly status?: number;

  constructor(kind: QwenFailKind, message: string, status?: number) {
    super(message);
    this.name = 'QwenRequestError';
    this.kind = kind;
    this.status = status;
  }
}

const PROFILE_TIMEOUT_MS = 15000;

async function qwenOrigin(): Promise<string> {
  await sessionAuthReady();
  if (!isTauri()) return '';
  return apiBaseAsync();
}

function beginRequest(timeoutMs: number, parent?: AbortSignal): { signal: AbortSignal; finish: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const onParent = () => controller.abort();
  parent?.addEventListener('abort', onParent);
  return {
    signal: controller.signal,
    finish: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParent);
    },
    timedOut: () => didTimeout,
  };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') return body.detail;
  } catch {
    /* body was not JSON */
  }
  return `HTTP ${res.status}`;
}

async function qwenFetch(path: string, init: RequestInit = {}, timeoutMs = PROFILE_TIMEOUT_MS): Promise<Response> {
  const origin = await qwenOrigin();
  const attempt = beginRequest(timeoutMs, init.signal ?? undefined);
  try {
    return await fetch(`${origin}${path}`, { ...init, signal: attempt.signal });
  } catch (err) {
    if (attempt.timedOut()) {
      throw new QwenRequestError('timeout', 'The sidecar did not answer in time');
    }
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (aborted) {
      throw new QwenRequestError('timeout', 'The request was cancelled');
    }
    throw new QwenRequestError('network', err instanceof Error ? err.message : 'Network error');
  } finally {
    attempt.finish();
  }
}

async function qwenJson<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    throw new QwenRequestError('unauthorized', 'Invalid session token', 401);
  }
  if (!res.ok) {
    throw new QwenRequestError('http', await errorMessage(res), res.status);
  }
  try {
    return await res.json() as T;
  } catch {
    throw new QwenRequestError('parse', 'The sidecar response was not JSON');
  }
}

/** Fetch hardware specs, Ollama status, and running local model systems. */
export async function fetchQwenProfile(signal?: AbortSignal): Promise<QwenSystemProfileResponse> {
  const res = await qwenFetch('/api/qwen/profile', { signal });
  return qwenJson(res);
}

export async function saveQwenPref(prefs: QwenPrefs): Promise<{ ok: boolean; prefs: QwenPrefs }> {
  const res = await qwenFetch('/api/qwen/pref', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  return qwenJson(res);
}

/** Run live speed benchmark across one or all installed Qwen models */
export async function runQwenBenchmark(modelName?: string): Promise<{
  ok: boolean;
  benchmarks?: QwenModelBenchmark[];
  local_models?: QwenModelBenchmark[];
  benchmark?: QwenModelBenchmark;
  fastest?: string;
}> {
  const res = await qwenFetch('/api/qwen/benchmark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_name: modelName || '' }),
  }, 120000);
  return qwenJson(res);
}

export interface QwenTargetInput {
  sessionId: string;
  label: string;
  cli: string;
}

/** Orchestrate a natural-language goal with the selected local model */
export async function orchestrateQwenTask(params: {
  prompt: string;
  workspaceId?: string;
  workspaceName?: string;
  projectPath?: string;
  targetTtys?: string[];
  targets?: QwenTargetInput[];
  model?: string;
  runtime?: string;
  runtimeUrl?: string;
  strategy?: 'fastest' | 'reasoning';
}): Promise<{ ok: boolean; plan: PrimeOrchestrationPlan }> {
  const res = await qwenFetch('/api/qwen/orchestrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      workspace_id: params.workspaceId || '',
      workspace_name: params.workspaceName || '',
      project_path: params.projectPath || '',
      target_ttys: params.targetTtys || [],
      targets: (params.targets || []).map((item) => ({
        session_id: item.sessionId,
        label: item.label,
        cli: item.cli,
      })),
      model: params.model || '',
      runtime: params.runtime || 'ollama',
      runtime_url: params.runtimeUrl || '',
      strategy: params.strategy || 'fastest',
    }),
  }, 150000);
  return qwenJson(res);
}

export interface QwenDispatchResultInput {
  id: string;
  status: 'sent' | 'failed';
  error?: string;
}

/** Record what the desktop typed. The sidecar does not type again. */
export async function dispatchQwenPlan(params: {
  planId: string;
  subtaskIds?: string[];
  results?: QwenDispatchResultInput[];
}): Promise<{
  ok: boolean;
  dispatched_count: number;
  errors: string[];
  plan_status: string;
}> {
  const res = await qwenFetch('/api/qwen/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan_id: params.planId,
      subtask_ids: params.subtaskIds || null,
      results: params.results || [],
    }),
  });
  return qwenJson(res);
}

/** List recent orchestration plans */
export async function listQwenPlans(): Promise<{ plans: PrimeOrchestrationPlan[] }> {
  const res = await qwenFetch('/api/qwen/plans');
  return qwenJson(res);
}
