// Developer City — AgentPanel: select a bot → its real info.
// Every field maps to live data (terminal, model, task, logs tail).

import type { CSSProperties } from 'react';
import { useCityStore } from '@/city/store';
import { useTheme } from '@/contexts/ThemeContext';
import type { TerminalEntry } from '@/types';

export function AgentPanel({
  terminals,
  onOpenTerminal,
}: {
  terminals: Record<string, TerminalEntry>;
  onOpenTerminal?: (terminalId: string) => void;
}) {
  const { theme: t } = useTheme();
  const selectedAgentId = useCityStore((s) => s.selectedAgentId);
  const agents = useCityStore((s) => s.agents);
  const selectAgent = useCityStore((s) => s.selectAgent);

  const bot = selectedAgentId ? agents[selectedAgentId] : null;
  if (!bot) return null;
  const entry = terminals[bot.terminalId];

  const statusColor: Record<string, string> = {
    idle: '#94a3b8', thinking: '#60a5fa', working: '#f59e0b',
    waiting: '#fbbf24', completed: '#22c55e', failed: '#f43f5e', offline: '#475569',
  };

  const panel: CSSProperties = {
    position: 'absolute',
    left: 12, bottom: 12,
    width: 320, maxHeight: '52%',
    overflowY: 'auto',
    background: 'rgba(10,12,20,0.94)',
    border: `1px solid ${t.colors.border.primary}`,
    borderRadius: 12,
    backdropFilter: 'blur(10px)',
    color: t.colors.text.primary,
    zIndex: 28,
    padding: 14, fontSize: 12,
  };
  const row: CSSProperties = { display: 'flex', gap: 8, marginTop: 5 };
  const k: CSSProperties = { color: t.colors.text.muted, minWidth: 84, fontSize: 11 };

  const logTail = (entry?.live_output || '').split('\n').filter(Boolean).slice(-4);

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{bot.name} <span style={{ color: statusColor[bot.status], fontSize: 11 }}>· {bot.status}</span></div>
        <button onClick={() => selectAgent(null)} style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      {bot.currentTask && (
        <div style={{ marginTop: 8, background: t.colors.bg.tertiary, borderRadius: 8, padding: '6px 8px' }}>
          <div style={{ ...k, color: t.colors.text.muted }}>CURRENT TASK</div>
          <div style={{ marginTop: 2 }}>{bot.currentTask}</div>
          {bot.progress > 0 && (
            <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: t.colors.bg.input }}>
              <div style={{ height: 4, borderRadius: 2, width: `${Math.round(bot.progress * 100)}%`, background: statusColor[bot.status] }} />
            </div>
          )}
        </div>
      )}

      <div style={row}><span style={k}>MODEL</span><span>{bot.model || '—'}</span></div>
      <div style={row}><span style={k}>SESSION</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bot.sessionId}</span></div>
      <div style={row}><span style={k}>TERMINAL</span><span>{entry?.session_name || entry?.pane_title || bot.terminalId}</span></div>
      <div style={row}><span style={k}>TOOLS</span><span>{bot.tools.join(', ') || '—'}</span></div>
      <div style={row}><span style={k}>ROOM</span><span>{bot.room || 'common area'}</span></div>

      {bot.recentActions.length > 0 && (
        <>
          <div style={{ ...k, marginTop: 10, color: t.colors.text.muted, display: 'block' }}>RECENT ACTIONS</div>
          {bot.recentActions.map((ra, i) => (
            <div key={i} style={{ fontSize: 11, color: t.colors.text.secondary, marginTop: 3 }}>{ra}</div>
          ))}
        </>
      )}

      {logTail.length > 0 && (
        <>
          <div style={{ ...k, marginTop: 10, color: t.colors.text.muted, display: 'block' }}>LOGS (last lines)</div>
          <pre style={{ margin: '4px 0 0', fontSize: 10, color: t.colors.text.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 90, overflow: 'hidden' }}>
            {logTail.join('\n')}
          </pre>
        </>
      )}

      <button
        onClick={() => onOpenTerminal?.(bot.terminalId)}
        style={{
          marginTop: 10, width: '100%',
          background: t.colors.accent.primary, color: '#fff', border: 'none',
          borderRadius: 8, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Open terminal
      </button>
    </div>
  );
}
