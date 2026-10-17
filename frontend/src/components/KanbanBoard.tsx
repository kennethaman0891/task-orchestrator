import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TerminalEntry, UnifiedTerminal, OrchestratorRun, AgentAction } from '../types';
import type { Workspace } from '@/lib/workspace';
import {
  addTask,
  clearOrchestratorRuns,
  compileTodo,
  fetchAgentConfig,
  fetchAgentStatus,
  fetchModels,
  fetchModelLimits,
  getOrchestratorRuns,
  runOrchestrator,
  toggleRunAgent,
  updateAgentConfig,
  type AvailableModel,
  type ModelLimit,
  type TodoCompileResponse,
} from '../api/client';
import type { AgentConfig, AgentStatus } from '../types';
import { isClosed, termName } from '../lib/format';
import { permGuard } from '../lib/permGuard';

interface Props {
  terminals: Record<string, TerminalEntry>;
  onToast: (msg: string, error?: boolean) => void;
  workspaces?: Workspace[];
  activeId?: string;
}

function fmtAge(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

/** Live terminals of a workspace (pane ttys / session ids → terminal entries). */
function workspaceLiveEntries(
  ws: Workspace | null,
  terminals: Record<string, TerminalEntry>,
): UnifiedTerminal[] {
  if (!ws) return [];
  const out: UnifiedTerminal[] = [];
  const all = Object.values(terminals) as UnifiedTerminal[];
  for (const pane of ws.panes) {
    if (!pane.tty) continue;
    const byKey = terminals[pane.tty];
    if (byKey && !isClosed(byKey)) out.push(byKey as UnifiedTerminal);
    else {
      const hit = all.find((t) => t.session_id === pane.tty && !isClosed(t));
      if (hit) out.push(hit);
    }
  }
  return out;
}

/* ============================ AGENT PANEL ============================
 * Expandable panel showing agent config (max retries, stall timeout, etc.),
 * live agent status (loop running, active runs, total actions), and the
 * global enable/disable toggle.  Config edits are persisted immediately.
 * ===================================================================== */
function AgentPanel({ onToast }: { onToast: (msg: string, error?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<AgentConfig>>({});
  const [saving, setSaving] = useState(false);
  const pollRef = useRef(0);

  // Load config + status on mount and when opened
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [cfg, st] = await Promise.all([fetchAgentConfig(), fetchAgentStatus()]);
        if (!cancelled) {
          setConfig(cfg);
          setStatus(st);
        }
      } catch {
        /* silent */
      }
    };
    load();
    // Poll status every 5s while open
    const iv = open ? window.setInterval(() => { pollRef.current++; load(); }, 5000) : undefined;
    return () => { cancelled = true; if (iv) clearInterval(iv); };
  }, [open]);

  const toggleGlobal = async (enabled: boolean) => {
    try {
      const res = await updateAgentConfig({ enabled });
      setConfig(res.config);
      onToast(`Agent ${enabled ? 'enabled' : 'disabled'} globally`);
    } catch {
      onToast('Failed to toggle agent', true);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await updateAgentConfig(draft);
      setConfig(res.config);
      setEditing(false);
      setDraft({});
      onToast('Agent config updated');
    } catch {
      onToast('Failed to save config', true);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    if (!config) return;
    setDraft({
      auto_retry: config.auto_retry,
      max_retries: config.max_retries,
      stall_timeout: config.stall_timeout,
      chain_mode: config.chain_mode,
      synthesis: config.synthesis,
    });
    setEditing(true);
  };

  const st = status;
  const loopOk = st?.loop_running ?? false;
  const totalActions = st?.total_actions ?? 0;
  const agentRuns = st?.agent_runs ?? 0;

  return (
    <div className="agent-panel">
      <button className="agent-panel-toggle" onClick={() => setOpen(!open)}>
        <span className="agent-panel-icon">🤖</span>
        <span className="agent-panel-title">Agent</span>
        <span className={`agent-panel-dot ${loopOk ? 'on' : 'off'}`} />
        {totalActions > 0 && <span className="agent-panel-count">{totalActions} actions</span>}
        <span className="agent-panel-arrow">{open ? '▾' : '▸'}</span>
      </button>

      {open && config && (
        <div className="agent-panel-body">
          {/* Status row */}
          <div className="agent-status-row">
            <span className={`agent-status-badge ${loopOk ? 'live' : 'off'}`}>
              {loopOk ? '● loop active' : '○ loop stopped'}
            </span>
            {st && (
              <>
                <span className="agent-status-stat">{st.active_runs} run{st.active_runs !== 1 ? 's' : ''}</span>
                <span className="agent-status-stat">{agentRuns} agent</span>
                <span className="agent-status-stat">{totalActions} total actions</span>
              </>
            )}
          </div>

          {/* Global toggle */}
          <label className="agent-panel-row">
            <span className="agent-panel-label">Global enable</span>
            <button
              className={`agent-switch ${config.enabled ? 'on' : ''}`}
              onClick={() => toggleGlobal(!config.enabled)}
            >
              <span className="agent-switch-knob" />
            </button>
          </label>

          {/* Config controls (read-only or editing) */}
          <div className="agent-config">
            <div className="agent-config-header">
              <span className="agent-config-title">Configuration</span>
              {!editing ? (
                <button className="agent-config-edit" onClick={startEdit}>✎ Edit</button>
              ) : (
                <span className="agent-config-editing">
                  <button className="agent-config-save" onClick={saveConfig} disabled={saving}>
                    {saving ? '…' : '✓ Save'}
                  </button>
                  <button className="agent-config-cancel" onClick={() => { setEditing(false); setDraft({}); }}>
                    ✕
                  </button>
                </span>
              )}
            </div>
            <div className="agent-config-grid">
              <label className="agent-config-item">
                <span>Auto-retry</span>
                {editing ? (
                  <button
                    className={`agent-switch sm ${(draft.auto_retry ?? config.auto_retry) ? 'on' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, auto_retry: !(d.auto_retry ?? config.auto_retry) }))}
                  >
                    <span className="agent-switch-knob" />
                  </button>
                ) : (
                  <span className={`agent-config-val ${config.auto_retry ? 'on' : ''}`}>
                    {config.auto_retry ? 'on' : 'off'}
                  </span>
                )}
              </label>

              <label className="agent-config-item">
                <span>Max retries</span>
                {editing ? (
                  <input
                    type="number"
                    className="agent-config-input"
                    min={0}
                    max={10}
                    value={draft.max_retries ?? config.max_retries}
                    onChange={(e) => setDraft((d) => ({ ...d, max_retries: parseInt(e.target.value) || 0 }))}
                  />
                ) : (
                  <span className="agent-config-val">{config.max_retries}</span>
                )}
              </label>

              <label className="agent-config-item">
                <span>Stall timeout</span>
                {editing ? (
                  <input
                    type="number"
                    className="agent-config-input"
                    min={30}
                    max={3600}
                    step={30}
                    value={draft.stall_timeout ?? config.stall_timeout}
                    onChange={(e) => setDraft((d) => ({ ...d, stall_timeout: parseInt(e.target.value) || 600 }))}
                  />
                ) : (
                  <span className="agent-config-val">{config.stall_timeout}s</span>
                )}
              </label>

              <label className="agent-config-item">
                <span>Chain mode</span>
                {editing ? (
                  <button
                    className={`agent-switch sm ${(draft.chain_mode ?? config.chain_mode) ? 'on' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, chain_mode: !(d.chain_mode ?? config.chain_mode) }))}
                  >
                    <span className="agent-switch-knob" />
                  </button>
                ) : (
                  <span className={`agent-config-val ${config.chain_mode ? 'on' : ''}`}>
                    {config.chain_mode ? 'on' : 'off'}
                  </span>
                )}
              </label>

              <label className="agent-config-item">
                <span>Auto-summary</span>
                {editing ? (
                  <button
                    className={`agent-switch sm ${(draft.synthesis ?? config.synthesis) ? 'on' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, synthesis: !(d.synthesis ?? config.synthesis) }))}
                  >
                    <span className="agent-switch-knob" />
                  </button>
                ) : (
                  <span className={`agent-config-val ${config.synthesis ? 'on' : ''}`}>
                    {config.synthesis ? 'on' : 'off'}
                  </span>
                )}
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ ORCHESTRATOR ============================
 * A ChatGPT-style chat.  Type ONE goal → it is split into sub-terminals
 * (the terminals currently open in the selected workspace) and each
 * sub-task is dispatched through the SAME pipeline as the Task Center.
 * The conversation shows your goal as a user bubble and the live split
 * cards as the assistant's reply — statuses update in real time.
 * ====================================================================== */
function OrchestratorPanel({
  workspaces,
  terminals,
  activeId,
  onToast,
}: {
  workspaces: Workspace[];
  terminals: Record<string, TerminalEntry>;
  activeId?: string;
  onToast: (msg: string, error?: boolean) => void;
}) {
  const [wsId, setWsId] = useState(activeId || workspaces[0]?.id || '');
  const [taskText, setTaskText] = useState('');
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<OrchestratorRun[]>([]);
  const [pollTick, setPollTick] = useState(0);
  const [splitModel, setSplitModel] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [agentEnabled, setAgentEnabled] = useState(true); // agentic layer toggle
  // Per-terminal model overrides: {tty: modelKey}
  const [terminalModels, setTerminalModels] = useState<Record<string, string>>({});
  // Which terminal's model dropdown is currently open (for single-select UX)
  const [openModelFor, setOpenModelFor] = useState<string | null>(null);
  const chipWrapperRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const prevRunCount = useRef(0);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openModelFor) return;
    const handle = (e: MouseEvent) => {
      if (chipWrapperRef.current && !chipWrapperRef.current.contains(e.target as Node)) {
        setOpenModelFor(null);
      }
    };
    // Use mousedown so it fires before the chip's own click
    document.addEventListener('mousedown', handle, true);
    return () => document.removeEventListener('mousedown', handle, true);
  }, [openModelFor]);

  // Compute dropdown position for portal (fixed positioning to avoid overflow clipping)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!openModelFor) {
      setDropdownPos(null);
      return;
    }
    // Find the chip wrapper element and compute its position
    const el = chipWrapperRef.current?.querySelector(
      `[data-tty="${openModelFor}"]`,
    ) as HTMLElement | null;
    if (!el) {
      setDropdownPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
  }, [openModelFor]);

  // Follow the active workspace when it changes; manual picks stay put.
  useEffect(() => {
    if (activeId && workspaces.some((w) => w.id === activeId)) {
      setWsId(activeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Poll run state so splits appear + update live (created by this panel,
  // the API, mobile, or `tto`).  Each workspace only sees ITS OWN runs —
  // the backend filters by workspace id, and switching workspace re-fetches
  // immediately so runs never leak across workspaces.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      getOrchestratorRuns(wsId)
        .then((d) => {
          if (!cancelled) setRuns(d.runs || []);
        })
        .catch(() => {
          /* silent — next tick */
        });
    };
    tick();
    const iv = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [pollTick, wsId]);

  // Fetch available models for the splitter model selector
  useEffect(() => {
    fetchModels()
      .then((d) => setAvailableModels(d.models.map((m) => m.key)))
      .catch(() => {});
  }, []);

  const ws = workspaces.find((w) => w.id === wsId) || workspaces[0] || null;
  const live = useMemo(() => workspaceLiveEntries(ws, terminals), [ws, terminals]);

  const send = async () => {
    const ex = permGuard('terminalExec');
    if (!ex.ok) {
      onToast(ex.reason, true);
      return;
    }
    const text = taskText.trim();
    if (!text) {
      onToast('Write a task first', true);
      return;
    }
    if (live.length === 0) {
      onToast('No live terminals in this workspace — open terminals first', true);
      return;
    }
    setBusy(true);
    try {
      const inputs = live.map((t) => {
        const u = t as UnifiedTerminal;
        // Per-terminal model override takes precedence over the terminal's saved model
        const modelOverride = terminalModels[t.tty] || '';
        return {
          tty: t.tty,
          label: termName(u) || t.tty,
          model: modelOverride || t.model || '',
        };
      });
      // Read workspace memory context from localStorage
      let memoryContext = '';
      try {
        const memEntries = JSON.parse(localStorage.getItem('tto-workspace-memory') || '[]');
        const wsMem = memEntries.filter(
          (e: { workspace_id: string; done: boolean; kind: string; content: string }) =>
            e.workspace_id === (ws?.id || wsId),
        );
        const pending = wsMem.filter(
          (e: { done: boolean; kind: string }) => e.kind === 'todo' && !e.done,
        );
        const ctx = wsMem.filter((e: { kind: string }) => e.kind === 'context');
        const parts: string[] = [];
        if (ctx.length)
          parts.push(
            '## Workspace Context\n' + ctx.map((e: { content: string }) => e.content).join('\n'),
          );
        if (pending.length)
          parts.push(
            '## Pending TODOs\n' +
              pending
                .map((e: { content: string }, i: number) => `${i + 1}. ${e.content}`)
                .join('\n'),
          );
        memoryContext = parts.join('\n\n');
      } catch {
        /* ignore */
      }
      await runOrchestrator(
        text,
        ws?.id || wsId,
        ws?.name || wsId,
        inputs,
        splitModel,
        memoryContext,
        agentEnabled,
      );
      onToast(`⚡ Orchestrating across ${inputs.length} terminal${inputs.length > 1 ? 's' : ''}…`);
      setTaskText('');
      setPollTick((n) => n + 1); // immediate refresh so the run appears now
    } catch (e) {
      onToast('Orchestrator failed: ' + (e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const clearFinished = async () => {
    try {
      await clearOrchestratorRuns(ws?.id || wsId);
      setPollTick((n) => n + 1);
      onToast(`Cleared finished orchestrations for ${ws?.name || 'this workspace'}`);
    } catch {
      onToast('Failed to clear', true);
    }
  };

  const hasRuns = runs.length > 0;
  const finishedCount = runs.filter((r) => r.status === 'done' || r.status === 'failed').length;

  // The backend returns runs newest-first; render OLDEST first so the
  // conversation reads top→bottom exactly like ChatGPT (your newest message
  // and its live output always appear at the BOTTOM, below earlier turns).
  const orderedRuns = useMemo(() => [...runs].reverse(), [runs]);

  // Auto-scroll the thread to the bottom: always when a NEW run arrives, and
  // while the newest run is still actively updating (planning/dispatching/
  // running) so the live splits stay in view. Once a user scrolls UP to read
  // history, don't yank them back down.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const newRunArrived = runs.length > prevRunCount.current;
    prevRunCount.current = runs.length;
    const newest = runs[0];
    const active = newest && newest.status !== 'done' && newest.status !== 'failed';
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (newRunArrived || active || nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [runs]);

  return (
    <div className="orch-chat">
      {/* slim header: workspace picker + live count + clear */}
      <div className="orch-chat-bar">
        <select
          className="orch-chat-ws"
          value={wsId}
          onChange={(e) => setWsId(e.target.value)}
          title="Which workspace's terminals the orchestrator splits tasks across"
        >
          {workspaces.length === 0 && <option value="">No workspaces</option>}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <span className="orch-chat-live">
          {live.length > 0
            ? `${live.length} terminal${live.length > 1 ? 's' : ''} connected`
            : 'no live terminals'}
        </span>
        {hasRuns && finishedCount > 0 && (
          <button
            className="orch-chat-clear"
            onClick={clearFinished}
            title="Remove finished orchestrations"
          >
            ✕ clear
          </button>
        )}
      </div>

      {/* live terminal chips with per-terminal model selectors */}
      {live.length > 0 && (
        <div className="orch-chat-chips" ref={chipWrapperRef}>
          {live.map((t) => {
            const u = t as UnifiedTerminal;
            const label = termName(u) || t.tty;
            const selectedModel = terminalModels[t.tty] || t.model || '';
            const isOpen = openModelFor === t.tty;
            const shortModel = selectedModel
              ? selectedModel.split('/').pop() || selectedModel
              : 'auto';
            return (
              <span key={t.tty} className="orch-chat-chip-wrapper">
                <span
                  className="orch-chat-chip"
                  data-tty={t.tty}
                  title={`${t.agent || 'terminal'} — click model to change`}
                  onClick={() => setOpenModelFor(isOpen ? null : t.tty)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="orch-chat-chip-dot" /> {label}
                  <span className="orch-chat-chip-model">{shortModel}</span>
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* conversation */}
      <div className="orch-thread" ref={threadRef}>
        {!hasRuns && (
          <div className="orch-hero">
            <span className="logo">tto</span>
            <h1 className="orch-hero-title">Where should we begin?</h1>
            <p className="orch-hero-sub">
              Type one goal — the orchestrator splits it across your workspace terminals and runs
              each part live, right here.
            </p>
            {live.length === 0 && (
              <div className="orch-hero-note">
                Open terminals in the Workspace Layout first — they become the orchestrator's
                sub-terminals.
              </div>
            )}
          </div>
        )}

        {hasRuns &&
          orderedRuns.map((run) => (
            <OrchestratorChatMessage key={run.id} run={run} terminals={terminals} onToast={onToast} />
          ))}
      </div>

      {/* composer */}
      <div className="orch-composer">
        <div className="orch-model-row">
          <label>Splitter model:</label>
          <select
            className="orch-model-select"
            value={splitModel}
            onChange={(e) => setSplitModel(e.target.value)}
          >
            <option value="">Auto (default)</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <label
            className="orch-agent-toggle"
            title="Enable autonomous monitoring, auto-retry on failure, and live status tracking"
          >
            <input
              type="checkbox"
              checked={agentEnabled}
              onChange={(e) => setAgentEnabled(e.target.checked)}
            />
            🤖 Agent mode
          </label>
        </div>
        <div className={`orch-composer-box ${live.length === 0 ? 'disabled' : ''}`}>
          <textarea
            className="orch-composer-text"
            rows={1}
            placeholder={
              live.length > 0
                ? `Split one task across ${live.length} terminal${live.length > 1 ? 's' : ''}…`
                : 'Open terminals in the workspace first…'
            }
            value={taskText}
            disabled={live.length === 0}
            onChange={(e) => {
              setTaskText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="orch-composer-send"
            onClick={send}
            disabled={busy || live.length === 0 || !taskText.trim()}
            title="Split & send"
          >
            {busy ? '⏳' : '➤'}
          </button>
        </div>
        <div className="orch-composer-hint">
          Enter to send · each terminal works on its own sub-task in parallel
        </div>
      </div>

      {/* Portal-rendered dropdown — avoids clipping by overflow containers */}
      {openModelFor &&
        dropdownPos &&
        createPortal(
          <>
            {/* invisible backdrop to catch outside clicks */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
            <div
              className="orch-model-dropdown"
              style={{
                position: 'fixed',
                top: dropdownPos.top,
                left: dropdownPos.left,
                zIndex: 100,
              }}
            >
              {(() => {
                const t = live.find((l) => l.tty === openModelFor);
                if (!t) return null;
                const selectedModel = terminalModels[t.tty] || t.model || '';
                return (
                  <>
                    <div
                      className={`orch-model-option ${!selectedModel ? 'selected' : ''}`}
                      onClick={() => {
                        setTerminalModels((prev) => {
                          const next = { ...prev };
                          delete next[t.tty];
                          return next;
                        });
                        setOpenModelFor(null);
                      }}
                    >
                      Auto (default)
                    </div>
                    {availableModels.map((m) => (
                      <div
                        key={m}
                        className={`orch-model-option ${selectedModel === m ? 'selected' : ''}`}
                        onClick={() => {
                          setTerminalModels((prev) => ({ ...prev, [t.tty]: m }));
                          setOpenModelFor(null);
                        }}
                      >
                        {m}
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

/** Visual timeline of agent actions — grouped by type, with connecting dots. */
function AgentActionTimeline({ actions }: { actions: AgentAction[] }) {
  const [expanded, setExpanded] = useState(actions.length <= 8);
  const shown = expanded ? actions : actions.slice(-6);
  const hiddenCount = actions.length - shown.length;

  const iconFor = (type: string): string => {
    switch (type) {
      case 'retry': return '🔄';
      case 'stall_warning': return '';
      case 'give_up': return '';
      case 'toggle': return '';
      case 'completed': return '';
      case 'synthesis': return '';
      case 'partial_complete': return '';
      default: return '';
    }
  };

  const labelFor = (type: string): string => {
    switch (type) {
      case 'retry': return 'Retry';
      case 'stall_warning': return 'Stall warning';
      case 'give_up': return 'Gave up';
      case 'toggle': return 'Agent toggle';
      case 'completed': return 'Completed';
      case 'synthesis': return 'Synthesis';
      case 'partial_complete': return 'Partial';
      default: return 'Action';
    }
  };

  return (
    <div className="orch-agent-timeline">
      <div className="orch-agent-timeline-head">
        <span className="orch-agent-timeline-title">🤖 Agent Timeline</span>
        <span className="orch-agent-timeline-count">{actions.length} action{actions.length !== 1 ? 's' : ''}</span>
        {!expanded && hiddenCount > 0 && (
          <button className="orch-agent-timeline-expand" onClick={() => setExpanded(true)}>
            Show {hiddenCount} earlier
          </button>
        )}
        {expanded && actions.length > 8 && (
          <button className="orch-agent-timeline-expand" onClick={() => setExpanded(false)}>
            Collapse
          </button>
        )}
      </div>
      <div className="orch-agent-timeline-track">
        {!expanded && hiddenCount > 0 && <div className="orch-agent-timeline-fade" />}
        {shown.map((action, i) => (
          <div key={i} className={`orch-agent-tl-entry orch-agent-tl-${action.type}`}>
            <div className="orch-agent-tl-dot-col">
              <span className="orch-agent-tl-dot" />
              {i < shown.length - 1 && <span className="orch-agent-tl-line" />}
            </div>
            <div className="orch-agent-tl-content">
              <div className="orch-agent-tl-head">
                <span className="orch-agent-tl-icon">{iconFor(action.type)}</span>
                <span className="orch-agent-tl-label">{labelFor(action.type)}</span>
                <span className="orch-agent-tl-time">
                  {new Date(action.timestamp * 1000).toLocaleTimeString()}
                </span>
              </div>
              <div className="orch-agent-tl-msg">{action.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SPLIT_STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: '● running', cls: 'orch-st-running' },
  queued: { label: '○ queued', cls: 'orch-st-queued' },
  pending: { label: '○ queued', cls: 'orch-st-queued' },
  done: { label: '✓ done', cls: 'orch-st-done' },
  blocked: { label: '✗ blocked', cls: 'orch-st-blocked' },
};

/** One conversation turn: the user's goal (bubble) + the live split cards. */
function OrchestratorChatMessage({
  run,
  terminals,
  onToast,
}: {
  run: OrchestratorRun;
  terminals: Record<string, TerminalEntry>;
  onToast: (msg: string, error?: boolean) => void;
}) {
  const [togglingAgent, setTogglingAgent] = useState(false);
  const age = Math.round(Date.now() / 1000 - run.created_at);
  // Long planning runs must not look frozen — after ~20s tell the user the
  // split is still being computed (LLM call in flight), not stuck.
  const planningLong = run.status === 'planning' && age > 20;
  // Merge live per-split status from the terminals prop (instant WebSocket
  // updates) so the preview is truly live even between polls.
  const liveSplits = run.splits.map((s) => {
    const t = terminals[s.tty];
    let status = s.status;
    if (t) {
      if (t.current_task?.id === s.task_id) status = t.current_task.status;
      else if (t.next_task?.id === s.task_id) status = 'queued';
      else if ((t.queue || []).some((q) => q.id === s.task_id)) status = 'queued';
      else {
        const h = (t.history || []).find((x) => x.id === s.task_id);
        if (h) status = h.status;
      }
    }
    return { ...s, status };
  });
  const liveDone = liveSplits.filter((s) => s.status === 'done').length;
  const liveBlocked = liveSplits.filter((s) => s.status === 'blocked').length;
  const liveFinished = liveDone + liveBlocked;
  const livePct = liveSplits.length > 0 ? Math.round((liveFinished / liveSplits.length) * 100) : 0;

  const statusLine =
    run.status === 'planning'
      ? '🧠 Analyzing…'
      : run.status === 'dispatching'
        ? '📡 Dispatching…'
        : run.status === 'running'
          ? `${liveFinished}/${liveSplits.length} sub-tasks done`
          : run.status === 'done'
            ? '✅ All sub-tasks done'
            : run.status === 'failed'
              ? '✗ Failed'
              : '';

  return (
    <div className="orch-msg">
      {/* user bubble — the goal */}
      <div className="orch-msg-user">
        <div className="orch-bubble-user">{run.task}</div>
      </div>

      {/* assistant bubble — the live orchestration */}
      <div className="orch-msg-assistant">
        <div className="orch-bubble-assistant">
          <div className="orch-msg-head">
            <span className="orch-msg-avatar">◫</span>
            <span className="orch-msg-title">Orchestrator</span>
            {run.workspace_name && <span className="orch-msg-ws">{run.workspace_name}</span>}
            <span className={`orch-msg-status orch-msg-status-${run.status}`}>
              {(run.status === 'planning' || run.status === 'dispatching') && (
                <span className="orch-mini-spinner" />
              )}
              {statusLine}
            </span>
            <span className="orch-msg-age">{fmtAge(age)} ago</span>
          </div>

          {/* ── PLANNING: animated spinner + thinking message ── */}
          {run.status === 'planning' && (
            <div className="orch-planning">
              <div className="orch-spinner">
                <div className="orch-spinner-ring" />
                <div className="orch-spinner-ring orch-spinner-ring2" />
                <div className="orch-spinner-dot" />
              </div>
              <div className="orch-planning-text">
                <span className="orch-planning-label">Analyzing the goal</span>
                <span className="orch-dots">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </div>
              <div className={`orch-planning-sub${planningLong ? ' orch-planning-patience' : ''}`}>
                {planningLong
                  ? 'Still splitting — the model is composing the sub-tasks (large goals can take ~30s)'
                  : 'Understanding dependencies and splitting work across terminals'}
              </div>
            </div>
          )}

          {/* ── DISPATCHING: stream-in animation for each split ── */}
          {run.status === 'dispatching' && (
            <div className="orch-dispatching">
              <div className="orch-spinner">
                <div className="orch-spinner-ring" />
                <div className="orch-spinner-ring orch-spinner-ring2" />
                <div className="orch-spinner-dot" />
              </div>
              <span className="orch-dispatching-label">Dispatching to terminals</span>
              <span className="orch-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </div>
          )}

          {run.error && <div className="orch-error">{run.error}</div>}

          {/* ── LIVE SPLITS: appear as they arrive, update in real-time ── */}
          {liveSplits.length > 0 && (
            <>
              <div className="orch-progress">
                <div className="orch-progress-fill" style={{ width: `${livePct}%` }} />
                <span className="orch-progress-label">
                  {liveFinished}/{liveSplits.length} done
                </span>
              </div>
              <div className="orch-splits">
                {liveSplits.map((s, i) => {
                  const st = SPLIT_STATUS[s.status] || SPLIT_STATUS.queued;
                  return (
                    <div
                      key={s.task_id || i}
                      className={`orch-split orch-split-${s.status}`}
                      style={{ animationDelay: `${i * 80}ms` }}
                    >
                      <span className="orch-split-idx">{i + 1}</span>
                      <div className="orch-split-body">
                        <div className="orch-split-desc">{s.description}</div>
                        <div className="orch-split-tty">
                          {s.label || s.tty}
                          {s.model ? (
                            <span className="orch-split-model">
                              {s.model.split('/').pop() || s.model}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span className={`orch-split-st ${st.cls}`}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {run.status === 'done' && liveBlocked > 0 && (
            <div className="orch-note">
              {liveBlocked} sub-task(s) blocked — check those terminals.
            </div>
          )}

          {/* ── AGENT ACTION TIMELINE ── */}
          {run.agent_enabled && run.agent_actions && run.agent_actions.length > 0 && (
            <AgentActionTimeline actions={run.agent_actions} />
          )}

          {/* ── PER-RUN AGENT TOGGLE ── */}
          {run.status !== 'done' && run.status !== 'failed' && (
            <button
              className="orch-run-agent-toggle"
              disabled={togglingAgent}
              onClick={async () => {
                setTogglingAgent(true);
                try {
                  await toggleRunAgent(run.id, !run.agent_enabled);
                  onToast(`Agent ${!run.agent_enabled ? 'enabled' : 'disabled'} for this run`);
                } catch {
                  onToast('Failed to toggle agent for this run', true);
                } finally {
                  setTogglingAgent(false);
                }
              }}
            >
              🤖 {run.agent_enabled ? 'Agent ON' : 'Agent OFF'}
            </button>
          )}

          {/* ── SYNTHESIZED SUMMARY ── */}
          {run.summary && (
            <div className="orch-summary">
              <div className="orch-summary-title">📋 Summary</div>
              <div className="orch-summary-body">{run.summary}</div>
            </div>
          )}

          {/* ── RETRY INDICATOR ON SPLITS ── */}
          {!run.agent_actions?.length && run.splits.some((s) => s.retry_count > 0) && (
            <div className="orch-note">
              🔄 Agent retried {run.splits.filter((s) => s.retry_count > 0).length} split(s)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Emergency to-do → fitted prompt. Compiles a raw to-do list into a
 *  professional prompt sized to the selected model's context window + output
 *  limit, so long lists never break small-context (Ollama) sessions. */
function EmergencyTodo({
  workspaces,
  terminals,
  activeId,
  onToast,
}: {
  workspaces: Workspace[];
  terminals: Record<string, TerminalEntry>;
  activeId?: string;
  onToast: (msg: string, error?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [todoText, setTodoText] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, ModelLimit>>({});
  const [defaultLimit, setDefaultLimit] = useState({ context: 4096, output: 1024 });
  const [useCtx, setUseCtx] = useState({
    cwd: true,
    session_context: true,
    current_task: true,
    summary: true,
    recent_history: true,
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TodoCompileResponse | null>(null);
  const [targetTty, setTargetTty] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchModels()
      .then((d) => {
        if (cancelled) return;
        setModels(d.models);
        setRecent(d.recent);
      })
      .catch(() => onToast('Failed to load models', true));
    fetchModelLimits()
      .then((d) => {
        if (cancelled) return;
        setLimits(d.limits);
        setDefaultLimit(d.default);
      })
      .catch(() => {
        /* limits are optional */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const ws = workspaces.find((w) => w.id === activeId) || workspaces[0] || null;

  const liveEntries = useMemo(() => workspaceLiveEntries(ws, terminals), [ws, terminals]);

  const gathered = useMemo(() => {
    const g = {
      cwd: '',
      session_context: '',
      current_task: '',
      summary: '',
      recent_history: [] as string[],
    };
    if (liveEntries.length === 0) return g;
    g.cwd = liveEntries.map((t) => t.cwd).find(Boolean) || '';
    g.session_context = liveEntries
      .map((t) => t.session_context)
      .filter(Boolean)
      .join(' | ')
      .slice(0, 600);
    g.current_task = liveEntries.map((t) => t.current_task?.description).find(Boolean) || '';
    g.summary = liveEntries
      .map((t) => t.session_summary)
      .filter(Boolean)
      .join(' | ')
      .slice(0, 300);
    const hist: string[] = [];
    for (const t of liveEntries) {
      for (const h of (t.history || []).slice(-3)) {
        if (h.description) hist.push(h.description);
      }
    }
    g.recent_history = hist.slice(-5);
    return g;
  }, [liveEntries]);

  const limit = model ? limits[model] : null;

  const compile = async () => {
    if (!todoText.trim()) {
      onToast('Write a to-do list first', true);
      return;
    }
    setBusy(true);
    try {
      const ctx = {
        cwd: useCtx.cwd ? gathered.cwd : undefined,
        session_context: useCtx.session_context ? gathered.session_context : undefined,
        current_task: useCtx.current_task ? gathered.current_task : undefined,
        summary: useCtx.summary ? gathered.summary : undefined,
        recent_history: useCtx.recent_history ? gathered.recent_history : undefined,
      };
      const res = await compileTodo(todoText, model, ctx);
      setResult(res);
      if (!targetTty && liveEntries.length > 0) setTargetTty(liveEntries[0].tty);
    } catch (e) {
      onToast('Compile failed: ' + (e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    const cb = permGuard('clipboard');
    if (!cb.ok) {
      onToast(cb.reason, true);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.prompt);
      onToast('Prompt copied');
    } catch {
      onToast('Copy failed', true);
    }
  };

  const send = async () => {
    if (!result || !targetTty) {
      onToast('Pick a target terminal first', true);
      return;
    }
    try {
      await addTask(targetTty, result.prompt, model);
      onToast(
        model
          ? `Fitted prompt sent to ${targetTty} · model ${model}`
          : `Fitted prompt sent to ${targetTty}`,
      );
      setTodoText('');
      setResult(null);
      setTargetTty('');
    } catch (e) {
      onToast('Send failed: ' + (e as Error).message, true);
    }
  };

  return (
    <div className="todo-emergency">
      <button
        className="te-toggle"
        onClick={() => setOpen(!open)}
        title="Emergency: fit a long to-do list into any model's context window"
      >
        <span className="te-icon">🆘</span>
        <span className="te-titles">
          <span className="te-title">Emergency To-do → Fitted Prompt</span>
          <span className="te-sub">Compress a long to-do list into any model's context window</span>
        </span>
        {result && !open && (
          <span className={`te-status ${result.stats.fits ? 'ok' : 'bad'}`}>
            {result.stats.fits ? '✓ fits' : '✗ over'}
          </span>
        )}
        <span className="te-hint">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="te-body">
          <div className="te-grid">
            <div className="te-left">
              <label className="te-label" htmlFor="te-todo">
                ✏️ Raw to-do list
              </label>
              <textarea
                id="te-todo"
                className="te-todo"
                rows={6}
                placeholder={
                  'One item per line, as long as you like:\n- fix the login validation\n- add the export API\n- write tests for the billing module'
                }
                value={todoText}
                onChange={(e) => setTodoText(e.target.value)}
              />
              <div className="te-ctx-row">
                <span className="te-label">🧩 Attach context:</span>
                {(Object.keys(useCtx) as (keyof typeof useCtx)[]).map((k) => (
                  <label key={k} className={`te-check${useCtx[k] ? ' checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={useCtx[k]}
                      onChange={(e) => setUseCtx({ ...useCtx, [k]: e.target.checked })}
                    />
                    {k.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
              {liveEntries.length === 0 && (
                <div className="te-nolive">
                  No live terminals in the active workspace — context will be empty.
                </div>
              )}
            </div>
            <div className="te-right">
              <label className="te-label" htmlFor="te-model">
                🎯 Target model
              </label>
              <select
                id="te-model"
                className="te-model"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setResult(null);
                }}
              >
                <option value="">Default (auto)</option>
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
              {model && (
                <div
                  className={`te-limits ${limit ? '' : 'te-assumed'}`}
                  title={
                    limit
                      ? `context ${limit.context} · output ${limit.output}`
                      : defaultLimit
                        ? `assumed context ${defaultLimit.context} · output ${defaultLimit.output}`
                        : ''
                  }
                >
                  {limit
                    ? `fits to ${fmtNum(limit.context)} ctx · ${fmtNum(limit.output)} out`
                    : `limit unknown — assumed ${fmtNum(defaultLimit.context)} ctx · ${fmtNum(defaultLimit.output)} out`}
                </div>
              )}
              <div className="te-live">
                <span className="te-label">Context source:</span> {ws ? ws.name : '—'} (
                {liveEntries.length} live)
              </div>
              <button className="btn primary te-compile" onClick={compile} disabled={busy}>
                {busy ? 'Compiling…' : '⚡ Compile fitted prompt'}
              </button>
            </div>
          </div>

          {result && (
            <div className="te-result">
              <div className="te-result-head">
                <span className="te-label">✨ Fitted prompt</span>
                <span className={`te-badge ${result.stats.fits ? 'te-fit' : 'te-over'}`}>
                  {result.stats.fits
                    ? result.stats.compressed
                      ? `⚠ compressed ${fmtNum(result.stats.original_est)} → ${fmtNum(result.stats.est_tokens)} tok — fits ${fmtNum(result.stats.context_limit)} ctx`
                      : `✓ ${fmtNum(result.stats.est_tokens)} tok — fits ${fmtNum(result.stats.context_limit)} ctx · ${fmtNum(result.stats.output_limit)} out`
                    : `✗ ${fmtNum(result.stats.est_tokens)} tok still over budget ${fmtNum(result.stats.budget)} — trim the list`}
                </span>
              </div>
              <textarea className="te-prompt" rows={10} readOnly value={result.prompt} />
              {result.stats.steps.length > 0 && (
                <div className="te-steps">
                  {result.stats.steps.map((s, i) => (
                    <div key={i}>• {s}</div>
                  ))}
                </div>
              )}
              <div className="te-actions">
                <button className="btn" onClick={copy}>
                  📋 Copy
                </button>
                <select
                  className="te-target"
                  value={targetTty}
                  onChange={(e) => setTargetTty(e.target.value)}
                  title="Send the fitted prompt to a terminal"
                >
                  <option value="">Send to terminal…</option>
                  {liveEntries.map((t) => {
                    const u = t as UnifiedTerminal;
                    const label = termName(u) || t.tty;
                    return (
                      <option key={t.tty} value={t.tty}>
                        {label}
                        {t.agent ? ` · ${t.agent}` : ''}
                      </option>
                    );
                  })}
                </select>
                <button className="btn primary" onClick={send} disabled={!targetTty}>
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function KanbanBoard({ terminals, onToast, workspaces = [], activeId }: Props) {
  return (
    <div className="kanban-wrap">
      <AgentPanel onToast={onToast} />
      <OrchestratorPanel
        workspaces={workspaces}
        terminals={terminals}
        activeId={activeId}
        onToast={onToast}
      />
      <EmergencyTodo
        workspaces={workspaces}
        terminals={terminals}
        activeId={activeId}
        onToast={onToast}
      />
    </div>
  );
}
