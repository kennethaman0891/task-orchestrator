/**
 * Bridge voice pipeline to TTO terminal system.
 * Routes voice commands to Jarvis agent or direct terminal execution.
 */

// Import types for the terminal/Jarvis system
// These would come from the actual TTO frontend modules

export interface VoiceTerminalBridge {
  terminalId: string;
  mode: 'jarvis' | 'direct';
}

export interface VoiceCommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Execute a voice command in the specified terminal.
 * If mode is 'jarvis', sends to Jarvis agent.
 * If mode is 'direct', writes directly to terminal PTY.
 */
export async function executeVoiceCommand(
  bridge: VoiceTerminalBridge, 
  command: string
): Promise<VoiceCommandResult> {
  const { terminalId, mode } = bridge;
  
  try {
    if (mode === 'jarvis') {
      // Import JarvisManager dynamically to avoid circular deps
      const { jarvisManager } = await import('@/jarvis/agent/JarvisManager');
      
      const agent = jarvisManager.getAgent(terminalId);
      if (agent.status === 'UNASSIGNED') {
        await jarvisManager.assignAgent(terminalId, ['OBSERVE', 'READ', 'EXECUTE', 'CONTROL', 'WRITE']);
      }
      await jarvisManager.assignTask(terminalId, command);
      
      return { success: true, output: `Sent to Jarvis: ${command}` };
    } else {
      // Direct terminal execution
      const { TerminalManager } = await import('@/terminal/TerminalManager');
      await TerminalManager.write(terminalId, `${command}
`);
      
      // Update context
      const { sessionContextStore } = await import('@/jarvis/contextStore');
      const ctx = sessionContextStore.get(terminalId);
      if (ctx) {
        ctx.currentActivity = `Voice: ${command}`;
        ctx.recentActivity.unshift(`Voice executed: ${command}`);
        if (ctx.recentActivity.length > 10) ctx.recentActivity.pop();
      }
      
      return { success: true, output: `Executed in terminal: ${command}` };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}

/**
 * Process voice transcript with terminal context.
 * Builds an enhanced prompt that includes terminal/workspace context.
 */
export async function processVoiceWithContext(
  terminalId: string,
  transcript: string,
  mode: 'jarvis' | 'direct' = 'jarvis'
): Promise<string> {
  const { sessionContextStore } = await import('@/jarvis/contextStore');
  const ctx = sessionContextStore.get(terminalId);
  
  const contextInfo = ctx ? `
Current terminal: ${ctx.terminalName || terminalId}
Workspace: ${ctx.workspaceName || 'unknown'}
Project: ${ctx.cwd?.split('/').pop() || 'unknown'}
CLI: ${ctx.detectedCli || 'shell'}
Recent activity: ${ctx.recentActivity.slice(0, 3).join('; ')}
` : '';
  
  const enhancedPrompt = `${contextInfo}

User said: "${transcript}"

Execute this as a terminal command or task. Return only the command to run, or a brief response if it's a question.`;
  
  return enhancedPrompt;
}

/**
 * Voice command processor - handles special voice commands
 * like "stop", "repeat", "explain", etc.
 */
export function preprocessVoiceCommand(transcript: string): {
  command: string;
  isSpecial: boolean;
  specialAction?: 'stop' | 'repeat' | 'explain' | 'cancel';
} {
  const lower = transcript.toLowerCase().trim();
  
  // Special voice commands
  if (lower === 'stop' || lower === 'cancel' || lower === 'abort') {
    return { command: '', isSpecial: true, specialAction: 'stop' };
  }
  
  if (lower === 'repeat' || lower === 'say again') {
    return { command: '', isSpecial: true, specialAction: 'repeat' };
  }
  
  if (lower.startsWith('explain ')) {
    return { command: lower, isSpecial: true, specialAction: 'explain' };
  }
  
  return { command: transcript, isSpecial: false };
}

/**
 * Format voice response for TTS - strip markdown, keep concise
 */
export function formatForTTS(text: string): string {
  return text
    // Remove markdown code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown formatting
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove headers
    .replace(/^#+\s+/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // Remove URLs
    .replace(/https?:\/\/\S+/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
