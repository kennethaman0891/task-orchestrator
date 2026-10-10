// AgentChatPanel — the chat UI that sits ALONGSIDE a CLI running in the
// focused terminal (Claude Code, OpenCode, Codex, Gemini, Prime Agent, ...).
//
// Data (read):
//   1. OpenCode API (/api/opencode/sessions/{id}/messages) when sidecar DB is connected.
//   2. Live terminal stream & scrollback parsed via dialogueParser when running
//      Claude Code, Codex, Gemini, or whenever API messages are unavailable.
//   3. Real-time updates via TerminalManager.onOutput() event notifications.
// Data (write):
//   Message composer writes text + Enter (\r) straight into that terminal's
//   PTY via TerminalManager.sendCommand() — a true control channel into the
//   running CLI's prompt with zero session bifurcation.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { UnifiedTerminal, Task } from '@/types';
import { TerminalManager } from '@/terminal/TerminalManager';
import { CliLogo } from '@/lib/cliLogos';
import { detectCLI } from '@/jarvis/adapters';
import {
  parseTerminalDialogue,
  type UnifiedChatMessage,
  type UnifiedToolCall,
} from '@/terminal/dialogueParser';
import {
  X,
  Send,
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronUp,
  Brain,
  Wrench,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';

/** CLIs that run an agent conversation in the TUI — the chat panel applies
 *  to these (plus any session where process-scan or buffer detection finds an agent). */
export const AGENT_CLIS = new Set([
  'opencode',
  'claude',
  'claude-code',
  'codex',
  'codex-cli',
  'gemini',
  'gemini-cli',
  'prime',
  'prime-agent',
  'antigravity',
  'cursor',
  'cursor-agent',
  'qwen',
]);

export function isAgentCli(entry?: UnifiedTerminal, lines?: string[]): boolean {
  if (!entry) return false;
  const c = (entry.cli || '').toLowerCase().trim();
  if (AGENT_CLIS.has(c)) return true;
  if (Boolean(entry.opencode_running || entry.claude_running)) return true;
  const a = (entry.agent || '').toLowerCase().trim();
  if (AGENT_CLIS.has(a)) return true;
  const sn = (entry.session_name || '').toLowerCase().trim();
  for (const agent of AGENT_CLIS) {
    if (sn.includes(agent)) return true;
  }
  if (lines && lines.length > 0) {
    const detected = detectCLI(lines, entry.cli, entry.agent);
    if (detected && detected.cli && detected.cli !== 'shell' && detected.cli !== 'unknown') {
      return true;
    }
  }
  return false;
}

/** Live state pill for the panel header. */
function agentState(
  entry: UnifiedTerminal,
  parsedCliState?: string
): { label: string; color: string } {
  const oc = (entry as { opencode_status?: { state: string } }).opencode_status;
  if (oc?.state === 'working' || parsedCliState === 'running') {
    return { label: 'WORKING', color: '#22c55e' };
  }
  if (oc?.state === 'waiting' || parsedCliState === 'waiting_for_input') {
    return { label: 'WAITING', color: '#a855f7' };
  }
  if (parsedCliState === 'error') {
    return { label: 'ERROR', color: '#ef4444' };
  }
  const running = entry.opencode_running || entry.claude_running || oc?.state === 'working';
  if (running) return { label: 'ACTIVE', color: '#3b82f6' };
  if (isAgentCli(entry)) return { label: 'IDLE', color: '#6b7280' };
  return { label: 'OFF', color: '#374151' };
}

function TaskRow({ task, kind }: { task: Task; kind: 'current' | 'next' | 'queue' }) {
  const { theme: t } = useTheme();
  const color =
    task.status === 'done'
      ? '#22c55e'
      : task.status === 'blocked'
      ? '#ef4444'
      : kind === 'current'
      ? '#3b82f6'
      : t.colors.text.muted;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '4px 0' }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          marginTop: '5px',
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: kind === 'current' ? 600 : 400,
            color: t.colors.text.primary,
            wordBreak: 'break-word',
          }}
        >
          {task.description || '(untitled task)'}
        </div>
        <div
          style={{
            fontSize: 9,
            color: t.colors.text.muted,
            fontFamily: t.fontFamily.mono,
            textTransform: 'uppercase',
            letterSpacing: '0.4px',
            marginTop: '1px',
          }}
        >
          {task.status}
        </div>
      </div>
    </div>
  );
}

/** Render a single tool invocation */
function ToolItem({ tool, theme }: { tool: UnifiedToolCall; theme: ReturnType<typeof useTheme>['theme'] }) {
  const t = theme;
  const isErr = tool.status === 'error';
  const isRunning = tool.status === 'running';

  return (
    <div
      style={{
        padding: '5px 8px',
        marginBottom: '4px',
        background: t.colors.bg.tertiary,
        borderRadius: '5px',
        border: `1px solid ${isErr ? '#ef444455' : t.colors.border.subtle}`,
        fontSize: '10px',
        fontFamily: t.fontFamily.mono,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {isRunning ? (
          <Clock size={11} style={{ color: '#3b82f6', flexShrink: 0 }} />
        ) : isErr ? (
          <AlertCircle size={11} style={{ color: '#ef4444', flexShrink: 0 }} />
        ) : (
          <CheckCircle2 size={11} style={{ color: '#22c55e', flexShrink: 0 }} />
        )}
        <span style={{ fontWeight: 600, color: t.colors.text.primary }}>
          {tool.tool}
        </span>
        {tool.callId && (
          <span style={{ fontSize: '9px', opacity: 0.6, color: t.colors.text.muted }}>
            #{tool.callId.slice(0, 8)}
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '8px',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: isRunning ? '#3b82f6' : isErr ? '#ef4444' : '#22c55e',
          }}
        >
          {tool.status}
        </span>
      </div>

      {tool.input && (
        <div
          style={{
            marginTop: '3px',
            padding: '3px 6px',
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '3px',
            color: t.colors.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '9.5px',
          }}
        >
          {tool.input}
        </div>
      )}

      {tool.output && (
        <div
          style={{
            marginTop: '3px',
            padding: '3px 6px',
            background: 'rgba(0, 0, 0, 0.1)',
            borderRadius: '3px',
            color: t.colors.text.muted,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '120px',
            overflowY: 'auto',
            fontSize: '9px',
          }}
        >
          {tool.output}
        </div>
      )}

      {tool.error && (
        <div style={{ marginTop: '3px', color: '#ef4444', fontSize: '9.5px' }}>
          Error: {tool.error}
        </div>
      )}
    </div>
  );
}

/** Render a single message bubble in the conversation */
function MessageBubble({
  message,
  cli,
  theme,
}: {
  message: UnifiedChatMessage;
  cli: string;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  const t = theme;
  const isUser = message.role === 'user';
  const hasContent =
    message.textParts.length > 0 ||
    message.reasoningParts.length > 0 ||
    message.toolParts.length > 0;

  if (!hasContent) return null;

  const timeStr = new Date(message.time).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '14px',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
      }}
    >
      {/* Avatar */}
      {!isUser ? (
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            flexShrink: 0,
            background: t.colors.bg.elevated,
            border: `1px solid ${t.colors.border.subtle}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '2px',
          }}
        >
          <CliLogo cli={cli} size={12} />
        </div>
      ) : (
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            flexShrink: 0,
            background: t.colors.accent.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '2px',
          }}
        >
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#fff' }}>U</span>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: '88%',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        {/* Metadata row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '9px',
            color: t.colors.text.muted,
            fontFamily: t.fontFamily.mono,
            justifyContent: isUser ? 'flex-end' : 'flex-start',
          }}
        >
          <span
            style={{
              fontWeight: 600,
              color: isUser ? t.colors.text.primary : t.colors.accent.primary,
            }}
          >
            {isUser ? 'You' : cli ? cli.charAt(0).toUpperCase() + cli.slice(1) : 'Agent'}
          </span>
          <span>{timeStr}</span>
          {message.model && <span style={{ opacity: 0.6 }}>{message.model}</span>}
          {message.cost && message.cost > 0 && (
            <span style={{ opacity: 0.6 }}>${message.cost.toFixed(4)}</span>
          )}
        </div>

        {/* Content bubble */}
        <div
          style={{
            fontSize: 11.5,
            lineHeight: 1.5,
            background: isUser ? t.colors.accent.primary : t.colors.bg.elevated,
            border: `1px solid ${isUser ? t.colors.accent.primary : t.colors.border.subtle}`,
            borderRadius: isUser ? '10px 2px 10px 10px' : '2px 10px 10px 10px',
            padding: '8px 11px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxWidth: '100%',
            color: isUser ? '#fff' : t.colors.text.primary,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          {/* Reasoning / Thought Block */}
          {message.reasoningParts.length > 0 && (
            <details
              open
              style={{
                marginBottom: message.textParts.length > 0 || message.toolParts.length > 0 ? '8px' : '0',
                background: isUser ? 'rgba(0,0,0,0.1)' : t.colors.bg.tertiary,
                border: `1px solid ${t.colors.border.subtle}`,
                borderRadius: '6px',
                padding: '6px 8px',
              }}
            >
              <summary
                style={{
                  fontSize: '9.5px',
                  fontWeight: 600,
                  color: isUser ? 'rgba(255,255,255,0.9)' : t.colors.accent.primary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  userSelect: 'none',
                  outline: 'none',
                }}
              >
                <Brain size={11} />
                <span>Thought Process</span>
              </summary>
              <div
                style={{
                  fontSize: '9.5px',
                  lineHeight: 1.45,
                  color: isUser ? 'rgba(255,255,255,0.85)' : t.colors.text.secondary,
                  marginTop: '6px',
                  fontFamily: t.fontFamily.mono,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {message.reasoningParts.map((r, i) => (
                  <div key={i} style={{ marginBottom: i < message.reasoningParts.length - 1 ? '4px' : 0 }}>
                    {r}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Tools Block */}
          {message.toolParts.length > 0 && (
            <details
              open
              style={{
                marginBottom: message.textParts.length > 0 ? '8px' : '0',
                background: isUser ? 'rgba(0,0,0,0.1)' : t.colors.bg.tertiary,
                border: `1px solid ${t.colors.border.subtle}`,
                borderRadius: '6px',
                padding: '6px 8px',
              }}
            >
              <summary
                style={{
                  fontSize: '9.5px',
                  fontWeight: 600,
                  color: isUser ? 'rgba(255,255,255,0.9)' : t.colors.text.primary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  userSelect: 'none',
                  outline: 'none',
                }}
              >
                <Wrench size={11} />
                <span>Tool Executions ({message.toolParts.length})</span>
              </summary>
              <div style={{ marginTop: '6px' }}>
                {message.toolParts.map((tool, i) => (
                  <ToolItem key={i} tool={tool} theme={t} />
                ))}
              </div>
            </details>
          )}

          {/* Text Parts */}
          {message.textParts.map((text, idx) => (
            <div
              key={idx}
              style={{
                marginBottom: idx < message.textParts.length - 1 ? '6px' : 0,
              }}
            >
              {text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Props {
  /** The focused terminal session id the panel is wired to. */
  sessionId: string;
  /** Live sidecar entry for that terminal. */
  entry: UnifiedTerminal;
  onClose: () => void;
  /** Panel width (320 default; grid cards use a narrower 280). */
  width?: number;
}

export function AgentChatPanel({ sessionId, entry, onClose, width = 320 }: Props) {
  const { theme: t } = useTheme();
  const [draft, setDraft] = useState('');
  const [sentFlash, setSentFlash] = useState(false);
  const [messages, setMessages] = useState<UnifiedChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastOutputTsRef = useRef<number>(0);

  // Detect CLI and state from live buffer & entry
  const recentLines = TerminalManager.lastLines(sessionId, 40);
  const detected = detectCLI(recentLines, entry.cli, entry.agent);

  const effectiveCli =
    entry.claude_running
      ? 'claude'
      : entry.opencode_running
      ? 'opencode'
      : detected.cli && detected.cli !== 'shell' && detected.cli !== 'unknown'
      ? detected.cli
      : (entry.cli || entry.agent || '').toLowerCase().trim();

  const displayName =
    effectiveCli === 'claude' || effectiveCli === 'claude-code'
      ? 'Claude Code'
      : effectiveCli === 'opencode'
      ? 'OpenCode'
      : effectiveCli === 'prime' || effectiveCli === 'prime-agent'
      ? 'Prime Agent'
      : effectiveCli === 'codex' || effectiveCli === 'codex-cli'
      ? 'Codex'
      : effectiveCli === 'gemini' || effectiveCli === 'gemini-cli'
      ? 'Gemini'
      : effectiveCli
      ? effectiveCli.charAt(0).toUpperCase() + effectiveCli.slice(1)
      : 'Agent';

  const oc = (
    entry as {
      opencode_status?: {
        last_text?: string;
        session_title?: string;
        session_slug?: string;
        session_id?: string;
      };
    }
  ).opencode_status;
  const sessionIdFromStatus = oc?.session_id;
  const lastText = (oc?.last_text || '').trim();
  const sessionTitle = oc?.session_title || oc?.session_slug || entry.session_name || '';
  const hasTokens =
    entry.tokens && (entry.tokens.tokens_input > 0 || entry.tokens.tokens_output > 0);
  const state = agentState(entry, detected.state);

  // Sync messages from either OpenCode API or parsed terminal buffer/scrollback
  const syncMessages = useCallback(async () => {
    // 1. Try OpenCode API if a valid session ID is registered
    if (sessionIdFromStatus) {
      try {
        const resp = await fetch(`/api/opencode/sessions/${sessionIdFromStatus}/messages?limit=50`);
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            const mapped: UnifiedChatMessage[] = [...data].reverse().map((msg: any) => ({
              id: msg.info.id,
              role: msg.info.role,
              time: msg.info.time.created,
              model: msg.info.modelID,
              cost: msg.info.cost,
              tokens: msg.info.tokens,
              textParts: (msg.parts || [])
                .filter((p: any) => p.type === 'text' && p.text?.trim())
                .map((p: any) => p.text.trim()),
              reasoningParts: (msg.parts || [])
                .filter((p: any) => p.type === 'reasoning' && p.text?.trim())
                .map((p: any) => p.text.trim()),
              toolParts: (msg.parts || [])
                .filter((p: any) => p.type === 'tool')
                .map((p: any) => ({
                  tool: p.tool || 'tool',
                  callId: p.callID,
                  status:
                    p.state?.status === 'error'
                      ? 'error'
                      : p.state?.status === 'completed'
                      ? 'completed'
                      : 'running',
                  input:
                    typeof p.state?.input === 'string'
                      ? p.state.input
                      : p.state?.input
                      ? JSON.stringify(p.state.input)
                      : undefined,
                  output:
                    typeof p.state?.output === 'string'
                      ? p.state.output
                      : p.state?.output
                      ? String(p.state.output)
                      : undefined,
                  error: p.state?.error,
                })),
            }));
            setMessages(mapped);
            setLoadingMessages(false);
            setMessagesError(null);
            return;
          }
        }
      } catch {
        // Fall back to terminal parser below
      }
    }

    // 2. Fall back to parsing the terminal buffer and full scrollback
    try {
      let bufferLines = TerminalManager.getBufferText(sessionId, 1200);

      // If buffer has very few lines, check full scrollback from Tauri
      if (bufferLines.length < 15) {
        const fullText = await TerminalManager.getFullScrollbackText(sessionId);
        if (fullText && fullText.trim()) {
          bufferLines = fullText.split('\n');
        }
      }

      // If still empty, check sidecar entry live_output
      if (bufferLines.length === 0 && entry.live_output) {
        bufferLines = entry.live_output.split('\n');
      }

      if (bufferLines.length > 0) {
        const parsed = parseTerminalDialogue(bufferLines, effectiveCli);
        if (parsed.length > 0) {
          setMessages(parsed);
          setMessagesError(null);
        }
      }
    } catch (err) {
      console.warn('[AgentChatPanel] Parse error:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, [sessionId, sessionIdFromStatus, effectiveCli, entry.live_output]);

  // Initial load
  useEffect(() => {
    setLoadingMessages(true);
    syncMessages();
  }, [syncMessages]);

  // Real-time listener: sync whenever new output arrives in the terminal
  useEffect(() => {
    const unsub = TerminalManager.onOutput(sessionId, () => {
      const now = Date.now();
      // Debounce sync calls to at most once every 300ms
      if (now - lastOutputTsRef.current > 300) {
        lastOutputTsRef.current = now;
        syncMessages();
      }
    });

    // Also poll every 2s in case of background updates
    const pollId = window.setInterval(syncMessages, 2000);

    return () => {
      unsub();
      window.clearInterval(pollId);
    };
  }, [sessionId, syncMessages]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (showHistory && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, showHistory]);

  // Sent flash timer
  useEffect(() => {
    if (!sentFlash) return;
    const id = window.setTimeout(() => setSentFlash(false), 2000);
    return () => window.clearTimeout(id);
  }, [sentFlash]);

  // Send message straight into terminal PTY with Enter (\r)
  const send = async () => {
    const msg = draft.trim();
    if (!msg || !sessionId) return;

    // Optimistically add user message to list
    const userMsg: UnifiedChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      time: Date.now(),
      textParts: [msg],
      reasoningParts: [],
      toolParts: [],
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');
    setSentFlash(true);

    // Write command into PTY with Enter (\r)
    await TerminalManager.sendCommand(sessionId, msg);

    inputRef.current?.focus();
  };

  return (
    <div
      style={{
        width: `${width}px`,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `1px solid ${t.colors.border.subtle}`,
        background: t.colors.bg.secondary,
        height: '100%',
        overflow: 'hidden',
      }}
      data-tto-chat-panel={sessionId}
    >
      {/* ── Header: agent logo + title + state pill + close button ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          background: t.colors.bg.tertiary,
          flexShrink: 0,
        }}
      >
        <CliLogo cli={effectiveCli} size={15} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: t.colors.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
          title={sessionTitle || displayName}
        >
          {displayName}
          {sessionTitle ? (
            <span style={{ color: t.colors.text.muted, fontWeight: 400 }}> · {sessionTitle}</span>
          ) : null}
        </span>
        <span
          style={{
            fontSize: '9px',
            padding: '1px 6px',
            borderRadius: '8px',
            flexShrink: 0,
            background: `${state.color}22`,
            border: `1px solid ${state.color}55`,
            color: state.color,
            fontWeight: 700,
            letterSpacing: '0.5px',
          }}
        >
          {state.label}
        </span>
        <button
          onClick={onClose}
          title="Hide chat panel"
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: t.colors.text.muted,
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = t.colors.bg.elevated;
            e.currentTarget.style.color = t.colors.text.primary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = t.colors.text.muted;
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* ── Same-session identity strip ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          flexShrink: 0,
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          background: t.colors.bg.tertiary,
          fontSize: '9px',
          fontFamily: t.fontFamily.mono,
          color: t.colors.text.muted,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            background: entry.is_live ? '#22c55e' : '#6b7280',
            boxShadow: entry.is_live ? '0 0 5px #22c55e88' : 'none',
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          live session · {sessionId}
        </span>
        {entry.claude_pid ? (
          <span style={{ opacity: 0.75, flexShrink: 0 }}>pid {entry.claude_pid}</span>
        ) : entry.opencode_pid ? (
          <span style={{ opacity: 0.75, flexShrink: 0 }}>pid {entry.opencode_pid}</span>
        ) : null}
      </div>

      {/* ── Chat history toggle ── */}
      <button
        onClick={() => setShowHistory(!showHistory)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '6px 10px',
          flexShrink: 0,
          border: 'none',
          borderBottom: `1px solid ${t.colors.border.subtle}`,
          background: t.colors.bg.tertiary,
          color: t.colors.text.primary,
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <span>{showHistory ? 'Hide' : 'Show'} history</span>
        {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        <span style={{ fontSize: '9px', color: t.colors.text.muted, fontFamily: t.fontFamily.mono }}>
          ({messages.length} messages)
        </span>
      </button>

      {/* ── Conversation Feed / Messages ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {showHistory ? (
          <>
            {loadingMessages && messages.length === 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100px',
                  gap: '8px',
                  color: t.colors.text.muted,
                  fontSize: '11px',
                }}
              >
                <Loader2 size={16} className="animate-spin" />
                <span>Connecting to {displayName} stream…</span>
              </div>
            )}

            {messagesError && (
              <div
                style={{
                  color: '#ef4444',
                  fontSize: 11,
                  padding: '8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  marginBottom: '10px',
                }}
              >
                Failed to load messages: {messagesError}
                <button
                  onClick={syncMessages}
                  style={{
                    marginLeft: '8px',
                    padding: '2px 8px',
                    fontSize: '9px',
                    background: t.colors.accent.primary,
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {messages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} cli={effectiveCli} theme={t} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}

            {messages.length === 0 && !loadingMessages && (
              <div
                style={{
                  fontSize: 11,
                  color: t.colors.text.muted,
                  lineHeight: 1.5,
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  height: '100%',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  textAlign: 'center',
                  padding: '20px',
                }}
              >
                <MessageSquare size={26} style={{ opacity: 0.3, marginBottom: '4px' }} />
                <span style={{ fontWeight: 600, color: t.colors.text.secondary }}>
                  Ready to chat with {displayName}
                </span>
                <span style={{ fontSize: '10px' }}>
                  Messages you send below go straight into this terminal's live CLI session.
                </span>
              </div>
            )}
          </>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* ── Compact overview / Telemetry view ── */}
            {lastText && (
              <div style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    fontSize: '9px',
                    color: t.colors.text.muted,
                    fontWeight: 700,
                    letterSpacing: '0.6px',
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}
                >
                  Latest message
                </div>
                <div
                  style={{
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: t.colors.text.primary,
                    background: t.colors.bg.elevated,
                    border: `1px solid ${t.colors.border.subtle}`,
                    borderRadius: '6px',
                    padding: '8px 10px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '180px',
                    overflowY: 'auto',
                  }}
                >
                  {lastText.length > 900 ? `${lastText.slice(0, 900)}…` : lastText}
                </div>
              </div>
            )}

            {entry.current_task && (
              <div style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    fontSize: '9px',
                    color: t.colors.text.muted,
                    fontWeight: 700,
                    letterSpacing: '0.6px',
                    textTransform: 'uppercase',
                    marginBottom: '2px',
                  }}
                >
                  Current task
                </div>
                <TaskRow task={entry.current_task} kind="current" />
              </div>
            )}

            {entry.next_task && (
              <div style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    fontSize: '9px',
                    color: t.colors.text.muted,
                    fontWeight: 700,
                    letterSpacing: '0.6px',
                    textTransform: 'uppercase',
                    marginBottom: '2px',
                  }}
                >
                  Next up
                </div>
                <TaskRow task={entry.next_task} kind="next" />
              </div>
            )}

            {entry.queue.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    fontSize: '9px',
                    color: t.colors.text.muted,
                    fontWeight: 700,
                    letterSpacing: '0.6px',
                    textTransform: 'uppercase',
                    marginBottom: '2px',
                  }}
                >
                  Queue ({entry.queue.length})
                </div>
                {entry.queue.map((task) => (
                  <TaskRow key={task.id} task={task} kind="queue" />
                ))}
              </div>
            )}

            {entry.session_summary && (
              <div style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    fontSize: '9px',
                    color: t.colors.text.muted,
                    fontWeight: 700,
                    letterSpacing: '0.6px',
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}
                >
                  Session summary
                </div>
                <div
                  style={{
                    fontSize: 11,
                    lineHeight: 1.4,
                    color: t.colors.text.secondary,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {entry.session_summary}
                </div>
              </div>
            )}

            {hasTokens && (
              <div
                style={{
                  fontSize: '9.5px',
                  color: t.colors.text.muted,
                  fontFamily: t.fontFamily.mono,
                  display: 'flex',
                  gap: '10px',
                  padding: '4px 0',
                }}
              >
                <span>↑ {entry.tokens.tokens_input.toLocaleString()}</span>
                <span>↓ {entry.tokens.tokens_output.toLocaleString()}</span>
                {entry.tokens.cost > 0 && <span>${entry.tokens.cost.toFixed(4)}</span>}
                {entry.tokens.model && <span>{entry.tokens.model}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Composer: writes command directly into terminal PTY with Enter (\r) ── */}
      <div
        style={{
          padding: '8px 10px',
          borderTop: `1px solid ${t.colors.border.subtle}`,
          background: t.colors.bg.tertiary,
          display: 'flex',
          gap: '6px',
          flexShrink: 0,
          alignItems: 'center',
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Message ${displayName}…`}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            padding: '7px 9px',
            background: t.colors.bg.elevated,
            border: `1px solid ${t.colors.border.subtle}`,
            borderRadius: '6px',
            color: t.colors.text.primary,
            outline: 'none',
            fontFamily: t.fontFamily.sans,
          }}
        />
        <button
          onClick={send}
          disabled={!draft.trim()}
          title={`Send message to ${displayName}`}
          style={{
            width: '30px',
            height: '30px',
            borderRadius: '6px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: draft.trim() ? t.colors.accent.primary : t.colors.bg.elevated,
            border: `1px solid ${draft.trim() ? t.colors.accent.primary : t.colors.border.subtle}`,
            color: draft.trim() ? '#fff' : t.colors.text.muted,
            cursor: draft.trim() ? 'pointer' : 'default',
            padding: 0,
          }}
        >
          <Send size={13} />
        </button>
      </div>

      {sentFlash && (
        <div
          style={{
            fontSize: '9.5px',
            color: '#22c55e',
            textAlign: 'center',
            padding: '4px 0 6px',
            borderTop: `1px solid ${t.colors.border.subtle}`,
            background: 'rgba(34, 197, 94, 0.08)',
            flexShrink: 0,
          }}
        >
          ✓ Sent to {displayName} · Response streaming in terminal & chat
        </div>
      )}
    </div>
  );
}
