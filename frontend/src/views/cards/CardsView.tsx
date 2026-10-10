// tto — Cards view (stub implementation)
'use client';

import { useTheme } from '@/contexts/ThemeContext';
import type { UnifiedTerminal } from '@/types';
import type { Workspace } from '@/lib/workspace';

interface Props {
  workspaces: Workspace[];
  terminals: Record<string, UnifiedTerminal>;
  activeId: string;
  onToast: (msg: string, error?: boolean) => void;
}

export function CardsView(_p: Props) {
  const { theme: t } = useTheme();
  void _p;
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: t.spacing.md, color: t.colors.text.muted,
    }}>
      <div style={{ fontSize: '48px' }}>🗂️</div>
      <h2 style={{ margin: 0, fontSize: t.fontSize.xxl, color: t.colors.text.primary }}>Task Center</h2>
      <p style={{ margin: 0, fontSize: t.fontSize.sm }}>Task management — coming soon</p>
    </div>
  );
}
