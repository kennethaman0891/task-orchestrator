// Developer City — CreateProjectModal: the only way new buildings are born.
// Posts to the registry; the WS feed makes the building appear in the city.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { createProject } from '@/city/api';
import { PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectType } from '@/city/types';

export function CreateProjectModal({
  onClose,
  onCreated,
  onToast,
}: {
  onClose: () => void;
  onCreated?: (path: string) => void;
  onToast?: (msg: string, error?: boolean) => void;
}) {
  const { theme: t } = useTheme();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [type, setType] = useState<ProjectType>('custom');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !path.trim()) {
      onToast?.('Name and path are required', true);
      return;
    }
    setBusy(true);
    try {
      const p = await createProject({ name: name.trim(), path: path.trim(), type });
      onToast?.(`Building plotted for “${p.name}”`);
      onCreated?.(p.path);
      onClose();
    } catch (err) {
      onToast?.(`Create failed: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const field: CSSProperties = {
    width: '100%',
    background: t.colors.bg.input,
    border: `1px solid ${t.colors.border.primary}`,
    borderRadius: 8,
    color: t.colors.text.primary,
    padding: '8px 10px',
    fontSize: 12,
    outline: 'none',
  };

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 340, background: 'rgba(13,16,26,0.98)',
          border: `1px solid ${t.colors.border.primary}`,
          borderRadius: 14, padding: 18,
          color: t.colors.text.primary, fontSize: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>New building</div>
        <div style={{ color: t.colors.text.muted, fontSize: 11 }}>
          A plot is assigned automatically; the archetype follows the project type.
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input style={field} placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={field} placeholder="Project path (folder on this machine)" value={path} onChange={(e) => setPath(e.target.value)} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {PROJECT_TYPES.map((pt) => (
              <button
                key={pt}
                onClick={() => setType(pt)}
                style={{
                  background: type === pt ? t.colors.accent.primary : 'transparent',
                  color: type === pt ? '#fff' : t.colors.text.secondary,
                  border: `1px solid ${type === pt ? t.colors.accent.primary : t.colors.border.primary}`,
                  borderRadius: 7, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                }}
              >
                {PROJECT_TYPE_LABELS[pt]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={submit}
            disabled={busy}
            style={{
              flex: 1, background: t.colors.accent.primary, color: '#fff', border: 'none',
              borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Plotting…' : 'Plot building'}
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1, background: 'transparent', color: t.colors.text.secondary,
              border: `1px solid ${t.colors.border.primary}`, borderRadius: 8,
              padding: '9px 0', fontSize: 12, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
