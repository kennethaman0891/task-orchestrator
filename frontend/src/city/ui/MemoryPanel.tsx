// Nero — recall overlay. Same hits in the 3D city and the 2D fallback.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useCityStore } from '@/city/store';
import { recallMemory } from '@/city/api';

function sourceLabel(source: string): string {
  if (source === 'git_commit') return 'Commit';
  if (source === 'terminal_task') return 'Terminal';
  return source;
}

function when(ts: number): string {
  if (!ts) return '';
  const ms = ts > 10_000_000_000 ? ts : ts * 1000;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function MemoryPanel() {
  const { theme: t } = useTheme();
  const open = useCityStore((s) => s.memoryOpen);
  const floor = useCityStore((s) => s.memoryFloor);
  const hits = useCityStore((s) => s.memoryHits);
  const setMemoryHits = useCityStore((s) => s.setMemoryHits);
  const closeMemory = useCityStore((s) => s.closeMemory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectId = floor?.projectId ?? null;
  const floorIndex = floor?.floorIndex ?? null;

  useEffect(() => {
    if (!open || !projectId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    recallMemory(projectId, floorIndex)
      .then((res) => {
        if (alive) setMemoryHits(res.hits || []);
      })
      .catch(() => {
        if (alive) setError('Memory recall failed');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [open, projectId, floorIndex, setMemoryHits]);

  if (!open || !floor) return null;

  const title = floor.floorIndex === null
    ? 'Building memory'
    : `Floor ${floor.floorIndex + 1} · 30 days`;

  const panel: CSSProperties = {
    position: 'absolute',
    top: 64,
    right: 14,
    zIndex: 32,
    width: 320,
    maxHeight: 'min(420px, calc(100% - 120px))',
    overflow: 'auto',
    background: 'rgba(9, 13, 22, 0.94)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 14,
    boxShadow: '0 16px 36px rgba(0,0,0,0.65)',
    color: t.colors.text.primary,
    fontFamily: 'system-ui, sans-serif',
    padding: 12,
  };

  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>{title}</div>
        <button
          type="button"
          onClick={closeMemory}
          title="Close memory"
          style={{
            background: 'transparent',
            border: 'none',
            color: t.colors.text.muted,
            cursor: 'pointer',
            display: 'flex',
            padding: 2,
          }}
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: t.colors.text.muted }}>
        Commits and terminal tasks near this floor.
      </div>
      {loading && (
        <div style={{ marginTop: 12, fontSize: 12, color: t.colors.text.muted }}>Looking up…</div>
      )}
      {error && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#fca5a5' }}>{error}</div>
      )}
      {!loading && !error && hits.length === 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: t.colors.text.muted }}>
          No episodes in the last 30 days.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {hits.map((hit) => (
          <div
            key={hit.id}
            style={{
              border: `1px solid ${t.colors.border.primary}`,
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10 }}>
              <span style={{ color: '#93c5fd', fontWeight: 700 }}>{sourceLabel(hit.source)}</span>
              <span style={{ color: t.colors.text.muted }}>{when(hit.ts)}</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.35 }}>{hit.summary}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
