// Plot clearance shared by the tower, the curb, and the avenue.
// Plot centers are GRID_SPACING apart. The avenue between two plots is
// GRID_SPACING / 2 from each center. Cars and the building mass have to
// stay on their own side of that line or a car ends up inside the tower.

import { GRID_SPACING } from './CityGrid';
import { ROAD_WIDTH } from './CityRoads';
import { archetypeFor, type ArchetypeSpec } from './archetypes';

/** Near edge of the avenue, measured from the plot center. */
export const ROAD_INNER = GRID_SPACING / 2 - ROAD_WIDTH / 2;

/** Closest city-traffic lane edge (lane center minus a vehicle half-width). */
export const TRAVEL_LANE_INNER = GRID_SPACING / 2 - ROAD_WIDTH * 0.25 - 0.62;

/** Tower width and depth cap. Taller scales still grow in height only. */
export const TOWER_PAD = 7.2;

/** Podium lip past the tower face. */
export const PODIUM_OUTSET = 0.1;

/**
 * Furthest the entrance steps and canopy may stick past the tower face.
 * The curb lane starts outside this.
 */
export const CANOPY_REACH = 0.42;

/** Parked-car half extents. Length runs along local +Z before rotY. */
export const CAR_HALF_WIDTH = 0.58;
export const CAR_HALF_LENGTH = 1.22;

/**
 * Center of a parallel curb stall. The car's inner edge clears the canopy
 * and its outer edge stays off the travel lane.
 */
export const CURB = 4.82;

/** Moving terminal cars ride the avenue, not the front yard. */
export const AVENUE_OFFSET = GRID_SPACING / 2;

export interface Stall {
  x: number;
  z: number;
  rotY: number;
}

/** Eight curb stalls. None of them sit under the tower. */
export const PARKING_STALLS: Stall[] = [
  { x: -2.5, z: CURB, rotY: Math.PI / 2 },
  { x: 0, z: CURB, rotY: Math.PI / 2 },
  { x: 2.5, z: CURB, rotY: Math.PI / 2 },
  { x: 0, z: -CURB, rotY: Math.PI / 2 },
  { x: CURB, z: -2.4, rotY: 0 },
  { x: CURB, z: 0, rotY: 0 },
  { x: CURB, z: 2.4, rotY: 0 },
  { x: -CURB, z: 0, rotY: 0 },
];

export function stallFor(slotIndex: number): Stall {
  const slot = Math.abs(Math.trunc(Number(slotIndex)) || 0) % PARKING_STALLS.length;
  return PARKING_STALLS[slot];
}

export function clampTower(width: number, depth: number): { width: number; depth: number } {
  const fit = Math.min(1, TOWER_PAD / Math.max(width, depth, 0.01));
  return { width: width * fit, depth: depth * fit };
}

export function fittedArchetype(style: string, type: string, scale: number | undefined): ArchetypeSpec {
  const s = archetypeFor(style, type);
  const k = Math.max(0.4, Math.min(2.2, scale || 1));
  const foot = clampTower(s.width * k, s.depth * k);
  return {
    ...s,
    width: foot.width,
    depth: foot.depth,
    height: s.height * k,
    floorH: s.floorH * k,
  };
}

/** Axis-aligned footprint of the solid building, including podium and canopy. */
export function buildingFootprint(spec: { width: number; depth: number }): { halfX: number; halfZ: number } {
  return {
    halfX: spec.width / 2 + PODIUM_OUTSET,
    halfZ: spec.depth / 2 + CANOPY_REACH,
  };
}

export function carHalfExtents(rotY: number): { halfX: number; halfZ: number } {
  const parallel = Math.abs(Math.sin(rotY)) > 0.5;
  return parallel
    ? { halfX: CAR_HALF_LENGTH, halfZ: CAR_HALF_WIDTH }
    : { halfX: CAR_HALF_WIDTH, halfZ: CAR_HALF_LENGTH };
}
