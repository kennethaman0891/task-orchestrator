// Per-session chat transcript for terminal TUIs.
//
// Antigravity and Gemini redraw the viewport. Re-parsing that frame on every
// paint replaces the conversation with the splash and keeps permission menus
// that have already left the screen. This store appends turns as the viewport
// changes and opens a permission card only while the live tail still shows one.
// Block glyphs, the shell prompt, and the splash screen are chrome, not turns.

import type { DetectedTerminalPrompt, PromptOption as DetectedOption } from '@/jarvis/terminalPromptDetector';
import { detectTerminalPrompt } from '@/jarvis/terminalPromptDetector';
import type { InteractivePrompt, PromptOption, UnifiedChatMessage } from '@/terminal/dialogueParser';

const SNAPSHOT_CLIS = new Set(['antigravity', 'agy', 'gemini', 'gemini-cli']);

export function usesLiveTranscript(cli: string): boolean {
  return SNAPSHOT_CLIS.has((cli || '').toLowerCase());
}

interface HeldChoice {
  promptId: string;
  selectedKey: string;
}

interface Session {
  seq: number;
  messages: UnifiedChatMessage[];
  published: UnifiedChatMessage[];
  openAssistantId: string | null;
  lastBody: string;
  livePromptId: string | null;
  promptMisses: number;
  held: HeldChoice | null;
}

const sessions = new Map<string, Session>();

function ensure(sessionId: string): Session {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      seq: 1,
      messages: [],
      published: [],
      openAssistantId: null,
      lastBody: '',
      livePromptId: null,
      promptMisses: 0,
      held: null,
    };
    sessions.set(sessionId, session);
  }
  return session;
}

export function resetTranscripts(): void {
  sessions.clear();
}

export function clearTranscript(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getTranscript(sessionId: string): UnifiedChatMessage[] {
  return sessions.get(sessionId)?.published ?? [];
}

/** Bytes to write for a menu choice. y/n never gain a carriage return. */
export function menuKeystrokes(value: string, opts: { enter: boolean }): string[] {
  if (!value || value === 'escape' || value === '\x1b') return ['\x1b'];
  const bare = value.replace(/\r/g, '');
  if (/^[yn]$/i.test(bare)) return [bare.toLowerCase()];
  if (opts.enter) return [bare, '\r'];
  return [bare];
}

/** Numbered menus submit with Enter. Antigravity does that only when the tail says so. */
export function promptNeedsEnter(viewportLines: string[], cli: string): boolean {
  const tail = viewportLines.slice(-30).join('\n');
  if (/enter to confirm/i.test(tail)) return true;
  const name = (cli || '').toLowerCase();
  return name === 'claude' || name === 'claude-code' || name === 'codex' || name === 'codex-cli';
}

// Logo rows paint block, box-drawing, and braille glyphs in front of the text.
const LEADING_ART = /^(?:[\u2500-\u257F\u2580-\u259F\u25A0-\u25FF\u2800-\u28FF]+[ \t]*)+/u;

function stripLeadingArt(line: string): string {
  return line.trim().replace(LEADING_ART, '').trim();
}

function isShellPrompt(text: string): boolean {
  return /^\S+@\S+(?:\s+\S+)*\s+[%#$](?:\s+\S+)*$/.test(text);
}

function isRealUserReply(line: string): boolean {
  const text = stripLeadingArt(line);
  const match = text.match(/^[>❯]\s+(.+)/);
  if (!match) return false;
  const echoed = match[1].trim();
  if (!echoed || /^(?:try\s+["']|try asking)/i.test(echoed) || /^\d+[.)]\s+/.test(echoed)) return false;
  return true;
}

function hasSplashSignature(line: string): boolean {
  const text = stripLeadingArt(line);
  return /^antigravity\s+cli\s+v?\d/i.test(text)
    || /^gemini\s+cli\b/i.test(text)
    || /^\? for shortcuts\b/i.test(text);
}

function isChromeLine(line: string, cli: string): boolean {
  const text = stripLeadingArt(line);
  if (!text) return true;
  if (/^[─━═┄┈┌┐└┘├┤┬┴┼╭╮╯╰│┃┆┇┊┋\s]+$/.test(text)) return true;
  if (/^[>❯]\s*$/.test(text)) return true;
  if (/^\? for shortcuts\b/i.test(text)) return true;
  if (/^shift\+tab to cycle/i.test(text)) return true;
  if (/^claude\s+code\s+v?\d+/i.test(text)) return true;
  if (/^opencode\s+v?\d+/i.test(text)) return true;
  if (!usesLiveTranscript(cli)) return false;
  if (isShellPrompt(text)) return true;
  if (/^antigravity\s+cli\s+v?\d/i.test(text)) return true;
  if (/^gemini\s+cli\b/i.test(text)) return true;
  if (/^gemini\s+\d[\w.\s()-]*$/i.test(text)) return true;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}(?:\s+\([^)]+\))?$/i.test(text)) return true;
  if (/^~\/[A-Za-z0-9._-]+$/.test(text)) return true;
  if (/^\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\/?$/.test(text)) return true;
  return false;
}

export function stripTerminalChrome(lines: string[], cli: string): string[] {
  return lines.map((line) => stripLeadingArt(line)).filter((line) => !isChromeLine(line, cli));
}

function isSplashOnlyText(text: string, cli: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => isChromeLine(line, cli));
}

/** Version line or "? for shortcuts", and no echoed user reply in this paint. */
function isUnansweredSplash(viewportLines: string[], cli: string): boolean {
  if (!usesLiveTranscript(cli)) return false;
  let signed = false;
  for (const line of viewportLines) {
    if (isRealUserReply(line)) return false;
    if (hasSplashSignature(line)) signed = true;
  }
  return signed;
}

function stripPromptLines(lines: string[], detected: DetectedTerminalPrompt | null): string[] {
  return lines.filter((line) => {
    if (/^([>❯*]\s*)?\d+[.)]\s+/.test(line)) return false;
    if (/^(?:esc to cancel|enter to confirm|tab to amend)/i.test(line)) return false;
    if (/requesting permission for:/i.test(line)) return false;
    if (/\[[yYnN]\/[yYnN]\]|\([yY]\/[nN]\)|\(yes\/no\)/i.test(line)) return false;
    if (detected && line === detected.question.trim()) return false;
    return true;
  });
}

function toOption(option: DetectedOption, index: number): PromptOption {
  const binary = option.value === 'y' || option.value === 'n';
  return {
    index: index + 1,
    key: option.key,
    label: option.label,
    rawText: binary ? option.label : `${option.key}. ${option.label}`,
    selected: option.selected,
    value: option.value,
  };
}

function toInteractive(
  detected: DetectedTerminalPrompt,
  resolved: boolean,
  selectedKey?: string,
): InteractivePrompt {
  return {
    id: detected.id,
    type: detected.type === 'confirm' ? 'confirm' : detected.type === 'permission' ? 'permission' : 'select',
    title: detected.type === 'question' || detected.type === 'select' ? 'Question' : 'Permission Request',
    command: detected.command,
    question: detected.question,
    options: detected.options.map(toOption),
    resolved,
    selectedKey,
  };
}

function createMessage(session: Session, role: 'user' | 'assistant', text: string): UnifiedChatMessage {
  return {
    id: `${role}-${session.seq++}`,
    role,
    time: Date.now(),
    textParts: [text],
    reasoningParts: [],
    toolParts: [],
  };
}

function signature(messages: UnifiedChatMessage[]): string {
  return messages
    .map((message) => {
      const prompt = message.interactivePrompt;
      const options = (prompt?.options ?? []).map((option) => `${option.key}:${option.label}`).join(',');
      return [
        message.id,
        message.role,
        message.textParts.join('\n'),
        prompt?.id ?? '',
        prompt?.resolved ? '1' : '0',
        prompt?.selectedKey ?? '',
        prompt?.question ?? '',
        options,
      ].join('|');
    })
    .join('\n');
}

function cloneMessages(messages: UnifiedChatMessage[]): UnifiedChatMessage[] {
  return messages.map((message) => ({
    ...message,
    textParts: [...message.textParts],
    reasoningParts: [...message.reasoningParts],
    toolParts: [...message.toolParts],
    interactivePrompt: message.interactivePrompt
      ? {
          ...message.interactivePrompt,
          options: message.interactivePrompt.options.map((option) => ({ ...option })),
        }
      : undefined,
  }));
}

function publish(session: Session): UnifiedChatMessage[] {
  const cloned = cloneMessages(session.messages);
  if (signature(session.published) === signature(cloned)) return session.published;
  session.published = cloned;
  return session.published;
}

function markResolved(session: Session, promptId: string, selectedKey?: string): void {
  const message = session.messages.find((item) => item.interactivePrompt?.id === promptId);
  if (!message?.interactivePrompt) return;
  message.interactivePrompt = {
    ...message.interactivePrompt,
    resolved: true,
    selectedKey: selectedKey || message.interactivePrompt.selectedKey || 'approved',
  };
}

function upsertPrompt(session: Session, detected: DetectedTerminalPrompt, selectedKey?: string): void {
  const prompt = toInteractive(detected, Boolean(selectedKey), selectedKey);
  const existing = session.messages.find((item) => item.interactivePrompt?.id === detected.id);
  if (existing) {
    existing.interactivePrompt = prompt;
    return;
  }
  const last = session.messages[session.messages.length - 1];
  if (last?.role === 'assistant' && !last.interactivePrompt?.resolved) {
    last.interactivePrompt = prompt;
    return;
  }
  const message = createMessage(session, 'assistant', detected.question || 'Permission requested');
  message.interactivePrompt = prompt;
  session.messages.push(message);
}

function applyEchoes(session: Session, lines: string[]): string[] {
  const body: string[] = [];
  for (const line of lines) {
    const match = line.match(/^[>❯]\s+(.+)/);
    const echoed = match?.[1]?.trim() ?? '';
    if (!match || /^(?:try\s+["']|try asking)/i.test(echoed) || /^\d+[.)]\s+/.test(echoed)) {
      body.push(line);
      continue;
    }
    const lastUser = [...session.messages].reverse().find((item) => item.role === 'user');
    if (lastUser?.textParts[0] === echoed) continue;
    session.openAssistantId = null;
    session.lastBody = '';
    session.messages.push(createMessage(session, 'user', echoed));
  }
  return body;
}

function dropMessage(session: Session, message: UnifiedChatMessage): void {
  const index = session.messages.findIndex((item) => item.id === message.id);
  if (index >= 0) session.messages.splice(index, 1);
  if (session.openAssistantId === message.id) {
    session.openAssistantId = null;
    session.lastBody = '';
  }
}

function dropSplashAssistant(session: Session, cli: string): void {
  const stale = [...session.messages].reverse().find((item) => item.role === 'assistant' && !item.interactivePrompt);
  if (!stale || !isSplashOnlyText(stale.textParts.join('\n'), cli)) return;
  dropMessage(session, stale);
}

function applyBody(session: Session, body: string, cli: string): void {
  if (!body || isSplashOnlyText(body, cli)) {
    if (body) dropSplashAssistant(session, cli);
    session.openAssistantId = null;
    session.lastBody = '';
    return;
  }
  let open = session.openAssistantId
    ? session.messages.find((item) => item.id === session.openAssistantId)
    : undefined;
  if (open && isSplashOnlyText(open.textParts.join('\n'), cli)) {
    dropMessage(session, open);
    open = undefined;
  }
  if (open && session.lastBody && (body === session.lastBody || body.startsWith(session.lastBody) || session.lastBody.startsWith(body))) {
    if (open.textParts[0] !== body) open.textParts = [body];
    session.lastBody = body;
    return;
  }
  if (open && session.lastBody && body !== session.lastBody) {
    session.openAssistantId = null;
  }
  const lastAssistant = [...session.messages].reverse().find((item) => item.role === 'assistant' && !item.interactivePrompt);
  if (lastAssistant?.textParts[0] === body) {
    session.openAssistantId = lastAssistant.id;
    session.lastBody = body;
    return;
  }
  if (lastAssistant && isSplashOnlyText(lastAssistant.textParts.join('\n'), cli)) {
    dropMessage(session, lastAssistant);
  }
  const message = createMessage(session, 'assistant', body);
  session.messages.push(message);
  session.openAssistantId = message.id;
  session.lastBody = body;
}

export function appendUserMessage(sessionId: string, text: string): UnifiedChatMessage[] {
  const session = ensure(sessionId);
  const trimmed = text.trim();
  if (!trimmed) return publish(session);
  session.openAssistantId = null;
  session.lastBody = '';
  session.messages.push(createMessage(session, 'user', trimmed));
  return publish(session);
}

export function markPromptSelected(sessionId: string, promptId: string, selectedKey: string): UnifiedChatMessage[] {
  const session = ensure(sessionId);
  session.held = { promptId, selectedKey };
  markResolved(session, promptId, selectedKey);
  return publish(session);
}

/**
 * Fold one painted viewport into the session transcript.
 * A permission card resolves only after two snapshots in a row no longer show it.
 */
export function snapshotTranscript(sessionId: string, viewportLines: string[], cli: string): UnifiedChatMessage[] {
  const session = ensure(sessionId);
  const unansweredSplash = isUnansweredSplash(viewportLines, cli);
  const content = stripTerminalChrome(viewportLines, cli);
  const detected = detectTerminalPrompt(content, cli);

  if (detected) {
    if (session.livePromptId && session.livePromptId !== detected.id) {
      markResolved(session, session.livePromptId, session.held?.promptId === session.livePromptId ? session.held.selectedKey : undefined);
      session.held = null;
    }
    const prose = applyEchoes(session, stripPromptLines(content, detected).filter((line) => line !== detected.command));
    const body = prose.join('\n').trim();
    if (unansweredSplash) dropSplashAssistant(session, cli);
    else if (body) applyBody(session, body, cli);
    const selected = session.held?.promptId === detected.id ? session.held.selectedKey : undefined;
    upsertPrompt(session, detected, selected);
    session.livePromptId = detected.id;
    session.promptMisses = 0;
    return publish(session);
  }

  if (session.livePromptId) {
    session.promptMisses += 1;
    if (session.promptMisses >= 2) {
      const selected = session.held?.promptId === session.livePromptId ? session.held.selectedKey : undefined;
      markResolved(session, session.livePromptId, selected);
      session.livePromptId = null;
      session.promptMisses = 0;
      session.held = null;
    }
  }

  const prose = applyEchoes(session, stripPromptLines(content, null));
  if (unansweredSplash) {
    // Idle splash must not clear the open answer. The next real paint
    // still extends that same card.
    dropSplashAssistant(session, cli);
  } else {
    applyBody(session, prose.join('\n').trim(), cli);
  }
  return publish(session);
}
