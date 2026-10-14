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
import { CardComposer } from '@/components/terminal/CardComposer';
import {
  Maximize2,
  Minimize2,
  X,
  GripVertical,
  Plus,
  MessageSquare,
  ChevronDown,
  LayoutGrid,
  ScrollText,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
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
 * Compute balanced columns and rows so all terminals fit cleanly.
 * In 'fit' mode, columns and rows scale with available aspect ratio so that
 * all terminals (including high counts like 36) fit on screen without vertical overflow.
 */
function computeGridDimensions(
  paneCount: number,
  availableWidth: number,
  availableHeight: number,
  colOverride: string = 'auto',
  density: 'fit' | 'scrollable' = 'fit'
): { cols: number; rows: number } {
  if (paneCount <= 1) return { cols: 1, rows: 1 };

  // Manual column override
  if (colOverride !== 'auto') {
    const parsed = parseInt(colOverride, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      return { cols: parsed, rows: Math.max(1, Math.ceil(paneCount / parsed)) };
    }
  }

  // Small counts have hand-tuned optimal arrangements
  if (paneCount === 2) {
    return availableWidth < 680 && availableHeight > 700 ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 };
  }
  if (paneCount === 3) {
    return availableWidth >= 1050 ? { cols: 3, rows: 1 } : { cols: 2, rows: 2 };
  }
  if (paneCount === 4) return { cols: 2, rows: 2 };
  if (paneCount === 5 || paneCount === 6) return { cols: 3, rows: 2 };
  if (paneCount === 7 || paneCount === 8) {
    return availableWidth >= 1200 ? { cols: 4, rows: 2 } : { cols: 3, rows: 3 };
  }
  if (paneCount === 9) return { cols: 3, rows: 3 };
  if (paneCount <= 12) return { cols: 4, rows: 3 };
  if (paneCount <= 16) return { cols: 4, rows: 4 };

  // For high terminal counts (> 16, e.g. 20, 25, 36, 48):
  const w = Math.max(availableWidth, 600);
  const h = Math.max(availableHeight, 400);
  const aspect = w / h;

  if (density === 'fit') {
    // In fit mode, cols = sqrt(paneCount * aspect)
    let bestCols = Math.round(Math.sqrt(paneCount * aspect));
    // Each column needs at least 110px width
    const maxCols = Math.max(2, Math.floor(w / 110));
    bestCols = Math.max(2, Math.min(maxCols, bestCols));
    const bestRows = Math.max(1, Math.ceil(paneCount / bestCols));
    return { cols: bestCols, rows: bestRows };
  } else {
    // Scrollable mode: keep cards comfortably wide (min ~220px each)
    const comfortableCols = Math.max(2, Math.min(8, Math.floor(w / 220)));
    const rows = Math.max(1, Math.ceil(paneCount / comfortableCols));
    return { cols: comfortableCols, rows };
  }
}

// ── Virtualized GridCard Component ─────────────────────────────────────
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
  entry?: UnifiedTerminal;
  onAddPane?: (targetSlotIndex?: number) => void;
  cols: number;
  onSetPaneSizeMode?: (paneId: string, mode: GridMode) => void;
  density?: 'fit' | 'scrollable';
}

// ── Interactive Empty Grid Slot Component ─────────────────────────────
interface EmptyGridSlotProps {
  slotIndex: number;
  isDraggingAny: boolean;
  isOverThis: boolean;
  onDragOver: (e: React.DragEvent, slotIndex: number) => void;
  onDragLeave: (e: React.DragEvent, slotIndex: number) => void;
  onDrop: (e: React.DragEvent, targetSlotIndex: number, tty: string | null) => void;
  onAddPane?: (targetSlotIndex?: number) => void;
  density?: 'fit' | 'scrollable';
}

function EmptyGridSlot({
  slotIndex,
  isDraggingAny,
  isOverThis,
  onDragOver,
  onDragLeave,
  onDrop,
  onAddPane,
  density = 'fit',
}: EmptyGridSlotProps) {
  const { theme: t } = useTheme();

  return (
    <div
      data-slot-index={slotIndex}
      data-empty-slot="true"
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
        minHeight: density === 'fit' ? '0' : '200px',
        height: '100%',
        minWidth: 0,
        boxShadow: isOverThis ? `0 0 14px ${t.colors.accent.primary}40` : 'none',
        transition: 'all 0.15s ease',
        cursor: isDraggingAny ? 'copy' : 'default',
        padding: '12px',
        textAlign: 'center',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          opacity: isOverThis ? 1 : 0.65,
          transition: 'opacity 0.15s ease',
        }}
      >
        <span
          style={{
            fontSize: '10.5px',
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
              padding: '5px 12px',
              borderRadius: '5px',
              fontSize: '10.5px',
              fontWeight: 600,
              fontFamily: t.fontFamily.sans,
              background: isOverThis ? t.colors.accent.primary : `${t.colors.accent.primary}20`,
              border: `1px solid ${t.colors.accent.primary}`,
              color: isOverThis ? '#ffffff' : t.colors.accent.primary,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginTop: '2px',
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
            <Plus size={12} />
            <span>Add Terminal</span>
          </button>
        )}

        <span
          style={{
            fontSize: '9.5px',
            color: t.colors.text.muted,
            opacity: 0.7,
            marginTop: '2px',
          }}
        >
          {isOverThis ? 'Release to place terminal into this slot' : 'Drag terminal here to place'}
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
  density = 'fit',
}: GridCardProps) {
  const { theme: t } = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [renameDraft, setRenameDraft] = useState(displayName);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const paneMode: GridMode = pane.sizeMode || 'auto';

  const isUltraCompact = density === 'fit' && totalPanes > 16;
  const isCompactCard = isUltraCompact || paneMode === 'compact';

  const handleModeSelect = (mode: GridMode) => {
    setDropdownOpen(false);
    onSetPaneSizeMode?.(pane.id, mode);
    setTimeout(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.refresh(tty);
      }
    }, 50);
    setTimeout(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.refresh(tty);
      }
    }, 180);
  };

  useEffect(() => {
    if (!isEditing) setRenameDraft(displayName);
  }, [displayName, isEditing]);

  // Agent chat panel — per-pane open state
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
        boxShadow: isExpanded
          ? '0 8px 32px rgba(0,0,0,0.85)'
          : isOverThis
          ? `0 0 10px ${t.colors.accent.primary}40`
          : 'none',
        transition: isExpanded ? 'none' : 'border 0.15s ease, background 0.15s ease, opacity 0.15s ease',
        position: isExpanded ? 'fixed' : 'relative',
        opacity: isExpanded ? 1 : isDraggingThis ? 0.4 : 1,
        transform: isExpanded ? 'none' : isDraggingThis ? 'scale(0.98)' : 'none',
        zIndex: isExpanded ? 100 : 1,
        overscrollBehavior: 'contain',
        ...(isExpanded
          ? {
              inset: '40px 10px 10px 10px',
            }
          : {
              gridColumn: paneMode === 'large' && cols >= 2 ? 'span 2' : 'span 1',
              minHeight:
                density === 'fit'
                  ? '0'
                  : paneMode === 'compact'
                  ? '180px'
                  : paneMode === 'large'
                  ? '280px'
                  : '220px',
              height: '100%',
            }),
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
          height: isCompactCard ? '22px' : '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isCompactCard ? '0 5px' : '0 8px',
          background: t.colors.bg.secondary,
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          cursor: isExpanded ? 'default' : 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isUltraCompact ? '3px' : '6px', minWidth: 0, flex: 1 }}>
          {!isExpanded && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                color: t.colors.text.muted,
                opacity: 0.6,
                cursor: 'grab',
                flexShrink: 0,
              }}
            >
              <GripVertical size={isUltraCompact ? 11 : 13} />
            </span>
          )}
          <CliLogo cli={cli} size={isUltraCompact ? 11 : 13} />
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
                fontSize: isUltraCompact ? '10px' : '11px',
                fontWeight: 600,
                color: t.colors.text.primary,
                background: t.colors.bg.primary,
                border: `1px solid ${t.colors.accent.primary}`,
                borderRadius: '3px',
                padding: '1px 4px',
                outline: 'none',
                minWidth: '60px',
                maxWidth: '160px',
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
                fontSize: isUltraCompact ? '10px' : '11px',
                fontWeight: 600,
                color: t.colors.text.primary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'text',
              }}
              title={`${displayName} (double-click to rename)`}
            >
              {displayName}
            </span>
          )}
        </div>

        {/* Right side of header: Status badge + size dropdown + controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isUltraCompact ? '3px' : '6px', flexShrink: 0 }}>
          {status !== 'empty' && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: isUltraCompact ? '1px 4px' : '1px 6px',
                borderRadius: '10px',
                background: `${label.color}18`,
                border: `1px solid ${label.color}40`,
                fontSize: isUltraCompact ? '8.5px' : '9.5px',
                fontFamily: t.fontFamily.mono,
                fontWeight: 600,
                color: label.color,
                letterSpacing: '0.3px',
                cursor: 'default',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title={`Status: ${label.text}\nStarted: ${duration?.startTimeFormatted || 'N/A'}${duration?.durationStr ? `\nDuration: ${duration.durationStr}` : ''}`}
            >
              <span
                style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  background: label.color,
                  boxShadow: status === 'running' || status === 'asking' ? `0 0 5px ${label.color}` : 'none',
                  flexShrink: 0,
                }}
              />
              <span>{label.text}</span>
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
                gap: '2px',
                padding: isCompactCard ? '1px 3px' : '1px 5px',
                borderRadius: '3px',
                fontSize: isCompactCard ? '8.5px' : '9.5px',
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
            >
              <span>{paneMode}</span>
              <ChevronDown size={isCompactCard ? 7 : 9} style={{ opacity: 0.8 }} />
            </button>

              {dropdownOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 998, cursor: 'default' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropdownOpen(false);
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: '22px',
                      right: 0,
                      zIndex: 999,
                      minWidth: '140px',
                      padding: '4px',
                      borderRadius: '5px',
                      background: t.colors.bg.elevated || '#1c1d22',
                      border: `1px solid ${t.colors.border.primary}`,
                      boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    {GRID_MODES.map((m) => {
                      const isSel = paneMode === m.key;
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
                            padding: '4px 6px',
                            borderRadius: '3px',
                            border: 'none',
                            background: isSel ? `${t.colors.accent.primary}25` : 'transparent',
                            color: isSel ? t.colors.accent.primary : t.colors.text.primary,
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '10.5px',
                          }}
                        >
                          <span>{m.label}</span>
                          {isSel && <span style={{ fontWeight: 'bold' }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

          {/* New terminal (+) */}
          {onAddPane && !isUltraCompact && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddPane(index + 1);
              }}
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '2px',
                borderRadius: '3px',
                color: t.colors.text.muted,
                transition: 'color 0.12s, background 0.12s',
              }}
              title="New terminal"
            >
              <Plus size={11} />
            </span>
          )}

          {/* Agent chat toggle */}
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
                padding: '2px',
                borderRadius: '3px',
                color: chatOpen ? t.colors.accent.primary : t.colors.text.muted,
                background: chatOpen ? t.colors.bg.hover : 'transparent',
              }}
              title={chatOpen ? 'Hide agent chat' : 'Open live agent chat'}
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
              padding: '2px',
              borderRadius: '3px',
              color: isExpanded ? t.colors.accent.primary : t.colors.text.muted,
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
                padding: '2px',
                borderRadius: '3px',
                color: t.colors.text.muted,
              }}
              title="Close pane"
            >
              <X size={11} />
            </span>
          )}
        </div>
      </div>

      {/* Terminal content */}
      {pane.tty ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, height: '100%' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, minWidth: 0 }}>
            <div
              style={{
                flex: 1,
                position: 'relative',
                background: t.colors.bg.primary,
                minHeight: 0,
                minWidth: 0,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
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
                width={260}
              />
            )}
          </div>
          <CardComposer
            sessionId={pane.tty}
            displayName={displayName}
            cli={cli}
            isCompact={isCompactCard}
            isUltraCompact={isUltraCompact}
          />
        </div>
      ) : null}
    </div>
  );
}

export function GridView({
  activeWorkspace,
  terminals,
  expandedPane,
  selectedPane,
  onExpandPane,
  onSelectPane,
  onRemovePane,
  onReorderPanes,
  onDropToTerminal,
  onRenameTerminal,
  onAddPane,
  onSetPaneSizeMode,
}: Props) {
  const { theme: t } = useTheme();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const draggedSlotRef = useRef<{ paneId: string; slotIndex: number } | null>(null);
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth - 60 : 1200
  );
  const [containerHeight, setContainerHeight] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight - 100 : 800
  );

  // Density mode: 'fit' (zero scroll, all fit) vs 'scrollable' (comfortable with scrollbar)
  const [density, setDensity] = useState<'fit' | 'scrollable'>(() => {
    try {
      const saved = localStorage.getItem('tto-grid-density');
      if (saved === 'fit' || saved === 'scrollable') return saved;
    } catch {}
    return 'fit';
  });

  // Column override: 'auto' | '3' | '4' | '5' | '6' | '7' | '8' | '10'
  const [colOverride, setColOverride] = useState<string>(() => {
    try {
      return localStorage.getItem('tto-grid-cols') || 'auto';
    } catch {
      return 'auto';
    }
  });

  const handleSetDensity = (d: 'fit' | 'scrollable') => {
    setDensity(d);
    try {
      localStorage.setItem('tto-grid-density', d);
    } catch {}
    setTimeout(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.refresh(tty);
      }
    }, 60);
  };

  const handleSetColOverride = (c: string) => {
    setColOverride(c);
    try {
      localStorage.setItem('tto-grid-cols', c);
    } catch {}
    setTimeout(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.refresh(tty);
      }
    }, 60);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute total template slots: at least the workspace template count, and at least existing panes length
  const templateCount = activeWorkspace?.template ?? 4;
  const rawPanes = useMemo(() => activeWorkspace?.panes ?? [], [activeWorkspace?.panes]);
  const totalSlots = Math.max(templateCount, rawPanes.length);

  // Derive slot items
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

  const effectiveSlots = totalSlots + largeCount;
  const { cols, rows: rawRows } = computeGridDimensions(
    effectiveSlots,
    containerWidth,
    containerHeight,
    colOverride,
    density
  );

  // Compute exact row requirements with large (span 2) cards taken into account
  const totalUnits = useMemo(() => {
    return slotItems.reduce((acc, s) => {
      if (s.isFilled && s.pane.sizeMode === 'large' && cols >= 2) {
        return acc + 2;
      }
      return acc + 1;
    }, 0);
  }, [slotItems, cols]);

  const requiredRows = Math.max(1, Math.ceil(totalUnits / Math.max(1, cols)));
  const rows = Math.max(rawRows, requiredRows);

  const paneLayoutKey = useMemo(
    () => slotItems.map((s) => `${s.pane.id}:${s.pane.sizeMode || 'auto'}:${s.pane.tty}`).join('|'),
    [slotItems]
  );

  // Trigger terminal refits when layout, sizes, or window geometry change
  useEffect(() => {
    const refitAll = () => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.refresh(tty);
      }
    };
    refitAll();
    const t1 = window.setTimeout(refitAll, 80);
    const t2 = window.setTimeout(refitAll, 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [cols, rows, density, containerWidth, containerHeight, paneLayoutKey]);

  const gridStyle = useMemo(() => {
    if (!activeWorkspace) return {};
    const isFit = density === 'fit';
    const isUltraCompact = isFit && totalSlots > 16;
    const minCardHeight = isUltraCompact ? 60 : 80;
    const needsScroll = isFit && rows * minCardHeight > containerHeight;
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridTemplateRows: isFit && !needsScroll
        ? `repeat(${rows}, minmax(0, 1fr))`
        : `repeat(${rows}, minmax(180px, 1fr))`,
      gridAutoRows: isFit && !needsScroll ? 'minmax(0, 1fr)' : 'minmax(180px, 1fr)',
      gridAutoFlow: 'dense',
      alignContent: 'stretch',
      alignItems: 'stretch',
      gap: `${isUltraCompact ? 4 : GRID_GAP}px`,
      padding: isUltraCompact ? '5px' : t.spacing.md,
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      height: '100%',
      overflowY: (!isFit || needsScroll) ? ('auto' as const) : ('hidden' as const),
      overflowX: 'hidden' as const,
      overscrollBehavior: 'contain' as const,
      ...((!isFit || needsScroll) ? scrollbarStyle(t) : {}),
    };
  }, [activeWorkspace, t, cols, rows, density, totalSlots, containerHeight]);

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

        const defaultName =
          meta?.cliName && meta.cli !== 'shell'
            ? `${meta.cliName} · ${slotIndex + 1}`
            : entry?.session_name || entry?.pane_title || `Terminal ${slotIndex + 1}`;

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
    } catch {}
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
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: t.colors.text.muted,
        }}
      >
        No workspace selected
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {/* ── Grid Control Toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '32px',
          padding: '0 12px',
          flexShrink: 0,
          background: t.colors.bg.secondary,
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          fontSize: '11px',
          gap: '8px',
          userSelect: 'none',
        }}
      >
        {/* Left: Total Terminals badge & Layout pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 8px',
              borderRadius: '12px',
              background: t.colors.bg.elevated,
              border: `1px solid ${t.colors.border.subtle}`,
              fontSize: '10.5px',
              fontWeight: 600,
              color: t.colors.text.primary,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 6px #22c55e',
              }}
            />
            <span>
              {filledCount} {filledCount === 1 ? 'Terminal' : 'Terminals'} in Grid
            </span>
          </div>

          <span
            style={{
              fontSize: '10px',
              color: t.colors.text.muted,
              fontFamily: t.fontFamily.mono,
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '1px 6px',
              borderRadius: '4px',
            }}
          >
            {cols} cols × {rows} rows {density === 'fit' ? '(Fit)' : '(Scroll)'}
          </span>
        </div>

        {/* Right: Density toggle + Column selector + Quick scroll */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Fit vs Scrollable Toggle */}
          <div
            style={{
              display: 'inline-flex',
              background: t.colors.bg.elevated,
              borderRadius: '5px',
              padding: '2px',
              border: `1px solid ${t.colors.border.subtle}`,
            }}
          >
            <button
              onClick={() => handleSetDensity('fit')}
              title="Fit all terminals on a single screen with zero scrolling"
              style={{
                padding: '2px 8px',
                borderRadius: '3px',
                border: 'none',
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
                background: density === 'fit' ? t.colors.accent.primary : 'transparent',
                color: density === 'fit' ? '#fff' : t.colors.text.muted,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.12s ease',
              }}
            >
              <LayoutGrid size={11} />
              <span>Fit Screen</span>
            </button>
            <button
              onClick={() => handleSetDensity('scrollable')}
              title="Scrollable cards with comfortable terminal height"
              style={{
                padding: '2px 8px',
                borderRadius: '3px',
                border: 'none',
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
                background: density === 'scrollable' ? t.colors.accent.primary : 'transparent',
                color: density === 'scrollable' ? '#fff' : t.colors.text.muted,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.12s ease',
              }}
            >
              <ScrollText size={11} />
              <span>Scrollable</span>
            </button>
          </div>

          {/* Columns Selector */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: t.colors.text.muted,
            }}
          >
            <span>Cols:</span>
            <select
              value={colOverride}
              onChange={(e) => handleSetColOverride(e.target.value)}
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                background: t.colors.bg.elevated,
                border: `1px solid ${t.colors.border.subtle}`,
                color: t.colors.text.primary,
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="auto">Auto</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6">6</option>
              <option value="7">7</option>
              <option value="8">8</option>
              <option value="10">10</option>
            </select>
          </div>

          {/* Quick Scroll buttons (when in scrollable mode) */}
          {density === 'scrollable' && (
            <div style={{ display: 'flex', gap: '3px' }}>
              <button
                onClick={() => gridContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                title="Scroll to Top"
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '3px',
                  background: t.colors.bg.elevated,
                  border: `1px solid ${t.colors.border.subtle}`,
                  color: t.colors.text.muted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <ArrowUp size={11} />
              </button>
              <button
                onClick={() =>
                  gridContainerRef.current?.scrollTo({
                    top: gridContainerRef.current.scrollHeight,
                    behavior: 'smooth',
                  })
                }
                title="Scroll to Bottom"
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '3px',
                  background: t.colors.bg.elevated,
                  border: `1px solid ${t.colors.border.subtle}`,
                  color: t.colors.text.muted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <ArrowDown size={11} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Grid Container ── */}
      <div
        ref={gridContainerRef}
        className={density === 'scrollable' ? 'grid-scroll-container' : undefined}
        style={gridStyle}
      >
        {slotRows.map(
          ({ slotIndex, pane, isFilled, status, label, cli, displayName, duration, entry }) => {
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
                  density={density}
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
                density={density}
              />
            );
          }
        )}
      </div>
    </div>
  );
}
