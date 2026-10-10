// Developer City — FloorNav: interior floor navigation overlay.
// CITY → PROJECT → BUILDING → FLOOR → ROOM → WORKSPACE, with a history
// stack (exit pops one level).

import type { ReactNode } from 'react';
import { useCityStore } from '@/city/store';
import { useTheme } from '@/contexts/ThemeContext';
import { floorName } from '@/city/scene/Interior';
import { interiorTarget } from '@/city/scene/CameraRig';
import { archetypeFor } from '@/city/scene/archetypes';

export function FloorNav({ onExitToWorkspace }: { onExitToWorkspace?: () => void }) {
  const { theme: t } = useTheme();
  const nav = useCityStore((s) => s.nav);
  const projects = useCityStore((s) => s.projects);
  const goInterior = useCityStore((s) => s.goInterior);
  const exitOneLevel = useCityStore((s) => s.exitOneLevel);
  const setCameraTarget = useCityStore((s) => s.setCameraTarget);

  if (nav.mode !== 'interior') return null;
  const p = projects[nav.projectId];
  if (!p) return null;

  const floorCount = (p.floors?.length) || 1;
  const base = archetypeFor(p.building.buildingStyle || p.type, p.type);
  const scaleK = Math.max(0.4, Math.min(2.2, p.building.scale || 1));

  const flyToFloor = (i: number) => {
    goInterior(p.id, i, nav.room);
    setCameraTarget(interiorTarget(p.plot, i, base.floorH * scaleK, base.depth * scaleK));
  };

  const chip = (label: string, onClick: () => void, active = false): ReactNode => (
    <button
      key={label}
      onClick={onClick}
      style={{
        background: active ? t.colors.accent.primary : 'transparent',
        color: active ? '#fff' : t.colors.text.secondary,
        border: `1px solid ${active ? t.colors.accent.primary : t.colors.border.primary}`,
        borderRadius: 7, padding: '3px 9px', fontSize: 11, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center',
      background: 'rgba(10,12,20,0.9)', border: `1px solid ${t.colors.border.primary}`,
      borderRadius: 10, padding: '8px 12px', zIndex: 24, maxWidth: '92%',
    }}>
      <span style={{ fontSize: 11, color: t.colors.text.muted, marginRight: 4 }}>FLOOR</span>
      {Array.from({ length: floorCount }, (_, i) =>
        chip(floorName(p, i), () => flyToFloor(i), nav.floorIndex === i))}
      <span style={{ width: 1, height: 16, background: t.colors.border.primary, margin: '0 4px' }} />
      {chip('▲ up', () => flyToFloor(Math.min(floorCount - 1, nav.floorIndex + 1)))}
      {chip('▼ down', () => flyToFloor(Math.max(0, nav.floorIndex - 1)))}
      <span style={{ width: 1, height: 16, background: t.colors.border.primary, margin: '0 4px' }} />
      {chip('exit building', exitOneLevel)}
      {onExitToWorkspace ? chip('workspace →', () => onExitToWorkspace()) : null}
    </div>
  );
}
