'use client';

import { useState, useEffect, useRef } from 'react';
import { jarvisManager } from '@/jarvis/agent/JarvisManager';
import { sessionContextStore } from '@/jarvis/contextStore';
import { CallView } from './CallView';
import { terminalToDot } from '../adapters/terminal-to-dot';
import { useTerminalCall } from '../hooks/useTerminalCall';
import { Phone, Plus, X } from 'lucide-react';

/** Foreground visible active call session */
function ActiveCallSession({
  terminalId,
  activeIds,
  onSwitch,
  onEnd,
  onEndAll,
  onStartCall,
}: {
  terminalId: string;
  activeIds: string[];
  onSwitch: (id: string) => void;
  onEnd: (id: string) => void;
  onEndAll: () => void;
  onStartCall: (id: string) => void;
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
    onSaved: () => {
      jarvisManager.endCall(terminalId);
    },
  });

  // Terminals that can be added to a new call
  const availableToAdd = Object.keys(allContexts).filter((id) => !activeIds.includes(id));

  return (
    <div className="call-overlay-container">
      {/* Multi-Call Navigation & Switcher Header */}
      <div className="call-multi-bar">
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

      <CallView dot={dot} voice={voice} />
    </div>
  );
}

/** Background active call session to maintain terminal observation and prompt alerts */
function BackgroundCallSession({ terminalId }: { terminalId: string }) {
  useTerminalCall({
    terminalId,
    onSaved: () => {
      jarvisManager.endCall(terminalId);
    },
  });
  return null;
}

export function CallOverlay() {
  const [activeIds, setActiveIds] = useState<string[]>(() =>
    jarvisManager.getActiveCallTerminalIds()
  );
  const [focusedId, setFocusedId] = useState<string | null>(() =>
    jarvisManager.getFocusedCallTerminalId()
  );

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
        <BackgroundCallSession key={bgId} terminalId={bgId} />
      ))}

      {/* Foreground focused call session */}
      <ActiveCallSession
        key={focusedId}
        terminalId={focusedId}
        activeIds={activeIds}
        onSwitch={(id) => jarvisManager.switchCall(id)}
        onEnd={(id) => jarvisManager.endCall(id)}
        onEndAll={() => jarvisManager.endAllCalls()}
        onStartCall={(id) => jarvisManager.startCall(id)}
      />
    </>
  );
}
