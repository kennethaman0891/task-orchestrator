// Building mass, windows, and cars have to occupy different space.
// A pane centered on a floor band reads as a solid block. A car whose
// box intersects the tower is the "submerged in the building" bug.

import assert from 'node:assert/strict';
import { windowGrid, windowPane } from './archetypes';
import { layoutDistrict } from './roadLayout';
import {
  AVENUE_OFFSET,
  buildingFootprint,
  CAR_HALF_LENGTH,
  carHalfExtents,
  fittedArchetype,
  PARKING_STALLS,
  TRAVEL_LANE_INNER,
} from './plotFit';

const STYLES = ['college', 'ecommerce', 'business', 'portfolio', 'saas', 'custom'] as const;

function overlaps(
  ax0: number, ax1: number, az0: number, az1: number,
  bx0: number, bx1: number, bz0: number, bz1: number,
): boolean {
  return ax0 < bx1 && ax1 > bx0 && az0 < bz1 && az1 > bz0;
}

for (const style of STYLES) {
  for (const scale of [1, 2.2]) {
    const spec = fittedArchetype(style, style, scale);
    const foot = buildingFootprint(spec);
    assert.ok(foot.halfX < TRAVEL_LANE_INNER, `${style} x footprint reaches the travel lane`);
    assert.ok(foot.halfZ < TRAVEL_LANE_INNER, `${style} z footprint reaches the travel lane`);
    assert.ok(spec.width <= 7.2 + 1e-6 && spec.depth <= 7.2 + 1e-6, `${style} tower exceeds the pad`);

    const pane = windowPane(spec);
    const grid = windowGrid(spec);
    assert.ok(grid.positions.length >= 8, `${style} has no window bays`);
    const cornices: number[] = [];
    const floors = Math.floor(spec.height / spec.floorH);
    for (let k = 1; k < floors; k++) cornices.push(k * spec.floorH);
    for (const pos of grid.positions) {
      const onFace =
        Math.abs(Math.abs(pos.x) - spec.width / 2) < 0.2 ||
        Math.abs(Math.abs(pos.z) - spec.depth / 2) < 0.2;
      assert.ok(onFace, `${style} window is not on a wall`);
      for (const line of cornices) {
        const gap = Math.abs(pos.y - line) - pane.height / 2;
        assert.ok(gap > 0.05, `${style} window is cut by a floor band`);
      }
    }
  }
}

for (const stall of PARKING_STALLS) {
  const half = carHalfExtents(stall.rotY);
  const spec = fittedArchetype('college', 'college', 2.2);
  const foot = buildingFootprint(spec);
  const hit = overlaps(
    stall.x - half.halfX, stall.x + half.halfX,
    stall.z - half.halfZ, stall.z + half.halfZ,
    -foot.halfX, foot.halfX,
    -foot.halfZ, foot.halfZ,
  );
  assert.equal(hit, false, `stall at ${stall.x},${stall.z} is inside the tower`);
  const outer = Math.max(Math.abs(stall.x) + half.halfX, Math.abs(stall.z) + half.halfZ);
  assert.ok(outer < TRAVEL_LANE_INNER, `stall at ${stall.x},${stall.z} blocks the travel lane`);
}

const moving = layoutDistrict('p', 'root', ['src', 'web'], 'src/app');
for (const seg of moving) {
  const rear = seg.z - CAR_HALF_LENGTH;
  const spec = fittedArchetype('custom', 'custom', 2.2);
  const foot = buildingFootprint(spec);
  assert.ok(rear > foot.halfZ, `${seg.relativePath || 'root'} car still enters the tower`);
  assert.ok(Math.abs(seg.z - AVENUE_OFFSET) < 0.3, 'moving car left the avenue');
}

console.log('city clearance ok', {
  windows: windowGrid(fittedArchetype('custom', 'custom', 1)).positions.length,
  stalls: PARKING_STALLS.length,
});
