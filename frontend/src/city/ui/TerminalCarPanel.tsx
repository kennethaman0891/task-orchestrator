// Developer City — card for the selected terminal car.
// One card: identity, task, color, rename, enter / open terminal.

import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCityStore } from '@/city/store';
import { requestCityCarSpec } from '@/city/api';
import { parseCarSpec } from '@/city/scene/carSpec';
import { saveCarColor } from '@/city/sync/terminalCarSync';
import type { TerminalCar } from '@/city/types';

const CAR_COLORS: { value: string; label: string }[] = [
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#e11d48', label: 'Red' },
  { value: '#f8fafc', label: 'White' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#10b981', label: 'Green' },
  { value: '#f97316', label: 'Orange' },
  { value: '#fbbf24', label: 'Yellow' },
];

const MUTED = 'rgba(232,237,245,0.55)';

function colorChoice(color: string): string {
  const named = CAR_COLORS.find((c) => c.value.toLowerCase() === color.toLowerCase());
  if (named) return named.value;
  if (color.toLowerCase() === 'workspace') return 'workspace';
  return color;
}

const field: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  color: '#e8edf5',
  font: 'inherit',
  padding: '7px 8px',
  outline: 'none',
};

export function TerminalCarPanel({
  onOpenTerminal,
  onEnter,
  onRename,
}: {
  onOpenTerminal: (terminalId: string) => void;
  onEnter: (carId: string) => void;
  onRename: (carId: string, name: string) => void;
}) {
  const selectedTerminalCarId = useCityStore((s) => s.selectedTerminalCarId);
  const terminalCars = useCityStore((s) => s.terminalCars);
  const car = selectedTerminalCarId ? terminalCars[selectedTerminalCarId] : undefined;
  if (!car) return null;

  const agentLine = [car.agentName, car.modelName]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  const task = car.currentTask?.description?.trim() || '';

  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        bottom: 16,
        width: 300,
        boxSizing: 'border-box',
        zIndex: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: 'rgba(15,18,28,0.94)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 16,
        color: '#e8edf5',
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{car.name}</div>

      {agentLine ? (
        <div style={{ color: MUTED, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agentLine}
        </div>
      ) : null}

      <div style={{ color: task ? '#e8edf5' : MUTED, lineHeight: 1.45, wordBreak: 'break-word' }}>
        {task || 'No current task'}
      </div>

      <ColorField key={car.id} car={car} />
      <ShapeField carId={car.id} />

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: MUTED, fontSize: 11 }}>Rename</span>
        <input
          key={car.id}
          defaultValue={car.name}
          aria-label="Rename car"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(car.id, e.currentTarget.value);
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
          style={field}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => onEnter(car.id)}
          style={{
            flex: 1,
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 10px',
            font: 'inherit',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Enter car
        </button>
        <button
          type="button"
          onClick={() => onOpenTerminal(car.terminalId)}
          style={{
            flex: 1,
            background: 'transparent',
            color: '#e8edf5',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 8,
            padding: '8px 10px',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          Open terminal
        </button>
      </div>
    </div>
  );
}

function ColorField({ car }: { car: TerminalCar }) {
  const projects = useCityStore((s) => s.projects);
  const [value, setValue] = useState(() => colorChoice(car.color));
  const listed = CAR_COLORS.some((c) => c.value === value) || value === 'workspace';

  const onChange = (next: string, select: HTMLSelectElement) => {
    if (next !== 'workspace') {
      setValue(next);
      saveCarColor(car.id, next);
      return;
    }
    // saveCarColor stores a paint hex. "workspace" is not one, so use the
    // building primary; with no hex, leave the saved color alone.
    const primary = (projects[car.projectId]?.building.primaryColor ?? '').trim();
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(primary)) {
      select.value = value;
      return;
    }
    setValue('workspace');
    saveCarColor(car.id, primary);
  };

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: MUTED, fontSize: 11 }}>Color</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value, e.target)}
        style={{ ...field, cursor: 'pointer' }}
      >
        {CAR_COLORS.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
        <option value="workspace">Workspace</option>
        {!listed && <option value={value}>{value}</option>}
      </select>
    </label>
  );
}

const textBtn: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: '#93c5fd',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

function ShapeField({ carId }: { carId: string }) {
  const spec = useCityStore((s) => s.carSpecs[carId]);
  const setCarSpec = useCityStore((s) => s.setCarSpec);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const applyText = (text: string) => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      setNote('That file is not JSON.');
      return;
    }
    const parsed = parseCarSpec(json);
    if (!parsed.spec) {
      setNote(parsed.error || 'Could not use that file.');
      return;
    }
    setCarSpec(carId, parsed.spec);
    setNote('Custom parts');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: MUTED, fontSize: 11 }}>Shape</span>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          style={textBtn}
          onClick={() => {
            setCarSpec(carId, null);
            setNote(null);
          }}
        >
          Built-in
        </button>
        <button type="button" style={textBtn} onClick={() => fileRef.current?.click()}>
          Parts file
        </button>
        <button
          type="button"
          style={textBtn}
          onClick={() => {
            void requestCityCarSpec('car', 'sedan')
              .then((body) => {
                const parsed = parseCarSpec(body);
                if (!parsed.spec) {
                  setNote(parsed.error || 'Sample shape was rejected.');
                  return;
                }
                setCarSpec(carId, parsed.spec);
                setNote('Sample shape');
              })
              .catch(() => setNote('Sample shape is unavailable.'));
          }}
        >
          Sample
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          void file.text().then(applyText);
        }}
      />
      <div style={{ color: MUTED, fontSize: 12 }}>
        {note || (spec ? 'Custom parts' : 'Built-in sedan')}
      </div>
    </div>
  );
}
