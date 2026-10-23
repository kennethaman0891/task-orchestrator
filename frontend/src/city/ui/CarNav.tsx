// Developer City — thin bar while the camera is inside a terminal car.
// Exit pops one nav level. The parent flies the camera.

import { useCityStore } from '@/city/store';

export function CarNav() {
  const nav = useCityStore((s) => s.nav);
  const terminalCars = useCityStore((s) => s.terminalCars);
  const exitOneLevel = useCityStore((s) => s.exitOneLevel);

  if (nav.mode !== 'car') return null;

  const car = Object.values(terminalCars).find((c) => c.id === nav.paneId)
    ?? Object.values(terminalCars).find((c) => c.terminalId === nav.terminalId || c.id === nav.terminalId);

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
        gap: 12,
        maxWidth: 'min(440px, calc(100% - 32px))',
        padding: '6px 12px',
        background: 'rgba(15,18,28,0.94)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        backdropFilter: 'blur(12px)',
        color: '#e8edf5',
        fontSize: 12,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {car?.name || 'Car'}
      </span>
      <button
        type="button"
        onClick={exitOneLevel}
        style={{
          flex: 'none',
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: '#93c5fd',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        Exit car
      </button>
    </div>
  );
}
