'use client';

import { useTheme } from '@/contexts/ThemeContext';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface ToastState {
  message: string;
  error: boolean;
}

interface Props {
  toast: ToastState | null;
}

export function ToastContainer({ toast }: Props) {
  const { theme: t } = useTheme();
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<ToastState | null>(null);

  useEffect(() => {
    if (toast) {
      setCurrent(toast);
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 3500);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [toast]);

  if (!current) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: t.spacing.xl,
      right: t.spacing.xl,
      zIndex: 600,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(10px)',
      transition: `all ${t.transition.normal}`,
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      <div style={{
        background: current.error ? t.colors.danger.primary : t.colors.bg.elevated,
        border: `1px solid ${current.error ? t.colors.danger.primary : t.colors.border.primary}`,
        borderRadius: t.borderRadius.lg,
        padding: `${t.spacing.sm} ${t.spacing.md}`,
        fontSize: t.fontSize.sm,
        color: '#ffffff',
        boxShadow: t.shadow.lg,
        display: 'flex',
        alignItems: 'center',
        gap: t.spacing.sm,
        maxWidth: '400px',
      }}>
        <span>{current.message}</span>
        <button
          onClick={() => setVisible(false)}
          style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer', padding: '2px', display: 'flex',
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
