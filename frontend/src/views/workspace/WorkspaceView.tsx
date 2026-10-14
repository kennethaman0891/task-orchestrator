'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { scrollbarStyle, buttonBase } from '@/lib/theme';
import type { UnifiedTerminal, TokenUsage } from '@/types';
import type { Workspace } from '@/lib/workspace';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import { isClosed, termName, formatUptime } from '@/lib/format';
import { deriveTaskStatus, statusLabel, minTerminal } from '@/lib/status';
import { TerminalSquare, Plus, X, Pencil, MessageSquare } from 'lucide-react';
import { DropChipStrip, type DropChip } from '@/components/DroppedFileChip';
import { AgentChatPanel, isAgentCli } from '@/components/terminal/AgentChatPanel';
import { CardComposer } from '@/components/terminal/CardComposer';
import { TerminalManager } from '@/terminal/TerminalManager';
import { extractDropPaths } from '@/terminal/dropPaths';
import { CliLogo } from '@/lib/cliLogos';

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
}

export function WorkspaceView({
  activeWorkspace, terminals, focusedTerminal, viewMode,
  onSelectTerminal,
  onAddPane, onRemovePane,
  onDropToTerminal,
  dropChips,
  onDismissChip,
  onClearChips,
  onRenameTerminal,
}: Props) {
  const { theme: t } = useTheme();
  const [tick, setTick] = useState(0);
  const [dragOverTerminal, setDragOverTerminal] = useState(false);
  // Per-terminal rename state
  const [editingTty, setEditingTty] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Which tab the pointer is over — reveals rename/close actions
  const [hoveredTty, setHoveredTty] = useState<string | null>(null);
  // Agent chat panel (sits alongside the terminal when an agent CLI is open)
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('tto-chat-open') === '1'; } catch { return false; }
  });
  const toggleChat = () => {
    setChatOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem('tto-chat-open', next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  };

  // Poll status every 500ms so status dots stay current
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const terminalList = useMemo(() => {
    if (!activeWorkspace) return [];
    return activeWorkspace.panes
      .filter((p) => p.tty)
      .map((p) => {
        const entry = terminals[p.tty!];
        const closed = isClosed(entry || minTerminal(p.tty!));
        const status = deriveTaskStatus(p.tty!, entry, closed);
        return { paneId: p.id, tty: p.tty!, entry, status, paneLabel: p.label, registeredAt: entry?.registered_at };
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, terminals, tick]);

  const displayLabel = (entry: UnifiedTerminal | undefined, paneLabel?: string): string => {
    if (paneLabel) return paneLabel;
    return termName(entry || { tty: '', agent: '', cli: '', session_name: '' } as any);
  };

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

  // ── Status-row data for the focused terminal ──
  const focusedEntry = focusedTerminal ? terminals[focusedTerminal] : undefined;
  const focusedStatus = focusedTerminal
    ? statusLabel(deriveTaskStatus(focusedTerminal, focusedEntry, isClosed(focusedEntry || minTerminal(focusedTerminal))))
    : null;
  const focusedCli = (focusedEntry?.cli || '').toLowerCase().trim();
  const focusedUptime = focusedEntry?.registered_at
    ? formatUptime(Math.max(0, Date.now() / 1000 - focusedEntry.registered_at))
    : '';
  const agentDetected = isAgentCli(
    focusedEntry,
    focusedTerminal ? TerminalManager.lastLines(focusedTerminal, 25) : undefined
  );
  const focusedPane = terminalList.find((x) => x.tty === focusedTerminal);
  const focusedLabel = focusedTerminal
    ? displayLabel(focusedEntry, focusedPane?.paneLabel)
    : '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Terminal card header: live label + agent chat toggle + New terminal (+) ── */}
      {focusedTerminal && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          height: '28px', padding: '0 10px', flexShrink: 0,
          background: t.colors.bg.tertiary,
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          fontSize: '11px',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: focusedStatus ? focusedStatus.color : t.colors.text.muted,
          }} />
          {focusedCli && <CliLogo cli={focusedCli} size={12} />}
          <span style={{
            fontWeight: 600, color: t.colors.text.primary,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }} title={focusedLabel}>
            {focusedLabel || focusedTerminal}
          </span>
          {focusedUptime && (
            <span style={{ fontFamily: t.fontFamily.mono, color: t.colors.text.muted, opacity: 0.7, flexShrink: 0 }}>
              {focusedUptime} up
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {agentDetected && (
              <button
                onClick={toggleChat}
                title={chatOpen ? 'Hide agent chat panel' : 'Show agent chat panel'}
                style={{
                  width: '22px', height: '22px', borderRadius: '4px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: chatOpen ? t.colors.bg.elevated : 'transparent',
                  border: `1px solid ${chatOpen ? t.colors.accent.primary : 'transparent'}`,
                  color: chatOpen ? t.colors.accent.primary : t.colors.text.muted,
                  cursor: 'pointer', padding: 0,
                }}
                onMouseEnter={(e) => { if (!chatOpen) { e.currentTarget.style.color = t.colors.text.primary; } }}
                onMouseLeave={(e) => { if (!chatOpen) { e.currentTarget.style.color = t.colors.text.muted; } }}
              >
                <MessageSquare size={12} />
              </button>
            )}
            <button
              onClick={onAddPane}
              title="New terminal"
              style={{
                width: '22px', height: '22px', borderRadius: '4px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none',
                color: t.colors.text.muted, cursor: 'pointer', padding: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.elevated; e.currentTarget.style.color = t.colors.accent.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.colors.text.muted; }}
            >
              <Plus size={12} />
            </button>
          </span>
        </div>
      )}

      {/* ── Terminal area + agent chat panel, side by side ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, minWidth: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      {/* ── Terminal area ── */}
      {focusedTerminal ? (
        <div
          className={`term-pane${dragOverTerminal ? ' drag-over' : ''}`}
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
            flex: 1, position: 'relative', background: t.colors.bg.primary,
            minHeight: 0, minWidth: 0,
            display: 'flex', flexDirection: 'column',
          }}
        >
          {dropChips && focusedTerminal && dropChips[focusedTerminal]?.length > 0 && (
            <div style={{
              padding: '4px 10px',
              background: t.colors.bg.secondary,
              borderBottom: `1px solid ${t.colors.border.subtle}`,
              zIndex: 20,
            }}>
              <DropChipStrip
                chips={dropChips[focusedTerminal]}
                onDismiss={(id) => onDismissChip?.(id)}
                onClearAll={() => onClearChips?.(focusedTerminal)}
              />
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <TerminalAnchor sessionId={focusedTerminal} />
          </div>
          <CardComposer
            sessionId={focusedTerminal}
            displayName={focusedLabel}
            cli={focusedCli}
            isCompact={false}
            isUltraCompact={false}
          />
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: t.spacing.md, color: t.colors.text.muted,
        }}>
          <TerminalSquare size={48} strokeWidth={1} />
          <div style={{ fontSize: t.fontSize.md }}>No terminal selected</div>
          <div style={{ fontSize: t.fontSize.xs }}>Create a workspace or select a terminal</div>
        </div>
      )}

      {/* ── Status row: live task state of the focused terminal ── */}
      {focusedTerminal && focusedStatus && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          height: '24px', padding: '0 10px', flexShrink: 0,
          background: t.colors.bg.tertiary,
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          fontSize: t.fontSize.xxs,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: focusedStatus.color, flexShrink: 0 }} />
          <span style={{
            color: t.colors.text.secondary, fontWeight: 600,
            letterSpacing: '0.3px', textTransform: 'uppercase',
          }}>
            {focusedStatus.text}
          </span>
          {focusedCli && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              fontFamily: t.fontFamily.mono, color: t.colors.text.muted,
            }}>
              <CliLogo cli={focusedCli} size={10} />
              {focusedCli}
            </span>
          )}
          {focusedUptime && (
            <span style={{ fontFamily: t.fontFamily.mono, color: t.colors.text.muted, opacity: 0.7 }}>
              {focusedUptime} up
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: t.colors.text.muted, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {viewMode}
            </span>
            <span style={{
              fontSize: '9.5px', padding: '1px 6px', borderRadius: '8px',
              background: t.colors.bg.elevated, border: `1px solid ${t.colors.border.subtle}`,
              color: t.colors.text.muted, fontWeight: '600',
            }}>
              {terminalList.length} {terminalList.length === 1 ? 'terminal' : 'terminals'}
            </span>
          </span>
        </div>
      )}

      </div>
      {/* ── Agent chat panel alongside the terminal ── */}
      {agentDetected && chatOpen && focusedTerminal && focusedEntry && (
        <AgentChatPanel
          sessionId={focusedTerminal}
          entry={focusedEntry}
          onClose={toggleChat}
        />
      )}
      </div>

      {/* ── Terminal tab strip ── */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        borderTop: `1px solid ${t.colors.border.subtle}`,
        background: t.colors.bg.tertiary,
        overflowX: 'auto', ...scrollbarStyle(t, false),
        height: '32px', flexShrink: 0,
      }}>
        {terminalList.map(({ paneId, tty, entry, status, paneLabel, registeredAt }) => {
          const { color } = statusLabel(status);
          const label = displayLabel(entry, paneLabel);
          const isEditing = editingTty === tty;
          const isActive = tty === focusedTerminal;
          const isHovered = hoveredTty === tty;
          const cliVal = (entry?.cli || '').toLowerCase().trim();
          const uptime = formatUptime(registeredAt ? Math.max(0, Date.now() / 1000 - registeredAt) : 0);
          return (
            <div
              key={tty}
              style={{
                display: 'flex', alignItems: 'center',
                padding: '0 6px 0 10px',
                borderRight: `1px solid ${t.colors.border.subtle}`,
                borderBottom: `2px solid ${isActive ? t.colors.accent.primary : 'transparent'}`,
                background: isActive ? t.colors.bg.hover : 'transparent',
                maxWidth: '180px', height: '100%', flexShrink: 0,
                transition: 'background 0.12s ease',
              }}
              onMouseEnter={() => setHoveredTty(tty)}
              onMouseLeave={() => setHoveredTty(null)}
            >
              <button
                style={{
                  ...buttonBase(t), display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'transparent', border: 'none', borderRadius: 0,
                  padding: 0,
                  color: isActive ? t.colors.text.primary : t.colors.text.secondary,
                  fontSize: '11px', whiteSpace: 'nowrap', minWidth: 0,
                  maxWidth: '140px', overflow: 'hidden',
                  height: '100%', cursor: 'pointer', flexShrink: 1,
                }}
                onClick={() => onSelectTerminal(tty)}
                onDoubleClick={() => startRename(tty || paneId, label)}
                title={`${label} — ${statusLabel(status).text} (double-click to rename)`}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                {cliVal && <CliLogo cli={cliVal} size={10} />}
                {cliVal && (
                  <span style={{
                    fontSize: '8.5px', color: t.colors.text.muted,
                    textTransform: 'uppercase', letterSpacing: '0.3px',
                    flexShrink: 0, fontFamily: t.fontFamily.mono,
                  }}>
                    {cliVal}
                  </span>
                )}
                {uptime && (
                  <span style={{
                    fontSize: '8px', color: t.colors.text.secondary,
                    flexShrink: 0, fontFamily: t.fontFamily.mono, opacity: 0.7,
                  }}>
                    {uptime}
                  </span>
                )}
                {isEditing ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(tty || paneId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(tty || paneId);
                      if (e.key === 'Escape') { setEditingTty(null); setRenameDraft(''); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: 'transparent', border: 'none', outline: 'none',
                      color: t.colors.text.primary, fontSize: '11px',
                      width: '100%', fontFamily: t.fontFamily.sans,
                    }}
                  />
                ) : (
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    fontWeight: isActive ? 500 : 400,
                  }}>
                    {label}
                  </span>
                )}
              </button>
              {/* Hover-revealed actions: rename + close */}
              {!isEditing && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '1px',
                  opacity: isHovered || isActive ? 1 : 0,
                  transition: 'opacity 0.15s ease',
                  flexShrink: 0, marginLeft: '2px',
                }}>
                  <button
                    style={{
                      width: '18px', height: '18px', borderRadius: '4px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'transparent', border: 'none',
                      color: t.colors.text.muted, cursor: 'pointer', padding: 0,
                    }}
                    onClick={(e) => { e.stopPropagation(); startRename(tty, label); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.elevated; e.currentTarget.style.color = t.colors.text.primary; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.colors.text.muted; }}
                    title="Rename terminal"
                  >
                    <Pencil size={10} />
                  </button>
                  {terminalList.length > 1 && (
                    <button
                      style={{
                        width: '18px', height: '18px', borderRadius: '4px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: 'none',
                        color: t.colors.text.muted, cursor: 'pointer', padding: 0,
                      }}
                      onClick={(e) => { e.stopPropagation(); onRemovePane(paneId); }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; e.currentTarget.style.color = '#f87171'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.colors.text.muted; }}
                      title="Close terminal"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button
          onClick={onAddPane}
          title="Add terminal"
          style={{
            ...buttonBase(t),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '28px', height: '100%', flexShrink: 0, margin: '0 8px',
            background: 'transparent', border: 'none', borderRadius: '4px',
            color: t.colors.text.muted, cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bg.elevated; e.currentTarget.style.color = t.colors.accent.primary; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.colors.text.muted; }}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
