import type { Dot } from '../types/types';
import type { SessionContext } from '@/jarvis/types';

/**
 * Converts a terminal session into an OpenDots-compatible Dot configuration
 * for display and identity in CallView and OpenDots panels.
 */
export function terminalToDot(terminalId: string, context?: SessionContext): Dot {
  const terminalName = context?.terminalName || `Terminal ${terminalId.slice(0, 8)}`;
  const cli = context?.cliName || context?.detectedCli || 'Antigravity';
  const project = context?.cwd ? context.cwd.split('/').pop() || 'project' : 'workspace';

  return {
    id: `dot-${terminalId}`,
    name: `Jarvis · ${cli}`,
    spaceId: context?.workspaceId || 'default',
    spaceIds: context?.workspaceId ? [context.workspaceId] : ['default'],
    instructions: `You are Jarvis, an elite autonomous AI developer agent assigned to terminal "${terminalName}" in project "${project}". Active CLI: ${cli}.`,
    researchAllowed: true,
    memoryAllowed: true,
    createdAt: Date.now(),
    learningContainerId: null,
  };
}
