import { useEffect, useRef } from 'react';
import type { View, Workspace } from '@/lib/workspace';
import { TerminalManager } from '@/terminal/TerminalManager';

interface GlobalShortcutsOptions {
  view: View;
  onView: (v: View) => void;
  activeWorkspace?: Workspace;
  focusedTerminal: string | null;
  selectedPane: string | null;
  onSelectTerminal: (id: string | null) => void;
  onSelectPane: (id: string | null) => void;
  onAddPane: (targetSlotIndex?: number) => void | Promise<void>;
  onRemovePane: (paneId: string) => void;
  onAddIdeTerminal?: () => Promise<string | undefined>;
  onToast?: (msg: string, error?: boolean) => void;
}

/**
 * useGlobalShortcuts — provides browser-grade keyboard shortcuts across the app.
 *
 * Supported shortcuts:
 *   - Cmd+T / Ctrl+T: New Tab / New Terminal (auto-fills empty slot in Grid or appends tab in Workspace)
 *   - Cmd+W / Ctrl+W: Close active terminal tab or grid pane
 *   - Cmd+1..9 / Ctrl+1..9: Quick switch to terminal 1 through 9
 *   - Cmd+Shift+[ / Cmd+Shift+]: Cycle to previous / next terminal tab
 *   - Cmd+Shift+G / Ctrl+Shift+G: Toggle between Workspace and Grid views
 *   - Cmd+Alt+Arrow: Spatial navigation between cards in Grid View
 *
 * Registered with `{ capture: true }` so it intercepts keydown before child
 * elements, and works seamlessly alongside xterm.js custom key handler.
 */
export function useGlobalShortcuts({
  view,
  onView,
  activeWorkspace,
  focusedTerminal,
  selectedPane,
  onSelectTerminal,
  onSelectPane,
  onAddPane,
  onRemovePane,
  onAddIdeTerminal,
  onToast,
}: GlobalShortcutsOptions) {
  const stateRef = useRef({
    view,
    onView,
    activeWorkspace,
    focusedTerminal,
    selectedPane,
    onSelectTerminal,
    onSelectPane,
    onAddPane,
    onRemovePane,
    onAddIdeTerminal,
    onToast,
  });

  useEffect(() => {
    stateRef.current = {
      view,
      onView,
      activeWorkspace,
      focusedTerminal,
      selectedPane,
      onSelectTerminal,
      onSelectPane,
      onAddPane,
      onRemovePane,
      onAddIdeTerminal,
      onToast,
    };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (!isCmdOrCtrl) return;

      const key = e.key.toLowerCase();
      const current = stateRef.current;
      const ws = current.activeWorkspace;

      // ── Cmd + T / Ctrl + T: New Tab / New Terminal ──
      if (key === 't' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        if (current.view === 'ide') {
          current.onAddIdeTerminal?.();
          current.onToast?.('Opened new IDE terminal (⌘T)');
          return;
        }

        // Workspace view: appends a new terminal tab and focuses it
        if (current.view === 'workspace') {
          current.onAddPane();
          current.onToast?.('New terminal tab (⌘T)');
          return;
        }

        // Grid view: fill next available empty slot or append to expand grid
        if (current.view === 'grid') {
          if (!ws) {
            current.onAddPane();
            return;
          }
          const templateCount = ws.template || 4;
          const rawPanes = ws.panes || [];
          const totalSlots = Math.max(templateCount, rawPanes.length);

          let firstEmptySlotIndex = -1;
          for (let i = 0; i < totalSlots; i++) {
            const p = rawPanes[i];
            if (!p || !p.tty) {
              firstEmptySlotIndex = i;
              break;
            }
          }

          if (firstEmptySlotIndex !== -1) {
            current.onAddPane(firstEmptySlotIndex);
            current.onToast?.(`New terminal in Slot ${firstEmptySlotIndex + 1} (⌘T)`);
          } else {
            current.onAddPane();
            current.onToast?.('New terminal added to grid (⌘T)');
          }
          return;
        }

        // Any other view: default to onAddPane
        current.onAddPane();
        current.onToast?.('New terminal created (⌘T)');
        return;
      }

      // ── Cmd + W / Ctrl + W: Close Active Tab / Pane ──
      if (key === 'w' && !e.shiftKey && !e.altKey) {
        // Do not intercept if user is typing in a form or code editor
        const target = e.target as HTMLElement | null;
        const isEditable = target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('.cm-editor')
        );
        if (isEditable) return;

        e.preventDefault();
        e.stopPropagation();

        if (!ws) return;
        const terminalsInWs = ws.panes.filter((p) => p.tty);
        if (terminalsInWs.length <= 1) {
          current.onToast?.('Cannot close the only terminal in workspace', true);
          return;
        }

        if (current.view === 'workspace' && current.focusedTerminal) {
          const pane = ws.panes.find((p) => p.tty === current.focusedTerminal);
          if (pane) {
            current.onRemovePane(pane.id);
            current.onToast?.('Closed terminal tab (⌘W)');
          }
        } else if (current.view === 'grid') {
          const targetPaneId =
            current.selectedPane ||
            (current.focusedTerminal
              ? ws.panes.find((p) => p.tty === current.focusedTerminal)?.id
              : null) ||
            terminalsInWs[0]?.id;

          if (targetPaneId) {
            current.onRemovePane(targetPaneId);
            current.onToast?.('Closed grid pane (⌘W)');
          }
        }
        return;
      }

      // ── Cmd + 1..9 / Ctrl + 1..9: Jump to Tab / Slot 1..9 ──
      if (/^[1-9]$/.test(key) && !e.shiftKey && !e.altKey) {
        if (!ws) return;
        const terminalsInWs = ws.panes.filter((p) => p.tty);
        const index = parseInt(key, 10) - 1;
        const target = terminalsInWs[index];
        if (target && target.tty) {
          e.preventDefault();
          e.stopPropagation();
          current.onSelectTerminal(target.tty);
          current.onSelectPane(target.id);
          try {
            TerminalManager.get(target.tty)?.term.focus();
          } catch {}
          current.onToast?.(`Switched to terminal ${index + 1} (⌘${key})`);
        }
        return;
      }

      // ── Cmd + Shift + [ / ]: Previous / Next Tab ──
      if ((key === '[' || key === ']') && e.shiftKey) {
        if (!ws) return;
        const terminalsInWs = ws.panes.filter((p) => p.tty);
        if (terminalsInWs.length <= 1) return;

        e.preventDefault();
        e.stopPropagation();

        const currentIdx = terminalsInWs.findIndex((p) => p.tty === current.focusedTerminal);
        let nextIdx = 0;
        if (key === '[') {
          nextIdx = currentIdx <= 0 ? terminalsInWs.length - 1 : currentIdx - 1;
        } else {
          nextIdx = currentIdx >= terminalsInWs.length - 1 ? 0 : currentIdx + 1;
        }

        const target = terminalsInWs[nextIdx];
        if (target && target.tty) {
          current.onSelectTerminal(target.tty);
          current.onSelectPane(target.id);
          try {
            TerminalManager.get(target.tty)?.term.focus();
          } catch {}
        }
        return;
      }

      // ── Cmd + Shift + G: Toggle Workspace <-> Grid View ──
      if (key === 'g' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const nextView = current.view === 'grid' ? 'workspace' : 'grid';
        current.onView(nextView);
        current.onToast?.(`Switched to ${nextView === 'grid' ? 'Grid' : 'Workspace'} view (⌘⇧G)`);
        return;
      }

      // ── Cmd + Alt + Arrow Keys: Spatial Navigation in Grid ──
      if (current.view === 'grid' && e.altKey && ws) {
        const terminalsInWs = ws.panes.filter((p) => p.tty);
        if (terminalsInWs.length <= 1) return;

        const currentIdx = terminalsInWs.findIndex(
          (p) => p.id === current.selectedPane || p.tty === current.focusedTerminal
        );
        if (currentIdx === -1) return;

        let nextTargetIdx = -1;
        if (key === 'arrowleft') {
          nextTargetIdx = currentIdx > 0 ? currentIdx - 1 : terminalsInWs.length - 1;
        } else if (key === 'arrowright') {
          nextTargetIdx = currentIdx < terminalsInWs.length - 1 ? currentIdx + 1 : 0;
        } else if (key === 'arrowup') {
          // Assume 2-4 columns; jump back by estimated row step or wrap
          nextTargetIdx = Math.max(0, currentIdx - 2);
        } else if (key === 'arrowdown') {
          nextTargetIdx = Math.min(terminalsInWs.length - 1, currentIdx + 2);
        }

        if (nextTargetIdx !== -1 && nextTargetIdx !== currentIdx) {
          e.preventDefault();
          e.stopPropagation();
          const target = terminalsInWs[nextTargetIdx];
          if (target && target.tty) {
            current.onSelectTerminal(target.tty);
            current.onSelectPane(target.id);
            try {
              TerminalManager.get(target.tty)?.term.focus();
            } catch {}
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);
}
