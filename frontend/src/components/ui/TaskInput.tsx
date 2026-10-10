'use client';

import { useState, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { inputBase, buttonBase, buttonSize, buttonVariant, scrollbarStyle } from '@/lib/theme';
import { addTask, acceptSuggestedTask, dismissSuggestedTask } from '@/lib/api';
import type { Task } from '@/types';
import { Check, X, Sparkles, ListPlus } from 'lucide-react';

interface Props {
  tty: string | null;
  currentTask?: Task | null;
  suggestedTask?: string;
  queue?: Task[];
  history?: Task[];
  onToast?: (msg: string, error?: boolean) => void;
}

/** Task center — current task, queue, suggested task, and add-task input. */
export function TaskInput({ tty, currentTask, suggestedTask, queue, history, onToast }: Props) {
  const { theme: t } = useTheme();
  const [desc, setDesc] = useState('');

  const submit = useCallback(async () => {
    if (!tty || !desc.trim()) return;
    try {
      await addTask(tty, desc.trim());
      setDesc('');
      onToast?.('Task queued');
    } catch (err) {
      onToast?.(`Add task failed: ${(err as Error).message}`, true);
    }
  }, [tty, desc, onToast]);

  const accept = useCallback(async () => {
    if (!tty) return;
    try {
      await acceptSuggestedTask(tty);
      onToast?.('Suggested task accepted');
    } catch (err) {
      onToast?.(`Accept failed: ${(err as Error).message}`, true);
    }
  }, [tty, onToast]);

  const dismiss = useCallback(async () => {
    if (!tty) return;
    try {
      await dismissSuggestedTask(tty);
    } catch (err) {
      onToast?.(`Dismiss failed: ${(err as Error).message}`, true);
    }
  }, [tty, onToast]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.sm }}>
      {/* Suggested task */}
      {tty && suggestedTask && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: t.spacing.sm,
          background: t.colors.bg.hover, borderRadius: '4px',
          padding: t.spacing.sm,
        }}>
          <Sparkles size={12} style={{ color: t.colors.accent.primary, marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: t.fontSize.xs, lineHeight: 1.4 }}>
            <div style={{ color: t.colors.accent.primary, fontWeight: t.fontWeight.semibold, marginBottom: 2 }}>
              Suggested task
            </div>
            <div style={{ color: t.colors.text.secondary }}>{suggestedTask}</div>
          </div>
          <button
            onClick={accept}
            style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'primary'), flexShrink: 0 }}
            title="Accept"
          >
            <Check size={10} /> Accept
          </button>
          <button
            onClick={dismiss}
            style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), flexShrink: 0 }}
            title="Dismiss"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* Current task */}
      {tty && currentTask && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <div style={{ fontSize: t.fontSize.xxs, color: t.colors.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Current Task
          </div>
          <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.primary }}>{currentTask.description}</div>
        </div>
      )}

      {/* Queue */}
      {tty && queue && queue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: t.fontSize.xxs, color: t.colors.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Queue ({queue.length})
          </div>
          {queue.map((task) => (
            <div key={task.id} style={{ fontSize: t.fontSize.xxs, color: t.colors.text.secondary, display: 'flex', gap: 4 }}>
              <span style={{ color: t.colors.warning.primary }}>◦</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* History (done) */}
      {tty && history && history.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 80, overflow: 'auto', ...scrollbarStyle(t, false) }}>
          <div style={{ fontSize: t.fontSize.xxs, color: t.colors.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            History ({history.length})
          </div>
          {history.map((task) => (
            <div key={task.id} style={{ fontSize: t.fontSize.xxs, color: t.colors.text.muted, display: 'flex', gap: 4 }}>
              <span style={{ color: task.status === 'done' ? t.colors.success.primary : t.colors.danger.primary }}>•</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Add task input */}
      <div style={{ display: 'flex', gap: t.spacing.sm }}>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={tty ? 'Add a task for this terminal…' : 'Select a terminal to add tasks'}
          disabled={!tty}
          style={{ ...inputBase(t), flex: 1, height: '24px', fontSize: t.fontSize.xs }}
        />
        <button
          onClick={submit}
          disabled={!tty || !desc.trim()}
          style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'primary'), height: '24px' }}
          title="Queue task"
        >
          <ListPlus size={10} />
        </button>
      </div>
    </div>
  );
}