// Developer City — CityAtmosphere: drifting clouds in daytime,
// twinkling fireflies & atmospheric depth in night mode.

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { HALF_GRID } from './CityRoads';
import { useCityStore } from '@/city/store';

interface CloudData {
  x: number;
  y: number;
  z: number;
  scale: number;
  speed: number;
}

export function CityAtmosphere() {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';
  const bounds = HALF_GRID * 1.8;

  const clouds = useMemo(() => {
    const list: CloudData[] = [];
    const count = 10;
    for (let i = 0; i < count; i++) {
      list.push({
        x: ((i * 27) % (bounds * 2)) - bounds,
        y: 45 + (i % 4) * 6,
        z: ((i * 37) % (bounds * 2)) - bounds,
        scale: 2.2 + (i % 3) * 0.9,
        speed: 0.8 + (i % 3) * 0.4,
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
      roughness: 0.9,
      transparent: true,
      opacity: isNight ? 0.35 : 0.85,
      flatShading: true,
    });
  }, [isNight]);

  return (
    <group>
      {/* ── Low-poly Fluffy Clouds ───────────────────────────────── */}
      {clouds.map((c, i) => (
        <group
          key={`cloud-${i}`}
          scale={[c.scale, c.scale * 0.55, c.scale]}
          ref={(el) => {
            cloudRefs.current[i] = el;
          }}
        >
          {/* Main cloud cluster */}
          <mesh position={[0, 0, 0]} material={cloudMaterial}>
            <dodecahedronGeometry args={[3.2, 1]} />
          </mesh>
          <mesh position={[-2.4, -0.4, 0.4]} material={cloudMaterial}>
            <dodecahedronGeometry args={[2.4, 1]} />
          </mesh>
          <mesh position={[2.5, -0.3, -0.3]} material={cloudMaterial}>
            <dodecahedronGeometry args={[2.5, 1]} />
          </mesh>
          <mesh position={[0.8, 0.9, -0.5]} material={cloudMaterial}>
            <dodecahedronGeometry args={[2.1, 1]} />
          </mesh>
          <mesh position={[-1.2, 0.7, 0.3]} material={cloudMaterial}>
            <dodecahedronGeometry args={[2.0, 1]} />
          </mesh>
        </group>
      ))}

      {/* ── Nighttime Fireflies / Motes around Parks ─────────────── */}
      {isNight && (
        <NightFireflies />
      )}
    </group>
  );
}

function NightFireflies() {
  const count = 30;
  const fireflies = useMemo(() => {
    const pts = [];
    for (let i = 0; i < count; i++) {
      pts.push({
        x: (Math.random() - 0.5) * HALF_GRID * 1.5,
        y: 1.0 + Math.random() * 4.0,
        z: (Math.random() - 0.5) * HALF_GRID * 1.5,
        speed: 0.8 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return pts;
  }, [count]);

  const refs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    fireflies.forEach((f, i) => {
      const mesh = refs.current[i];
      if (mesh) {
        mesh.position.y = f.y + Math.sin(t * f.speed + f.phase) * 0.8;
        mesh.position.x = f.x + Math.cos(t * f.speed * 0.6 + f.phase) * 0.6;
      }
    });
  });

  const mat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: '#86efac',
      transparent: true,
      opacity: 0.8,
    });
  }, []);

  return (
    <group>
      {fireflies.map((f, i) => (
        <mesh
          key={`firefly-${i}`}
          position={[f.x, f.y, f.z]}
          material={mat}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.08, 6, 6]} />
        </mesh>
      ))}
    </group>
  );
}
