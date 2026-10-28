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
      return { width: 8.5, height: 9.6, depth: 8.5, slabs: 6, feature: 'clockTower', floorH: 1.6 };
    case 'ecommerce':
      return { width: 8.0, height: 11.2, depth: 7.8, slabs: 7, feature: 'awning', floorH: 1.6 };
    case 'business':
      return { width: 6.8, height: 16.5, depth: 6.8, slabs: 10, feature: 'antenna', floorH: 1.65 };
    case 'portfolio':
      return { width: 7.8, height: 8.8, depth: 7.8, slabs: 5, feature: 'garden', floorH: 1.7 };
    case 'saas':
      return { width: 6.8, height: 18.0, depth: 6.8, slabs: 11, feature: 'beacon', floorH: 1.65 };
    case 'custom':
      return { width: 8.6, height: 11.2, depth: 7.8, slabs: 7, feature: 'parapet', floorH: 1.6 };
    default:
      return { width: 7.5, height: 12.0, depth: 7.2, slabs: 8, feature: 'parapet', floorH: 1.6 };
  }
}

export interface WindowGrid {
  positions: THREE.Vector3[];
  /** which face each window sits on: +x, -x, +z, -z */
  rotY: number[];
  rows: number;
  cols: number;
}

export interface WindowPane {
  width: number;
  height: number;
  /** Added to the floor-line y so the pane sits in the wall between cornices. */
  centerLift: number;
}

/** Glass size for one floor. The pane is shorter than the floor-to-floor gap. */
export function windowPane(spec: ArchetypeSpec): WindowPane {
  const band = Math.max(0.8, spec.floorH);
  return {
    width: Math.min(1.02, Math.max(0.72, band * 0.62)),
    height: band * 0.5,
    centerLift: band * 0.5,
  };
}

/**
 * One window per bay, centered in the wall BETWEEN floor cornices.
 * Cornices sit on `k * floorH`. A pane centered on that line is hidden
 * behind the band and reads as a solid black block.
 */
export function windowGrid(spec: ArchetypeSpec, margin = 0.8): WindowGrid {
  const positions: THREE.Vector3[] = [];
  const rotY: number[] = [];
  const pane = windowPane(spec);
  const floors = Math.max(1, Math.floor(spec.height / spec.floorH));
  const rows = Math.max(1, floors - 1);
  const colsX = Math.max(1, Math.floor((spec.width - 2 * margin) / 1.6));
  const colsZ = Math.max(1, Math.floor((spec.depth - 2 * margin) / 1.6));
  const faceGap = 0.05;

  const placeRow = (row: number, count: number, face: 0 | 1 | 2 | 3) => {
    const v = spec.floorH * (row + 1) + pane.centerLift;
    if (v - pane.height / 2 < spec.floorH * 0.85) return;
    if (v + pane.height / 2 > spec.height - 0.2) return;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      if (face === 0) {
        positions.push(new THREE.Vector3(t * (spec.width - 1.5), v, spec.depth / 2 + faceGap));
        rotY.push(0);
      }
      if (face === 1) {
        positions.push(new THREE.Vector3(t * (spec.width - 1.5), v, -spec.depth / 2 - faceGap));
        rotY.push(Math.PI);
      }
      if (face === 2) {
        positions.push(new THREE.Vector3(spec.width / 2 + faceGap, v, t * (spec.depth - 1.5)));
        rotY.push(Math.PI / 2);
      }
      if (face === 3) {
        positions.push(new THREE.Vector3(-spec.width / 2 - faceGap, v, t * (spec.depth - 1.5)));
        rotY.push(-Math.PI / 2);
      }
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
  frame: THREE.MeshStandardMaterial;
  windowFrame: THREE.MeshStandardMaterial;
  windowGlass: THREE.MeshStandardMaterial;
  roofDeck: THREE.MeshStandardMaterial;
  lobbyGlow: THREE.MeshStandardMaterial;
} {
  return useMemo(() => {
    const glow = opts?.glow;
    const trim = opts?.trim || accent;
    return {
      wall: new THREE.MeshStandardMaterial({
        color: facade,
        roughness: 0.55,
        metalness: 0.15,
      }),
      wallDark: new THREE.MeshStandardMaterial({
        color: facadeDark,
        roughness: 0.65,
        metalness: 0.25,
      }),
      glass: new THREE.MeshStandardMaterial({
        color: glass,
        roughness: 0.08,
        metalness: 0.85,
        emissive: new THREE.Color(glow || glass),
        emissiveIntensity: glow ? 0.45 : 0.25,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: accent,
        roughness: 0.35,
        metalness: 0.4,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.4,
      }),
      trim: new THREE.MeshStandardMaterial({
        color: trim,
        roughness: 0.3,
        metalness: 0.7,
      }),
      signBg: new THREE.MeshStandardMaterial({
        color: opts?.signBg || trim,
        roughness: 0.5,
        metalness: 0.3,
      }),
      frame: new THREE.MeshStandardMaterial({
        color: '#1a1f2c',
        roughness: 0.35,
        metalness: 0.75,
      }),
      // Light casing so the border reads on both cream and dark facades.
      // The glass pane sits in front of this, so the opening is not a black block.
      windowFrame: new THREE.MeshStandardMaterial({
        color: '#e7e5e4',
        roughness: 0.32,
        metalness: 0.55,
      }),
      windowGlass: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.06,
        metalness: 0.04,
        emissive: new THREE.Color('#fff7ed'),
        emissiveIntensity: 0.42,
        transparent: true,
        opacity: 0.94,
      }),
      roofDeck: new THREE.MeshStandardMaterial({
        color: '#1e2430',
        roughness: 0.9,
        metalness: 0.05,
      }),
      lobbyGlow: new THREE.MeshStandardMaterial({
        color: '#fef3c7',
        emissive: new THREE.Color('#fef3c7'),
        emissiveIntensity: 0.85,
        roughness: 0.2,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facade, facadeDark, glass, accent, opts?.glow, opts?.signBg, opts?.trim]);
}
