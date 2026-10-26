// Developer City — Dedicated Architectural Parking Bays & Charging Terminals
// Provides realistic, designated parking aprons for live terminal cars.
// Front bays at Z = 5.2 and East bays at X = 5.2.
// Includes beveled asphalt pavement, thermoplastic stall stripes,
// concrete wheel bumpers, and cyber EV charging pedestals with live occupancy indicators.

import { useMemo } from 'react';
import { useCityStore } from '@/city/store';
import type { Project, TerminalCar } from '@/city/types';
import { plotWorldPosition } from './CityGrid';

const FRONT_CENTERS_X = [-2.7, -0.9, 0.9, 2.7];
const SIDE_CENTERS_Z = [-2.7, -0.9, 0.9, 2.7];

interface ParkingLotProps {
  project: Project;
  cars: TerminalCar[];
}

function ParkingLot({ project, cars }: ParkingLotProps) {
  const [wx, wy, wz] = plotWorldPosition(project.plot);

  // Check occupancy for slots 0-3 (front) and 4-7 (side)
  const occupiedSlots = useMemo(() => {
    const set = new Set<number>();
    for (const car of cars) {
      if (!car.moving && typeof car.slotIndex === 'number') {
        set.add(car.slotIndex);
      }
    }
    return set;
  }, [cars]);

  const hasSideCars = cars.some((c) => !c.moving && typeof c.slotIndex === 'number' && c.slotIndex >= 4);

  return (
    <group position={[wx, wy, wz]}>
      {/* ─── FRONT PARKING LOT (Z = 5.2) ──────────────────────────── */}
      <group position={[0, 0, 5.2]}>
        {/* Asphalt Apron Base with Chamfered Edges */}
        <mesh position={[0, 0.018, 0]} receiveShadow>
          <boxGeometry args={[7.8, 0.035, 2.8]} />
          <meshStandardMaterial
            color="#181e28"
            roughness={0.82}
            metalness={0.18}
          />
        </mesh>

        {/* Concrete Border Curb (North / Rear Side) */}
        <mesh position={[0, 0.038, -1.35]} receiveShadow>
          <boxGeometry args={[7.8, 0.05, 0.12]} />
          <meshStandardMaterial color="#64748b" roughness={0.7} />
        </mesh>

        {/* 5 Thermoplastic Stall Divider Lines */}
        {[-3.6, -1.8, 0, 1.8, 3.6].map((lx) => (
          <mesh key={`fline-${lx}`} position={[lx, 0.038, 0]} receiveShadow>
            <boxGeometry args={[0.07, 0.005, 2.5]} />
            <meshStandardMaterial
              color="#f8fafc"
              roughness={0.5}
              emissive="#cbd5e1"
              emissiveIntensity={0.2}
            />
          </mesh>
        ))}

        {/* 4 Stalls Details: Bumpers & EV Charging Pedestals */}
        {FRONT_CENTERS_X.map((cx, idx) => {
          const isOccupied = occupiedSlots.has(idx);
          return (
            <group key={`stall-${idx}`} position={[cx, 0, 0]}>
              {/* Concrete Wheel Stop / Tire Bumper */}
              <mesh position={[0, 0.065, -0.95]} castShadow receiveShadow>
                <boxGeometry args={[1.2, 0.08, 0.16]} />
                <meshStandardMaterial color="#475569" roughness={0.75} />
              </mesh>
              {/* Reflective Warning Strips on Bumper */}
              {[-0.35, 0.35].map((bx, bi) => (
                <mesh key={`bstrip-${bi}`} position={[bx, 0.07, -0.865]}>
                  <boxGeometry args={[0.18, 0.04, 0.01]} />
                  <meshStandardMaterial
                    color="#facc15"
                    emissive="#eab308"
                    emissiveIntensity={0.6}
                  />
                </mesh>
              ))}

              {/* Cyber EV Fast-Charging Pedestal */}
              <group position={[0.65, 0, -1.15]}>
                {/* Pedestal Base & Pillar */}
                <mesh position={[0, 0.35, 0]} castShadow>
                  <boxGeometry args={[0.14, 0.7, 0.14]} />
                  <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
                </mesh>
                {/* Status LED Beacon Bar (Cyan if car plugged in / occupied, Green if free) */}
                <mesh position={[0, 0.62, 0.075]}>
                  <boxGeometry args={[0.08, 0.1, 0.02]} />
                  <meshStandardMaterial
                    color={isOccupied ? '#00f0ff' : '#10b981'}
                    emissive={isOccupied ? '#00e5ff' : '#059669'}
                    emissiveIntensity={1.8}
                    roughness={0.2}
                  />
                </mesh>
                {/* Night-time Puddle Glow under Active Charger */}
                <pointLight
                  position={[0, 0.65, 0.2]}
                  color={isOccupied ? '#00f0ff' : '#10b981'}
                  intensity={isOccupied ? 0.35 : 0.1}
                  distance={2.5}
                  decay={2}
                />
              </group>
            </group>
          );
        })}

        {/* Walkway Path connecting Lot to Entrance Plaza */}
        <mesh position={[0, 0.022, -1.8]} receiveShadow>
          <boxGeometry args={[1.6, 0.03, 0.8]} />
          <meshStandardMaterial color="#334155" roughness={0.6} />
        </mesh>
      </group>

      {/* ─── EAST WING PARKING LOT (X = 5.2) ─────────────────────────── */}
      {/* Rendered if project has extended parking needs */}
      {(hasSideCars || cars.length > 3) && (
        <group position={[5.2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <mesh position={[0, 0.018, 0]} receiveShadow>
            <boxGeometry args={[7.8, 0.035, 2.8]} />
            <meshStandardMaterial
              color="#181e28"
              roughness={0.82}
              metalness={0.18}
            />
          </mesh>

          <mesh position={[0, 0.038, -1.35]} receiveShadow>
            <boxGeometry args={[7.8, 0.05, 0.12]} />
            <meshStandardMaterial color="#64748b" roughness={0.7} />
          </mesh>

          {[-3.6, -1.8, 0, 1.8, 3.6].map((lx) => (
            <mesh key={`sline-${lx}`} position={[lx, 0.038, 0]} receiveShadow>
              <boxGeometry args={[0.07, 0.005, 2.5]} />
              <meshStandardMaterial
                color="#f8fafc"
                roughness={0.5}
                emissive="#cbd5e1"
                emissiveIntensity={0.2}
              />
            </mesh>
          ))}

          {SIDE_CENTERS_Z.map((_, idx) => {
            const sideSlot = idx + 4;
            const isOccupied = occupiedSlots.has(sideSlot);
            const cx = FRONT_CENTERS_X[idx];
            return (
              <group key={`side-stall-${idx}`} position={[cx, 0, 0]}>
                <mesh position={[0, 0.065, -0.95]} castShadow receiveShadow>
                  <boxGeometry args={[1.2, 0.08, 0.16]} />
                  <meshStandardMaterial color="#475569" roughness={0.75} />
                </mesh>
                {[-0.35, 0.35].map((bx, bi) => (
                  <mesh key={`sbstrip-${bi}`} position={[bx, 0.07, -0.865]}>
                    <boxGeometry args={[0.18, 0.04, 0.01]} />
                    <meshStandardMaterial
                      color="#facc15"
                      emissive="#eab308"
                      emissiveIntensity={0.6}
                    />
                  </mesh>
                ))}
                <group position={[0.65, 0, -1.15]}>
                  <mesh position={[0, 0.35, 0]} castShadow>
                    <boxGeometry args={[0.14, 0.7, 0.14]} />
                    <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
                  </mesh>
                  <mesh position={[0, 0.62, 0.075]}>
                    <boxGeometry args={[0.08, 0.1, 0.02]} />
                    <meshStandardMaterial
                      color={isOccupied ? '#00f0ff' : '#10b981'}
                      emissive={isOccupied ? '#00e5ff' : '#059669'}
                      emissiveIntensity={1.8}
                      roughness={0.2}
                    />
                  </mesh>
                </group>
              </group>
            );
          })}
        </group>
      )}
    </group>
  );
}

export function ParkingLots() {
  const projects = useCityStore((s) => s.projects);
  const projectOrder = useCityStore((s) => s.projectOrder);
  const terminalCars = useCityStore((s) => s.terminalCars);

  return (
    <group>
      {projectOrder.map((id) => {
        const project = projects[id];
        if (!project || !project.plot) return null;
        const cars = Object.values(terminalCars).filter((c) => c.projectId === project.id);
        return <ParkingLot key={`parking-${project.id}`} project={project} cars={cars} />;
      })}
    </group>
  );
}
