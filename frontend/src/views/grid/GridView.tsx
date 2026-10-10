'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { scrollbarStyle } from '@/lib/theme';
import type { UnifiedTerminal } from '@/types';
import type { Workspace, Pane, GridMode } from '@/lib/workspace';
import { GRID_GAP, GRID_MODES } from '@/lib/workspace';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import { isClosed } from '@/lib/format';
import { deriveTaskStatus, statusLabel, minTerminal, getTerminalWorkDuration, type TermStatus } from '@/lib/status';
import { TerminalManager } from '@/terminal/TerminalManager';
import { detectCLI } from '@/jarvis/adapters';
import { CliLogo } from '@/lib/cliLogos';
import { AgentChatPanel, isAgentCli } from '@/components/terminal/AgentChatPanel';
import { Maximize2, Minimize2, X, GripVertical, Plus, MessageSquare, ChevronDown } from 'lucide-react';
import { extractDropPaths } from '@/terminal/dropPaths';

interface Props {
  activeWorkspace?: Workspace;
  workspaces: Workspace[];
  terminals: Record<string, UnifiedTerminal>;
  expandedPane: string | null;
  selectedPane: string | null;
  onExpandPane: (id: string | null) => void;
  onSelectPane: (id: string | null) => void;
  onToast: (msg: string, error?: boolean) => void;
  onOpenFile: (path: string, name: string) => void;
  onRemovePane: (paneId: string) => void;
  onReorderPanes?: (workspaceId: string, fromIndex: number, toIndex: number) => void;
  onDropToTerminal?: (sessionId: string, paths: string[]) => void;
  onRenameTerminal?: (idOrTty: string, newLabel: string) => void;
  onAddPane?: (targetSlotIndex?: number) => void;
  onSetPaneSizeMode?: (paneId: string, mode: GridMode) => void;
}

/**
 * Compute balanced columns and rows so ALL terminals fit completely on one
 * single display screen with zero vertical or horizontal scrolling.
 */
function computeGridDimensions(paneCount: number, availableWidth: number, availableHeight: number): { cols: number; rows: number } {
  if (paneCount <= 1) return { cols: 1, rows: 1 };
  if (paneCount === 2) {
    return availableWidth < 680 && availableHeight > 700 ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 };
  }
  if (paneCount === 3) {
    return availableWidth >= 1050 ? { cols: 3, rows: 1 } : { cols: 2, rows: 2 };
  }
  if (paneCount === 4) {
    return { cols: 2, rows: 2 };
  }
  if (paneCount === 5 || paneCount === 6) {
    // 3 columns x 2 rows = 6 slots. Fits 5 or 6 terminals on one display screen with 0 scroll!
    return { cols: 3, rows: 2 };
  }
  if (paneCount === 7 || paneCount === 8) {
    // 4 columns x 2 rows = 8 slots on wide screens (>= 1200px), or 3x3 if narrower
    return availableWidth >= 1200 ? { cols: 4, rows: 2 } : { cols: 3, rows: 3 };
  }
  if (paneCount === 9) {
    return { cols: 3, rows: 3 };
  }
  if (paneCount <= 12) {
    return { cols: 4, rows: 3 };
  }
  if (paneCount <= 16) {
    return { cols: 4, rows: 4 };
  }
  const cols = Math.min(5, Math.ceil(Math.sqrt(paneCount)));
  const rows = Math.ceil(paneCount / cols);
  return { cols, rows };
}


// ── Virtualized GridCard Component ─────────────────────────────────────
// Lazy-mounts TerminalAnchor when the card first enters the viewport (+ 400px margin)
// or is expanded. Once mounted, the host STAYS MOUNTED permanently so WebKit never
// drops the canvas context, terminals never go blank or stuck, and scrolling remains 60 FPS.
interface GridCardProps {
  pane: Pane;
  index: number;
  status: TermStatus;
  label: { text: string; color: string };
  cli: string;
  displayName: string;
  duration: ReturnType<typeof getTerminalWorkDuration> | null;
  isExpanded: boolean;
  isSelected: boolean;
  isDraggingThis: boolean;
  isDraggingAny: boolean;
  isOverThis: boolean;
  totalPanes: number;
  onSelectPane: (id: string) => void;
  onExpandPane: (id: string | null) => void;
  onRemovePane: (paneId: string) => void;
  onDragStart: (e: React.DragEvent, paneId: string, index: number) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, slotIndex: number) => void;
  onDragLeave: (e: React.DragEvent, slotIndex: number) => void;
  onDrop: (e: React.DragEvent, targetSlotIndex: number, tty: string | null) => void;
  onRenameTerminal?: (idOrTty: string, newLabel: string) => void;
  /** Live sidecar entry for this pane's terminal — drives the agent chat panel. */
  entry?: UnifiedTerminal;
  /** Spawn a new terminal in the workspace. */
  onAddPane?: (targetSlotIndex?: number) => void;
  cols: number;
  onSetPaneSizeMode?: (paneId: string, mode: GridMode) => void;
}

// ── Interactive Empty Grid Slot Component ─────────────────────────────
// Renders unfilled slots in the workspace template. Accepts dropped terminals
// (moving or swapping them into this slot) and provides a 1-click '+ Add Terminal' button.
interface EmptyGridSlotProps {
  slotIndex: number;
  isDraggingAny: boolean;
  isOverThis: boolean;
  onDragOver: (e: React.DragEvent, slotIndex: number) => void;
  onDragLeave: (e: React.DragEvent, slotIndex: number) => void;
  onDrop: (e: React.DragEvent, targetSlotIndex: number, tty: string | null) => void;
  onAddPane?: (targetSlotIndex?: number) => void;
}

function EmptyGridSlot({
  slotIndex,
  isDraggingAny,
  isOverThis,
  onDragOver,
  onDragLeave,
  onDrop,
  onAddPane,
}: EmptyGridSlotProps) {
  const { theme: t } = useTheme();

  return (
    <div
      className="empty-grid-slot"
      data-slot-index={slotIndex}
      onDragOver={(e) => onDragOver(e, slotIndex)}
      onDragLeave={(e) => onDragLeave(e, slotIndex)}
      onDrop={(e) => onDrop(e, slotIndex, null)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: isOverThis
          ? `2px dashed ${t.colors.accent.primary}`
          : `1px dashed ${t.colors.border.subtle}`,
        borderRadius: '6px',
        background: isOverThis
          ? `${t.colors.accent.primary}12`
          : 'rgba(255, 255, 255, 0.02)',
        minHeight: '240px',
        height: '100%',
        minWidth: 0,
        boxShadow: isOverThis ? `0 0 14px ${t.colors.accent.primary}40` : 'none',
        transition: 'all 0.15s ease',
        cursor: isDraggingAny ? 'copy' : 'default',
        padding: '16px',
        textAlign: 'center',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          opacity: isOverThis ? 1 : 0.65,
          transition: 'opacity 0.15s ease',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: isOverThis ? t.colors.accent.primary : t.colors.text.muted,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}
        >
          {isOverThis ? 'Drop to place terminal here' : `Slot ${slotIndex + 1} · Empty`}
        </span>

        {onAddPane && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddPane(slotIndex);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 14px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: t.fontFamily.sans,
              background: isOverThis ? t.colors.accent.primary : `${t.colors.accent.primary}20`,
              border: `1px solid ${t.colors.accent.primary}`,
              color: isOverThis ? '#ffffff' : t.colors.accent.primary,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginTop: '4px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = t.colors.accent.primary;
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              if (!isOverThis) {
                e.currentTarget.style.background = `${t.colors.accent.primary}20`;
                e.currentTarget.style.color = t.colors.accent.primary;
              }
            }}
            title={`Launch a new terminal in Slot ${slotIndex + 1}`}
          >
            <Plus size={13} />
            <span>Add Terminal</span>
          </button>
        )}

        <span
          style={{
            fontSize: '10px',
            color: t.colors.text.muted,
            opacity: 0.7,
            marginTop: '2px',
          }}
        >
          {isOverThis ? 'Release to place terminal into this slot' : 'Drag terminal here to place in this slot'}
        </span>
      </div>
    </div>
  );
}

function GridCard({
  pane,
  index,
  status,
  label,
  cli,
  displayName,
  duration,
  isExpanded,
  isSelected,
  isDraggingThis,
  isDraggingAny,
  isOverThis,
  totalPanes,
  onSelectPane,
  onExpandPane,
  onRemovePane,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onRenameTerminal,
  entry,
  onAddPane,
  cols,
  onSetPaneSizeMode,
}: GridCardProps) {
  const { theme: t } = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [renameDraft, setRenameDraft] = useState(displayName);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const paneMode: GridMode = pane.sizeMode || 'auto';

  const handleModeSelect = (mode: GridMode) => {
    setDropdownOpen(false);
    onSetPaneSizeMode?.(pane.id, mode);
    setTimeout(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.refresh(tty);
      }
    }, 80);
  };

  useEffect(() => {
    if (!isEditing) setRenameDraft(displayName);
  }, [displayName, isEditing]);

  // Agent chat panel — per-pane open state, persisted in localStorage keyed by tty.
  // The panel is bound to THIS terminal's tty, i.e. the same live session.
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    if (!pane.tty) return false;
    try {
      const open = JSON.parse(localStorage.getItem('tto-grid-chat-open') || '[]') as string[];
      return open.includes(pane.tty);
    } catch {
      return false;
    }
  });
  const toggleChat = () => {
    setChatOpen((prev) => {
      const next = !prev;
      if (pane.tty) {
        try {
          const cur = JSON.parse(localStorage.getItem('tto-grid-chat-open') || '[]') as string[];
          const arr = next ? (cur.includes(pane.tty) ? cur : [...cur, pane.tty]) : cur.filter((x) => x !== pane.tty);
          localStorage.setItem('tto-grid-chat-open', JSON.stringify(arr));
        } catch { /* noop */ }
      }
      return next;
    });
  };
  const agentDetected = isAgentCli(
    entry,
    pane.tty ? TerminalManager.lastLines(pane.tty, 25) : undefined
  );

  const commitRename = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && onRenameTerminal) {
      onRenameTerminal(pane.tty || pane.id, trimmed);
    }
      setIsEditing(false);
    };

    return (
      <div
        ref={cardRef}
        className="term-pane"
        data-agent={cli}
        data-tto-session={pane.tty}
        data-drop-target="terminal"
        style={{
          display: 'flex',
          flexDirection: 'column',
          border: isOverThis
            ? `2px dashed ${t.colors.accent.primary}`
            : `1px solid ${isSelected ? t.colors.accent.primary : t.colors.border.subtle}`,
          borderRadius: '6px',
          overflow: 'hidden',
          background: isOverThis ? 'rgba(99, 102, 241, 0.05)' : t.colors.bg.secondary,
          minWidth: 0,
          boxShadow: isOverThis ? `0 0 10px ${t.colors.accent.primary}40` : 'none',
          transition: 'border 0.15s ease, background 0.15s ease, opacity 0.15s ease, transform 0.15s ease',
          position: isExpanded ? 'fixed' : 'relative',
          opacity: isExpanded ? 1 : isDraggingThis ? 0.4 : 1,
          transform: isExpanded ? 'none' : isDraggingThis ? 'scale(0.98)' : 'none',
          ...(isExpanded
            ? { inset: '40px 0 0 0', zIndex: 50 }
            : paneMode === 'compact'
            ? { minHeight: '200px', height: '100%' }
            : paneMode === 'large'
            ? {
                gridColumn: cols >= 2 ? 'span 2' : 'span 1',
                minHeight: '260px',
                height: '100%',
              }
            : { minHeight: '220px', height: '100%' }),
        }}
      onClick={() => onSelectPane(pane.id)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragLeave={(e) => onDragLeave(e, index)}
      onDrop={(e) => onDrop(e, index, pane.tty)}
      title={`${displayName} — ${label.text}`}
    >
      {/* Card Header: Drag Handle, CLI Logo, Title, Live Status Badge, and Controls */}
      <div
        className="grid-card-header"
        draggable={!isExpanded}
        onDragStart={(e) => onDragStart(e, pane.id, index)}
        onDragEnd={onDragEnd}
        style={{
          height: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          background: t.colors.bg.secondary,
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          cursor: isExpanded ? 'default' : 'grab',
          userSelect: 'none',
          flexShrink: 0,
          zIndex: 5,
        }}
      >
        {/* Left: Grip Handle, CLI Logo, Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1, marginRight: '8px' }}>
          {!isExpanded && (
            <span
              title="Drag to reorder terminal in grid"
              style={{
                display: 'flex',
                alignItems: 'center',
                color: t.colors.text.muted,
                opacity: 0.6,
                cursor: 'grab',
                flexShrink: 0,
              }}
            >
              <GripVertical size={13} />
            </span>
          )}
          <CliLogo cli={cli} size={13} />
          {isEditing ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setRenameDraft(displayName);
                  setIsEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: t.colors.text.primary,
                background: t.colors.bg.primary,
                border: `1px solid ${t.colors.accent.primary}`,
                borderRadius: '3px',
                padding: '1px 5px',
                outline: 'none',
                minWidth: '70px',
                maxWidth: '180px',
                fontFamily: t.fontFamily.sans,
              }}
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: t.colors.text.primary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
              title={`${displayName} (double-click to rename)`}
            >
              {displayName}
            </span>
          )}
        </div>

        {/* Right: Live Status Badge with Working Timestamps & Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {duration && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '9.5px',
                fontWeight: 600,
                fontFamily: t.fontFamily.mono,
                background: `${label.color}15`,
                border: `1px solid ${label.color}35`,
                color: label.color,
                letterSpacing: '0.3px',
                cursor: 'default',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title={`Status: ${label.text}\nStarted: ${duration.startTimeFormatted}${duration.endTimeFormatted ? `\nEnded: ${duration.endTimeFormatted}` : ''}${duration.durationStr ? `\nDuration: ${duration.durationStr}` : ''}`}
            >
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: label.color,
                  boxShadow: status === 'running' || status === 'asking' ? `0 0 6px ${label.color}` : 'none',
                  flexShrink: 0,
                }}
              />
              <span>{label.text}</span>
              {duration.durationStr && (
                <span style={{ opacity: 0.85, fontWeight: 500 }}>
                  {status === 'over' ? `worked ${duration.durationStr}` : duration.durationStr}
                </span>
              )}
            </div>
          )}

          {/* Sizing Mode Dropdown: Auto / Compact / Large / Grid */}
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDropdownOpen((prev) => !prev);
              }}
              title={`Card sizing: ${paneMode.toUpperCase()}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2px 7px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: t.fontFamily.sans,
                background: paneMode !== 'auto' ? `${t.colors.accent.primary}22` : 'rgba(255, 255, 255, 0.06)',
                border: `1px solid ${paneMode !== 'auto' ? t.colors.accent.primary : t.colors.border.subtle}`,
                color: paneMode !== 'auto' ? t.colors.accent.primary : t.colors.text.secondary,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textTransform: 'capitalize',
                userSelect: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = t.colors.accent.primary;
                e.currentTarget.style.color = t.colors.text.primary;
              }}
              onMouseLeave={(e) => {
                if (paneMode === 'auto') {
                  e.currentTarget.style.borderColor = t.colors.border.subtle;
                  e.currentTarget.style.color = t.colors.text.secondary;
                }
              }}
            >
              <span>{paneMode}</span>
              <ChevronDown size={10} style={{ opacity: 0.8 }} />
            </button>

            {dropdownOpen && (
              <>
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 998,
                    cursor: 'default',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDropdownOpen(false);
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '26px',
                    right: 0,
                    zIndex: 999,
                    minWidth: '150px',
                    padding: '4px',
                    borderRadius: '6px',
                    background: t.colors.bg.elevated || '#1c1d22',
                    border: `1px solid ${t.colors.border.primary}`,
                    boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                  }}
                >
                  {GRID_MODES.map((m) => {
                    const isSelected = paneMode === m.key;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleModeSelect(m.key);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          border: 'none',
                          background: isSelected ? `${t.colors.accent.primary}25` : 'transparent',
                          color: isSelected ? t.colors.accent.primary : t.colors.text.primary,
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '11px',
                          transition: 'background 0.12s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.background = t.colors.bg.hover;
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.background = 'transparent';
                        }}
                        title={m.hint}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: isSelected ? 700 : 500 }}>{m.label}</span>
                          <span style={{ fontSize: '9px', opacity: 0.6, color: t.colors.text.muted }}>{m.hint}</span>
                        </div>
                        {isSelected && <span style={{ marginLeft: '6px', fontWeight: 'bold' }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* New terminal (+) — matches the workspace card header */}
          {onAddPane && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddPane();
              }}
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '3px',
                borderRadius: '3px',
                color: t.colors.text.muted,
                transition: 'color 0.12s, background 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = t.colors.accent.primary;
                e.currentTarget.style.background = t.colors.bg.hover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = t.colors.text.muted;
                e.currentTarget.style.background = 'transparent';
              }}
              title="New terminal"
            >
              <Plus size={11} />
            </span>
          )}

          {/* Agent chat — bound to THIS terminal's live session */}
          {agentDetected && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleChat();
              }}
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '3px',
                borderRadius: '3px',
                color: chatOpen ? t.colors.accent.primary : t.colors.text.muted,
                background: chatOpen ? t.colors.bg.hover : 'transparent',
                transition: 'color 0.12s, background 0.12s',
              }}
              onMouseEnter={(e) => {
                if (!chatOpen) e.currentTarget.style.color = t.colors.text.primary;
              }}
              onMouseLeave={(e) => {
                if (!chatOpen) e.currentTarget.style.color = t.colors.text.muted;
              }}
              title={chatOpen ? 'Hide agent chat' : "Chat with this terminal's live agent session (same session)"}
            >
              <MessageSquare size={11} />
            </span>
          )}

          {/* Maximize / Collapse */}
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onExpandPane(isExpanded ? null : pane.id);
            }}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '3px',
              borderRadius: '3px',
              color: t.colors.text.muted,
              transition: 'color 0.12s, background 0.12s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = t.colors.text.primary;
              e.currentTarget.style.background = t.colors.bg.hover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = t.colors.text.muted;
              e.currentTarget.style.background = 'transparent';
            }}
            title={isExpanded ? 'Collapse' : 'Maximize'}
          >
            {isExpanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </span>

          {/* Close */}
          {totalPanes > 1 && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemovePane(pane.id);
              }}
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '3px',
                borderRadius: '3px',
                color: t.colors.text.muted,
                transition: 'color 0.12s, background 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#f87171';
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = t.colors.text.muted;
                e.currentTarget.style.background = 'transparent';
              }}
              title="Close pane"
            >
              <X size={11} />
            </span>
          )}
        </div>
      </div>

      {/* Terminal content — once mounted, stays mounted permanently so canvas context is preserved */}
      {pane.tty ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, minWidth: 0 }}>
        <div
          style={{
            flex: 1,
            position: 'relative',
            background: t.colors.bg.primary,
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            // Disable pointer events on terminal during card drag so drag/drop over the card works 100% reliably
            pointerEvents: isDraggingAny ? 'none' : 'auto',
          }}
        >
          <TerminalAnchor sessionId={pane.tty} />
        </div>
        {agentDetected && chatOpen && entry && (
          <AgentChatPanel
            sessionId={pane.tty}
            entry={entry}
            onClose={toggleChat}
            width={280}
          />
        )}
        </div>
      ) : null}
    </div>
  );
}

export function GridView({
  activeWorkspace, terminals, expandedPane, selectedPane,
  onExpandPane, onSelectPane, onRemovePane, onReorderPanes, onDropToTerminal,
  onRenameTerminal, onAddPane, onSetPaneSizeMode,
}: Props) {
  const { theme: t } = useTheme();
  // Live status refresh — re-derives pane status every 500ms so the status
  // dots and duration timers track smoothly without waiting on a push event.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  // WebKit-proof drag tracking: in-memory ref guarantees 100% reliable source identification
  // even if WKWebView strips custom MIME types or blocks getData during dragover.
  const draggedSlotRef = useRef<{ paneId: string; slotIndex: number } | null>(null);
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);

  // Measure exact grid container width with ResizeObserver so columns adapt perfectly
  // to sidebar expanding/collapsing, window resizing, or split mode with 0 horizontal overflow.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth - 60 : 1200));

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute total template slots: at least the workspace template count, and at least existing panes length
  const templateCount = activeWorkspace?.template ?? 4;
  const rawPanes = useMemo(() => activeWorkspace?.panes ?? [], [activeWorkspace?.panes]);
  const totalSlots = Math.max(templateCount, rawPanes.length);

  // Derive slot items: filled pane or interactive empty slot placeholder
  const slotItems = useMemo(() => {
    const items: Array<{
      slotIndex: number;
      pane: Pane;
      isFilled: boolean;
    }> = [];

    for (let i = 0; i < totalSlots; i++) {
      const p = rawPanes[i];
      if (p && p.tty) {
        items.push({ slotIndex: i, pane: p, isFilled: true });
      } else {
        items.push({
          slotIndex: i,
          pane: p || {
            id: `empty-slot-${activeWorkspace?.id ?? 'ws'}-${i}`,
            tty: null,
            label: `Slot ${i + 1}`,
            sizeMode: 'auto',
          },
          isFilled: false,
        });
      }
    }
    return items;
  }, [totalSlots, rawPanes, activeWorkspace?.id]);

  const filledCount = useMemo(() => {
    return slotItems.filter((s) => s.isFilled).length;
  }, [slotItems]);

  const largeCount = useMemo(() => {
    return slotItems.filter((s) => s.isFilled && s.pane.sizeMode === 'large').length;
  }, [slotItems]);

  // Account for double-width capacity of Large cards so they fit without displacing other terminals
  const effectiveSlots = totalSlots + largeCount;
  const viewH = typeof window !== 'undefined' ? window.innerHeight : 0;
  const cols = computeGridDimensions(effectiveSlots, containerWidth, viewH).cols;
  const rows = Math.max(1, Math.ceil(effectiveSlots / cols));

  const gridStyle = useMemo(() => {
    if (!activeWorkspace) return {};
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${rows}, minmax(220px, 1fr))`,
      gridAutoRows: 'minmax(220px, 1fr)',
      gridAutoFlow: 'dense',
      alignContent: 'stretch',
      alignItems: 'stretch',
      gap: `${GRID_GAP}px`,
      padding: t.spacing.md,
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      height: '100%',
      overflowY: 'auto',
      overflowX: 'hidden',
      ...scrollbarStyle(t),
    };
  }, [activeWorkspace, t, cols, rows]);

  // Derived state with cached metadata (CLI autodetection, name, status, duration)
  const slotRows = useMemo(
    () =>
      slotItems.map(({ slotIndex, pane, isFilled }) => {
        if (!isFilled || !pane.tty) {
          return {
            slotIndex,
            pane,
            isFilled: false,
            entry: undefined,
            status: 'empty' as TermStatus,
            label: statusLabel('empty'),
            cli: 'shell',
            displayName: pane.label || `Slot ${slotIndex + 1}`,
            duration: null,
          };
        }
        const entry = pane.tty ? terminals[pane.tty] : undefined;
        const closed = pane.tty ? isClosed(entry || minTerminal(pane.tty)) : true;
        const meta = pane.tty
          ? TerminalManager.getTerminalMetadata(
              pane.tty,
              entry,
              closed,
              detectCLI,
              deriveTaskStatus,
              getTerminalWorkDuration,
              'shell'
            )
          : null;

        const defaultName = meta?.cliName && meta.cli !== 'shell'
          ? `${meta.cliName} · ${slotIndex + 1}`
          : (entry?.session_name || entry?.pane_title || `Terminal ${slotIndex + 1}`);

        const displayName = pane.label || defaultName;
        const status: TermStatus = meta ? meta.status : 'empty';

        return {
          slotIndex,
          pane,
          isFilled: true,
          entry,
          status,
          label: statusLabel(status),
          cli: meta ? meta.cli : 'shell',
          displayName,
          duration: meta ? meta.duration : null,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotItems, terminals, activeWorkspace?.command, tick]
  );

  const handleDragStart = useCallback((e: React.DragEvent, paneId: string, slotIndex: number) => {
    draggedSlotRef.current = { paneId, slotIndex };
    setDraggedPaneId(paneId);
    try {
      e.dataTransfer.setData('text/plain', paneId);
      e.dataTransfer.setData('application/x-tto-grid-pane', JSON.stringify({ paneId, slotIndex }));
    } catch {
      // Safari / WKWebView may occasionally throw on custom MIME; text/plain is safe
    }
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSlotIndex((prev) => (prev !== slotIndex ? slotIndex : prev));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverSlotIndex((prev) => (prev === slotIndex ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetSlotIndex: number, tty: string | null) => {
      e.preventDefault();
      e.stopPropagation();

      const currentDragged = draggedSlotRef.current;
      if (currentDragged) {
        const fromIdx = currentDragged.slotIndex;
        const toIdx = targetSlotIndex;
        if (fromIdx !== toIdx && activeWorkspace && onReorderPanes) {
          onReorderPanes(activeWorkspace.id, fromIdx, toIdx);
          // After DOM reorder, refresh terminals so canvas repaints immediately
          setTimeout(() => {
            for (const [t] of TerminalManager.handles) {
              TerminalManager.fitNow(t);
              TerminalManager.refresh(t);
            }
          }, 80);
        }
        draggedSlotRef.current = null;
        setDraggedPaneId(null);
        setDragOverSlotIndex(null);
        return;
      }

      // Fallback: check dataTransfer if ref was somehow cleared
      const rawGridData = e.dataTransfer.getData('application/x-tto-grid-pane');
      if (rawGridData) {
        try {
          const parsed = JSON.parse(rawGridData);
          const fromIdx = parsed.slotIndex;
          const toIdx = targetSlotIndex;
          if (typeof fromIdx === 'number' && fromIdx !== toIdx && activeWorkspace && onReorderPanes) {
            onReorderPanes(activeWorkspace.id, fromIdx, toIdx);
            setTimeout(() => {
              for (const [t] of TerminalManager.handles) {
                TerminalManager.fitNow(t);
                TerminalManager.refresh(t);
              }
            }, 80);
          }
        } catch (err) {
          console.error('[GridView] Error during pane reorder:', err);
        }
        draggedSlotRef.current = null;
        setDraggedPaneId(null);
        setDragOverSlotIndex(null);
        return;
      }

      // External file drop
      draggedSlotRef.current = null;
      setDraggedPaneId(null);
      setDragOverSlotIndex(null);
      const paths = extractDropPaths(e.dataTransfer);
      if (paths.length > 0 && onDropToTerminal && tty) {
        onDropToTerminal(tty, paths);
      }
    },
    [activeWorkspace, onReorderPanes, onDropToTerminal]
  );

  const handleDragEnd = useCallback(() => {
    draggedSlotRef.current = null;
    setDraggedPaneId(null);
    setDragOverSlotIndex(null);
  }, []);

  if (!activeWorkspace) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.colors.text.muted }}>
        No workspace selected
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>
      <div style={gridStyle}>
        {slotRows.map(({ slotIndex, pane, isFilled, status, label, cli, displayName, duration, entry }) => {
          if (!isFilled || !pane.tty) {
            const isOverThis = dragOverSlotIndex === slotIndex;
            return (
              <EmptyGridSlot
                key={pane.id}
                slotIndex={slotIndex}
                isDraggingAny={Boolean(draggedPaneId)}
                isOverThis={isOverThis}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onAddPane={onAddPane}
              />
            );
          }

          const isExpanded = expandedPane === pane.id;
          const isSelected = selectedPane === pane.id;
          const isDraggingThis = draggedPaneId === pane.id;
          const isOverThis = dragOverSlotIndex === slotIndex && !isDraggingThis;

          return (
            <GridCard
              key={pane.id}
              pane={pane}
              index={slotIndex}
              status={status}
              label={label}
              cli={cli}
              displayName={displayName}
              duration={duration}
              isExpanded={isExpanded}
              isSelected={isSelected}
              isDraggingThis={isDraggingThis}
              isDraggingAny={Boolean(draggedPaneId)}
              isOverThis={isOverThis}
              totalPanes={filledCount}
              onSelectPane={onSelectPane}
              onExpandPane={onExpandPane}
              onRemovePane={onRemovePane}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onRenameTerminal={onRenameTerminal}
              entry={entry}
              onAddPane={onAddPane}
              cols={cols}
              onSetPaneSizeMode={onSetPaneSizeMode}
            />
          );
        })}
      </div>
    </div>
  );
}
