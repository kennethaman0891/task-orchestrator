// Chat view — full-page conversation for the same panes the terminal uses.
// Picking a CLI focuses that live session or starts one. The chat, the
// terminal preview, and the tab follow that choice on the same render.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MessageSquare, Plus, TerminalSquare, X } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import type { Pane, Workspace } from '@/lib/workspace';
import type { UnifiedTerminal } from '@/types';
import { termName } from '@/lib/format';
import { CliLogo } from '@/lib/cliLogos';
import { isLightTheme } from '@/lib/theme';
import { CLI_CATALOG, cliById, fallbackLaunchCommand, type CliModelOption } from '@/chat/cliCatalog';
import { fetchCliInstalled, fetchCliModelRows, fetchModels } from '@/api/client';
import { AgentChatPanel } from '@/components/terminal/AgentChatPanel';
import { TerminalAnchor } from '@/components/terminal/TerminalPool';
import { TerminalManager } from '@/terminal/TerminalManager';

interface Props {
  activeWorkspace?: Workspace;
  terminals: Record<string, UnifiedTerminal>;
  focusedTerminal: string | null;
  createNonce: number;
  onSelectTerminal: (id: string | null) => void;
  onSelectPane: (id: string | null) => void;
  onRemovePane: (paneId: string) => void;
  onRenameTerminal: (tty: string, label: string) => void;
  onCreateSession: (cliId: string, modelId: string, forceNew: boolean, commandOverride?: string, reusePending?: boolean) => void;
  onToast: (msg: string, error?: boolean) => void;
}

function paneLabel(pane: Pane, entry?: UnifiedTerminal): string {
  if (pane.label) return pane.label;
  if (entry) return termName(entry);
  return pane.tty || 'Session';
}

/** Catalog id for the focused session. Pane metadata wins; a live process scan fills the gap. */
function sessionCatalogCli(pane: Pane | undefined, row: UnifiedTerminal | undefined): string {
  const named = (pane?.cliId || '').toLowerCase();
  const raw = named || (row?.cli || row?.agent || '').toLowerCase();
  if (raw === 'agy' || raw === 'jetski' || raw === 'antigravity' || (!named && row?.antigravity_running)) return 'antigravity';
  if (raw === 'claude-code' || raw === 'claude' || (!named && row?.claude_running)) return 'claude';
  if (raw === 'codex-cli') return 'codex';
  if (raw === 'gemini-cli') return 'gemini';
  if (!named && row?.opencode_running) return 'opencode';
  return raw;
}

export function ChatView({
  activeWorkspace,
  terminals,
  focusedTerminal,
  createNonce,
  onSelectTerminal,
  onSelectPane,
  onRemovePane,
  onRenameTerminal,
  onCreateSession,
  onToast,
}: Props) {
  const { theme: t } = useTheme();
  const allPanes = activeWorkspace?.panes || [];
  const panes = allPanes.filter((p) => p.tty);
  const focusedPane = panes.find((p) => p.tty === focusedTerminal);
  const sessionId = focusedPane?.tty || null;
  const entry = sessionId ? terminals[sessionId] : undefined;

  const [pendingCli, setPendingCli] = useState(() => {
    const id = focusedPane?.cliId || '';
    return CLI_CATALOG.some((c) => c.id === id) ? id : 'antigravity';
  });
  const [requestedCli, setRequestedCli] = useState<string | null>(null);
  const [models, setModels] = useState<CliModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [menuModel, setMenuModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [editingTty, setEditingTty] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const cliRef = useRef<HTMLSelectElement>(null);
  const modelSelectRef = useRef<HTMLSelectElement>(null);
  const startingCliRef = useRef<string | null>(null);

  const catalogHas = (id: string) => CLI_CATALOG.some((c) => c.id === id);
  const focusedCli = sessionCatalogCli(focusedPane, entry);
  const shownCli = requestedCli && catalogHas(requestedCli)
    ? requestedCli
    : catalogHas(focusedCli)
      ? focusedCli
      : catalogHas(pendingCli)
        ? pendingCli
        : (CLI_CATALOG[0]?.id || 'antigravity');
  const switching = Boolean(requestedCli && focusedCli !== requestedCli);
  // The newest not-yet-live pane for this CLI. Older empty slots stay off the bar.
  const startingPane = switching
    ? [...allPanes].reverse().find((p) => !p.tty && p.cliId === requestedCli && Boolean(p.launchCommand))
    : undefined;
  const tabPanes = allPanes.filter((p) => p.tty || p.id === startingPane?.id);

  const allPanesRef = useRef(allPanes);
  allPanesRef.current = allPanes;

  useEffect(() => {
    if (!requestedCli) {
      startingCliRef.current = null;
      return;
    }
    if (focusedCli === requestedCli) {
      startingCliRef.current = null;
      setRequestedCli(null);
      return;
    }
    const hasPending = (rows: Pane[]) => rows.some(
      (p) => !p.tty && p.cliId === requestedCli && Boolean(p.launchCommand),
    );
    if (hasPending(allPanes)) return;
    // The pane is added in the same click as requestedCli. If it is still
    // missing after this turn, the spawn was refused or removed.
    const timer = window.setTimeout(() => {
      if (hasPending(allPanesRef.current)) return;
      if (startingCliRef.current !== requestedCli) return;
      startingCliRef.current = null;
      setRequestedCli((current) => (current === requestedCli ? null : current));
    }, 50);
    return () => window.clearTimeout(timer);
  }, [requestedCli, focusedCli, allPanes]);

  useEffect(() => {
    if (requestedCli) return;
    if (catalogHas(focusedCli)) setPendingCli(focusedCli);
  }, [focusedCli, requestedCli]);

  useEffect(() => {
    setMenuModel('');
  }, [pendingCli, focusedPane?.tty]);

  useEffect(() => {
    let cancelled = false;
    fetchCliInstalled()
      .then((map) => {
        if (!cancelled) setInstalled(map);
      })
      .catch(() => {
        if (!cancelled) setInstalled(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cli = cliById(pendingCli);
    if (!cli) {
      setModels([]);
      setModelsLoading(false);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    setModels([]);
    const load = cli.list === 'static'
      ? Promise.resolve(cli.staticModels)
      : cli.list === 'opencode'
        ? fetchModels().then((d) => d.models.map((m) => ({ id: m.key, label: m.key })))
        : fetchCliModelRows(pendingCli);
    load
      .then((rows) => {
        if (!cancelled) setModels(rows);
      })
      .catch(() => {
        if (!cancelled) setModels(cli.staticModels);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingCli]);

  useEffect(() => {
    if (createNonce > 0) cliRef.current?.focus();
  }, [createNonce]);

  useEffect(() => {
    if (!switching || !sessionId) return;
    try { TerminalManager.get(sessionId)?.term.blur?.(); } catch { /* parked host */ }
  }, [switching, sessionId]);

  const cliMissing = (id: string) => installed ? installed[id] === false : false;

  const focusOrStartCli = (cliId: string) => {
    if (cliMissing(cliId)) {
      onToast(`${cliById(cliId)?.label || cliId} is not installed`, true);
      return;
    }
    setPendingCli(cliId);
    setMenuModel('');
    setModels([]);
    setModelsLoading(true);
    const live = allPanes.filter((p) => p.tty && sessionCatalogCli(p, terminals[p.tty]) === cliId);
    const current = live.find((p) => p.tty === focusedTerminal) || live[live.length - 1];
    if (current?.tty) {
      startingCliRef.current = null;
      setRequestedCli(null);
      onSelectTerminal(current.tty);
      onSelectPane(current.id);
      return;
    }
    const binary = cliById(cliId)?.binary || '';
    if (!binary) {
      onToast('Pick a CLI and a model', true);
      return;
    }
    startingCliRef.current = cliId;
    setRequestedCli(cliId);
    // reusePending retargets a CLI that is already starting, instead of spawning a second PTY.
    onCreateSession(cliId, '', true, binary, true);
  };

  const paneKey = panes.map((p) => p.tty).join('|');
  useEffect(() => {
    if (focusedTerminal && panes.some((p) => p.tty === focusedTerminal)) return;
    const first = panes[0];
    if (first?.tty) {
      onSelectTerminal(first.tty);
      onSelectPane(first.id);
    }
    // Follow the active workspace's panes. Callbacks are stable setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id, paneKey]);

  const paneModel = focusedPane?.cliId === pendingCli ? (focusedPane.modelId || '').trim() : '';
  const menuModels: CliModelOption[] = paneModel && !models.some((m) => m.id === paneModel)
    ? [{ id: paneModel, label: paneModel }, ...models]
    : models;
  const chosenMenuModel = menuModels.some((m) => m.id === menuModel)
    ? menuModel
    : (paneModel && menuModels.some((m) => m.id === paneModel) ? paneModel : '');
  const modelPlaceholder = modelsLoading
    ? 'Loading models…'
    : menuModels.length === 0
      ? 'No models returned'
      : 'Select model';
  const cwd = activeWorkspace?.projectPath || '';

  const resolveModelId = (): string => {
    const custom = customModel.trim();
    if (custom) return custom;
    const fromMenu = (modelSelectRef.current?.value || '').trim();
    if (fromMenu && menuModels.some((m) => m.id === fromMenu)) return fromMenu;
    if (paneModel) return paneModel;
    return '';
  };

  const launch = (modelId: string, forceNew: boolean, commandOverride?: string) => {
    if (!pendingCli) {
      onToast('Pick a CLI and a model', true);
      return;
    }
    if (cliMissing(pendingCli)) {
      onToast(`${cliById(pendingCli)?.label || pendingCli} is not installed`, true);
      return;
    }
    if (commandOverride) onCreateSession(pendingCli, modelId, forceNew, commandOverride);
    else onCreateSession(pendingCli, modelId, forceNew);
    setCustomModel('');
  };

  const onUseModel = () => {
    const model = resolveModelId();
    if (!model) {
      onToast('Pick a CLI and a model', true);
      return;
    }
    launch(model, panes.length === 0);
  };

  const onNewSession = () => {
    const model = resolveModelId();
    if (model) {
      launch(model, true);
      return;
    }
    if (sessionCatalogCli(focusedPane, entry) === pendingCli) {
      const binary = cliById(pendingCli)?.binary || '';
      if (!binary) {
        onToast('Pick a CLI and a model', true);
        return;
      }
      launch('', true, fallbackLaunchCommand(focusedPane?.launchCommand, binary));
      return;
    }
    onToast('Pick a CLI and a model', true);
  };

  const colorScheme = isLightTheme(t) ? 'light' : 'dark';
  const selectStyle: CSSProperties = {
    height: 30,
    fontSize: 12,
    padding: '0 8px',
    borderRadius: 6,
    border: `1px solid ${t.colors.border.subtle}`,
    background: t.colors.bg.elevated,
    color: t.colors.text.primary,
    maxWidth: 280,
    colorScheme,
  };

  const creator = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
      <select
        ref={cliRef}
        aria-label="CLI"
        value={shownCli}
        onChange={(e) => focusOrStartCli(e.target.value)}
        style={selectStyle}
      >
        {CLI_CATALOG.map((cli) => (
          <option key={cli.id} value={cli.id} disabled={cliMissing(cli.id)}>
            {cli.label}{cliMissing(cli.id) ? ' (not installed)' : ''}
          </option>
        ))}
      </select>
      <select
        ref={modelSelectRef}
        aria-label="Model"
        value={chosenMenuModel}
        onChange={(e) => {
          const model = e.target.value.trim();
          setMenuModel(model);
          if (!model) return;
          launch(model, false);
        }}
        style={selectStyle}
      >
        <option value="">{modelPlaceholder}</option>
        {menuModels.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      <input
        aria-label="Custom model id"
        value={customModel}
        placeholder="Custom model id"
        onChange={(e) => setCustomModel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onUseModel();
          }
        }}
        style={{ ...selectStyle, width: 180 }}
      />
      <button
        type="button"
        onClick={onUseModel}
        style={{
          height: 30,
          padding: '0 10px',
          borderRadius: 6,
          border: `1px solid ${t.colors.accent.primary}`,
          background: t.colors.accent.primary,
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {panes.length ? 'Use model' : 'Start'}
      </button>
      {panes.length > 0 && (
        <button
          type="button"
          title="New session with this CLI and model"
          onClick={onNewSession}
          style={{
            height: 30,
            padding: '0 8px',
            borderRadius: 6,
            border: `1px solid ${t.colors.border.subtle}`,
            background: t.colors.bg.elevated,
            color: t.colors.text.primary,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Plus size={13} />
          New
        </button>
      )}
      {cwd ? (
        <span style={{ fontSize: 11, color: t.colors.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cwd}
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="chat-page" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: t.colors.bg.primary }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {tabPanes.map((pane) => {
          const tty = pane.tty || '';
          const row = tty ? terminals[tty] : undefined;
          const label = paneLabel(pane, row);
          const active = switching
            ? pane.id === startingPane?.id
            : tty === focusedTerminal;
          return (
            <div
              key={pane.id}
              onClick={() => {
                if (!tty) {
                  onSelectPane(pane.id);
                  return;
                }
                startingCliRef.current = null;
                setRequestedCli(null);
                onSelectTerminal(tty);
                onSelectPane(pane.id);
              }}
              onDoubleClick={() => {
                if (!tty) return;
                setEditingTty(tty);
                setRenameDraft(label);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                flexShrink: 0,
                background: active ? t.colors.bg.elevated : 'transparent',
                border: `1px solid ${active ? t.colors.border.primary : 'transparent'}`,
                color: active ? t.colors.text.primary : t.colors.text.secondary,
                fontSize: 12,
                maxWidth: 240,
              }}
            >
              <CliLogo cli={pane.cliId || row?.cli} size={13} />
              {editingTty === tty ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => {
                    const name = renameDraft.trim();
                    if (name) onRenameTerminal(tty, name);
                    setEditingTty(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditingTty(null);
                  }}
                  style={{ width: 120, fontSize: 12, background: t.colors.bg.primary, color: t.colors.text.primary, border: `1px solid ${t.colors.border.subtle}`, borderRadius: 4, padding: '1px 4px' }}
                />
              ) : (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              )}
              {panes.length > 1 && (
                <button
                  type="button"
                  aria-label="Close session"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!tty && pane.cliId === requestedCli) {
                      startingCliRef.current = null;
                      setRequestedCli(null);
                    }
                    onRemovePane(pane.id);
                  }}
                  style={{ border: 'none', background: 'transparent', color: t.colors.text.muted, cursor: 'pointer', padding: 0, display: 'flex' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: t.colors.text.muted, flexShrink: 0 }}>
          {tabPanes.length} {tabPanes.length === 1 ? 'tab' : 'tabs'}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 10px',
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          flexShrink: 0,
          position: 'relative',
          zIndex: 2,
        }}
      >
        {creator}
        <button
          type="button"
          aria-pressed={termOpen}
          onMouseDown={(e) => {
            // preventDefault keeps xterm from taking the press. WebKit then
            // drops the click, so the toggle itself lives here.
            e.preventDefault();
            e.stopPropagation();
            setTermOpen((open) => {
              if (open && sessionId) {
                try { TerminalManager.get(sessionId)?.term.blur?.(); } catch {}
              }
              return !open;
            });
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          disabled={!sessionId}
          title={termOpen ? 'Hide terminal' : 'Show terminal'}
          style={{
            height: 30,
            padding: '0 10px',
            borderRadius: 6,
            flexShrink: 0,
            border: `1px solid ${termOpen ? t.colors.accent.primary : t.colors.border.subtle}`,
            background: termOpen ? t.colors.accent.light : 'transparent',
            color: termOpen ? t.colors.accent.primary : t.colors.text.secondary,
            fontSize: 12,
            cursor: sessionId ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <TerminalSquare size={13} />
          Terminal
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
        {sessionId && entry && !switching ? (
          <AgentChatPanel
            key={sessionId}
            sessionId={sessionId}
            entry={entry}
            variant="page"
            modelLabel={focusedPane?.modelId}
            cliHint={focusedPane?.cliId}
            onClose={() => {}}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: t.colors.text.muted }}>
            <MessageSquare size={36} strokeWidth={1.25} />
            <div style={{ fontSize: 14, color: t.colors.text.primary }}>
              {switching ? `Starting ${cliById(requestedCli || '')?.label || 'session'}…` : sessionId ? 'Starting session…' : 'Chat'}
            </div>
            <div style={{ fontSize: 12, maxWidth: 360, textAlign: 'center' }}>
              {switching
                ? 'This CLI is opening on the workspace. The chat and the terminal attach as soon as the session is live.'
                : sessionId
                ? 'This workspace pane is coming up. The composer attaches as soon as the terminal is live.'
                : 'Choose a CLI and a model. That pair becomes a session on this workspace, the same session the terminal uses.'}
            </div>
          </div>
        )}
        {termOpen && switching && (
          <div style={{ width: '46%', minWidth: 280, borderLeft: `1px solid ${t.colors.border.subtle}`, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', overflow: 'hidden', zIndex: 0, alignItems: 'center', justifyContent: 'center', color: t.colors.text.muted, fontSize: 12 }}>
            Starting {cliById(requestedCli || '')?.label || 'session'}…
          </div>
        )}
        {termOpen && !switching && sessionId && (
          <div style={{ width: '46%', minWidth: 280, borderLeft: `1px solid ${t.colors.border.subtle}`, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', overflow: 'hidden', zIndex: 0 }}>
            <TerminalAnchor sessionId={sessionId} />
          </div>
        )}
      </div>
    </div>
  );
}
