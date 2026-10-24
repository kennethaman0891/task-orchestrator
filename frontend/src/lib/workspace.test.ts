import assert from 'node:assert/strict';
import { computeGridLayout, paintedGridSlots } from './workspace';

const one = computeGridLayout({
  paneCount: 1, width: 800, height: 800, mode: 'auto', density: 'fit', template: 4,
});
assert.deepEqual(one, { cols: 1, rows: 1 });
assert.deepEqual(computeGridLayout({
  paneCount: 1, width: 2000, height: 1200, mode: 'grid', density: 'scrollable', template: 16,
}), { cols: 1, rows: 1 });
assert.deepEqual(computeGridLayout({
  paneCount: 1, width: 800, height: 800, mode: 'compact', density: 'fit', template: 4,
}), { cols: 1, rows: 1 });
assert.deepEqual(computeGridLayout({
  paneCount: 1, width: 800, height: 800, mode: 'large', density: 'fit', template: 4,
}), { cols: 1, rows: 1 });
assert.deepEqual(computeGridLayout({
  paneCount: 0, width: 800, height: 800, mode: 'compact', density: 'fit', template: 4,
}), { cols: 1, rows: 1 });

const auto4 = computeGridLayout({
  paneCount: 4, width: 800, height: 800, mode: 'auto', density: 'fit', template: 4,
});
assert.deepEqual(auto4, { cols: 2, rows: 2 });

const auto16 = computeGridLayout({
  paneCount: 16, width: 1400, height: 900, mode: 'auto', density: 'fit', template: 4,
});
assert.deepEqual(auto16, { cols: 4, rows: 4 });

const compact16 = computeGridLayout({
  paneCount: 16, width: 1200, height: 800, mode: 'compact', density: 'fit', template: 4,
});
const auto16at1200 = computeGridLayout({
  paneCount: 16, width: 1200, height: 800, mode: 'auto', density: 'fit', template: 4,
});
assert.ok(compact16.cols >= auto16at1200.cols, `compact cols ${compact16.cols} < auto cols ${auto16at1200.cols}`);

const large16 = computeGridLayout({
  paneCount: 16, width: 1200, height: 800, mode: 'large', density: 'fit', template: 4,
});
assert.ok(large16.cols === 1 || large16.cols === 2, `large cols was ${large16.cols}`);

const grid16 = computeGridLayout({
  paneCount: 16, width: 2000, height: 1200, mode: 'grid', density: 'fit', template: 16,
});
assert.deepEqual(grid16, { cols: 4, rows: 4 });

const grid4 = computeGridLayout({
  paneCount: 4, width: 2000, height: 1200, mode: 'grid', density: 'fit', template: 4,
});
assert.deepEqual(grid4, { cols: 2, rows: 2 });

const fitCols = computeGridLayout({
  paneCount: 16, width: 1400, height: 900, mode: 'auto', density: 'fit', template: 4,
}).cols;
const scrollCols = computeGridLayout({
  paneCount: 16, width: 1400, height: 900, mode: 'auto', density: 'scrollable', template: 4,
}).cols;
assert.equal(fitCols, scrollCols);

const compactFit = computeGridLayout({
  paneCount: 16, width: 1200, height: 800, mode: 'compact', density: 'fit', template: 4,
}).cols;
const compactScroll = computeGridLayout({
  paneCount: 16, width: 1200, height: 800, mode: 'compact', density: 'scrollable', template: 4,
}).cols;
assert.equal(compactFit, compactScroll);

const zero = computeGridLayout({
  paneCount: 4, width: 0, height: 0, mode: 'auto', density: 'fit', template: 4,
});
assert.ok(zero.cols >= 1, `zero-size cols was ${zero.cols}`);
assert.ok(zero.rows >= 1, `zero-size rows was ${zero.rows}`);

assert.equal(paintedGridSlots({
  template: 4, paneCount: 4, filledCount: 2, cols: 2, mode: 'grid',
}), 4);
assert.equal(paintedGridSlots({
  template: 4, paneCount: 5, filledCount: 5, cols: 3, mode: 'auto',
}), 6);
assert.equal(paintedGridSlots({
  template: 16, paneCount: 2, filledCount: 2, cols: 4, mode: 'auto',
}), 4);
assert.equal(paintedGridSlots({
  template: 16, paneCount: 2, filledCount: 2, cols: 4, mode: 'grid',
}), 16);
assert.equal(paintedGridSlots({
  template: 4, paneCount: 1, filledCount: 1, cols: 1, mode: 'large',
}), 1);
assert.equal(paintedGridSlots({
  template: 4, paneCount: 20, filledCount: 20, cols: 4, mode: 'auto',
}), 16);
assert.equal(paintedGridSlots({
  template: 4, paneCount: 3, filledCount: 3, cols: 2, mode: 'auto',
}), 4);
assert.equal(paintedGridSlots({
  template: 4, paneCount: 4, filledCount: 3, cols: 2, mode: 'auto',
}), 4);

console.log('workspace layout checks passed');
