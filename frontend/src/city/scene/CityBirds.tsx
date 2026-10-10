// Developer City — CityBirds: animated flock of birds soaring over the city skyline.
// Includes articulated wing-flapping animation, gliding phases, and banking turns.

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { HALF_GRID } from './CityRoads';
import { useCityStore } from '@/city/store';

interface BirdData {
  radius: number;
  speed: number;
  baseHeight: number;
  heightVariation: number;
  phase: number;
  flapFrequency: number;
  featherColor: string;
}

export function CityBirds() {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';

  const birdCount = 18;
  const birds = useMemo(() => {
    const list: BirdData[] = [];
    const colors = ['#f8fafc', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b'];

    for (let i = 0; i < birdCount; i++) {
      list.push({
        radius: HALF_GRID * 0.45 + (i % 6) * 7.5 + Math.random() * 5,
        speed: 0.12 + (i % 4) * 0.04,
        baseHeight: 28 + (i % 5) * 4.5,
        heightVariation: 2.5 + (i % 3) * 1.5,
        phase: (i * (Math.PI * 2)) / birdCount + Math.random() * 0.4,
        flapFrequency: 12 + (i % 3) * 2.5,
        featherColor: colors[i % colors.length],
      });
    }
    return list;
  }, []);

  const birdRefs = useRef<(THREE.Group | null)[]>([]);
  const leftWingRefs = useRef<(THREE.Group | null)[]>([]);
  const rightWingRefs = useRef<(THREE.Group | null)[]>([]);

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();

    birds.forEach((b, i) => {
      const group = birdRefs.current[i];
      if (!group) return;

      // Circular/oval flight trajectory with sinusoidal swooping
      const angle = time * b.speed + b.phase;
      const x = Math.sin(angle) * b.radius;
      const z = Math.cos(angle * 0.8) * (b.radius * 0.9);
      const y = b.baseHeight + Math.sin(angle * 2.2 + b.phase) * b.heightVariation;

      group.position.set(x, y, z);

      // Tangent vector for facing direction
      const nextAngle = angle + 0.02;
      const nextX = Math.sin(nextAngle) * b.radius;
      const nextZ = Math.cos(nextAngle * 0.8) * (b.radius * 0.9);
      const dirX = nextX - x;
      const dirZ = nextZ - z;
      const yaw = Math.atan2(dirX, dirZ);

      // Banking angle (roll) when turning
      const bank = -Math.sin(angle) * 0.35;

      group.rotation.set(0, yaw, bank);

      // Wing-flapping vs. Gliding cycle
      // Every 6s cycle: 4s flapping, 2s smooth gliding
      const glideCycle = (time * 1.2 + b.phase) % 6;
      const isGliding = glideCycle > 4.2;

      const flapAngle = isGliding
        ? 0.08
        : Math.sin(time * b.flapFrequency + b.phase) * 0.55;

      const leftWing = leftWingRefs.current[i];
      const rightWing = rightWingRefs.current[i];
      if (leftWing) leftWing.rotation.z = flapAngle;
      if (rightWing) rightWing.rotation.z = -flapAngle;
    });
  });

  return (
    <group>
      {birds.map((b, i) => {
        const mat = new THREE.MeshStandardMaterial({
          color: isNight ? '#94a3b8' : b.featherColor,
          roughness: 0.7,
        });
        const beakMat = new THREE.MeshStandardMaterial({
          color: '#f59e0b',
          roughness: 0.6,
        });

        return (
          <group
            key={`bird-${i}`}
            ref={(el) => {
              birdRefs.current[i] = el;
            }}
          >
            {/* Bird Torso */}
            <mesh material={mat} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.16, 0.95, 6]} />
            </mesh>
            {/* Head & Beak */}
            <mesh position={[0, 0.06, 0.52]} material={mat}>
              <sphereGeometry args={[0.14, 6, 6]} />
            </mesh>
            <mesh position={[0, 0.04, 0.7]} rotation={[Math.PI / 2, 0, 0]} material={beakMat}>
              <coneGeometry args={[0.06, 0.22, 4]} />
            </mesh>

            {/* Left Wing (hinged at body edge) */}
            <group
              position={[-0.12, 0.04, 0.1]}
              ref={(el) => {
                leftWingRefs.current[i] = el;
              }}
            >
              <mesh position={[-0.45, 0, 0]} rotation={[0, 0.15, 0]} material={mat}>
                <boxGeometry args={[0.85, 0.03, 0.32]} />
              </mesh>
            </group>

            {/* Right Wing (hinged at body edge) */}
            <group
              position={[0.12, 0.04, 0.1]}
              ref={(el) => {
                rightWingRefs.current[i] = el;
              }}
            >
              <mesh position={[0.45, 0, 0]} rotation={[0, -0.15, 0]} material={mat}>
                <boxGeometry args={[0.85, 0.03, 0.32]} />
              </mesh>
            </group>

            {/* Tail feathers */}
            <mesh position={[0, 0.02, -0.55]} rotation={[-0.1, 0, 0]} material={mat}>
              <boxGeometry args={[0.26, 0.02, 0.35]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
