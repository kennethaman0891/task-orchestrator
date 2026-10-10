// Developer City — ProjectPanel: the interaction panel shown when a
// building is selected. Real data only: project record + live agents.
// The prominent CONTINUE action hands off to the classic workspace view.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useCityStore } from '@/city/store';
import { patchProject } from '@/city/api';
import { useTheme } from '@/contexts/ThemeContext';
import { PROJECT_TYPE_LABELS, projectDisplayName, type AgentBot, type Project } from '@/city/types';

const STATUS_COLOR: Record<string, string> = {
  active: '#22c55e',
  paused: '#94a3b8',
  archived: '#64748b',
};

const HEALTH_LABEL: Record<string, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  failed: 'Failing',
  unknown: 'Unknown',
};

export function ProjectPanel({
  onContinue,
  onNewSession,
  onEnterBuilding,
  onEditBuilding,
  onToast,
}: {
  onContinue: (p: Project) => void;
  onNewSession: (p: Project) => void;
  onEnterBuilding: (p: Project) => void;
  onEditBuilding: (p: Project) => void;
  onToast?: (msg: string, error?: boolean) => void;
}) {
  const { theme: t } = useTheme();
  const selected = useCityStore((s) => s.selectedProjectId);
  const projects = useCityStore((s) => s.projects);
  const agents = useCityStore((s) => s.agents);
  const selectProject = useCityStore((s) => s.selectProject);
  const upsertProject = useCityStore((s) => s.upsertProject);
  const activeWorkspacePath = useCityStore((s) => s.activeWorkspacePath);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [nameBusy, setNameBusy] = useState(false);

  const p: Project | undefined = selected ? projects[selected] : undefined;
  if (!p) return null;
  const isCurrentWs = !!activeWorkspacePath && activeWorkspacePath === p.path;

  const saveName = async () => {
    const nm = draftName.trim();
    if (!nm) return;
    setNameBusy(true);
    try {
      const rec = await patchProject(p.id, { name: nm });
      upsertProject(rec);
      setRenaming(false);
      onToast?.(`Building renamed to “${nm}”`);
    } catch (err) {
      onToast?.(`Rename failed: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setNameBusy(false);
    }
  };

  const mine: AgentBot[] = Object.values(agents).filter((a) => a.projectPath === p.path);
  const recent = mine
    .flatMap((a) => a.recentActions.map((ra) => `${a.name}: ${ra}`))
    .slice(-6);

  const card: CSSProperties = {
    position: 'absolute',
    top: 64,
    right: 12,
    width: 300,
    maxHeight: 'calc(100% - 140px)',
    overflowY: 'auto',
    background: 'rgba(10,12,20,0.92)',
    border: `1px solid ${t.colors.border.primary}`,
    borderRadius: 12,
    backdropFilter: 'blur(10px)',
    color: t.colors.text.primary,
    zIndex: 25,
    padding: 14,
    fontSize: 13,
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          {renaming ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                style={{
                  flex: 1, minWidth: 0, background: t.colors.bg.tertiary,
                  border: `1px solid ${t.colors.accent.primary}`, borderRadius: 6,
                  color: t.colors.text.primary, fontSize: 13, padding: '3px 6px',
                }}
              />
              <button onClick={saveName} disabled={nameBusy} style={{ ...ghostBtn(t), flex: 'none', padding: '3px 8px' }}>
                {nameBusy ? '…' : 'Save'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {projectDisplayName(p)}
              </span>
              <button
                onClick={() => {
                  setDraftName(p.name || projectDisplayName(p));
                  setRenaming(true);
                }}
                title="Rename building"
                style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer', fontSize: 12, padding: 0 }}
              >
                ✎
              </button>
            </div>
          )}
          <div style={{ color: t.colors.text.muted, fontSize: 11, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>{PROJECT_TYPE_LABELS[p.type]} · {HEALTH_LABEL[p.health] ?? p.health}</span>
            {isCurrentWs && (
              <span style={{
                padding: '0 6px', borderRadius: 999, fontSize: 9, letterSpacing: 0.5,
                background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.6)',
                color: '#4ade80', textTransform: 'uppercase',
              }}>
                current workspace
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => selectProject(null)}
          style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer', fontSize: 16, padding: 2 }}
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: STATUS_COLOR[p.status] || '#888', display: 'inline-block',
          }}
        />
        <span style={{ fontSize: 12, color: t.colors.text.secondary }}>{p.status}</span>
        {p.path && <span style={{ fontSize: 11, color: t.colors.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.path}>{p.path}</span>}
      </div>

      {p.deploy && (
        <div style={{ marginTop: 6, fontSize: 11, color: t.colors.text.muted }}>
          deploy: {String(p.deploy.lastStatus ?? p.deploy.target ?? '—')}
          {p.deploy.maintenance ? ' · maintenance mode' : ''}
        </div>
      )}

      {p.building.customModel3d?.enabled && (
        <div style={{ marginTop: 8, padding: '5px 8px', borderRadius: 6, background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>🏛️</span>
          <div style={{ flex: 1, fontSize: 11, color: '#93c5fd' }}>
            Custom 3D Model: <strong style={{ textTransform: 'capitalize' }}>{p.building.customModel3d.placement || 'rooftop'}</strong>
          </div>
          <button
            onClick={() => onEditBuilding(p)}
            style={{ background: 'transparent', border: 'none', color: '#60a5fa', fontSize: 10, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            Configure
          </button>
        </div>
      )}

      <div style={{ marginTop: 10, fontWeight: 600, fontSize: 11, letterSpacing: 1, color: t.colors.text.muted }}>
        ACTIVE AGENTS ({mine.length})
      </div>
      {mine.length === 0 && (
        <div style={{ fontSize: 12, color: t.colors.text.muted, marginTop: 4 }}>No agents in this building right now.</div>
      )}
      {mine.map((a) => (
        <div key={a.id} style={{ marginTop: 6, padding: '6px 8px', borderRadius: 8, background: t.colors.bg.tertiary, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{a.name}{a.model ? ` · ${a.model}` : ''}</span>
            <span style={{ color: agentColor(a.status, t.colors) }}>{a.status}</span>
          </div>
          {a.currentTask && <div style={{ color: t.colors.text.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.currentTask}</div>}
          {a.room && <div style={{ color: t.colors.text.muted, fontSize: 11 }}>in {a.room}</div>}
        </div>
      ))}

      {recent.length > 0 && (
        <>
          <div style={{ marginTop: 10, fontWeight: 600, fontSize: 11, letterSpacing: 1, color: t.colors.text.muted }}>RECENT ACTIVITY</div>
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {recent.map((ra, i) => (
              <div key={i} style={{ fontSize: 11, color: t.colors.text.secondary }}>{ra}</div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
        <button
          onClick={() => onContinue(p)}
          style={{
            background: t.colors.accent.primary, color: '#fff', border: 'none', borderRadius: 8,
            padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ▶ Continue in workspace
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={ghostBtn(t)} onClick={() => onEnterBuilding(p)}>Enter building</button>
          <button style={ghostBtn(t)} onClick={() => onNewSession(p)}>New session</button>
          <button style={ghostBtn(t)} onClick={() => onEditBuilding(p)}>Edit building</button>
        </div>
      </div>
    </div>
  );
}

function ghostBtn(t: any): CSSProperties {
  return {
    flex: 1,
    background: 'transparent',
    border: `1px solid ${t.colors.border.primary}`,
    color: t.colors.text.secondary,
    borderRadius: 8,
    padding: '8px 6px',
    fontSize: 11,
    cursor: 'pointer',
  };
}

function agentColor(status: string, c: any): string {
  switch (status) {
    case 'working': return '#f59e0b';
    case 'thinking': return '#60a5fa';
    case 'waiting': return '#fbbf24';
    case 'completed': return '#22c55e';
    case 'failed': return '#f43f5e';
    default: return c?.text?.muted || '#94a3b8';
  }
}
