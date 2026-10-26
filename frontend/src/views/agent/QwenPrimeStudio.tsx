// ═══════════════════════════════════════════════════════════════════════════
// Qwen Prime Orchestrator Studio
// Reverse-engineers Prime-Agent intelligence, profiles laptop hardware specs,
// benchmarks local Ollama Qwen models, and orchestrates tasks across terminals.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
} from '@/lib/theme';
import {
  fetchQwenProfile,
  runQwenBenchmark,
  orchestrateQwenTask,
  dispatchQwenPlan,
  type QwenModelBenchmark,
  type QwenSystemProfileResponse,
  type PrimeOrchestrationPlan,
} from '@/lib/qwenApi';
import { terminalsForWorkspace } from './qwenWorkspaceTerminals';
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
  onToast: (msg: string, error?: boolean) => void;
}

export function QwenPrimeStudio({
  workspaces,
  terminals,
  activeId,
  onToast,
}: Props) {
  const { theme: t } = useTheme();

  // ── Profile & Model State ──
  const [profile, setProfile] = useState<QwenSystemProfileResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
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

  // ── Fetch Profile on Mount ──
  const loadProfile = useCallback(async () => {
    try {
      const data = await fetchQwenProfile();
      setProfile(data);
      if (!selectedModel) {
        const recommended =
          strategy === 'fastest' ? data.recommendations.fastest : data.recommendations.reasoning;
        if (recommended) setSelectedModel(recommended);
      }
    } catch (err) {
      console.warn('[QwenPrimeStudio] Failed to load profile:', err);
    }
  }, [selectedModel, strategy]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // ── Strategy Switcher ──
  const handleSelectStrategy = (nextStrategy: 'fastest' | 'reasoning') => {
    setStrategy(nextStrategy);
    if (profile) {
      const targetModel =
        nextStrategy === 'fastest'
          ? profile.recommendations.fastest
          : profile.recommendations.reasoning;
      if (targetModel) {
        setSelectedModel(targetModel);
        onToast(`Switched strategy to ${nextStrategy.toUpperCase()}: ${targetModel}`);
      }
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
          setSelectedModel(result.fastest);
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
    const installed = profile?.local_models?.length ? profile.local_models : profile?.qwen_models;
    if (!selectedModel || !installed?.some((model) => model.model_name === selectedModel)) {
      onToast('Select an installed local model', true);
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
        model: selectedModel,
        strategy,
      });

      if (result.ok && result.plan) {
        setCurrentPlan(result.plan);
        onToast(`Plan generated with Prime-Agent intelligence (${result.plan.subtasks.length} subtasks)`);

        // Auto-dispatch if enabled
        if (autoDispatch) {
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
      // 1. Direct client-side Tauri PTY injection for zero-latency local dispatch.
      // The allowlist is the workspace roster returned with the plan.
      const allow = plan.allowed_ttys == null ? null : new Set(plan.allowed_ttys);
      let clientDispatched = 0;
      for (const sub of plan.subtasks) {
        const tty = sub.target_tty;
        if (!tty || (allow && !allow.has(tty))) continue;
        if (!TerminalManager.has(tty)) continue;
        try {
          await TerminalManager.sendCommand(tty, sub.command);
          sub.status = 'running';
          clientDispatched++;
        } catch (e) {
          console.warn(`[QwenPrimeStudio] Client sendCommand failed for ${tty}:`, e);
        }
      }

      // 2. Also notify sidecar API router for lifecycle management & fallback delivery
      const res = await dispatchQwenPlan({ planId: plan.plan_id });
      if (res.ok || clientDispatched > 0) {
        setCurrentPlan((prev) => (prev ? { ...prev, status: 'completed' } : prev));
        onToast(`Dispatched ${res.dispatched_count || clientDispatched} task(s) to terminals!`);
      } else {
        onToast(`Dispatch failed: ${res.errors.join(', ')}`, true);
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

  const modelOptions = useMemo(() => {
    if (!profile) return [] as QwenModelBenchmark[];
    return profile.local_models?.length ? profile.local_models : profile.qwen_models;
  }, [profile]);

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
  const canOrchestrate = Boolean(prompt.trim()) && !isOrchestrating;
  const colorScheme = isLightTheme(t) ? 'light' as const : 'dark' as const;
  const workspaceName = activeWs?.name || 'this workspace';
  const readyLine = selectedCount > 0
    ? `Planning ${selectedCount} terminal${selectedCount === 1 ? '' : 's'} in ${workspaceName}.`
    : `Select terminals in ${workspaceName}.`;
  const chip = profile?.hardware.chip_brand || '';
  const ram = profile?.hardware.total_ram_gb;

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
              <span style={{ color: t.colors.text.muted }}>Reading hardware…</span>
            )}
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: t.borderRadius.full,
                flexShrink: 0,
                background: profile?.ollama.available ? t.colors.success.primary : t.colors.danger.primary,
              }}
            />
            <span style={{ flexShrink: 0 }}>
              {profile?.ollama.available ? 'Ollama' : 'Offline'}
            </span>
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
                aria-label="Model"
                value={modelOptions.some((m) => m.model_name === selectedModel) ? selectedModel : ''}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{ ...selectBase(t), colorScheme, fontWeight: 500, flex: 1, minWidth: 0, width: 'auto' }}
              >
                {modelOptions.length > 0 ? (
                  modelOptions.map((m) => (
                    <option key={m.model_name} value={m.model_name}>
                      {modelOptionLabel(m, safeMax)}
                    </option>
                  ))
                ) : (
                  <option value="">No local models</option>
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
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
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
              {readyLine}
            </div>
          )}

          {currentPlan && (
            <div style={{ flex: 1, minHeight: 0, marginTop: 12, display: 'flex', flexDirection: 'column', ...scrollbarStyle(t) }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
                <div
                  style={{
                    borderRadius: t.borderRadius.lg,
                    border: `1px solid ${t.colors.border.subtle}`,
                    background: t.colors.bg.secondary,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowThinking((value) => !value)}
                    style={{
                      ...buttonBase(t),
                      width: '100%',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 0,
                      background: 'transparent',
                      color: t.colors.text.primary,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
                      <Brain size={14} style={{ color: t.colors.accent.primary }} />
                      Reasoning
                      <span style={{ fontSize: 11, fontWeight: 500, color: t.colors.text.muted }}>
                        {currentPlan.selected_model}
                      </span>
                    </span>
                    {showThinking ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showThinking && (
                    <div
                      style={{
                        padding: '10px 12px 12px',
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: t.colors.text.secondary,
                        borderTop: `1px solid ${t.colors.border.subtle}`,
                        whiteSpace: 'pre-wrap',
                        fontFamily: t.fontFamily.mono,
                        background: t.colors.bg.primary,
                      }}
                    >
                      {currentPlan.thinking_process}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: t.colors.bg.secondary,
                    border: `1px solid ${t.colors.border.subtle}`,
                    borderRadius: t.borderRadius.lg,
                    padding: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      Plan
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: t.colors.text.muted }}>
                        {currentPlan.subtasks.length}
                      </span>
                    </span>
                    {currentPlan.subtasks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleDispatchPlan()}
                        disabled={isDispatching}
                        style={{
                          ...buttonBase(t),
                          ...buttonSize(t, 'sm'),
                          ...buttonVariant(t, 'success'),
                          opacity: isDispatching ? 0.45 : 1,
                        }}
                      >
                        {isDispatching ? (
                          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                        ) : (
                          <Play size={13} />
                        )}
                        {isDispatching ? 'Sending…' : 'Send to terminals'}
                      </button>
                    )}
                  </div>
                  {currentPlan.subtasks.length === 0 ? (
                    <div style={{ fontSize: 11, fontStyle: 'italic', color: t.colors.text.muted }}>Nothing to send in this workspace.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {currentPlan.subtasks.map((sub, idx) => {
                        const statusVariant =
                          sub.status === 'running'
                            ? 'info'
                            : sub.status === 'done'
                              ? 'success'
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
                                  {sub.target_label || sub.target_tty}
                                </span>
                                <span style={badgeBase(t, statusVariant)}>{sub.status}</span>
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
                            {sub.reasoning && (
                              <div style={{ fontSize: 11, color: t.colors.text.muted, lineHeight: 1.45 }}>{sub.reasoning}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
