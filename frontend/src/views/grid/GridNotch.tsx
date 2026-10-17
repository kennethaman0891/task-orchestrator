'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import {
  GripVertical,
  LayoutGrid,
  ScrollText,
  Plus,
  Minimize2,
  Maximize2,
} from 'lucide-react';

interface GridNotchProps {
  filledCount: number;
  maxCount?: number;
  density: 'fit' | 'scrollable';
  onSetDensity: (d: 'fit' | 'scrollable') => void;
  colOverride: string;
  onSetColOverride: (c: string) => void;
  onAddPane?: () => void;
  cols: number;
  rows: number;
}

export function GridNotch({
  filledCount,
  maxCount = 16,
  density,
  onSetDensity,
  colOverride,
  onSetColOverride,
  onAddPane,
  cols,
  rows,
}: GridNotchProps) {
  const { theme: t } = useTheme();
  const notchRef = useRef<HTMLDivElement>(null);

  // ── Collapsed state (Floating Logo Orb mode) ──
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tto-grid-notch-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tto-grid-notch-collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  // ── Position state & persistence ──
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tto-grid-notch-pos');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            return {
              x: Math.max(10, Math.min(window.innerWidth - 100, parsed.x)),
              y: Math.max(10, Math.min(window.innerHeight - 50, parsed.y)),
            };
          }
        }
      } catch {}
      // Default: top-center of screen
      return {
        x: Math.max(12, Math.floor((window.innerWidth - 440) / 2)),
        y: 12,
      };
    }
    return { x: 300, y: 12 };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  // Clamp helper to keep notch within screen viewport
  const clampPos = useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };
    const notchEl = notchRef.current;
    const notchW = notchEl ? notchEl.offsetWidth : (isCollapsed ? 90 : 420);
    const notchH = notchEl ? notchEl.offsetHeight : 36;
    const minX = 8;
    const maxX = Math.max(minX, window.innerWidth - notchW - 8);
    const minY = 8;
    const maxY = Math.max(minY, window.innerHeight - notchH - 8);
    return {
      x: Math.max(minX, Math.min(x, maxX)),
      y: Math.max(minY, Math.min(y, maxY)),
    };
  }, [isCollapsed]);

  // Adjust on window resize to ensure it doesn't get pushed off screen
  useEffect(() => {
    const handleResize = () => {
      setPos((prev) => clampPos(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPos]);

  // Pointer drag start
  const handlePointerDown = (e: React.PointerEvent) => {
    // If user clicked inside a button, select, or input, do not start dragging
    const target = e.target as HTMLElement;
    if (target.closest('button, select, input, option, a')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const notchEl = notchRef.current;
    if (notchEl) {
      try {
        notchEl.setPointerCapture(e.pointerId);
      } catch {}
    }

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: pos.x,
      initialY: pos.y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    e.preventDefault();

    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;

    const rawX = dragStartRef.current.initialX + dx;
    const rawY = dragStartRef.current.initialY + dy;
    const clamped = clampPos(rawX, rawY);

    setPos(clamped);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    dragStartRef.current = null;

    const notchEl = notchRef.current;
    if (notchEl) {
      try {
        notchEl.releasePointerCapture(e.pointerId);
      } catch {}
    }

    // Persist final position
    try {
      localStorage.setItem('tto-grid-notch-pos', JSON.stringify(pos));
    } catch {}
  };

  return (
    <div
      ref={notchRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        height: '36px',
        padding: isCollapsed ? '0 8px 0 6px' : '0 10px 0 8px',
        borderRadius: '9999px',
        background: isDragging
          ? 'rgba(26, 26, 34, 0.96)'
          : 'rgba(18, 18, 24, 0.90)',
        border: `1px solid ${
          isDragging
            ? t.colors.accent.primary
            : isCollapsed
            ? 'rgba(56, 189, 248, 0.4)'
            : 'rgba(255, 255, 255, 0.16)'
        }`,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: isDragging
          ? '0 16px 48px rgba(0, 0, 0, 0.9), 0 0 24px rgba(56, 189, 248, 0.35)'
          : isCollapsed
          ? '0 8px 28px rgba(0, 0, 0, 0.8), 0 0 14px rgba(56, 189, 248, 0.2)'
          : '0 8px 32px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
        userSelect: 'none',
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        transition: isDragging
          ? 'none'
          : 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease',
        transform: isDragging ? 'scale(1.02)' : 'scale(1)',
      }}
      title={
        isCollapsed
          ? `Floating Logo Orb (${cols}×${rows}) · Drag to reposition · Click to expand`
          : `Zen Grid Notch (${cols} cols × ${rows} rows) · Drag anywhere across the window`
      }
    >
      {/* ── Drag Grip Dots ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isDragging ? t.colors.accent.primary : t.colors.text.muted,
          opacity: 0.8,
          cursor: isDragging ? 'grabbing' : 'grab',
          flexShrink: 0,
        }}
      >
        <GripVertical size={13} />
      </div>

      {/* ── Desktop Icon / Logo ── */}
      <img
        src="/desktop-icon.png"
        alt="TTO Logo"
        onClick={(e) => {
          if (isCollapsed) {
            e.stopPropagation();
            toggleCollapsed();
          }
        }}
        style={{
          width: isCollapsed ? 22 : 18,
          height: isCollapsed ? 22 : 18,
          borderRadius: '5px',
          objectFit: 'cover',
          boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
          cursor: isCollapsed ? 'pointer' : 'inherit',
          flexShrink: 0,
          transition: 'transform 0.15s ease',
        }}
      />

      {/* ── Collapsed Mini Logo Orb View ── */}
      {isCollapsed ? (
        <>
          <div
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed();
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: t.fontFamily.mono,
              color: '#ffffff',
              cursor: 'pointer',
              padding: '0 2px',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: filledCount >= maxCount ? '#f59e0b' : '#22c55e',
                boxShadow: filledCount >= maxCount ? '0 0 6px #f59e0b' : '0 0 6px #22c55e',
              }}
            />
            <span>{filledCount}</span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed();
            }}
            title="Expand to full control bar"
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: t.colors.accent.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              transition: 'all 0.12s ease',
            }}
          >
            <Maximize2 size={10} />
          </button>
        </>
      ) : (
        /* ── Expanded Full Notch Controls ── */
        <>
          {/* Terminal Count Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#ffffff',
              paddingRight: '2px',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: filledCount >= maxCount ? '#f59e0b' : '#22c55e',
                boxShadow: filledCount >= maxCount ? '0 0 6px #f59e0b' : '0 0 6px #22c55e',
              }}
            />
            <span>
              {filledCount}/{maxCount}
            </span>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 14,
              background: 'rgba(255, 255, 255, 0.15)',
              margin: '0 2px',
              flexShrink: 0,
            }}
          />

          {/* Density Switch (Fit Screen vs Scrollable) */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.45)',
              padding: '2px',
              borderRadius: '9999px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              gap: '2px',
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetDensity('fit');
              }}
              title="Fit all terminals on a single screen with zero scrolling"
              style={{
                padding: '2px 8px',
                borderRadius: '9999px',
                border: 'none',
                background: density === 'fit' ? t.colors.accent.primary : 'transparent',
                color: density === 'fit' ? '#000000' : t.colors.text.secondary,
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.12s ease',
              }}
            >
              <LayoutGrid size={11} />
              <span>Fit</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetDensity('scrollable');
              }}
              title="Scrollable cards with comfortable terminal height"
              style={{
                padding: '2px 8px',
                borderRadius: '9999px',
                border: 'none',
                background: density === 'scrollable' ? t.colors.accent.primary : 'transparent',
                color: density === 'scrollable' ? '#000000' : t.colors.text.secondary,
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.12s ease',
              }}
            >
              <ScrollText size={11} />
              <span>Scroll</span>
            </button>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 14,
              background: 'rgba(255, 255, 255, 0.15)',
              margin: '0 2px',
              flexShrink: 0,
            }}
          />

          {/* Columns Selector */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10.5px',
              color: t.colors.text.secondary,
            }}
          >
            <span>Cols:</span>
            <select
              value={colOverride}
              onChange={(e) => {
                e.stopPropagation();
                onSetColOverride(e.target.value);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: '9999px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: '#ffffff',
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="auto" style={{ background: '#1c1d22', color: '#fff' }}>Auto ({cols})</option>
              <option value="1" style={{ background: '#1c1d22', color: '#fff' }}>1</option>
              <option value="2" style={{ background: '#1c1d22', color: '#fff' }}>2</option>
              <option value="3" style={{ background: '#1c1d22', color: '#fff' }}>3</option>
              <option value="4" style={{ background: '#1c1d22', color: '#fff' }}>4</option>
              <option value="5" style={{ background: '#1c1d22', color: '#fff' }}>5</option>
              <option value="6" style={{ background: '#1c1d22', color: '#fff' }}>6</option>
              <option value="8" style={{ background: '#1c1d22', color: '#fff' }}>8</option>
            </select>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 14,
              background: 'rgba(255, 255, 255, 0.15)',
              margin: '0 2px',
              flexShrink: 0,
            }}
          />

          {/* Add Terminal Button (⌘T) */}
          {onAddPane && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (filledCount < maxCount) {
                  onAddPane();
                }
              }}
              disabled={filledCount >= maxCount}
              title={filledCount >= maxCount ? 'Maximum 16 terminals reached' : 'Add a new terminal (⌘T)'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                borderRadius: '9999px',
                background: filledCount >= maxCount ? 'rgba(255, 255, 255, 0.05)' : 'rgba(56, 189, 248, 0.18)',
                border: `1px solid ${filledCount >= maxCount ? 'rgba(255, 255, 255, 0.1)' : 'rgba(56, 189, 248, 0.45)'}`,
                color: filledCount >= maxCount ? t.colors.text.muted : t.colors.accent.primary,
                fontSize: '10.5px',
                fontWeight: 700,
                cursor: filledCount >= maxCount ? 'not-allowed' : 'pointer',
                opacity: filledCount >= maxCount ? 0.6 : 1,
                transition: 'all 0.12s ease',
              }}
            >
              <Plus size={11} />
              <span>Add</span>
              <span
                style={{
                  fontSize: '8.5px',
                  opacity: 0.85,
                  padding: '0 3px',
                  borderRadius: '3px',
                  background: 'rgba(0,0,0,0.3)',
                }}
              >
                ⌘T
              </span>
            </button>
          )}

          {/* Collapse to Mini Logo Orb */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed();
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
              transition: 'all 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#ffffff';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = t.colors.text.secondary;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
            }}
          >
            <Minimize2 size={10} />
          </button>
        </>
      )}
    </div>
  );
}
