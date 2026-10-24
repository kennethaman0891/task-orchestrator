// AgentChatPanel — the chat UI that sits ALONGSIDE a CLI running in the
// focused terminal (Claude Code, OpenCode, Codex, Gemini, Prime Agent, ...).
//
// Data (read):
//   1. OpenCode API only when this tty is actually OpenCode.
//   2. Antigravity, Gemini, and alt-screen TUIs: a per-session transcript
//      snapshotted from the painted viewport (chatTranscript). The splash is
//      not a message, and a permission card tracks the live tail.
//   3. Other CLIs: dialogueParser on the xterm buffer.
//   Real-time updates run after xterm has painted, on a trailing timer.
// Data (write):
//   Message composer writes text + Enter (\r) straight into that terminal's
//   PTY via TerminalManager.sendCommand() — a true control channel into the
//   running CLI's prompt with zero session bifurcation.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import type { UnifiedTerminal, Task } from '@/types';
import { TerminalManager } from '@/terminal/TerminalManager';
import { CliLogo } from '@/lib/cliLogos';
import { detectCLI } from '@/jarvis/adapters';
import {
  parseTerminalDialogue,
  type UnifiedChatMessage,
  type UnifiedToolCall,
  type InteractivePrompt,
  type PromptOption,
} from '@/terminal/dialogueParser';
import {
  appendUserMessage,
  markPromptSelected,
  promptNeedsEnter,
  snapshotTranscript,
  usesLiveTranscript,
} from '@/terminal/chatTranscript';
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
  ShieldAlert,
  Copy,
  Check,
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
  'aider',
  'ollama',
  'copilot',
  'gh-copilot',
  'github-copilot',
  'gpt',
  'chatgpt',
  'openhands',
  'devin',
  'interpreter',
  'open-interpreter',
  'sgpt',
  'plandex',
  'mentat',
  'cline',
  'roo',
  'continue',
  'shell',
  'bash',
  'zsh',
  'sh',
  'fish',
  'python',
  'node',
]);

export function isAgentCli(entry?: UnifiedTerminal, _lines?: string[]): boolean {
  // Chat UI is supported for all live terminal sessions (Claude Code, OpenCode, Gemini, Codex, Aider, Ollama, Python, Shell, etc.)
  return Boolean(entry);
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

/** Render an interactive question or permission request card with clickable options & dropdown */
function InteractivePromptCard({
  prompt,
  theme,
  onSelect,
  onCancel,
}: {
  prompt: InteractivePrompt;
  theme: ReturnType<typeof useTheme>['theme'];
  onSelect?: (option: PromptOption) => void;
  onCancel?: () => void;
}) {
  const t = theme;
  const [copied, setCopied] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>(
    prompt.options.find((o) => o.selected)?.key || prompt.options[0]?.key || '1'
  );

  const copyCommand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!prompt.command) return;
    navigator.clipboard.writeText(prompt.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const isResolved = prompt.resolved || Boolean(prompt.selectedKey);
  const selectedOption = prompt.options.find((o) => o.key === prompt.selectedKey);

  return (
    <div
      style={{
        marginTop: '8px',
        background: isResolved ? 'rgba(0,0,0,0.1)' : 'rgba(245, 158, 11, 0.08)',
        border: `1px solid ${isResolved ? t.colors.border.subtle : 'rgba(245, 158, 11, 0.35)'}`,
        borderRadius: '8px',
        padding: '10px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Header with Title and Action Badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ShieldAlert size={14} color={isResolved ? t.colors.text.muted : '#f59e0b'} />
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              color: isResolved ? t.colors.text.muted : '#f59e0b',
            }}
          >
            {prompt.title || 'Permission Request'}
          </span>
        </div>
        <span
          style={{
            fontSize: '9px',
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: '4px',
            background: isResolved ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.2)',
            color: isResolved ? '#22c55e' : '#f59e0b',
            border: `1px solid ${isResolved ? 'rgba(34, 197, 94, 0.3)' : 'rgba(245, 158, 11, 0.35)'}`,
          }}
        >
          {isResolved ? '✓ Completed' : 'Action Required'}
        </span>
      </div>

      {/* Main Question Text */}
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: t.colors.text.primary,
          lineHeight: 1.4,
        }}
      >
        {prompt.question}
      </div>

      {/* Command Block (if present) */}
      {prompt.command && (
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.25)',
            border: `1px solid ${t.colors.border.subtle}`,
            borderRadius: '5px',
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '6px',
          }}
        >
          <code
            style={{
              fontFamily: t.fontFamily.mono,
              fontSize: '10px',
              color: '#38bdf8',
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
              flex: 1,
            }}
          >
            {prompt.command}
          </code>
          <button
            onClick={copyCommand}
            title="Copy command"
            style={{
              background: 'transparent',
              border: 'none',
              color: copied ? '#22c55e' : t.colors.text.muted,
              cursor: 'pointer',
              padding: '2px',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      )}

      {/* Description / Rationale */}
      {prompt.description && (
        <div
          style={{
            fontSize: '9.5px',
            lineHeight: 1.45,
            color: t.colors.text.secondary,
            fontStyle: 'italic',
          }}
        >
          {prompt.description}
        </div>
      )}

      {/* Interactive Options or Resolved Pill */}
      {isResolved ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '10px',
            fontWeight: 600,
            color: '#22c55e',
            background: 'rgba(34, 197, 94, 0.1)',
            padding: '4px 8px',
            borderRadius: '4px',
            width: 'fit-content',
          }}
        >
          <CheckCircle2 size={12} />
          <span>
            Selected:{' '}
            {selectedOption?.rawText ||
              selectedOption?.label ||
              (prompt.selectedKey === 'esc'
                ? 'Cancelled'
                : prompt.selectedKey === 'approved'
                ? 'Approved in terminal'
                : prompt.selectedKey)}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px' }}>
          {/* 1-Click Action Buttons */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {prompt.options.map((opt) => {
              const isPositive =
                opt.index === 1 ||
                /yes|allow|proceed|approve|continue/i.test(opt.label);
              const isNegative =
                opt.index === 2 || /no|deny|reject|cancel|skip/i.test(opt.label);

              return (
                <button
                  key={opt.key}
                  onClick={() => onSelect?.(opt)}
                  style={{
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease',
                    border: isPositive
                      ? '1px solid #16a34a'
                      : isNegative
                      ? '1px solid #dc2626'
                      : `1px solid ${t.colors.border.subtle}`,
                    background: isPositive
                      ? '#16a34a'
                      : isNegative
                      ? 'rgba(220, 38, 38, 0.15)'
                      : t.colors.bg.elevated,
                    color: isPositive ? '#ffffff' : isNegative ? '#ef4444' : t.colors.text.primary,
                  }}
                  onMouseEnter={(e) => {
                    if (isPositive) e.currentTarget.style.background = '#15803d';
                    else if (isNegative) e.currentTarget.style.background = 'rgba(220, 38, 38, 0.25)';
                    else e.currentTarget.style.background = t.colors.bg.tertiary;
                  }}
                  onMouseLeave={(e) => {
                    if (isPositive) e.currentTarget.style.background = '#16a34a';
                    else if (isNegative) e.currentTarget.style.background = 'rgba(220, 38, 38, 0.15)';
                    else e.currentTarget.style.background = t.colors.bg.elevated;
                  }}
                >
                  {isPositive && <Check size={11} />}
                  {isNegative && <X size={11} />}
                  <span>{opt.rawText || `${opt.key}. ${opt.label}`}</span>
                </button>
              );
            })}

            {/* Cancel (Esc) button */}
            <button
              onClick={() => onCancel?.()}
              style={{
                padding: '5px 9px',
                fontSize: '10px',
                fontWeight: 500,
                borderRadius: '5px',
                cursor: 'pointer',
                background: 'transparent',
                border: `1px solid ${t.colors.border.subtle}`,
                color: t.colors.text.muted,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
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
              <X size={10} />
              <span>Cancel (Esc)</span>
            </button>
          </div>

          {/* Optional Dropdown Selector for all options */}
          {prompt.options.length > 2 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '4px',
                paddingTop: '6px',
                borderTop: `1px solid ${t.colors.border.subtle}`,
              }}
            >
              <span style={{ fontSize: '9.5px', color: t.colors.text.muted }}>Or choose:</span>
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                style={{
                  fontSize: '10.5px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: t.colors.bg.elevated,
                  border: `1px solid ${t.colors.border.subtle}`,
                  color: t.colors.text.primary,
                  outline: 'none',
                  flex: 1,
                  maxWidth: '190px',
                }}
              >
                {prompt.options.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.rawText || `${opt.key}. ${opt.label}`}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const opt = prompt.options.find((o) => o.key === selectedKey);
                  if (opt) onSelect?.(opt);
                }}
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: t.colors.accent.primary,
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Submit
              </button>
            </div>
          )}

          {/* Hints note */}
          {prompt.hints && (
            <div
              style={{
                fontSize: '8.5px',
                fontFamily: t.fontFamily.mono,
                color: t.colors.text.muted,
                opacity: 0.8,
              }}
            >
              {prompt.hints}
            </div>
          )}
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
  onSelectOption,
  onCancelPrompt,
}: {
  message: UnifiedChatMessage;
  cli: string;
  theme: ReturnType<typeof useTheme>['theme'];
  onSelectOption?: (prompt: InteractivePrompt, option: PromptOption) => void;
  onCancelPrompt?: (prompt: InteractivePrompt) => void;
}) {
  const t = theme;
  const isUser = message.role === 'user';
  const hasContent =
    message.textParts.length > 0 ||
    message.reasoningParts.length > 0 ||
    message.toolParts.length > 0 ||
    Boolean(message.interactivePrompt);

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

          {/* Interactive Prompt / Question / Permission Card */}
          {message.interactivePrompt && (
            <div style={{ marginTop: message.textParts.length > 0 ? '8px' : '0' }}>
              <InteractivePromptCard
                prompt={message.interactivePrompt}
                theme={t}
                onSelect={
                  onSelectOption
                    ? (opt) => onSelectOption(message.interactivePrompt!, opt)
                    : undefined
                }
                onCancel={
                  onCancelPrompt
                    ? () => onCancelPrompt(message.interactivePrompt!)
                    : undefined
                }
              />
            </div>
          )}
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
  const syncGen = useRef(0);

  // Detect CLI and state from live buffer & entry
  const recentLines = TerminalManager.lastLines(sessionId, 40);
  const detected = detectCLI(recentLines, entry.cli, entry.agent);

  const effectiveCli =
    entry.antigravity_running || entry.cli === 'antigravity' || entry.agent === 'antigravity'
      ? 'antigravity'
      : entry.claude_running
      ? 'claude'
      : entry.opencode_running
      ? 'opencode'
      : detected.cli && detected.cli !== 'unknown'
      ? detected.cli
      : (entry.cli || entry.agent || '').toLowerCase().trim() || 'shell';

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
      : effectiveCli === 'aider'
      ? 'Aider'
      : effectiveCli === 'ollama'
      ? 'Ollama'
      : effectiveCli === 'qwen'
      ? 'Qwen'
      : effectiveCli === 'cursor' || effectiveCli === 'cursor-agent'
      ? 'Cursor'
      : effectiveCli === 'antigravity'
      ? 'Antigravity'
      : effectiveCli === 'copilot' || effectiveCli === 'gh-copilot'
      ? 'GitHub Copilot'
      : effectiveCli === 'python'
      ? 'Python'
      : effectiveCli === 'node'
      ? 'Node.js'
      : effectiveCli === 'bash'
      ? 'Bash'
      : effectiveCli === 'zsh'
      ? 'Zsh'
      : effectiveCli === 'shell'
      ? 'Shell'
      : effectiveCli
      ? effectiveCli.charAt(0).toUpperCase() + effectiveCli.slice(1)
      : 'Terminal';

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
  const liveTranscript =
    usesLiveTranscript(effectiveCli) || TerminalManager.isAlternateScreen(sessionId);

  // Sync messages from the OpenCode API, the viewport transcript, or the linear parser.
  const syncMessages = useCallback(async () => {
    const gen = ++syncGen.current;
    // OpenCode's own transcript. Antigravity must not take this branch just
    // because a running task left a session id on the sidecar entry.
    if (effectiveCli === 'opencode' && sessionIdFromStatus) {
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
            if (gen !== syncGen.current) return;
            setMessages((prev) => {
              if (prev.length === mapped.length && prev.length > 0) {
                const prevLast = prev[prev.length - 1];
                const mappedLast = mapped[mapped.length - 1];
                if (
                  prevLast.id === mappedLast.id &&
                  prevLast.textParts.length === mappedLast.textParts.length &&
                  prevLast.toolParts.length === mappedLast.toolParts.length &&
                  prevLast.reasoningParts.length === mappedLast.reasoningParts.length
                ) {
                  return prev; // No change in messages payload — skip state update and avoid DOM thrashing
                }
              }
              return mapped;
            });
            setLoadingMessages(false);
            setMessagesError(null);
            return;
          }
        }
      } catch {
        if (gen !== syncGen.current) return;
        // Fall back to the terminal parser below
      }
    }

    if (gen !== syncGen.current) return;

    // Viewport transcript for TUIs. The raw PTY byte log is not a screen:
    // cursor erases leave old permission rows in it forever.
    try {
      if (liveTranscript) {
        const lines = TerminalManager.getViewportText(sessionId);
        if (lines.length === 0) {
          setLoadingMessages(false);
          return;
        }
        const next = snapshotTranscript(sessionId, lines, effectiveCli);
        setMessages((prev) => (prev === next ? prev : next));
        setMessagesError(null);
        return;
      }

      let bufferLines = TerminalManager.getBufferText(sessionId, 1200);
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
  }, [sessionId, sessionIdFromStatus, effectiveCli, entry.live_output, liveTranscript]);

  // Initial load
  useEffect(() => {
    setLoadingMessages(true);
    syncMessages();
  }, [syncMessages]);

  // Snapshot after the painted burst settles. onOutput fires from the xterm
  // write callback. A second pass 120ms later lets a permission card resolve
  // once the tail has stayed clear, without waiting for the 2s safety poll.
  useEffect(() => {
    let timer = 0;
    let follow = 0;
    const unsub = TerminalManager.onOutput(sessionId, () => {
      window.clearTimeout(timer);
      window.clearTimeout(follow);
      timer = window.setTimeout(() => {
        syncMessages();
        follow = window.setTimeout(() => {
          syncMessages();
        }, 120);
      }, 70);
    });

    const pollId = window.setInterval(syncMessages, 2000);

    return () => {
      unsub();
      window.clearTimeout(timer);
      window.clearTimeout(follow);
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

    if (liveTranscript) {
      setMessages(appendUserMessage(sessionId, msg));
    } else {
      const userMsg: UnifiedChatMessage = {
        id: `local-user-${Date.now()}`,
        role: 'user',
        time: Date.now(),
        textParts: [msg],
        reasoningParts: [],
        toolParts: [],
      };
      setMessages((prev) => [...prev, userMsg]);
    }
    setDraft('');
    setSentFlash(true);

    // Submit prompt with decoupled Enter so CLI TUIs execute immediately
    try {
      await TerminalManager.sendPrompt(sessionId, msg);
    } catch (err) {
      console.error('[AgentChatPanel] sendPrompt failed:', err);
    }

    inputRef.current?.focus();
  };

  // Handle option selection for interactive CLI prompts (e.g. Claude Code permission questions)
  const handleSelectPromptOption = useCallback(
    async (prompt: InteractivePrompt, opt: PromptOption) => {
      const value = (opt.value || opt.key).replace(/\r/g, '') || opt.key;
      const enter = promptNeedsEnter(TerminalManager.getViewportText(sessionId), effectiveCli);
      if (liveTranscript) {
        setMessages(markPromptSelected(sessionId, prompt.id, opt.key));
      } else {
        prompt.resolved = true;
        prompt.selectedKey = opt.key;
        const userMsg: UnifiedChatMessage = {
          id: `local-user-choice-${Date.now()}`,
          role: 'user',
          time: Date.now(),
          textParts: [opt.rawText || `${opt.key}. ${opt.label}`],
          reasoningParts: [],
          toolParts: [],
        };
        setMessages((prev) => [...prev, userMsg]);
      }
      await TerminalManager.sendMenuSelection(sessionId, value, { enter });
    },
    [sessionId, effectiveCli, liveTranscript]
  );

  const handleCancelPrompt = useCallback(
    async (prompt: InteractivePrompt) => {
      if (liveTranscript) {
        setMessages(markPromptSelected(sessionId, prompt.id, 'esc'));
      } else {
        prompt.resolved = true;
        prompt.selectedKey = 'esc';
        const userMsg: UnifiedChatMessage = {
          id: `local-user-choice-${Date.now()}`,
          role: 'user',
          time: Date.now(),
          textParts: ['Cancelled (Esc)'],
          reasoningParts: [],
          toolParts: [],
        };
        setMessages((prev) => [...prev, userMsg]);
      }
      await TerminalManager.sendMenuSelection(sessionId, 'escape');
    },
    [sessionId, liveTranscript]
  );

  // Identify any currently pending, unresolved prompt in the session
  const activePrompt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const p = messages[i].interactivePrompt;
      if (p && !p.resolved) {
        return p;
      }
    }
    return null;
  }, [messages]);

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
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    cli={effectiveCli}
                    theme={t}
                    onSelectOption={handleSelectPromptOption}
                    onCancelPrompt={handleCancelPrompt}
                  />
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
        ) : liveTranscript ? (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {messages.length > 0 ? (
              <MessageBubble
                message={messages[messages.length - 1]}
                cli={effectiveCli}
                theme={t}
                onSelectOption={handleSelectPromptOption}
                onCancelPrompt={handleCancelPrompt}
              />
            ) : (
              <div
                style={{
                  fontSize: 11,
                  color: t.colors.text.muted,
                  lineHeight: 1.5,
                  textAlign: 'center',
                  padding: '20px',
                }}
              >
                No turns yet. What you send here is kept for this terminal.
              </div>
            )}
          </div>
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

      {/* ── Active Prompt Bar above Composer ── */}
      {activePrompt && (
        <div
          style={{
            padding: '8px 10px',
            background: 'rgba(234, 179, 8, 0.08)',
            borderTop: `1px solid rgba(234, 179, 8, 0.35)`,
            borderBottom: `1px solid rgba(234, 179, 8, 0.2)`,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '10.5px',
                fontWeight: 600,
                color: '#eab308',
              }}
            >
              <ShieldAlert size={13} />
              <span>{activePrompt.title || 'Terminal awaiting input:'}</span>
            </div>
            <span
              style={{
                fontSize: '9px',
                color: '#eab308',
                background: 'rgba(234, 179, 8, 0.15)',
                padding: '1px 5px',
                borderRadius: '3px',
                fontWeight: 600,
              }}
            >
              Action Required
            </span>
          </div>

          {activePrompt.command && (
            <div
              style={{
                fontSize: '9.5px',
                fontFamily: t.fontFamily.mono,
                background: t.colors.bg.primary,
                border: `1px solid ${t.colors.border.subtle}`,
                borderRadius: '4px',
                padding: '4px 6px',
                color: t.colors.accent.primary,
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              $ {activePrompt.command}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
            {activePrompt.options.map((opt) => {
              const isPositive = /yes|allow|approve|proceed|confirm|run/i.test(opt.label);
              const isNegative = /no|deny|reject|cancel|skip|exit/i.test(opt.label);
              return (
                <button
                  key={opt.key}
                  onClick={() => handleSelectPromptOption(activePrompt, opt)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    border: isPositive
                      ? 'none'
                      : isNegative
                      ? '1px solid rgba(220, 38, 38, 0.4)'
                      : `1px solid ${t.colors.border.subtle}`,
                    background: isPositive
                      ? '#16a34a'
                      : isNegative
                      ? 'rgba(220, 38, 38, 0.15)'
                      : t.colors.bg.elevated,
                    color: isPositive ? '#ffffff' : isNegative ? '#ef4444' : t.colors.text.primary,
                  }}
                >
                  {isPositive && <Check size={11} />}
                  {isNegative && <X size={11} />}
                  <span>{opt.rawText || `${opt.key}. ${opt.label}`}</span>
                </button>
              );
            })}
            <button
              onClick={() => handleCancelPrompt(activePrompt)}
              style={{
                padding: '4px 7px',
                fontSize: '10px',
                borderRadius: '4px',
                cursor: 'pointer',
                background: 'transparent',
                border: `1px solid ${t.colors.border.subtle}`,
                color: t.colors.text.muted,
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              <X size={10} />
              <span>Esc</span>
            </button>
          </div>
        </div>
      )}

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
