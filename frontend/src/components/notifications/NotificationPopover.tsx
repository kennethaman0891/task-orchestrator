'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { statusLabel } from '@/lib/status';
import { CliLogo } from '@/lib/cliLogos';
import {
  Bell,
  CheckCheck,
  Volume2,
  VolumeX,
  X,
  ChevronRight,
  Terminal,
} from 'lucide-react';
import type { WorkspaceNotification } from '@/hooks/useWorkspaceNotifications';
import {
  isNotificationSoundEnabled,
  setNotificationSoundEnabled,
} from '@/lib/notificationSound';

interface Props {
  notifications: WorkspaceNotification[];
  unreadCount: number;
  hasAsking: boolean;
  onClearAll: () => void;
  onDismiss: (id: string) => void;
  onNavigate: (workspaceId: string, tty: string) => void;
}

export function NotificationPopover({
  notifications,
  unreadCount,
  hasAsking,
  onClearAll,
  onDismiss,
  onNavigate,
}: Props) {
  const { theme: t } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'asking' | 'stopped'>('all');
  const [soundEnabled, setSoundEnabled] = useState(() => isNotificationSoundEnabled());

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Toggle audio
  const handleToggleSound = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !soundEnabled;
    setSoundEnabled(next);
    setNotificationSoundEnabled(next);
  }, [soundEnabled]);

  // Click-outside and Escape key dismissal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isOpen]);

  const filtered = notifications.filter((n) => {
    if (filter === 'asking') return n.status === 'asking';
    if (filter === 'stopped') return n.status === 'stopped' || n.status === 'over';
    return true;
  });

  const askingCount = notifications.filter((n) => n.status === 'asking').length;
  const stoppedCount = notifications.filter((n) => n.status === 'stopped' || n.status === 'over').length;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {/* ── Fixed Notification Bell Button ── */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Terminal notifications"
        aria-expanded={isOpen}
        title={
          unreadCount > 0
            ? `${unreadCount} terminal notification${unreadCount === 1 ? '' : 's'}${hasAsking ? ' (action required)' : ''}`
            : 'No terminal notifications'
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          width: '26px',
          height: '24px',
          padding: 0,
          background: isOpen
            ? t.colors.bg.elevated
            : unreadCount > 0
            ? `${t.colors.bg.elevated}cc`
            : 'transparent',
          border: `1px solid ${
            isOpen
              ? t.colors.accent.primary
              : unreadCount > 0
              ? hasAsking
                ? 'rgba(168, 85, 247, 0.4)'
                : t.colors.border.subtle
              : 'transparent'
          }`,
          borderRadius: '5px',
          color: hasAsking
            ? '#a855f7'
            : unreadCount > 0
            ? t.colors.text.primary
            : t.colors.text.muted,
          cursor: 'pointer',
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = t.colors.bg.elevated;
          e.currentTarget.style.color = hasAsking ? '#c084fc' : t.colors.text.primary;
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = unreadCount > 0 ? `${t.colors.bg.elevated}cc` : 'transparent';
            e.currentTarget.style.color = hasAsking
              ? '#a855f7'
              : unreadCount > 0
              ? t.colors.text.primary
              : t.colors.text.muted;
          }
        }}
      >
        <Bell size={13} strokeWidth={hasAsking ? 2.2 : 1.8} />

        {/* Badge counter */}
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-3px',
              right: '-3px',
              minWidth: '14px',
              height: '14px',
              borderRadius: '7px',
              background: hasAsking ? '#a855f7' : t.colors.accent.primary,
              color: '#ffffff',
              fontSize: '8.5px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              boxShadow: hasAsking
                ? '0 0 8px rgba(168, 85, 247, 0.8)'
                : '0 1px 3px rgba(0,0,0,0.4)',
              lineHeight: 1,
              fontFamily: t.fontFamily.mono,
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Glassmorphic Popover ("Poplar") ── */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Terminal Notifications"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: '360px',
            maxHeight: '460px',
            background: 'rgba(18, 18, 22, 0.94)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: `1px solid ${t.colors.border.subtle}`,
            borderRadius: '10px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55), 0 0 1px rgba(255, 255, 255, 0.1) inset',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: t.fontFamily.sans,
            animation: 'notifPoplarFadeIn 0.16s ease-out',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: `1px solid ${t.colors.border.subtle}`,
              background: 'rgba(255, 255, 255, 0.02)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '5px',
                  background: hasAsking ? 'rgba(168, 85, 247, 0.18)' : `${t.colors.accent.primary}18`,
                  color: hasAsking ? '#c084fc' : t.colors.accent.primary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Bell size={11} />
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: t.colors.text.primary }}>
                Terminal Notifications
              </span>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '8px',
                    background: hasAsking ? 'rgba(168, 85, 247, 0.25)' : t.colors.bg.elevated,
                    color: hasAsking ? '#c084fc' : t.colors.text.muted,
                    fontWeight: 600,
                    fontFamily: t.fontFamily.mono,
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* Sound toggle button */}
              <button
                onClick={handleToggleSound}
                title={soundEnabled ? 'Mute notification sound' : 'Enable notification sound'}
                aria-label={soundEnabled ? 'Mute notification sound' : 'Enable notification sound'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: soundEnabled ? t.colors.text.secondary : t.colors.text.muted,
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: soundEnabled ? 0.9 : 0.5,
                }}
              >
                {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
              </button>

              {/* Clear all */}
              {notifications.length > 0 && (
                <button
                  onClick={onClearAll}
                  title="Clear all notifications"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: t.colors.text.muted,
                    cursor: 'pointer',
                    fontSize: '10px',
                    padding: '3px 6px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = t.colors.text.primary;
                    e.currentTarget.style.background = t.colors.bg.elevated;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = t.colors.text.muted;
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <CheckCheck size={11} />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter Chips */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 12px',
              borderBottom: `1px solid ${t.colors.border.subtle}`,
              background: 'rgba(0,0,0,0.15)',
            }}
          >
            {(
              [
                { id: 'all', label: 'All', count: notifications.length },
                { id: 'asking', label: 'Asking', count: askingCount },
                { id: 'stopped', label: 'Stopped', count: stoppedCount },
              ] as const
            ).map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilter(tab.id)}
                  style={{
                    background: active ? t.colors.bg.elevated : 'transparent',
                    border: `1px solid ${active ? t.colors.border.subtle : 'transparent'}`,
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '10.5px',
                    color: active ? t.colors.text.primary : t.colors.text.muted,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.12s ease',
                  }}
                >
                  <span>{tab.label}</span>
                  <span
                    style={{
                      fontSize: '9.5px',
                      opacity: active ? 0.9 : 0.6,
                      fontFamily: t.fontFamily.mono,
                    }}
                  >
                    ({tab.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Notifications List */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: '340px',
              padding: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                  color: t.colors.text.muted,
                  fontSize: '11px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Terminal size={22} strokeWidth={1.5} style={{ opacity: 0.4 }} />
                <span>No active alerts in this view.</span>
                <span style={{ fontSize: '10px', opacity: 0.7 }}>
                  All workspace terminals are active or idle.
                </span>
              </div>
            ) : (
              filtered.map((item) => {
                const isAsking = item.status === 'asking';
                const statusMeta = statusLabel(item.status);
                const isShell = ['zsh', 'bash', 'sh'].includes(item.cli);

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.workspaceId, item.tty);
                      setIsOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: isAsking
                        ? 'rgba(168, 85, 247, 0.08)'
                        : 'rgba(255, 255, 255, 0.02)',
                      border: `1px solid ${
                        isAsking ? 'rgba(168, 85, 247, 0.25)' : t.colors.border.subtle
                      }`,
                      cursor: 'pointer',
                      transition: 'all 0.14s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = isAsking
                        ? 'rgba(168, 85, 247, 0.14)'
                        : t.colors.bg.elevated;
                      e.currentTarget.style.borderColor = isAsking
                        ? 'rgba(168, 85, 247, 0.45)'
                        : t.colors.border.primary;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isAsking
                        ? 'rgba(168, 85, 247, 0.08)'
                        : 'rgba(255, 255, 255, 0.02)';
                      e.currentTarget.style.borderColor = isAsking
                        ? 'rgba(168, 85, 247, 0.25)'
                        : t.colors.border.subtle;
                    }}
                  >
                    {/* Top Row: Workspace Badge + Terminal Name + Status */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        {/* Workspace Pill */}
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: 'rgba(255, 255, 255, 0.06)',
                            fontSize: '9.5px',
                            fontWeight: 600,
                            color: t.colors.text.secondary,
                            maxWidth: '120px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: '50%',
                              background: item.workspaceColor,
                              flexShrink: 0,
                            }}
                          />
                          {item.workspaceName}
                        </span>

                        {/* Terminal logo + name */}
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: t.colors.text.primary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isShell ? (
                            <Terminal size={11} style={{ opacity: 0.7 }} />
                          ) : (
                            <CliLogo cli={item.cli} size={11} />
                          )}
                          <span>{item.terminalName}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        {/* Status Badge */}
                        <span
                          style={{
                            fontSize: '9px',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            fontWeight: 700,
                            fontFamily: t.fontFamily.mono,
                            letterSpacing: '0.3px',
                            background: `${statusMeta.color}22`,
                            color: statusMeta.color,
                            border: `1px solid ${statusMeta.color}44`,
                          }}
                        >
                          {statusMeta.text}
                        </span>

                        {/* Dismiss (✕) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismiss(item.id);
                          }}
                          title="Dismiss notification"
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '3px',
                            background: 'transparent',
                            border: 'none',
                            color: t.colors.text.muted,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = t.colors.text.primary;
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = t.colors.text.muted;
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    </div>

                    {/* Buffer snippet / question card */}
                    <div
                      style={{
                        padding: '4px 6px',
                        borderRadius: '4px',
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid rgba(255, 255, 255, 0.04)',
                        fontSize: '10px',
                        fontFamily: t.fontFamily.mono,
                        color: isAsking ? '#e9d5ff' : t.colors.text.secondary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={item.snippet}
                    >
                      {item.snippet}
                    </div>

                    {/* Bottom Action Row */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '9.5px',
                        color: t.colors.text.muted,
                        marginTop: '2px',
                      }}
                    >
                      <span>
                        {item.duration?.durationStr ? `Waiting ${item.duration.durationStr}` : ''}
                      </span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                          color: isAsking ? '#c084fc' : t.colors.accent.primary,
                          fontWeight: 600,
                        }}
                      >
                        <span>Jump to workspace</span>
                        <ChevronRight size={10} />
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
