// Developer City — building archetypes.
// Each archetype is a small function of primitives (boxes/cylinders/cones)
// tuned per project TYPE, so the city stays lightweight: no heavy model
// files, no external textures. A building is always: footprint + floors +
// signature detail (clock tower, awning, glass tower, garden roof, ...).

import { useMemo } from 'react';
import * as THREE from 'three';

export interface ArchetypeSpec {
  /** Tower dimensions (before user scale) */
  width: number;
  height: number;
  depth: number;
  /** Number of stacked floor slabs (visual banding) */
  slabs: number;
  /** Signature feature key, rendered by the switch in BuildingCore */
  feature: 'clockTower' | 'awning' | 'antenna' | 'garden' | 'beacon' | 'parapet';
  /** Floor-to-floor height used for window rows */
  floorH: number;
}

export function archetypeFor(style: string, _type: string): ArchetypeSpec {
  switch (style) {
    case 'college':
      return { width: 8, height: 4.5, depth: 8, slabs: 3, feature: 'clockTower', floorH: 1.5 };
    case 'ecommerce':
      return { width: 7, height: 5.5, depth: 7, slabs: 4, feature: 'awning', floorH: 1.4 };
    case 'business':
      return { width: 5, height: 11, depth: 5, slabs: 8, feature: 'antenna', floorH: 1.4 };
    case 'portfolio':
      return { width: 7, height: 4, depth: 7, slabs: 3, feature: 'garden', floorH: 1.4 };
    case 'saas':
      return { width: 5.5, height: 13, depth: 5.5, slabs: 9, feature: 'beacon', floorH: 1.5 };
    case 'custom':
      return { width: 9, height: 3.4, depth: 7, slabs: 2, feature: 'parapet', floorH: 1.5 };
    default:
      return { width: 6, height: 7.5, depth: 6, slabs: 5, feature: 'parapet', floorH: 1.5 };
  }
}

export interface WindowGrid {
  positions: THREE.Vector3[];
  /** which face each window sits on: +x, -x, +z, -z */
  rotY: number[];
  rows: number;
  cols: number;
}

/** Compute the instanced-window layout for a tower of the given size. */
export function windowGrid(spec: ArchetypeSpec, margin = 0.6): WindowGrid {
  const positions: THREE.Vector3[] = [];
  const rotY: number[] = [];
  const rows = Math.max(1, Math.floor(spec.height / spec.floorH) - 1);
  const colsX = Math.max(1, Math.floor((spec.width - 2 * margin) / 1.7));
  const colsZ = Math.max(1, Math.floor((spec.depth - 2 * margin) / 1.7));

  const placeRow = (row: number, count: number, face: 0 | 1 | 2 | 3) => {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      const v = spec.floorH * (row + 1);
      if (face === 0) positions.push(new THREE.Vector3(t * (spec.width - 1.2) * 0.9, v, spec.depth / 2 + 0.02));
      if (face === 1) positions.push(new THREE.Vector3(t * (spec.width - 1.2) * 0.9, v, -spec.depth / 2 - 0.02));
      if (face === 2) positions.push(new THREE.Vector3(spec.width / 2 + 0.02, v, t * (spec.depth - 1.2) * 0.9));
      if (face === 3) positions.push(new THREE.Vector3(-spec.width / 2 - 0.02, v, t * (spec.depth - 1.2) * 0.9));
      rotY.push(face === 2 || face === 3 ? Math.PI / 2 : 0);
    }
  };
  for (let r = 0; r < rows; r++) {
    placeRow(r, colsX, 0);
    placeRow(r, colsX, 1);
    placeRow(r, colsZ, 2);
    placeRow(r, colsZ, 3);
  }
  return { positions, rotY, rows, cols: colsX + colsZ };
}

export interface BuildingPaletteOptions {
  /** window glow color (palette slot 4); unset = subtle glass sheen */
  glow?: string;
  /** sign/logo plate background (palette slot 6); unset = theme trim */
  signBg?: string;
  /** trim color (palette slot 7); unset = accent */
  trim?: string;
}

export function useBuildingMaterials(
  facade: string,
  facadeDark: string,
  glass: string,
  accent: string,
  opts?: BuildingPaletteOptions,
): {
  wall: THREE.MeshStandardMaterial;
  wallDark: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  signBg: THREE.MeshStandardMaterial;
} {
  return useMemo(() => {
    const glow = opts?.glow;
    const trim = opts?.trim || accent;
    return {
      wall: new THREE.MeshStandardMaterial({ color: facade, roughness: 0.8, metalness: 0.05 }),
      wallDark: new THREE.MeshStandardMaterial({ color: facadeDark, roughness: 0.9, metalness: 0.02 }),
      glass: new THREE.MeshStandardMaterial({
        color: glass, roughness: 0.15, metalness: 0.4,
        emissive: new THREE.Color(glow || glass),
        emissiveIntensity: glow ? 0.45 : 0.2,
      }),
      accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, emissive: new THREE.Color(accent), emissiveIntensity: 0.35 }),
      trim: new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5, metalness: 0.2 }),
      signBg: new THREE.MeshStandardMaterial({ color: opts?.signBg || trim, roughness: 0.7 }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facade, facadeDark, glass, accent, opts?.glow, opts?.signBg, opts?.trim]);
}
