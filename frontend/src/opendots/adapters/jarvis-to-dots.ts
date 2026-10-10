import { jarvisManager } from '@/jarvis/agent/JarvisManager';
import { sessionContextStore } from '@/jarvis/contextStore';

export interface DotConfig {
  id: string;
  name: string;
  role: string;
  instructions: string;
  tools: string[];
  terminalId: string;
  workspaceId: string;
  capabilities: string[];
}

/**
 * Generate OpenDots-compatible Dot configurations from TTO's Jarvis agents
 */
export function getDotsFromJarvis(): DotConfig[] {
  const agents = jarvisManager.getAssignedAgents();
  const dots: DotConfig[] = [];

  for (const agent of agents) {
    const terminalId = agent.terminalId;
    const ctx = sessionContextStore.get(terminalId);
    
    if (!ctx) continue;

    // Build instructions based on terminal context
    const projectName = ctx.cwd?.split('/').pop() || 'unknown project';
    const detectedCli = ctx.detectedCli || 'shell';
    const workspaceName = ctx.workspaceName || 'workspace';

    const instructions = `You are Jarvis, an AI developer agent assigned to terminal "${ctx.terminalName || terminalId}" in workspace "${workspaceName}".

**Current Context:**
- Project: ${projectName}
- Working Directory: ${ctx.cwd || 'unknown'}
- Active CLI: ${detectedCli}
- Terminal: ${ctx.terminalName || terminalId}

**Available Tools:**
- execute_command: Run shell commands in the terminal
- send_input: Send keystrokes/input to the terminal
- read_file: Read file contents from the workspace
- write_file: Write files to the workspace
- list_files: List directory contents

**Guidelines:**
- You have full control of the terminal via execute_command and send_input
- Prefer execute_command for shell commands, send_input for interactive input
- Always read files before modifying them
- Report progress by updating your status
- Ask for clarification if the task is ambiguous

**Current Task:** ${agent.workingMemory.task || 'Awaiting task...'}`;

    dots.push({
      id: `dot-${terminalId}`,
      name: ctx.terminalName || `Terminal ${terminalId.slice(0, 8)}`,
      role: 'Developer',
      instructions,
      tools: ['execute_command', 'send_input', 'read_file', 'write_file', 'list_files'],
      terminalId,
      workspaceId: ctx.workspaceId || '',
      capabilities: ['OBSERVE', 'READ', 'EXECUTE', 'CONTROL', 'WRITE']
    });
  }

  return dots;
}

/**
 * Get a specific dot by terminal ID
 */
export function getDotByTerminalId(terminalId: string): DotConfig | null {
  const dots = getDotsFromJarvis();
  return dots.find(d => d.terminalId === terminalId) || null;
}

/**
 * Create a dot config for a new terminal
 */
export function createDotForTerminal(terminalId: string, workspaceId: string, terminalName?: string): DotConfig {
  const ctx = sessionContextStore.get(terminalId);
  
  const projectName = ctx?.cwd?.split('/').pop() || 'unknown project';
  const detectedCli = ctx?.detectedCli || 'shell';
  const workspaceName = ctx?.workspaceName || 'workspace';

  return {
    id: `dot-${terminalId}`,
    name: terminalName || ctx?.terminalName || `Terminal ${terminalId.slice(0, 8)}`,
    role: 'Developer',
    instructions: `You are Jarvis, an AI developer agent assigned to terminal "${terminalName || terminalId}" in workspace "${workspaceName}".

**Current Context:**
- Project: ${projectName}
- Working Directory: ${ctx?.cwd || 'unknown'}
- Active CLI: ${detectedCli}

**Available Tools:**
- execute_command: Run shell commands in the terminal
- send_input: Send keystrokes/input to the terminal
- read_file: Read file contents from the workspace
- write_file: Write files to the workspace
- list_files: List directory contents

**Guidelines:**
- You have full control of the terminal via execute_command and send_input
- Prefer execute_command for shell commands, send_input for interactive input
- Always read files before modifying them
- Report progress by updating your status
- Ask for clarification if the task is ambiguous`,
    tools: ['execute_command', 'send_input', 'read_file', 'write_file', 'list_files'],
    terminalId,
    workspaceId,
    capabilities: ['OBSERVE', 'READ', 'EXECUTE', 'CONTROL', 'WRITE']
  };
}
