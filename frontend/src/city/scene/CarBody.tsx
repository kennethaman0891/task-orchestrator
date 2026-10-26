// Developer City — CarBody: miniature terminal car.
// Upgraded to a sleek, aerodynamic Cyber-Vehicle with volumetric headlights,
// dynamic ground underglow, tinted panoramic glass, and alloy rim detailing.

import { useMemo } from 'react';
import * as THREE from 'three';
import type { CarSpec } from '@/city/types';

const materialCache = new Map<string, THREE.Material>();

function materialFor<T extends THREE.Material>(key: string, factory: () => T): T {
  const cached = materialCache.get(key);
  if (cached) return cached as T;
  const created = factory();
  materialCache.set(key, created);
  return created;
}

const WHEEL_SLOTS: [number, number, number][] = [
  [-0.58, 0.22, 0.72],
  [0.58, 0.22, 0.72],
  [-0.58, 0.22, -0.72],
  [0.58, 0.22, -0.72],
];

export function CarBody({ color, spec, moving = false }: { color: string; spec?: CarSpec | null; moving?: boolean }) {
  const hex = color.toLowerCase();

  const mats = useMemo(() => {
    if (spec) {
      const byHex = new Map<string, THREE.MeshStandardMaterial>();
      for (const part of spec.parts) {
        const pColor = part.color.toLowerCase();
        if (byHex.has(pColor)) continue;
        byHex.set(
          pColor,
          materialFor(`part:${pColor}`, () => new THREE.MeshStandardMaterial({
            color: part.color,
            metalness: 0.6,
            roughness: 0.3,
          }))
        );
      }
      return { mode: 'spec' as const, byHex };
    }

    return {
      mode: 'sedan' as const,
      // High-gloss automotive finish
      body: materialFor(`cyber:body:${hex}`, () => new THREE.MeshStandardMaterial({
        color,
        metalness: 0.82,
        roughness: 0.22,
      })),
      bodyTrim: materialFor('cyber:trim', () => new THREE.MeshStandardMaterial({
        color: '#090d16',
        metalness: 0.5,
        roughness: 0.4,
      })),
      // Tinted glass canopy with inner reflection
      canopy: materialFor('cyber:canopy', () => new THREE.MeshStandardMaterial({
        color: '#0f172a',
        metalness: 0.95,
        roughness: 0.08,
      })),
      // Wheel rim & rubber
      tire: materialFor('cyber:tire', () => new THREE.MeshStandardMaterial({
        color: '#111827',
        roughness: 0.88,
      })),
      rim: materialFor('cyber:rim', () => new THREE.MeshStandardMaterial({
        color: '#94a3b8',
        metalness: 0.9,
        roughness: 0.15,
      })),
      // Headlight crystal: subtle when parked, bright when driving
      headlightBar: materialFor(`cyber:headlight:${moving ? 'moving' : 'parked'}`, () => new THREE.MeshStandardMaterial({
        color: '#ffffff',
        emissive: '#ffffff',
        emissiveIntensity: moving ? 2.4 : 0.7,
      })),
      // Tail light neon
      taillightBar: materialFor(`cyber:taillight:${moving ? 'moving' : 'parked'}`, () => new THREE.MeshStandardMaterial({
        color: '#ef4444',
        emissive: '#ef4444',
        emissiveIntensity: moving ? 2.6 : 0.9,
      })),
      // Soft volumetric forward beam (only active when driving)
      headlightBeam: materialFor('cyber:beam', () => new THREE.MeshBasicMaterial({
        color: '#e0f2fe',
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })),
      // Ground neon underglow pool
      underglow: materialFor(`cyber:underglow:${hex}:${moving ? 'moving' : 'parked'}`, () => new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: moving ? 0.45 : 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })),
    };
  }, [color, hex, spec, moving]);

  if (spec && mats.mode === 'spec') {
    return (
      <group>
        {spec.parts.map((part, index) => (
          <mesh
            key={index}
            position={part.position}
            material={mats.byHex.get(part.color.toLowerCase())}
            castShadow={part.shape === 'box'}
          >
            {part.shape === 'box' ? (
              <boxGeometry args={part.size} />
            ) : (
              <cylinderGeometry args={[part.size[0], part.size[1], part.size[2], 12]} />
            )}
          </mesh>
        ))}
      </group>
    );
  }

  if (mats.mode !== 'sedan') return null;

  return (
    <group>
      {/* ── 1. Aerodynamic Cyber Chassis ───────────────────────────── */}
      <group position={[0, 0.22, 0]}>
        {/* Main lower aerodynamic hull with front wedge */}
        <mesh position={[0, 0.14, 0]} material={mats.body} castShadow receiveShadow>
          <boxGeometry args={[1.12, 0.22, 2.36]} />
        </mesh>

        {/* Front nose wedge slope */}
        <mesh position={[0, 0.12, 1.14]} rotation={[0.26, 0, 0]} material={mats.body}>
          <boxGeometry args={[1.06, 0.16, 0.38]} />
        </mesh>

        {/* Lower ground-effect side skirts */}
        <mesh position={[-0.57, 0.04, 0]} material={mats.bodyTrim}>
          <boxGeometry args={[0.06, 0.08, 1.8]} />
        </mesh>
        <mesh position={[0.57, 0.04, 0]} material={mats.bodyTrim}>
          <boxGeometry args={[0.06, 0.08, 1.8]} />
        </mesh>

        {/* Streamlined Fastback Cabin Canopy */}
        <mesh position={[0, 0.38, -0.1]} material={mats.canopy} castShadow>
          <boxGeometry args={[0.88, 0.28, 1.35]} />
        </mesh>

        {/* Sloping Front Windshield */}
        <mesh position={[0, 0.36, 0.62]} rotation={[-0.48, 0, 0]} material={mats.canopy}>
          <boxGeometry args={[0.86, 0.26, 0.12]} />
        </mesh>

        {/* Sloping Rear Glass & Trunk */}
        <mesh position={[0, 0.35, -0.84]} rotation={[0.42, 0, 0]} material={mats.canopy}>
          <boxGeometry args={[0.86, 0.24, 0.14]} />
        </mesh>

        {/* Rear Integrated Aero Lip Spoiler */}
        <mesh position={[0, 0.28, -1.18]} material={mats.bodyTrim}>
          <boxGeometry args={[0.96, 0.06, 0.16]} />
        </mesh>
      </group>

      {/* ── 2. High-Tech Continuous Front LED Lightbar ─────────────── */}
      <mesh position={[0, 0.34, 1.28]} material={mats.headlightBar}>
        <boxGeometry args={[0.94, 0.06, 0.04]} />
      </mesh>

      {/* Volumetric Dual Forward Light Cones (Only active when moving on the road) */}
      {moving && (
        <>
          <group position={[-0.34, 0.32, 1.3]}>
            <mesh rotation={[Math.PI / 2 + 0.18, 0, 0]} position={[0, -0.12, 1.1]} material={mats.headlightBeam}>
              <cylinderGeometry args={[0.04, 0.32, 2.0, 16, 1, true]} />
            </mesh>
          </group>
          <group position={[0.34, 0.32, 1.3]}>
            <mesh rotation={[Math.PI / 2 + 0.18, 0, 0]} position={[0, -0.12, 1.1]} material={mats.headlightBeam}>
              <cylinderGeometry args={[0.04, 0.32, 2.0, 16, 1, true]} />
            </mesh>
          </group>
        </>
      )}

      {/* ── 3. High-Intensity Rear Crimson Lightbar ───────────────── */}
      <mesh position={[0, 0.34, -1.22]} material={mats.taillightBar}>
        <boxGeometry args={[0.98, 0.05, 0.04]} />
      </mesh>

      {/* ── 4. Ground Neon Underglow Halo ─────────────────────────── */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.underglow}>
        <planeGeometry args={[1.5, 2.6]} />
      </mesh>

      {/* ── 5. Alloy Rims & Wheels with Brake Disc Details ────────── */}
      {WHEEL_SLOTS.map((position, index) => (
        <group key={`wheel-${index}`} position={position}>
          {/* Rubber Tire */}
          <mesh rotation={[0, 0, Math.PI / 2]} material={mats.tire} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 0.16, 16]} />
          </mesh>
          {/* Metallic Inner Rim */}
          <mesh
            position={[position[0] > 0 ? 0.02 : -0.02, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
            material={mats.rim}
          >
            <cylinderGeometry args={[0.16, 0.16, 0.15, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
