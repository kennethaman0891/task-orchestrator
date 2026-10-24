'use client';

import { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { scrollbarStyle } from '@/lib/theme';
import type { UnifiedTerminal } from '@/types';
import type { Workspace, Pane, GridMode, TemplateKey, GridDensity } from '@/lib/workspace';
import { GRID_GAP, TEMPLATES, computeGridLayout, paintedGridSlots } from '@/lib/workspace';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import { AgentChatPanel, isAgentCli } from '@/components/terminal/AgentChatPanel';
import { CliLogo } from '@/lib/cliLogos';
import { isClosed, cleanModel } from '@/lib/format';
import { deriveTaskStatus, statusLabel, minTerminal, getTerminalWorkDuration, type TermStatus } from '@/lib/status';
import { TerminalManager } from '@/terminal/TerminalManager';
import { detectCLI } from '@/jarvis/adapters';
import { isTauri, tauri } from '@/lib/tauri';
import {
  Plus,
  GripVertical,
  MessageSquare,
  Maximize2,
  Minimize2,
  X,
  SquareTerminal,
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
    position?: 'before' | 'after' | 'swap'
  ) => void;
  onDropToTerminal?: (sessionId: string, paths: string[]) => void;
  onRenameTerminal?: (idOrTty: string, newLabel: string) => void;
  onAddPane?: (targetSlotIndex?: number) => void;
  onSetPaneSizeMode?: (paneId: string, mode: GridMode) => void;
  onSetWorkspaceTemplate?: (template: TemplateKey) => void;
  onSetWorkspaceLayoutMode?: (mode: GridMode) => void;
}

const IDLE_CLI_IDS = ['', 'shell', 'zsh', 'bash', 'sh', 'fish', 'node', 'nodejs'];
function resolveLogoCli(rawCli: string, agent: string): string {
  const c = (rawCli || '').toLowerCase();
  if (!IDLE_CLI_IDS.includes(c)) return c;
  return agent || c;
}

/** Ticks once a second only while a terminal is running or asking. */
const LiveDuration = memo(function LiveDuration({
  tty,
  status,
}: {
  tty: string;
  status: TermStatus;
}) {
  const live = status === 'running' || status === 'asking';
  const [durationStr, setDurationStr] = useState(
    () => getTerminalWorkDuration(tty, status).durationStr,
  );

  useEffect(() => {
    const update = () => {
      setDurationStr(getTerminalWorkDuration(tty, status).durationStr);
    };
    update();
    if (!live) return;
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [tty, status, live]);

  if (!durationStr) return null;
  return <span>{durationStr}</span>;
});

interface EmptyGridSlotProps {
  slotIndex: number;
  paneId: string | null;
  density: GridDensity;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDragLeave: (e: React.DragEvent, key: string) => void;
  onDrop: (e: React.DragEvent, paneId: string | null, slotIndex: number) => void;
  onAddPane?: (slotIndex: number) => void;
}

const EmptyGridSlot = memo(function EmptyGridSlot({
  slotIndex,
  paneId,
  density,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onAddPane,
}: EmptyGridSlotProps) {
  const { theme: t } = useTheme();
  const dropKey = paneId || `ghost-${slotIndex}`;

  return (
    <div
      className={`ws-pane ws-pane-ghost${isDragOver ? ' is-drop-target' : ''}`}
      data-slot-index={slotIndex}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        onDragOver(e, dropKey);
      }}
      onDragLeave={(e) => onDragLeave(e, dropKey)}
      onDrop={(e) => onDrop(e, paneId, slotIndex)}
      style={{
        height: '100%',
        minHeight: density === 'scrollable' ? 180 : 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        background: isDragOver ? `${t.colors.accent.primary}14` : 'transparent',
        border: `1px dashed ${isDragOver ? t.colors.accent.primary : t.colors.border.primary}`,
        color: isDragOver ? t.colors.accent.primary : t.colors.text.muted,
        boxShadow: 'none',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: t.fontFamily.mono,
          letterSpacing: '0.02em',
          opacity: 0.9,
        }}
      >
        {isDragOver ? 'Drop to place terminal here' : `Slot ${slotIndex + 1} · Empty`}
      </span>
      {onAddPane && !isDragOver && (
        <button
          type="button"
          className="ws-pane-icon-btn"
          title={`Create terminal in slot ${slotIndex + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            onAddPane(slotIndex);
          }}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
});

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
  density?: GridDensity;
  tuiActive?: boolean;
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
  tuiActive = false,
}: GridCardProps) {
  const { theme: t } = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [renameDraft, setRenameDraft] = useState(displayName);

  const isUltraCompact = !isExpanded && density === 'fit' && (cols >= 5 || totalPanes > 10);
  const iconBtnSize = isUltraCompact ? 18 : 22;
  const lucideSize = 12;

  const agentName = entry?.agent?.trim() || '';
  const rawModel = entry?.model || entry?.tokens?.model || entry?.opencode_model || '';
  const shortModel = rawModel ? cleanModel(rawModel) : '';
  const logoCli = resolveLogoCli(entry?.cli || cli, agentName);
  const agentDetected = agentName !== '' && isAgentCli(entry);
  const showStatusDot = isExpanded || isUltraCompact;

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

  const statusTitle = `Status: ${label.text}${
    status === 'running'
      ? `\nStarted: ${duration?.startTimeFormatted || 'N/A'}`
      : status === 'asking'
      ? ''
      : (duration as { lastTaskDurationStr?: string } | null)?.lastTaskDurationStr
      ? `\nLast Task: ${(duration as { lastTaskDurationStr?: string }).lastTaskDurationStr}${duration?.endTimeFormatted ? ` (ended ${duration.endTimeFormatted})` : ''}`
      : status === 'stopped'
      ? '\n(Idle)'
      : ''
  }`;

  const refitPane = () => {
    if (!pane.tty) return;
    setTimeout(() => {
      TerminalManager.fitNow(pane.tty!);
      TerminalManager.focus(pane.tty!);
    }, 50);
  };

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
              gridColumn: pane.sizeMode === 'large' && cols >= 2 ? 'span 2' : 'span 1',
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
      <div className="ws-pane-head">
        {!isExpanded && (
          <span
            draggable={!isEditing}
            onDragStart={(e) => onDragStart(e, pane.id)}
            onDragEnd={onDragEnd}
            title="Drag to reorder terminal"
            style={{
              display: 'flex',
              alignItems: 'center',
              color: t.colors.text.muted,
              opacity: 0.6,
              cursor: isEditing ? 'default' : 'grab',
              flexShrink: 0,
            }}
          >
            <GripVertical size={isUltraCompact ? 11 : 13} />
          </span>
        )}

        <CliLogo cli={logoCli} size={isUltraCompact ? 11 : 13} />

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
          {tuiActive && (
            <span
              title="Full-screen TUI"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                color: t.colors.text.muted,
                flexShrink: 0,
                opacity: 0.85,
              }}
            >
              <SquareTerminal size={lucideSize} />
            </span>
          )}
        </span>

        {status !== 'empty' && !showStatusDot && (
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
            title={statusTitle}
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
            {pane.tty && (status === 'running' || status === 'asking') && (
              <LiveDuration tty={pane.tty} status={status} />
            )}
          </span>
        )}

        {status !== 'empty' && showStatusDot && (
          <span
            title={statusTitle}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: label.color,
              boxShadow: status === 'running' || status === 'asking' ? `0 0 5px ${label.color}` : 'none',
              flexShrink: 0,
            }}
          />
        )}

        {agentDetected && !isExpanded && (
          <button
            type="button"
            className="ws-pane-icon-btn"
            style={{ width: iconBtnSize, height: iconBtnSize, color: chatOpen ? t.colors.accent.primary : undefined }}
            onClick={(e) => {
              e.stopPropagation();
              toggleChat();
            }}
            title={chatOpen ? 'Hide agent chat' : 'Open live agent chat'}
          >
            <MessageSquare size={lucideSize} />
          </button>
        )}

        {isExpanded ? (
          <button
            type="button"
            className="ws-pane-icon-btn wide"
            onClick={(e) => {
              e.stopPropagation();
              onExpandPane(null);
              refitPane();
            }}
            title="Restore grid (Esc)"
          >
            <Minimize2 size={lucideSize} />
            Restore
          </button>
        ) : (
          <button
            type="button"
            className="ws-pane-icon-btn"
            style={{ width: iconBtnSize, height: iconBtnSize }}
            onClick={(e) => {
              e.stopPropagation();
              onExpandPane(pane.id);
              refitPane();
            }}
            title="Maximize terminal"
          >
            <Maximize2 size={lucideSize} />
          </button>
        )}

        {totalPanes > 1 && (
          <button
            type="button"
            className="ws-pane-icon-btn danger"
            style={{ width: iconBtnSize, height: iconBtnSize }}
            onClick={(e) => {
              e.stopPropagation();
              onRemovePane(pane.id);
            }}
            title="Close terminal"
          >
            <X size={lucideSize} />
          </button>
        )}
      </div>

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
          {agentDetected && chatOpen && !isExpanded && entry && (
            <AgentChatPanel
              key={pane.tty}
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
  onSetWorkspaceLayoutMode,
}: Props) {
  const { theme: t } = useTheme();

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

  const [density, setDensity] = useState<GridDensity>(() => {
    try {
      const saved = localStorage.getItem('tto-grid-density');
      if (saved === 'fit' || saved === 'scrollable') return saved;
    } catch {}
    return 'fit';
  });

  const handleSetDensity = (d: GridDensity) => {
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

  const rawPanes = useMemo(() => activeWorkspace?.panes ?? [], [activeWorkspace?.panes]);

  const handleSetLayoutMode = useCallback((mode: GridMode) => {
    onSetWorkspaceLayoutMode?.(mode);
    if (isTauri()) {
      for (const pane of rawPanes) {
        if (pane.tty) {
          tauri.setGridMode(pane.tty, mode).catch(() => {});
        }
      }
    }
    requestAnimationFrame(() => {
      for (const [tty] of TerminalManager.handles) {
        TerminalManager.fitNow(tty);
        TerminalManager.repaint(tty);
      }
    });
  }, [onSetWorkspaceLayoutMode, rawPanes]);

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

  const currentLayoutMode: GridMode = activeWorkspace?.layoutMode || 'auto';
  const currentTemplateKey: TemplateKey = (activeWorkspace?.template && activeWorkspace.template in TEMPLATES) ? activeWorkspace.template : 4;

  const filledCount = useMemo(() => rawPanes.filter((p) => p.tty).length, [rawPanes]);
  const rawPanesRef = useRef(rawPanes);
  rawPanesRef.current = rawPanes;

  useEffect(() => {
    if (expandedPane && !rawPanes.some((p) => p.id === expandedPane && p.tty)) {
      onExpandPane(null);
    }
  }, [expandedPane, rawPanes, onExpandPane]);

  useEffect(() => {
    const filled = rawPanes.filter((p): p is Pane & { tty: string } => Boolean(p.tty));
    const expandedTty = expandedPane
      ? filled.find((p) => p.id === expandedPane)?.tty ?? null
      : null;
    for (const pane of filled) {
      const hide = Boolean(expandedTty) && pane.tty !== expandedTty;
      TerminalManager.setVisible(pane.tty, !hide);
    }
  }, [expandedPane, rawPanes]);

  useEffect(() => {
    return () => {
      for (const pane of rawPanesRef.current) {
        if (pane.tty) TerminalManager.setVisible(pane.tty, true);
      }
    };
  }, []);

  const seedCount = Math.min(
    MAX_GRID_TERMINALS,
    Math.max(currentTemplateKey, rawPanes.length, filledCount, 1),
  );
  const seedCols = computeGridLayout({
    paneCount: seedCount,
    width: containerWidth,
    height: containerHeight,
    mode: currentLayoutMode,
    density,
    template: currentTemplateKey,
  }).cols;
  const effectiveSlots = paintedGridSlots({
    template: currentTemplateKey,
    paneCount: rawPanes.length,
    filledCount,
    cols: seedCols,
    mode: currentLayoutMode,
  });
  const { cols, rows: rawRows } = computeGridLayout({
    paneCount: effectiveSlots,
    width: containerWidth,
    height: containerHeight,
    mode: currentLayoutMode,
    density,
    template: currentTemplateKey,
  });

  const slotItems = useMemo(() => {
    const items: { slotIndex: number; pane: Pane; isFilled: boolean; isPadding: boolean }[] = [];
    for (let i = 0; i < effectiveSlots; i++) {
      const pane = rawPanes[i];
      if (pane) {
        items.push({
          slotIndex: i,
          pane,
          isFilled: Boolean(pane.tty),
          isPadding: false,
        });
      } else {
        items.push({
          slotIndex: i,
          pane: { id: `ghost-${i}`, tty: null },
          isFilled: false,
          isPadding: true,
        });
      }
    }
    return items;
  }, [rawPanes, effectiveSlots]);

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
      slotItems.map(({ slotIndex, pane, isFilled, isPadding }) => {
        if (!isFilled || !pane.tty) {
          return {
            slotIndex,
            pane,
            isFilled: false,
            isPadding,
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
          isPadding: false,
          entry,
          status,
          label: statusLabel(status),
          cli: meta ? meta.cli : 'shell',
          displayName,
          duration: meta ? meta.duration : null,
        };
      }),
    [slotItems, terminals, activeWorkspace?.command]
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

  const handleEmptyDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverInfo((prev) => {
      if (prev?.paneId === key && prev.position === 'before') return prev;
      return { paneId: key, position: 'before' };
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
            for (const [tid] of TerminalManager.handles) {
              TerminalManager.fitNow(tid);
              TerminalManager.refresh(tid);
            }
          }, 80);
        }
        return;
      }

      const paths = extractDropPaths(e.dataTransfer);
      if (paths.length > 0 && onDropToTerminal && tty) {
        onDropToTerminal(tty, paths);
      }
    },
    [activeWorkspace, onReorderPanes, onDropToTerminal]
  );

  const handleEmptyDrop = useCallback(
    (e: React.DragEvent, targetPaneId: string | null, slotIndex: number) => {
      e.preventDefault();
      e.stopPropagation();

      const fromPaneId = e.dataTransfer.getData('application/x-tto-grid-pane') || currentDraggedPaneIdRef.current;
      currentDraggedPaneIdRef.current = null;
      setDraggedPaneId(null);
      setDragOverInfo(null);

      if (!fromPaneId || !activeWorkspace || !onReorderPanes) return;
      if (targetPaneId && fromPaneId === targetPaneId) return;

      const dest = targetPaneId || slotIndex;
      onReorderPanes(activeWorkspace.id, fromPaneId, dest, 'swap');
      setTimeout(() => {
        for (const [tid] of TerminalManager.handles) {
          TerminalManager.fitNow(tid);
          TerminalManager.refresh(tid);
        }
      }, 80);
    },
    [activeWorkspace, onReorderPanes]
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
      <GridNotch
        filledCount={filledCount}
        maxCount={MAX_GRID_TERMINALS}
        density={density}
        onSetDensity={handleSetDensity}
        layoutMode={currentLayoutMode}
        onSetLayoutMode={handleSetLayoutMode}
        onAddPane={onAddPane ? () => onAddPane() : undefined}
        cols={cols}
        rows={rows}
        paneExpanded={Boolean(expandedPane)}
        onRestoreExpanded={() => onExpandPane(null)}
      />

      <div
        ref={gridContainerRef}
        className={`ws-grid${expandedPane ? ' has-expanded' : ''}${activeWorkspace?.gridFocusMode ? ' focus-mode' : ''}${density === 'scrollable' ? ' grid-scroll-container' : ''}`}
        data-grid-mode={currentLayoutMode}
        style={gridStyle}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
      >
        {slotRows.map(
          ({ pane, status, label, cli, displayName, duration, entry, slotIndex, isFilled, isPadding }) => {
            if (!isFilled || !pane.tty) {
              const dropKey = isPadding ? `ghost-${slotIndex}` : pane.id;
              return (
                <EmptyGridSlot
                  key={isPadding ? `ghost-${slotIndex}` : pane.id}
                  slotIndex={slotIndex}
                  paneId={isPadding ? null : pane.id}
                  density={density}
                  isDragOver={dragOverInfo?.paneId === dropKey && draggedPaneId !== pane.id}
                  onDragOver={handleEmptyDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleEmptyDrop}
                  onAddPane={onAddPane}
                />
              );
            }

            const isExpanded = expandedPane === pane.id;
            const isSelected = selectedPane === pane.id;
            const isDraggingThis = draggedPaneId === pane.id;
            const isOverThis = dragOverInfo?.paneId === pane.id && !isDraggingThis;
            const dropPosition = isOverThis ? (dragOverInfo?.position || null) : null;
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
                tuiActive={tuiActive}
              />
            );
          }
        )}
      </div>
    </div>
  );
}
