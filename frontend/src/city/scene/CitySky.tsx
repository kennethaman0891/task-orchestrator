// Developer City — CitySky: majestic 3D Sun and Moon celestial bodies,
// solar flares, lunar craters, atmospheric glow, and twinkling night starfield.

import { useMemo, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { useCityStore } from '@/city/store';

export function CitySky() {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';
  const { camera, scene } = useThree();

  // High celestial positions far beyond the city towers (> 300 units away)
  const sunPosition = useMemo(() => new THREE.Vector3(140, 220, 120), []);
  const moonPosition = useMemo(() => new THREE.Vector3(-140, 200, -110), []);

  const sunGlowRef = useRef<THREE.Group>(null);
  const moonGlowRef = useRef<THREE.Group>(null);
  const sunLightRef = useRef<THREE.DirectionalLight>(null);
  const moonLightRef = useRef<THREE.DirectionalLight>(null);

  // Dedicated light target object placed at the center of the city (0, 0, 0)
  const [lightTarget] = useState(() => {
    const obj = new THREE.Object3D();
    obj.position.set(0, 0, 0);
    return obj;
  });

  useEffect(() => {
    scene.add(lightTarget);
    return () => {
      scene.remove(lightTarget);
    };
  }, [scene, lightTarget]);

  useEffect(() => {
    if (sunLightRef.current) {
      sunLightRef.current.target = lightTarget;
    }
    if (moonLightRef.current) {
      moonLightRef.current.target = lightTarget;
    }
  }, [lightTarget, isNight]);

  // Billboard glow halos to always face camera
  useFrame(() => {
    if (sunGlowRef.current) {
      sunGlowRef.current.lookAt(camera.position);
    }
    if (moonGlowRef.current) {
      moonGlowRef.current.lookAt(camera.position);
    }
  });

  return (
    <group>
      {/* ── 1. The Radiant 3D Sun (Daytime) ────────────────────────── */}
      {!isNight && (
        <>
          <group position={sunPosition.toArray()}>
            {/* Radiant Sun Core Sphere */}
            <mesh>
              <sphereGeometry args={[14, 32, 32]} />
              <meshBasicMaterial color="#fffbeb" fog={false} />
            </mesh>

            {/* Billboarding Corona Glow Halos */}
            <group ref={sunGlowRef}>
              <mesh>
                <ringGeometry args={[13.8, 32, 36]} />
                <meshBasicMaterial
                  color="#fef08a"
                  transparent
                  opacity={0.65}
                  side={THREE.DoubleSide}
                  fog={false}
                  depthWrite={false}
                />
              </mesh>
              <mesh>
                <ringGeometry args={[30, 60, 36]} />
                <meshBasicMaterial
                  color="#fde047"
                  transparent
                  opacity={0.35}
                  side={THREE.DoubleSide}
                  fog={false}
                  depthWrite={false}
                />
              </mesh>
              <mesh>
                <ringGeometry args={[56, 110, 36]} />
                <meshBasicMaterial
                  color="#fbbf24"
                  transparent
                  opacity={0.15}
                  side={THREE.DoubleSide}
                  fog={false}
                  depthWrite={false}
                />
              </mesh>
            </group>
          </group>

          {/* Directional Sunlight shining from Sun down onto the city */}
          <directionalLight
            ref={sunLightRef}
            position={sunPosition.toArray()}
            color="#fff8e7"
            intensity={2.2}
            castShadow
            shadow-bias={-0.00015}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-90}
            shadow-camera-right={90}
            shadow-camera-top={90}
            shadow-camera-bottom={-90}
            shadow-camera-near={100}
            shadow-camera-far={500}
          />
        </>
      )}

      {/* ── 2. The Luminous 3D Moon & Starfield (Nighttime) ─────────── */}
      {isNight && (
        <>
          <group position={moonPosition.toArray()}>
            {/* Main Moon Sphere */}
            <mesh>
              <sphereGeometry args={[12, 32, 32]} />
              <meshStandardMaterial
                color="#f8fafc"
                emissive="#e2e8f0"
                emissiveIntensity={1.3}
                roughness={0.8}
                metalness={0.1}
                fog={false}
              />
            </mesh>

            {/* Lunar Dark Maria / Craters */}
            {[-1.8, 1.5, -0.6, 2.2].map((cx, i) => (
              <mesh key={`crater-${i}`} position={[cx, (i - 1.5) * 2.5, 10.6]}>
                <circleGeometry args={[2.2 - (i % 2) * 0.6, 16]} />
                <meshBasicMaterial
                  color="#475569"
                  transparent
                  opacity={0.45}
                  fog={false}
                  depthWrite={false}
                />
              </mesh>
            ))}

            {/* Moonlight Atmospheric Halo */}
            <group ref={moonGlowRef}>
              <mesh>
                <ringGeometry args={[11.8, 30, 36]} />
                <meshBasicMaterial
                  color="#93c5fd"
                  transparent
                  opacity={0.5}
                  side={THREE.DoubleSide}
                  fog={false}
                  depthWrite={false}
                />
              </mesh>
              <mesh>
                <ringGeometry args={[30, 65, 36]} />
                <meshBasicMaterial
                  color="#3b82f6"
                  transparent
                  opacity={0.18}
                  side={THREE.DoubleSide}
                  fog={false}
                  depthWrite={false}
                />
              </mesh>
            </group>
          </group>

          {/* Directional Moonlight shining from Moon down onto the city */}
          <directionalLight
            ref={moonLightRef}
            position={moonPosition.toArray()}
            color="#93c5fd"
            intensity={1.4}
            castShadow
            shadow-bias={-0.00015}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-90}
            shadow-camera-right={90}
            shadow-camera-top={90}
            shadow-camera-bottom={-90}
            shadow-camera-near={100}
            shadow-camera-far={500}
          />

          {/* Shimmering Multi-Depth Celestial Stars */}
          <Stars
            radius={320}
            depth={80}
            count={3200}
            factor={4.5}
            saturation={0.4}
            fade
            speed={0.8}
          />
        </>
      )}
    </group>
  );
}
