// Developer City — CityNature: trees, flowering foliage, hedges, planter boxes,
// and landscaped botanical parks with water fountains.

import { useMemo } from 'react';
import * as THREE from 'three';
import { GRID_SIZE, GRID_SPACING, plotWorldPosition } from './CityGrid';
import { getAvenueCoordinates, ROAD_WIDTH, SIDEWALK_WIDTH, HALF_GRID } from './CityRoads';
import { useCityStore } from '@/city/store';
import type { Project } from '@/city/types';

interface CityNatureProps {
  projects: Project[];
}

export function CityNature({ projects }: CityNatureProps) {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';

  const occupiedPlots = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      if (p.plot) set.add(`${p.plot.x},${p.plot.y}`);
    }
    return set;
  }, [projects]);

  // Shared Materials
  const materials = useMemo(() => {
    return {
      trunk: new THREE.MeshStandardMaterial({
        color: isNight ? '#3d2817' : '#5c3a21',
        roughness: 0.9,
      }),
      foliageLush: new THREE.MeshStandardMaterial({
        color: isNight ? '#1b4d24' : '#2e7d32',
        roughness: 0.8,
        flatShading: true,
      }),
      foliageEmerald: new THREE.MeshStandardMaterial({
        color: isNight ? '#143d1c' : '#1e6628',
        roughness: 0.8,
        flatShading: true,
      }),
      foliageLime: new THREE.MeshStandardMaterial({
        color: isNight ? '#2d5c28' : '#4caf50',
        roughness: 0.75,
        flatShading: true,
      }),
      foliagePine: new THREE.MeshStandardMaterial({
        color: isNight ? '#0f3818' : '#1b5e20',
        roughness: 0.85,
        flatShading: true,
      }),
      foliageCherry: new THREE.MeshStandardMaterial({
        color: isNight ? '#9d3568' : '#f472b6',
        roughness: 0.75,
        flatShading: true,
      }),
      hedge: new THREE.MeshStandardMaterial({
        color: isNight ? '#194d20' : '#2e7d32',
        roughness: 0.9,
      }),
      planterStone: new THREE.MeshStandardMaterial({
        color: isNight ? '#252c38' : '#64748b',
        roughness: 0.85,
      }),
      grassPark: new THREE.MeshStandardMaterial({
        color: isNight ? '#16331a' : '#3d7a42',
        roughness: 0.9,
      }),
      pathStone: new THREE.MeshStandardMaterial({
        color: isNight ? '#282e3b' : '#94a3b8',
        roughness: 0.8,
      }),
      water: new THREE.MeshStandardMaterial({
        color: isNight ? '#1e3a8a' : '#38bdf8',
        roughness: 0.1,
        metalness: 0.8,
        transparent: true,
        opacity: 0.85,
      }),
      fountainStone: new THREE.MeshStandardMaterial({
        color: isNight ? '#334155' : '#cbd5e1',
        roughness: 0.6,
      }),
    };
  }, [isNight]);

  // Generate tree locations along street sidewalk corridors
  const avenueCoords = useMemo(() => getAvenueCoordinates(), []);

  // Precomputed street tree offsets along sidewalk strips
  const streetTrees = useMemo(() => {
    const list: Array<{ x: number; z: number; type: 'oak' | 'pine' | 'cherry' | 'lime'; scale: number }> = [];
    const treeTypes: Array<'oak' | 'pine' | 'cherry' | 'lime'> = ['oak', 'emerald' as any, 'lime', 'pine', 'cherry'];

    // Sidewalk tree lines along avenues
    avenueCoords.forEach((aveCoord, ai) => {
      for (let block = 0; block < GRID_SIZE; block++) {
        const segCenter = -HALF_GRID + block * GRID_SPACING;
        // Trees on North & South sidewalks of EW avenues
        [-1, 1].forEach((side, si) => {
          const zPos = aveCoord + side * (ROAD_WIDTH / 2 + SIDEWALK_WIDTH * 0.55);
          const xPos1 = segCenter - 3.8;
          const xPos2 = segCenter + 3.8;
          const hash1 = (ai * 31 + block * 17 + si * 7) % 5;
          const hash2 = (ai * 43 + block * 19 + si * 13) % 5;

          list.push({
            x: xPos1,
            z: zPos,
            type: (treeTypes[hash1] || 'oak') as any,
            scale: 0.85 + (hash1 % 3) * 0.12,
          });
          list.push({
            x: xPos2,
            z: zPos,
            type: (treeTypes[hash2] || 'lime') as any,
            scale: 0.8 + (hash2 % 3) * 0.15,
          });
        });
      }
    });

    return list;
  }, [avenueCoords]);

  // Identify empty plots to convert into public parks and gardens
  const parkPlots = useMemo(() => {
    const list: Array<{ x: number; y: number; worldPos: [number, number, number] }> = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const key = `${x},${y}`;
        if (!occupiedPlots.has(key)) {
          list.push({ x, y, worldPos: plotWorldPosition({ x, y }) });
        }
      }
    }
    return list;
  }, [occupiedPlots]);

  return (
    <group>
      {/* ── 1. Street Trees along Sidewalks ────────────────────── */}
      {streetTrees.map((tree, idx) => (
        <group key={`st-tree-${idx}`} position={[tree.x, 0.04, tree.z]} scale={[tree.scale, tree.scale, tree.scale]}>
          {/* Planter basin box */}
          <mesh position={[0, 0.04, 0]} material={materials.planterStone}>
            <boxGeometry args={[0.95, 0.08, 0.95]} />
          </mesh>
          <mesh position={[0, 0.08, 0]} material={materials.hedge}>
            <boxGeometry args={[0.78, 0.04, 0.78]} />
          </mesh>

          {/* Trunk */}
          <mesh position={[0, 1.2, 0]} material={materials.trunk} castShadow>
            <cylinderGeometry args={[0.1, 0.15, 2.4, 7]} />
          </mesh>

          {/* Foliage Canopy */}
          {tree.type === 'pine' ? (
            <group position={[0, 1.6, 0]}>
              <mesh position={[0, 0.7, 0]} material={materials.foliagePine} castShadow>
                <coneGeometry args={[0.9, 1.6, 7]} />
              </mesh>
              <mesh position={[0, 1.6, 0]} material={materials.foliagePine} castShadow>
                <coneGeometry args={[0.7, 1.4, 7]} />
              </mesh>
              <mesh position={[0, 2.4, 0]} material={materials.foliagePine} castShadow>
                <coneGeometry args={[0.48, 1.1, 7]} />
              </mesh>
            </group>
          ) : tree.type === 'cherry' ? (
            <group position={[0, 2.2, 0]}>
              <mesh position={[0, 0.4, 0]} material={materials.foliageCherry} castShadow>
                <dodecahedronGeometry args={[1.0, 1]} />
              </mesh>
              <mesh position={[0.4, 0.7, 0.2]} material={materials.foliageCherry} castShadow>
                <dodecahedronGeometry args={[0.65, 1]} />
              </mesh>
            </group>
          ) : tree.type === 'lime' ? (
            <group position={[0, 2.2, 0]}>
              <mesh position={[0, 0.5, 0]} material={materials.foliageLime} castShadow>
                <dodecahedronGeometry args={[1.05, 1]} />
              </mesh>
              <mesh position={[-0.35, 0.7, -0.2]} material={materials.foliageEmerald} castShadow>
                <dodecahedronGeometry args={[0.7, 1]} />
              </mesh>
            </group>
          ) : (
            <group position={[0, 2.2, 0]}>
              <mesh position={[0, 0.5, 0]} material={materials.foliageLush} castShadow>
                <dodecahedronGeometry args={[1.1, 1]} />
              </mesh>
              <mesh position={[0.3, 0.8, -0.2]} material={materials.foliageEmerald} castShadow>
                <dodecahedronGeometry args={[0.75, 1]} />
              </mesh>
            </group>
          )}
        </group>
      ))}

      {/* ── 2. Public Botanical Parks on Unoccupied Plots ──────── */}
      {parkPlots.map((park, pi) => {
        const [wx, , wz] = park.worldPos;
        const isFountainPark = (park.x + park.y) % 3 === 0;

        return (
          <group key={`park-${pi}`} position={[wx, 0.02, wz]}>
            {/* Lush Park Lawn Platform */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} material={materials.grassPark} receiveShadow>
              <circleGeometry args={[GRID_SPACING * 0.44, 32]} />
            </mesh>

            {/* Park Stone Border Curb */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
              <ringGeometry args={[GRID_SPACING * 0.44, GRID_SPACING * 0.465, 36]} />
              <meshStandardMaterial color={isNight ? '#222938' : '#71717a'} />
            </mesh>

            {/* Cross Walking Paths */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} material={materials.pathStone}>
              <planeGeometry args={[GRID_SPACING * 0.84, 1.2]} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]} material={materials.pathStone}>
              <planeGeometry args={[1.2, GRID_SPACING * 0.84]} />
            </mesh>

            {/* Central Park Centerpiece: Fountain or Majestic Grove */}
            {isFountainPark ? (
              <group position={[0, 0, 0]}>
                {/* Outer Stone Basin */}
                <mesh position={[0, 0.35, 0]} material={materials.fountainStone} castShadow>
                  <cylinderGeometry args={[2.2, 2.4, 0.7, 16]} />
                </mesh>
                {/* Water surface */}
                <mesh position={[0, 0.65, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.water}>
                  <circleGeometry args={[2.05, 24]} />
                </mesh>
                {/* Center Tier Pedestal */}
                <mesh position={[0, 0.85, 0]} material={materials.fountainStone}>
                  <cylinderGeometry args={[0.7, 0.9, 1.0, 12]} />
                </mesh>
                {/* Upper Basin */}
                <mesh position={[0, 1.45, 0]} material={materials.fountainStone}>
                  <cylinderGeometry args={[1.1, 0.5, 0.35, 14]} />
                </mesh>
                {/* Upper water pool & jet */}
                <mesh position={[0, 1.6, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.water}>
                  <circleGeometry args={[0.95, 16]} />
                </mesh>
                <mesh position={[0, 2.05, 0]} material={materials.water}>
                  <coneGeometry args={[0.3, 0.8, 8]} />
                </mesh>
              </group>
            ) : (
              <group position={[0, 0, 0]}>
                {/* Central Grand Tree */}
                <mesh position={[0, 1.8, 0]} material={materials.trunk} castShadow>
                  <cylinderGeometry args={[0.26, 0.38, 3.6, 8]} />
                </mesh>
                <mesh position={[0, 4.0, 0]} material={materials.foliageEmerald} castShadow>
                  <dodecahedronGeometry args={[2.2, 1]} />
                </mesh>
                <mesh position={[0.7, 4.6, 0.4]} material={materials.foliageLime} castShadow>
                  <dodecahedronGeometry args={[1.5, 1]} />
                </mesh>
                <mesh position={[-0.8, 4.3, -0.5]} material={materials.foliageLush} castShadow>
                  <dodecahedronGeometry args={[1.4, 1]} />
                </mesh>
              </group>
            )}

            {/* Perimeter Park Corner Trees */}
            {[
              [-3.4, -3.4],
              [3.4, -3.4],
              [-3.4, 3.4],
              [3.4, 3.4],
            ].map(([tx, tz], ki) => (
              <group key={`pt-${ki}`} position={[tx, 0, tz]} scale={[1.1, 1.1, 1.1]}>
                <mesh position={[0, 1.2, 0]} material={materials.trunk} castShadow>
                  <cylinderGeometry args={[0.12, 0.18, 2.4, 6]} />
                </mesh>
                <mesh position={[0, 2.7, 0]} material={ki % 2 === 0 ? materials.foliageCherry : materials.foliageLush} castShadow>
                  <dodecahedronGeometry args={[1.25, 1]} />
                </mesh>
              </group>
            ))}

            {/* Park Benches along paths */}
            {[
              [0, -2.2, 0],
              [0, 2.2, Math.PI],
              [-2.2, 0, Math.PI / 2],
              [2.2, 0, -Math.PI / 2],
            ].map(([bx, bz, rot], bi) => (
              <group key={`pb-${bi}`} position={[bx, 0, bz]} rotation={[0, rot, 0]}>
                <mesh position={[0, 0.35, 0]} material={materials.pathStone}>
                  <boxGeometry args={[1.4, 0.08, 0.45]} />
                </mesh>
                <mesh position={[0, 0.65, 0.18]} rotation={[-0.1, 0, 0]} material={materials.pathStone}>
                  <boxGeometry args={[1.4, 0.35, 0.06]} />
                </mesh>
                <mesh position={[-0.55, 0.18, 0]} material={materials.planterStone}>
                  <boxGeometry args={[0.08, 0.35, 0.4]} />
                </mesh>
                <mesh position={[0.55, 0.18, 0]} material={materials.planterStone}>
                  <boxGeometry args={[0.08, 0.35, 0.4]} />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
}
