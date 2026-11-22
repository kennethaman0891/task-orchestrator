'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Workspace } from '@/lib/workspace';
import type { UnifiedTerminal } from '@/types';
import { TerminalManager } from '@/terminal/TerminalManager';
import { detectCLI } from '@/jarvis/adapters';
import {
  deriveTaskStatus,
  minTerminal,
  getTerminalWorkDuration,
  type TermStatus,
} from '@/lib/status';
import { isClosed } from '@/lib/format';
import { playNotificationSound } from '@/lib/notificationSound';

export interface WorkspaceNotification {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceColor: string;
  paneId: string;
  tty: string;
  terminalName: string;
  cli: string;
  status: TermStatus;
  snippet: string;
  timestamp: number;
  duration?: ReturnType<typeof getTerminalWorkDuration>;
}

interface UseWorkspaceNotificationsProps {
  workspaces: Workspace[];
  terminals: Record<string, UnifiedTerminal>;
  activeWorkspaceId?: string;
  onToast?: (msg: string, error?: boolean) => void;
  onNavigate?: (workspaceId: string, tty: string) => void;
}

export function useWorkspaceNotifications({
  workspaces,
  terminals,
  activeWorkspaceId,
  onToast,
  onNavigate,
}: UseWorkspaceNotificationsProps) {
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Track previous status per terminal to detect edge transitions
  // Key: tty, Value: TermStatus
  const prevStatusRef = useRef<Map<string, TermStatus>>(new Map());
  // Track notifications that have already triggered an audio/toast alert in their current cycle
  const alertedSetRef = useRef<Set<string>>(new Set());

  const scan = useCallback(() => {
    const nextList: WorkspaceNotification[] = [];
    const currentAlertKeys = new Set<string>();

    for (const ws of workspaces) {
      const panes = ws.panes || [];
      panes.forEach((p, idx) => {
        if (!p.tty) return;
        const entry = terminals[p.tty];
        const closed = isClosed(entry || minTerminal(p.tty));
        const meta = TerminalManager.getTerminalMetadata(
          p.tty,
          entry,
          closed,
          detectCLI,
          deriveTaskStatus,
          getTerminalWorkDuration,
          'shell'
        );

        const status = meta.status;
        const prevStatus = prevStatusRef.current.get(p.tty);

        // Format clean display name
        const rawName =
          meta.cliName && meta.cli !== 'shell'
            ? `${meta.cliName} · ${idx + 1}`
            : entry?.session_name || entry?.pane_title || `Terminal ${idx + 1}`;
        const cleanName = rawName.replace(/^tto\s*[·•-]\s*/i, '');
        const terminalName = p.label || meta.autoName || cleanName;

        // Extract last non-blank line from buffer for preview snippet
        const lines = TerminalManager.lastLines(p.tty, 15);
        const nonBlank = lines.map((l) => l.trim()).filter(Boolean);
        const snippet = nonBlank[nonBlank.length - 1] || 'Agent is waiting for response';

        const notifId = `${ws.id}-${p.tty}`;
        const alertCycleKey = `${ws.id}-${p.tty}-${status}-${snippet.slice(0, 40)}`;
        currentAlertKeys.add(alertCycleKey);

        // State Transition Alerts:
        // When transitioning to 'asking': play harmonic chime and display toast
        if (status === 'asking') {
          if (!alertedSetRef.current.has(alertCycleKey)) {
            alertedSetRef.current.add(alertCycleKey);
            playNotificationSound('asking');
            if (onToast) {
              const prefix = ws.id !== activeWorkspaceId ? `[${ws.name}] ` : '';
              onToast(`${prefix}${terminalName} is asking: "${snippet.slice(0, 75)}"`);
            }
          }
        } else if (status === 'stopped' || status === 'over') {
          if (prevStatus === 'running' && !alertedSetRef.current.has(alertCycleKey)) {
            alertedSetRef.current.add(alertCycleKey);
            playNotificationSound('stopped');
            if (onToast && status === 'stopped') {
              const prefix = ws.id !== activeWorkspaceId ? `[${ws.name}] ` : '';
              onToast(`${prefix}${terminalName} stopped running.`);
            }
          }
        }

        // Collect into notifications list if requiring attention
        if (status === 'asking' || status === 'stopped' || status === 'over') {
          nextList.push({
            id: notifId,
            workspaceId: ws.id,
            workspaceName: ws.name,
            workspaceColor: ws.color || '#3b82f6',
            paneId: p.id,
            tty: p.tty,
            terminalName,
            cli: meta.cli,
            status,
            snippet,
            timestamp: Date.now(),
            duration: meta.duration,
          });
        }

        prevStatusRef.current.set(p.tty, status);
      });
    }

    // Clean up alert keys that are no longer active
    for (const key of alertedSetRef.current) {
      if (!currentAlertKeys.has(key)) {
        alertedSetRef.current.delete(key);
      }
    }

    setNotifications(nextList);
  }, [workspaces, terminals, activeWorkspaceId, onToast]);

  // Periodic polling every 600ms
  useEffect(() => {
    scan();
    const interval = window.setInterval(scan, 600);
    return () => window.clearInterval(interval);
  }, [scan]);

  const activeNotifications = notifications.filter((n) => !dismissedIds.has(n.id));
  const askingCount = activeNotifications.filter((n) => n.status === 'asking').length;
  const stoppedCount = activeNotifications.filter((n) => n.status === 'stopped' || n.status === 'over').length;

  const dismissNotification = useCallback((id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  }, []);

  const clearAll = useCallback(() => {
    setDismissedIds(new Set(notifications.map((n) => n.id)));
  }, [notifications]);

  const handleNavigate = useCallback(
    (workspaceId: string, tty: string) => {
      if (onNavigate) {
        onNavigate(workspaceId, tty);
      }
    },
    [onNavigate]
  );

  return {
    notifications: activeNotifications,
    unreadCount: activeNotifications.length,
    askingCount,
    stoppedCount,
    hasAsking: askingCount > 0,
    dismissNotification,
    clearAll,
    onNavigate: handleNavigate,
  };
}
