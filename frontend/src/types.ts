export type TaskStatus = 'pending' | 'running' | 'done' | 'blocked';

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  summary: string;
  context: string;
  output: string;
  model?: string;
}

export interface Tokens {
  tokens_input: number;
  tokens_output: number;
  cost: number;
  model: string;
  session_title?: string;
}

export interface TerminalEntry {
  tty: string;
  agent: string;
  /** Foreground CLI detected by the process scan (vim, htop, opencode, ...). */
  cli?: string;
  cwd: string;
  is_live: boolean;
  tokens: Tokens;
  session_name: string;
  window_name: string;
  pane_title: string;
  session_context: string;
  session_summary: string;
  pending_cli: boolean;
  live_output: string;
  suggested_task: string;
  model?: string;
  /** Backend process-scan truth: is opencode running on this tty, and with
   *  which model was it launched ('' = bare/default launch)? */
  opencode_running?: boolean;
  opencode_model?: string;
  opencode_pid?: number;
  /** Backend process-scan truth: is Claude Code running on this tty? */
  claude_running?: boolean;
  claude_pid?: number;
  /** Epoch seconds when this terminal was first observed by the sidecar scan.
   *  Used by the frontend to compute and display live uptime. */
  registered_at?: number;
  /** Live opencode session state read from opencode's own DB by the sidecar:
   *  'working' = agent turn in flight (parts streaming),
   *  'waiting' = turn finished, CLI sits at the prompt,
   *  'off'     = no live opencode session for this terminal.
   *  last_text is the most recent assistant text (the live question preview). */
  opencode_status?: {
    state: 'working' | 'waiting' | 'off';
    last_update_ms: number;
    last_text: string;
    session_id?: string;
    /** Short human-friendly session name (e.g. "jolly-mountain") from opencode. */
    session_slug?: string;
    /** Human session title (e.g. "Memorizing 21AI44 cheatsheet") from opencode. */
    session_title?: string;
  };
  current_task: Task | null;
  next_task: Task | null;
  queue: Task[];
  history: Task[];
}

export interface TokenModel {
  key: string;
  name: string;
  provider: string;
  used: number;
  limit: number | null;
  left: number | null;
}

export interface TokenTotals {
  used: number;
  available: number;
  left: number;
}

export interface TokenUsage {
  /** Per-model usage data (keyed by model name/key) */
  by_model?: Record<string, {
    tokens_input: number;
    tokens_output: number;
    cost: number;
    sessions: number;
  }>;
  /** Per-session usage data (keyed by session ID) */
  by_session?: Record<string, {
    tokens_input: number;
    tokens_output: number;
    cost: number;
    model: string;
    session_title?: string;
  }>;
  /** Total tokens used */
  totals?: {
    tokens_input: number;
    tokens_output: number;
  };
  /** Total cost in USD */
  total_cost?: number;
  /** List of token models (legacy) */
  models?: TokenModel[];
  /** Legacy totals (for backwards compatibility) */
  totals_legacy?: TokenTotals;
  threshold?: number;
  updated_at?: number;
}

export interface OrchestratorSplit {
  tty: string;
  label: string;
  task_id: string;
  description: string;
  model: string;
  status: 'queued' | 'running' | 'done' | 'blocked' | 'pending';
  retry_count: number;
}

export interface OrchestratorRun {
  id: string;
  task: string;
  workspace_name: string;
  workspace_id: string;
  created_at: number;
  status: 'planning' | 'dispatching' | 'running' | 'done' | 'failed';
  error: string;
  splits: OrchestratorSplit[];
  agent_enabled: boolean;
  agent_actions: AgentAction[];
  summary: string;
}

export interface AgentAction {
  type: string;
  message: string;
  timestamp: number;
  split_id: string;
}

export interface AgentConfig {
  enabled: boolean;
  auto_retry: boolean;
  max_retries: number;
  stall_timeout: number;
  chain_mode: boolean;
  synthesis: boolean;
  poll_interval: number;
}

export interface AgentStatus {
  loop_running: boolean;
  config: AgentConfig;
  active_runs: number;
  agent_runs: number;
  total_actions: number;
}

export interface StateMessage {
  type: 'state';
  timestamp: number;
  terminals: Record<string, TerminalEntry>;
  token_usage?: TokenUsage;
  orchestrations?: OrchestratorRun[];
}

/**
 * A terminal entry after merging the sidecar's system view with the Rust
 * workspace sessions. `session_id` / `rust_status` are frontend-only fields
 * that link a kanban/card/table entry back to its workspace pane.
 */
export interface UnifiedTerminal extends TerminalEntry {
  session_id?: string;
  rust_status?: string;
}

// ── UI Inspector (Agentation-style) ───────────────────────────────────────────

export type InspectorMode = 'normal' | 'hover' | 'selected' | 'annotating';

export interface InspectedElement {
  id: string;
  domTag: string;
  domId?: string;
  className: string;
  role?: string;
  ariaLabel?: string;
  textContent: string;
  selector: string;
  parentSelector?: string;
  boundingBox: { x: number; y: number; w: number; h: number };
  computedStyles: Record<string, string>;
  attributes: Record<string, string>;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
  /** True only when we found an exact match; false when we guessed or don't know. */
  sourceExact: boolean;
  detectedAt: number;
}

export interface Annotation {
  id: string;
  element: InspectedElement;
  userComment: string;
  createdAt: number;
}

// ── Native Rust Terminal Sessions ─────────────────────────────────────────────
export interface NativeSessionEntry {
  id: string;
  tty: string;
  agent: string;
  cli: string;
  cwd: string;
  status: string; // running | exited | killed | restarting
  title: string;
}
