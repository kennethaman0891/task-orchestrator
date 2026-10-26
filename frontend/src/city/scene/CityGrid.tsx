// Developer City — CityGrid: ground, roads, plot slots.
// Pure geometry driven by the grid constants shared with the backend.
// Occupied slots get an architectural raised plaza pad with glowing boundary rings;
// empty slots get a clean geometric marker so the user sees where future projects land.

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

  const materials = useMemo(() => {
    return {
      ground: new THREE.MeshStandardMaterial({
        color: groundColor,
        roughness: 0.68,
        metalness: 0.22,
      }),
      plazaPad: new THREE.MeshStandardMaterial({
        color: '#1a2233',
        roughness: 0.6,
        metalness: 0.25,
      }),
      plazaRing: new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      }),
      plazaMarker: new THREE.MeshBasicMaterial({
        color: '#64748b',
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
      }),
      cornerBeacon: new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        emissive: '#0284c7',
        emissiveIntensity: 1.5,
        roughness: 0.3,
      }),
    };
  }, [groundColor]);

  return (
    <group>
      {/* ── Main Terrain / Ground Base Plate ───────────────────────── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow material={materials.ground}>
        <planeGeometry args={[radius * 3.5, radius * 3.5]} />
      </mesh>

      {/* ── Architectural Plot Plazas & Slots ──────────────────────── */}
      {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
        const x = i % GRID_SIZE;
        const y = Math.floor(i / GRID_SIZE);
        const [wx, , wz] = plotWorldPosition({ x, y });
        const isOcc = occupied.has(`${x},${y}`);

        return (
          <group key={`p${i}`} position={[wx, 0, wz]}>
            {isOcc ? (
              <group position={[0, 0.02, 0]}>
                {/* Raised Circular Plaza Platform */}
                <mesh position={[0, 0.015, 0]} material={materials.plazaPad} receiveShadow>
                  <cylinderGeometry args={[GRID_SPACING * 0.44, GRID_SPACING * 0.45, 0.03, 36]} />
                </mesh>

                {/* Perimeter Luminous Cyber Ring */}
                <mesh position={[0, 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.plazaRing}>
                  <ringGeometry args={[GRID_SPACING * 0.43, GRID_SPACING * 0.45, 48]} />
                </mesh>

                {/* 4 Corner Ground Up-light Pucks */}
                {[
                  [-GRID_SPACING * 0.38, -GRID_SPACING * 0.38],
                  [GRID_SPACING * 0.38, -GRID_SPACING * 0.38],
                  [-GRID_SPACING * 0.38, GRID_SPACING * 0.38],
                  [GRID_SPACING * 0.38, GRID_SPACING * 0.38],
                ].map(([cx, cz], ci) => (
                  <mesh key={`puck-${ci}`} position={[cx, 0.035, cz]} material={materials.cornerBeacon}>
                    <cylinderGeometry args={[0.08, 0.1, 0.04, 10]} />
                  </mesh>
                ))}
              </group>
            ) : (
              /* Faint Geometric Marker for Unoccupied Plots */
              <group position={[0, 0.01, 0]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} material={materials.plazaMarker}>
                  <circleGeometry args={[GRID_SPACING * 0.32, 24]} />
                </mesh>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}
