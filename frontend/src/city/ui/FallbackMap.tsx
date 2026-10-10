// Developer City — 2D fallback: no WebGL? The city still exists as a
// top-down card grid with the same click/panel behavior. Same store,
// same data — only the renderer changes.

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { useCityStore, visibleProjectIds } from '@/city/store';
import { projectDisplayName, type Project } from '@/city/types';
import { GRID_SIZE } from '@/city/scene/CityGrid';
import { themeById } from '@/city/themes';

export function FallbackMap({
  onContinue,
  onEditBuilding,
}: {
  onContinue: (p: Project) => void;
  onEditBuilding: (p: Project) => void;
}) {
  const { theme: t } = useTheme();
  const projects = useCityStore((s) => s.projects);
  const order = useCityStore((s) => s.projectOrder);
  const filters = useCityStore((s) => s.filters);
  const selected = useCityStore((s) => s.selectedProjectId);
  const selectProject = useCityStore((s) => s.selectProject);
  const activeWorkspacePath = useCityStore((s) => s.activeWorkspacePath);

  const visible = useMemo(
    () => visibleProjectIds(projects, order, filters).map((id) => projects[id]).filter(Boolean),
    [projects, order, filters],
  );

  const cell = 92; // px per plot card

  const wrap: CSSProperties = {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: t.colors.bg.primary, overflow: 'auto',
  };

  const grid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${GRID_SIZE}, ${cell}px)`,
    gap: 4,
    padding: 24,
  };

  const cardFor = (p: Project): CSSProperties => {
    const th = themeById(p.building.theme);
    return {
      width: cell, height: cell * 0.72,
      background: `linear-gradient(${135 + (p.building.rotation || 0)}deg, ${th.facade} 30%, ${th.facadeDark})`,
      border: selected === p.id ? `2px solid ${th.accent}` : `1px solid ${t.colors.border.primary}`,
      borderRadius: 8,
      color: '#fff',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      padding: 6,
      fontSize: 10,
      cursor: 'pointer',
      opacity: p.status === 'archived' ? 0.45 : 1,
      position: 'relative',
      minHeight: 44,
    };
  };

  return (
    <div style={wrap}>
      <div style={grid}>
        {visible.map((p) => {
          const active = p.status === 'active' && p.health !== 'failed';
          return (
            <div
              key={p.id}
              style={cardFor(p)}
              title={p.path || p.name}
              onClick={(e) => { e.stopPropagation(); selectProject(p.id); }}
              onDoubleClick={() => onContinue(p)}
            >
              {active && (
                <span style={{ position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: '50%', background: p.health === 'failed' ? '#f43f5e' : '#22c55e' }} />
              )}
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {projectDisplayName(p)}
              </div>
              <div style={{ opacity: 0.7, fontSize: 9 }}>{p.type}</div>
              {!!activeWorkspacePath && activeWorkspacePath === p.path && (
                <div style={{
                  marginTop: 3, display: 'inline-block', maxWidth: '100%',
                  padding: '1px 6px', borderRadius: 999, fontSize: 8, letterSpacing: 0.5,
                  background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.6)',
                  color: '#4ade80', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  ● current
                </div>
              )}
            </div>
          );
        })}
      </div>
      {visible.length === 0 && (
        <div style={{ position: 'absolute', color: t.colors.text.muted, fontSize: 13 }}>
          No projects yet — create one to light up the city.
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 10, left: 12, fontSize: 10, color: t.colors.text.muted,
      }}>
        2D view (WebGL unavailable) · single click: panel · double click: continue
      </div>
      {/* panel reuse happens in the city view; cards are enough here + edit shortcut */}
      {selected && projects[selected] && (
        <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 6 }}>
          <button
            onClick={() => onContinue(projects[selected])}
            style={{ background: t.colors.accent.primary, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            Continue
          </button>
          <button
            onClick={() => onEditBuilding(projects[selected])}
            style={{ background: 'transparent', color: t.colors.text.secondary, border: `1px solid ${t.colors.border.primary}`, borderRadius: 7, padding: '6px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            Edit building
          </button>
        </div>
      )}
    </div>
  );
}
