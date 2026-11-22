'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { scrollbarStyle, buttonBase } from '@/lib/theme';
import type { UnifiedTerminal, TokenUsage } from '@/types';
import type { Workspace } from '@/lib/workspace';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import { isClosed, formatUptime } from '@/lib/format';
import {
  deriveTaskStatus,
  statusLabel,
  minTerminal,
  getTerminalWorkDuration,
} from '@/lib/status';
import {
  TerminalSquare,
  Terminal,
  Plus,
  X,
  Pencil,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
} from 'lucide-react';
import { DropChipStrip, type DropChip } from '@/components/DroppedFileChip';
import { extractDropPaths } from '@/terminal/dropPaths';
import { CliLogo } from '@/lib/cliLogos';
import { TerminalInput } from '@/terminal/TerminalInput';
import { TerminalManager } from '@/terminal/TerminalManager';
import { detectCLI } from '@/jarvis/adapters';
import { NotificationPopover } from '@/components/notifications/NotificationPopover';
import { useWorkspaceNotifications } from '@/hooks/useWorkspaceNotifications';
import { useChromeTabDrag } from './useChromeTabDrag';

interface Props {
  activeWorkspace?: Workspace;
  workspaces: Workspace[];
  terminals: Record<string, UnifiedTerminal>;
  tokenUsage?: TokenUsage | null;
  focusedTerminal: string | null;
  viewMode: 'focus' | 'split' | 'grid';
  gotoNonce: number;
  onSelectTerminal: (id: string | null) => void;
  onSetViewMode: (mode: 'focus' | 'split' | 'grid') => void;
  onSetGotoNonce: (n: number) => void;
  onToast: (msg: string, error?: boolean) => void;
  onSetProjectPath: (id: string, path: string) => void;
  onAddPane: () => void;
  onRemovePane: (paneId: string) => void;
  onDropToTerminal?: (sessionId: string, paths: string[]) => void;
  dropChips?: Record<string, DropChip[]>;
  onDismissChip?: (id: number) => void;
  onClearChips?: (sessionId: string) => void;
  onRenameTerminal?: (tty: string, currentLabel: string) => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onReorderPanes?: (
    workspaceId: string,
    fromPaneOrIndex: string | number,
    toPaneOrIndex: string | number,
    position: 'before' | 'after' | 'swap'
  ) => void;
}

export function WorkspaceView({
  activeWorkspace,
  workspaces,
  terminals,
  focusedTerminal,
  viewMode: _viewMode,
  onSelectWorkspace,
  onSelectTerminal,
  onAddPane,
  onRemovePane,
  onDropToTerminal,
  onToast,
  dropChips,
  onDismissChip,
  onClearChips,
  onRenameTerminal,
  onReorderPanes,
}: Props) {
  const { theme: t } = useTheme();
  const [tick, setTick] = useState(0);
  const [dragOverTerminal, setDragOverTerminal] = useState(false);

  // Per-terminal rename state
  const [editingTty, setEditingTty] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Which tab the pointer is over — reveals rename/close actions
  const [hoveredTty, setHoveredTty] = useState<string | null>(null);

  // Tab scrolling & quick switcher state
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [tabDropdownOpen, setTabDropdownOpen] = useState(false);
  const tabDropdownRef = useRef<HTMLDivElement>(null);

  // Poll status every 500ms so status dots stay current
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  // ── Unified Notifications across all workspaces ──
  const notificationsState = useWorkspaceNotifications({
    workspaces,
    terminals,
    activeWorkspaceId: activeWorkspace?.id,
    onToast,
    onNavigate: (wsId, tty) => {
      onSelectWorkspace?.(wsId);
      onSelectTerminal(tty);
    },
  });

  // Dynamic Terminal List with live process & buffer detection
  const terminalList = useMemo(() => {
    if (!activeWorkspace) return [];
    return activeWorkspace.panes
      .filter((p) => p.tty)
      .map((p, idx) => {
        const entry = terminals[p.tty!];
        const closed = isClosed(entry || minTerminal(p.tty!));
        const meta = TerminalManager.getTerminalMetadata(
          p.tty!,
          entry,
          closed,
          detectCLI,
          deriveTaskStatus,
          getTerminalWorkDuration,
          'shell'
        );

        // Format clean dynamic name: Priority is user rename (p.label), then read-only auto task name (meta.autoName), then detected CLI Name + Index, then clean session name
        const rawDefaultName =
          meta.cliName && meta.cli !== 'shell'
            ? `${meta.cliName} · ${idx + 1}`
            : entry?.session_name || entry?.pane_title || `Terminal ${idx + 1}`;
        const cleanDefaultName = rawDefaultName.replace(/^tto\s*[·•-]\s*/i, '');
        const label = p.label || meta.autoName || cleanDefaultName;

        return {
          paneId: p.id,
          tty: p.tty!,
          entry,
          status: meta.status,
          label,
          cli: meta.cli,
          cliName: meta.cliName,
          registeredAt: entry?.registered_at,
          index: idx,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, terminals, tick]);

  // Tab scroll overflow measurement
  const updateScrollButtons = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = tabsContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [updateScrollButtons, terminalList.length]);

  const scrollTabs = (dir: 'left' | 'right') => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const delta = dir === 'left' ? -200 : 200;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  // Close tab switcher dropdown on outside click or Escape
  useEffect(() => {
    if (!tabDropdownOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (tabDropdownRef.current && !tabDropdownRef.current.contains(e.target as Node)) {
        setTabDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [tabDropdownOpen]);

  const startRename = (tty: string, label: string) => {
    setEditingTty(tty);
    setRenameDraft(label);
  };

  const commitRename = (tty: string) => {
    const name = renameDraft.trim();
    if (name && onRenameTerminal) onRenameTerminal(tty, name);
    setEditingTty(null);
    setRenameDraft('');
  };

  // ── Chrome-Style Pointer Tab Drag & Drop Engine ──
  const {
    draggingState,
    isDragging,
    handleTabPointerDown,
    handleTabClick,
  } = useChromeTabDrag({
    tabs: terminalList,
    containerRef: tabsContainerRef,
    tabRefs,
    activeWorkspaceId: activeWorkspace?.id,
    isEditing: Boolean(editingTty),
    onSelectTab: onSelectTerminal,
    onReorderPanes,
  });

  // Auto-scroll active tab into view whenever focusedTerminal changes (unless dragging)
  useEffect(() => {
    if (!focusedTerminal || isDragging) return;
    const activeEl = tabRefs.current[focusedTerminal];
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [focusedTerminal, isDragging]);

  // ── Status-row data for the focused terminal ──
  const focusedActiveItem = terminalList.find((t) => t.tty === focusedTerminal);
  const focusedEntry = focusedTerminal ? terminals[focusedTerminal] : undefined;
  const focusedStatus = focusedActiveItem ? statusLabel(focusedActiveItem.status) : null;
  const focusedCli = focusedActiveItem?.cli || '';
  const focusedUptime = focusedEntry?.registered_at
    ? formatUptime(Math.max(0, Date.now() / 1000 - focusedEntry.registered_at))
    : '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Top Terminal Tab Strip ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          background: t.colors.bg.secondary,
          height: '34px',
          flexShrink: 0,
          userSelect: 'none',
          position: 'relative',
        }}
      >
        {/* Scroll Left Button (visible when scrolled right) */}
        {canScrollLeft && (
          <button
            onClick={() => scrollTabs('left')}
            aria-label="Scroll tabs left"
            style={{
              width: '20px',
              height: '100%',
              background: 'linear-gradient(90deg, rgba(18,18,22,0.95) 60%, rgba(18,18,22,0) 100%)',
              border: 'none',
              color: t.colors.text.muted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              zIndex: 5,
              flexShrink: 0,
            }}
          >
            <ChevronLeft size={13} />
          </button>
        )}

        {/* Scrollable Tabs Container */}
        <div
          ref={tabsContainerRef}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            overflowX: 'auto',
            ...scrollbarStyle(t, false),
            flex: 1,
            minWidth: 0,
            scrollBehavior: 'smooth',
          }}
        >
          {terminalList.map(({ paneId, tty, status, label, cli, index }) => {
            const { color } = statusLabel(status);
            const isEditing = editingTty === tty;
            const isActive = tty === focusedTerminal;
            const isHovered = hoveredTty === tty;
            const isShell = ['zsh', 'bash', 'sh'].includes(cli);
            const shortcutKey = index < 9 ? `⌘${index + 1}` : null;
            const isDraggingThis = draggingState?.draggedPaneId === paneId;
            const isSnapping = draggingState?.isSnapping ?? false;
            const shiftX = draggingState?.shiftOffsets[index] ?? 0;

            let tabTransform = 'translate3d(0, 0, 0)';
            let tabTransition = 'background 0.12s ease, opacity 0.15s ease';
            let tabZIndex = 1;
            let tabBoxShadow = 'none';

            if (isDraggingThis) {
              tabTransform = `translate3d(${draggingState.translateX}px, 0, 0)`;
              tabZIndex = 50;
              tabBoxShadow = `0 4px 14px rgba(0, 0, 0, 0.45), 0 0 0 1px ${t.colors.accent.primary}`;
              tabTransition = isSnapping
                ? 'transform 0.14s cubic-bezier(0.2, 0, 0, 1)'
                : 'none';
            } else if (shiftX !== 0) {
              tabTransform = `translate3d(${shiftX}px, 0, 0)`;
              tabTransition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1), background 0.12s ease';
            }

            return (
              <div
                key={tty}
                ref={(el) => {
                  tabRefs.current[tty] = el;
                }}
                onPointerDown={(e) => handleTabPointerDown(e, paneId, tty, index)}
                onClick={() => handleTabClick(tty)}
                onMouseEnter={() => !isDragging && setHoveredTty(tty)}
                onMouseLeave={() => !isDragging && setHoveredTty(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px 0 10px',
                  borderRight: `1px solid ${t.colors.border.subtle}`,
                  borderBottom: `2px solid ${isActive ? t.colors.accent.primary : 'transparent'}`,
                  background: isDraggingThis
                    ? t.colors.bg.elevated
                    : isActive
                    ? t.colors.bg.primary
                    : isHovered
                    ? t.colors.bg.hover
                    : 'transparent',
                  maxWidth: '200px',
                  minWidth: '95px',
                  height: '100%',
                  flexShrink: 0,
                  transform: tabTransform,
                  transition: tabTransition,
                  zIndex: tabZIndex,
                  boxShadow: tabBoxShadow,
                  cursor: isEditing ? 'default' : isDraggingThis ? 'grabbing' : 'default',
                  position: 'relative',
                  touchAction: 'none',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    color: isActive ? t.colors.text.primary : t.colors.text.secondary,
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    maxWidth: '150px',
                    overflow: 'hidden',
                    height: '100%',
                    flexShrink: 1,
                    pointerEvents: isDragging ? 'none' : 'auto',
                  }}
                  onDoubleClick={() => startRename(tty || paneId, label)}
                  title={`${label} — ${statusLabel(status).text}${shortcutKey ? ` · ${shortcutKey}` : ''} (double-click to rename)`}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: color,
                      boxShadow: status === 'asking' ? '0 0 6px #a855f7' : status === 'running' ? '0 0 5px #22c55e' : 'none',
                      flexShrink: 0,
                    }}
                  />
                  {shortcutKey && (
                    <span
                      style={{
                        fontSize: '9px',
                        color: isActive ? t.colors.accent.primary : t.colors.text.muted,
                        background: isActive ? `${t.colors.accent.primary}18` : t.colors.bg.elevated,
                        border: `1px solid ${isActive ? `${t.colors.accent.primary}35` : t.colors.border.subtle}`,
                        padding: '1px 4px',
                        borderRadius: '3px',
                        fontFamily: t.fontFamily.mono,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {shortcutKey}
                    </span>
                  )}
                  {cli && (isShell ? (
                    <Terminal size={11} style={{ opacity: 0.75, color: isActive ? t.colors.accent.primary : t.colors.text.muted, flexShrink: 0 }} />
                  ) : (
                    <CliLogo cli={cli} size={11} />
                  ))}
                  {isEditing ? (
                    <input
                      autoFocus
                      draggable={false}
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(tty || paneId)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(tty || paneId);
                        if (e.key === 'Escape') {
                          setEditingTty(null);
                          setRenameDraft('');
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: t.colors.text.primary,
                        fontSize: '11px',
                        width: '100%',
                        fontFamily: t.fontFamily.sans,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {label}
                    </span>
                  )}
                </div>

                {/* Hover-revealed actions: rename + close */}
                {!isEditing && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1px',
                      opacity: isHovered || isActive ? 1 : 0,
                      transition: 'opacity 0.15s ease',
                      flexShrink: 0,
                      marginLeft: '4px',
                      pointerEvents: isDragging ? 'none' : 'auto',
                    }}
                  >
                    <button
                      draggable={false}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        color: t.colors.text.muted,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(tty, label);
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = t.colors.bg.elevated;
                        e.currentTarget.style.color = t.colors.text.primary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = t.colors.text.muted;
                      }}
                      title="Rename terminal"
                    >
                      <Pencil size={10} />
                    </button>
                    {terminalList.length > 1 && (
                      <button
                        draggable={false}
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'transparent',
                          border: 'none',
                          color: t.colors.text.muted,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemovePane(paneId);
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                          e.currentTarget.style.color = '#f87171';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = t.colors.text.muted;
                        }}
                        title="Close terminal (⌘W)"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* New terminal tab button */}
          <button
            onClick={onAddPane}
            title="New terminal tab (⌘T)"
            style={{
              ...buttonBase(t),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              height: '24px',
              flexShrink: 0,
              margin: '5px 8px',
              padding: '0 8px',
              background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)',
              border: `1px solid ${t.colors.border.subtle}`,
              borderRadius: '5px',
              color: t.colors.text.secondary,
              cursor: 'pointer',
              fontSize: '10px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)',
              transition: 'all 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 100%)';
              e.currentTarget.style.borderColor = t.colors.border.primary;
              e.currentTarget.style.color = t.colors.text.primary;
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)';
              e.currentTarget.style.borderColor = t.colors.border.subtle;
              e.currentTarget.style.color = t.colors.text.secondary;
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Plus size={12} />
            <span
              style={{
                fontSize: '9px',
                fontWeight: 600,
                fontFamily: t.fontFamily.mono,
                background: t.colors.bg.elevated,
                padding: '1px 4px',
                borderRadius: '3px',
                border: `1px solid ${t.colors.border.subtle}`,
                color: t.colors.text.muted,
              }}
            >
              ⌘T
            </span>
          </button>
        </div>

        {/* Scroll Right Button (visible when overflow exists to the right) */}
        {canScrollRight && (
          <button
            onClick={() => scrollTabs('right')}
            aria-label="Scroll tabs right"
            style={{
              width: '20px',
              height: '100%',
              background: 'linear-gradient(270deg, rgba(18,18,22,0.95) 60%, rgba(18,18,22,0) 100%)',
              border: 'none',
              color: t.colors.text.muted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              zIndex: 5,
              flexShrink: 0,
            }}
          >
            <ChevronRight size={13} />
          </button>
        )}

        {/* ── Right-Side Controls: Active Pill, Quick Switcher, Notifications ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 10px',
            flexShrink: 0,
            borderLeft: `1px solid ${t.colors.border.subtle}`,
            position: 'relative',
          }}
        >
          {/* Quick Tab Switcher Button & Dropdown */}
          <div ref={tabDropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setTabDropdownOpen((prev) => !prev)}
              aria-label="Open tab switcher"
              aria-expanded={tabDropdownOpen}
              title="Click to jump to any terminal in this workspace"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '10px',
                padding: '2px 8px',
                borderRadius: '6px',
                background: tabDropdownOpen ? t.colors.bg.elevated : 'rgba(255, 255, 255, 0.04)',
                border: `1px solid ${tabDropdownOpen ? t.colors.accent.primary : t.colors.border.subtle}`,
                color: t.colors.text.secondary,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = t.colors.text.primary;
                e.currentTarget.style.borderColor = t.colors.border.primary;
              }}
              onMouseLeave={(e) => {
                if (!tabDropdownOpen) {
                  e.currentTarget.style.color = t.colors.text.secondary;
                  e.currentTarget.style.borderColor = t.colors.border.subtle;
                }
              }}
            >
              <span>
                {terminalList.length} {terminalList.length === 1 ? 'tab' : 'tabs'}
              </span>
              <ChevronDown size={11} style={{ opacity: 0.7 }} />
            </button>

            {/* Tab Switcher Dropdown */}
            {tabDropdownOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  width: '240px',
                  maxHeight: '320px',
                  background: 'rgba(22, 22, 26, 0.95)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: `1px solid ${t.colors.border.subtle}`,
                  borderRadius: '8px',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                  zIndex: 900,
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  overflowY: 'auto',
                }}
              >
                <div
                  style={{
                    padding: '5px 8px 4px',
                    fontSize: '9.5px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: t.colors.text.muted,
                  }}
                >
                  Workspace Terminals
                </div>
                {terminalList.map(({ tty, label, cli, status, index }) => {
                  const isActive = tty === focusedTerminal;
                  const { color } = statusLabel(status);
                  const isShell = ['zsh', 'bash', 'sh'].includes(cli);
                  const shortcut = index < 9 ? `⌘${index + 1}` : null;

                  return (
                    <button
                      key={tty}
                      role="menuitem"
                      onClick={() => {
                        onSelectTerminal(tty);
                        setTabDropdownOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        borderRadius: '5px',
                        background: isActive ? `${t.colors.accent.primary}22` : 'transparent',
                        border: `1px solid ${isActive ? `${t.colors.accent.primary}44` : 'transparent'}`,
                        color: isActive ? t.colors.text.primary : t.colors.text.secondary,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '11px',
                        width: '100%',
                        transition: 'background 0.1s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = t.colors.bg.elevated;
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        {cli && (isShell ? <Terminal size={11} style={{ opacity: 0.7 }} /> : <CliLogo cli={cli} size={11} />)}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        {shortcut && (
                          <span
                            style={{
                              fontSize: '9px',
                              fontFamily: t.fontFamily.mono,
                              color: t.colors.text.muted,
                              padding: '1px 3px',
                              borderRadius: '3px',
                              background: t.colors.bg.elevated,
                            }}
                          >
                            {shortcut}
                          </span>
                        )}
                        {isActive && <Check size={11} color={t.colors.accent.primary} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Fixed Notifications Bell & Popover ("Poplar") */}
          <NotificationPopover
            notifications={notificationsState.notifications}
            unreadCount={notificationsState.unreadCount}
            hasAsking={notificationsState.hasAsking}
            onClearAll={notificationsState.clearAll}
            onDismiss={notificationsState.dismissNotification}
            onNavigate={notificationsState.onNavigate}
          />
        </div>
      </div>

      {/* ── Main Terminal Body ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, minWidth: 0 }}>
        {focusedTerminal ? (
          <div
            className={`term-pane${dragOverTerminal ? ' drag-over' : ''}`}
            data-agent={focusedCli || undefined}
            data-tto-session={focusedTerminal}
            data-drop-target="terminal"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
              setDragOverTerminal(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverTerminal(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverTerminal(false);
              const paths = extractDropPaths(e.dataTransfer);
              if (paths.length > 0 && onDropToTerminal && focusedTerminal) {
                onDropToTerminal(focusedTerminal, paths);
              }
            }}
            style={{
              flex: 1,
              position: 'relative',
              background: t.colors.bg.primary,
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {dropChips && focusedTerminal && dropChips[focusedTerminal]?.length > 0 && (
              <div
                style={{
                  padding: '4px 10px',
                  background: t.colors.bg.secondary,
                  borderBottom: `1px solid ${t.colors.border.subtle}`,
                  zIndex: 20,
                }}
              >
                <DropChipStrip
                  chips={dropChips[focusedTerminal]}
                  onDismiss={(id) => onDismissChip?.(id)}
                  onClearAll={() => onClearChips?.(focusedTerminal)}
                />
              </div>
            )}
            <TerminalAnchor sessionId={focusedTerminal} />
            {focusedTerminal && (
              <div className="tw-input-bar">
                <TerminalInput sessionId={focusedTerminal} />
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: t.spacing.md,
              color: t.colors.text.muted,
            }}
          >
            <TerminalSquare size={48} strokeWidth={1} />
            <div style={{ fontSize: t.fontSize.md }}>No terminal selected</div>
            <div style={{ fontSize: t.fontSize.xs }}>Create a workspace or select a terminal</div>
          </div>
        )}
      </div>

      {/* ── Sleek Bottom Status Bar ── */}
      {focusedTerminal && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            height: '22px',
            padding: '0 10px',
            flexShrink: 0,
            background: t.colors.bg.secondary,
            borderTop: `1px solid ${t.colors.border.subtle}`,
            fontSize: '10px',
            color: t.colors.text.muted,
            userSelect: 'none',
          }}
        >
          {focusedStatus && (
            <>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: focusedStatus.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: t.colors.text.secondary,
                  fontWeight: 600,
                  letterSpacing: '0.3px',
                  textTransform: 'uppercase',
                }}
              >
                {focusedStatus.text}
              </span>
            </>
          )}
          {focusedCli && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontFamily: t.fontFamily.mono,
                color: t.colors.text.secondary,
              }}
            >
              {['zsh', 'bash', 'sh'].includes(focusedCli) ? (
                <Terminal size={10} style={{ opacity: 0.7 }} />
              ) : (
                <CliLogo cli={focusedCli} size={10} />
              )}
              {focusedActiveItem?.cliName || focusedCli}
            </span>
          )}
          {focusedUptime && (
            <span style={{ fontFamily: t.fontFamily.mono, opacity: 0.75 }}>
              up {focusedUptime}
            </span>
          )}
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              opacity: 0.65,
              fontFamily: t.fontFamily.mono,
              fontSize: '9.5px',
            }}
          >
            <span>{focusedTerminal}</span>
            <span>·</span>
            <span>Clear: ⌘K</span>
            <span>·</span>
            <span>New Tab: ⌘T</span>
            <span>·</span>
            <span>Close: ⌘W</span>
          </span>
        </div>
      )}
    </div>
  );
}
