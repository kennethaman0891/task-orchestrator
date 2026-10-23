// Developer City — CarInterior: open cabin shown instead of the solid car body.
// Miniature, Y-up: floor, two seats, steering wheel, windshield frame.

import { useEffect, useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import type { TerminalCar } from '@/city/types';
import { Driver } from './Driver';

const WIDTH = 1.2;
const LENGTH = 2.2;
const FLOOR_H = 0.08;
const SEAT_W = 0.4;
const SEAT_H = 0.16;
const SEAT_D = 0.42;
const SEAT_X = 0.3;
const SEAT_Z = -0.18;

const FLOOR_TOP = FLOOR_H;
const SEAT_TOP = FLOOR_TOP + SEAT_H;

const cardStyle = {
  pointerEvents: 'none' as const,
  boxSizing: 'border-box' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  maxWidth: 220,
  fontSize: 12,
  lineHeight: 1.35,
  color: '#e7e9ee',
  background: '#141820',
  padding: '6px 8px',
  borderRadius: 4,
};

const dimStyle = { color: '#a8b0be' };
const rowStyle = { display: 'flex', gap: 6, justifyContent: 'space-between' as const };
const timeStyle = { flexShrink: 0, color: '#a8b0be' };

function epochMs(n: number): number {
  return n < 1e12 ? n * 1000 : n;
}

function formatLocalTime(n: number): string {
  return new Date(epochMs(n)).toLocaleTimeString();
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

function finiteNumber(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

type HistoryRow = { key: string; description: string; time: string | null };

function ElapsedClock({ running, startedMs }: { running: boolean; startedMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (!running || startedMs == null) return null;
  return <div>{formatElapsed(now - startedMs)}</div>;
}

function Dashboard({ car }: { car: TerminalCar }) {
  const dash = useMemo(() => {
    const task = car.currentTask;
    const started = task && finiteNumber(task.started_at) ? task.started_at : null;
    // History is append-only, so the tail is the latest finished work.
    const history: HistoryRow[] = (car.history ?? []).slice(-6).map((h, i) => ({
      key: `${h.id}:${i}`,
      description: h.description,
      time: finiteNumber(h.completed_at) ? formatLocalTime(h.completed_at) : null,
    }));
    return {
      task,
      startedMs: started == null ? null : epochMs(started),
      startedLabel: started == null ? null : formatLocalTime(started),
      history,
    };
  }, [car.currentTask, car.history]);

  return (
    <Html
      position={[0.16, 0.52, 0.55]}
      center
      pointerEvents="none"
      style={{ pointerEvents: 'none' }}
      zIndexRange={[20, 0]}
    >
      <div style={cardStyle}>
        {dash.task == null ? (
          <div>No current task</div>
        ) : (
          <div>
            <div>{dash.task.description}</div>
            <div style={dimStyle}>{dash.task.status}</div>
            {dash.startedLabel != null && <div style={dimStyle}>{dash.startedLabel}</div>}
            <ElapsedClock running={dash.task.status === 'running'} startedMs={dash.startedMs} />
          </div>
        )}
        {dash.history.map((row) => (
          <div key={row.key} style={rowStyle}>
            <span>{row.description}</span>
            {row.time != null && <span style={timeStyle}>{row.time}</span>}
          </div>
        ))}
      </div>
    </Html>
  );
}

export function CarInterior({ car }: { car: TerminalCar }) {
  return (
    <group>
      <mesh position={[0, FLOOR_H / 2, 0]} receiveShadow>
        <boxGeometry args={[WIDTH, FLOOR_H, LENGTH]} />
        <meshStandardMaterial color="#1a1d27" roughness={0.9} metalness={0.05} />
      </mesh>

      {([-SEAT_X, SEAT_X] as const).map((x) => (
        <mesh key={x} position={[x, FLOOR_TOP + SEAT_H / 2, SEAT_Z]} castShadow>
          <boxGeometry args={[SEAT_W, SEAT_H, SEAT_D]} />
          <meshStandardMaterial color="#2c3344" roughness={0.75} metalness={0.08} />
        </mesh>
      ))}

      <mesh position={[-SEAT_X, SEAT_TOP + 0.2, SEAT_Z + 0.55]} rotation={[0.65, 0, 0]}>
        <torusGeometry args={[0.11, 0.016, 8, 18]} />
        <meshStandardMaterial color="#12141c" metalness={0.55} roughness={0.35} />
      </mesh>

      <group position={[0, 0.46, LENGTH / 2 - 0.2]} rotation={[-0.42, 0, 0]}>
        <mesh position={[0, -0.24, 0]}>
          <boxGeometry args={[1.02, 0.035, 0.035]} />
          <meshStandardMaterial color="#9aa3b2" metalness={0.45} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <boxGeometry args={[1.02, 0.035, 0.035]} />
          <meshStandardMaterial color="#9aa3b2" metalness={0.45} roughness={0.35} />
        </mesh>
        <mesh position={[-0.49, 0, 0]}>
          <boxGeometry args={[0.035, 0.48, 0.035]} />
          <meshStandardMaterial color="#9aa3b2" metalness={0.45} roughness={0.35} />
        </mesh>
        <mesh position={[0.49, 0, 0]}>
          <boxGeometry args={[0.035, 0.48, 0.035]} />
          <meshStandardMaterial color="#9aa3b2" metalness={0.45} roughness={0.35} />
        </mesh>
      </group>

      <group position={[-SEAT_X, SEAT_TOP, SEAT_Z]}>
        <Driver agentName={car.agentName} modelName={car.modelName} cli={car.cli} />
      </group>

      <Dashboard car={car} />
    </group>
  );
}
