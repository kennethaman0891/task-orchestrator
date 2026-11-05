import assert from 'node:assert';
import {
  computeChromeTargetIndex,
  computeChromeShiftOffsets,
  computeChromeSnapOffset,
  computeEdgeScrollVelocity,
} from './useChromeTabDrag';

console.log('🧪 Starting Chrome Tab Drag Engine Tests...');

// ── Test Suite 1: computeChromeTargetIndex ──
console.log('▶ Test Suite 1: computeChromeTargetIndex calculations');

// 2 Tabs
{
  const midpoints = [50, 150];
  // Dragging tab 0 rightward
  assert.strictEqual(computeChromeTargetIndex(0, 40, midpoints), 0, 'Tab 0 stays at 0 before midpoint 1');
  assert.strictEqual(computeChromeTargetIndex(0, 149, midpoints), 0, 'Tab 0 stays at 0 just before midpoint 1');
  assert.strictEqual(computeChromeTargetIndex(0, 151, midpoints), 1, 'Tab 0 crosses midpoint 1 -> slot 1');

  // Dragging tab 1 leftward
  assert.strictEqual(computeChromeTargetIndex(1, 160, midpoints), 1, 'Tab 1 stays at 1 after midpoint 0');
  assert.strictEqual(computeChromeTargetIndex(1, 51, midpoints), 1, 'Tab 1 stays at 1 just after midpoint 0');
  assert.strictEqual(computeChromeTargetIndex(1, 49, midpoints), 0, 'Tab 1 crosses midpoint 0 leftward -> slot 0');
}

// 3 Tabs: [0: 50, 1: 150, 2: 250]
{
  const midpoints = [50, 150, 250];

  // Drag tab 0 (leftmost)
  assert.strictEqual(computeChromeTargetIndex(0, 40, midpoints), 0, 'Tab 0 at start');
  assert.strictEqual(computeChromeTargetIndex(0, 160, midpoints), 1, 'Tab 0 moved past tab 1');
  assert.strictEqual(computeChromeTargetIndex(0, 260, midpoints), 2, 'Tab 0 moved past tab 2');
  assert.strictEqual(computeChromeTargetIndex(0, 999, midpoints), 2, 'Tab 0 clamped at max slot');

  // Drag tab 2 (rightmost)
  assert.strictEqual(computeChromeTargetIndex(2, 260, midpoints), 2, 'Tab 2 at start');
  assert.strictEqual(computeChromeTargetIndex(2, 140, midpoints), 1, 'Tab 2 moved left past tab 1');
  assert.strictEqual(computeChromeTargetIndex(2, 40, midpoints), 0, 'Tab 2 moved left past tab 0');
  assert.strictEqual(computeChromeTargetIndex(2, -100, midpoints), 0, 'Tab 2 clamped at 0');

  // Drag tab 1 (center tab)
  assert.strictEqual(computeChromeTargetIndex(1, 150, midpoints), 1, 'Tab 1 at center');
  assert.strictEqual(computeChromeTargetIndex(1, 40, midpoints), 0, 'Tab 1 moved left of tab 0');
  assert.strictEqual(computeChromeTargetIndex(1, 260, midpoints), 2, 'Tab 1 moved right of tab 2');
}

// Single Tab & Edge Cases
{
  assert.strictEqual(computeChromeTargetIndex(0, 50, [50]), 0, 'Single tab always stays at 0');
  assert.strictEqual(computeChromeTargetIndex(0, 999, [50]), 0, 'Single tab always clamped to 0');
}
console.log('✔ computeChromeTargetIndex tests passed');

// ── Test Suite 2: computeChromeShiftOffsets ──
console.log('▶ Test Suite 2: computeChromeShiftOffsets sibling translations');

{
  // 4 tabs, tab 0 dragged to target 2 (width 100)
  const shiftsRight = computeChromeShiftOffsets(0, 2, 100, 4);
  assert.deepStrictEqual(
    shiftsRight,
    [0, -100, -100, 0],
    'Tabs 1 and 2 shift left by 100 to make room for tab 0'
  );

  // 4 tabs, tab 3 dragged to target 1 (width 120)
  const shiftsLeft = computeChromeShiftOffsets(3, 1, 120, 4);
  assert.deepStrictEqual(
    shiftsLeft,
    [0, 120, 120, 0],
    'Tabs 1 and 2 shift right by 120 to make room for tab 3'
  );

  // 4 tabs, tab 1 dropped in place (target 1)
  const shiftsIdle = computeChromeShiftOffsets(1, 1, 100, 4);
  assert.deepStrictEqual(
    shiftsIdle,
    [0, 0, 0, 0],
    'No sibling shifts when tab stays in place'
  );
}
console.log('✔ computeChromeShiftOffsets tests passed');

// ── Test Suite 3: computeChromeSnapOffset ──
console.log('▶ Test Suite 3: computeChromeSnapOffset final destination calculations');

{
  const tabWidths = [100, 120, 140, 110];

  // Tab 0 -> Tab 2: shifts across tab 1 (120) and tab 2 (140) = +260
  assert.strictEqual(
    computeChromeSnapOffset(0, 2, tabWidths),
    260,
    'Snap offset to right equals sum of intermediate tab widths'
  );

  // Tab 2 -> Tab 0: shifts left across tab 1 (120) and tab 0 (100) = -220
  assert.strictEqual(
    computeChromeSnapOffset(2, 0, tabWidths),
    -220,
    'Snap offset to left equals negative sum of intermediate tab widths'
  );

  // In place: 0
  assert.strictEqual(computeChromeSnapOffset(1, 1, tabWidths), 0, 'Snap offset in place is 0');
}
console.log('✔ computeChromeSnapOffset tests passed');

// ── Test Suite 4: computeEdgeScrollVelocity ──
console.log('▶ Test Suite 4: computeEdgeScrollVelocity boundary curves');

{
  const containerLeft = 100;
  const containerRight = 500;
  const edgeZone = 48;

  // Middle of container: 0 velocity
  assert.strictEqual(
    computeEdgeScrollVelocity(300, containerLeft, containerRight, edgeZone),
    0,
    'Middle zone has 0 scroll velocity'
  );

  // Left boundary: negative velocity
  const leftVel = computeEdgeScrollVelocity(105, containerLeft, containerRight, edgeZone);
  assert.ok(leftVel < 0, 'Left edge produces negative velocity');

  // Extreme left boundary: max speed
  const maxLeftVel = computeEdgeScrollVelocity(100, containerLeft, containerRight, edgeZone, 14);
  assert.strictEqual(maxLeftVel, -14, 'Boundary edge produces max speed');

  // Right boundary: positive velocity
  const rightVel = computeEdgeScrollVelocity(495, containerLeft, containerRight, edgeZone);
  assert.ok(rightVel > 0, 'Right edge produces positive velocity');

  // Extreme right boundary: max speed
  const maxRightVel = computeEdgeScrollVelocity(500, containerLeft, containerRight, edgeZone, 14);
  assert.strictEqual(maxRightVel, 14, 'Boundary edge produces max right speed');
}
console.log('✔ computeEdgeScrollVelocity tests passed');

console.log('============================================================');
console.log('🎉 ALL CHROME TAB DRAG TESTS PASSED!');
console.log('============================================================');
