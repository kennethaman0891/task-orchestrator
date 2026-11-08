// ═══════════════════════════════════════════════════════════════════════════
// AgentView — Primary Host for Qwen Prime Orchestrator Studio
// ═══════════════════════════════════════════════════════════════════════════
'use client';

import type { Workspace } from '@/lib/workspace';
import type { UnifiedTerminal } from '@/types';
import { QwenPrimeStudio } from './QwenPrimeStudio';

interface Props {
  projectPath?: string;
  workspaces: Workspace[];
  terminals?: Record<string, UnifiedTerminal>;
  activeId?: string;
  sidecarConnected?: boolean;
  onToast: (msg: string, error?: boolean) => void;
}

export function AgentView({
  projectPath,
  workspaces,
  terminals = {},
  activeId,
  sidecarConnected,
  onToast,
}: Props) {
  return (
    <QwenPrimeStudio
      projectPath={projectPath}
      workspaces={workspaces}
      terminals={terminals}
      activeId={activeId}
      sidecarConnected={sidecarConnected}
      onToast={onToast}
    />
  );
}
