import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '@/lib/workspace';
import { templateLabel } from '@/lib/workspace';
import type { TerminalEntry, Task, UnifiedTerminal } from '../types';
import {
  addTask,
  completeTask,
  fetchModels,
  setTerminalModel,
  setTerminalAppliedModel,
  suggestTask,
  acceptSuggestion,
  dismissSuggestion,
  waitForOpencodeBoot,
  type AvailableModel,
} from '../api/client';
import { formatTokens, isClosed, termName } from '../lib/format';
import { parseMentions, type MentionTerminal } from '../lib/tags';
import { permGuard } from '../lib/permGuard';
import { StatusBadge } from './StatusBadge';
import { TaskInput, type TaskMention } from './TaskInput';
import { WireOverlay, type WireConnection } from './WireOverlay';
import { isTauri, tauri } from '@/lib/tauri';
import { isPermEnabled } from '../lib/permissions';

interface Props {
  workspaces: Workspace[];
  terminals: Record<string, TerminalEntry>;
  activeId: string;
  onToast: (msg: string, isError?: boolean) => void;
  /** Optional wiring (existing flows) — attach/open a terminal into a pane. */
  attachableSessions?: { id: string; label: string }[];
  onAttach?: (wsId: string, paneId: string, sessionId: string) => void;
  onOpenNew?: (wsId: string, paneId: string) => void;
  onCreate?: () => void;
}

interface Resolved {
  tty: string;
  entry: UnifiedTerminal;
}

/** pane.tty stores the Rust session id (or the tty itself). Resolve it back
 *  to a unified terminal entry: match by key first, then by session_id. */
function resolveTerminal(
  terminals: Record<string, TerminalEntry>,
  paneTty: string | null,
): Resolved | null {
  if (!paneTty) return null;
  const byKey = terminals[paneTty];
  if (byKey) return { tty: paneTty, entry: byKey as UnifiedTerminal };
  for (const [tty, entry] of Object.entries(terminals)) {
    if ((entry as UnifiedTerminal).session_id === paneTty)
      return { tty, entry: entry as UnifiedTerminal };
  }
  return null;
}

function fmtAge(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function excerpt(s: string, max = 46): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Sidebar status label for a terminal. */
function sideStatus(t: UnifiedTerminal): { text: string; kind: string } {
  if (isClosed(t)) return { text: 'CLOSED', kind: 'closed' };
  const over = ['done', 'cancelled', 'blocked'];
  if (t.current_task?.status === 'running') return { text: 'RUNNING', kind: 'running' };
  if (t.current_task && !over.includes(t.current_task.status))
    return { text: 'WAITING', kind: 'waiting' };
  if (t.next_task || (t.queue || []).length > 0) return { text: 'WAITING', kind: 'waiting' };
  return { text: 'IDLE', kind: 'idle' };
}

export function WorkspaceTaskCenter({
  workspaces,
  terminals,
  activeId,
  onToast,
  attachableSessions = [],
  onAttach,
  onOpenNew,
  onCreate,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(activeId || workspaces[0]?.id || '');

  // Available models for the per-terminal selector (from `opencode models`).
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [applying, setApplying] = useState<string | null>(null); // tty mid explicit restart

  // Which pane is selected in the master list (detail panel follows it).
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);

  // --- Wire overlay: sidebar item refs + pending mentions ---
  const sideContainerRef = useRef<HTMLDivElement>(null);
  const sideListRef = useRef<HTMLDivElement>(null);
  const sideItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const setSideItemRef = useCallback(
    (paneId: string) => (el: HTMLButtonElement | null) => {
      if (el) sideItemRefs.current.set(paneId, el);
      else sideItemRefs.current.delete(paneId);
    },
    [],
  );
  const [pendingMentionTtys, setPendingMentionTtys] = useState<string[]>([]);

  // --- Interactive wire connections (user-drawn, persisted per workspace) ---
  const [wireSource, setWireSource] = useState<string | null>(null);
  // Initialize empty — load from localStorage in useEffect to avoid dual-read divergence
  const [wires, setWires] = useState<WireConnection[]>([]);
  // GUARD: the persist effect fires on mount with wires=[] BEFORE the load
  // effect runs, overwriting the saved wires for this workspace with [] —
  // wires then "vanish" every time the user switches tabs (component remount).
  // Skip the first persist per workspace until the load has landed.
  const wiresLoadedFor = useRef<string | null>(null);

  // Persist wires per workspace
  useEffect(() => {
    if (wiresLoadedFor.current !== activeId) return; // not loaded yet — don't wipe
    localStorage.setItem(`tto-wires-${activeId}`, JSON.stringify(wires));
  }, [wires, activeId]);

  // Load wires when switching workspace
  useEffect(() => {
    try {
      setWires(JSON.parse(localStorage.getItem(`tto-wires-${activeId}`) || '[]'));
    } catch {
      setWires([]);
    }
    wiresLoadedFor.current = activeId;
  }, [activeId]);

  /** Handle endpoint click: first click = select source, second click = create wire. */
  const handleEndpointClick = useCallback(
    (paneId: string) => {
      if (!wireSource) {
        // First click — select source
        setWireSource(paneId);
      } else if (wireSource === paneId) {
        // Clicked same — deselect
        setWireSource(null);
      } else {
        // Second click — create wire
        const exists = wires.some(
          (w) =>
            (w.from === wireSource && w.to === paneId) ||
            (w.from === paneId && w.to === wireSource),
        );
        if (!exists) {
          const WIRE_COLORS = [
            '#4a9eff',
            '#c084fc',
            '#4ade80',
            '#fb923c',
            '#f472b6',
            '#22d3ee',
            '#facc15',
            '#f87171',
          ];
          setWires((prev) => [
            ...prev,
            { from: wireSource, to: paneId, color: WIRE_COLORS[prev.length % WIRE_COLORS.length] },
          ]);
          onToast(`⚡ Wire connected: ${wireSource} ↔ ${paneId}`);
        } else {
          // Remove existing wire
          setWires((prev) =>
            prev.filter(
              (w) =>
                !(
                  (w.from === wireSource && w.to === paneId) ||
                  (w.from === paneId && w.to === wireSource)
                ),
            ),
          );
          onToast(`🔌 Wire disconnected: ${wireSource} ↔ ${paneId}`);
        }
        setWireSource(null);
      }
    },
    [wireSource, wires, onToast],
  );

  /** Get all terminals connected to a given pane (direct wire links). */
  const getWiredTerminals = useCallback(
    (paneId: string): string[] => {
      const connected = new Set<string>();
      for (const w of wires) {
        if (w.from === paneId) connected.add(w.to);
        if (w.to === paneId) connected.add(w.from);
      }
      return Array.from(connected);
    },
    [wires],
  );

  /** OPTIMISTIC per-tty model selections: written synchronously when the
   *  user picks a model in the dropdown, BEFORE the PATCH + broadcast round-
   *  trip lands. `modelFor()` reads this first so EVERY task sent from the
   *  Task Center carries the model the user JUST chose — without it, a task
   *  sent right after picking a model raced the async state update, got
   *  created with model '', and was typed into the running CLI instead of
   *  restarting it on the selected model. */
  const modelOverrideRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetchModels()
      .then((d) => {
        if (cancelled) return;
        setModels(d.models);
        setRecent(d.recent);
      })
      .catch(() => onToast('Failed to load available models', true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Persist the selected model AND make the pick visible immediately: after
   *  saving, restart the running agent on it (the same flow "Apply now" uses)
   *  whenever an opencode agent is actually live on that terminal. A dropdown
   *  pick that silently did nothing read as "not selecting" — now the agent
   *  visibly switches and the toast says so. Saving with no agent running
   *  still just saves (applied on next delivery, as before). */
  const applyModel = async (tty: string, model: string) => {
    if (applying) return;
    // Optimistic: record locally NOW so the next task (even one sent this
    // tick) carries this model, no matter how slow the PATCH round-trip is.
    modelOverrideRef.current[tty] = (model || '').trim();
    try {
      await setTerminalModel(tty, model);
    } catch {
      // The save failed — don't let the optimistic override lie forever.
      delete modelOverrideRef.current[tty];
      onToast('Failed to save model', true);
      return;
    }
    // No model picked ("Default") → clear and stop; nothing to restart.
    if (!model) {
      onToast('Model cleared (default) — next delivery uses the default');
      return;
    }
    // Agent live on this terminal? Restart it on the new model now.
    const entry = terminals[tty] as UnifiedTerminal | undefined;
    const sid = entry?.session_id;
    const opencodeRunning =
      (entry as unknown as { opencode_running?: boolean })?.opencode_running ?? !!entry?.agent;
    if (!isTauri() || !sid || sid === tty || !opencodeRunning) {
      onToast(`Model saved: ${model} — applies on the next task delivered to ${tty}`);
      return;
    }
    onToast(`Model saved: ${model} — restarting agent on it…`);
    await applyNow(tty, model);
  };

  /** EXPLICIT "Apply now": restart the running agent on the terminal's
   *  selected model immediately.  Unlike the dropdown (which just saves —
   *  tasks apply the model on delivery), this is the user's deliberate
   *  action, so a clean /exit → `opencode -m <model>` restart is expected. */
  const applyNow = async (tty: string, model: string) => {
    if (applying) return;
    const entry = terminals[tty] as UnifiedTerminal | undefined;
    const sid = entry?.session_id;
    // Prefer the backend's process-scan truth (opencode_running); fall back to
    // the agent label for older payloads.
    const opencodeRunning =
      (entry as unknown as { opencode_running?: boolean })?.opencode_running ?? !!entry?.agent;
    // Browser / non-Rust terminals: the model applies on next task delivery.
    if (!isTauri() || !sid || sid === tty || !model) {
      onToast(
        model
          ? `Model ${model} saved — applies on the next task delivered to ${tty}`
          : 'Default model — applies on the next task delivered',
      );
      return;
    }
    setApplying(tty);
    try {
      if (!isPermEnabled('terminalExec')) {
        onToast('Terminal execution is disabled in Settings → Permissions', true);
        return;
      }
      const oldPid = (entry as unknown as { opencode_pid?: number })?.opencode_pid || 0;
      if (!opencodeRunning) {
        // No agent yet — just launch opencode on the model.
        await tauri.sendCommand(sid, `opencode -m ${model}`);
      } else {
        await tauri.sendCommand(sid, '/exit');
        await new Promise((r) => setTimeout(r, 4000)); // MCP teardown ~2-3 s
        await tauri.sendCommand(sid, `opencode -m ${model}`);
      }
      // Wait for the fresh opencode (NEW pid) to actually boot before declaring
      // success — a fixed sleep could report "restarted" while the CLI is still
      // booting (or never came up after the /exit).
      const booted = await waitForOpencodeBoot(tty, oldPid, 30000);
      if (!booted) {
        // The requested model failed to launch (bad key / provider config).
        // NEVER leave the terminal dead — restore the CLI with a BARE launch
        // so the user keeps their opencode, and tell them the model didn't
        // come up instead of silently killing their agent.
        console.warn(`[tto] model ${model} failed to launch on ${sid} — restoring bare opencode`);
        await tauri.sendCommand(sid, 'opencode');
        const restored = await waitForOpencodeBoot(tty, oldPid, 20000);
        if (restored) {
          onToast(`Model ${model} could not start — restored your opencode (default model)`, true);
        } else {
          onToast(
            `Model ${model} could not start and opencode did not come back up — check ${tty}`,
            true,
          );
        }
      } else {
        onToast(opencodeRunning ? `Agent restarted on ${model}` : `opencode launched on ${model}`);
        // Record the model the agent now runs on so the delivery watcher skips
        // the /exit → relaunch dance for the next task that uses this model.
        void setTerminalAppliedModel(entry.tty, model);
      }
    } catch {
      onToast(`Model saved (${model}); restart the agent manually to apply`, true);
    } finally {
      setApplying(null);
    }
  };

  // Follow the active workspace ONLY when it changes (tab switch) — manual
  // dropdown selections stay put. Without this, the effect would revert every
  // manual pick back to activeId on the next render.
  useEffect(() => {
    if (activeId && workspaces.some((w) => w.id === activeId)) {
      setSelectedId(activeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Fall back to the first workspace if the current selection disappears
  // (e.g. the selected workspace was closed).
  useEffect(() => {
    if (!workspaces.some((w) => w.id === selectedId)) {
      setSelectedId(workspaces[0]?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, activeId]);

  const ws = workspaces.find((w) => w.id === selectedId) || null;

  // Group all available models by provider (recently used pinned on top).
  const groups = useMemo(() => {
    const byProvider = new Map<string, AvailableModel[]>();
    for (const m of models) {
      const arr = byProvider.get(m.provider) || [];
      arr.push(m);
      byProvider.set(m.provider, arr);
    }
    const recents = recent.filter((k) => models.some((m) => m.key === k));
    const providers = Array.from(byProvider.keys()).sort();
    return { recents, providers, byProvider };
  }, [models, recent]);

  const resolved = useMemo(() => {
    if (!ws) return [];
    return ws.panes.map((pane, i) => ({
      num: i + 1,
      paneId: pane.id,
      pane,
      res: resolveTerminal(terminals, pane.tty),
    }));
  }, [ws, terminals]);

  // Selection: keep it on the current pane when the workspace changes; fall
  // back to the first pane if the selection disappears.
  useEffect(() => {
    setSelectedPaneId((cur) => {
      if (!ws) return null;
      if (cur && ws.panes.some((p) => p.id === cur)) return cur;
      return ws.panes[0]?.id || null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, ws?.panes.length]);

  const selected = resolved.find((r) => r.paneId === selectedPaneId) || resolved[0] || null;
  const liveCount = resolved.filter((r) => r.res && !isClosed(r.res.entry)).length;

  /** Extract wire connections from terminal task history. When terminal B
   *  receives a task with `[linked from terminal A]`, we draw a wire A→B. */
  const wireConnections = useMemo(() => {
    const conns: WireConnection[] = [];
    const seen = new Set<string>();

    // 1. User-drawn wires (primary — from clicking endpoints)
    for (const w of wires) {
      const key = `${w.from}->${w.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        conns.push({ ...w });
      }
    }

    // 2. Pending @mentions: temporary wires while typing
    if (pendingMentionTtys.length >= 2) {
      const mentionPanes = pendingMentionTtys
        .map((tty) => {
          return resolved.find((r) => r.res?.tty === tty || r.res?.entry?.session_id === tty);
        })
        .filter(Boolean) as typeof resolved;
      for (let i = 0; i < mentionPanes.length - 1; i++) {
        const fromPane = mentionPanes[i];
        const toPane = mentionPanes[i + 1];
        if (fromPane && toPane && fromPane.paneId !== toPane.paneId) {
          const key = `${fromPane.paneId}->${toPane.paneId}`;
          if (!seen.has(key)) {
            seen.add(key);
            conns.push({
              from: fromPane.paneId,
              to: toPane.paneId,
              label: 'pending',
              color: '#c084fc',
            });
          }
        }
      }
    }

    return conns;
  }, [wires, resolved, pendingMentionTtys]);

  /** Mention terminals for @tag autocomplete — every terminal in this workspace. */
  const mentionTerms: MentionTerminal[] = resolved
    .map((r) => r.res && r.res.entry)
    .filter(Boolean)
    .map((e) => ({
      tty: (e as UnifiedTerminal).tty,
      name: termName(e as UnifiedTerminal),
    }));

  const taskMentions: TaskMention[] = resolved
    .map((r) => r.res && r.res.entry)
    .filter(Boolean)
    .map((e) => {
      const u = e as UnifiedTerminal;
      return { tty: u.tty, name: termName(u), label: termName(u) };
    });

  /**
   * Send a task, honoring @terminal mentions: if the text tags one or more
   * terminals the task is routed to EACH tagged terminal (linking them),
   * carrying provenance when the source differs from the target.
   */
  const sendTask = async (tty: string, desc: string) => {
    const { targets, clean } = parseMentions(desc, mentionTerms);
    if (targets.length > 0) {
      let ok = 0;
      for (const t of targets) {
        let finalDesc = clean || desc;
        if (t.tty !== tty && t.tty !== selectedRes?.tty) {
          finalDesc = `${clean ? clean + '\n' : ''}[linked from ${mentionLabel(tty)}]`.trim();
        }
        try {
          await addTask(t.tty, finalDesc, modelFor(t.tty));
          ok++;
        } catch {
          /* keep going */
        }
      }
      onToast(
        ok > 0
          ? `@${targets.map((t) => t.label).join(' @')} — task sent to ${ok} terminal(s), linked`
          : 'Failed to send tagged task',
        ok === 0,
      );
      return;
    }
    // Send to target terminal
    try {
      await addTask(tty, desc, modelFor(tty));
    } catch (e) {
      onToast('Failed to add task: ' + (e as Error).message, true);
      return;
    }
    // Also send to all wired terminals (automatic routing through wires)
    const wired = getWiredTerminals(resolved.find((r) => r.res?.tty === tty)?.paneId || '');
    let wiredOk = 0;
    for (const wiredPaneId of wired) {
      const wiredRes = resolved.find((r) => r.paneId === wiredPaneId);
      if (wiredRes?.res?.tty && wiredRes.res.tty !== tty) {
        try {
          await addTask(
            wiredRes.res.tty,
            `${desc}\n[routed via wire from ${mentionLabel(tty)}]`,
            modelFor(wiredRes.res.tty),
          );
          wiredOk++;
        } catch {
          /* keep going */
        }
      }
    }
    const wiredInfo = wiredOk > 0 ? ` + ${wiredOk} wired` : '';
    onToast(`⚡ Task sent to ${tty}${wiredInfo}`);
  };

  /** Human label for a tty (name · tty) for provenance notes. */
  const mentionLabel = (tty: string) => {
    const e = resolved.find((r) => r.res?.tty === tty)?.res?.entry;
    const u = e as UnifiedTerminal | undefined;
    return u ? termName(u) : tty;
  };

  /** The terminal's currently selected model — pinned onto every task so the
   *  delivery path applies it (restarting opencode on it exactly once via the
   *  watcher's appliedModelRef, then reusing the running CLI).
   *
   *  The optimistic override wins: it is written synchronously on dropdown
   *  change, so a task sent immediately after picking a model STILL carries
   *  that model (no async-broadcast race). Falls back to the broadcast state. */
  const modelFor = (tty: string): string => {
    const ov = modelOverrideRef.current[tty];
    if (ov !== undefined) return ov;
    const e = resolved.find((r) => r.res?.tty === tty)?.res?.entry;
    const u = e as UnifiedTerminal | undefined;
    return u?.model || '';
  };

  const handleBulk = async (desc: string) => {
    const { targets, clean } = parseMentions(desc, mentionTerms);
    // @-tagged task overrides broadcast: route to the tagged terminals only.
    if (targets.length > 0) {
      let ok = 0;
      for (const t of targets) {
        try {
          await addTask(t.tty, clean || desc, modelFor(t.tty));
          ok++;
        } catch {
          /* keep going */
        }
      }
      onToast(
        ok > 0
          ? `@${targets.map((t) => t.label).join(' @')} — tagged task sent to ${ok} terminal(s)`
          : 'Failed to send tagged task',
        ok === 0,
      );
      return;
    }
    const targetsLive = resolved.filter((r) => r.res && !isClosed(r.res.entry));
    if (targetsLive.length === 0) {
      onToast('No live terminals in this workspace', true);
      return;
    }
    let ok = 0;
    for (const t of targetsLive) {
      try {
        await addTask(t.res!.tty, desc, modelFor(t.res!.tty));
        ok++;
      } catch {
        /* keep going */
      }
    }
    onToast(
      ok > 0
        ? `Task sent to ${ok}/${targetsLive.length} terminals in "${ws?.name}"`
        : 'Failed to send tasks',
      ok === 0,
    );
  };

  // ── Completion → summary + suggested next task ──────────────────────────
  // Track per-terminal which completed task we already suggested for, and
  // which completions the user dismissed, so the panel shows exactly once.
  const suggestedForRef = useRef<Record<string, string>>({});
  const dismissedForRef = useRef<Record<string, string>>({});
  const [suggesting, setSuggesting] = useState(false);

  const lastDone = (tty: string): Task | null => {
    const e = resolved.find((r) => r.res?.tty === tty)?.res?.entry;
    const u = e as UnifiedTerminal | undefined;
    if (!u || !u.history || u.history.length === 0) return null;
    for (let i = u.history.length - 1; i >= 0; i--) {
      const h = u.history[i];
      if (h.status === 'done') return h;
    }
    return null;
  };

  /** Auto-suggest the next task the moment a new completion lands. */
  const handleAutoSuggest = async (tty: string) => {
    const done = lastDone(tty);
    if (!done) return;
    if (dismissedForRef.current[tty] === done.id) return;
    if (suggestedForRef.current[tty] === done.id) return;
    suggestedForRef.current[tty] = done.id;
    setSuggesting(true);
    try {
      const r = await suggestTask(tty);
      if (!r.suggestion) suggestedForRef.current[tty] = '';
    } catch {
      suggestedForRef.current[tty] = '';
    } finally {
      setSuggesting(false);
    }
  };

  const handleAcceptSug = async (tty: string) => {
    try {
      await acceptSuggestion(tty);
      const done = lastDone(tty);
      if (done) dismissedForRef.current[tty] = done.id;
      onToast(`Suggestion accepted on ${tty} — next task queued`);
    } catch {
      onToast('Failed to accept suggestion', true);
    }
  };

  const handleDismissSug = async (tty: string) => {
    try {
      await dismissSuggestion(tty);
      const done = lastDone(tty);
      if (done) dismissedForRef.current[tty] = done.id;
    } catch {
      /* ignore */
    }
  };

  const handleDone = async (tty: string, taskId: string) => {
    const summary = window.prompt('Task summary (what was done?):');
    if (summary === null) return;
    try {
      await completeTask(tty, taskId, summary);
      onToast(`Task completed on ${tty}`);
    } catch {
      onToast('Failed to complete task', true);
    }
  };

  /** Attach/open into a target pane using the existing flows. */
  const handleAttachChange = (paneId: string, val: string) => {
    if (!ws) return;
    if (val.startsWith('attach:')) onAttach?.(ws.id, paneId, val.slice(7));
    else if (val === 'open') onOpenNew?.(ws.id, paneId);
  };

  const firstEmptyPane = resolved.find((r) => !r.res) || null;

  const renderModelSelect = (tty: string, model: string | undefined) => {
    // Show the optimistic pick immediately (never snap back pre-broadcast).
    const shown =
      modelOverrideRef.current[tty] !== undefined ? modelOverrideRef.current[tty] : model || '';
    return (
      <span className="tcm-model-row">
        <select
          className="tcm-model"
          value={shown}
          disabled={applying === tty}
          title={`Model for ${tty}${applying === tty ? ' — restarting agent…' : ''}`}
          onChange={(e) => applyModel(tty, e.target.value)}
        >
          <option value="">Default</option>
          {groups.recents.length > 0 && (
            <optgroup label="Recently used">
              {groups.recents.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </optgroup>
          )}
          {groups.providers.map((p) => (
            <optgroup key={p} label={p}>
              {groups.byProvider.get(p)!.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.key}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {shown && (
          <button
            className="tcm-apply"
            disabled={applying === tty}
            title={`Restart the running agent on ${shown} now`}
            onClick={() => applyNow(tty, shown)}
          >
            {applying === tty ? '⏳' : 'Apply now'}
          </button>
        )}
      </span>
    );
  };

  const selectedRes = selected?.res ?? null;
  const selectedEntry = selectedRes?.entry ?? null;
  const selectedClosed = selectedEntry ? isClosed(selectedEntry) : false;
  const selectedLabel = selectedEntry
    ? `${termName(selectedEntry)}${selectedEntry.session_id && selectedEntry.session_id !== selectedRes!.tty ? ` · ${selectedRes!.tty}` : ''}`
    : '';

  // Fire auto-suggest when the selected terminal's last task completes.
  // Must run unconditionally before any early returns to satisfy the Rules of Hooks.
  useEffect(() => {
    if (!ws || !selectedRes) return;
    const u = selectedRes.entry;
    if (!u) return;
    const done = lastDone(selectedRes.tty);
    if (!done) return;
    if (dismissedForRef.current[selectedRes.tty] === done.id) return;
    if (suggestedForRef.current[selectedRes.tty] === done.id) return;
    const id = done.id;
    const timer = setTimeout(() => {
      suggestedForRef.current[selectedRes.tty] = id;
      setSuggesting(true);
      suggestTask(selectedRes.tty)
        .then((r) => {
          if (!r.suggestion) suggestedForRef.current[selectedRes.tty] = '';
          setSuggesting(false);
        })
        .catch(() => {
          suggestedForRef.current[selectedRes.tty] = '';
          setSuggesting(false);
        });
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ws?.id,
    selectedRes?.tty,
    selectedRes?.entry?.history?.length,
    selectedRes?.entry?.current_task?.status,
  ]);

  /* ---------------- no workspaces ---------------- */
  if (!ws) {
    return (
      <div className="tcm-empty-full">
        <div className="tcm-empty-icon">◫</div>
        <div className="tcm-empty-title">NO WORKSPACES</div>
        <div className="tcm-empty-sub">
          Create a workspace to assign tasks
          <br />
          and manage your AI terminals.
        </div>
        {onCreate && (
          <button className="tcm-btn-primary" onClick={onCreate}>
            + Create Workspace
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="tcm">
      {/* ── Top header: brand + workspace control ── */}
      <div className="tcm-header">
        <div className="tcm-brand">
          <span className="logo">tto</span>
          <div className="tcm-brand-text">
            <span className="tcm-brand-title">TTO</span>
            <span className="tcm-brand-sub">CURRENT TASK CENTER</span>
          </div>
        </div>
        <div className="tcm-ws-control">
          <select
            className="tcm-ws-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            title="Switch workspace"
          >
            {workspaces.map((w) => {
              const live = w.panes.filter((p) => {
                const r = resolveTerminal(terminals, p.tty);
                return r && !isClosed(r.entry);
              }).length;
              return (
                <option key={w.id} value={w.id}>
                  {w.name} — {live} live · {templateLabel(w.template)}
                </option>
              );
            })}
          </select>
          <span
            className="tcm-ws-dot"
            style={{ background: ws.color }}
            title={`${ws.name} color`}
          />
        </div>
        <div className="tcm-live-badge">
          <span className="tcm-live-dot" />
          <span className="tcm-live-num">{liveCount}</span>
          <span className="tcm-live-label">LIVE</span>
        </div>
        {ws.projectPath && (
          <span className="tcm-path" title={ws.projectPath}>
             {ws.projectPath}
          </span>
        )}
      </div>

      {/* ── Global task command bar ── */}
      <div className="tcm-global">
        <TaskInput
          className="tcm-global-input"
          placeholder={`What should all ${liveCount} live agent${liveCount === 1 ? '' : 's'} work on?  (@terminal tags route instead)`}
          buttonLabel="SEND TO ALL →"
          mentions={taskMentions}
          onEnter={handleBulk}
          onMentionsChange={setPendingMentionTtys}
        />
        <div className="tcm-global-targets">
          Targets{' '}
          <span className="tcm-global-live">
            {liveCount} live terminal{liveCount === 1 ? '' : 's'}
          </span>{' '}
          in this workspace — type <span className="tcm-global-live">@terminal</span> to tag & link
          a specific one
        </div>
        {isTauri() && (
          <div className="tcm-ego-hint">
            💡 Agents can use shell commands, APIs, and local tools — add specific instructions to
            trigger actions
          </div>
        )}
      </div>

      {/* ── Split view: sidebar + detail ── */}
      <div className="tcm-body">
        {/* left: terminal sidebar */}
        <div ref={sideContainerRef} className="tcm-side" style={{ position: 'relative' }}>
          <WireOverlay
            containerRef={sideContainerRef}
            scrollRef={sideListRef}
            connections={wireConnections}
            itemRefs={sideItemRefs.current}
            wireSource={wireSource}
            onEndpointClick={handleEndpointClick}
          />
          <div className="tcm-side-title">
            <span>TERMINALS</span>
            <span className="tcm-side-count">
              {liveCount} / {resolved.length} ACTIVE
            </span>
          </div>
          {wireSource && (
            <div className="wire-connecting-hint">
              🔌 Click another terminal to connect — or click {wireSource} again to cancel
            </div>
          )}
          <div ref={sideListRef} className="tcm-side-list">
            {resolved.map(({ num, paneId, res }) => {
              const entry = res?.entry ?? null;
              const closed = entry ? isClosed(entry) : false;
              const st = entry ? sideStatus(entry) : { text: 'EMPTY', kind: 'empty' };
              const label = entry
                ? `${termName(entry)}${entry.session_id && entry.session_id !== res!.tty ? ` · ${res!.tty}` : ''}`
                : 'empty';
              const short =
                entry?.current_task &&
                !['done', 'cancelled', 'blocked'].includes(entry.current_task.status)
                  ? entry.current_task.description
                  : entry?.next_task?.description || (entry ? '' : 'No terminal attached');
              return (
                <button
                  key={paneId}
                  ref={setSideItemRef(paneId)}
                  className={`tcm-side-item ${paneId === selected?.paneId ? 'selected' : ''} ${closed ? 'closed' : ''} ${entry ? '' : 'empty'} ${wireConnections.some((c) => c.from === paneId || c.to === paneId) ? 'wire-connected' : ''}`}
                  onClick={() => setSelectedPaneId(paneId)}
                  title={entry ? `${label} — click to view` : 'Empty pane — click to view'}
                >
                  <span className="tcm-side-num">{pad(num)}</span>
                  <span className="tcm-side-main">
                    <span className="tcm-side-name">{label}</span>
                    <span className="tcm-side-task">
                      {entry ? excerpt(short || 'Idle') : 'Empty pane'}
                    </span>
                  </span>
                  <span className={`tcm-side-status ${st.kind}`}>
                    <span className="tcm-side-led" />
                    {st.text}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="tcm-side-foot">
            {firstEmptyPane ? (
              <select
                className="tcm-attach"
                value=""
                onChange={(e) => {
                  if (e.target.value) handleAttachChange(firstEmptyPane.paneId, e.target.value);
                }}
                title="Attach a terminal to the first empty pane"
              >
                <option value="">+ Attach terminal…</option>
                {attachableSessions.map((s) => (
                  <option key={`at-${s.id}`} value={`attach:${s.id}`}>
                    🔗 {s.label}
                  </option>
                ))}
                <option value="open">+ Open new terminal</option>
              </select>
            ) : (
              <div className="tcm-side-none">All panes attached</div>
            )}
          </div>
        </div>

        {/* right: selected terminal detail */}
        <div className="tcm-detail">
          {!selectedRes ? (
            <div className="tcm-pane-empty">
              <div className="tcm-pane-empty-icon">+</div>
              <div className="tcm-pane-empty-title">EMPTY PANE</div>
              <div className="tcm-pane-empty-sub">
                Attach a terminal to this workspace
                <br />
                to start assigning tasks.
              </div>
              {attachableSessions.length > 0 ? (
                <select
                  className="tcm-attach tcm-attach-lg"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleAttachChange(selected!.paneId, e.target.value);
                  }}
                >
                  <option value="">Attach Terminal</option>
                  {attachableSessions.map((s) => (
                    <option key={`at-${s.id}`} value={`attach:${s.id}`}>
                      🔗 {s.label}
                    </option>
                  ))}
                  <option value="open">+ Open new terminal</option>
                </select>
              ) : (
                onOpenNew && (
                  <button
                    className="tcm-btn-primary"
                    onClick={() => onOpenNew(ws.id, selected!.paneId)}
                  >
                    Attach Terminal
                  </button>
                )
              )}
            </div>
          ) : (
            (() => {
              const se = selectedEntry as UnifiedTerminal;
              return (
                <div className={`tcm-detail-inner ${selectedClosed ? 'closed' : ''}`}>
                  {/* detail header */}
                  <div className="tcm-detail-head">
                    <span className="tcm-detail-tag">TERMINAL {pad(selected!.num)}</span>
                    <span
                      className="tcm-detail-name"
                      title={`${selectedRes.tty} — click to copy`}
                      onClick={() => {
                        const cb = permGuard('clipboard');
                        if (!cb.ok) {
                          onToast(cb.reason, true);
                          return;
                        }
                        navigator.clipboard.writeText(selectedRes.tty).catch(() => {});
                        onToast(`Copied ${selectedRes.tty}`);
                      }}
                    >
                      {selectedLabel}
                      <span className="tcm-copy" title="Copy tty">
                        ⧉
                      </span>
                    </span>
                    {se.agent && <span className="tcm-agent">{se.agent}</span>}
                    {renderModelSelect(selectedRes.tty, se.model)}
                    {applying === selectedRes.tty && (
                      <span className="tcm-applying">⚠ RESTARTING…</span>
                    )}
                    <span className={`tcm-live-pill ${selectedClosed ? '' : 'live'}`}>
                      {selectedClosed ? 'CLOSED' : 'LIVE'}
                    </span>
                  </div>
                  {se.cwd && (
                    <div className="tcm-detail-cwd" title={se.cwd}>
                       {se.cwd}
                    </div>
                  )}

                  {/* current task — auto-closes when the task is over */}
                  <div className="tcm-sec">
                    <div className="tcm-sec-label">CURRENT TASK</div>
                    {se.current_task &&
                    !['done', 'cancelled', 'blocked'].includes(se.current_task.status) ? (
                      <div className="tcm-card tcm-card-current">
                        <div className="tcm-card-top">
                          <StatusBadge status={se.current_task.status} />
                          {se.current_task.started_at && (
                            <span className="tcm-started">
                              Started{' '}
                              {fmtAge(Math.round(Date.now() / 1000 - se.current_task.started_at))}{' '}
                              ago
                            </span>
                          )}
                        </div>
                        <div className="tcm-card-desc">{se.current_task.description}</div>
                      </div>
                    ) : (
                      (() => {
                        const done = lastDone(selectedRes.tty);
                        const dismissed = done
                          ? dismissedForRef.current[selectedRes.tty] === done.id
                          : false;
                        if (done && !dismissed) {
                          return (
                            <div className="tcm-card tcm-card-done">
                              <div className="tcm-card-top">
                                <span className="tcm-done-badge">✓ TASK COMPLETED</span>
                                {done.completed_at && (
                                  <span className="tcm-started">
                                    Closed{' '}
                                    {fmtAge(Math.round(Date.now() / 1000 - done.completed_at))} ago
                                  </span>
                                )}
                              </div>
                              <div className="tcm-card-desc">{done.description}</div>
                              {done.summary && (
                                <div className="tcm-done-summary">
                                  <b>Summary:</b> {done.summary}
                                </div>
                              )}
                              {/* suggested next task */}
                              <div className="tcm-sec">
                                <div className="tcm-sec-label">SUGGESTED NEXT TASK</div>
                                {suggesting && !se.suggested_task ? (
                                  <div className="tcm-sugg">
                                    <span className="tcm-sugg-spin">⟳</span> Planning next task from
                                    the summary…
                                  </div>
                                ) : se.suggested_task ? (
                                  <div className="tcm-sugg tcm-sugg-ready">
                                    <div className="tcm-sugg-desc">💡 {se.suggested_task}</div>
                                    <div className="tcm-sugg-actions">
                                      <button
                                        className="tcm-sugg-btn ok"
                                        onClick={() => handleAcceptSug(selectedRes.tty)}
                                      >
                                        ✓ USE THIS — PLAN & EXECUTE
                                      </button>
                                      <button
                                        className="tcm-sugg-btn"
                                        onClick={() => handleDismissSug(selectedRes.tty)}
                                      >
                                        ✕ Skip
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="tcm-sugg">
                                    <button
                                      className="tcm-sugg-btn"
                                      onClick={() => handleAutoSuggest(selectedRes.tty)}
                                    >
                                      ⚡ Suggest next task
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return <div className="tcm-card-none">No task running</div>;
                      })()
                    )}
                  </div>

                  {/* next task */}
                  {se.next_task && (
                    <div className="tcm-sec">
                      <div className="tcm-sec-label">NEXT TASK</div>
                      <div className="tcm-card tcm-card-next">
                        <div className="tcm-card-top">
                          <StatusBadge status={se.next_task.status} />
                        </div>
                        <div className="tcm-card-desc">{se.next_task.description}</div>
                      </div>
                    </div>
                  )}

                  {/* queue */}
                  {se.queue && se.queue.length > 0 && (
                    <div className="tcm-sec">
                      <div className="tcm-sec-label">
                        TASK QUEUE <span className="tcm-sec-count">{se.queue.length}</span>
                      </div>
                      <div className="tcm-queue">
                        {se.queue.map((q: Task, i: number) => (
                          <div className="tcm-queue-item" key={q.id}>
                            <span className="tcm-queue-num">{pad(i + 1)}</span>
                            <span className="tcm-queue-desc">{q.description}</span>
                            <StatusBadge status={q.status} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* actions */}
                  <div className="tcm-sec">
                    <TaskInput
                      className="tcm-add"
                      placeholder={`Add a task for ${selectedLabel || `terminal ${pad(selected!.num)}`}…  (@terminal tags link terminals)`}
                      buttonLabel="+ Add"
                      mentions={taskMentions}
                      onEnter={(desc) => sendTask(selectedRes.tty, desc)}
                      onMentionsChange={setPendingMentionTtys}
                    />
                    {se.current_task &&
                      !['done', 'cancelled', 'blocked'].includes(se.current_task.status) && (
                        <button
                          className="tcm-done"
                          onClick={() => handleDone(selectedRes.tty, se.current_task!.id)}
                        >
                          ✓ MARK TASK DONE
                        </button>
                      )}
                  </div>

                  {/* muted metadata footer */}
                  <div className="tcm-meta">
                    <span className="tcm-meta-item">
                      Σ {formatTokens(se.tokens?.tokens_input || 0)} in ·{' '}
                      {formatTokens(se.tokens?.tokens_output || 0)} out
                    </span>
                    {(se.queue || []).length > 0 && (
                      <span className="tcm-meta-item">Queue: {se.queue!.length}</span>
                    )}
                    <span className="tcm-meta-item">{selectedLabel}</span>
                    {se.cwd && <span className="tcm-meta-item tcm-meta-path">{se.cwd}</span>}
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
