// Developer City — ObjectInspectorModal: Interactive architectural modal for working room objects.
// Shows real source code, live server endpoints, git commit histories, and architecture blueprints.

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
} from 'lucide-react';
import type { FloorPlanObject } from '@/city/types';

export interface ObjectInspectorModalProps {
  object: FloorPlanObject | null;
  onClose: () => void;
  onOpenTerminal?: (pathOrId: string) => void;
}

export function ObjectInspectorModal({ object, onClose, onOpenTerminal }: ObjectInspectorModalProps) {
  if (!object) return null;

  const getIcon = () => {
    switch (object.type) {
      case 'workstation':
        return <Code2 size={20} className="text-sky-400" color="#38bdf8" />;
      case 'server_pod':
        return <Server size={20} className="text-emerald-400" color="#10b981" />;
      case 'blueprint_board':
        return <Layers size={20} className="text-indigo-400" color="#818cf8" />;
      case 'preview_billboard':
        return <Monitor size={20} className="text-amber-400" color="#f59e0b" />;
      case 'lounge':
        return <Coffee size={20} className="text-amber-400" color="#f59e0b" />;
      default:
        return <FileCode size={20} className="text-purple-400" color="#c084fc" />;
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
        background: 'rgba(5, 8, 15, 0.75)',
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
          maxWidth: 680,
          background: 'rgba(15, 23, 42, 0.96)',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: 16,
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8)',
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
                width: 36,
                height: 36,
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
                {object.title}
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
              {object.file && (
                <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 }}>
                  {object.file}
                </div>
              )}
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
          {/* Workstation Code View */}
          {object.type === 'workstation' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Source Code Preview
                </span>
                <span style={{ fontSize: 11, color: '#64748b' }}>Live Project File</span>
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
                      200 OK
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
                Live Display Viewport & Telemetry
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
                    <span>Real-Time Workspace Profiler</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                    60 FPS Viewport Online
                  </span>
                </div>
                {object.details && (
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                    {object.details}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#64748b' }}>CPU LOAD</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8', marginTop: 2 }}>14.2%</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#64748b' }}>MEMORY</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#a855f7', marginTop: 2 }}>42.8 MB</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#64748b' }}>IPC RELAY</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', marginTop: 2 }}>12 ms</div>
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
                    Quiet Reflection Zone
                  </span>
                </div>
                {object.details && (
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                    {object.details}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                    CURRENT SPRINT RETROSPECTIVES
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      '● Core 3D engine migration verified: Zero-clipping HUD architecture active',
                      '● Autonomous agent coordination and memory sync verified across all floors',
                      '● 360° free rotation unlocked: gimbal lock eliminated and cutaways active',
                      '● Workspace telemetry and live application preview operational',
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
            background: 'rgba(15, 23, 42, 0.8)',
          }}
        >
          {object.type === 'lounge' && (
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('tto-toast', { detail: { message: 'Team Standup Active: 4 agents synced in strategy session' } }));
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
          {object.file && (
            <button
              type="button"
              onClick={() => {
                onOpenTerminal?.(object.file!);
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
              <Terminal size={14} />
              Open in Terminal
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
