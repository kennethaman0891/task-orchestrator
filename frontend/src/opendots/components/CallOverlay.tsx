'use client';

import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { jarvisManager } from '@/jarvis/agent/JarvisManager';
import { sessionContextStore } from '@/jarvis/contextStore';
import { CallView } from './CallView';
import { terminalToDot } from '../adapters/terminal-to-dot';
import { useTerminalCall } from '../hooks/useTerminalCall';
import type { UnifiedTerminal } from '@/types';
import { Phone, Plus, X } from 'lucide-react';

const CALL_RECT_KEY = 'tto-call-window-rect';

type CallRect = { left: number; top: number; width: number; height: number };

function clampCallRect(r: CallRect): CallRect {
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  const width = Math.min(Math.max(360, r.width), Math.max(360, vw - 16));
  const height = Math.min(Math.max(240, r.height), Math.max(240, vh - 16));
  const left = Math.min(Math.max(8, r.left), Math.max(8, vw - 80));
  const top = Math.min(Math.max(8, r.top), Math.max(8, vh - 64));
  return { left, top, width, height };
}

function loadCallRect(): CallRect {
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  const left = Math.max(290, (vw - 840) / 2);
  const fallback = clampCallRect({
    left,
    top: 16,
    width: Math.max(360, vw - left - 20),
    height: Math.max(280, vh - 36),
  });
  try {
    const raw = localStorage.getItem(CALL_RECT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as CallRect;
    if (typeof parsed.left !== 'number' || typeof parsed.width !== 'number') return fallback;
    return clampCallRect(parsed);
  } catch {
    return fallback;
  }
}

/** Foreground visible active call session */
function ActiveCallSession({
  terminalId,
  activeIds,
  onSwitch,
  onEnd,
  onEndAll,
  onStartCall,
  entry,
  rect,
  onMove,
  onResize,
}: {
  terminalId: string;
  activeIds: string[];
  onSwitch: (id: string) => void;
  onEnd: (id: string) => void;
  onEndAll: () => void;
  onStartCall: (id: string) => void;
  entry?: UnifiedTerminal;
  rect: CallRect;
  onMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const [context, setContext] = useState(() => sessionContextStore.get(terminalId));
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [allContexts, setAllContexts] = useState(() => sessionContextStore.getAll());
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return sessionContextStore.subscribe((all) => {
      setAllContexts(all);
      if (all[terminalId]) {
        setContext(all[terminalId]);
      }
    });
  }, [terminalId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    }
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAddMenu]);

  const dot = terminalToDot(terminalId, context);
  const voice = useTerminalCall({
    terminalId,
    suggest: true,
    entry,
    onSaved: () => {
      jarvisManager.endCall(terminalId);
    },
  });

  // Terminals that can be added to a new call
  const availableToAdd = Object.keys(allContexts).filter((id) => !activeIds.includes(id));

  return (
    <div
      className="call-overlay-container"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {/* Multi-Call Navigation & Switcher Header */}
      <div className="call-multi-bar" onPointerDown={onMove}>
        <div className="call-multi-tabs">
          {activeIds.map((tId) => {
            const ctx = allContexts[tId] || sessionContextStore.get(tId);
            const isFocused = tId === terminalId;
            const termName = ctx?.terminalName || `Terminal ${tId.slice(0, 6)}`;
            const cli = ctx?.cliName || 'Antigravity';

            return (
              <button
                key={tId}
                className={`call-multi-tab ${isFocused ? 'active' : ''}`}
                onClick={() => onSwitch(tId)}
                title={`Switch to call with ${cli} (${termName})`}
              >
                <span className="call-tab-indicator" />
                <span className="call-tab-title">
                  {cli} · {termName}
                </span>
                <span
                  className="call-tab-close"
                  title="End this call"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEnd(tId);
                  }}
                >
                  <X size={11} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="call-multi-actions" ref={addMenuRef}>
          {availableToAdd.length > 0 && (
            <button
              className="call-multi-add-btn"
              onClick={() => setShowAddMenu((prev) => !prev)}
              title="Add another terminal to simultaneous voice call"
            >
              <Plus size={12} style={{ marginRight: 3, verticalAlign: 'middle' }} />
              Call Terminal
            </button>
          )}

          {activeIds.length > 1 && (
            <button
              className="call-multi-endall-btn"
              onClick={onEndAll}
              title="End all active voice calls"
            >
              End All ({activeIds.length})
            </button>
          )}

          {/* Add Call Dropdown */}
          {showAddMenu && (
            <div className="call-add-menu">
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.5)',
                  padding: '4px 8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Call another terminal:
              </div>
              {availableToAdd.map((id) => {
                const c = allContexts[id];
                const name = c?.terminalName || `Terminal ${id.slice(0, 6)}`;
                const cli = c?.cliName || 'Antigravity';
                return (
                  <button
                    key={id}
                    className="call-add-item"
                    onClick={() => {
                      setShowAddMenu(false);
                      onStartCall(id);
                    }}
                  >
                    <span>
                      {cli} · {name}
                    </span>
                    <Phone size={11} style={{ opacity: 0.7 }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <CallView dot={dot} voice={voice} onHeadingPointerDown={onMove} />
      <div className="call-resize-handle" onPointerDown={onResize} title="Resize call" />
    </div>
  );
}

/** Background active call session to maintain terminal observation and prompt alerts */
function BackgroundCallSession({ terminalId, entry }: { terminalId: string; entry?: UnifiedTerminal }) {
  useTerminalCall({
    terminalId,
    suggest: false,
    entry,
    onSaved: () => {
      jarvisManager.endCall(terminalId);
    },
  });
  return null;
}

export function CallOverlay({ terminals }: { terminals: Record<string, UnifiedTerminal> }) {
  const [activeIds, setActiveIds] = useState<string[]>(() =>
    jarvisManager.getActiveCallTerminalIds()
  );
  const [focusedId, setFocusedId] = useState<string | null>(() =>
    jarvisManager.getFocusedCallTerminalId()
  );
  const [rect, setRect] = useState<CallRect>(() => loadCallRect());
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const beginDrag = (kind: 'move' | 'resize') => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (kind === 'move' && target?.closest('button, input, textarea, a, select')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = rectRef.current;
    let latest = origin;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      latest = kind === 'move'
        ? clampCallRect({ ...origin, left: origin.left + dx, top: origin.top + dy })
        : clampCallRect({ ...origin, width: origin.width + dx, height: origin.height + dy });
      setRect(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(CALL_RECT_KEY, JSON.stringify(latest));
      } catch { /* ignore quota */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    return jarvisManager.subscribe(() => {
      setActiveIds(jarvisManager.getActiveCallTerminalIds());
      setFocusedId(jarvisManager.getFocusedCallTerminalId());
    });
  }, []);

  if (activeIds.length === 0 || !focusedId) return null;

  const backgroundIds = activeIds.filter((id) => id !== focusedId);

  return (
    <>
      {/* Background sessions maintain live observation for all active calls */}
      {backgroundIds.map((bgId) => (
        <BackgroundCallSession key={bgId} terminalId={bgId} entry={terminals[bgId]} />
      ))}

      {/* Foreground focused call session */}
      <ActiveCallSession
        key={focusedId}
        terminalId={focusedId}
        activeIds={activeIds}
        entry={terminals[focusedId]}
        rect={rect}
        onMove={beginDrag('move')}
        onResize={beginDrag('resize')}
        onSwitch={(id) => jarvisManager.switchCall(id)}
        onEnd={(id) => jarvisManager.endCall(id)}
        onEndAll={() => jarvisManager.endAllCalls()}
        onStartCall={(id) => jarvisManager.startCall(id)}
      />
    </>
  );
}
