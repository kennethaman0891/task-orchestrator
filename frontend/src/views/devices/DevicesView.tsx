// tto — Devices view (stub implementation)
'use client';

import { useTheme } from '@/contexts/ThemeContext';

interface Props {
  onToast: (msg: string, error?: boolean) => void;
}

export function DevicesView(_p: Props) {
  const { theme: t } = useTheme();
  void _p;
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: t.spacing.md, color: t.colors.text.muted,
    }}>
      <div style={{ fontSize: '48px' }}>📱</div>
      <h2 style={{ margin: 0, fontSize: t.fontSize.xxl, color: t.colors.text.primary }}>Devices</h2>
      <p style={{ margin: 0, fontSize: t.fontSize.sm }}>Remote access & gateway — coming soon</p>
    </div>
  );
}
