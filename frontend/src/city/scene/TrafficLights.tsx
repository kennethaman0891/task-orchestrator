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
    <group position={[x, y, z + 3.6]} onPointerDown={open}>
      {/* Industrial Powder-Coated Metal Mast */}
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.055, 1.44, 8]} />
        <meshStandardMaterial color="#1e293b" metalness={0.75} roughness={0.3} />
      </mesh>

      {/* Traffic Signal Main Enclosure */}
      <mesh position={[0, 1.76, 0]} castShadow>
        <boxGeometry args={[0.34, 0.78, 0.18]} />
        <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Sun Visor Hoods & Lenses */}
      {LENSES.map((lens) => {
        const on = lit === lens.key;
        const ly = 1.76 + lens.y;
        return (
          <group key={lens.key} position={[0, ly, 0.09]}>
            {/* Extended Sun Visor Hood */}
            <mesh position={[0, 0.04, 0.03]} rotation={[-0.3, 0, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 0.06, 10, 1, true, 0, Math.PI]} />
              <meshStandardMaterial color="#0b0f19" metalness={0.5} roughness={0.5} side={2} />
            </mesh>
            {/* Glowing Emissive Fresnel Lens */}
            <mesh position={[0, 0, 0.01]}>
              <circleGeometry args={[0.068, 16]} />
              <meshStandardMaterial
                color={lens.color}
                emissive={lens.color}
                emissiveIntensity={on ? 3.0 : 0.04}
                roughness={0.2}
                side={2}
              />
            </mesh>
          </group>
        );
      })}

      {/* Subtle night-time lens glow on ground */}
      {lit !== 'red' && (
        <pointLight
          position={[0, 1.76, 0.3]}
          color={lit === 'green' ? '#22c55e' : '#f5c542'}
          intensity={0.4}
          distance={4}
          decay={2}
        />
      )}

      {lit !== 'red' && (
        <Html position={[0, 2.36, 0]} center distanceFactor={36} zIndexRange={[10, 0]} pointerEvents="none">
          <div
            style={{
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              lineHeight: 1.35,
              fontFamily: 'ui-sans-serif, system-ui, sans-serif',
              color: lit === 'green' ? '#4ade80' : '#fde047',
              background: 'rgba(10, 12, 20, 0.88)',
              border: `1px solid ${lit === 'green' ? 'rgba(74, 222, 128, 0.3)' : 'rgba(253, 224, 71, 0.3)'}`,
              backdropFilter: 'blur(8px)',
              padding: '3px 8px',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            }}
          >
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </Html>
      )}
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
