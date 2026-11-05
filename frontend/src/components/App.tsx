// tto — unified desktop shell (LEGACY PARITY port, Next.js).
// Byte-atomic, ASCII-only build. Renders the terminal pool exactly the
// way the legacy shell did: ONE pool keyed by session id, panes wired
// by pane.tty, and a BOOT effect that auto-spawns a fresh Rust PTY
// session for every pane with tty:null (old ensureSessions logic).

'use client';

import {
  useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense,
} from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { isTauri, tauri, listenEvent } from '@/lib/tauri';
import {
  loadWorkspaces, saveWorkspaces, loadActiveWsId, saveActiveWsId,
  newWorkspace, type Workspace, type View, type Pane, type TemplateKey, type GridMode,
} from '@/lib/workspace';
import { TerminalPool } from '@/components/terminal/TerminalPool';
import { FileEditorPopup } from '@/components/editor/FileEditorPopup';
import { Sidebar } from '@/components/shell/Sidebar';
import { WorkspaceView } from '@/views/workspace/WorkspaceView';
import { GridView } from '@/views/grid/GridView';
import { DashboardView } from '@/views/dashboard/DashboardView';
import { IDEView } from '@/views/ide/IDEView';
import { WizardView } from '@/views/wizard/WizardView';
import { KanbanView } from '@/views/kanban/KanbanView';
import { CardsView } from '@/views/cards/CardsView';
import { PlannerView } from '@/views/planner/PlannerView';
import { AgentView } from '@/views/agent/AgentView';
import { DevicesView } from '@/views/devices/DevicesView';
import { DjangoView } from '@/views/django/DjangoView';
import { useTerminals } from '@/hooks/useTerminals';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { putFile } from '@/lib/api';
import type { NativeSessionEntry, UnifiedTerminal } from '@/types';
import type { DropChip } from '@/components/DroppedFileChip';
import { shellQuotePath } from '@/terminal/dropPaths';
import { TerminalManager } from '@/terminal/TerminalManager';
import { sessionContextStore } from '@/jarvis/contextStore';
import { X } from 'lucide-react';
// Developer City: lazy so the R3F/three payload only loads when the view opens.
const CityView = lazy(() =>
  import('@/city/CityView').then((m) => ({ default: m.CityView })),
);
// Collab: lazy so the collab payload only loads when the view opens.
const ColabView = lazy(() =>
  import('@/components/ColabView').then((m) => ({ default: m.CollabView })),
);
void ColabView; // suppress unused warning
import type { Project } from '@/city/types';
import { CollaboratorLoginGate } from '@/components/auth/CollaboratorLoginGate';
import { getCollabSession, type CollabUser, type OwnerProfile } from '@/lib/collab';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SettingsView } from '@/views/settings/SettingsView';
import { CallOverlay } from '@/opendots/components/CallOverlay';

const INITIAL_TERMINAL_COLS = 120;
const INITIAL_TERMINAL_ROWS = 40;
const BARE_SHELLS = ['zsh', 'zshl', '/bin/zsh', 'bash', 'sh', 'exec zsh'];

function paneLaunchCommand(ws: Workspace, pane: Pane, isIde: boolean): string | undefined {
  if (isIde) return undefined;
  const raw = (pane.launchCommand || ws.command || '').trim();
  if (!raw || BARE_SHELLS.includes(raw)) return undefined;
  return raw;
}

export default function App() {
  const { theme: t } = useTheme();

  // ── Sidecar data (tasks, tokens, opencode status) ──
  const { terminals: sidecarTerminals, tokenUsage: sidecarTokenUsage } = useTerminals();

  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => loadWorkspaces());
  const [activeWsId, setActiveWsId] = useState<string>(() => loadActiveWsId());
  const [view, setView] = useState<View>('workspace');
  const previousViewRef = useRef<View>('workspace');

  const handleSetView = useCallback((nextView: View) => {
    setView((curr) => {
      if (curr !== 'settings') {
        previousViewRef.current = curr;
      }
      return nextView;
    });
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [focusedTerminal, setFocusedTerminal] = useState<string | null>(null);
  const [nativeSessions, setNativeSessions] = useState<NativeSessionEntry[]>([]);
  // Collab: per-workspace active usernames (from sidecar presence)
  const [collabActivity, setCollabActivity] = useState<Record<string, string[]>>({});
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // True ONLY once terminal_list returned a valid array. `[]` is a legitimate
  // answer ("no sessions exist"); a rejected invoke is not — we must never
  // treat a failed fetch as evidence that every session is dead.
  const [sessionsFetched, setSessionsFetched] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Remote Collaborator session state (for browser visitors) ──
  const [collabSession, setCollabSession] = useState<{
    user: CollabUser;
    owner: OwnerProfile | null;
  } | null>(null);
  const [checkingCollabAuth, setCheckingCollabAuth] = useState(!isTauri());

  useEffect(() => {
    if (isTauri()) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('tto_collab_token') : null;
    if (!token) {
      setCheckingCollabAuth(false);
      return;
    }
    (async () => {
      try {
        const session = await getCollabSession(token);
        setCollabSession(session);
      } catch (e) {
        console.warn('[App] Invalid remote collab token:', e);
        if (typeof window !== 'undefined') localStorage.removeItem('tto_collab_token');
      } finally {
        setCheckingCollabAuth(false);
      }
    })();
  }, []);

  // Auto-dismissing toast handler with timer reset
  const showToast = useCallback((msg: string, error = false) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, error });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4000);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const [dropChips, setDropChips] = useState<Record<string, DropChip[]>>({});

  // ── Terminal rename state ──
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [terminalNameDraft, setTerminalNameDraft] = useState('');

  const startRenameTerminal = useCallback((tty: string, currentLabel: string) => {
    setEditingTerminalId(tty);
    setTerminalNameDraft(currentLabel);
  }, []);

  const handleRenameTerminalDirect = useCallback((idOrTty: string, newLabel: string) => {
    const label = newLabel.trim();
    if (!label) return;
    setWorkspaces((prev) => {
      const next = prev.map((w) => ({
        ...w,
        panes: w.panes.map((p) => (p.id === idOrTty || p.tty === idOrTty ? { ...p, label } : p)),
        idePanes: w.idePanes?.map((p) => (p.id === idOrTty || p.tty === idOrTty ? { ...p, label } : p)),
      }));
      saveWorkspaces(next);
      return next;
    });
    sessionContextStore.renameTerminal(idOrTty, label);
    setNativeSessions((prev) =>
      prev.map((s) => (s.id === idOrTty || s.tty === idOrTty ? { ...s, title: label } : s))
    );
    if (isTauri()) {
      tauri.setTitle(idOrTty, label).catch(() => {});
    }
  }, []);

  const handleSetPaneSizeMode = useCallback((paneId: string, sizeMode: GridMode) => {
    setWorkspaces((prev) => {
      const next = prev.map((w) => ({
        ...w,
        panes: w.panes.map((p) => (p.id === paneId ? { ...p, sizeMode } : p)),
      }));
      saveWorkspaces(next);
      return next;
    });
  }, []);

  const handleSetWorkspaceTemplate = useCallback((wsId: string, template: TemplateKey) => {
    setWorkspaces((prev) => {
      const next = prev.map((w) => (w.id === wsId ? { ...w, template } : w));
      saveWorkspaces(next);
      return next;
    });
  }, []);

  const handleSetWorkspaceLayoutMode = useCallback((wsId: string, layoutMode: GridMode) => {
    setWorkspaces((prev) => {
      const next = prev.map((w) => (w.id === wsId ? { ...w, layoutMode } : w));
      saveWorkspaces(next);
      return next;
    });
  }, []);

  const commitRenameTerminal = useCallback((tty: string) => {
    const label = terminalNameDraft.trim();
    if (label) {
      handleRenameTerminalDirect(tty, label);
    }
    setEditingTerminalId(null);
    setTerminalNameDraft('');
  }, [terminalNameDraft, handleRenameTerminalDirect]);

  const cancelRenameTerminal = useCallback(() => {
    setEditingTerminalId(null);
    setTerminalNameDraft('');
  }, []);

  // ── Workspace-level UI state ──
  const [viewMode, setViewMode] = useState<'focus' | 'split' | 'grid'>('focus');
  const [expandedPane, setExpandedPane] = useState<string | null>(null);
  const [selectedPane, setSelectedPane] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<{ path: string; name: string; dirty?: boolean }[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [editorPopupOpen, setEditorPopupOpen] = useState(false);
  const [gotoNonce, setGotoNonce] = useState(0);
  const [connected, setConnected] = useState(false);

  // ── Remote collaborator workspace visibility filtering ──
  const visibleWorkspaces = useMemo(() => {
    if (!isTauri() && collabSession?.user?.allowed_workspaces && collabSession.user.allowed_workspaces.length > 0) {
      const allowed = new Set(collabSession.user.allowed_workspaces);
      const filtered = workspaces.filter((w) => allowed.has(w.id));
      return filtered.length > 0 ? filtered : workspaces;
    }
    return workspaces;
  }, [workspaces, collabSession]);

  // Keep activeWsId valid for remote collaborators
  useEffect(() => {
    if (!isTauri() && visibleWorkspaces.length > 0 && !visibleWorkspaces.some((w) => w.id === activeWsId)) {
      setActiveWsId(visibleWorkspaces[0].id);
    }
  }, [visibleWorkspaces, activeWsId]);

  // ── Derived: active workspace ──
  const activeWorkspace = useMemo(
    () => visibleWorkspaces.find((w) => w.id === activeWsId) || visibleWorkspaces[0],
    [visibleWorkspaces, activeWsId],
  );

  // ── Persist workspace changes ──
  useEffect(() => { saveWorkspaces(workspaces); }, [workspaces]);
  useEffect(() => { saveActiveWsId(activeWsId); }, [activeWsId]);

  // ── Auto-spawn Rust PTY sessions for tty:null panes on the ACTIVE workspace ─────
  // Spawns lazily on-demand: only the active workspace spawns PTYs.
  // Inactive workspaces keep their panes unspawned until switched to, preventing
  // 40+ concurrent zsh fork storms, pre-exec crashes, and main-thread freezes.
  const bootCreated = useRef(new Set<string>());
  const isSpawningRef = useRef(false);

  useEffect(() => {
    if (!isTauri() || !sessionsLoaded) {
      return;
    }
    const currentWs = workspaces.find((w) => w.id === activeWsId);
    if (!currentWs) return;

    const missing: Array<{ ws: Workspace; pane: Pane; isIde?: boolean }> = [];
    for (const p of currentWs.panes) {
      if (!p.tty && !bootCreated.current.has(p.id)) {
        missing.push({ ws: currentWs, pane: p, isIde: false });
      }
    }
    if (currentWs.idePanes) {
      for (const p of currentWs.idePanes) {
        if (!p.tty && !bootCreated.current.has(p.id)) {
          missing.push({ ws: currentWs, pane: p, isIde: true });
        }
      }
    }

    if (missing.length === 0 || isSpawningRef.current) return;
    isSpawningRef.current = true;

    const run = async () => {
      console.log(`[App] Spawning ${missing.length} missing panes for active workspace ${currentWs.id} (${currentWs.name})`);
      const newSidMap = new Map<string, string>(); // paneId -> sid

      for (const { ws, pane, isIde } of missing) {
        if (bootCreated.current.has(pane.id)) continue;
        bootCreated.current.add(pane.id);
        try {
          const cmdToRun = paneLaunchCommand(ws, pane, !!isIde);
          const created = await tauri.create(ws.projectPath || undefined, ws.id, INITIAL_TERMINAL_COLS, INITIAL_TERMINAL_ROWS, cmdToRun);
          const result = created as { id?: string; tty?: string };
          const sid = result?.id || result?.tty;
          console.log(`[App] PTY created (isIde=${isIde}): id=${result?.id} tty=${result?.tty} → sid=${sid}`);
          if (sid) {
            newSidMap.set(pane.id, sid);
          }
          // Micro-yield between process spawns so macOS libc allocator and fork lock cleanly settle
          await new Promise((r) => setTimeout(r, 60));
        } catch (err) {
          console.error(`[App] PTY creation FAILED for pane ${pane.id}:`, err);
        }
      }

      if (newSidMap.size > 0) {
        // Single atomic state update for all newly spawned panes
        setWorkspaces((prev) =>
          prev.map((w) => {
            if (w.id !== currentWs.id) return w;
            return {
              ...w,
              panes: w.panes.map((p) => {
                const sid = newSidMap.get(p.id);
                return sid ? { ...p, tty: sid } : p;
              }),
              idePanes: (w.idePanes || []).map((p) => {
                const sid = newSidMap.get(p.id);
                return sid ? { ...p, tty: sid } : p;
              }),
            };
          })
        );

        // Auto-focus first terminal if not focused
        const firstSid = Array.from(newSidMap.values())[0];
        if (firstSid && (!focusedTerminal || !currentWs.panes.some((p) => p.tty === focusedTerminal))) {
          setFocusedTerminal(firstSid);
        }

        // Re-fetch sessions so newly created ones appear in nativeSessions
        try {
          const refreshed = await tauri.list();
          if (Array.isArray(refreshed)) {
            setNativeSessions(refreshed as unknown as NativeSessionEntry[]);
          }
        } catch (err) {
          console.error('[App] Session list refresh FAILED:', err);
        }
      }

      isSpawningRef.current = false;
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsLoaded, isTauri(), activeWsId, workspaces]);

  // ── Keep focusedTerminal in sync with the active workspace ──────────
  // The Workspace view renders *only* `focusedTerminal`, which is global and
  // is set by the boot effect to the FIRST terminal created across ALL
  // workspaces. So after a reload — or after switching `activeWsId` — it can
  // point at a terminal belonging to a *different* workspace. This effect
  // re-syncs it: keep the current focus if it already belongs to the active
  // workspace, otherwise focus that workspace's first live terminal (or null
  // if it has none). One mechanism covers both the click-switch and reload.
  useEffect(() => {
    setExpandedPane(null);
    setSelectedPane(null);
  }, [activeWsId, view]);

  useEffect(() => {
    const ws = workspaces.find((w) => w.id === activeWsId);
    if (!ws) return;
    const ttySet = new Set(ws.panes.map((p) => p.tty).filter(Boolean));
    if (focusedTerminal && ttySet.has(focusedTerminal)) return;
    setFocusedTerminal(ws.panes.find((p) => p.tty)?.tty ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWsId, sessionsLoaded, workspaces]);

  // ── Listen for session lifecycle events from Rust ──
  useEffect(() => {
    if (!isTauri()) {
      setSessionsLoaded(true);
      return;
    }
    (async () => {
      try {
        const sessions = await tauri.list();
        console.log(`[App] Initial session list: ${Array.isArray(sessions) ? sessions.length : 'N/A'} sessions`);
        if (Array.isArray(sessions)) {
          setNativeSessions(sessions as unknown as NativeSessionEntry[]);
          setSessionsFetched(true);
        }
      } catch (err) {
        console.error('[App] Initial session list FAILED:', err);
      }
      setSessionsLoaded(true);

      // Listen for session updates
      const unlistenUpdated = await listenEvent('terminal-updated', async () => {
        try {
          const refreshed = await tauri.list();
          if (Array.isArray(refreshed)) {
            setNativeSessions(refreshed as unknown as NativeSessionEntry[]);
          }
        } catch {}
      });
      const unlistenChanged = await listenEvent('terminal:session-changed', (payload: any) => {
        if (payload && Array.isArray(payload.sessions)) {
          console.log(`[App] Session changed event: ${payload.sessions.length} sessions`);
          setNativeSessions(payload.sessions);
        }
      });
      return () => {
        unlistenUpdated();
        unlistenChanged();
      };
    })();
  }, []);

  // ── Connection status ──
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        await tauri.gatewayStatus();
        setConnected(true);
      } catch {
        setConnected(false);
      }
    })();
  }, []);

  // ── Collab: fetch live presence from sidecar ──
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const fetchPresence = async () => {
      try {
        const base = `http://127.0.0.1:${8765}`;
        const res = await fetch(`${base}/api/collab/presence`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        // Build per-workspace activity map from presence
        // For now, all online users are shown in all workspaces they have access to
        // A more sophisticated version would check per-user allowed_workspaces
        const activity: Record<string, string[]> = {};
        for (const user of data.users || []) {
          if (user.username !== 'owner') {
            // Add to all workspaces for simplicity
            for (const ws of workspaces) {
              if (!activity[ws.id]) activity[ws.id] = [];
              if (!activity[ws.id].includes(user.username)) {
                activity[ws.id].push(user.username);
              }
            }
          }
        }
        setCollabActivity(activity);
      } catch {
        // Silent - presence is optional
      }
    };
    fetchPresence();
    const interval = setInterval(fetchPresence, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isTauri(), workspaces]);

  // Keep TerminalManager's TTY index in sync with all live sessions
  useEffect(() => {
    for (const s of nativeSessions) {
      if (s.id && s.tty) {
        TerminalManager.setTty(s.id, s.tty);
      }
    }
  }, [nativeSessions]);

  // ── Unified terminals: merge Rust native sessions + sidecar data ──
  const unifiedTerminals: Record<string, UnifiedTerminal> = useMemo(() => {
    const map: Record<string, UnifiedTerminal> = {};

    // Start with sidecar data (has tasks, tokens, opencode status)
    for (const [key, entry] of Object.entries(sidecarTerminals)) {
      map[key] = entry;
      const cleanKey = key.startsWith('/dev/') ? key.slice(5) : key;
      if (cleanKey !== key) map[cleanKey] = entry;
    }

    // Layer Rust session metadata on top (status, agent, cwd, title)
    for (const s of nativeSessions) {
      const key = s.id;
      const cleanTty = s.tty ? (s.tty.startsWith('/dev/') ? s.tty.slice(5) : s.tty) : undefined;
      const existing = map[key] || (cleanTty ? map[cleanTty] : undefined) || (s.tty ? map[s.tty] : undefined);
      let unified: UnifiedTerminal;
      if (existing) {
        // Merge: keep sidecar's tasks/tokens, update Rust metadata
        existing.agent = s.agent || existing.agent;
        existing.cli = s.cli || existing.cli;
        existing.cwd = s.cwd || existing.cwd;
        existing.is_live = s.status === 'running';
        existing.rust_status = s.status;
        existing.session_name = s.title || existing.session_name;
        existing.pane_title = s.title || existing.pane_title;
        existing.session_id = key;
        if (cleanTty) existing.tty = cleanTty;
        unified = existing;
      } else {
        // Rust-only session (no sidecar data yet)
        unified = {
          tty: cleanTty || s.tty || key,
          agent: s.agent || '',
          cli: s.cli || '',
          cwd: s.cwd || '',
          is_live: s.status === 'running',
          tokens: { tokens_input: 0, tokens_output: 0, cost: 0, model: '', session_title: s.title },
          session_name: s.title,
          window_name: '',
          pane_title: s.title,
          session_context: '',
          session_summary: '',
          pending_cli: false,
          live_output: '',
          suggested_task: '',
          current_task: null,
          next_task: null,
          queue: [],
          history: [],
          session_id: key,
          rust_status: s.status,
        };
      }
      map[key] = unified;
      if (cleanTty) {
        map[cleanTty] = unified;
        map[`/dev/${cleanTty}`] = unified;
      }
      if (s.tty) {
        map[s.tty] = unified;
      }
    }

    return map;
  }, [nativeSessions, sidecarTerminals]);



  // ── All session IDs for terminal pool (canonical key = Rust session ID) ──
  const allSessionIds = useMemo(() => {
    // Gated on sessionsLoaded and filtered to ids Rust still knows about.
    // pane.tty is persisted in localStorage across launches while Rust mints a
    // fresh id on every boot, so a pre-restart id ("t-47") is a corpse — feeding
    // it to the pool creates an xterm that can only ever report
    // "no session t-47".
    if (!sessionsLoaded) return [];
    const live = new Set(nativeSessions.map((s) => s.id).filter(Boolean));
    if (live.size === 0) return Array.from(live);
    const ids = new Set<string>();
    // Workspace panes hold the Rust session ID as pane.tty (set by boot effect)
    for (const ws of workspaces) {
      for (const p of ws.panes) {
        if (p.tty && live.has(p.tty)) ids.add(p.tty);
      }
      if (ws.idePanes) {
        for (const p of ws.idePanes) {
          if (p.tty && live.has(p.tty)) ids.add(p.tty);
        }
      }
    }
    // Native sessions: prefer the Rust session id (s.id), NOT the OS tty (s.tty)
    for (const s of nativeSessions) {
      if (s.id) ids.add(s.id);
    }
    if (focusedTerminal && live.has(focusedTerminal)) ids.add(focusedTerminal);
    return Array.from(ids);
  }, [workspaces, focusedTerminal, nativeSessions, sessionsLoaded]);

  // ── One-time purge of dead pane.tty values ──
  //
  // Without this a pane whose persisted tty is from a previous run keeps
  // pointing at a session Rust has already discarded. The boot effect only
  // spawns a PTY when tty is null, so that pane stayed BLANK forever and
  // re-failed its attach on every cycle.
  const stalePurged = useRef(false);
  useEffect(() => {
    if (!isTauri() || !sessionsLoaded || stalePurged.current) return;
    // Wait for a *confirmed* list. A rejected terminal_list leaves
    // nativeSessions empty but proves nothing about which ids are dead, and
    // purging then would tear down and respawn every healthy terminal.
    if (!sessionsFetched) return;
    const live = new Set(nativeSessions.map((s) => s.id).filter(Boolean));
    let staleFound = false;
    for (const ws of workspaces) {
      for (const p of ws.panes) {
        if (p.tty && !live.has(p.tty)) { staleFound = true; break; }
      }
      if (ws.idePanes) {
        for (const p of ws.idePanes) {
          if (p.tty && !live.has(p.tty)) { staleFound = true; break; }
        }
      }
      if (staleFound) break;
    }
    if (!staleFound) { stalePurged.current = true; return; }
    stalePurged.current = true;
    console.log('[App] Purging stale pane.tty values (session ids from a previous run)');
    setWorkspaces((prev) =>
      prev.map((w) => ({
        ...w,
        panes: w.panes.map((p) => (p.tty && !live.has(p.tty) ? { ...p, tty: null } : p)),
        idePanes: w.idePanes?.map((p) => (p.tty && !live.has(p.tty) ? { ...p, tty: null } : p)),
      })),
    );
    if (focusedTerminal && !live.has(focusedTerminal)) setFocusedTerminal(null);
  }, [sessionsLoaded, sessionsFetched, nativeSessions, workspaces, focusedTerminal]);

  // ── Workspace handlers ──
  const handleNewWorkspace = useCallback(() => {
    setView('wizard');
  }, []);

  const handleCreateWorkspace = useCallback((config: { projectPath?: string; template: TemplateKey; command?: string }) => {
    const cleanPath = config.projectPath?.trim().replace(/^["']|["']$/g, '') || undefined;
    const cleanCmd = config.command?.trim() || undefined;
    const ws = newWorkspace(undefined, config.template, cleanPath, cleanCmd);
    if (cleanCmd) ws.command = cleanCmd;
    if (cleanPath) ws.projectPath = cleanPath;
    setWorkspaces((prev) => [...prev, ws]);
    setActiveWsId(ws.id);
    setFocusedTerminal(null);
    setView('workspace');
  }, []);

  // ── Developer City hand-offs ─────────────────────────────────────────────
  const cityContinue = useCallback((proj: Project) => {
    // Prefer an existing live session inside this project's folder.
    const key = Object.keys(unifiedTerminals).find((k) => {
      const e = unifiedTerminals[k];
      const cwd = e.cwd || '';
      return cwd !== '' && (e.is_live || e.session_id) &&
        (cwd === proj.path || cwd.startsWith(proj.path + '/') || proj.path.startsWith(cwd));
    });
    if (key) {
      setFocusedTerminal(key);
      setView('workspace');
      return;
    }
    // No session yet: open a fresh workspace pinned to the project path.
    handleCreateWorkspace({ projectPath: proj.path, template: 1 });
  }, [unifiedTerminals, handleCreateWorkspace]);

  const cityNewSession = useCallback((proj: Project) => {
    handleCreateWorkspace({ projectPath: proj.path, template: 1 });
  }, [handleCreateWorkspace]);

  const cityOpenTerminal = useCallback((terminalId: string) => {
    setFocusedTerminal(terminalId);
    setView('workspace');
  }, []);

  const handleCloseWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => {
      const target = prev.find((w) => w.id === id);
      if (target && isTauri()) {
        const toClose = new Set<string>();
        for (const p of target.panes) {
          if (p.tty) toClose.add(p.tty);
        }
        if (target.idePanes) {
          for (const p of target.idePanes) {
            if (p.tty) toClose.add(p.tty);
          }
        }
        for (const sid of toClose) {
          tauri.close(sid).catch(() => {});
        }
      }
      const next = prev.filter((w) => w.id !== id);
      if (next.length === 0) next.push(newWorkspace());
      return next;
    });
  }, []);

  const handleRenameWorkspace = useCallback((id: string, name: string) => {
    setWorkspaces((prev) => prev.map((w) => w.id === id ? { ...w, name } : w));
  }, []);

  // Upload / clear a workspace's icon (data URL). Mirrored onto the city
  // building by useWorkspaceSync; persisted with the workspace list.
  const handleSetWorkspaceLogo = useCallback((id: string, logo: string | null) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const next = { ...w };
        if (logo) next.logo = logo;
        else delete next.logo;
        return next;
      }),
    );
  }, []);

  const handleSetProjectPath = useCallback((id: string, path: string) => {
    const cleanPath = path.trim().replace(/^["']|["']$/g, '');
    const basename = cleanPath.split(/[/\\]/).filter(Boolean).pop() || cleanPath;

    // 1. Immediately activate this workspace and switch to workspace view
    setActiveWsId(id);
    setView('workspace');

    // 2. Update workspace metadata and persist
    setWorkspaces((prev) => {
      const next = prev.map((w) => {
        if (w.id !== id) return w;
        return { ...w, projectPath: cleanPath, name: basename };
      });
      saveWorkspaces(next);
      return next;
    });

    // 3. Persist to recent projects
    try {
      const saved = localStorage.getItem('tto-recent-paths');
      const recents: string[] = saved ? JSON.parse(saved) : [];
      const updated = [cleanPath, ...recents.filter((p) => p !== cleanPath)].slice(0, 8);
      localStorage.setItem('tto-recent-paths', JSON.stringify(updated));
    } catch {}

    // 4. Directly synchronize directory for all running terminals in this workspace
    const ws = workspaces.find((w) => w.id === id);
    if (ws) {
      const liveTtys = [
        ...ws.panes.map((p) => p.tty),
        ...(ws.idePanes || []).map((p) => p.tty),
      ].filter((t): t is string => Boolean(t));

      if (liveTtys.length > 0) {
        for (const tty of liveTtys) {
          try {
            TerminalManager.write(tty, `cd "${cleanPath}"\r`);
          } catch (e) {
            console.error('[App] Failed to auto-cd terminal:', e);
          }
        }
        // Focus the first live terminal so user is immediately in terminal
        setFocusedTerminal(liveTtys[0]);
      }
    }

    showToast(`Opened project: ${basename}`);
  }, [workspaces, showToast]);

  const handleOpenProjectFolder = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const path = await tauri.pickFolder();
      if (!path) return;
      const cleanPath = path.trim().replace(/^["']|["']$/g, '');
      const basename = cleanPath.split(/[/\\]/).filter(Boolean).pop() || cleanPath;

      const existing = workspaces.find((w) => w.projectPath === cleanPath);
      if (existing) {
        handleSetProjectPath(existing.id, cleanPath);
      } else {
        handleCreateWorkspace({
          projectPath: cleanPath,
          template: 4,
        });
        showToast(`Opened project: ${basename}`);
      }
    } catch (err) {
      console.error('[App] pickFolder failed:', err);
    }
  }, [workspaces, handleSetProjectPath, handleCreateWorkspace, showToast]);

  // ── Close a terminal card (grid tile / pane tab) ───────────────────
  const handleRemovePane = useCallback((paneId: string) => {
    setExpandedPane((ep) => (ep === paneId ? null : ep));
    setSelectedPane((sp) => (sp === paneId ? null : sp));
    const pane = workspaces
      .flatMap((w) => w.panes)
      .find((p) => p.id === paneId);
    if (!pane) return;
    const tty = pane.tty;
    // Drop the pane from workspace layout or convert to empty slot if within template
    setWorkspaces((prev) => {
      const next = prev.map((w) => {
        if (!w.panes.some((p) => p.id === paneId)) return w;
        if (w.panes.length > (w.template || 2)) {
          return { ...w, panes: w.panes.filter((p) => p.id !== paneId) };
        }
        return {
          ...w,
          panes: w.panes.map((p) => (
            p.id === paneId ? { id: p.id, tty: null, sizeMode: p.sizeMode } : p
          )),
        };
      });
      saveWorkspaces(next);
      return next;
    });
    if (tty && isTauri()) {
      // terminal_close kills the PTY process and makes Rust drop the
      // session. Without it the session stays in the Rust registry and
      // the pool keeps the card alive.
      tauri.close(tty).catch((err) =>
        console.error(`[App] terminal_close FAILED for ${tty}:`, err));
      // Rust never emits `terminal:session-changed`, so nativeSessions
      // — the only source that feeds session ids into the pool — must be
      // pruned locally. Otherwise the id stays in allSessionIds and the
      // pool's cleanup loop never disposes the card.
      setNativeSessions((prev) => prev.filter((s) => s.id !== tty));
    }
    if (tty && focusedTerminal === tty) {
      const remainingTtys = workspaces
        .flatMap((w) => w.panes)
        .map((p) => p.tty)
        .filter((t): t is string => Boolean(t && t !== tty));
      setFocusedTerminal(remainingTtys[0] || null);
    }
  }, [workspaces, focusedTerminal]);

  // ── Reorder / Splice panes within grid via drag-and-drop ──────────────
  const handleReorderPanes = useCallback((
    workspaceId: string,
    fromPaneOrIndex: string | number,
    toPaneOrIndex: string | number,
    position: 'before' | 'after' | 'swap' = 'after'
  ) => {
    setWorkspaces((prev) => {
      const next = prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const newPanes = [...w.panes];

        const fromIdx = typeof fromPaneOrIndex === 'string'
          ? newPanes.findIndex((p) => p.id === fromPaneOrIndex || p.tty === fromPaneOrIndex)
          : fromPaneOrIndex;
        const rawToIdx = typeof toPaneOrIndex === 'string'
          ? newPanes.findIndex((p) => p.id === toPaneOrIndex || p.tty === toPaneOrIndex)
          : toPaneOrIndex;

        if (fromIdx < 0 || fromIdx >= newPanes.length) return w;
        if (typeof toPaneOrIndex === 'string' && rawToIdx < 0) return w;
        if (fromIdx === rawToIdx && position !== 'swap') return w;

        if (position === 'swap') {
          let dest = rawToIdx;
          if (typeof toPaneOrIndex === 'number') {
            while (newPanes.length <= toPaneOrIndex) {
              // Claim pad ids so the boot effect does not spawn PTYs for
              // ghost-drop padding. Empty pads stay empty; only + / ⌘T spawn.
              const id = `p-${w.id}-${newPanes.length}-${Date.now().toString(36)}`;
              bootCreated.current.add(id);
              newPanes.push({ id, tty: null });
            }
            dest = toPaneOrIndex;
          }
          if (dest < 0 || dest >= newPanes.length || dest === fromIdx) return w;
          const tmp = newPanes[fromIdx];
          newPanes[fromIdx] = newPanes[dest];
          newPanes[dest] = tmp;
          return { ...w, panes: newPanes };
        }

        const [moved] = newPanes.splice(fromIdx, 1);

        const targetIdx = typeof toPaneOrIndex === 'string'
          ? newPanes.findIndex((p) => p.id === toPaneOrIndex || p.tty === toPaneOrIndex)
          : (toPaneOrIndex > fromIdx ? toPaneOrIndex - 1 : toPaneOrIndex);

        if (targetIdx === -1) {
          // If target is no longer found, restore moved element at its original index
          newPanes.splice(fromIdx, 0, moved);
          return w;
        } else {
          const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
          newPanes.splice(Math.max(0, Math.min(newPanes.length, insertIdx)), 0, moved);
        }

        return { ...w, panes: newPanes };
      });
      saveWorkspaces(next);
      return next;
    });
  }, []);

  // ── Close a terminal by tty (sidebar) — kills the PTY and drops its pane ──
  const handleCloseTerminal = useCallback((tty: string) => {
    const pane = workspaces
      .flatMap((w) => w.panes)
      .find((p) => p.tty === tty);
    if (pane) {
      // Reuse the full pane-close chain (pane removal, PTY kill, pool pruning).
      handleRemovePane(pane.id);
      return;
    }
    // Native session with no layout entry (shouldn't normally happen):
    // close it directly so no orphaned PTY lingers.
    if (isTauri()) {
      tauri.close(tty).catch((err) =>
        console.error(`[App] terminal_close FAILED for ${tty}:`, err));
      setNativeSessions((prev) => prev.filter((s) => s.id !== tty));
    }
    if (focusedTerminal === tty) setFocusedTerminal(null);
  }, [workspaces, handleRemovePane, focusedTerminal]);

  // ── Add a terminal card (grid tile / pane) ──────────────────────────
  // Spawns a fresh Rust PTY for the active workspace and links it to a new
  // pane. The pane is claimed in `bootCreated` up front so the boot effect
  // does not ALSO spawn a second PTY for it (which would double-create).
  const handleAddPane = useCallback(async (targetSlotIndex?: number) => {
    const ws = activeWorkspace;
    if (!ws || !isTauri()) return;

    if (view === 'grid') {
      const activeCount = ws.panes.filter((p) => p.tty).length;
      if (activeCount >= 16) {
        showToast('Maximum of 16 terminals reached in Grid view', true);
        return;
      }
    }

    let slotIdx = targetSlotIndex;
    if (typeof slotIdx !== 'number' && view === 'grid') {
      const templateCount = Math.min(16, ws.template || 4);
      const rawPanes = ws.panes || [];
      const totalSlots = Math.min(16, Math.max(templateCount, rawPanes.length));
      for (let i = 0; i < totalSlots; i++) {
        const p = rawPanes[i];
        if (!p || !p.tty) {
          slotIdx = i;
          break;
        }
      }
    }

    let paneId: string;
    if (typeof slotIdx === 'number') {
      if (ws.panes[slotIdx] && !ws.panes[slotIdx].tty) {
        paneId = ws.panes[slotIdx].id;
      } else {
        paneId = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        setWorkspaces((prev) => {
          const next = prev.map((w) => {
            if (w.id !== ws.id) return w;
            const newPanes = [...w.panes];
            while (newPanes.length < slotIdx!) {
              const padId = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
              bootCreated.current.add(padId);
              newPanes.push({ id: padId, tty: null });
            }
            if (slotIdx! < newPanes.length) {
              newPanes[slotIdx!] = { id: paneId, tty: null };
            } else {
              newPanes.push({ id: paneId, tty: null });
            }
            return { ...w, panes: newPanes };
          });
          saveWorkspaces(next);
          return next;
        });
      }
    } else {
      paneId = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      setWorkspaces((prev) => {
        const next = prev.map((w) =>
          w.id === ws.id ? { ...w, panes: [...w.panes, { id: paneId, tty: null }] } : w);
        saveWorkspaces(next);
        return next;
      });
    }
    bootCreated.current.add(paneId);
    try {
      const rawCmd = ws.command?.trim() || '';
      const cleanCmd = BARE_SHELLS.includes(rawCmd) ? undefined : (rawCmd || undefined);
      const created = await tauri.create(
        ws.projectPath || undefined, ws.id, INITIAL_TERMINAL_COLS, INITIAL_TERMINAL_ROWS, cleanCmd);
      const sid = (created as { id?: string; tty?: string })?.id ||
                  (created as { tty?: string })?.tty;
      if (!sid) return;
      // Link the spawned session to the pane and focus it.
      setWorkspaces((prev) => {
        const next = prev.map((w) =>
          w.id === ws.id
            ? { ...w, panes: w.panes.map((pp) => (pp.id === paneId ? { ...pp, tty: sid } : pp)) }
            : w);
        saveWorkspaces(next);
        return next;
      });
      setFocusedTerminal(sid);
      setSelectedPane(paneId);
      setTimeout(() => {
        try {
          TerminalManager.get(sid)?.term.focus();
        } catch {}
      }, 60);
      // Re-fetch so the new session shows up in the pool.
      const refreshed = await tauri.list();
      if (Array.isArray(refreshed)) setNativeSessions(refreshed as unknown as NativeSessionEntry[]);
    } catch (err) {
      console.error('[App] handleAddPane: PTY create failed:', err);
    }
  }, [activeWorkspace, view]);

  // ── Dedicated IDE Terminal Handlers ─────────────────────────────────
  const handleAddIdeTerminal = useCallback(async (): Promise<string | undefined> => {
    const ws = activeWorkspace;
    if (!ws || !isTauri()) return;
    const idePaneId = `ide-${ws.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    bootCreated.current.add(idePaneId);
    const count = (ws.idePanes?.length || 0) + 1;
    const tempPane: Pane = {
      id: idePaneId,
      tty: null,
      label: `IDE Terminal ${count}`,
    };
    setWorkspaces((prev) =>
      prev.map((w) =>
        w.id === ws.id ? { ...w, idePanes: [...(w.idePanes || []), tempPane] } : w
      )
    );
    try {
      const created = await tauri.create(ws.projectPath || undefined, ws.id, INITIAL_TERMINAL_COLS, INITIAL_TERMINAL_ROWS, undefined);
      const sid = (created as { id?: string; tty?: string })?.id ||
                  (created as { tty?: string })?.tty;
      if (!sid) return;
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === ws.id
            ? {
                ...w,
                idePanes: (w.idePanes || []).map((pp) =>
                  pp.id === idePaneId ? { ...pp, tty: sid } : pp
                ),
              }
            : w
        )
      );
      const refreshed = await tauri.list();
      if (Array.isArray(refreshed)) setNativeSessions(refreshed as unknown as NativeSessionEntry[]);
      return sid;
    } catch (err) {
      console.error('[App] handleAddIdeTerminal failed:', err);
    }
  }, [activeWorkspace]);

  const handleRemoveIdeTerminal = useCallback(async (tty: string) => {
    const ws = activeWorkspace;
    if (!ws) return;
    if (isTauri()) {
      tauri.close(tty).catch((err) =>
        console.error(`[App] tauri.close FAILED for IDE terminal ${tty}:`, err));
      setNativeSessions((prev) => prev.filter((s) => s.id !== tty));
    }
    setWorkspaces((prev) =>
      prev.map((w) =>
        w.id === ws.id
          ? {
              ...w,
              idePanes: (w.idePanes || []).filter((p) => p.tty !== tty),
            }
          : w
      )
    );
  }, [activeWorkspace]);

  const handleOpenFile = useCallback((path: string, name: string) => {
    setOpenFiles((prev) => {
      if (prev.some((f) => f.path === path)) return prev;
      return [...prev, { path, name }];
    });
    setActiveFile(path);
    setViewMode('split');
    setEditorPopupOpen(true);
  }, []);

  const handleCloseFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== path);
      if (activeFile === path) {
        setActiveFile(next.length > 0 ? next[next.length - 1].path : null);
      }
      return next;
    });
  }, [activeFile]);

  const handleMarkFileDirty = useCallback((path: string, dirty: boolean) => {
    setOpenFiles((prev) => prev.map((f) => f.path === path ? { ...f, dirty } : f));
  }, []);

  const handleSaveFile = useCallback(async (path: string, content: string) => {
    await putFile(path, content);
    setOpenFiles((prev) => prev.map((f) => f.path === path ? { ...f, dirty: false } : f));
  }, []);

  // ── Universal Global Shortcuts (Cmd+T / Ctrl+T, Cmd+W, Cmd+1..9, Cmd+Shift+[, Cmd+Shift+G) ──
  useGlobalShortcuts({
    view,
    onView: handleSetView,
    activeWorkspace,
    focusedTerminal,
    selectedPane,
    expandedPane,
    onSelectTerminal: setFocusedTerminal,
    onSelectPane: setSelectedPane,
    onExpandPane: setExpandedPane,
    onAddPane: handleAddPane,
    onRemovePane: handleRemovePane,
    onAddIdeTerminal: handleAddIdeTerminal,
    onToast: showToast,
  });

  // ── Drag & Drop file handler for terminals ──
  const handleDropToTerminal = useCallback(async (sessionId: string, paths: string[]) => {
    if (!sessionId || paths.length === 0) return;
    try {
      if (isTauri()) {
        await tauri.dropFiles(sessionId, paths);
      } else {
        const escaped = paths.map((p) => shellQuotePath(p)).join(' ');
        TerminalManager.write(sessionId, escaped);
      }

      const count = paths.length;
      const firstName = paths[0].split('/').filter(Boolean).pop() || paths[0];
      const msg = count === 1 ? `Dropped "${firstName}" into terminal` : `Dropped ${count} files into terminal`;
      showToast(msg, false);

      // Add attached file chips
      const chipId = Date.now();
      const newChips: DropChip[] = paths.map((p, idx) => ({
        id: chipId + idx,
        kind: 'file',
        name: p.split('/').filter(Boolean).pop() || p,
        fullPath: p,
        terminalId: sessionId,
        terminalLabel: sessionId,
      }));

      setDropChips((prev) => {
        const existing = prev[sessionId] || [];
        return {
          ...prev,
          [sessionId]: [...existing, ...newChips].slice(-8),
        };
      });

      // Auto dismiss after 90 seconds
      setTimeout(() => {
        setDropChips((prev) => {
          const cur = prev[sessionId];
          if (!cur) return prev;
          const ids = new Set(newChips.map((c) => c.id));
          return { ...prev, [sessionId]: cur.filter((c) => !ids.has(c.id)) };
        });
      }, 90000);
    } catch (err: any) {
      console.error('[App] handleDropToTerminal failed:', err);
      showToast(`Failed to drop file: ${err?.message || err}`, true);
    }
  }, []);

  const handleDismissChip = useCallback((id: number) => {
    setDropChips((prev) => {
      const next: Record<string, DropChip[]> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k] = v.filter((c) => c.id !== id);
      }
      return next;
    });
  }, []);

  const handleClearChips = useCallback((sessionId: string) => {
    setDropChips((prev) => ({ ...prev, [sessionId]: [] }));
  }, []);

  // Listen for native OS file drag & drop events from Tauri (Finder drops)
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        unlisten = await listenEvent('tto://drag-drop', (payload: any) => {
          const paths = payload?.paths || [];
          if (!paths.length) return;
          const targetSession = focusedTerminal ||
            activeWorkspace?.panes?.find((p) => p.tty)?.tty ||
            workspaces.flatMap((w) => w.panes).find((p) => p.tty)?.tty;
          if (targetSession) {
            handleDropToTerminal(targetSession, paths);
          }
        });
      } catch (err) {
        console.warn('[App] Failed to listen to tto://drag-drop:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [focusedTerminal, activeWorkspace, workspaces, handleDropToTerminal]);

  if (!isTauri() && checkingCollabAuth) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: t.colors.bg.primary,
        color: t.colors.text.secondary,
        fontFamily: t.fontFamily.sans,
        fontSize: 14,
      }}>
        Authenticating session…
      </div>
    );
  }

  if (!isTauri() && !collabSession) {
    return (
      <CollaboratorLoginGate
        onLoginSuccess={(resp) => {
          setCollabSession({
            user: {
              username: resp.username,
              email: resp.email,
              name: resp.name,
              permission: resp.permission,
              allowed_workspaces: resp.allowed_workspaces,
              created_at: Date.now(),
              revoked: false,
            },
            owner: resp.owner || null,
          });
          showToast(`Signed in as ${resp.name || resp.email}`);
        }}
      />
    );
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: t.colors.bg.primary, color: t.colors.text.primary,
      fontFamily: t.fontFamily.sans,
    }}>
      {!isTauri() && collabSession && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 16px',
          background: 'linear-gradient(90deg, rgba(37,99,235,0.18) 0%, rgba(139,92,246,0.18) 100%)',
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          fontSize: 12,
          color: t.colors.text.secondary,
          zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 8px #10b981',
            }} />
            <span>
              Collaborating as <strong style={{ color: t.colors.text.primary }}>{collabSession.user.name || collabSession.user.email}</strong>
              <span style={{
                marginLeft: 6,
                padding: '1px 6px',
                borderRadius: 4,
                fontSize: 10,
                textTransform: 'uppercase',
                fontWeight: 700,
                background: collabSession.user.permission === 'admin' ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)',
                color: collabSession.user.permission === 'admin' ? '#f87171' : '#60a5fa',
              }}>
                {collabSession.user.permission}
              </span>
              {collabSession.owner && (
                <span style={{ marginLeft: 8, color: t.colors.text.muted }}>
                  Host: {collabSession.owner.name || collabSession.owner.email || 'Admin'}
                </span>
              )}
            </span>
          </div>
          <button
            onClick={() => {
              if (typeof window !== 'undefined') localStorage.removeItem('tto_collab_token');
              setCollabSession(null);
            }}
            style={{
              background: 'transparent',
              border: `1px solid ${t.colors.border.subtle}`,
              borderRadius: 4,
              padding: '2px 8px',
              color: t.colors.text.muted,
              fontSize: 11,
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = t.colors.text.primary;
              e.currentTarget.style.borderColor = t.colors.border.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = t.colors.text.muted;
              e.currentTarget.style.borderColor = t.colors.border.subtle;
            }}
          >
            Sign Out
          </button>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar
            workspaces={visibleWorkspaces}
            activeId={activeWsId}
            activeWorkspace={activeWorkspace}
            onSelectWorkspace={setActiveWsId}
            onRenameWorkspace={handleRenameWorkspace}
            onSetProjectPath={handleSetProjectPath}
            onOpenProjectFolder={handleOpenProjectFolder}
            onSetWorkspaceLogo={handleSetWorkspaceLogo}
            onCloseWorkspace={handleCloseWorkspace}
            onNewWorkspace={handleNewWorkspace}
            onAddTerminal={handleAddPane}
            onOpenFile={handleOpenFile}
            view={view}
            onView={handleSetView}
            connected={connected}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
            onDropToTerminal={handleDropToTerminal}
            onToast={showToast}
            focusedTerminal={focusedTerminal}
            terminals={unifiedTerminals}
            openFiles={openFiles}
            activeFile={activeFile}
            onSelectTerminal={setFocusedTerminal}
            onCloseFile={handleCloseFile}
            onSaveFile={handleSaveFile}
            onMarkDirty={handleMarkFileDirty}
            viewMode={viewMode}
            onSetViewMode={setViewMode}
            onRenameTerminal={startRenameTerminal}
            onCloseTerminal={handleCloseTerminal}
            editingTerminalId={editingTerminalId}
            terminalNameDraft={terminalNameDraft}
            setTerminalNameDraft={setTerminalNameDraft}
            commitRenameTerminal={commitRenameTerminal}
            collabActivity={collabActivity}
            onCancelRenameTerminal={cancelRenameTerminal}
          />
        
        <main style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', minWidth: 0, position: 'relative',
        }}>
          <TerminalPool sessionIds={allSessionIds} />
          {view === 'city' && (
            <ErrorBoundary viewName="Developer City" onResetView={() => setView('workspace')}>
              <Suspense fallback={<div style={{ color: t.colors.text.muted, fontSize: 12, padding: 12 }}>Loading city…</div>}>
                <CityView
                  terminals={unifiedTerminals}
                  onContinue={cityContinue}
                  onNewSession={cityNewSession}
                  onOpenTerminal={cityOpenTerminal}
                  onToggleSidebar={() => setSidebarOpen((o) => !o)}
                  workspaces={visibleWorkspaces}
                  activeWorkspaceId={activeWsId}
                  onToast={showToast}
                />
              </Suspense>
            </ErrorBoundary>
          )}
          {view === 'dashboard' && (
            <DashboardView
              activeWorkspace={activeWorkspace}
              workspaces={visibleWorkspaces}
              terminals={unifiedTerminals}
              focusedTerminal={focusedTerminal}
              onSelectTerminal={setFocusedTerminal}
              onView={setView}
              onOpenFile={handleOpenFile}
              onToast={showToast}
              onRenameTerminal={handleRenameTerminalDirect}
            />
          )}
          {view === 'ide' && (
            <IDEView
              activeWorkspace={activeWorkspace}
              workspaces={visibleWorkspaces}
              terminals={unifiedTerminals}
              openFiles={openFiles}
              activeFile={activeFile}
              onOpenFile={handleOpenFile}
              onCloseFile={handleCloseFile}
              onToast={showToast}
              onSaveFile={handleSaveFile}
              onMarkDirty={handleMarkFileDirty}
              onAddIdeTerminal={handleAddIdeTerminal}
              onRemoveIdeTerminal={handleRemoveIdeTerminal}
              onSetProjectPath={(path) => activeWorkspace && handleSetProjectPath(activeWorkspace.id, path)}
            />
          )}
          {view === 'workspace' && (
            <WorkspaceView
              activeWorkspace={activeWorkspace}
              workspaces={visibleWorkspaces}
              terminals={unifiedTerminals}
              tokenUsage={sidecarTokenUsage}
              focusedTerminal={focusedTerminal}
              viewMode={viewMode}
              gotoNonce={gotoNonce}
              onSelectWorkspace={setActiveWsId}
              onSelectTerminal={setFocusedTerminal}
              onSetViewMode={setViewMode}
              onSetGotoNonce={setGotoNonce}
              onToast={showToast}
              onSetProjectPath={handleSetProjectPath}
              onAddPane={handleAddPane}
              onRemovePane={handleRemovePane}
              onDropToTerminal={handleDropToTerminal}
              dropChips={dropChips}
              onDismissChip={handleDismissChip}
              onClearChips={handleClearChips}
              onRenameTerminal={handleRenameTerminalDirect}
              onReorderPanes={handleReorderPanes}
            />
          )}
          {view === 'grid' && (
            <GridView
              activeWorkspace={activeWorkspace}
              workspaces={visibleWorkspaces}
              terminals={unifiedTerminals}
              expandedPane={expandedPane}
              selectedPane={selectedPane}
              focusedTerminal={focusedTerminal}
              onSelectTerminal={setFocusedTerminal}
              onExpandPane={setExpandedPane}
              onSelectPane={setSelectedPane}
              onToast={showToast}
              onOpenFile={handleOpenFile}
              onRemovePane={handleRemovePane}
              onReorderPanes={handleReorderPanes}
              onDropToTerminal={handleDropToTerminal}
              onRenameTerminal={handleRenameTerminalDirect}
              onAddPane={handleAddPane}
              onSetPaneSizeMode={handleSetPaneSizeMode}
              onSetWorkspaceTemplate={(tpl) => activeWorkspace && handleSetWorkspaceTemplate(activeWorkspace.id, tpl)}
              onSetWorkspaceLayoutMode={(mode) => activeWorkspace && handleSetWorkspaceLayoutMode(activeWorkspace.id, mode)}
            />
          )}
          {view === 'wizard' && (
            <WizardView
              onCreate={handleCreateWorkspace}
              onClose={() => setView('workspace')}
            />
          )}
          {view === 'kanban' && (
            <KanbanView
              workspaces={visibleWorkspaces}
              activeId={activeWsId}
              terminals={unifiedTerminals}
              onToast={showToast}
            />
          )}
          {view === 'cards' && (
            <CardsView
              workspaces={visibleWorkspaces}
              terminals={unifiedTerminals}
              activeId={activeWsId}
              onToast={showToast}
            />
          )}
          {view === 'planner' && (
            <PlannerView
              workspaces={visibleWorkspaces}
              terminals={unifiedTerminals}
              activeId={activeWsId}
              onToast={showToast}
            />
          )}
          {view === 'agent' && (
            <AgentView
              projectPath={activeWorkspace?.projectPath}
              workspaces={visibleWorkspaces}
              terminals={unifiedTerminals}
              activeId={activeWsId}
              onToast={showToast}
            />
          )}
          {view === 'devices' && (
            <DevicesView onToast={showToast} />
          )}
          {view === 'colab' && (
            <ErrorBoundary viewName="Colab" onResetView={() => setView('workspace')}>
              <Suspense fallback={<div style={{ color: t.colors.text.muted, fontSize: 12, padding: 12 }}>Loading Colab…</div>}>
                <ColabView workspaces={workspaces} />
              </Suspense>
            </ErrorBoundary>
          )}
          {view === 'django-reviewer' && (
            <DjangoView />
          )}
          {view === 'settings' && (
            <SettingsView
              onView={handleSetView}
              onToast={showToast}
              connected={connected}
              workspaces={visibleWorkspaces}
              terminals={unifiedTerminals}
              previousView={previousViewRef.current}
            />
          )}
        </main>
      </div>
      <FileEditorPopup
        open={editorPopupOpen && view !== 'ide'}
        openFiles={openFiles}
        activeFile={activeFile}
        onSelectFile={handleOpenFile}
        onCloseFile={handleCloseFile}
        onSaveFile={handleSaveFile}
        onMarkDirty={handleMarkFileDirty}
        onClose={() => setEditorPopupOpen(false)}
        onToast={showToast}
      />

      <CallOverlay terminals={unifiedTerminals} />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 10px 8px 14px',
            borderRadius: 8,
            background: toast.error ? (t.colors.danger?.primary || '#e5484d') : t.colors.accent.primary,
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)',
            zIndex: 9999,
            maxWidth: '90vw',
          }}
        >
          <span style={{ userSelect: 'none', lineHeight: 1.4 }}>{toast.msg}</span>
          <button
            onClick={dismissToast}
            aria-label="Close notification"
            title="Dismiss notification"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.8)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
