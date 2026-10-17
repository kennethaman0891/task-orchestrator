// tto — Cards view (integrated WorkspaceTaskCenter)
'use client';

import type { UnifiedTerminal } from '@/types';
import type { Workspace } from '@/lib/workspace';
import { WorkspaceTaskCenter } from '@/components/WorkspaceTaskCenter';

interface Props {
  workspaces: Workspace[];
  terminals: Record<string, UnifiedTerminal>;
  activeId: string;
  onToast: (msg: string, error?: boolean) => void;
  attachableSessions?: { id: string; label: string }[];
  onAttach?: (wsId: string, paneId: string, sessionId: string) => void;
  onOpenNew?: (wsId: string, paneId: string) => void;
  onCreate?: () => void;
}

export function CardsView(props: Props) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <WorkspaceTaskCenter {...props} />
    </div>
  );
}
