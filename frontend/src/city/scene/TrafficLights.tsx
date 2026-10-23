// Developer City — one miniature signal per project, on the south edge of its plot.
// The lit lens and the label follow that project's terminal cars. No toasts.

import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useCityStore } from '@/city/store';
import type { Project, TerminalCar } from '@/city/types';
import { plotWorldPosition } from './CityGrid';

const RED = '#ef4444';
const YELLOW = '#f5c542';
const GREEN = '#22c55e';

const LENSES = [
  { key: 'red', color: RED, y: 0.2 },
  { key: 'yellow', color: YELLOW, y: 0 },
  { key: 'green', color: GREEN, y: -0.2 },
] as const;

type Lit = 'red' | 'yellow' | 'green';

function signalState(cars: TerminalCar[]): { lit: Lit; lines: string[] } {
  const batch = cars.some((c) => c.batchDispatched);
  const running = cars.some((c) => c.moving);
  const queue = cars.some((c) => c.queueCount > 0 || c.nextTask);

  const lines: string[] = [];
  if (batch) lines.push('Batch dispatched');
  if (running) lines.push('Task running');
  if (queue) lines.push('Waiting in queue');
  if (lines.length === 0) lines.push('Stopped');

  const lit: Lit = batch || running ? 'green' : queue ? 'yellow' : 'red';
  return { lit, lines };
}

function ProjectSignal({
  project,
  cars,
  onOpen,
}: {
  project: Project;
  cars: TerminalCar[];
  onOpen: (projectId: string) => void;
}) {
  const [x, y, z] = plotWorldPosition(project.plot);
  const { lit, lines } = signalState(cars);
  const open = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onOpen(project.id);
  };

  return (
    <group position={[x, y, z + 3.6]}>
      <mesh position={[0, 0.68, 0]}>
        <cylinderGeometry args={[0.035, 0.045, 1.36, 6]} />
        <meshStandardMaterial color="#2c3344" metalness={0.45} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.72, 0]} onPointerDown={open}>
        <boxGeometry args={[0.32, 0.72, 0.16]} />
        <meshStandardMaterial color="#1a2030" metalness={0.3} roughness={0.55} />
      </mesh>
      {LENSES.map((lens) => {
        const on = lit === lens.key;
        return (
          <mesh key={lens.key} position={[0, 1.72 + lens.y, 0.09]}>
            <circleGeometry args={[0.062, 12]} />
            <meshStandardMaterial
              color={lens.color}
              emissive={lens.color}
              emissiveIntensity={on ? 1.6 : 0.05}
              roughness={0.4}
              side={2}
            />
          </mesh>
        );
      })}
      <Html position={[0, 2.28, 0]} center distanceFactor={36} zIndexRange={[10, 0]} pointerEvents="none">
        <div
          style={{
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.35,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            color: '#f8fafc',
            background: 'rgba(8, 10, 18, 0.88)',
            padding: '3px 8px',
            borderRadius: 10,
          }}
        >
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </Html>
    </group>
  );
}

export function TrafficLights({ onOpen }: { onOpen: (projectId: string) => void }) {
  const projects = useCityStore((s) => s.projects);
  const projectOrder = useCityStore((s) => s.projectOrder);
  const terminalCars = useCityStore((s) => s.terminalCars);

  return (
    <group>
      {projectOrder.map((id) => {
        const project = projects[id];
        if (!project) return null;
        const cars = Object.values(terminalCars).filter((c) => c.projectId === project.id);
        return <ProjectSignal key={project.id} project={project} cars={cars} onOpen={onOpen} />;
      })}
    </group>
  );
}
