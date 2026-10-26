/**
 * Qwen Prime Orchestrator API Client.
 * Connects to sidecar endpoints (/api/qwen/*) for hardware profiling,
 * Ollama model benchmarking, Prime-Agent intelligence planning, and terminal dispatch.
 */

import { apiBase } from './api';

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

export interface QwenSystemProfileResponse {
  hardware: QwenHardwareProfile;
  ollama: {
    available: boolean;
    version: string;
    url: string;
  };
  qwen_models: QwenModelBenchmark[];
  /** Every installed Ollama model. Absent on older sidecars. */
  local_models?: QwenModelBenchmark[];
  recommendations: {
    fastest: string;
    reasoning: string;
  };
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
  reasoning: string;
  status: 'pending' | 'queued' | 'running' | 'done' | 'failed';
}

export interface PrimeOrchestrationPlan {
  plan_id: string;
  user_goal: string;
  selected_model: string;
  thinking_process: string;
  system_profile_summary: string;
  subtasks: PlannedSubtask[];
  status: 'planned' | 'executing' | 'completed' | 'failed';
  created_at: number;
  /** Session ids this plan is allowed to type into. */
  allowed_ttys?: string[] | null;
}

const DEFAULT_SIDECAR = 'http://127.0.0.1:8765';

function getApiBase(): string {
  const base = apiBase();
  return base || DEFAULT_SIDECAR;
}

/** Fetch hardware specs, Ollama connection status, and discovered Qwen models */
export async function fetchQwenProfile(): Promise<QwenSystemProfileResponse> {
  const res = await fetch(`${getApiBase()}/api/qwen/profile`);
  if (!res.ok) {
    throw new Error(`Failed to load Qwen profile (HTTP ${res.status})`);
  }
  return res.json();
}

/** Run live speed benchmark across one or all installed Qwen models */
export async function runQwenBenchmark(modelName?: string): Promise<{
  ok: boolean;
  benchmarks?: QwenModelBenchmark[];
  local_models?: QwenModelBenchmark[];
  benchmark?: QwenModelBenchmark;
  fastest?: string;
}> {
  const res = await fetch(`${getApiBase()}/api/qwen/benchmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_name: modelName || '' }),
  });
  if (!res.ok) {
    throw new Error(`Failed to run benchmark (HTTP ${res.status})`);
  }
  return res.json();
}

/** Orchestrate a natural-language goal with Prime-Agent intelligence */
export async function orchestrateQwenTask(params: {
  prompt: string;
  workspaceId?: string;
  workspaceName?: string;
  projectPath?: string;
  targetTtys?: string[];
  model?: string;
  strategy?: 'fastest' | 'reasoning';
}): Promise<{ ok: boolean; plan: PrimeOrchestrationPlan }> {
  const res = await fetch(`${getApiBase()}/api/qwen/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      workspace_id: params.workspaceId || '',
      workspace_name: params.workspaceName || '',
      project_path: params.projectPath || '',
      target_ttys: params.targetTtys || [],
      model: params.model || '',
      strategy: params.strategy || 'fastest',
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Orchestration failed: ${errText}`);
  }
  return res.json();
}

/** Dispatch subtasks to target terminals */
export async function dispatchQwenPlan(params: {
  planId: string;
  subtaskIds?: string[];
}): Promise<{
  ok: boolean;
  dispatched_count: number;
  errors: string[];
  plan_status: string;
}> {
  const res = await fetch(`${getApiBase()}/api/qwen/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan_id: params.planId,
      subtask_ids: params.subtaskIds || null,
    }),
  });
  if (!res.ok) {
    throw new Error(`Dispatch failed (HTTP ${res.status})`);
  }
  return res.json();
}

/** List recent orchestration plans */
export async function listQwenPlans(): Promise<{ plans: PrimeOrchestrationPlan[] }> {
  const res = await fetch(`${getApiBase()}/api/qwen/plans`);
  if (!res.ok) {
    throw new Error(`Failed to list plans (HTTP ${res.status})`);
  }
  return res.json();
}
