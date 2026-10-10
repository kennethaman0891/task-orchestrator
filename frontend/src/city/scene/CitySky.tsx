// Developer City — CitySky: majestic 3D Sun and Moon celestial bodies,
// solar flares, lunar craters, atmospheric glow, and twinkling night starfield.

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useCityStore } from '@/city/store';

export function CitySky() {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';
  const { camera } = useThree();

  // High celestial positions far beyond the city towers (> 300 units away)
  const sunPosition = useMemo(() => new THREE.Vector3(160, 240, 140), []);
  const moonPosition = useMemo(() => new THREE.Vector3(-150, 220, -130), []);

  const sunGlowRef = useRef<THREE.Group>(null);
  const moonGlowRef = useRef<THREE.Group>(null);
  const starsRef = useRef<THREE.Points>(null);

  // Billboard glow halos to always face camera
  useFrame(() => {
    if (sunGlowRef.current) {
      sunGlowRef.current.lookAt(camera.position);
    }
    if (moonGlowRef.current) {
      moonGlowRef.current.lookAt(camera.position);
    }
    if (starsRef.current && isNight) {
      starsRef.current.rotation.y += 0.0001;
    }
  });

  // Night Starfield
  const starPositions = useMemo(() => {
    const coords: number[] = [];
    const count = 450;
    const radius = 480;
    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      // Only upper hemisphere (sky)
      const y = Math.abs(Math.sin(phi)) * radius;
      const x = Math.cos(theta) * Math.cos(phi) * radius;
      const z = Math.sin(theta) * Math.cos(phi) * radius;
      coords.push(x, y + 10, z);
    }
    return new Float32Array(coords);
  }, []);

  return (
    <group>
      {/* ── 1. The Radiant 3D Sun (Daytime) ────────────────────────── */}
      {!isNight && (
        <group position={sunPosition.toArray()}>
          {/* Radiant Sun Core Sphere */}
          <mesh>
            <sphereGeometry args={[14, 32, 32]} />
            <meshBasicMaterial color="#ffffff" fog={false} />
          </mesh>

          {/* Sun Glow Halos & Corona */}
          <group ref={sunGlowRef}>
            {/* Inner intense solar corona */}
            <mesh>
              <ringGeometry args={[13.8, 30, 36]} />
              <meshBasicMaterial
                color="#fff6bf"
                transparent
                opacity={0.8}
                side={THREE.DoubleSide}
                fog={false}
                depthWrite={false}
              />
            </mesh>
            {/* Mid solar flare ring */}
            <mesh>
              <ringGeometry args={[30, 56, 36]} />
              <meshBasicMaterial
                color="#fed766"
                transparent
                opacity={0.4}
                side={THREE.DoubleSide}
                fog={false}
                depthWrite={false}
              />
            </mesh>
            {/* Outer atmospheric haze halo */}
            <mesh>
              <ringGeometry args={[56, 95, 36]} />
              <meshBasicMaterial
                color="#f59e0b"
                transparent
                opacity={0.16}
                side={THREE.DoubleSide}
                fog={false}
                depthWrite={false}
              />
            </mesh>
          </group>

          {/* Directional Sunlight shining from Sun down onto the city */}
          <directionalLight
            position={[0, 0, 0]}
            target-position={[0, 0, 0]}
            color="#fff8e7"
            intensity={1.85}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-85}
            shadow-camera-right={85}
            shadow-camera-top={85}
            shadow-camera-bottom={-85}
            shadow-camera-near={100}
            shadow-camera-far={600}
          />
        </group>
      )}

      {/* ── 2. The Luminous 3D Moon & Starfield (Nighttime) ─────────── */}
      {isNight && (
        <group position={moonPosition.toArray()}>
          {/* Main Moon Sphere */}
          <mesh>
            <sphereGeometry args={[11, 32, 32]} />
            <meshStandardMaterial
              color="#f1f5f9"
              emissive="#cbd5e1"
              emissiveIntensity={1.4}
              roughness={0.85}
              metalness={0.1}
              fog={false}
            />
          </mesh>

          {/* Lunar Dark Maria / Craters */}
          {[-1.8, 1.5, -0.6, 2.2].map((cx, i) => (
            <mesh key={`crater-${i}`} position={[cx, (i - 1.5) * 2.5, 9.8]}>
              <circleGeometry args={[2.2 - (i % 2) * 0.6, 16]} />
              <meshBasicMaterial
                color="#64748b"
                transparent
                opacity={0.4}
                fog={false}
                depthWrite={false}
              />
            </mesh>
          ))}

          {/* Moonlight Atmospheric Halo */}
          <group ref={moonGlowRef}>
            <mesh>
              <ringGeometry args={[10.8, 28, 36]} />
              <meshBasicMaterial
                color="#bfdbfe"
                transparent
                opacity={0.45}
                side={THREE.DoubleSide}
                fog={false}
                depthWrite={false}
              />
            </mesh>
            <mesh>
              <ringGeometry args={[28, 55, 36]} />
              <meshBasicMaterial
                color="#60a5fa"
                transparent
                opacity={0.18}
                side={THREE.DoubleSide}
                fog={false}
                depthWrite={false}
              />
            </mesh>
          </group>

          {/* Directional Moonlight shining from Moon down onto the city */}
          <directionalLight
            position={[0, 0, 0]}
            target-position={[0, 0, 0]}
            color="#a5c4ff"
            intensity={1.25}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-85}
            shadow-camera-right={85}
            shadow-camera-top={85}
            shadow-camera-bottom={-85}
            shadow-camera-near={100}
            shadow-camera-far={600}
          />
        </group>
      )}

      {/* ── 3. Night Celestial Starfield ───────────────────────────── */}
      {isNight && (
        <points ref={starsRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[starPositions, 3]}
            />
          </bufferGeometry>
          <pointsMaterial
            size={2.2}
            color="#ffffff"
            transparent
            opacity={0.85}
            sizeAttenuation
            fog={false}
          />
        </points>
      )}
    </group>
  );
}
