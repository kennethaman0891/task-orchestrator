// TTO-specific AG-UI type extensions
// Re-exports AG-UI core types and adds TTO-specific event types

export * from '@ag-ui/core';

// TTO Terminal events mapped to AG-UI
export interface TTOTerminalEvent {
  type: 'terminal_output' | 'terminal_resize' | 'terminal_exit' | 'terminal_created';
  terminalId: string;
  data?: string;  // For output
  cols?: number;
  rows?: number;
  workspaceId?: string;
  label?: string;
}

// TTO Jarvis agent events mapped to AG-UI
export interface TTOJarvisEvent {
  type: 'jarvis_status' | 'jarvis_task' | 'jarvis_action' | 'jarvis_approval' | 'jarvis_tool_call';
  terminalId: string;
  agentStatus?: 'UNASSIGNED' | 'OBSERVING' | 'WORKING' | 'WAITING' | 'ERROR' | 'NEEDS_APPROVAL';
  task?: string;
  action?: string;
  approvalId?: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    id: string;
  };
  toolResult?: {
    toolCallId: string;
    result: unknown;
    error?: string;
  };
}

// TTO Workspace context for AG-UI
export interface TTOWorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  projectPath: string;
  activeTerminals: string[];
}

// Adapter configuration
export interface TTOAGUIAdapterConfig {
  terminalManager: any;  // TerminalManager instance
  jarvisManager: any;    // JarvisManager instance
  sessionContextStore: any;  // sessionContextStore instance
  onToolCall?: (terminalId: string, toolCall: any) => Promise<void>;
  onSendMessage?: (terminalId: string, message: string) => Promise<void>;
}
