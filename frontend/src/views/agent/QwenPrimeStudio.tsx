// ═══════════════════════════════════════════════════════════════════════════
// Qwen Prime Orchestrator Studio
// Reverse-engineers Prime-Agent intelligence, profiles laptop hardware specs,
// benchmarks local Ollama Qwen models, and orchestrates tasks across terminals.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { UnifiedTerminal } from '@/types';
import type { Workspace } from '@/lib/workspace';
import { CliLogo } from '@/lib/cliLogos';
import { TerminalManager } from '@/terminal/TerminalManager';
import {
  badgeBase,
  buttonBase,
  buttonSize,
  buttonVariant,
  inputBase,
  isLightTheme,
  scrollbarStyle,
  selectBase,
  type Theme,
} from '@/lib/theme';
import {
  fetchQwenProfile,
  runQwenBenchmark,
  orchestrateQwenTask,
  dispatchQwenPlan,
  saveQwenPref,
  type QwenModelBenchmark,
  type QwenSystemProfileResponse,
  type PrimeOrchestrationPlan,
  type LocalRuntime,
} from '@/lib/qwenApi';
import { terminalsForWorkspace } from './qwenWorkspaceTerminals';
import { dispatchBlockReason, pipelineRows, qwenBadgeLabel, qwenBadgeState } from './qwenBadgeState';
import {
  Cpu,
  Zap,
  Brain,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  Terminal,
  Play,
  Gauge,
  Copy,
  Check,
  Search,
} from 'lucide-react';

const QUICK_PROMPTS = [
  { label: 'Audit tests', text: 'Audit git status and run tests' },
  { label: 'Refactor API', text: 'Refactor the API and verify endpoints' },
  { label: 'Check build', text: 'Check dependencies and run the build' },
  { label: 'Split work', text: 'Split the work across these terminals' },
];

function PipelineStage({
  theme,
  index,
  title,
  meta,
  last,
  children,
}: {
  theme: Theme;
  index: number;
  title: string;
  meta?: string;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', columnGap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: theme.borderRadius.full,
            background: theme.colors.accent.light,
            color: theme.colors.accent.primary,
            border: `1px solid ${theme.colors.accent.primary}`,
            fontSize: 11,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {index}
        </span>
        {!last && (
          <span style={{ width: 1, flex: 1, minHeight: 14, background: theme.colors.border.primary }} />
        )}
      </div>
      <div style={{ minWidth: 0, paddingBottom: last ? 0 : 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, minHeight: 22 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
          {meta ? (
            <span
              style={{
                fontSize: 11,
                color: theme.colors.text.muted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {meta}
            </span>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function modelOptionLabel(model: QwenModelBenchmark, safeMax: number): string {
  const parts = [model.model_name];
  if (model.size_formatted) parts.push(model.size_formatted);
  if (model.eval_tok_per_sec > 0) parts.push(`${model.eval_tok_per_sec} tok/s`);
  if (model.is_fastest) parts.push('fastest');
  if (model.is_agentic) parts.push('thinking');
  if (safeMax > 0 && model.size_bytes > safeMax) parts.push('over RAM');
  return parts.join(' · ');
}

interface Props {
  projectPath?: string;
  workspaces: Workspace[];
  terminals: Record<string, UnifiedTerminal>;
  activeId?: string;
  sidecarConnected?: boolean;
  onToast: (msg: string, error?: boolean) => void;
}

export function QwenPrimeStudio({
  workspaces,
  terminals,
  activeId,
  sidecarConnected = false,
  onToast,
}: Props) {
  const { theme: t } = useTheme();

  // ── Profile & Model State ──
  const [profile, setProfile] = useState<QwenSystemProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedRuntime, setSelectedRuntime] = useState<string>('');
  const [strategy, setStrategy] = useState<'fastest' | 'reasoning'>('fastest');
  const [isBenchmarking, setIsBenchmarking] = useState(false);

  // ── Context State ──
  const [selectedWsId, setSelectedWsId] = useState<string>(activeId || (workspaces[0]?.id ?? ''));
  const [selectedTtys, setSelectedTtys] = useState<Set<string>>(new Set());

  // ── Prompt & Planning State ──
  const [prompt, setPrompt] = useState('');
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<PrimeOrchestrationPlan | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [autoDispatch, setAutoDispatch] = useState(false);
  const [copiedCmdId, setCopiedCmdId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');

  // Active workspace object
  const activeWs = useMemo(() => {
    return workspaces.find((w) => w.id === selectedWsId) || workspaces[0];
  }, [workspaces, selectedWsId]);

  // Panes of the workspace chosen in the dropdown. One card per session id.
  const workspaceTerminals = useMemo(
    () => terminalsForWorkspace(activeWs, terminals),
    [activeWs, terminals],
  );

  const visibleTerminals = useMemo(() => {
    const query = rosterQuery.trim().toLowerCase();
    if (!query) return workspaceTerminals;
    return workspaceTerminals.filter((term) =>
      `${term.label} ${term.cli} ${term.tty} ${term.sessionId}`.toLowerCase().includes(query),
    );
  }, [workspaceTerminals, rosterQuery]);

  const workspacePaneKey = useMemo(() => {
    if (!activeWs) return '';
    const ids = (activeWs.panes || []).map((pane) => pane.tty || '').join(',');
    return `${activeWs.id}|${ids}`;
  }, [activeWs]);

  // Check every pane when the selected workspace's pane set changes.
  // An empty set stays empty, so Deselect All is not filled back in.
  const activeWsRef = useRef(activeWs);
  activeWsRef.current = activeWs;
  useEffect(() => {
    const ids = (activeWsRef.current?.panes || [])
      .map((pane) => pane.tty)
      .filter((tty): tty is string => Boolean(tty));
    setSelectedTtys(new Set(ids));
    setRosterQuery('');
  }, [workspacePaneKey]);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const probeGen = useRef(0);

  const liveRuntimes = useMemo((): LocalRuntime[] => {
    const rows = (profile?.runtimes || []).filter((row) => !row.error);
    if (rows.length > 0 || !profile?.ollama.available) return rows;
    const installed = profile.local_models?.length ? profile.local_models : profile.qwen_models;
    return [{
      runtime: 'ollama',
      base_url: profile.ollama.url,
      models: installed.map((model) => model.model_name),
      latency_ms: 0,
      error: null,
    }];
  }, [profile]);

  const rememberPick = useCallback((runtime: string, model: string) => {
    if (!runtime || !model) return;
    void saveQwenPref({ runtime, model }).catch((err) => {
      console.warn('[QwenPrimeStudio] Failed to save model pick:', err);
    });
  }, []);

  // Probe on mount and when the status button is clicked. A model change does not refetch.
  const loadProfile = useCallback(async () => {
    const generation = ++probeGen.current;
    setProfileLoading(true);
    try {
      const data = await fetchQwenProfile();
      if (generation !== probeGen.current) return;
      setProfile(data);
      setProfileError(null);
      const pref = data.prefs;
      const live = (data.runtimes || []).filter((row) => !row.error);
      const match = pref?.runtime && pref.model
        ? live.find((row) => row.runtime === pref.runtime && row.models.includes(pref.model))
        : undefined;
      if (match && pref) {
        setSelectedRuntime((prev) => prev || match.runtime);
        setSelectedModel((prev) => prev || pref.model);
      }
    } catch (err) {
      if (generation !== probeGen.current) return;
      const message = err instanceof Error ? err.message : 'Profile request failed';
      console.warn('[QwenPrimeStudio] Failed to load profile:', err);
      setProfileError(message);
    } finally {
      if (generation === probeGen.current) setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const sawConnected = useRef(false);
  useEffect(() => {
    if (!sawConnected.current) {
      sawConnected.current = true;
      return;
    }
    if (sidecarConnected && profileRef.current == null) {
      void loadProfile();
    }
  }, [sidecarConnected, loadProfile]);

  // ── Strategy Switcher ──
  const handleSelectStrategy = (nextStrategy: 'fastest' | 'reasoning') => {
    setStrategy(nextStrategy);
    if (!profile?.ollama.available) return;
    const targetModel =
      nextStrategy === 'fastest'
        ? profile.recommendations.fastest
        : profile.recommendations.reasoning;
    if (targetModel) {
      setSelectedRuntime('ollama');
      setSelectedModel(targetModel);
      rememberPick('ollama', targetModel);
      onToast(`Switched strategy to ${nextStrategy.toUpperCase()}: ${targetModel}`);
    }
  };

  // ── Run Speed Benchmark ──
  const handleRunBenchmark = async () => {
    setIsBenchmarking(true);
    onToast('Benchmarking installed Qwen models (measuring tokens/sec)...');
    try {
      const result = await runQwenBenchmark();
      if (result.ok && (result.local_models || result.benchmarks)) {
        setProfile((prev) => {
          if (!prev) return prev;
          const speeds = new Map((result.benchmarks || []).map((bench) => [bench.model_name, bench]));
          const base = result.local_models?.length
            ? result.local_models
            : (prev.local_models?.length ? prev.local_models : prev.qwen_models);
          const local = base.map((model) => {
            const bench = speeds.get(model.model_name);
            return bench ? { ...model, ...bench, is_qwen: model.is_qwen } : model;
          });
          const fastestName = result.fastest || prev.recommendations.fastest;
          const marked = local.map((model) => ({
            ...model,
            is_fastest: Boolean(fastestName) && model.model_name === fastestName,
          }));
          return {
            ...prev,
            local_models: marked,
            qwen_models: marked.filter((model) => model.is_qwen),
            recommendations: {
              ...prev.recommendations,
              fastest: fastestName,
            },
          };
        });
        if (strategy === 'fastest' && result.fastest) {
          setSelectedRuntime('ollama');
          setSelectedModel(result.fastest);
          rememberPick('ollama', result.fastest);
        }
        onToast(`Benchmark completed! Fastest model: ${result.fastest || 'unchanged'}`);
      }
    } catch (err: any) {
      onToast(`Benchmark failed: ${err.message}`, true);
    } finally {
      setIsBenchmarking(false);
    }
  };

  // ── Toggle Target Terminal Checkbox ──
  const toggleTerminalSelection = (tty: string) => {
    setSelectedTtys((prev) => {
      const next = new Set(prev);
      if (next.has(tty)) {
        next.delete(tty);
      } else {
        next.add(tty);
      }
      return next;
    });
  };

  // ── Orchestrate Task ──
  const handleOrchestrate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      onToast('Please enter a goal or task instruction', true);
      return;
    }

    const checked = workspaceTerminals.filter((term) => selectedTtys.has(term.sessionId));
    if (checked.length === 0) {
      onToast('Select at least one terminal in this workspace', true);
      return;
    }
    const runtimeRow = liveRuntimes.find((row) => row.runtime === selectedRuntime);
    if (!selectedRuntime || !selectedModel || !runtimeRow?.models.includes(selectedModel)) {
      onToast('Select a running local model', true);
      return;
    }

    setIsOrchestrating(true);
    try {
      const result = await orchestrateQwenTask({
        prompt: trimmed,
        workspaceId: activeWs?.id,
        workspaceName: activeWs?.name,
        projectPath: activeWs?.projectPath,
        targetTtys: checked.map((term) => term.sessionId),
        targets: checked.map((term) => ({
          sessionId: term.sessionId,
          label: term.label,
          cli: term.cli,
        })),
        model: selectedModel,
        runtime: selectedRuntime,
        runtimeUrl: runtimeRow.base_url,
        strategy,
      });

      if (result.ok && result.plan) {
        setCurrentPlan(result.plan);
        if (result.plan.status === 'failed') setShowThinking(true);
        const count = result.plan.subtasks.length;
        onToast(
          count > 0
            ? `Plan ready (${count} step${count === 1 ? '' : 's'})`
            : 'The model did not return a plan for these panes',
          count === 0,
        );

        // Auto-dispatch if enabled
        if (autoDispatch && count > 0) {
          void handleDispatchPlan(result.plan);
        }
      }
    } catch (err: any) {
      onToast(`Orchestration error: ${err.message}`, true);
    } finally {
      setIsOrchestrating(false);
    }
  };

  // ── Dispatch Plan to Terminals ──
  const handleDispatchPlan = async (planToDispatch?: PrimeOrchestrationPlan) => {
    const plan = planToDispatch || currentPlan;
    if (!plan || plan.subtasks.length === 0) {
      onToast('No plan available to dispatch', true);
      return;
    }

    setIsDispatching(true);
    try {
      const allow = plan.allowed_ttys == null ? null : new Set(plan.allowed_ttys);
      const results: { id: string; status: 'sent' | 'failed'; error?: string }[] = [];
      const nextSubtasks = plan.subtasks.map((sub) => ({ ...sub }));
      for (const sub of nextSubtasks) {
        const tty = sub.target_tty;
        const term = workspaceTerminals.find((item) => item.sessionId === tty);
        if (!tty || (allow && !allow.has(tty))) {
          sub.status = 'failed';
          sub.error = 'Outside this workspace';
          results.push({ id: sub.id, status: 'failed', error: sub.error });
          continue;
        }
        const block = dispatchBlockReason(
          sub.cli || term?.cli || '',
          Boolean(term?.busy),
          TerminalManager.has(tty),
        );
        if (block) {
          sub.status = 'failed';
          sub.error = block;
          results.push({ id: sub.id, status: 'failed', error: block });
          continue;
        }
        try {
          await TerminalManager.sendCommand(tty, sub.command);
          sub.status = 'sent';
          results.push({ id: sub.id, status: 'sent' });
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Send failed';
          sub.status = 'failed';
          sub.error = message;
          results.push({ id: sub.id, status: 'failed', error: message });
          console.warn(`[QwenPrimeStudio] Client sendCommand failed for ${tty}:`, e);
        }
      }

      const sent = results.filter((row) => row.status === 'sent').length;
      const planStatus = sent === 0 ? 'failed' : sent === nextSubtasks.length ? 'sent' : 'partial';
      setCurrentPlan((prev) => (
        prev && prev.plan_id === plan.plan_id
          ? { ...prev, status: planStatus, subtasks: nextSubtasks }
          : prev
      ));
      let res: { ok: boolean; errors: string[] } | null = null;
      try {
        res = await dispatchQwenPlan({ planId: plan.plan_id, results });
      } catch (err: any) {
        onToast(
          sent > 0
            ? `Typed ${sent} pane${sent === 1 ? '' : 's'}, but the outcome was not saved: ${err.message}`
            : `Dispatch record failed: ${err.message}`,
          true,
        );
        return;
      }
      if (sent === nextSubtasks.length && sent > 0) {
        onToast(`Sent ${sent} task${sent === 1 ? '' : 's'} to the selected panes`);
      } else if (sent > 0) {
        onToast(`Sent ${sent} of ${nextSubtasks.length}. ${nextSubtasks.length - sent} failed`, true);
      } else {
        onToast(`Nothing was sent${res.errors.length ? `: ${res.errors.join(', ')}` : ''}`, true);
      }
    } catch (err: any) {
      onToast(`Dispatch error: ${err.message}`, true);
    } finally {
      setIsDispatching(false);
    }
  };

  // ── Copy Command Helper ──
  const handleCopyCommand = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedCmdId(id);
    setTimeout(() => setCopiedCmdId(null), 2000);
  };

  const activeRuntime = liveRuntimes.find((row) => row.runtime === selectedRuntime) || null;

  const modelOptions = useMemo(() => {
    if (!profile) return [] as QwenModelBenchmark[];
    if (selectedRuntime && selectedRuntime !== 'ollama') {
      return (activeRuntime?.models || []).map((name) => ({
        model_name: name,
        size_bytes: 0,
        size_formatted: '',
        parameter_size: '',
        quantization_level: '',
        is_qwen: name.toLowerCase().includes('qwen'),
        is_fastest: false,
        is_agentic: false,
        eval_tok_per_sec: 0,
        prompt_eval_tok_per_sec: 0,
        total_duration_ms: 0,
        load_duration_ms: 0,
        eval_tokens: 0,
        prompt_tokens: 0,
        has_thinking: false,
        status: 'ready' as const,
      }));
    }
    return profile.local_models?.length ? profile.local_models : profile.qwen_models;
  }, [profile, selectedRuntime, activeRuntime]);

  // Active model benchmark metadata
  const currentModelBench = useMemo(() => {
    return modelOptions.find((m) => m.model_name === selectedModel);
  }, [modelOptions, selectedModel]);

  const safeMax = profile?.hardware.safe_max_model_bytes || 0;
  const modelOverRam = Boolean(
    currentModelBench && safeMax > 0 && currentModelBench.size_bytes > safeMax,
  );
  const selectedCount = workspaceTerminals.filter((term) => selectedTtys.has(term.sessionId)).length;
  const allChecked = workspaceTerminals.length > 0 && selectedCount === workspaceTerminals.length;
  const modelReady = Boolean(
    selectedRuntime && selectedModel && activeRuntime?.models.includes(selectedModel),
  );
  const canOrchestrate = Boolean(prompt.trim()) && modelReady && !isOrchestrating;
  const badgeState = qwenBadgeState({ loading: profileLoading, profile, error: profileError });
  const badgeLabel = qwenBadgeLabel(badgeState);
  const badgeTitle = profileError
    || (profile?.ollama.error ?? '')
    || (profile && !profile.ollama.available ? `${profile.ollama.reason || 'down'} · ${profile.ollama.url}` : '')
    || profile?.ollama.url
    || 'Check again';
  const colorScheme = isLightTheme(t) ? 'light' as const : 'dark' as const;
  const workspaceName = activeWs?.name || 'this workspace';
  const readyLine = selectedCount > 0
    ? `Planning ${selectedCount} terminal${selectedCount === 1 ? '' : 's'} in ${workspaceName}.`
    : `Select terminals in ${workspaceName}.`;
  const chip = profile?.hardware.chip_brand || '';
  const ram = profile?.hardware.total_ram_gb;
  const planRows = currentPlan ? pipelineRows(currentPlan.subtasks) : [];
  const sentCount = planRows.filter((row) => row.outcome === 'sent').length;
  const failedCount = planRows.filter((row) => row.outcome === 'failed').length;
  const resultLine = !currentPlan || currentPlan.subtasks.length === 0
    ? 'No send. The model did not return a pane task.'
    : sentCount + failedCount === 0
      ? 'Not sent yet. Dispatch types the text into the open pane.'
      : `${sentCount} sent · ${failedCount} failed. Sent means the pane received the text.`;

  const toggleAll = () => {
    const ids = workspaceTerminals.map((term) => term.sessionId);
    setSelectedTtys(allChecked ? new Set() : new Set(ids));
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: t.colors.bg.primary,
        color: t.colors.text.primary,
        fontFamily: t.fontFamily.sans,
      }}
    >
      <header
        style={{
          flexShrink: 0,
          height: 48,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'nowrap',
          background: t.colors.bg.secondary,
          borderBottom: `1px solid ${t.colors.border.primary}`,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px', flexShrink: 0 }}>
          Qwen Prime
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              fontSize: 11,
              color: t.colors.text.secondary,
            }}
          >
            {profile ? (
              <>
                <Cpu size={13} style={{ color: t.colors.text.muted, flexShrink: 0 }} />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 200,
                  }}
                >
                  {chip}
                  {ram != null ? ` · ${ram} GB` : ''}
                  {profile.hardware.has_metal ? ' · Metal' : ''}
                </span>
              </>
            ) : (
              <span style={{ color: t.colors.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                {profileError || 'Reading hardware…'}
              </span>
            )}
            <button
              type="button"
              onClick={() => void loadProfile()}
              disabled={profileLoading}
              title={badgeTitle}
              aria-label={`${badgeLabel}. ${badgeTitle}`}
              style={{
                ...buttonBase(t),
                height: 28,
                padding: '0 8px',
                gap: 6,
                flexShrink: 0,
                cursor: profileLoading ? 'default' : 'pointer',
                opacity: profileLoading ? 0.7 : 1,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: t.borderRadius.full,
                  flexShrink: 0,
                  background: badgeState === 'online'
                    ? t.colors.success.primary
                    : badgeState === 'checking'
                      ? t.colors.text.muted
                      : badgeState === 'unreachable'
                        ? t.colors.warning.primary
                        : t.colors.danger.primary,
                }}
              />
              {profileLoading && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
              {badgeLabel}
            </button>
          </div>
          <button
            type="button"
            onClick={handleRunBenchmark}
            disabled={isBenchmarking || !profile?.ollama.available}
            style={{
              ...buttonBase(t),
              ...buttonSize(t, 'sm'),
              ...buttonVariant(t, 'secondary'),
              opacity: isBenchmarking || !profile?.ollama.available ? 0.45 : 1,
            }}
          >
            {isBenchmarking ? (
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Gauge size={13} style={{ color: t.colors.warning.primary }} />
            )}
            {isBenchmarking ? 'Benchmarking…' : 'Benchmark'}
          </button>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <aside
          style={{
            width: 300,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRight: `1px solid ${t.colors.border.primary}`,
            background: t.colors.bg.secondary,
            padding: '10px 8px 8px',
          }}
        >
          <select
            aria-label="Workspace"
            value={selectedWsId}
            onChange={(e) => setSelectedWsId(e.target.value)}
            style={{ ...selectBase(t), colorScheme, backgroundColor: t.colors.bg.primary }}
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>

          <div style={{ position: 'relative', marginTop: 8 }}>
            <Search
              size={12}
              style={{
                position: 'absolute',
                left: 8,
                top: 8,
                color: t.colors.text.muted,
                pointerEvents: 'none',
              }}
            />
            <input
              value={rosterQuery}
              onChange={(e) => setRosterQuery(e.target.value)}
              placeholder="Filter panes"
              aria-label="Filter panes"
              style={{
                ...inputBase(t),
                height: 28,
                fontSize: 11,
                paddingLeft: 26,
                background: t.colors.bg.primary,
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              minHeight: 28,
              padding: '0 2px',
            }}
          >
            <span style={{ fontSize: 11, color: t.colors.text.muted }}>
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={toggleAll}
              disabled={workspaceTerminals.length === 0}
              style={{
                ...buttonBase(t),
                ...buttonVariant(t, 'ghost'),
                height: 24,
                padding: '0 8px',
                fontSize: 11,
                opacity: workspaceTerminals.length === 0 ? 0.45 : 1,
              }}
            >
              {allChecked ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              ...scrollbarStyle(t),
            }}
          >
            {workspaceTerminals.length === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 11, fontStyle: 'italic', color: t.colors.text.muted }}>
                No terminals in {workspaceName}.
              </div>
            ) : visibleTerminals.length === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 11, fontStyle: 'italic', color: t.colors.text.muted }}>
                No terminals match.
              </div>
            ) : (
              visibleTerminals.map((term) => {
                const selected = selectedTtys.has(term.sessionId);
                const hovered = hoveredId === term.sessionId;
                return (
                  <div
                    key={term.sessionId}
                    onClick={() => toggleTerminalSelection(term.sessionId)}
                    onMouseEnter={() => setHoveredId(term.sessionId)}
                    onMouseLeave={() => setHoveredId(null)}
                    title={`${term.cli} · ${term.tty} · ${term.busy ? 'Busy' : 'Idle'}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      height: 30,
                      padding: '0 8px 0 8px',
                      borderRadius: t.borderRadius.sm,
                      cursor: 'pointer',
                      background: hovered && !selected ? t.colors.bg.hover : 'transparent',
                      borderLeft: `2.5px solid ${selected ? t.colors.accent.primary : 'transparent'}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleTerminalSelection(term.sessionId)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${term.label}`}
                      style={{
                        accentColor: t.colors.accent.primary,
                        width: 13,
                        height: 13,
                        margin: 0,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    />
                    <span
                      title={term.busy ? 'Busy' : 'Idle'}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: t.borderRadius.full,
                        flexShrink: 0,
                        background: term.busy ? t.colors.warning.primary : t.colors.text.muted,
                      }}
                    />
                    <CliLogo cli={term.cli || 'shell'} size={13} />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: '11.5px',
                        fontWeight: selected ? 600 : 500,
                        color: selected ? t.colors.text.primary : t.colors.text.secondary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {term.label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <main
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: '14px 16px 12px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flex: currentPlan ? '0 0 auto' : 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              background: t.colors.bg.secondary,
              border: `1px solid ${composerFocused ? t.colors.border.focus : t.colors.border.subtle}`,
              borderRadius: t.borderRadius.lg,
              boxShadow: composerFocused ? `0 0 0 3px ${t.colors.accent.light}` : 'none',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 10px',
                borderBottom: `1px solid ${t.colors.border.subtle}`,
              }}
            >
              <select
                aria-label="Local model system"
                value={selectedRuntime}
                onChange={(e) => {
                  const runtime = e.target.value;
                  setSelectedRuntime(runtime);
                  setSelectedModel('');
                }}
                style={{ ...selectBase(t), colorScheme, fontWeight: 500, width: 130, flexShrink: 0 }}
              >
                <option value="">System</option>
                {liveRuntimes.map((row) => (
                  <option key={row.runtime} value={row.runtime}>
                    {row.runtime}{row.models.length === 0 ? ' · no model loaded' : ` · ${row.models.length}`}
                  </option>
                ))}
              </select>
              <select
                aria-label="Model"
                value={modelOptions.some((m) => m.model_name === selectedModel) ? selectedModel : ''}
                onChange={(e) => {
                  const name = e.target.value;
                  setSelectedModel(name);
                  if (selectedRuntime && name) rememberPick(selectedRuntime, name);
                }}
                style={{ ...selectBase(t), colorScheme, fontWeight: 500, flex: 1, minWidth: 0, width: 'auto' }}
              >
                {modelOptions.length > 0 ? (
                  modelOptions.map((m) => (
                    <option key={m.model_name} value={m.model_name}>
                      {modelOptionLabel(m, safeMax)}
                    </option>
                  ))
                ) : (
                  <option value="">{selectedRuntime ? 'No model loaded' : 'Select a model'}</option>
                )}
              </select>
              {currentModelBench && currentModelBench.eval_tok_per_sec > 0 && (
                <span style={{ fontSize: 11, color: t.colors.text.muted, flexShrink: 0 }}>
                  {currentModelBench.eval_tok_per_sec} tok/s
                </span>
              )}
              {modelOverRam && (
                <span style={{ fontSize: 11, color: t.colors.danger.primary, fontWeight: 600, flexShrink: 0 }}>
                  Over RAM
                </span>
              )}
              <div
                style={{
                  display: 'flex',
                  flexShrink: 0,
                  background: t.colors.bg.primary,
                  padding: 3,
                  gap: 2,
                  borderRadius: t.borderRadius.lg,
                  border: `1px solid ${t.colors.border.subtle}`,
                }}
              >
                {([
                  ['fastest', 'Fastest', Zap],
                  ['reasoning', 'Reasoning', Brain],
                ] as const).map(([key, label, Icon]) => {
                  const on = strategy === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectStrategy(key)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        height: 26,
                        padding: '0 10px',
                        borderRadius: t.borderRadius.md,
                        fontSize: 11,
                        fontWeight: on ? 600 : 500,
                        fontFamily: t.fontFamily.sans,
                        color: on ? t.colors.text.primary : t.colors.text.secondary,
                        background: on ? t.colors.bg.elevated : 'transparent',
                        border: on ? `1px solid ${t.colors.border.primary}` : '1px solid transparent',
                        boxShadow: on ? '0 1px 3px rgba(0,0,0,0.35)' : 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon size={11} style={{ color: on ? t.colors.accent.primary : t.colors.text.muted }} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isOrchestrating) {
                  e.preventDefault();
                  void handleOrchestrate();
                }
              }}
              placeholder="Describe what these terminals should do."
              style={{
                flex: currentPlan ? '0 0 auto' : 1,
                minHeight: 148,
                border: 'none',
                outline: 'none',
                resize: 'none',
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                background: 'transparent',
                color: t.colors.text.primary,
                fontFamily: t.fontFamily.sans,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            />

            <div
              style={{
                flexShrink: 0,
                minHeight: 40,
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                padding: '8px 10px',
                borderTop: `1px solid ${t.colors.border.subtle}`,
                background: t.colors.bg.primary,
              }}
            >
              {QUICK_PROMPTS.map((item) => {
                const on = prompt === item.text;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setPrompt(item.text)}
                    style={{
                      height: 24,
                      padding: '0 8px',
                      borderRadius: t.borderRadius.full,
                      fontSize: 11,
                      fontWeight: on ? 600 : 500,
                      fontFamily: t.fontFamily.sans,
                      whiteSpace: 'nowrap',
                      background: on ? t.colors.accent.light : t.colors.bg.tertiary,
                      border: `1px solid ${on ? t.colors.accent.primary : t.colors.border.subtle}`,
                      color: on ? t.colors.accent.primary : t.colors.text.secondary,
                      cursor: 'pointer',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setAutoDispatch((value) => !value)}
                style={{
                  ...buttonBase(t),
                  height: 24,
                  padding: '0 8px',
                  fontSize: 11,
                  flexShrink: 0,
                  background: autoDispatch ? t.colors.accent.light : 'transparent',
                  color: autoDispatch ? t.colors.accent.primary : t.colors.text.secondary,
                  border: `1px solid ${autoDispatch ? t.colors.accent.primary : t.colors.border.subtle}`,
                }}
              >
                Auto-dispatch
              </button>
              <span style={{ fontFamily: t.fontFamily.mono, fontSize: 10, color: t.colors.text.muted, flexShrink: 0 }}>
                ⌘↵
              </span>
              <button
                type="button"
                onClick={() => void handleOrchestrate()}
                disabled={!canOrchestrate}
                style={{
                  ...buttonBase(t),
                  ...buttonSize(t, 'sm'),
                  ...buttonVariant(t, 'primary'),
                  flexShrink: 0,
                  opacity: canOrchestrate ? 1 : 0.45,
                  cursor: canOrchestrate ? 'pointer' : 'not-allowed',
                }}
              >
                {isOrchestrating ? (
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Send size={13} />
                )}
                {isOrchestrating ? 'Planning…' : 'Orchestrate'}
              </button>
            </div>
          </div>

          {!currentPlan && (
            <div style={{ flexShrink: 0, padding: '8px 2px 0', fontSize: 12, color: t.colors.text.muted }}>
              {!selectedRuntime
                ? 'Choose a local model system that is running, then describe the task.'
                : selectedRuntime === 'ollama' && profile?.models_status === 'failed'
                  ? 'Ollama is up, but the model list failed. Click the status button to try again.'
                  : activeRuntime && activeRuntime.models.length === 0
                    ? `${activeRuntime.runtime} is running. Load a chat model, then click the status button.`
                    : readyLine}
            </div>
          )}

          {currentPlan && (
            <div style={{ flex: 1, minHeight: 0, marginTop: 12, display: 'flex', flexDirection: 'column', ...scrollbarStyle(t) }}>
              <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
                <PipelineStage
                  theme={t}
                  index={1}
                  title="Model"
                  meta={`${selectedRuntime || 'no system'} · ${currentPlan.selected_model || 'no model'}`}
                />
                <PipelineStage
                  theme={t}
                  index={2}
                  title="Understand"
                  meta={showThinking ? 'open' : 'hidden'}
                >
                  <button
                    type="button"
                    onClick={() => setShowThinking((value) => !value)}
                    style={{
                      ...buttonBase(t),
                      width: '100%',
                      justifyContent: 'space-between',
                      marginTop: 6,
                      padding: '6px 10px',
                      background: t.colors.bg.secondary,
                      color: t.colors.text.primary,
                      border: `1px solid ${t.colors.border.subtle}`,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>
                      {currentPlan.status === 'failed' ? 'Why this plan failed' : 'How the model read the task'}
                    </span>
                    {showThinking ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showThinking && (
                    <div
                      style={{
                        marginTop: 6,
                        padding: '10px 12px',
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: t.colors.text.secondary,
                        border: `1px solid ${t.colors.border.subtle}`,
                        borderRadius: t.borderRadius.md,
                        whiteSpace: 'pre-wrap',
                        fontFamily: t.fontFamily.mono,
                        background: t.colors.bg.primary,
                      }}
                    >
                      {currentPlan.thinking_process || 'No explanation was returned.'}
                    </div>
                  )}
                </PipelineStage>
                <PipelineStage
                  theme={t}
                  index={3}
                  title="Plan"
                  meta={currentPlan.subtasks.length === 0 ? 'nothing to send' : `${currentPlan.subtasks.length} step${currentPlan.subtasks.length === 1 ? '' : 's'}`}
                >
                  {currentPlan.subtasks.length === 0 ? (
                    <div style={{ marginTop: 6, fontSize: 11, fontStyle: 'italic', color: t.colors.text.muted }}>Nothing to send in this workspace.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {currentPlan.subtasks.map((sub, idx) => {
                        const statusVariant =
                          sub.status === 'sent' || sub.status === 'done'
                            ? 'success'
                            : sub.status === 'running'
                              ? 'info'
                              : sub.status === 'failed'
                                ? 'danger'
                                : 'default';
                        return (
                          <div
                            key={sub.id || idx}
                            style={{
                              padding: '10px 12px',
                              borderRadius: t.borderRadius.md,
                              background: t.colors.bg.primary,
                              border: `1px solid ${t.colors.border.subtle}`,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <span
                                  style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: t.borderRadius.full,
                                    background: t.colors.accent.light,
                                    color: t.colors.accent.primary,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                  }}
                                >
                                  {idx + 1}
                                </span>
                                <span
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {sub.title}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <span style={{ ...badgeBase(t, 'default'), fontFamily: t.fontFamily.mono }}>
                                  <Terminal size={11} />
                                  {sub.cli ? `${sub.cli} · ` : ''}{sub.target_label || sub.target_tty}
                                </span>
                                <span style={badgeBase(t, 'default')}>{sub.action_type === 'agent_prompt' ? 'prompt' : 'shell'}</span>
                                <span style={badgeBase(t, statusVariant)}>{sub.status === 'sent' ? 'sent' : sub.status}</span>
                              </div>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '6px 8px 6px 10px',
                                borderRadius: t.borderRadius.sm,
                                background: t.colors.bg.input,
                                border: `1px solid ${t.colors.border.subtle}`,
                                fontFamily: t.fontFamily.mono,
                                fontSize: 12,
                              }}
                            >
                              <code style={{ flex: 1, minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap' }}>{sub.command}</code>
                              <button
                                type="button"
                                onClick={() => handleCopyCommand(sub.id, sub.command)}
                                title="Copy command"
                                style={{ ...buttonBase(t), ...buttonVariant(t, 'ghost'), height: 24, padding: 4, flexShrink: 0 }}
                              >
                                {copiedCmdId === sub.id ? (
                                  <Check size={14} style={{ color: t.colors.success.primary }} />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </button>
                            </div>
                            {sub.error && (
                              <div style={{ fontSize: 11, color: t.colors.danger.primary, lineHeight: 1.45 }}>{sub.error}</div>
                            )}
                            {sub.reasoning && (
                              <div style={{ fontSize: 11, color: t.colors.text.muted, lineHeight: 1.45 }}>{sub.reasoning}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </PipelineStage>
                <PipelineStage theme={t} index={4} title="Dispatch" meta={isDispatching ? 'sending' : 'one writer'}>
                  <button
                    type="button"
                    onClick={() => void handleDispatchPlan()}
                    disabled={isDispatching || currentPlan.subtasks.length === 0}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      ...buttonVariant(t, 'success'),
                      marginTop: 6,
                      opacity: isDispatching || currentPlan.subtasks.length === 0 ? 0.45 : 1,
                      cursor: isDispatching || currentPlan.subtasks.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isDispatching ? (
                      <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Play size={13} />
                    )}
                    {isDispatching ? 'Sending…' : 'Dispatch'}
                  </button>
                </PipelineStage>
                <PipelineStage theme={t} index={5} title="Result" meta={currentPlan.status} last>
                  <div style={{ marginTop: 6, fontSize: 12, color: t.colors.text.secondary, lineHeight: 1.45 }}>
                    {resultLine}
                  </div>
                  {planRows.filter((row) => row.outcome === 'failed' && row.error).map((row) => (
                    <div key={row.index} style={{ marginTop: 4, fontSize: 11, color: t.colors.danger.primary, lineHeight: 1.4 }}>
                      {row.index}. {row.cli ? `${row.cli} · ` : ''}{row.label}: {row.error}
                    </div>
                  ))}
                </PipelineStage>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
