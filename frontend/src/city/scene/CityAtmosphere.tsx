// Developer City — CityAtmosphere: drifting clouds in daytime,
// twinkling fireflies & atmospheric depth in night mode.

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import { HALF_GRID } from './CityRoads';
import { useCityStore } from '@/city/store';

interface CloudData {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  speed: number;
}

export function CityAtmosphere() {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';
  const bounds = HALF_GRID * 2.2;

  // More natural elongated cumulus cloud formations
  const clouds = useMemo(() => {
    const list: CloudData[] = [];
    const count = 12;
    for (let i = 0; i < count; i++) {
      list.push({
        x: ((i * 31) % (bounds * 2)) - bounds,
        y: 42 + (i % 4) * 5,
        z: ((i * 43) % (bounds * 2)) - bounds,
        scaleX: 3.2 + (i % 3) * 1.4,
        scaleY: 1.2 + (i % 2) * 0.5,
        scaleZ: 2.8 + (i % 3) * 1.2,
        speed: 0.6 + (i % 4) * 0.35,
      });
    }
    return list;
  }, [bounds]);

  const cloudRefs = useRef<(THREE.Group | null)[]>([]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    clouds.forEach((c, i) => {
      c.x += c.speed * dt;
      if (c.x > bounds) c.x = -bounds;
      const grp = cloudRefs.current[i];
      if (grp) grp.position.set(c.x, c.y, c.z);
    });
  });

  const cloudMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: isNight ? '#1e293b' : '#ffffff',
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: isNight ? 0.38 : 0.82,
      depthWrite: false,
    });
  }, [isNight]);

  return (
    <group>
      {/* ── Soft Volumetric Cumulus Clouds ─────────────────────────── */}
      {clouds.map((c, i) => (
        <group
          key={`cloud-${i}`}
          scale={[c.scaleX, c.scaleY, c.scaleZ]}
          ref={(el) => {
            cloudRefs.current[i] = el;
          }}
        >
          {/* Main cloud body */}
          <mesh position={[0, 0, 0]} material={cloudMaterial}>
            <sphereGeometry args={[2.8, 14, 14]} />
          </mesh>
          <mesh position={[-2.2, -0.2, 0.3]} material={cloudMaterial}>
            <sphereGeometry args={[2.2, 12, 12]} />
          </mesh>
          <mesh position={[2.4, -0.2, -0.2]} material={cloudMaterial}>
            <sphereGeometry args={[2.3, 12, 12]} />
          </mesh>
          <mesh position={[0.7, 0.8, -0.4]} material={cloudMaterial}>
            <sphereGeometry args={[1.9, 12, 12]} />
          </mesh>
          <mesh position={[-1.1, 0.6, 0.3]} material={cloudMaterial}>
            <sphereGeometry args={[1.8, 12, 12]} />
          </mesh>
          <mesh position={[0.2, -0.3, 1.4]} material={cloudMaterial}>
            <sphereGeometry args={[1.7, 10, 10]} />
          </mesh>
        </group>
      ))}

      {/* ── Atmospheric Motes & Cyber Dust ─────────────────────────── */}
      <Sparkles
        count={isNight ? 120 : 60}
        scale={[bounds * 1.5, 30, bounds * 1.5]}
        position={[0, 12, 0]}
        size={isNight ? 4.0 : 3.0}
        speed={0.4}
        opacity={isNight ? 0.75 : 0.35}
        color={isNight ? '#38bdf8' : '#fde047'}
      />
    </group>
  );
}
