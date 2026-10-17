'use client';

import { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { scrollbarStyle } from '@/lib/theme';
import type { UnifiedTerminal } from '@/types';
import type { Workspace, Pane, GridMode, TemplateKey } from '@/lib/workspace';
import { GRID_GAP, TEMPLATES } from '@/lib/workspace';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import { AgentChatPanel, isAgentCli } from '@/components/terminal/AgentChatPanel';
import { CliLogo } from '@/lib/cliLogos';
import { isClosed, cleanModel } from '@/lib/format';
import { deriveTaskStatus, statusLabel, minTerminal, getTerminalWorkDuration, type TermStatus } from '@/lib/status';
import { TerminalManager } from '@/terminal/TerminalManager';
import { detectCLI } from '@/jarvis/adapters';
import {
  Plus,
  GripVertical,
  MessageSquare,
} from 'lucide-react';
import { extractDropPaths } from '@/terminal/dropPaths';
import { GridNotch } from './GridNotch';

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
  onReorderPanes?: (
    workspaceId: string,
    fromPaneOrIndex: string | number,
    toPaneOrIndex: string | number,
    position?: 'before' | 'after'
  ) => void;
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
  dropPosition: 'before' | 'after' | null;
  totalPanes: number;
  onSelectPane: (id: string) => void;
  onExpandPane: (id: string | null) => void;
  onRemovePane: (paneId: string) => void;
  onDragStart: (e: React.DragEvent, paneId: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, paneId: string, position: 'before' | 'after') => void;
  onDragLeave: (e: React.DragEvent, paneId: string) => void;
  onDrop: (e: React.DragEvent, targetPaneId: string, position: 'before' | 'after', tty: string | null) => void;
  onRenameTerminal?: (idOrTty: string, newLabel: string) => void;
  entry?: UnifiedTerminal;
  cols: number;
  density?: 'fit' | 'scrollable';
  workspaceLayoutMode?: GridMode;
  /** True while a full-screen TUI (opencode/vim/htop) owns the alternate screen. */
  tuiActive?: boolean;
}

const IDLE_CLI_IDS = ['', 'shell', 'zsh', 'bash', 'sh', 'fish', 'node', 'nodejs'];
function resolveLogoCli(rawCli: string, agent: string): string {
  const c = (rawCli || '').toLowerCase();
  if (!IDLE_CLI_IDS.includes(c)) return c;
  return agent || c;
}

const GridCard = memo(function GridCard({
  pane,
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
  dropPosition,
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
  cols,
  density = 'fit',
  workspaceLayoutMode,
  tuiActive = false,
}: GridCardProps) {
  const { theme: t } = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);
  const paneMode: GridMode = pane.sizeMode || workspaceLayoutMode || 'auto';

  const [isEditing, setIsEditing] = useState(false);
  const [renameDraft, setRenameDraft] = useState(displayName);

  // Responsive thresholds: drop optional chrome so the title and essential controls survive
  const isUltraCompact = density === 'fit' && (cols >= 5 || totalPanes > 10);

  const agentName = entry?.agent?.trim() || '';
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

  // Per-pane agent chat panel — open state persisted
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
        position: 'relative',
        minWidth: 0,
        opacity: isExpanded ? 1 : isDraggingThis ? 0.35 : 1,
        transform: isExpanded ? 'none' : isDraggingThis ? 'scale(0.98)' : 'none',
        transition: isExpanded ? 'none' : 'border 0.15s ease, background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease',
        ...(isOverThis
          ? {
              border: `1.5px solid ${t.colors.accent.primary}`,
              boxShadow: dropPosition === 'before'
                ? `inset 4px 0 0 0 ${t.colors.accent.primary}, 0 0 16px ${t.colors.accent.primary}35`
                : `inset -4px 0 0 0 ${t.colors.accent.primary}, 0 0 16px ${t.colors.accent.primary}35`,
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
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = cardRef.current?.getBoundingClientRect();
        if (rect) {
          const isHorizontal = rect.width >= rect.height;
          const ratio = isHorizontal
            ? (e.clientX - rect.left) / rect.width
            : (e.clientY - rect.top) / rect.height;
          onDragOver(e, pane.id, ratio < 0.5 ? 'before' : 'after');
        }
      }}
      onDragLeave={(e) => onDragLeave(e, pane.id)}
      onDrop={(e) => onDrop(e, pane.id, dropPosition || 'after', pane.tty)}
      title={`${displayName || pane.tty} — ${label.text}`}
    >
      {/* ── Card head: drag grip · CLI brand mark · agent/model/session · controls ── */}
      <div
        className="ws-pane-head"
        draggable={!isExpanded && !isEditing}
        onDragStart={(e) => onDragStart(e, pane.id)}
        onDragEnd={onDragEnd}
        style={{ cursor: isExpanded ? 'default' : 'grab' }}
      >
        {/* Drag grip */}
        {!isExpanded && (
          <span
            title="Drag to reorder terminal"
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

        {/* CLI brand mark */}
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
              style={{ fontSize: '10px', color: t.colors.text.secondary, cursor: 'text' }}
            >
              {displayName || pane.tty}
            </span>
          )}
        </span>

        {/* Live status pill */}
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
            title={`Status: ${label.text}${
              status === 'running'
                ? `\nStarted: ${duration?.startTimeFormatted || 'N/A'}\nDuration: ${duration?.durationStr || 'N/A'}`
                : status === 'asking'
                ? `\nWaiting: ${duration?.durationStr || 'N/A'}`
                : (duration as any)?.lastTaskDurationStr
                ? `\nLast Task: ${(duration as any).lastTaskDurationStr}${duration?.endTimeFormatted ? ` (ended ${duration.endTimeFormatted})` : ''}`
                : '\n(Idle)'
            }`}
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

        {/* Expanded badge */}
        {isExpanded && (
          <span className={`ws-expand-badge${tuiActive ? ' cli' : ''}`}>
            {tuiActive ? '⤢ CLI mode' : '⤢ expanded'}
          </span>
        )}

        {/* Agent chat toggle */}
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

        {/* Single clean Maximize / Restore button */}
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
          title={isExpanded ? 'Restore grid view' : 'Maximize terminal'}
        >
          {isExpanded ? '⤡' : '⛶'}
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
}: Props) {
  const { theme: t } = useTheme();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [dragOverInfo, setDragOverInfo] = useState<{ paneId: string; position: 'before' | 'after' } | null>(null);
  const currentDraggedPaneIdRef = useRef<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth - 60 : 1200
  );
  const [containerHeight, setContainerHeight] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight - 60 : 800
  );

  // Density mode: 'fit' (zero scroll, all fit) vs 'scrollable' (comfortable with scrollbar)
  const [density, setDensity] = useState<'fit' | 'scrollable'>(() => {
    try {
      const saved = localStorage.getItem('tto-grid-density');
      if (saved === 'fit' || saved === 'scrollable') return saved;
    } catch {}
    return 'fit';
  });

  // Column override: 'auto' | '1' | '2' | '3' | '4' | '5' | '6' | '8' | '10'
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
  const currentTemplateKey: TemplateKey = (activeWorkspace?.template && activeWorkspace.template in TEMPLATES) ? activeWorkspace.template : 4;

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

  const handleDragStart = useCallback((e: React.DragEvent, paneId: string) => {
    currentDraggedPaneIdRef.current = paneId;
    setDraggedPaneId(paneId);
    try {
      e.dataTransfer.setData('application/x-tto-grid-pane', paneId);
    } catch {}
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, paneId: string, position: 'before' | 'after') => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverInfo((prev) => {
      if (prev?.paneId === paneId && prev.position === position) return prev;
      return { paneId, position };
    });
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, paneId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverInfo((prev) => (prev?.paneId === paneId ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetPaneId: string, position: 'before' | 'after', tty: string | null) => {
      e.preventDefault();
      e.stopPropagation();

      const fromPaneId = e.dataTransfer.getData('application/x-tto-grid-pane') || currentDraggedPaneIdRef.current;
      currentDraggedPaneIdRef.current = null;
      setDraggedPaneId(null);
      setDragOverInfo(null);

      if (fromPaneId && fromPaneId !== targetPaneId) {
        if (activeWorkspace && onReorderPanes) {
          onReorderPanes(activeWorkspace.id, fromPaneId, targetPaneId, position);
          setTimeout(() => {
            for (const [t] of TerminalManager.handles) {
              TerminalManager.fitNow(t);
              TerminalManager.refresh(t);
            }
          }, 80);
        }
        return;
      }

      // External file drop
      const paths = extractDropPaths(e.dataTransfer);
      if (paths.length > 0 && onDropToTerminal && tty) {
        onDropToTerminal(tty, paths);
      }
    },
    [activeWorkspace, onReorderPanes, onDropToTerminal]
  );

  const handleDragEnd = useCallback(() => {
    currentDraggedPaneIdRef.current = null;
    setDraggedPaneId(null);
    setDragOverInfo(null);
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
        position: 'relative',
        height: '100%',
      }}
    >
      {/* ── Floating Zen Notch (Full-Window Draggable Island) ── */}
      <GridNotch
        filledCount={filledCount}
        maxCount={MAX_GRID_TERMINALS}
        density={density}
        onSetDensity={handleSetDensity}
        colOverride={colOverride}
        onSetColOverride={handleSetColOverride}
        onAddPane={onAddPane ? () => onAddPane() : undefined}
        cols={cols}
        rows={rows}
      />

      {/* ── Main Grid Container (100% Full Height Canvas) ── */}
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
            ({ pane, status, label, cli, displayName, duration, entry }) => {
              const isExpanded = expandedPane === pane.id;
              const isSelected = selectedPane === pane.id;
              const isDraggingThis = draggedPaneId === pane.id;
              const isOverThis = dragOverInfo?.paneId === pane.id && !isDraggingThis;
              const dropPosition = isOverThis ? (dragOverInfo?.position || null) : null;
              // Drives the `⤢ CLI mode` badge and hides the command bar so a
              // full-screen TUI keeps every row it needs.
              const tuiActive = pane.tty ? TerminalManager.isTui(pane.tty) : false;

              return (
                <GridCard
                  key={pane.id}
                  pane={pane}
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
                  dropPosition={dropPosition}
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
                  cols={cols}
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
