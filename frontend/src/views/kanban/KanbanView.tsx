// tto — Kanban view (integrated KanbanBoard)
'use client';

import type { UnifiedTerminal } from '@/types';
import type { Workspace } from '@/lib/workspace';
import { KanbanBoard } from '@/components/KanbanBoard';

interface Props {
  terminals: Record<string, UnifiedTerminal>;
  onToast: (msg: string, error?: boolean) => void;
  workspaces?: Workspace[];
  activeId?: string;
}

export function KanbanView(props: Props) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <KanbanBoard {...props} />
    </div>
  );
}
