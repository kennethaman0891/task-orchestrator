'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { GridMode } from '@/lib/workspace';
import { GRID_MODES } from '@/lib/workspace';
import {
  GripVertical,
  GripHorizontal,
  LayoutGrid,
  ScrollText,
  Plus,
  Minimize2,
  ChevronDown,
} from 'lucide-react';
import {
  loadNotchState,
  saveNotchState,
  snapNotch,
  type NotchDock,
  type NotchMode,
  type NotchState,
  ISLAND_H,
  RAIL_W,
  ORB_SIZE,
  NOTCH_EDGE_PX,
} from './notchState';

interface GridNotchProps {
  filledCount: number;
  maxCount?: number;
  density: 'fit' | 'scrollable';
  onSetDensity: (d: 'fit' | 'scrollable') => void;
  layoutMode: GridMode;
  onSetLayoutMode: (m: GridMode) => void;
  onAddPane?: () => void;
  cols: number;
  rows: number;
  paneExpanded?: boolean;
  onRestoreExpanded?: () => void;
}

const LAYOUT_MENU_ORDER: GridMode[] = ['auto', 'compact', 'large', 'grid'];
const LAYOUT_HINTS: Record<GridMode, string> = {
  auto: 'Adapts columns to window size',
  compact: 'Fits more terminals',
  large: 'Fewer, bigger terminals',
  grid: 'Uses the workspace template (2×2, 4×4, …)',
};
const DRAG_THRESHOLD = 4;
const FILL = '#1a1a22';

function modeLabel(mode: GridMode): string {
  return GRID_MODES.find((m) => m.key === mode)?.label ?? 'Auto';
}

function layoutLetter(mode: GridMode): string {
  return modeLabel(mode).charAt(0);
}

function menuPlacement(visualMode: NotchMode, dock: NotchDock): 'down' | 'up' | 'right' | 'left' {
  if (visualMode === 'rail') {
    return dock === 'right' || dock === 'tr' || dock === 'br' ? 'left' : 'right';
  }
  return dock === 'bottom' || dock === 'bl' || dock === 'br' ? 'up' : 'down';
}

export function GridNotch({
  filledCount,
  maxCount = 16,
  density,
  onSetDensity,
  layoutMode,
  onSetLayoutMode,
  onAddPane,
  cols,
  rows,
  paneExpanded = false,
  onRestoreExpanded,
}: GridNotchProps) {
  const { theme: t } = useTheme();
  const notchRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [notch, setNotch] = useState<NotchState>(() => loadNotchState());
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    pointerId: number;
  } | null>(null);
  const lastDeltaRef = useRef(0);

  const visualMode: NotchMode = paneExpanded ? 'orb' : notch.mode;
  const isRail = visualMode === 'rail';
  const isOrb = visualMode === 'orb';
  const isIsland = visualMode === 'island';

  const clampPos = useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };
    const el = notchRef.current;
    const notchW = el ? el.offsetWidth : isOrb ? ORB_SIZE : isRail ? RAIL_W : 440;
    const notchH = el ? el.offsetHeight : isOrb ? ORB_SIZE : ISLAND_H;
    const minX = 8;
    const maxX = Math.max(minX, window.innerWidth - notchW - 8);
    const minY = 8;
    const maxY = Math.max(minY, window.innerHeight - notchH - 8);
    return {
      x: Math.max(minX, Math.min(x, maxX)),
      y: Math.max(minY, Math.min(y, maxY)),
    };
  }, [isOrb, isRail]);

  useEffect(() => {
    if (isDragging) return;
    saveNotchState(notch);
  }, [notch, isDragging]);

  useEffect(() => {
    const handleResize = () => {
      setNotch((prev) => {
        const next = clampPos(prev.x, prev.y);
        if (next.x === prev.x && next.y === prev.y) return prev;
        return { ...prev, ...next };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPos]);

  useLayoutEffect(() => {
    setNotch((prev) => {
      const next = clampPos(prev.x, prev.y);
      if (next.x === prev.x && next.y === prev.y) return prev;
      return { ...prev, ...next };
    });
  }, [visualMode, clampPos]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const measure = () => {
    const el = notchRef.current;
    return {
      notchW: el ? el.offsetWidth : isOrb ? ORB_SIZE : isRail ? RAIL_W : 440,
      notchH: el ? el.offsetHeight : isOrb ? ORB_SIZE : ISLAND_H,
    };
  };

  const applySnap = (x: number, y: number, current: NotchState): NotchState => {
    const { notchW, notchH } = measure();
    const snapped = snapNotch({
      x,
      y,
      vw: window.innerWidth,
      vh: window.innerHeight,
      notchW,
      notchH,
      currentMode: current.mode,
      currentDock: current.dock,
    });
    return {
      mode: snapped.mode,
      dock: snapped.dock,
      x: snapped.x,
      y: snapped.y,
      lastExpanded:
        snapped.mode === 'island' || snapped.mode === 'rail' ? snapped.mode : current.lastExpanded,
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, select, input, option, a, [data-notch-menu]')) return;

    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    const el = notchRef.current;
    if (el) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
    }

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: notch.x,
      initialY: notch.y,
      pointerId: e.pointerId,
    };
    lastDeltaRef.current = 0;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    lastDeltaRef.current = Math.hypot(dx, dy);
    const rawX = dragStartRef.current.initialX + dx;
    const rawY = dragStartRef.current.initialY + dy;
    const clamped = clampPos(rawX, rawY);
    setNotch((prev) => ({ ...prev, x: clamped.x, y: clamped.y }));
  };

  const expandFromOrb = useCallback(() => {
    if (paneExpanded) {
      onRestoreExpanded?.();
      return;
    }
    setNotch((prev) => {
      const prefer = prev.lastExpanded || 'island';
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const { notchW, notchH } = measure();
      let x = prev.x;
      let y = prev.y;
      const away = NOTCH_EDGE_PX + 8;
      if (prefer === 'rail') {
        x = prev.x + 20 < vw / 2 ? 0 : vw;
        y = Math.max(away, Math.min(prev.y, vh - notchH - away));
      } else {
        y = prev.y + 20 < vh / 2 ? 0 : vh;
        x = Math.max(away, Math.min(prev.x, vw - notchW - away));
      }
      const snapped = snapNotch({
        x,
        y,
        vw,
        vh,
        notchW: prefer === 'rail' ? RAIL_W : Math.max(notchW, 200),
        notchH: prefer === 'island' ? ISLAND_H : Math.max(notchH, 120),
        currentMode: prefer,
      });
      return {
        mode: snapped.mode === 'orb' ? prefer : snapped.mode,
        dock: snapped.dock,
        x: snapped.x,
        y: snapped.y,
        lastExpanded: prefer,
      };
    });
  }, [paneExpanded, onRestoreExpanded]);

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    dragStartRef.current = null;
    const el = notchRef.current;
    if (el) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    }

    const dragged = lastDeltaRef.current > DRAG_THRESHOLD;
    if (dragged) {
      setNotch((prev) => applySnap(prev.x, prev.y, prev));
      return;
    }

    if (visualMode === 'orb') {
      expandFromOrb();
    }
  };

  const collapseToOrb = () => {
    setMenuOpen(false);
    setNotch((prev) => ({
      ...prev,
      mode: 'orb',
      dock: 'float',
      lastExpanded: prev.mode === 'rail' ? 'rail' : 'island',
    }));
  };

  const snapTopCenter = () => {
    const { notchW } = measure();
    const vw = window.innerWidth;
    setNotch((prev) => ({
      ...prev,
      mode: 'island',
      dock: 'top',
      lastExpanded: 'island',
      x: Math.max(8, Math.floor((vw - notchW) / 2)),
      y: 12,
    }));
  };

  const pickLayout = (mode: GridMode) => {
    onSetLayoutMode(mode);
    setMenuOpen(false);
  };

  const statusColor = filledCount >= maxCount ? '#f59e0b' : '#22c55e';
  const placement = menuPlacement(visualMode, notch.dock);
  const activeLabel = modeLabel(layoutMode);

  const chrome: React.CSSProperties = {
    position: 'fixed',
    left: `${notch.x}px`,
    top: `${notch.y}px`,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: FILL,
    border: `1px solid ${
      isDragging
        ? t.colors.accent.primary
        : isOrb
          ? 'rgba(56, 189, 248, 0.4)'
          : 'rgba(255, 255, 255, 0.16)'
    }`,
    boxShadow: isDragging
      ? '0 16px 48px rgba(0, 0, 0, 0.9), 0 0 24px rgba(56, 189, 248, 0.35)'
      : isOrb
        ? '0 8px 28px rgba(0, 0, 0, 0.8), 0 0 14px rgba(56, 189, 248, 0.2)'
        : '0 8px 32px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
    userSelect: 'none',
    touchAction: 'none',
    cursor: isDragging ? 'grabbing' : isOrb ? 'pointer' : 'grab',
    transition: isDragging
      ? 'none'
      : 'left 0.16s ease, top 0.16s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
    color: '#fff',
  };

  if (isOrb) {
    chrome.width = ORB_SIZE;
    chrome.height = ORB_SIZE;
    chrome.minWidth = ORB_SIZE;
    chrome.minHeight = ORB_SIZE;
    chrome.overflow = 'hidden';
    chrome.flexShrink = 0;
    chrome.borderRadius = '50%';
    chrome.padding = 0;
    chrome.flexDirection = 'row';
  } else if (isRail) {
    chrome.width = RAIL_W;
    chrome.height = 'auto';
    chrome.borderRadius = 18;
    chrome.flexDirection = 'column';
    chrome.padding = '8px 0';
    chrome.gap = 6;
  } else {
    chrome.height = ISLAND_H;
    chrome.borderRadius = 9999;
    chrome.flexDirection = 'row';
    chrome.padding = '0 10px 0 8px';
    chrome.gap = 6;
  }

  const dividerStyle: React.CSSProperties = isRail
    ? { width: 14, height: 1, background: 'rgba(255, 255, 255, 0.15)', flexShrink: 0 }
    : { width: 1, height: 14, background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px', flexShrink: 0 };

  const iconBtn = (active: boolean): React.CSSProperties => ({
    padding: isRail ? 4 : '2px 8px',
    borderRadius: 9999,
    border: 'none',
    background: active ? t.colors.accent.primary : 'transparent',
    color: active ? '#000000' : t.colors.text.secondary,
    fontSize: '10.5px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    transition: 'all 0.12s ease',
  });

  const title = isOrb
    ? paneExpanded
      ? `Notch parked (${filledCount}/${maxCount}) · Click to restore grid`
      : `Floating Logo Orb (${cols}×${rows}) · ${filledCount}/${maxCount} · Click to expand`
    : `Zen Grid Notch (${cols} cols × ${rows} rows) · Drag to an edge or corner`;

  return (
    <div
      ref={notchRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={chrome}
      title={title}
    >
      {isOrb ? (
        <div
          style={{
            position: 'relative',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <img
            src="/desktop-icon.png"
            alt="TTO Logo"
            draggable={false}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              objectFit: 'cover',
              boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}
          />
          <span
            style={{
              position: 'absolute',
              top: 5,
              right: 5,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
          <span
            style={{
              position: 'absolute',
              bottom: 3,
              right: 4,
              minWidth: 12,
              height: 11,
              padding: '0 3px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.72)',
              fontSize: 8,
              fontWeight: 700,
              fontFamily: t.fontFamily.mono,
              lineHeight: '11px',
              textAlign: 'center',
            }}
          >
            {filledCount}
          </span>
        </div>
      ) : (
        <>
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              snapTopCenter();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isDragging ? t.colors.accent.primary : t.colors.text.muted,
              opacity: 0.8,
              cursor: isDragging ? 'grabbing' : 'grab',
              flexShrink: 0,
              padding: isRail ? '2px 0' : 0,
            }}
            title="Drag to dock · Double-click for top-center island"
          >
            {isRail ? <GripHorizontal size={13} /> : <GripVertical size={13} />}
          </div>

          <img
            src="/desktop-icon.png"
            alt="TTO Logo"
            draggable={false}
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              objectFit: 'cover',
              boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
              flexShrink: 0,
            }}
          />

          {isIsland ? (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontWeight: 600,
                color: '#ffffff',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: statusColor,
                  boxShadow: `0 0 6px ${statusColor}`,
                }}
              />
              <span>
                {filledCount}/{maxCount}
              </span>
            </div>
          ) : (
            <div
              title={`${filledCount}/${maxCount}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                lineHeight: 1.05,
                fontSize: 9,
                fontWeight: 700,
                fontFamily: t.fontFamily.mono,
              }}
            >
              <span>{filledCount}</span>
              <span style={{ opacity: 0.55 }}>/{maxCount}</span>
            </div>
          )}

          <div style={dividerStyle} />

          <div
            style={{
              display: 'inline-flex',
              flexDirection: isRail ? 'column' : 'row',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.45)',
              padding: 2,
              borderRadius: 9999,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetDensity('fit');
              }}
              title="Fit all terminals on a single screen with zero scrolling"
              style={iconBtn(density === 'fit')}
            >
              <LayoutGrid size={11} />
              {isIsland && <span>Fit</span>}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetDensity('scrollable');
              }}
              title="Scrollable cards with comfortable terminal height"
              style={iconBtn(density === 'scrollable')}
            >
              <ScrollText size={11} />
              {isIsland && <span>Scroll</span>}
            </button>
          </div>

          <div style={dividerStyle} />

          <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((open) => !open);
              }}
              title={`${activeLabel} — ${LAYOUT_HINTS[layoutMode] ?? ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: isRail ? '4px 0' : '2px 8px',
                minWidth: isRail ? 22 : undefined,
                borderRadius: 9999,
                background: menuOpen ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: '#ffffff',
                fontSize: isRail ? 11 : 10.5,
                fontWeight: 700,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {isRail ? layoutLetter(layoutMode) : activeLabel}
              {isIsland && <ChevronDown size={10} />}
            </button>
            {menuOpen && (
              <div
                data-notch-menu
                style={{
                  position: 'absolute',
                  zIndex: 20,
                  width: 220,
                  padding: 6,
                  borderRadius: 12,
                  background: FILL,
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
                  ...(placement === 'down' ? { top: '100%', left: 0, marginTop: 6 } : {}),
                  ...(placement === 'up' ? { bottom: '100%', left: 0, marginBottom: 6 } : {}),
                  ...(placement === 'right' ? { left: '100%', top: 0, marginLeft: 6 } : {}),
                  ...(placement === 'left' ? { right: '100%', top: 0, marginRight: 6 } : {}),
                }}
              >
                {LAYOUT_MENU_ORDER.map((key) => {
                  const meta = GRID_MODES.find((m) => m.key === key);
                  const selected = layoutMode === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        pickLayout(key);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 1,
                        width: '100%',
                        padding: '7px 8px',
                        border: 'none',
                        borderRadius: 8,
                        background: selected ? 'rgba(56, 189, 248, 0.18)' : 'transparent',
                        color: '#fff',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700 }}>
                        {meta?.label ?? key}
                      </span>
                      <span style={{ fontSize: 10, color: t.colors.text.secondary, lineHeight: 1.3 }}>
                        {LAYOUT_HINTS[key]}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {onAddPane && (
            <>
              <div style={dividerStyle} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (filledCount < maxCount) onAddPane();
                }}
                disabled={filledCount >= maxCount}
                title={filledCount >= maxCount ? 'Maximum 16 terminals reached' : 'Add a new terminal (⌘T)'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: isRail ? 4 : '3px 8px',
                  borderRadius: 9999,
                  background: filledCount >= maxCount ? 'rgba(255, 255, 255, 0.05)' : 'rgba(56, 189, 248, 0.18)',
                  border: `1px solid ${filledCount >= maxCount ? 'rgba(255, 255, 255, 0.1)' : 'rgba(56, 189, 248, 0.45)'}`,
                  color: filledCount >= maxCount ? t.colors.text.muted : t.colors.accent.primary,
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: filledCount >= maxCount ? 'not-allowed' : 'pointer',
                  opacity: filledCount >= maxCount ? 0.6 : 1,
                }}
              >
                <Plus size={11} />
                {isIsland && (
                  <>
                    <span>Add</span>
                    <span
                      style={{
                        fontSize: 8.5,
                        opacity: 0.85,
                        padding: '0 3px',
                        borderRadius: 3,
                        background: 'rgba(0,0,0,0.3)',
                      }}
                    >
                      ⌘T
                    </span>
                  </>
                )}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              collapseToOrb();
            }}
            title="Collapse into Floating Logo Orb"
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              background: 'rgba(255, 255, 255, 0.06)',
              color: t.colors.text.secondary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
            }}
          >
            <Minimize2 size={10} />
          </button>
        </>
      )}
    </div>
  );
}
