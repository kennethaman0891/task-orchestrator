// Developer City — top bar while the camera is inside a terminal car.
// Exit pops one nav level. View buttons switch between Cockpit, Driver POV, and Follow camera.

import { useState } from 'react';
import { useCityStore } from '@/city/store';
import { carCabinTarget } from '@/city/scene/CameraRig';
import { carLocalTransform } from '@/city/scene/TerminalCars';

export function CarNav({
  onToggleTerminal,
  hasTerminalOpen = false,
}: {
  onToggleTerminal?: () => void;
  hasTerminalOpen?: boolean;
} = {}) {
  const nav = useCityStore((s) => s.nav);
  const terminalCars = useCityStore((s) => s.terminalCars);
  const projects = useCityStore((s) => s.projects);
  const plotDistricts = useCityStore((s) => s.plotDistricts);
  const setCameraTarget = useCityStore((s) => s.setCameraTarget);
  const exitOneLevel = useCityStore((s) => s.exitOneLevel);

  const [activePreset, setActivePreset] = useState<'cockpit' | 'driver' | 'chase'>('cockpit');

  if (nav.mode !== 'car') return null;

  const car = Object.values(terminalCars).find((c) => c.id === nav.paneId)
    ?? Object.values(terminalCars).find((c) => c.terminalId === nav.terminalId || c.id === nav.terminalId);

  const switchView = (preset: 'cockpit' | 'driver' | 'chase') => {
    setActivePreset(preset);
    if (!car) return;
    const project = projects[car.projectId];
    if (!project) return;
    const dirs = plotDistricts[car.projectId]?.dirs ?? [];
    const transform = carLocalTransform(car, project, dirs);
    setCameraTarget(carCabinTarget(project.plot, transform, preset));
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 108,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 26,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 'min(620px, calc(100% - 32px))',
        padding: '6px 14px',
        background: 'rgba(11,15,25,0.95)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12,
        backdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        color: '#e8edf5',
        fontSize: 12,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: car?.moving ? '#10b981' : '#06b6d4',
            boxShadow: `0 0 8px ${car?.moving ? '#10b981' : '#06b6d4'}`,
            flexShrink: 0,
          }}
        />
        <span>{car?.name || 'Cyber Vehicle'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '2px 4px' }}>
        <button
          type="button"
          onClick={() => switchView('cockpit')}
          style={{
            background: activePreset === 'cockpit' ? 'rgba(6,182,212,0.25)' : 'transparent',
            border: activePreset === 'cockpit' ? '1px solid #06b6d4' : '1px solid transparent',
            color: activePreset === 'cockpit' ? '#67e8f9' : '#94a3b8',
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
          title="Passenger seat cockpit perspective"
        >
          Cockpit
        </button>
        <button
          type="button"
          onClick={() => switchView('driver')}
          style={{
            background: activePreset === 'driver' ? 'rgba(6,182,212,0.25)' : 'transparent',
            border: activePreset === 'driver' ? '1px solid #06b6d4' : '1px solid transparent',
            color: activePreset === 'driver' ? '#67e8f9' : '#94a3b8',
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
          title="Driver POV behind steering wheel"
        >
          Driver
        </button>
        <button
          type="button"
          onClick={() => switchView('chase')}
          style={{
            background: activePreset === 'chase' ? 'rgba(6,182,212,0.25)' : 'transparent',
            border: activePreset === 'chase' ? '1px solid #06b6d4' : '1px solid transparent',
            color: activePreset === 'chase' ? '#67e8f9' : '#94a3b8',
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
          title="Third-person follow / orbit view"
        >
          Follow
        </button>
      </div>

      {onToggleTerminal && (
        <button
          type="button"
          onClick={onToggleTerminal}
          style={{
            flex: 'none',
            background: hasTerminalOpen ? 'rgba(59,130,246,0.25)' : 'transparent',
            border: hasTerminalOpen ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.18)',
            borderRadius: 6,
            padding: '3px 9px',
            color: hasTerminalOpen ? '#93c5fd' : '#e8edf5',
            font: 'inherit',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {hasTerminalOpen ? 'Hide Terminal' : 'Open Terminal'}
        </button>
      )}

      <button
        type="button"
        onClick={exitOneLevel}
        style={{
          flex: 'none',
          background: 'transparent',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 6,
          padding: '3px 8px',
          color: '#f87171',
          font: 'inherit',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Exit car
      </button>
    </div>
  );
}
