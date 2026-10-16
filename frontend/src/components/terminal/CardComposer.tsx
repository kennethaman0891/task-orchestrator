// CardComposer.tsx — Dedicated inline command & prompt text box below terminal cards
// Compatible with all CLIs: Claude Code, Codex, Antigravity, OpenCode, Gemini, Bash, Zsh, REPLs
'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { TerminalManager } from '@/terminal/TerminalManager';
import { parseTerminalDialogue, type InteractivePrompt, type PromptOption } from '@/terminal/dialogueParser';
import { CliLogo } from '@/lib/cliLogos';
import { Send, Check, CornerDownLeft, Sparkles, AlertCircle } from 'lucide-react';

interface CardComposerProps {
  sessionId: string;
  displayName: string;
  cli?: string;
  isCompact?: boolean;
  isUltraCompact?: boolean;
  onSent?: (text: string) => void;
}

export const CardComposer = memo(function CardComposer({
  sessionId,
  displayName,
  cli,
  isCompact = false,
  isUltraCompact = false,
  onSent,
}: CardComposerProps) {
  const { theme: t } = useTheme();
  const [draft, setDraft] = useState('');
  const [sentFlash, setSentFlash] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [activePrompt, setActivePrompt] = useState<InteractivePrompt | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastSyncRef = useRef<number>(0);

  // Dynamic placeholder text tailored to active CLI tool
  const placeholderText = useMemo(() => {
    const c = (cli || displayName || '').toLowerCase();
    if (c.includes('claude')) return isCompact ? 'Message Claude…' : 'Message Claude Code (Enter to send)…';
    if (c.includes('codex')) return isCompact ? 'Message Codex…' : 'Message Codex (Enter to send)…';
    if (c.includes('antigravity') || c.includes('agy')) return isCompact ? 'Message Antigravity…' : 'Message Antigravity (Enter to send)…';
    if (c.includes('opencode')) return isCompact ? 'Message OpenCode…' : 'Message OpenCode (Enter to send)…';
    if (c.includes('gemini')) return isCompact ? 'Message Gemini…' : 'Message Gemini (Enter to send)…';
    if (c.includes('python')) return isCompact ? 'Python REPL…' : 'Execute in Python REPL…';
    if (c.includes('node')) return isCompact ? 'Node REPL…' : 'Execute in Node REPL…';
    if (c.includes('bash') || c.includes('zsh') || c.includes('sh')) return isCompact ? 'Send command…' : `Send command to ${displayName || 'shell'}…`;
    return isCompact ? 'Send to terminal…' : `Send to ${displayName || 'terminal'}…`;
  }, [cli, displayName, isCompact]);

  // Check terminal scrollback for interactive prompts / questions requiring confirmation
  const checkPrompt = useCallback(() => {
    if (!sessionId) {
      setActivePrompt(null);
      return;
    }
    try {
      const lines = TerminalManager.lastLines(sessionId, 35);
      if (lines.length === 0) {
        setActivePrompt(null);
        return;
      }

      // 1. Try parsing structured dialogue from buffer lines
      const parsed = parseTerminalDialogue(lines, cli || 'shell');
      const withPrompt = parsed
        .slice()
        .reverse()
        .find(
          (m) =>
            m.interactivePrompt &&
            !m.interactivePrompt.resolved &&
            m.interactivePrompt.options.length > 0
        );

      if (withPrompt?.interactivePrompt) {
        setActivePrompt(withPrompt.interactivePrompt);
        return;
      }

      // 2. Direct scan for confirmation patterns (e.g. [y/N], (y/n), 1. Yes, 2. No)
      const nonBlank = lines.map((l) => l.trim()).filter(Boolean);
      const lastLine = nonBlank[nonBlank.length - 1] || '';
      const secondLastLine = nonBlank[nonBlank.length - 2] || '';
      const tail = `${secondLastLine}\n${lastLine}`;

      const ynMatch = tail.match(/\((?:y\/n|y\/N|Y\/n)\)|\[(?:y\/n|y\/N|Y\/n)\]/i);
      if (ynMatch) {
        const isPerm = /allow|permit|authorize|proceed|permission/i.test(tail);
        setActivePrompt({
          id: `prompt-yn-${sessionId}`,
          type: isPerm ? 'permission' : 'confirm',
          question: lastLine,
          options: [
            { index: 1, key: 'y', label: 'Yes (y)', rawText: 'Yes', value: 'y\r' },
            { index: 2, key: 'n', label: 'No (n)', rawText: 'No', value: 'n\r' },
          ],
          resolved: false,
        });
        return;
      }

      // If no active prompt detected, clear
      setActivePrompt(null);
    } catch {
      setActivePrompt(null);
    }
  }, [sessionId, cli]);

  // Periodic and output-driven sync for live prompt detection
  useEffect(() => {
    checkPrompt();
    const unsub = TerminalManager.onOutput(sessionId, () => {
      const now = Date.now();
      if (now - lastSyncRef.current > 300) {
        lastSyncRef.current = now;
        checkPrompt();
      }
    });

    const pollId = window.setInterval(checkPrompt, 1500);

    return () => {
      unsub();
      window.clearInterval(pollId);
    };
  }, [sessionId, checkPrompt]);

  // Send option key selection for interactive prompt
  const handleSelectOption = useCallback(
    async (opt: PromptOption) => {
      if (!sessionId) return;
      setActivePrompt(null);
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 900);

      try {
        await TerminalManager.sendMenuSelection(sessionId, opt.key);
        onSent?.(opt.key);
      } catch (err) {
        console.warn(`[CardComposer] Option selection failed for ${sessionId}:`, err);
      }
    },
    [sessionId, onSent]
  );

  // Send message / command directly into terminal PTY with decoupled Enter (\r)
  const handleSend = async () => {
    if (!sessionId) return;
    const text = draft.trim();
    if (!text) {
      try {
        await TerminalManager.sendPrompt(sessionId, '');
      } catch (err) {
        console.warn(`[CardComposer] Empty prompt send failed for ${sessionId}:`, err);
      }
      return;
    }

    try {
      setSendError(null);
      await TerminalManager.sendPrompt(sessionId, text);
      // ONLY wipe draft if the prompt was actually accepted by IPC
      setDraft('');
      setActivePrompt(null);
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 900);
      onSent?.(text);
    } catch (err: any) {
      console.error(`[CardComposer] sendPrompt failed for ${sessionId}:`, err);
      setSendError('Delivery failed (click to retry)');
      setTimeout(() => setSendError(null), 3500);
    } finally {
      // Keep focus in input for smooth follow-up typing
      inputRef.current?.focus();
    }
  };

  const handleCancelPrompt = async () => {
    if (!sessionId) return;
    setActivePrompt(null);
    await TerminalManager.sendMenuSelection(sessionId, 'escape');
  };

  // Dimensions
  const composerHeight = isUltraCompact ? 22 : isCompact ? 25 : 29;
  const fontSize = isUltraCompact ? '10px' : isCompact ? '10.5px' : '11.5px';
  const iconSize = isUltraCompact ? 9 : isCompact ? 10 : 12;

  return (
    <div
      className="card-composer-container"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: t.colors.bg.secondary,
        borderTop: `1px solid ${isFocused ? t.colors.accent.primary : t.colors.border.subtle}`,
        flexShrink: 0,
        zIndex: 5,
        userSelect: 'none',
        transition: 'border-color 0.15s ease',
      }}
    >

      {/* ── Optional Quick Choice Pills (shown when CLI asks questions / permissions) ── */}
      {activePrompt && activePrompt.options && activePrompt.options.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 6px',
            background: 'rgba(99, 102, 241, 0.08)',
            borderBottom: `1px dashed ${t.colors.border.subtle}`,
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: isCompact ? '9px' : '10px',
              fontWeight: 600,
              color: t.colors.accent.primary,
              marginRight: '2px',
              flexShrink: 0,
            }}
          >
            <Sparkles size={9} />
            <span>Choice:</span>
          </span>

          {activePrompt.options.map((opt) => (
            <button
              key={`${opt.key}-${opt.index}`}
              type="button"
              onClick={() => handleSelectOption(opt)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: isCompact ? '1px 5px' : '2px 7px',
                borderRadius: '3px',
                border: `1px solid ${opt.selected ? t.colors.accent.primary : t.colors.border.subtle}`,
                background: opt.selected ? `${t.colors.accent.primary}22` : t.colors.bg.elevated || '#1f2028',
                color: opt.selected ? t.colors.accent.primary : t.colors.text.primary,
                fontSize: isCompact ? '9px' : '10px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = t.colors.accent.primary;
                e.currentTarget.style.color = t.colors.accent.primary;
              }}
              onMouseLeave={(e) => {
                if (!opt.selected) {
                  e.currentTarget.style.borderColor = t.colors.border.subtle;
                  e.currentTarget.style.color = t.colors.text.primary;
                }
              }}
            >
              <span>{opt.label || opt.rawText || opt.key}</span>
            </button>
          ))}

          <button
            type="button"
            onClick={handleCancelPrompt}
            title="Cancel / Send Escape"
            style={{
              marginLeft: 'auto',
              padding: '1px 4px',
              borderRadius: '3px',
              border: 'none',
              background: 'transparent',
              color: t.colors.text.muted,
              fontSize: '9px',
              cursor: 'pointer',
              opacity: 0.8,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.colors.text.primary)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.colors.text.muted)}
          >
            Esc
          </button>
        </div>
      )}

      {/* ── Main Inline Input Strip ── */}
      <div
        style={{
          height: `${composerHeight}px`,
          display: 'flex',
          alignItems: 'center',
          padding: isCompact ? '0 4px 0 6px' : '0 6px 0 8px',
          gap: isCompact ? '4px' : '6px',
        }}
      >
        {/* CLI indicator glyph */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: t.colors.accent.primary,
            opacity: 0.85,
            flexShrink: 0,
            fontSize: isCompact ? '10px' : '11px',
            fontFamily: t.fontFamily.mono,
            fontWeight: 'bold',
          }}
          title={displayName}
        >
          {cli ? <CliLogo cli={cli} size={iconSize} /> : '❯'}
        </span>

        {/* Text Input Box */}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            } else if (e.key === 'Escape') {
              setDraft('');
            }
          }}
          placeholder={placeholderText}
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: t.colors.text.primary,
            fontSize,
            fontFamily: t.fontFamily.sans,
            padding: 0,
          }}
        />

        {/* Error notification badge if prompt delivery failed */}
        {sendError && (
          <span
            style={{
              fontSize: '10px',
              color: '#ef4444',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              padding: '0 4px',
              cursor: 'pointer',
            }}
            onClick={handleSend}
            title="Click to retry delivery"
          >
            <AlertCircle size={11} />
            {!isCompact && sendError}
          </span>
        )}

        {/* Send / Confirmation Action Button */}
        <button
          type="button"
          onClick={handleSend}
          title={sendError ? 'Retry sending prompt' : sentFlash ? 'Sent!' : 'Send command / prompt (Enter)'}
          style={{
            width: isCompact ? '18px' : '22px',
            height: isCompact ? '18px' : '22px',
            borderRadius: '4px',
            border: 'none',
            background: sendError
              ? 'rgba(239, 68, 68, 0.2)'
              : sentFlash
              ? 'rgba(16, 185, 129, 0.18)'
              : draft.trim()
              ? t.colors.accent.primary
              : 'transparent',
            color: sendError
              ? '#ef4444'
              : sentFlash
              ? '#10b981'
              : draft.trim()
              ? '#ffffff'
              : t.colors.text.muted,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.15s ease',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            if (!draft.trim() && !sentFlash && !sendError) {
              e.currentTarget.style.color = t.colors.text.primary;
              e.currentTarget.style.background = t.colors.bg.elevated || 'rgba(255,255,255,0.06)';
            }
          }}
          onMouseLeave={(e) => {
            if (!draft.trim() && !sentFlash && !sendError) {
              e.currentTarget.style.color = t.colors.text.muted;
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          {sendError ? (
            <AlertCircle size={iconSize} />
          ) : sentFlash ? (
            <Check size={iconSize} strokeWidth={2.5} />
          ) : draft.trim() ? (
            <CornerDownLeft size={iconSize} />
          ) : (
            <Send size={iconSize} />
          )}
        </button>
      </div>
    </div>
  );
});
