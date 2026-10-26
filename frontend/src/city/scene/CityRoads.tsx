// Developer City — CityRoads: complete urban infrastructure.
// Asphalt avenues, concrete curbs, sidewalks, road markings (dashed center lines,
// zebra crosswalks, stop lines), streetlamps with night glow, traffic signals, and street furniture.

import { useMemo } from 'react';
import * as THREE from 'three';
import { GRID_SIZE, GRID_SPACING } from './CityGrid';
import { useCityStore } from '@/city/store';

export const ROAD_WIDTH = 3.6;
export const SIDEWALK_WIDTH = 0.8;
export const HALF_GRID = ((GRID_SIZE - 1) * GRID_SPACING) / 2;

// Midpoint coordinates between plots where avenues run:
export function getAvenueCoordinates(): number[] {
  const coords: number[] = [];
  // From outer beltway to opposite outer beltway
  for (let i = 0; i <= GRID_SIZE; i++) {
    const pos = -HALF_GRID - GRID_SPACING / 2 + i * GRID_SPACING;
    coords.push(pos);
  }
  return coords;
}

export function CityRoads() {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';

  const avenuePositions = useMemo(() => getAvenueCoordinates(), []);
  const roadLength = (GRID_SIZE + 1) * GRID_SPACING;

  // Shared Materials
  const materials = useMemo(() => {
    return {
      asphalt: new THREE.MeshStandardMaterial({
        color: isNight ? '#12151e' : '#232733',
        roughness: isNight ? 0.34 : 0.65,
        metalness: isNight ? 0.42 : 0.12,
      }),
      sidewalk: new THREE.MeshStandardMaterial({
        color: isNight ? '#1e2433' : '#788191',
        roughness: 0.78,
        metalness: 0.08,
      }),
      curb: new THREE.MeshStandardMaterial({
        color: isNight ? '#333d4e' : '#555f6f',
        roughness: 0.7,
        metalness: 0.2,
      }),
      centerLine: new THREE.MeshStandardMaterial({
        color: isNight ? '#fbbf24' : '#f59e0b',
        emissive: isNight ? '#d97706' : '#000000',
        emissiveIntensity: isNight ? 0.8 : 0,
        side: THREE.DoubleSide,
      }),
      crosswalk: new THREE.MeshStandardMaterial({
        color: isNight ? '#f1f5f9' : '#ffffff',
        emissive: isNight ? '#94a3b8' : '#000000',
        emissiveIntensity: isNight ? 0.5 : 0,
        side: THREE.DoubleSide,
      }),
      stopLine: new THREE.MeshStandardMaterial({
        color: isNight ? '#e2e8f0' : '#ffffff',
        emissive: isNight ? '#94a3b8' : '#000000',
        emissiveIntensity: isNight ? 0.5 : 0,
        side: THREE.DoubleSide,
      }),
      manhole: new THREE.MeshStandardMaterial({
        color: isNight ? '#252933' : '#475569',
        metalness: 0.85,
        roughness: 0.35,
      }),
      lampPole: new THREE.MeshStandardMaterial({
        color: isNight ? '#1e2430' : '#334155',
        metalness: 0.7,
        roughness: 0.3,
      }),
      lampLight: new THREE.MeshStandardMaterial({
        color: isNight ? '#fff3c4' : '#ffffff',
        emissive: isNight ? '#ffea9f' : '#fff5d6',
        emissiveIntensity: isNight ? 2.5 : 0.6,
      }),
      trafficPole: new THREE.MeshStandardMaterial({
        color: '#1e293b',
        metalness: 0.5,
        roughness: 0.5,
      }),
      trafficBox: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.7,
      }),
      signalRed: new THREE.MeshStandardMaterial({
        color: '#ef4444',
        emissive: '#ef4444',
        emissiveIntensity: isNight ? 2.0 : 0.8,
      }),
      signalGreen: new THREE.MeshStandardMaterial({
        color: '#22c55e',
        emissive: '#22c55e',
        emissiveIntensity: isNight ? 2.0 : 0.8,
      }),
      benchWood: new THREE.MeshStandardMaterial({
        color: '#78350f',
        roughness: 0.8,
      }),
      benchMetal: new THREE.MeshStandardMaterial({
        color: '#334155',
        metalness: 0.8,
        roughness: 0.4,
      }),
      hydrant: new THREE.MeshStandardMaterial({
        color: '#dc2626',
        metalness: 0.3,
        roughness: 0.5,
      }),
    };
  }, [isNight]);

  // Generate road dashed line segments for one block
  const dashSegments = useMemo(() => {
    const dashes: number[] = [];
    const count = 5;
    const blockSpan = GRID_SPACING - ROAD_WIDTH;
    const dashLen = blockSpan / (count * 2);
    for (let i = 0; i < count; i++) {
      dashes.push(-blockSpan / 2 + (i * 2 + 0.5) * dashLen);
    }
    return { dashes, dashLen };
  }, []);

  return (
    <group>
      {/* ── 1. Asphalt Avenues ─────────────────────────────────── */}
      {/* X-axis avenues (running East-West) */}
      {avenuePositions.map((z, idx) => (
        <group key={`road-x-${idx}`}>
          {/* Main asphalt strip */}
          <mesh position={[0, 0.015, z]} rotation={[-Math.PI / 2, 0, 0]} material={materials.asphalt} receiveShadow>
            <planeGeometry args={[roadLength, ROAD_WIDTH]} />
          </mesh>

          {/* North Sidewalk */}
          <mesh position={[0, 0.04, z - ROAD_WIDTH / 2 - SIDEWALK_WIDTH / 2]} rotation={[-Math.PI / 2, 0, 0]} material={materials.sidewalk} receiveShadow>
            <planeGeometry args={[roadLength, SIDEWALK_WIDTH]} />
          </mesh>
          {/* North Curb bevel */}
          <mesh position={[0, 0.04, z - ROAD_WIDTH / 2]} material={materials.curb}>
            <boxGeometry args={[roadLength, 0.06, 0.08]} />
          </mesh>

          {/* South Sidewalk */}
          <mesh position={[0, 0.04, z + ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2]} rotation={[-Math.PI / 2, 0, 0]} material={materials.sidewalk} receiveShadow>
            <planeGeometry args={[roadLength, SIDEWALK_WIDTH]} />
          </mesh>
          {/* South Curb bevel */}
          <mesh position={[0, 0.04, z + ROAD_WIDTH / 2]} material={materials.curb}>
            <boxGeometry args={[roadLength, 0.06, 0.08]} />
          </mesh>
        </group>
      ))}

      {/* Z-axis avenues (running North-South) */}
      {avenuePositions.map((x, idx) => (
        <group key={`road-z-${idx}`}>
          {/* Main asphalt strip */}
          <mesh position={[x, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.asphalt} receiveShadow>
            <planeGeometry args={[ROAD_WIDTH, roadLength]} />
          </mesh>

          {/* West Sidewalk */}
          <mesh position={[x - ROAD_WIDTH / 2 - SIDEWALK_WIDTH / 2, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.sidewalk} receiveShadow>
            <planeGeometry args={[SIDEWALK_WIDTH, roadLength]} />
          </mesh>
          {/* West Curb bevel */}
          <mesh position={[x - ROAD_WIDTH / 2, 0.04, 0]} material={materials.curb}>
            <boxGeometry args={[0.08, 0.06, roadLength]} />
          </mesh>

          {/* East Sidewalk */}
          <mesh position={[x + ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.sidewalk} receiveShadow>
            <planeGeometry args={[SIDEWALK_WIDTH, roadLength]} />
          </mesh>
          {/* East Curb bevel */}
          <mesh position={[x + ROAD_WIDTH / 2, 0.04, 0]} material={materials.curb}>
            <boxGeometry args={[0.08, 0.06, roadLength]} />
          </mesh>
        </group>
      ))}

      {/* ── 2. Intersections & Crosswalks ──────────────────────── */}
      {avenuePositions.map((x, xi) =>
        avenuePositions.map((z, zi) => {
          // At each intersection (x, z):
          return (
            <group key={`int-${xi}-${zi}`} position={[x, 0, z]}>
              {/* Intersection center asphalt pad */}
              <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.asphalt}>
                <planeGeometry args={[ROAD_WIDTH + 0.1, ROAD_WIDTH + 0.1]} />
              </mesh>

              {/* Metallic street utility manhole cover */}
              <mesh position={[0.75, 0.022, 0.75]} rotation={[-Math.PI / 2, 0, 0]} material={materials.manhole}>
                <circleGeometry args={[0.34, 16]} />
              </mesh>

              {/* North Crosswalk */}
              <group position={[0, 0.022, -ROAD_WIDTH / 2 - 0.7]}>
                {[-1.2, -0.6, 0, 0.6, 1.2].map((offset, ki) => (
                  <mesh key={`cx-n-${ki}`} position={[offset, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.crosswalk}>
                    <planeGeometry args={[0.32, 0.9]} />
                  </mesh>
                ))}
              </group>

              {/* South Crosswalk */}
              <group position={[0, 0.022, ROAD_WIDTH / 2 + 0.7]}>
                {[-1.2, -0.6, 0, 0.6, 1.2].map((offset, ki) => (
                  <mesh key={`cx-s-${ki}`} position={[offset, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.crosswalk}>
                    <planeGeometry args={[0.32, 0.9]} />
                  </mesh>
                ))}
              </group>

              {/* West Crosswalk */}
              <group position={[-ROAD_WIDTH / 2 - 0.7, 0.022, 0]}>
                {[-1.2, -0.6, 0, 0.6, 1.2].map((offset, ki) => (
                  <mesh key={`cx-w-${ki}`} position={[0, 0, offset]} rotation={[-Math.PI / 2, 0, 0]} material={materials.crosswalk}>
                    <planeGeometry args={[0.9, 0.32]} />
                  </mesh>
                ))}
              </group>

              {/* East Crosswalk */}
              <group position={[ROAD_WIDTH / 2 + 0.7, 0.022, 0]}>
                {[-1.2, -0.6, 0, 0.6, 1.2].map((offset, ki) => (
                  <mesh key={`cx-e-${ki}`} position={[0, 0, offset]} rotation={[-Math.PI / 2, 0, 0]} material={materials.crosswalk}>
                    <planeGeometry args={[0.9, 0.32]} />
                  </mesh>
                ))}
              </group>

              {/* Traffic Signals at alternate intersections */}
              {(xi + zi) % 2 === 0 && xi > 0 && xi < GRID_SIZE && zi > 0 && zi < GRID_SIZE && (
                <group position={[ROAD_WIDTH / 2 + 0.6, 0, ROAD_WIDTH / 2 + 0.6]}>
                  {/* Vertical mast */}
                  <mesh position={[0, 2.2, 0]} material={materials.trafficPole}>
                    <cylinderGeometry args={[0.07, 0.09, 4.4, 8]} />
                  </mesh>
                  {/* Cantilever arm extending towards road */}
                  <mesh position={[-0.8, 4.2, 0]} rotation={[0, 0, Math.PI / 2]} material={materials.trafficPole}>
                    <cylinderGeometry args={[0.05, 0.05, 1.6, 8]} />
                  </mesh>
                  {/* Traffic light head */}
                  <mesh position={[-1.2, 4.0, 0]} material={materials.trafficBox}>
                    <boxGeometry args={[0.22, 0.65, 0.22]} />
                  </mesh>
                  {/* Red & Green indicators */}
                  <mesh position={[-1.2, 4.18, 0.12]} material={materials.signalRed}>
                    <circleGeometry args={[0.07, 12]} />
                  </mesh>
                  <mesh position={[-1.2, 3.82, 0.12]} material={materials.signalGreen}>
                    <circleGeometry args={[0.07, 12]} />
                  </mesh>
                </group>
              )}
            </group>
          );
        }),
      )}

      {/* ── 3. Road Dashed Center Divider Lines ────────────────── */}
      {/* Dashes along East-West avenues between intersections */}
      {avenuePositions.map((z, zi) =>
        Array.from({ length: GRID_SIZE }, (_, segIdx) => {
          const segCenterX = -HALF_GRID + segIdx * GRID_SPACING;
          return (
            <group key={`dash-x-${zi}-${segIdx}`} position={[segCenterX, 0.021, z]}>
              {dashSegments.dashes.map((dx, di) => (
                <mesh key={`dx-${di}`} position={[dx, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} material={materials.centerLine}>
                  <planeGeometry args={[dashSegments.dashLen * 0.75, 0.12]} />
                </mesh>
              ))}
            </group>
          );
        }),
      )}

      {/* Dashes along North-South avenues between intersections */}
      {avenuePositions.map((x, xi) =>
        Array.from({ length: GRID_SIZE }, (_, segIdx) => {
          const segCenterZ = -HALF_GRID + segIdx * GRID_SPACING;
          return (
            <group key={`dash-z-${xi}-${segIdx}`} position={[x, 0.021, segCenterZ]}>
              {dashSegments.dashes.map((dz, di) => (
                <mesh key={`dz-${di}`} position={[0, 0, dz]} rotation={[-Math.PI / 2, 0, 0]} material={materials.centerLine}>
                  <planeGeometry args={[0.12, dashSegments.dashLen * 0.75]} />
                </mesh>
              ))}
            </group>
          );
        }),
      )}

      {/* ── 4. Architectural Streetlamps & Street Furniture ─────── */}
      {avenuePositions.map((z, zi) =>
        Array.from({ length: GRID_SIZE }, (_, colIdx) => {
          const posX = -HALF_GRID + colIdx * GRID_SPACING;
          // Place lamps along sidewalk edge
          const lampPosZ = z + ROAD_WIDTH / 2 + SIDEWALK_WIDTH * 0.55;
          const isPointLightNode = (zi + colIdx) % 3 === 0;

          return (
            <group key={`furn-${zi}-${colIdx}`} position={[posX, 0, lampPosZ]}>
              {/* Lamp post base & vertical pole */}
              <mesh position={[0, 1.8, 0]} material={materials.lampPole} castShadow>
                <cylinderGeometry args={[0.06, 0.1, 3.6, 8]} />
              </mesh>
              {/* Curved lamp arm */}
              <mesh position={[0, 3.65, -0.45]} rotation={[0.4, 0, 0]} material={materials.lampPole}>
                <cylinderGeometry args={[0.04, 0.05, 1.1, 8]} />
              </mesh>
              {/* Lamp head fixture */}
              <mesh position={[0, 3.8, -0.85]} material={materials.lampPole}>
                <boxGeometry args={[0.26, 0.12, 0.45]} />
              </mesh>
              {/* Glowing emissive lens */}
              <mesh position={[0, 3.73, -0.85]} rotation={[Math.PI / 2, 0, 0]} material={materials.lampLight}>
                <planeGeometry args={[0.22, 0.38]} />
              </mesh>

              {/* Night illumination point light */}
              {isNight && isPointLightNode && (
                <pointLight
                  position={[0, 3.6, -0.85]}
                  color="#fff1ba"
                  intensity={0.45}
                  distance={16}
                  decay={2}
                />
              )}

              {/* Occasional Sidewalk Park Bench */}
              {(zi + colIdx) % 4 === 1 && (
                <group position={[3.2, 0, 0]} rotation={[0, Math.PI, 0]}>
                  {/* Bench seat slats */}
                  <mesh position={[0, 0.4, 0]} material={materials.benchWood}>
                    <boxGeometry args={[1.5, 0.08, 0.45]} />
                  </mesh>
                  {/* Bench backrest */}
                  <mesh position={[0, 0.72, 0.2]} rotation={[-0.1, 0, 0]} material={materials.benchWood}>
                    <boxGeometry args={[1.5, 0.4, 0.06]} />
                  </mesh>
                  {/* Bench legs */}
                  <mesh position={[-0.6, 0.2, 0]} material={materials.benchMetal}>
                    <boxGeometry args={[0.08, 0.4, 0.42]} />
                  </mesh>
                  <mesh position={[0.6, 0.2, 0]} material={materials.benchMetal}>
                    <boxGeometry args={[0.08, 0.4, 0.42]} />
                  </mesh>
                </group>
              )}

              {/* Occasional Fire Hydrant */}
              {(zi + colIdx) % 5 === 2 && (
                <group position={[-2.8, 0, 0]}>
                  <mesh position={[0, 0.35, 0]} material={materials.hydrant}>
                    <cylinderGeometry args={[0.13, 0.15, 0.7, 10]} />
                  </mesh>
                  <mesh position={[0, 0.72, 0]} material={materials.hydrant}>
                    <sphereGeometry args={[0.14, 8, 8]} />
                  </mesh>
                  <mesh position={[0, 0.4, 0]} rotation={[0, 0, Math.PI / 2]} material={materials.hydrant}>
                    <cylinderGeometry args={[0.07, 0.07, 0.42, 8]} />
                  </mesh>
                </group>
              )}
            </group>
          );
        }),
      )}
    </group>
  );
}
