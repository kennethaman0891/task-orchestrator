// ── Agent Workspace Types ───────────────────────────────────────────────────

/**
 * Normalized agent event model.
 * The UI renders against this — not raw OpenCode output.
 * This decoupling lets us swap agent engines later.
 */
export type AgentEventType =
  | 'message' // User or agent text
  | 'thinking' // Agent reasoning/thinking tokens
  | 'tool_call' // Agent calling a tool (bash, read, write, etc.)
  | 'tool_result' // Result of a tool call
  | 'file_read' // File being read
  | 'file_write' // File being written
  | 'diff' // Diff preview
  | 'permission' // Permission request
  | 'todo_update' // Todo/progress list update
  | 'error' // Error state
  | 'handoff' // Agent-to-agent handoff
  | 'completed' // Session completed
  | 'started' // Session started
  | 'streaming'; // Streaming token (intermediate)

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  timestamp: number;
  sessionId: string;
  agentId?: string;
  content?: string;
  /** For tool calls: tool name and input */
  tool?: {
    name: string;
    input?: Record<string, unknown>;
    output?: string;
    error?: string;
  };
  /** For file ops */
  file?: {
    path: string;
    content?: string;
    diff?: string;
  };
  /** For handoffs */
  handoff?: AgentHandoff;
  /** For todos */
  todos?: TodoItem[];
  /** For streaming */
  delta?: string;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface AgentHandoff {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  task: string;
  context?: string;
  parentSessionId?: string;
  parentMessageId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
}

/** A session is one conversation with an agent. */
export interface AgentSession {
  id: string;
  title: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentEvent[];
  todos: TodoItem[];
  status: 'idle' | 'running' | 'completed' | 'error';
  model?: string;
  /** OpenCode session ID (for attaching to existing sessions) */
  opencodeSessionId?: string;
  /** Working directory */
  cwd?: string;
  /**
   * OpenCode server part ids already consumed by the LIVE stream. Used to
   * dedupe archive rehydration (syncSessionMessages) against parts that were
   * already parsed in real time — without it, revisiting a session after a
   * tab switch duplicates every event.
   *
   * Stored as a `Set` reference shared across session object copies (emitEvent
   * spreads the session), so it accumulates in place.
   */
  serverPartIds?: Set<string>;
}

/** An agent is a configured AI role/model. */
export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt?: string;
  icon: string;
  color: string;
  status: 'idle' | 'running' | 'offline';
}

/** Current app state for the Agent Workspace. */
export interface AgentWorkspaceState {
  agents: Agent[];
  sessions: AgentSession[];
  activeSessionId: string | null;
  activeAgentId: string | string;
  isStreaming: boolean;
  error: string | null;
}
