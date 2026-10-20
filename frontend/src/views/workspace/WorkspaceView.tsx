'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { scrollbarStyle, buttonBase } from '@/lib/theme';
import type { UnifiedTerminal, TokenUsage } from '@/types';
import type { Workspace } from '@/lib/workspace';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import { isClosed, termName, formatUptime } from '@/lib/format';
import { deriveTaskStatus, statusLabel, minTerminal } from '@/lib/status';
import { TerminalSquare, Terminal, Plus, X, Pencil, MessageSquare } from 'lucide-react';
import { DropChipStrip, type DropChip } from '@/components/DroppedFileChip';
import { extractDropPaths } from '@/terminal/dropPaths';
import { CliLogo } from '@/lib/cliLogos';
import { AgentChatPanel, isAgentCli } from '@/components/terminal/AgentChatPanel';
import { TerminalInput } from '@/terminal/TerminalInput';

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
  activeWorkspace,
  terminals,
  focusedTerminal,
  viewMode: _viewMode,
  onSelectTerminal,
  onAddPane,
  onRemovePane,
  onDropToTerminal,
  dropChips,
  onDismissChip,
  onClearChips,
  onRenameTerminal,
}: Props) {
  const { theme: t } = useTheme();
  const [tick, setTick] = useState(0);
  const [dragOverTerminal, setDragOverTerminal] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Per-terminal rename state
  const [editingTty, setEditingTty] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Which tab the pointer is over — reveals rename/close actions
  const [hoveredTty, setHoveredTty] = useState<string | null>(null);

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
        return {
          paneId: p.id,
          tty: p.tty!,
          entry,
          status,
          paneLabel: p.label,
          registeredAt: entry?.registered_at,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, terminals, tick]);

  const displayLabel = (entry: UnifiedTerminal | undefined, paneLabel?: string): string => {
    if (paneLabel) return paneLabel;
    return termName(entry || ({ tty: '', agent: '', cli: '', session_name: '' } as any));
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

  const agentDetected = focusedEntry ? isAgentCli(focusedEntry) : false;

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
        }}
      >
        {/* Scrollable Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            overflowX: 'auto',
            ...scrollbarStyle(t, false),
            flex: 1,
            minWidth: 0,
          }}
        >
          {terminalList.map(({ paneId, tty, entry, status, paneLabel }, idx) => {
            const { color } = statusLabel(status);
            const label = displayLabel(entry, paneLabel);
            const isEditing = editingTty === tty;
            const isActive = tty === focusedTerminal;
            const isHovered = hoveredTty === tty;
            const cliVal = (entry?.cli || '').toLowerCase().trim();
            const shortcutKey = idx < 9 ? `⌘${idx + 1}` : null;
            return (
              <div
                key={tty}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px 0 10px',
                  borderRight: `1px solid ${t.colors.border.subtle}`,
                  borderBottom: `2px solid ${isActive ? t.colors.accent.primary : 'transparent'}`,
                  background: isActive ? t.colors.bg.primary : isHovered ? t.colors.bg.hover : 'transparent',
                  maxWidth: '190px',
                  height: '100%',
                  flexShrink: 0,
                  transition: 'background 0.12s ease',
                  cursor: 'pointer',
                }}
                onClick={() => onSelectTerminal(tty)}
                onMouseEnter={() => setHoveredTty(tty)}
                onMouseLeave={() => setHoveredTty(null)}
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
                    maxWidth: '145px',
                    overflow: 'hidden',
                    height: '100%',
                    flexShrink: 1,
                  }}
                  onDoubleClick={() => startRename(tty || paneId, label)}
                  title={`${label} — ${statusLabel(status).text}${shortcutKey ? ` · ${shortcutKey}` : ''} (double-click to rename)`}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
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
                  {cliVal && (['zsh', 'bash', 'sh'].includes(cliVal) ? (
                    <Terminal size={11} style={{ opacity: 0.75, color: isActive ? t.colors.accent.primary : t.colors.text.muted, flexShrink: 0 }} />
                  ) : (
                    <CliLogo cli={cliVal} size={11} />
                  ))}
                  {isEditing ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(tty || paneId)}
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
                    }}
                  >
                    <button
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
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.96)';
            }}
            onMouseUp={(e) => {
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

        {/* Right-side tab bar controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 10px',
            flexShrink: 0,
            borderLeft: `1px solid ${t.colors.border.subtle}`,
          }}
        >
          {agentDetected && (
            <button
              onClick={() => setChatOpen((prev) => !prev)}
              title={chatOpen ? 'Hide Agent Chat' : 'Open Live Agent Chat'}
              style={{
                ...buttonBase(t),
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                height: '24px',
                padding: '0 8px',
                borderRadius: '5px',
                background: chatOpen
                  ? 'linear-gradient(180deg, rgba(56, 189, 248, 0.22) 0%, rgba(56, 189, 248, 0.12) 100%)'
                  : 'linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)',
                border: `1px solid ${chatOpen ? 'rgba(56, 189, 248, 0.4)' : t.colors.border.subtle}`,
                color: chatOpen ? '#38bdf8' : t.colors.text.secondary,
                cursor: 'pointer',
                fontSize: '10.5px',
                fontWeight: 600,
                boxShadow: chatOpen ? '0 0 8px rgba(56, 189, 248, 0.25)' : 'none',
                transition: 'all 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                if (!chatOpen) {
                  e.currentTarget.style.color = t.colors.text.primary;
                  e.currentTarget.style.borderColor = t.colors.border.primary;
                }
              }}
              onMouseLeave={(e) => {
                if (!chatOpen) {
                  e.currentTarget.style.color = t.colors.text.secondary;
                  e.currentTarget.style.borderColor = t.colors.border.subtle;
                }
              }}
            >
              <MessageSquare size={12} />
              <span>Agent Chat</span>
            </button>
          )}

          {focusedTerminal && (
            <span
              style={{
                fontSize: '10px',
                padding: '2px 8px',
                borderRadius: '10px',
                background: t.colors.bg.elevated,
                border: `1px solid ${t.colors.border.subtle}`,
                color: t.colors.text.muted,
                fontWeight: 600,
              }}
            >
              {terminalList.length} {terminalList.length === 1 ? 'tab' : 'tabs'}
            </span>
          )}
        </div>
      </div>

      {/* ── Main Terminal Body (Terminal + Optional Agent Chat side-by-side) ── */}
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

        {/* Side-by-side Agent Chat Panel */}
        {agentDetected && chatOpen && focusedTerminal && focusedEntry && (
          <AgentChatPanel
            sessionId={focusedTerminal}
            entry={focusedEntry}
            onClose={() => setChatOpen(false)}
            width={340}
          />
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
              <CliLogo cli={focusedCli} size={10} />
              {focusedCli}
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
