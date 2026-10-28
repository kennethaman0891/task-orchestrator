// Developer City — curb stalls for parked terminal cars.
// Pads sit on the curb (see PARKING_STALLS). They do not run under the tower.

import { useMemo } from 'react';
import { useCityStore } from '@/city/store';
import type { Project, TerminalCar } from '@/city/types';
import { plotWorldPosition } from './CityGrid';
import { PARKING_STALLS } from './plotFit';

interface ParkingLotProps {
  project: Project;
  cars: TerminalCar[];
}

function ParkingLot({ project, cars }: ParkingLotProps) {
  const [wx, wy, wz] = plotWorldPosition(project.plot);

  const occupiedSlots = useMemo(() => {
    const set = new Set<number>();
    for (const car of cars) {
      if (!car.moving && typeof car.slotIndex === 'number') {
        set.add(Math.abs(Math.trunc(car.slotIndex)) % PARKING_STALLS.length);
      }
    }
    return set;
  }, [cars]);

  return (
    <group position={[wx, wy, wz]}>
      {PARKING_STALLS.map((stall, idx) => {
        const isOccupied = occupiedSlots.has(idx);
        return (
          <group key={`stall-${idx}`} position={[stall.x, 0, stall.z]} rotation={[0, stall.rotY, 0]}>
            {/* Local Z is the car's length, so the pad matches a parallel stall. */}
            <mesh position={[0, 0.02, 0]} receiveShadow>
              <boxGeometry args={[1.2, 0.03, 2.45]} />
              <meshStandardMaterial color="#2a3140" roughness={0.82} metalness={0.12} />
            </mesh>
            <mesh position={[0, 0.04, -1.05]} receiveShadow>
              <boxGeometry args={[1.05, 0.045, 0.08]} />
              <meshStandardMaterial color="#94a3b8" roughness={0.7} />
            </mesh>
            <mesh position={[0, 0.055, -0.85]} castShadow receiveShadow>
              <boxGeometry args={[0.9, 0.06, 0.12]} />
              <meshStandardMaterial color="#475569" roughness={0.75} />
            </mesh>
            <mesh position={[0.42, 0.28, -1.05]} castShadow>
              <boxGeometry args={[0.08, 0.5, 0.08]} />
              <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0.42, 0.5, -1.0]}>
              <boxGeometry args={[0.06, 0.08, 0.02]} />
              <meshStandardMaterial
                color={isOccupied ? '#00f0ff' : '#10b981'}
                emissive={isOccupied ? '#00e5ff' : '#059669'}
                emissiveIntensity={1.6}
                roughness={0.2}
              />
            </mesh>
          </group>
        );
      })}
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
