/**
 * GridEngine.test.ts
 *
 * Comprehensive test suite for the Card Grid Layout Engine.
 * Run directly with: npx tsx frontend/src/card-grid/GridEngine.test.ts
 */

import assert from 'node:assert/strict';
import {
  gridMins,
  computeResponsiveLayout,
  GRID_GAP,
  GRID_CAPS,
  type GridMode,
} from './GridEngine';

console.log('🧪 Starting GridEngine Test Suite...\n');

// ============================================================================
// 1. Tests for gridMins(mode)
// ============================================================================
console.log('▶ Suite 1: gridMins(mode) specifications');

const autoMins = gridMins('auto');
assert.deepEqual(autoMins, { minW: 320, minH: 220 }, 'auto mode should have minW: 320, minH: 220');

const compactMins = gridMins('compact');
assert.deepEqual(compactMins, { minW: 260, minH: 160 }, 'compact mode should have minW: 260, minH: 160');

const largeMins = gridMins('large');
assert.deepEqual(largeMins, { minW: 480, minH: 300 }, 'large mode should have minW: 480, minH: 300');

const gridModeMins = gridMins('grid');
assert.deepEqual(gridModeMins, { minW: 180, minH: 110 }, 'grid mode should have minW: 180, minH: 110');

// Fallback / default case test
const defaultMins = gridMins('unknown' as unknown as GridMode);
assert.deepEqual(defaultMins, { minW: 320, minH: 220 }, 'unknown mode should fallback to auto mins');

console.log('  ✔ gridMins returned expected boundaries for all modes');

// ============================================================================
// 2. Invariant 1: No Horizontal Overflow
// ============================================================================
console.log('\n▶ Suite 2: Invariant 1 — No Horizontal Overflow');
console.log('  cols * (minW + GRID_GAP) <= width + GRID_GAP');

const testWidths = [320, 600, 800, 1024, 1200, 1440, 1920, 2560, 3840];
const testCounts = Array.from({ length: 24 }, (_, i) => i + 1);
const responsiveModes: GridMode[] = ['auto', 'compact', 'large'];

let invariant1Checks = 0;
for (const mode of responsiveModes) {
  for (const width of testWidths) {
    for (const count of testCounts) {
      const layout = computeResponsiveLayout({
        count,
        width,
        mode,
        gap: GRID_GAP,
      });

      const totalSpan = layout.cols * (layout.minW + GRID_GAP);
      const allowedSpan = width + GRID_GAP;

      assert.ok(
        totalSpan <= allowedSpan,
        `Invariant 1 violation in mode "${mode}" at width=${width}, count=${count}: ${totalSpan} > ${allowedSpan}`
      );
      invariant1Checks++;
    }
  }
}
console.log(`  ✔ Verified ${invariant1Checks} configurations without horizontal overflow`);

// ============================================================================
// 3. Invariant 2: Row Packing
// ============================================================================
console.log('\n▶ Suite 3: Invariant 2 — Row Packing');
console.log('  layout.rows === Math.max(1, Math.ceil(count / layout.cols))');

let invariant2Checks = 0;
const allModes: GridMode[] = ['auto', 'compact', 'large', 'grid'];

for (const mode of allModes) {
  for (const width of testWidths) {
    for (const count of testCounts) {
      const layout = computeResponsiveLayout({
        count,
        width,
        mode,
        gap: GRID_GAP,
        templateCols: 4,
      });

      const expectedRows = Math.max(1, Math.ceil(count / layout.cols));
      assert.equal(
        layout.rows,
        expectedRows,
        `Invariant 2 row mismatch in mode "${mode}" for count=${count}, cols=${layout.cols}`
      );
      invariant2Checks++;
    }
  }
}
console.log(`  ✔ Verified ${invariant2Checks} configurations for optimal row packing`);

// ============================================================================
// 4. Invariant 3: Column Caps
// ============================================================================
console.log('\n▶ Suite 4: Invariant 3 — Column Caps');
console.log('  cols <= GRID_CAPS[mode] unless maxColumns is set');

let invariant3Checks = 0;
for (const mode of responsiveModes) {
  for (const width of testWidths) {
    for (const count of testCounts) {
      // Test without maxColumns
      const defaultLayout = computeResponsiveLayout({
        count,
        width,
        mode,
        gap: GRID_GAP,
      });
      assert.ok(
        defaultLayout.cols <= GRID_CAPS[mode],
        `Invariant 3 cap violation in mode "${mode}": ${defaultLayout.cols} > cap ${GRID_CAPS[mode]}`
      );
      invariant3Checks++;

      // Test with explicit maxColumns override
      const customMaxCols = 2;
      const customLayout = computeResponsiveLayout({
        count,
        width,
        mode,
        gap: GRID_GAP,
        maxColumns: customMaxCols,
      });
      assert.ok(
        customLayout.cols <= customMaxCols,
        `Invariant 3 custom cap violation in mode "${mode}": ${customLayout.cols} > maxColumns ${customMaxCols}`
      );
      invariant3Checks++;
    }
  }
}
console.log(`  ✔ Verified ${invariant3Checks} configurations for column capping and custom limits`);

// ============================================================================
// 5. Invariant 4: Template Grid Mode
// ============================================================================
console.log('\n▶ Suite 5: Invariant 4 — Template Grid Mode');
console.log('  grid mode respects templateCols (or capped by maxColumns) and sets rows accordingly');

let invariant4Checks = 0;
for (let templateCols = 1; templateCols <= 8; templateCols++) {
  for (const count of testCounts) {
    // Uncapped
    const layout = computeResponsiveLayout({
      count,
      width: 1440,
      mode: 'grid',
      gap: GRID_GAP,
      templateCols,
    });

    assert.equal(
      layout.cols,
      templateCols,
      `Grid mode did not respect templateCols=${templateCols}`
    );
    assert.equal(
      layout.rows,
      Math.max(1, Math.ceil(count / templateCols)),
      `Grid mode rows miscalculated for count=${count}, cols=${templateCols}`
    );
    invariant4Checks++;

    // Capped with maxColumns
    const maxCols = 3;
    const cappedLayout = computeResponsiveLayout({
      count,
      width: 1440,
      mode: 'grid',
      gap: GRID_GAP,
      templateCols,
      maxColumns: maxCols,
    });
    const expectedCappedCols = Math.min(templateCols, maxCols);
    assert.equal(
      cappedLayout.cols,
      expectedCappedCols,
      `Grid mode maxColumns capping failed: expected ${expectedCappedCols}, got ${cappedLayout.cols}`
    );
    assert.equal(
      cappedLayout.rows,
      Math.max(1, Math.ceil(count / expectedCappedCols)),
      `Grid mode capped rows miscalculated`
    );
    invariant4Checks++;
  }
}
console.log(`  ✔ Verified ${invariant4Checks} template grid column and row calculations`);

// ============================================================================
// Summary
// ============================================================================
const totalAssertions = 5 + invariant1Checks + invariant2Checks + invariant3Checks + invariant4Checks;
console.log(`\n============================================================`);
console.log(`🎉 ALL GRID ENGINE TESTS PASSED! (${totalAssertions} assertions verified)`);
console.log(`============================================================\n`);
