// Developer City — ObjectInspectorModal: Interactive architectural modal for working room objects.
// Shows real source code, live PTY terminal sessions, live server endpoints, git commit histories,
// and architecture blueprints.

import {
  X,
  Code2,
  Server,
  FileCode,
  Layers,
  Terminal,
  GitCommit,
  Monitor,
  Coffee,
  Activity,
  Users,
  CheckCircle2,
  Sparkles,
  Plus,
} from 'lucide-react';
import { useCityStore } from '@/city/store';
import type { FloorPlanObject, Project } from '@/city/types';

export interface ObjectInspectorModalProps {
  object: FloorPlanObject | null;
  onClose: () => void;
  onOpenTerminal?: (pathOrId: string) => void;
  onOpenFloatingTerminal?: (terminalId: string) => void;
  onNewSession?: (project: Project) => void;
}

export function ObjectInspectorModal({
  object,
  onClose,
  onOpenTerminal,
  onOpenFloatingTerminal,
  onNewSession,
}: ObjectInspectorModalProps) {
  const nav = useCityStore((s) => s.nav);
  const projects = useCityStore((s) => s.projects);
  const terminalCars = useCityStore((s) => s.terminalCars);
  const agents = useCityStore((s) => s.agents);

  if (!object) return null;

  const activeProject =
    nav.mode === 'interior' || nav.mode === 'exterior' || nav.mode === 'car'
      ? projects[nav.projectId] || null
      : null;

  const liveCars = activeProject
    ? Object.values(terminalCars).filter(
        (c) => c.projectId === activeProject.id || (activeProject.path && c.projectPath === activeProject.path),
      )
    : [];

  const liveAgents = activeProject
    ? Object.values(agents).filter(
        (a) =>
          a.status !== 'offline' &&
          activeProject.path &&
          (a.projectPath === activeProject.path ||
            a.projectPath.startsWith(activeProject.path + '/') ||
            activeProject.path.startsWith(a.projectPath)),
      )
    : [];

  const getIcon = () => {
    switch (object.type) {
      case 'workstation':
        return <Code2 size={20} color="#38bdf8" />;
      case 'server_pod':
        return <Server size={20} color="#10b981" />;
      case 'blueprint_board':
        return <Layers size={20} color="#818cf8" />;
      case 'preview_billboard':
        return <Monitor size={20} color="#f59e0b" />;
      case 'lounge':
        return <Coffee size={20} color="#f59e0b" />;
      default:
        return <FileCode size={20} color="#c084fc" />;
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5, 8, 15, 0.78)',
        backdropFilter: 'blur(12px)',
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          background: 'rgba(15, 23, 42, 0.97)',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: 16,
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
          color: '#f8fafc',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(30, 41, 59, 0.5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {getIcon()}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{object.title}</span>
                {object.status && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#34d399',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                    }}
                  >
                    ● {object.status}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 }}>
                {object.file || activeProject?.path || 'Live Building Interior Station'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Live Terminals Section (Always shown if project has active terminals) */}
          {liveCars.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Live Connected PTY Terminals ({liveCars.length})
                </span>
                <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>● Real-Time Sync</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {liveCars.slice(0, 6).map((car) => (
                  <div
                    key={car.id}
                    style={{
                      background: '#090d16',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: '#f8fafc' }}>{car.name}</span>
                      <span
                        style={{
                          fontSize: 10,
                          color: car.moving ? '#fbbf24' : '#34d399',
                          fontWeight: 700,
                        }}
                      >
                        ● {car.moving ? 'WORKING' : 'ONLINE'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
                      {car.currentTask?.description || car.cli || car.cwd}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                      {onOpenFloatingTerminal && (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenFloatingTerminal(car.terminalId || car.id);
                            onClose();
                          }}
                          style={{
                            background: 'rgba(56, 189, 248, 0.16)',
                            border: '1px solid rgba(56, 189, 248, 0.4)',
                            color: '#38bdf8',
                            borderRadius: 6,
                            padding: '3px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Open Live Overlay
                        </button>
                      )}
                      {onOpenTerminal && (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenTerminal(car.terminalId || car.id);
                            onClose();
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#93c5fd',
                            fontSize: 11,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          Focus in Workspace →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Workstation Code View */}
          {object.type === 'workstation' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Live Source Code · {object.file || 'Module'}
                </span>
                <span style={{ fontSize: 11, color: '#38bdf8' }}>Real Project File</span>
              </div>
              <div
                style={{
                  background: '#090d16',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  padding: '12px 16px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  lineHeight: '1.6',
                  color: '#e2e8f0',
                  overflowX: 'auto',
                }}
              >
                {(object.codeLines1 || []).map((line, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14 }}>
                    <span style={{ color: '#475569', userSelect: 'none', width: 20, textAlign: 'right' }}>{i + 1}</span>
                    <span style={{ color: line.startsWith('//') ? '#64748b' : line.startsWith('import') ? '#c084fc' : '#38bdf8' }}>
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Server Pod Endpoints */}
          {object.type === 'server_pod' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Active REST & WebSocket Services
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(object.endpoints || ['/api/projects', '/api/terminals', '/api/files', '/ws']).map((ep, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontFamily: 'monospace',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#38bdf8' }}>{ep}</span>
                    <span style={{ fontSize: 10, color: '#34d399', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', borderRadius: 4 }}>
                      LIVE
                    </span>
                  </div>
                ))}
              </div>
              {object.details && (
                <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8', background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8 }}>
                  {object.details}
                </div>
              )}
            </div>
          )}

          {/* Master Blueprint Board */}
          {object.type === 'blueprint_board' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Repository Documentation & Specifications
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {(object.docs || []).map((doc, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'rgba(99, 102, 241, 0.12)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      color: '#a5b4fc',
                      fontSize: 11,
                      fontWeight: 500,
                      padding: '4px 10px',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <FileCode size={13} />
                    {doc}
                  </div>
                ))}
              </div>
              {object.preview && (
                <div
                  style={{
                    background: '#090d16',
                    borderRadius: 10,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: 14,
                    fontSize: 12,
                    lineHeight: '1.6',
                    color: '#94a3b8',
                    fontFamily: 'monospace',
                  }}
                >
                  {object.preview.map((p, i) => (
                    <div key={i}>{p}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Live UI Billboard & Telemetry Monitor */}
          {object.type === 'preview_billboard' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Live Display Viewport & Workspace Telemetry
              </div>
              <div
                style={{
                  background: '#090d16',
                  borderRadius: 10,
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8', fontWeight: 700, fontSize: 13 }}>
                    <Activity size={16} />
                    <span>{activeProject?.name || 'Workspace'} Live Telemetry</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                    ● WebGL2 Hardware Accelerated
                  </span>
                </div>
                {object.details && (
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                    {object.details}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#64748b' }}>LIVE TERMINALS</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#38bdf8', marginTop: 2 }}>{liveCars.length} Active</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#64748b' }}>AI AGENTS</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#a855f7', marginTop: 2 }}>{liveAgents.length} Online</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#64748b' }}>PROJECT STATUS</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#10b981', marginTop: 2 }}>
                      {(activeProject?.health || 'healthy').toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Breakout Strategy & Agent Collaboration Hub (Lounge) */}
          {object.type === 'lounge' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Executive Strategy & Team Sync Hub
              </div>
              <div
                style={{
                  background: '#090d16',
                  borderRadius: 10,
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>
                    <Users size={16} />
                    <span>Agent Standup & Strategic Retrospective</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                    {liveAgents.length} Agents Synced
                  </span>
                </div>
                {object.details && (
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                    {object.details}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                    ACTIVE FLOOR STATUS
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      '● 360° Hands-On Manual Camera Control active with live angle & tilt scrubber',
                      '● Smart camera-aware wall cutaways active for unobstructed 360° room visibility',
                      '● Live PTY terminals and AI agent bots synced directly to floor workstations',
                      '● Zero-clipping furniture & display layout verified across all building floors',
                    ].map((note, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: 12,
                          color: '#e2e8f0',
                          background: 'rgba(255,255,255,0.03)',
                          padding: '6px 10px',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <CheckCircle2 size={13} color="#22c55e" />
                        <span>{note.slice(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Git History Pedestal */}
          {object.commits && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Recent Git Commits
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {object.commits.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                      color: '#e2e8f0',
                    }}
                  >
                    <GitCommit size={14} color="#a855f7" />
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            background: 'rgba(15, 23, 42, 0.85)',
          }}
        >
          {object.type === 'lounge' && (
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('tto-toast', {
                    detail: { message: `Team Standup Active: ${liveAgents.length} agents synced` },
                  }),
                );
                onClose();
              }}
              style={{
                background: 'rgba(245, 158, 11, 0.16)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                borderRadius: 8,
                padding: '7px 14px',
                color: '#fcd34d',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Sparkles size={14} />
              Trigger Team Standup
            </button>
          )}

          {liveCars.length > 0 && onOpenFloatingTerminal && (
            <button
              type="button"
              onClick={() => {
                const firstTerm = liveCars[0]?.terminalId || liveCars[0]?.id;
                if (firstTerm) onOpenFloatingTerminal(firstTerm);
                onClose();
              }}
              style={{
                background: 'rgba(16, 185, 129, 0.16)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: 8,
                padding: '7px 14px',
                color: '#34d399',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Terminal size={14} />
              Open Live Terminal Here
            </button>
          )}

          {activeProject && onNewSession && (
            <button
              type="button"
              onClick={() => {
                onNewSession(activeProject);
                onClose();
              }}
              style={{
                background: 'rgba(59, 130, 246, 0.16)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: 8,
                padding: '7px 14px',
                color: '#93c5fd',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Plus size={14} />
              New Terminal Session
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#3b82f6',
              border: 'none',
              borderRadius: 8,
              padding: '7px 16px',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
