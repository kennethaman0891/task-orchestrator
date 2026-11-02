import { useState, useEffect, useCallback } from 'react';

export type GridMode = 'auto' | 'grid' | 'compact' | 'large';

export interface GridMins {
  minW: number;
  minH: number;
}

export const GRID_GAP = 8; // px

export const GRID_CAPS: Record<GridMode, number> = {
  auto: 5,
  compact: 6,
  large: 4,
  grid: 8,
};

export function gridMins(mode: GridMode): GridMins {
  switch (mode) {
    case 'compact':
      return { minW: 260, minH: 160 };
    case 'large':
      return { minW: 480, minH: 300 };
    case 'grid':
      return { minW: 180, minH: 110 };
    case 'auto':
    default:
      return { minW: 320, minH: 220 };
  }
}

export interface ResponsiveLayoutOpts {
  count: number;
  width: number;
  mode: GridMode;
  gap: number;
  maxColumns?: number;
  templateCols?: number;
}

export interface ResponsiveLayout {
  cols: number;
  rows: number;
  minW: number;
  minH: number;
}

export function computeResponsiveLayout(opts: ResponsiveLayoutOpts): ResponsiveLayout {
  const { count, mode, gap, maxColumns = 0, templateCols = 4 } = opts;
  const width = opts.width > 0 ? opts.width : 1200;

  if (mode === 'grid') {
    const cols = maxColumns > 0 ? Math.min(templateCols, maxColumns) : templateCols;
    const rows = Math.max(1, Math.ceil(count / cols));
    const baseMins = gridMins('grid');
    const minW = Math.min(baseMins.minW, width);
    return { cols, rows, minW, minH: baseMins.minH };
  }

  const baseMins = gridMins(mode);
  const minW = Math.min(baseMins.minW, width);
  const minH = baseMins.minH;

  // Guarantee: cols * (minW + gap) <= width + gap (NO horizontal scrollbar EVER)
  const fitCols = Math.max(1, Math.floor((width + gap) / (minW + gap)));
  const cap = maxColumns > 0 ? maxColumns : GRID_CAPS[mode];
  const cols = Math.max(1, Math.min(fitCols, cap, count));
  const rows = Math.max(1, Math.ceil(count / cols));

  return { cols, rows, minW, minH };
}

export function useElementSize<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useCallback((el: T | null) => setNode((prev) => (prev === el ? prev : el)), []);

  useEffect(() => {
    if (!node) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      setSize({ w: node.clientWidth, h: node.clientHeight });
    };
    const ro = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(measure);
    });
    ro.observe(node);
    measure();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [node]);

  return { ref, size };
}
