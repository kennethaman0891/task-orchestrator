// Developer City — CarBody: miniature terminal car.
// No spec draws the low-poly sedan (Y up, front +Z). A spec draws its parts.
// One material per hex, created in useMemo so the mesh loop does not allocate.

import { useMemo } from 'react';
import * as THREE from 'three';
import type { CarSpec } from '@/city/types';

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function materialFor(key: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial(params);
  materialCache.set(key, material);
  return material;
}

const WINDOW = '#0f172a';
const WHEEL = '#1e293b';
const HEADLIGHT = '#ffffff';
const TAILLIGHT = '#ef4444';

const WHEEL_SLOTS: [number, number, number][] = [
  [-0.56, 0.2, 0.7],
  [0.56, 0.2, 0.7],
  [-0.56, 0.2, -0.7],
  [0.56, 0.2, -0.7],
];

export function CarBody({ color, spec }: { color: string; spec?: CarSpec | null }) {
  const materials = useMemo(() => {
    if (spec) {
      const byHex = new Map<string, THREE.MeshStandardMaterial>();
      for (const part of spec.parts) {
        const hex = part.color.toLowerCase();
        if (byHex.has(hex)) continue;
        byHex.set(hex, materialFor(`part:${hex}`, {
          color: part.color,
          metalness: 0.4,
          roughness: 0.4,
        }));
      }
      return { mode: 'spec' as const, byHex };
    }
    const bodyKey = `sedan:body:${color.toLowerCase()}`;
    return {
      mode: 'sedan' as const,
      body: materialFor(bodyKey, { color, metalness: 0.4, roughness: 0.4 }),
      window: materialFor('sedan:window', { color: WINDOW, roughness: 0.1, metalness: 0.9 }),
      wheel: materialFor('sedan:wheel', { color: WHEEL, roughness: 0.9 }),
      headlight: materialFor('sedan:headlight', {
        color: HEADLIGHT,
        emissive: HEADLIGHT,
        emissiveIntensity: 1,
      }),
      taillight: materialFor('sedan:taillight', {
        color: TAILLIGHT,
        emissive: TAILLIGHT,
        emissiveIntensity: 1.2,
      }),
    };
  }, [color, spec]);

  if (spec && materials.mode === 'spec') {
    return (
      <group>
        {spec.parts.map((part, index) => (
          <mesh
            key={index}
            position={part.position}
            material={materials.byHex.get(part.color.toLowerCase())}
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

  if (materials.mode !== 'sedan') return null;

  return (
    <group>
      <group position={[0, 0.22, 0]}>
        {/* Body only — cabin, glass, and lamps do not cast. */}
        <mesh position={[0, 0.15, 0]} material={materials.body} castShadow>
          <boxGeometry args={[1.1, 0.3, 2.4]} />
        </mesh>
        <mesh position={[0, 0.4, -0.15]} material={materials.body}>
          <boxGeometry args={[0.92, 0.25, 1.25]} />
        </mesh>
        <mesh position={[0, 0.39, 0.52]} rotation={[-0.4, 0, 0]} material={materials.window}>
          <boxGeometry args={[0.9, 0.25, 0.08]} />
        </mesh>
        <mesh position={[0, 0.39, -0.8]} rotation={[0.3, 0, 0]} material={materials.window}>
          <boxGeometry args={[0.9, 0.25, 0.08]} />
        </mesh>
      </group>

      <mesh position={[-0.38, 0.32, 1.16]} material={materials.headlight}>
        <boxGeometry args={[0.2, 0.1, 0.08]} />
      </mesh>
      <mesh position={[0.38, 0.32, 1.16]} material={materials.headlight}>
        <boxGeometry args={[0.2, 0.1, 0.08]} />
      </mesh>
      <mesh position={[-0.38, 0.32, -1.16]} material={materials.taillight}>
        <boxGeometry args={[0.2, 0.08, 0.08]} />
      </mesh>
      <mesh position={[0.38, 0.32, -1.16]} material={materials.taillight}>
        <boxGeometry args={[0.2, 0.08, 0.08]} />
      </mesh>

      {WHEEL_SLOTS.map((position, index) => (
        <mesh
          key={index}
          position={position}
          rotation={[0, 0, Math.PI / 2]}
          material={materials.wheel}
        >
          <cylinderGeometry args={[0.2, 0.2, 0.14, 12]} />
        </mesh>
      ))}
    </group>
  );
}
