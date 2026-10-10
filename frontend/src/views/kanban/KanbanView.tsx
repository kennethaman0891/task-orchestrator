// tto — Kanban view (stub implementation)
'use client';

import { useTheme } from '@/contexts/ThemeContext';
import type { UnifiedTerminal } from '@/types';

interface Props {
  terminals: Record<string, UnifiedTerminal>;
  onToast: (msg: string, error?: boolean) => void;
}

export function KanbanView(_p: Props) {
  const { theme: t } = useTheme();
  void _p;
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: t.spacing.md, color: t.colors.text.muted,
    }}>
      <div style={{ fontSize: '48px' }}>📋</div>
      <h2 style={{ margin: 0, fontSize: t.fontSize.xxl, color: t.colors.text.primary }}>Kanban Board</h2>
      <p style={{ margin: 0, fontSize: t.fontSize.sm }}>Orchestrator view — coming soon</p>
    </div>
  );
}
