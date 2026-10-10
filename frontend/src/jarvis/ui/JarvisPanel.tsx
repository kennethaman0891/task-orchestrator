// ═══════════════════════════════════════════════════════════════════════════
// JARVIS TERMINAL INSPECTION PANEL (Phase 2 & Phase 3)
// Slide-over drawer displaying assigned Jarvis agent state, permissions & memory.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useState, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { SessionContext, JarvisPermission, JarvisStatus } from '../types';
import { jarvisManager } from '../agent/JarvisManager';
import { buttonBase, buttonSize, buttonVariant, inputBase, scrollbarStyle } from '@/lib/theme';
import {
  X,
  Shield,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle,
  Sparkles,
  Bot,
} from 'lucide-react';

interface Props {
  terminalId: string;
  context?: SessionContext;
  onClose: () => void;
  onToast: (msg: string, error?: boolean) => void;
}

const ALL_PERMISSIONS: JarvisPermission[] = ['OBSERVE', 'READ', 'EXECUTE', 'CONTROL'];

export function JarvisPanel({ terminalId, context, onClose, onToast }: Props) {
  const { theme: t } = useTheme();
  const agent = jarvisManager.getAgent(terminalId);

  const [status, setStatus] = useState<JarvisStatus>(agent.status);
  const [permissions, setPermissions] = useState<JarvisPermission[]>(Array.from(agent.permissions));
  const [memory, setMemory] = useState(agent.workingMemory);
  const [busy, setBusy] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');

  useEffect(() => {
    return jarvisManager.subscribe(() => {
      setStatus(agent.status);
      setPermissions(Array.from(agent.permissions));
      setMemory(agent.workingMemory);
    });
  }, [agent]);

  const togglePermission = (perm: JarvisPermission) => {
    const next = permissions.includes(perm)
      ? permissions.filter((p) => p !== perm)
      : [...permissions, perm];
    agent.setPermissions(next);
    setPermissions(next);
    onToast(`Updated permissions: ${next.join(', ')}`);
  };

  const handleAssign = () => {
    agent.assign(['OBSERVE', 'READ', 'EXECUTE', 'CONTROL'], context);
    onToast('Jarvis assigned to terminal');
  };

  const handleAssignTask = async () => {
    if (!taskDraft.trim()) return;
    setBusy(true);
    try {
      await jarvisManager.assignTask(terminalId, taskDraft.trim());
      onToast(`Assigned task: "${taskDraft.trim()}"`);
      setTaskDraft('');
    } finally {
      setBusy(false);
    }
  };

  const handleUnassign = () => {
    agent.unassign();
    onToast('Jarvis unassigned');
  };

  const handleContinue = async () => {
    setBusy(true);
    try {
      await agent.continueTask();
      onToast('Instructed Jarvis to continue task');
    } finally {
      setBusy(false);
    }
  };

  const handleRunTests = async () => {
    setBusy(true);
    try {
      await agent.runTests(context?.cwd);
      onToast('Started test execution');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    await agent.stop();
    onToast('Process interrupted');
  };

  const getStatusColor = (st: JarvisStatus) => {
    switch (st) {
      case 'WORKING': return t.colors.accent.primary;
      case 'WAITING': return t.colors.warning.primary;
      case 'OBSERVING': return t.colors.info.primary;
      case 'ERROR': return t.colors.danger.primary;
      case 'COMPLETED': return t.colors.success.primary;
      case 'NEEDS_APPROVAL': return t.colors.warning.primary;
      default: return t.colors.text.muted;
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 440,
        backgroundColor: t.colors.bg.secondary,
        borderLeft: `1px solid ${t.colors.border.primary}`,
        boxShadow: t.shadow.xl,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        color: t.colors.text.primary,
        fontSize: t.fontSize.sm,
      }}
    >
      {/* ── Panel Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          backgroundColor: t.colors.bg.primary,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: t.borderRadius.md,
              backgroundColor: t.colors.accent.light,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: t.colors.accent.primary,
            }}
          >
            <Bot size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              Jarvis Agent · {context?.terminalName || terminalId}
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: t.borderRadius.full,
                  backgroundColor: `${getStatusColor(status)}20`,
                  color: getStatusColor(status),
                  border: `1px solid ${getStatusColor(status)}40`,
                }}
              >
                {status}
              </span>
            </div>
            <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.muted }}>
              {context?.cliName || 'Shell'} · {context?.workspaceName || 'Workspace'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            ...buttonBase(t),
            ...buttonSize(t, 'sm'),
            ...buttonVariant(t, 'ghost'),
            padding: 4,
            height: 'auto',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Scrollable Body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, ...scrollbarStyle(t) }}>
        {/* Assignment Action Banner */}
        {status === 'UNASSIGNED' ? (
          <div
            style={{
              padding: 16,
              borderRadius: t.borderRadius.md,
              backgroundColor: t.colors.bg.tertiary,
              border: `1px dashed ${t.colors.border.primary}`,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Sparkles size={24} style={{ color: t.colors.accent.primary }} />
            <div>
              <div style={{ fontWeight: 600 }}>Assign Jarvis to this Terminal</div>
              <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.muted, marginTop: 2 }}>
                Jarvis will reconstruct the session context, observe terminal activity, and assist with development tasks.
              </div>
            </div>
            <button
              type="button"
              style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'primary') }}
              onClick={handleAssign}
            >
              Assign Jarvis
            </button>
          </div>
        ) : (
          /* Active Controls Bar */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Direct Task Assignment Bar */}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                placeholder="Assign new task / command..."
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAssignTask(); }}
                style={{ ...inputBase(t), flex: 1, fontSize: t.fontSize.xs, height: '30px' }}
              />
              <button
                type="button"
                disabled={busy || !taskDraft.trim()}
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'primary'), height: '30px', padding: '0 12px' }}
                onClick={handleAssignTask}
              >
                Assign
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={busy}
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'secondary'), flex: 1 }}
                onClick={handleContinue}
              >
                <Play size={12} /> Continue
              </button>
              <button
                type="button"
                disabled={busy}
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'secondary') }}
                onClick={handleRunTests}
              >
                Run Tests
              </button>
              <button
                type="button"
                style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'danger') }}
                onClick={handleStop}
                title="Interrupt process"
              >
                <Pause size={12} /> Stop
              </button>
            </div>
          </div>
        )}

        {/* ── Permissions Card ── */}
        <div
          style={{
            padding: 14,
            borderRadius: t.borderRadius.md,
            backgroundColor: t.colors.bg.primary,
            border: `1px solid ${t.colors.border.subtle}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: t.fontSize.xs, textTransform: 'uppercase', letterSpacing: '0.05em', color: t.colors.text.muted, marginBottom: 10 }}>
            <Shield size={13} />
            Permission Hierarchy
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {ALL_PERMISSIONS.map((perm) => {
              const enabled = permissions.includes(perm);
              return (
                <label
                  key={perm}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: t.borderRadius.sm,
                    backgroundColor: enabled ? t.colors.accent.light : t.colors.bg.tertiary,
                    border: `1px solid ${enabled ? t.colors.accent.primary : 'transparent'}`,
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => togglePermission(perm)}
                  />
                  <span style={{ fontSize: t.fontSize.xs, fontWeight: 500, color: enabled ? t.colors.accent.primary : t.colors.text.primary }}>
                    {perm}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* ── Working Memory ── */}
        <div
          style={{
            padding: 14,
            borderRadius: t.borderRadius.md,
            backgroundColor: t.colors.bg.primary,
            border: `1px solid ${t.colors.border.subtle}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: t.fontSize.xs, textTransform: 'uppercase', letterSpacing: '0.05em', color: t.colors.text.muted }}>
              Working Memory
            </span>
            <span style={{ fontSize: '11px', color: t.colors.text.muted }}>
              {context?.cwd}
            </span>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: t.colors.text.muted }}>CURRENT TASK</div>
            <div style={{ fontWeight: 500, color: t.colors.text.primary, marginTop: 2 }}>
              {memory.task}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: t.colors.text.muted }}>CURRENT ACTIVITY</div>
            <div style={{ color: t.colors.text.secondary, marginTop: 2 }}>
              {memory.currentActivity}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '11px', color: t.colors.text.muted }}>NEXT EXPECTED ACTION</div>
            <div style={{ color: t.colors.accent.primary, fontWeight: 500, marginTop: 2 }}>
              {memory.nextExpectedAction}
            </div>
          </div>

          {memory.filesChanged.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: t.colors.text.muted, marginBottom: 4 }}>FILES INVOLVED</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {memory.filesChanged.map((file) => (
                  <span
                    key={file}
                    style={{
                      fontFamily: t.fontFamily.mono,
                      fontSize: '11px',
                      padding: '2px 6px',
                      borderRadius: t.borderRadius.sm,
                      backgroundColor: t.colors.bg.tertiary,
                    }}
                  >
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )}

          {memory.errors.length > 0 && (
            <div
              style={{
                padding: 10,
                borderRadius: t.borderRadius.sm,
                backgroundColor: `${t.colors.danger.primary}15`,
                border: `1px solid ${t.colors.danger.primary}40`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: t.colors.danger.primary, fontWeight: 600, fontSize: '11px', marginBottom: 4 }}>
                <AlertTriangle size={12} />
                DETECTED ERROR
              </div>
              <div style={{ fontSize: t.fontSize.xs, color: t.colors.danger.primary, fontFamily: t.fontFamily.mono }}>
                {memory.errors[0]}
              </div>
            </div>
          )}
        </div>

        {/* ── Activity Timeline ── */}
        <div
          style={{
            padding: 14,
            borderRadius: t.borderRadius.md,
            backgroundColor: t.colors.bg.primary,
            border: `1px solid ${t.colors.border.subtle}`,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: t.fontSize.xs, textTransform: 'uppercase', letterSpacing: '0.05em', color: t.colors.text.muted, marginBottom: 10 }}>
            Activity Timeline
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {memory.timeline.length === 0 ? (
              <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.muted }}>
                No recorded actions yet
              </div>
            ) : (
              memory.timeline.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: t.fontSize.xs }}>
                  <div style={{ marginTop: 2, color: item.status === 'failed' ? t.colors.danger.primary : t.colors.success.primary }}>
                    {item.status === 'failed' ? <AlertTriangle size={12} /> : <CheckCircle size={12} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: t.colors.text.primary }}>{item.title}</div>
                    <div style={{ fontSize: '10px', color: t.colors.text.muted }}>
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Unassign Option */}
        {status !== 'UNASSIGNED' && (
          <div style={{ paddingTop: 8, textAlign: 'center' }}>
            <button
              type="button"
              style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), color: t.colors.text.muted }}
              onClick={handleUnassign}
            >
              Unassign Jarvis from this Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
