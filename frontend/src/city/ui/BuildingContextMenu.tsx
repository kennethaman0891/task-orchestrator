// Developer City — BuildingContextMenu: right-click/long-press menu on a building.
// Shows quick actions: rename, color palette, building type, continue, new session, edit.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { patchProject } from '@/city/api';
import { projectDisplayName, PROJECT_TYPES, PROJECT_TYPE_LABELS, type Project } from '@/city/types';

interface BuildingContextMenuProps {
  project: Project;
  onClose: () => void;
  onToast?: (msg: string, error?: boolean) => void;
  onContinue?: (p: Project) => void;
  onNewSession?: (p: Project) => void;
  onEditBuilding?: (p: Project) => void;
  /** Screen position to anchor the menu */
  screenPos?: { x: number; y: number } | null;
}

export function BuildingContextMenu({
  project,
  onClose,
  onToast,
  onContinue,
  onNewSession,
  onEditBuilding,
  screenPos,
}: BuildingContextMenuProps) {
  const { theme: t } = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(project.name);
  const [buildingStyle, setBuildingStyle] = useState(project.building.buildingStyle || project.type);
  const [palette, setPalette] = useState<(string | null)[]>(() => {
    const cur = project.building.palette;
    if (cur && cur.length === 8) return [...cur];
    const filled = Array.isArray(cur) ? [...cur] : [];
    while (filled.length < 8) filled.push(null);
    return filled.slice(0, 8);
  });
  const [saving, setSaving] = useState(false);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Position the menu
  useEffect(() => {
    if (screenPos && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 8;
      const maxY = window.innerHeight - rect.height - 8;
      menuRef.current.style.left = `${Math.min(screenPos.x, maxX)}px`;
      menuRef.current.style.top = `${Math.min(screenPos.y, maxY)}px`;
    }
  }, [screenPos]);

  const saveChanges = async () => {
    setSaving(true);
    try {
      await patchProject(project.id, {
        name: name.trim() || projectDisplayName(project),
        building: { ...project.building, buildingStyle, palette },
      });
      onToast?.(`Building config saved for "${name.trim() || projectDisplayName(project)}"`);
      onClose();
    } catch (err) {
      onToast?.(`Save failed: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setSaving(false);
    }
  };

  const PALETTE_SLOTS = [
    'facade', 'plinth', 'glass', 'accent',
    'lit glow', 'plaza ring', 'sign bg', 'trim',
  ] as const;

  const panel: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    minWidth: 260,
    maxHeight: '80vh',
    overflowY: 'auto',
    background: 'rgba(10,12,20,0.96)',
    border: `1px solid ${t.colors.border.primary}`,
    borderRadius: 10,
    backdropFilter: 'blur(12px)',
    color: t.colors.text.primary,
    zIndex: 100,
    padding: 12,
    fontSize: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  };

  const label: CSSProperties = { color: t.colors.text.muted, fontSize: 11, letterSpacing: 0.5 };

  return (
    <div ref={menuRef} style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Building: {projectDisplayName(project)}</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      <div style={{ ...label, marginTop: 8 }}>BUILDING TYPE</div>
      <select
        value={buildingStyle}
        onChange={(e) => setBuildingStyle(e.target.value)}
        style={{
          width: '100%', marginTop: 4, background: t.colors.bg.tertiary,
          border: `1px solid ${t.colors.border.primary}`, borderRadius: 6,
          color: t.colors.text.primary, fontSize: 12, padding: '6px 8px',
        }}
      >
        {PROJECT_TYPES.map((type) => (
          <option key={type} value={type}>{PROJECT_TYPE_LABELS[type]}</option>
        ))}
      </select>

      <div style={{ ...label, marginTop: 10 }}>BUILDING NAME</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Building name"
        style={{
          width: '100%', marginTop: 4, background: t.colors.bg.tertiary,
          border: `1px solid ${t.colors.border.primary}`, borderRadius: 6,
          color: t.colors.text.primary, fontSize: 12, padding: '6px 8px',
        }}
      />

      <div style={{ ...label, marginTop: 10 }}>
        8-COLOR PALETTE <span style={{ opacity: 0.6 }}>— click a swatch to edit</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {PALETTE_SLOTS.map((slot, i) => (
          <div key={slot} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <input
              type="color"
              value={palette[i] || '#4f8ff7'}
              onChange={(e) =>
                setPalette((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
              }
              style={{
                width: 36, height: 36, border: 'none', borderRadius: 6,
                background: 'transparent', cursor: 'pointer',
                opacity: palette[i] ? 1 : 0.4,
                boxShadow: palette[i] ? 'none' : 'inset 0 0 0 1px rgba(255,255,255,0.2)',
              }}
              title={palette[i] ? slot : `${slot} (unset)`}
            />
            <span style={{ fontSize: 9, color: t.colors.text.muted }}>{slot}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${t.colors.border.primary}` }}>
        <button
          onClick={saveChanges}
          disabled={saving}
          style={{
            flex: 1, background: t.colors.accent.primary, color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={() => { onContinue?.(project); onClose(); }}
          style={{ flex: 1, background: t.colors.accent.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          Continue
        </button>
        <button
          onClick={() => { onNewSession?.(project); onClose(); }}
          style={{ flex: 1, background: 'transparent', color: t.colors.text.primary, border: `1px solid ${t.colors.border.primary}`, borderRadius: 6, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          New Session
        </button>
      </div>

      <button
        onClick={() => { onEditBuilding?.(project); onClose(); }}
        style={{
          width: '100%', marginTop: 8, background: 'transparent', color: t.colors.text.secondary,
          border: `1px solid ${t.colors.border.primary}`, borderRadius: 6, padding: '8px 0',
          fontSize: 11, cursor: 'pointer',
        }}
      >
        Open full editor →
      </button>
    </div>
  );
}