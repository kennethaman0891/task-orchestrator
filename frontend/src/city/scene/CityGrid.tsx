// Developer City — CityGrid: ground, roads, plot slots.
// Pure geometry driven by the grid constants shared with the backend.
// Occupied slots get a plaza + ring; empty slots get a faint marker so the
// user sees where the next project will land.

import { useMemo } from 'react';
import * as THREE from 'three';
import type { Project } from '@/city/types';

export const GRID_SIZE = 8;
export const GRID_SPACING = 14;

export function plotWorldPosition(plot: { x: number; y: number }): [number, number, number] {
  const half = ((GRID_SIZE - 1) * GRID_SPACING) / 2;
  return [plot.x * GRID_SPACING - half, 0, plot.y * GRID_SPACING - half];
}

export function cityRadius(): number {
  return ((GRID_SIZE - 1) * GRID_SPACING) / 2 + GRID_SPACING;
}

interface CityGridProps {
  projects: Project[];
  groundColor: string;
}

export function CityGrid({ projects, groundColor }: CityGridProps) {
  const radius = cityRadius();

  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) set.add(`${p.plot?.x},${p.plot?.y}`);
    return set;
  }, [projects]);

  return (
    <group>
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[radius * 3.5, radius * 3.5]} />
        <meshStandardMaterial color={groundColor} roughness={1} />
      </mesh>
      {/* plot markers: occupied = plaza ring, empty = faint dot */}
      {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
        const x = i % GRID_SIZE;
        const y = Math.floor(i / GRID_SIZE);
        const [wx, , wz] = plotWorldPosition({ x, y });
        const isOcc = occupied.has(`${x},${y}`);
        return (
          <group key={`p${i}`} position={[wx, 0.02, wz]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[isOcc ? GRID_SPACING * 0.42 : GRID_SPACING * 0.3, 28]} />
              <meshStandardMaterial
                color={isOcc ? '#ffffff' : '#ffffff'}
                transparent
                opacity={isOcc ? 0.1 : 0.03}
                roughness={1}
              />
            </mesh>
            {isOcc && (
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[GRID_SPACING * 0.42, GRID_SPACING * 0.46, 40]} />
                <meshBasicMaterial color="#7dd3fc" transparent opacity={0.25} side={THREE.DoubleSide} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
