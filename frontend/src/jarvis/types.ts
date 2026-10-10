// ═══════════════════════════════════════════════════════════════════════════
// JARVIS PER-TERMINAL WORKSTATION — Core Types & Contracts (Phases 1 - 4)
// ═══════════════════════════════════════════════════════════════════════════

export type DetectedCLI =
  | 'antigravity'
  | 'agy'
  | 'cursor'
  | 'codex'
  | 'claude'
  | 'gemini'
  | 'opencode'
  | 'qwen'
  | 'shell'
  | 'unknown'
  | string;

export type TerminalState =
  | 'idle'
  | 'running'
  | 'waiting_for_input'
  | 'error'
  | 'completed';

export type JarvisStatus =
  | 'UNASSIGNED'
  | 'OBSERVING'
  | 'WORKING'
  | 'WAITING'
  | 'NEEDS_APPROVAL'
  | 'ERROR'
  | 'COMPLETED'
  | 'STOPPED';

export type JarvisPermission =
  | 'OBSERVE'
  | 'READ'
  | 'EXECUTE'
  | 'CONTROL';

export type ActivityEventType =
  | 'terminal_started'
  | 'terminal_stopped'
  | 'cli_detected'
  | 'command_started'
  | 'command_completed'
  | 'command_failed'
  | 'session_activity'
  | 'file_read'
  | 'file_modified'
  | 'file_created'
  | 'test_started'
  | 'test_completed'
  | 'build_started'
  | 'build_completed'
  | 'error_detected'
  | 'waiting_for_input'
  | 'workflow_started'
  | 'workflow_completed'
  | 'jarvis_assigned'
  | 'jarvis_action_taken'
  | 'jarvis_voice_received';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  terminalId: string;
  timestamp: number;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionContext {
  terminalId: string;
  workspaceId: string;
  workspaceName: string;
  terminalName: string;
  cwd: string;
  processInfo: {
    pid?: number;
    tty?: string;
    shell?: string;
  };
  detectedCli: DetectedCLI;
  cliName: string;
  sessionStartTimestamp: number;
  lastActivityTimestamp: number;
  elapsedMs: number;
  state: TerminalState;
  currentTaskTitle?: string;
  currentActivity?: string;
  recentCommands: string[];
  recentActivity: string[];
  relevantFiles: string[];
  errors: Array<{ timestamp: number; message: string; code?: number }>;
}

export interface CLIAdapterResult {
  detected: boolean;
  cli: DetectedCLI;
  cliName: string;
  state?: TerminalState;
  taskTitle?: string;
  currentActivity?: string;
  recentAction?: string;
  error?: string;
  waitingForInput?: boolean;
}

export interface ICLIAdapter {
  id: DetectedCLI;
  name: string;
  detect(bufferLines: string[], processCli?: string, ttyAgent?: string): boolean;
  parse(bufferLines: string[], currentContext?: Partial<SessionContext>): CLIAdapterResult;
}

export interface JarvisWorkingMemory {
  project: string;
  cli: string;
  session: string;
  task: string;
  currentState: string;
  currentActivity: string;
  recentActions: string[];
  filesChanged: string[];
  errors: string[];
  nextExpectedAction: string;
  timeline: Array<{
    timestamp: number;
    title: string;
    type: string;
    status?: 'done' | 'running' | 'failed' | 'pending';
  }>;
}

export interface JarvisAgentConfig {
  terminalId: string;
  assignedAt: number;
  status: JarvisStatus;
  permissions: JarvisPermission[];
  workingMemory: JarvisWorkingMemory;
  lastAction?: string;
  pendingApproval?: {
    id: string;
    action: string;
    command?: string;
    description: string;
    timestamp: number;
  };
}

export interface VoiceInstruction {
  text: string;
  mode: 'terminal_specific' | 'global_workstation';
  targetTerminalId?: string;
  confidence?: number;
  intent?: 'continue' | 'run_tests' | 'check_errors' | 'pause' | 'stop' | 'switch_view' | 'custom';
}
