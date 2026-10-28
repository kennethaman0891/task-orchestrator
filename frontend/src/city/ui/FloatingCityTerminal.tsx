// Developer City — FloatingCityTerminal
// A free-floating, draggable, and resizable live terminal popup right inside Developer City.
// Keeps the user immersed in the 3D scene while providing full CLI access via TerminalAnchor.

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Terminal, Maximize2, Minimize2, Minus, X, ExternalLink } from 'lucide-react';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';

export interface FloatingCityTerminalProps {
  sessionId: string;
  title: string;
  agentName?: string;
  modelName?: string;
  status?: string;
  onClose: () => void;
  onOpenInWorkspace?: () => void;
}

export function FloatingCityTerminal({
  sessionId,
  title,
  agentName,
  modelName,
  status = 'RUNNING',
  onClose,
  onOpenInWorkspace,
}: FloatingCityTerminalProps) {
  // Initial position: centered/right in the viewport
  const [pos, setPos] = useState(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    return {
      x: Math.max(24, w - 740),
      y: 96,
    };
  });

  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 680,
    height: 440,
  });

  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // References for dragging and resizing
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const windowRef = useRef<HTMLDivElement>(null);

  // Dragging handlers
  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (maximized) return;

    draggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = ev.clientX - dragStartRef.current.x;
      const dy = ev.clientY - dragStartRef.current.y;

      const maxX = Math.max(10, window.innerWidth - (minimized ? 260 : size.width) - 10);
      const maxY = Math.max(10, window.innerHeight - (minimized ? 48 : size.height) - 10);

      const nextX = Math.max(10, Math.min(maxX, dragStartRef.current.posX + dx));
      const nextY = Math.max(60, Math.min(maxY, dragStartRef.current.posY + dy));

      setPos({ x: nextX, y: nextY });
    };

    const onPointerUp = () => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Resizing handlers
  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (maximized || minimized) return;

    resizingRef.current = true;
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      const dx = ev.clientX - resizeStartRef.current.x;
      const dy = ev.clientY - resizeStartRef.current.y;

      const maxW = Math.max(360, window.innerWidth - pos.x - 16);
      const maxH = Math.max(220, window.innerHeight - pos.y - 16);

      const nextW = Math.max(380, Math.min(maxW, resizeStartRef.current.width + dx));
      const nextH = Math.max(240, Math.min(maxH, resizeStartRef.current.height + dy));

      setSize({ width: nextW, height: nextH });
    };

    const onPointerUp = () => {
      resizingRef.current = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Keyboard shortcut: Escape to minimize or close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !minimized) {
        // Only if focused inside window
        if (windowRef.current?.contains(document.activeElement)) {
          // keep inside terminal
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [minimized]);

  const toggleMaximize = useCallback(() => {
    setMaximized((prev) => !prev);
  }, []);

  const agentLine = [agentName, modelName].filter(Boolean).join(' · ');

  if (minimized) {
    return (
      <div
        ref={windowRef}
        onPointerDown={onHeaderPointerDown}
        style={{
          position: 'absolute',
          left: pos.x,
          top: pos.y,
          zIndex: 38,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(15, 18, 28, 0.94)',
          border: '1px solid rgba(59, 130, 246, 0.4)',
          borderRadius: 24,
          padding: '6px 14px',
          boxShadow: '0 12px 28px rgba(0,0,0,0.5)',
          color: '#e8edf5',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
          cursor: 'grab',
          userSelect: 'none',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <Terminal size={14} color="#93c5fd" />
          <span style={{ fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          title="Restore terminal"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            borderRadius: 12,
            padding: '3px 8px',
            color: '#93c5fd',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Restore
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close terminal"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  const containerStyle: CSSProperties = maximized
    ? {
        position: 'absolute',
        top: 68,
        left: 16,
        right: 16,
        bottom: 24,
        zIndex: 38,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(12, 15, 24, 0.96)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 14,
        boxShadow: '0 24px 56px rgba(0,0,0,0.65)',
        backdropFilter: 'blur(20px)',
        overflow: 'hidden',
      }
    : {
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        zIndex: 38,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(12, 15, 24, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 14,
        boxShadow: '0 20px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
        backdropFilter: 'blur(20px)',
        overflow: 'hidden',
      };

  return (
    <div
      ref={windowRef}
      style={containerStyle}
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ── Window Header Bar (Drag Handle) ── */}
      <div
        onPointerDown={onHeaderPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          cursor: maximized ? 'default' : 'grab',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'rgba(59, 130, 246, 0.2)',
              color: '#60a5fa',
            }}
          >
            <Terminal size={13} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: '#f1f5f9',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {title}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#4ade80',
                  background: 'rgba(34, 197, 94, 0.15)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: 10,
                  padding: '1px 6px',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#22c55e',
                    boxShadow: '0 0 4px #22c55e',
                  }}
                />
                {status}
              </span>
            </div>

            {agentLine && (
              <span
                style={{
                  fontSize: 11,
                  color: 'rgba(232,237,245,0.5)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {agentLine}
              </span>
            )}
          </div>
        </div>

        {/* ── Window Control Buttons ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onOpenInWorkspace && (
            <button
              type="button"
              onClick={onOpenInWorkspace}
              title="Open full workspace"
              style={iconBtnStyle}
            >
              <ExternalLink size={13} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setMinimized(true)}
            title="Minimize"
            style={iconBtnStyle}
          >
            <Minus size={13} />
          </button>

          <button
            type="button"
            onClick={toggleMaximize}
            title={maximized ? 'Restore size' : 'Maximize'}
            style={iconBtnStyle}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Close terminal"
            style={{ ...iconBtnStyle, color: '#f87171' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Terminal Content Area ── */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: '#090b10',
        }}
      >
        <TerminalAnchor
          sessionId={sessionId}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* ── Resize Grip Corner ── */}
      {!maximized && (
        <div
          onPointerDown={onResizePointerDown}
          title="Drag to resize"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
            cursor: 'nwse-resize',
            zIndex: 10,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: 3,
            boxSizing: 'border-box',
          }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="rgba(255,255,255,0.25)">
            <circle cx="7" cy="1" r="1" />
            <circle cx="7" cy="4" r="1" />
            <circle cx="4" cy="4" r="1" />
            <circle cx="7" cy="7" r="1" />
            <circle cx="4" cy="7" r="1" />
            <circle cx="1" cy="7" r="1" />
          </svg>
        </div>
      )}
    </div>
  );
}

const iconBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'rgba(232,237,245,0.7)',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
};
