// tto — Django view (stub implementation)
'use client';

import { useTheme } from '@/contexts/ThemeContext';

export function DjangoView() {
  const { theme: t } = useTheme();
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: t.spacing.md, color: t.colors.text.muted,
    }}>
      <div style={{ fontSize: '48px' }}>🐍</div>
      <h2 style={{ margin: 0, fontSize: t.fontSize.xxl, color: t.colors.text.primary }}>Django Reviewer</h2>
      <p style={{ margin: 0, fontSize: t.fontSize.sm }}>Django project analysis — coming soon</p>
    </div>
  );
}
