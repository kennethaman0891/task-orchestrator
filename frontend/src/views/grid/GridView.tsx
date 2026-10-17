'use client';

import { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { scrollbarStyle } from '@/lib/theme';
import type { UnifiedTerminal } from '@/types';
import type { Workspace, Pane, GridMode, TemplateKey } from '@/lib/workspace';
import { GRID_GAP, GRID_MODES, TEMPLATES } from '@/lib/workspace';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import { AgentChatPanel, isAgentCli } from '@/components/terminal/AgentChatPanel';
import { CliLogo } from '@/lib/cliLogos';
import { isClosed, cleanModel } from '@/lib/format';
import { deriveTaskStatus, statusLabel, minTerminal, getTerminalWorkDuration, type TermStatus } from '@/lib/status';
import { TerminalManager } from '@/terminal/TerminalManager';
import { detectCLI } from '@/jarvis/adapters';
import {
  Plus,
  ChevronDown,
  LayoutGrid,
  ScrollText,
  ArrowUp,
  ArrowDown,
  Layers,
  GripVertical,
  MessageSquare,
} from 'lucide-react';
import { extractDropPaths } from '@/terminal/dropPaths';

export const GRID_TEMPLATES: { key: TemplateKey; label: string; count: number }[] = [
  { key: 1, label: 'Single (1)', count: 1 },
  { key: 2, label: 'Split (2)', count: 2 },
  { key: 4, label: 'Quad (4)', count: 4 },
  { key: 6, label: 'Six (6)', count: 6 },
  { key: 8, label: 'Eight (8)', count: 8 },
  { key: 10, label: 'Ten (10)', count: 10 },
  { key: 12, label: 'Twelve (12)', count: 12 },
  { key: 14, label: 'Fourteen (14)', count: 14 },
  { key: 16, label: 'Sixteen (16)', count: 16 },
];

export const MAX_GRID_TERMINALS = 16;

interface Props {
  activeWorkspace?: Workspace;
  workspaces: Workspace[];
  terminals: Record<string, UnifiedTerminal>;
  expandedPane: string | null;
  selectedPane: string | null;
  focusedTerminal?: string | null;
  onSelectTerminal?: (id: string | null) => void;
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
  onSetWorkspaceTemplate?: (template: TemplateKey) => void;
  onSetWorkspaceLayoutMode?: (mode: GridMode) => void;
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
  if (paneCount === 10) {
    return availableWidth >= 1200 ? { cols: 5, rows: 2 } : { cols: 4, rows: 3 };
  }
  if (paneCount <= 12) return { cols: 4, rows: 3 };
  if (paneCount <= 14) {
    return availableWidth >= 1350 ? { cols: 5, rows: 3 } : { cols: 4, rows: 4 };
  }
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
  focusedTerminal?: string | null;
  onSelectTerminal?: (id: string | null) => void;
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
  workspaceLayoutMode?: GridMode;
  /** True while a full-screen TUI (opencode/vim/htop) owns the alternate screen. */
  tuiActive?: boolean;
}

/**
 * Which CLI mark to show in the card head.
 *
 * A real foreground CLI (vim, htop, opencode, git…) always wins. An idle
 * shell or runtime (zsh/bash/sh/fish/node) yields to the agent brand, so an
 * agent card shows *its* mark instead of the shell that happens to host it.
 * Mirrors the resolution used by the reference grid card.
 */
const IDLE_CLI_IDS = ['', 'shell', 'zsh', 'bash', 'sh', 'fish', 'node', 'nodejs'];
function resolveLogoCli(rawCli: string, agent: string): string {
  const c = (rawCli || '').toLowerCase();
  if (!IDLE_CLI_IDS.includes(c)) return c;
  return agent || c;
}

/** Pane size classes a corner drag steps through. */
const RESIZE_STEPS: GridMode[] = ['compact', 'auto', 'large', 'grid'];

// ── Interactive Empty Grid Slot Component ─────────────────────────────
const GridCard = memo(function GridCard({
  pane,
  index,
  status,
  label,
  cli,
  displayName,
  duration,
  isExpanded,
  isSelected,
  focusedTerminal,
  onSelectTerminal,
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
  workspaceLayoutMode,
  tuiActive = false,
}: GridCardProps) {
  const { theme: t } = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);
  const paneMode: GridMode = pane.sizeMode || workspaceLayoutMode || 'auto';

  const [isEditing, setIsEditing] = useState(false);
  const [renameDraft, setRenameDraft] = useState(displayName);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);

  // Responsive thresholds: drop optional chrome so the title and essential controls survive
  const isCompact = cols >= 3 || totalPanes > 4;
  const isUltraCompact = density === 'fit' && (cols >= 5 || totalPanes > 10);

  const agentName = entry?.agent?.trim() || '';
  // The sidecar reports the model at `tokens.model`; `model`/`applied_model` are
  // populated by other sources (Rust session metadata, opencode scan). Take the
  // first that is set so the model badge shows whatever the app actually knows.
  const rawModel = entry?.model || entry?.tokens?.model || entry?.opencode_model || '';
  const shortModel = rawModel ? cleanModel(rawModel) : '';
  const logoCli = resolveLogoCli(entry?.cli || cli, agentName);
  const agentDetected = agentName !== '' && isAgentCli(entry);

  const focusTerminal = useCallback(() => {
    onSelectPane(pane.id);
    if (pane.tty && onSelectTerminal) {
      onSelectTerminal(pane.tty);
    }
    if (pane.tty) {
      TerminalManager.focus(pane.tty);
      requestAnimationFrame(() => {
        if (pane.tty) TerminalManager.focus(pane.tty);
      });
    }
  }, [onSelectPane, onSelectTerminal, pane.id, pane.tty]);

  const handleModeSelect = (mode: GridMode) => {
    setModeDropdownOpen(false);
    onSetPaneSizeMode?.(pane.id, mode);
    setTimeout(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.refresh(tty);
      }
    }, 80);
  };

  // Per-pane agent chat panel — open state persisted like the rest of the grid UI.
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
          const arr = next
            ? cur.includes(pane.tty) ? cur : [...cur, pane.tty]
            : cur.filter((x) => x !== pane.tty);
          localStorage.setItem('tto-grid-chat-open', JSON.stringify(arr));
        } catch { /* noop */ }
      }
      return next;
    });
  };

  /**
   * Corner drag-resize. The reference card resizes panes *proportionally* with
   * a free-form pane-size model; this grid is uniform-track (see
   * computeGridDimensions), so the handle steps the pane's size class instead:
   * drag out to grow the card, drag in to shrink it. Every step commits through
   * onSetPaneSizeMode, so it is fully reversible and never desyncs the layout.
   */
  const startCornerResize = useCallback(
    (e: React.MouseEvent) => {
      if (!onSetPaneSizeMode || !pane.tty) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startIdx = Math.max(0, RESIZE_STEPS.indexOf(paneMode));
      let appliedIdx = startIdx;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX + (ev.clientY - startY);
        let next = startIdx;
        if (delta > 90) next = Math.min(RESIZE_STEPS.length - 1, startIdx + 1);
        else if (delta < -90) next = Math.max(0, startIdx - 1);
        if (next !== appliedIdx) {
          appliedIdx = next;
          onSetPaneSizeMode(pane.id, RESIZE_STEPS[next]);
        }
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [onSetPaneSizeMode, pane.id, pane.tty, paneMode]
  );

  useEffect(() => {
    if (!isEditing) setRenameDraft(displayName);
  }, [displayName, isEditing]);

  const commitRename = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== displayName && onRenameTerminal && pane.tty) {
      onRenameTerminal(pane.tty, trimmed);
    }
    setIsEditing(false);
  };

  const isCardActive = isSelected || (!!pane.tty && focusedTerminal === pane.tty);

  return (
    <div
      ref={cardRef}
      className={`ws-pane ws-pane-term${isExpanded ? ' ws-pane-expanded' : ''}${isCardActive ? ' ws-pane-selected' : ''}`}
      data-agent={cli}
      data-tto-session={pane.tty}
      data-drop-target="terminal"
      style={{
        minWidth: 0,
        // `.ws-pane` / `.ws-pane-term` own the border, radius, background and
        // resting shadow; only live drag / selection feedback is inline.
        opacity: isExpanded ? 1 : isDraggingThis ? 0.4 : 1,
        transform: isExpanded ? 'none' : isDraggingThis ? 'scale(0.98)' : 'none',
        transition: isExpanded ? 'none' : 'border 0.15s ease, background 0.15s ease, opacity 0.15s ease',
        ...(isOverThis
          ? {
              border: `2px dashed ${t.colors.accent.primary}`,
              boxShadow: `0 0 10px ${t.colors.accent.primary}40`,
            }
          : isCardActive
          ? { boxShadow: `0 0 0 1px ${t.colors.accent.primary}, 0 0 12px ${t.colors.accent.primary}25` }
          : {}),
        ...(isExpanded
          ? {}
          : {
              gridColumn: paneMode === 'large' && cols >= 2 ? 'span 2' : 'span 1',
              height: '100%',
            }),
      }}
      onClick={focusTerminal}
      onDragOver={(e) => onDragOver(e, index)}
      onDragLeave={(e) => onDragLeave(e, index)}
      onDrop={(e) => onDrop(e, index, pane.tty)}
      title={`${displayName || pane.tty} — ${label.text}`}
    >
      {/* ── Card head: drag grip · CLI brand mark · agent/model/session · controls ── */}
      <div
        className="ws-pane-head"
        draggable={!isExpanded}
        onDragStart={(e) => onDragStart(e, pane.id, index)}
        onDragEnd={onDragEnd}
        style={{ cursor: isExpanded ? 'default' : 'grab' }}
      >
        {/* Drag grip (project extra) */}
        {!isExpanded && (
          <span
            title="Drag to reorder"
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

        {/* CLI brand mark — replaces the old macOS traffic-light dots */}
        <CliLogo cli={logoCli} size={isUltraCompact ? 11 : 13} />

        {/* Centred title: agent + model badges, then the (renameable) session label */}
        <span className="ws-pane-title">
          {agentName && <span className="ws-pane-agent">{agentName}</span>}
          {shortModel && <span className="ws-pane-model">{shortModel}</span>}
          {isEditing ? (
            <input
              type="text"
              value={renameDraft}
              autoFocus
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
              style={{
                background: '#111',
                border: '1px solid #38bdf8',
                borderRadius: '3px',
                color: '#fff',
                fontSize: '11px',
                padding: '0 4px',
                outline: 'none',
                fontFamily: 'inherit',
                minWidth: 0,
                maxWidth: '160px',
              }}
            />
          ) : (
            <span
              className="ws-pane-id"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              title={`${displayName || pane.tty} (double-click to rename)`}
              // Reference renders this at 9px/#666 because it holds a raw tty id.
              // Here it carries the human label, so it is lifted to secondary.
              style={{ fontSize: '10px', color: t.colors.text.secondary, cursor: 'text' }}
            >
              {displayName || pane.tty}
            </span>
          )}
        </span>

        {/* Live status pill (project extra) */}
        {status !== 'empty' && !isUltraCompact && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '1px 6px',
              borderRadius: '10px',
              background: `${label.color}18`,
              border: `1px solid ${label.color}40`,
              fontSize: '9.5px',
              fontFamily: t.fontFamily.mono,
              fontWeight: 600,
              color: label.color,
              letterSpacing: '0.3px',
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
          </span>
        )}

        {/* Expanded badge — `CLI mode` while a full-screen TUI is up */}
        {isExpanded && (
          <span className={`ws-expand-badge${tuiActive ? ' cli' : ''}`}>
            {tuiActive ? '⤢ CLI mode' : '⤢ expanded'}
          </span>
        )}

        {/* Per-pane sizing dropdown (project extra) */}
        {onSetPaneSizeMode && (!isCompact || isExpanded) && (
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
            <button
              type="button"
              className="pane-size-btn"
              onClick={(e) => {
                e.stopPropagation();
                setModeDropdownOpen((prev) => !prev);
              }}
              title={`Card sizing: ${paneMode.toUpperCase()}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                padding: '1px 5px',
                borderRadius: '3px',
                fontSize: '9.5px',
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
              <ChevronDown size={9} style={{ opacity: 0.8 }} />
            </button>

            {modeDropdownOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 998, cursor: 'default' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setModeDropdownOpen(false);
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
        )}

        {/* New terminal (project extra) */}
        {onAddPane && (!isCompact || isExpanded) && (
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
              flexShrink: 0,
            }}
            title="New terminal"
          >
            <Plus size={11} />
          </span>
        )}

        {/* Agent chat toggle (project extra) */}
        {agentDetected && !isUltraCompact && (
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
              flexShrink: 0,
            }}
            title={chatOpen ? 'Hide agent chat' : 'Open live agent chat'}
          >
            <MessageSquare size={11} />
          </span>
        )}

        {/* Expand / Restore — the reference's labelled, selection-revealed affordance */}
        {isExpanded ? (
          <button
            className="pane-restore-btn"
            onClick={(e) => {
              e.stopPropagation();
              onExpandPane(null);
              if (pane.tty) {
                setTimeout(() => {
                  TerminalManager.fitNow(pane.tty!);
                  TerminalManager.focus(pane.tty!);
                }, 50);
              }
            }}
            title="Exit focus — restore the grid"
          >
            ⤡ Exit focus
          </button>
        ) : isSelected ? (
          <button
            className="pane-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              onExpandPane(pane.id);
              if (pane.tty) {
                setTimeout(() => {
                  TerminalManager.fitNow(pane.tty!);
                  TerminalManager.focus(pane.tty!);
                }, 50);
              }
            }}
            title="Expand — fill the workspace"
          >
            ⤢ Expand
          </button>
        ) : null}

        {/* Focus — always visible, mirrors the reference's ⛶ control */}
        <button
          className={`pane-focus-btn${isExpanded ? ' active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onExpandPane(isExpanded ? null : pane.id);
            if (pane.tty) {
              setTimeout(() => {
                TerminalManager.fitNow(pane.tty!);
                TerminalManager.focus(pane.tty!);
              }, 50);
            }
          }}
          title={isExpanded ? 'Exit focus' : 'Focus terminal (fill the workspace)'}
        >
          ⛶
        </button>

        {/* Close */}
        {(totalPanes > 1 || isExpanded) && (
          <button
            className="ws-close"
            onClick={(e) => {
              e.stopPropagation();
              onRemovePane(pane.id);
            }}
            title="Close terminal"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Terminal content (xterm host + optional agent chat) ── */}
      {pane.tty ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            minHeight: 0,
            minWidth: 0,
            height: '100%',
          }}
        >
          <div
            className="term-pane"
            style={{
              flex: 1,
              position: 'relative',
              height: '100%',
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              background: t.colors.bg.primary,
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
      ) : null}

      {/* Corner resize handle — visible on the selected card only */}
      {isCardActive && !isExpanded && onSetPaneSizeMode && (
        <div
          className="ws-resize-handle"
          onMouseDown={startCornerResize}
          title="Drag to resize this card — drag out to grow, in to shrink"
        />
      )}
    </div>
  );
});

export function GridView({
  activeWorkspace,
  terminals,
  expandedPane,
  selectedPane,
  focusedTerminal,
  onSelectTerminal,
  onExpandPane,
  onSelectPane,
  onRemovePane,
  onReorderPanes,
  onDropToTerminal,
  onRenameTerminal,
  onAddPane,
  onSetPaneSizeMode,
  onSetWorkspaceTemplate,
  onSetWorkspaceLayoutMode,
  onToast,
}: Props) {
  const { theme: t } = useTheme();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const [sizingDropdownOpen, setSizingDropdownOpen] = useState(false);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);

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
    requestAnimationFrame(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.repaint(tty);
      }
    });
  };

  const handleSetColOverride = (c: string) => {
    setColOverride(c);
    try {
      localStorage.setItem('tto-grid-cols', c);
    } catch {}
    requestAnimationFrame(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.repaint(tty);
      }
    });
  };

  const handleSelectTemplate = (tpl: TemplateKey) => {
    setTemplateDropdownOpen(false);
    onSetWorkspaceTemplate?.(tpl);
    requestAnimationFrame(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.repaint(tty);
      }
    });
  };

  const handleSelectLayoutMode = (mode: GridMode) => {
    setSizingDropdownOpen(false);
    onSetWorkspaceLayoutMode?.(mode);
    requestAnimationFrame(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.repaint(tty);
      }
    });
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

  const rawPanes = useMemo(() => activeWorkspace?.panes ?? [], [activeWorkspace?.panes]);

  const currentLayoutMode: GridMode = activeWorkspace?.layoutMode || 'auto';
  const currentModeObj = GRID_MODES.find((m) => m.key === currentLayoutMode) || GRID_MODES[0];
  const currentTemplateKey: TemplateKey = (activeWorkspace?.template && activeWorkspace.template in TEMPLATES) ? activeWorkspace.template : 4;
  const currentTemplateObj = GRID_TEMPLATES.find((t) => t.key === currentTemplateKey) || {
    key: currentTemplateKey,
    label: `${TEMPLATES[currentTemplateKey]?.label || 'Template'} (${currentTemplateKey})`,
    count: currentTemplateKey,
  };

  // Derive slot items — only render active terminals in the workspace (no empty grey boxes)
  const slotItems = useMemo(() => {
    return rawPanes
      .filter((p) => p.tty)
      .slice(0, MAX_GRID_TERMINALS)
      .map((pane, i) => ({
        slotIndex: i,
        pane,
        isFilled: true,
      }));
  }, [rawPanes]);

  const filledCount = slotItems.length;

  const largeCount = useMemo(() => {
    return slotItems.filter((s) => s.pane.sizeMode === 'large').length;
  }, [slotItems]);

  const effectiveSlots = Math.max(1, Math.min(MAX_GRID_TERMINALS, Math.max(filledCount, currentTemplateKey === 1 ? 1 : Math.min(filledCount, currentTemplateKey)) + largeCount));
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

  // Trigger terminal refits when layout, sizes, or window geometry change (debounced via rAF)
  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.repaint(tty);
      }
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [cols, rows, density, containerWidth, containerHeight, paneLayoutKey]);

  const gridStyle = useMemo(() => {
    if (!activeWorkspace) return {};
    const isFit = density === 'fit';
    const isUltraCompact = isFit && filledCount > 12;
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
  }, [activeWorkspace, t, cols, rows, density, filledCount, containerHeight]);

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
        {/* Left: Total Terminals badge, Dropdowns, and Add Terminal */}
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
                background: filledCount >= MAX_GRID_TERMINALS ? '#f59e0b' : '#22c55e',
                boxShadow: filledCount >= MAX_GRID_TERMINALS ? '0 0 6px #f59e0b' : '0 0 6px #22c55e',
              }}
            />
            <span>
              {filledCount}/16 {filledCount === 1 ? 'Terminal' : 'Terminals'}
            </span>
          </div>

          {/* Sizing Mode Dropdown: Auto / Grid / Compact / Large */}
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setTemplateDropdownOpen(false);
                setSizingDropdownOpen((prev) => !prev);
              }}
              title="Grid Sizing Mode"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 8px',
                borderRadius: '5px',
                fontSize: '10.5px',
                fontWeight: 600,
                fontFamily: t.fontFamily.sans,
                background: sizingDropdownOpen ? `${t.colors.accent.primary}25` : t.colors.bg.elevated,
                border: `1px solid ${sizingDropdownOpen ? t.colors.accent.primary : t.colors.border.subtle}`,
                color: t.colors.text.primary,
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                userSelect: 'none',
              }}
            >
              <LayoutGrid size={11} style={{ opacity: 0.8 }} />
              <span style={{ textTransform: 'capitalize' }}>{currentModeObj.label}</span>
              <ChevronDown size={10} style={{ opacity: 0.7 }} />
            </button>

            {sizingDropdownOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 998, cursor: 'default' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSizingDropdownOpen(false);
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '26px',
                    left: 0,
                    zIndex: 999,
                    minWidth: '140px',
                    padding: '4px',
                    borderRadius: '8px',
                    background: '#18181b',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                  }}
                >
                  {GRID_MODES.map((m) => {
                    const isSel = currentLayoutMode === m.key;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectLayoutMode(m.key);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          width: '100%',
                          padding: '5px 8px',
                          borderRadius: '5px',
                          border: 'none',
                          background: isSel ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                          color: isSel ? '#ffffff' : '#a1a1aa',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '11px',
                          fontWeight: isSel ? 600 : 400,
                          transition: 'all 0.1s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSel) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                            e.currentTarget.style.color = '#ffffff';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSel) {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = '#a1a1aa';
                          }
                        }}
                      >
                        <span style={{ width: '14px', display: 'inline-flex', justifyContent: 'center', fontWeight: 'bold', color: '#38bdf8' }}>
                          {isSel ? '✓' : ''}
                        </span>
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Terminal Layout / Count Dropdown: Single (1) ... Sixteen (16) */}
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSizingDropdownOpen(false);
                setTemplateDropdownOpen((prev) => !prev);
              }}
              title="Terminal Layout Template (Max 16)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 8px',
                borderRadius: '5px',
                fontSize: '10.5px',
                fontWeight: 600,
                fontFamily: t.fontFamily.sans,
                background: templateDropdownOpen ? `${t.colors.accent.primary}25` : t.colors.bg.elevated,
                border: `1px solid ${templateDropdownOpen ? t.colors.accent.primary : t.colors.border.subtle}`,
                color: t.colors.text.primary,
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                userSelect: 'none',
              }}
            >
              <Layers size={11} style={{ opacity: 0.8 }} />
              <span>{currentTemplateObj.label}</span>
              <ChevronDown size={10} style={{ opacity: 0.7 }} />
            </button>

            {templateDropdownOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 998, cursor: 'default' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTemplateDropdownOpen(false);
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '26px',
                    left: 0,
                    zIndex: 999,
                    minWidth: '150px',
                    padding: '4px',
                    borderRadius: '8px',
                    background: '#18181b',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                  }}
                >
                  {GRID_TEMPLATES.map((tmpl) => {
                    const isSel = currentTemplateKey === tmpl.key;
                    return (
                      <button
                        key={tmpl.key}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectTemplate(tmpl.key);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          width: '100%',
                          padding: '5px 8px',
                          borderRadius: '5px',
                          border: 'none',
                          background: isSel ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                          color: isSel ? '#ffffff' : '#a1a1aa',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '11px',
                          fontWeight: isSel ? 600 : 400,
                          transition: 'all 0.1s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSel) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                            e.currentTarget.style.color = '#ffffff';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSel) {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = '#a1a1aa';
                          }
                        }}
                      >
                        <span style={{ width: '14px', display: 'inline-flex', justifyContent: 'center', fontWeight: 'bold', color: '#38bdf8' }}>
                          {isSel ? '✓' : ''}
                        </span>
                        <span>{tmpl.label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
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

          {onAddPane && (
            <button
              onClick={() => {
                if (filledCount >= MAX_GRID_TERMINALS) {
                  onToast?.('Maximum of 16 terminals in Grid view reached', true);
                  return;
                }
                onAddPane();
              }}
              disabled={filledCount >= MAX_GRID_TERMINALS}
              title={filledCount >= MAX_GRID_TERMINALS ? 'Maximum of 16 terminals in Grid reached' : 'Add a new terminal to the grid (⌘T)'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: filledCount >= MAX_GRID_TERMINALS ? 'rgba(255, 255, 255, 0.05)' : `${t.colors.accent.primary}20`,
                border: `1px solid ${filledCount >= MAX_GRID_TERMINALS ? 'rgba(255, 255, 255, 0.1)' : `${t.colors.accent.primary}50`}`,
                color: filledCount >= MAX_GRID_TERMINALS ? t.colors.text.muted : t.colors.accent.primary,
                fontSize: '10px',
                fontWeight: 600,
                cursor: filledCount >= MAX_GRID_TERMINALS ? 'not-allowed' : 'pointer',
                opacity: filledCount >= MAX_GRID_TERMINALS ? 0.6 : 1,
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                if (filledCount < MAX_GRID_TERMINALS) {
                  e.currentTarget.style.background = t.colors.accent.primary;
                  e.currentTarget.style.color = '#ffffff';
                }
              }}
              onMouseLeave={(e) => {
                if (filledCount < MAX_GRID_TERMINALS) {
                  e.currentTarget.style.background = `${t.colors.accent.primary}20`;
                  e.currentTarget.style.color = t.colors.accent.primary;
                }
              }}
            >
              <Plus size={11} />
              <span>{filledCount >= MAX_GRID_TERMINALS ? 'Max 16 Reached' : 'Add Terminal'}</span>
              {filledCount < MAX_GRID_TERMINALS && (
                <span style={{ fontSize: '8.5px', opacity: 0.85, padding: '0 3px', borderRadius: '3px', background: 'rgba(0,0,0,0.2)' }}>⌘T</span>
              )}
            </button>
          )}
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
        className={`ws-grid${expandedPane ? ' has-expanded' : ''}${activeWorkspace?.gridFocusMode ? ' focus-mode' : ''}${density === 'scrollable' ? ' grid-scroll-container' : ''}`}
        data-grid-mode={currentLayoutMode}
        style={gridStyle}
      >
        {slotRows.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '260px',
              height: '100%',
              color: t.colors.text.muted,
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '12px' }}>No active terminals in this workspace</span>
            {onAddPane && (
              <button
                type="button"
                onClick={() => onAddPane()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  background: t.colors.accent.primary,
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '12px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                }}
              >
                <Plus size={14} />
                <span>Create Terminal</span>
              </button>
            )}
          </div>
        ) : (
          slotRows.map(
            ({ slotIndex, pane, status, label, cli, displayName, duration, entry }) => {
              const isExpanded = expandedPane === pane.id;
              const isSelected = selectedPane === pane.id;
              const isDraggingThis = draggedPaneId === pane.id;
              const isOverThis = dragOverSlotIndex === slotIndex && !isDraggingThis;
              // Drives the `⤢ CLI mode` badge and hides the command bar so a
              // full-screen TUI keeps every row it needs.
              const tuiActive = pane.tty ? TerminalManager.isTui(pane.tty) : false;

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
                  focusedTerminal={focusedTerminal}
                  onSelectTerminal={onSelectTerminal}
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
                  workspaceLayoutMode={currentLayoutMode}
                  tuiActive={tuiActive}
                />
              );
            }
          )
        )}
      </div>
    </div>
  );
}
