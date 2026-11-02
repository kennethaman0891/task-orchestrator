// ═══════════════════════════════════════════════════════════════════════════
// JARVIS TERMINAL PROMPT & COMPLETION DETECTOR
// Inspects live terminal buffer for interactive permission requests, questions,
// and task completion across Antigravity CLI, Claude Code, Codex, and shells.
// ═══════════════════════════════════════════════════════════════════════════

export interface PromptOption {
  key: string;       // "1", "2", "y", "n", "esc"
  label: string;     // "Yes, run command", "Always allow", "Cancel"
  value: string;     // "1", "2", "y", "n", "escape"
  selected?: boolean;
}

export interface DetectedTerminalPrompt {
  id: string;        // Unique hash to prevent repeating the same prompt
  type: 'permission' | 'question' | 'select' | 'confirm';
  command?: string;
  question: string;
  options: PromptOption[];
  spokenPrompt: string; // Crisp 1-2 sentence spoken phrase for Jarvis
  detectedAt: number;
}

export interface TerminalObservationResult {
  hasPrompt: boolean;
  prompt?: DetectedTerminalPrompt;
  isAsking: boolean;
  isWorking: boolean;
  isCompleted: boolean;
  completedSummary?: string;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

// Box-drawing, blocks, and braille are frame chrome. Selection markers (❯ › ●) are not.
const BORDER = /[\u2500-\u257F\u2580-\u259F\u2800-\u28FF|❘❙❚\u23B8\u23B9]/u;
const LEADING_BORDER = new RegExp(`^(?:${BORDER.source}+\\s*)+`, 'u');
const TRAILING_BORDER = new RegExp(`(?:\\s*${BORDER.source}+)+$`, 'u');
const MARKER = '[>❯›▸*●◯○]';
const CURSOR_MARKER = /[>❯›▸*●]/u;
const NUMBERED_RE = new RegExp(`^(?:(${MARKER})\\s*)?(\\d+)[.)]\\s+(.+)$`, 'u');
const MARKED_LABEL_RE = new RegExp(`^(${MARKER})\\s*(.+)$`, 'u');

export function normalizePromptLine(raw: string): string {
  let line = stripAnsi(raw).replace(/\u00a0/g, ' ').trim();
  for (let i = 0; i < 8; i++) {
    const next = line.replace(LEADING_BORDER, '').replace(TRAILING_BORDER, '').trim();
    if (next === line) break;
    line = next;
  }
  return line;
}

export function isPromptHintLine(line: string): boolean {
  const text = normalizePromptLine(line);
  if (!text) return false;
  if (/\? for shortcuts|\bpress\s+\?/i.test(text)) return true;
  if (/^(?:esc to cancel|enter to confirm|tab to amend|press enter|enter to select)\b/i.test(text)) return true;
  return text.length <= 80 && /(?:esc to cancel|enter to confirm|tab to amend)/i.test(text);
}

export function isPermissionHeaderLine(line: string): boolean {
  const text = normalizePromptLine(line);
  return /^(?:requesting permission\b|bash command\b|run this command\b|do you want to proceed\b|allow this\b|allow tool\b|authorize\b|permission request\b|apply this change\b|approve this\b)/i.test(text);
}

export function isBinaryPromptLine(line: string): boolean {
  return /(?:\[[yYnN]\/[yYnN]\]|\([yYnN]\/[yYnN]\)|\(yes\/no\))/i.test(normalizePromptLine(line));
}

export function isQuestionLine(line: string): boolean {
  const text = normalizePromptLine(line);
  if (!/\?\s*$/.test(text)) return false;
  if (/^\?\s*$/.test(text)) return false;
  if (isPromptHintLine(text)) return false;
  if (/\b(?:shortcuts|hints)\b/i.test(text)) return false;
  return true;
}

interface ParsedOption {
  key: string;
  label: string;
  selected: boolean;
}

function markerSelected(marker: string | undefined): boolean {
  return Boolean(marker && CURSOR_MARKER.test(marker));
}

export function parseNumberedOption(line: string): ParsedOption | null {
  const match = normalizePromptLine(line).match(NUMBERED_RE);
  if (!match) return null;
  return {
    key: match[2],
    label: match[3].trim(),
    selected: markerSelected(match[1]),
  };
}

export function isNumberedPromptOption(line: string): boolean {
  return parseNumberedOption(line) !== null;
}

function isChoiceLabel(label: string): boolean {
  const text = label.trim();
  if (!text || text.length > 120 || /\?\s*$/.test(text)) return false;
  if (/^(?:yes|no|always allow|allow once|always|allow|deny|proceed|skip|cancel|approve|reject)$/i.test(text)) {
    return true;
  }
  return /^(?:yes|no|allow|deny)\b/i.test(text) && !/[.!?]$/.test(text);
}

export function parseUnnumberedChoice(line: string): { label: string; selected: boolean } | null {
  const normalized = normalizePromptLine(line);
  if (!normalized || parseNumberedOption(normalized)) return null;
  let selected = false;
  let label = normalized;
  const marked = normalized.match(MARKED_LABEL_RE);
  if (marked) {
    selected = markerSelected(marked[1]);
    label = marked[2].trim();
  }
  if (!isChoiceLabel(label)) return null;
  return { label, selected };
}

export function isUnnumberedPromptChoice(line: string): boolean {
  return parseUnnumberedChoice(line) !== null;
}

function polarity(label: string): 'y' | 'n' | null {
  if (/^(?:yes|allow|proceed|approve|always)\b/i.test(label)) return 'y';
  if (/^(?:no|deny|cancel|reject)\b/i.test(label)) return 'n';
  return null;
}

function toOptions(rows: ParsedOption[], binaryValues: boolean): PromptOption[] {
  let values = rows.map((row) => row.key);
  if (binaryValues && rows.length === 2) {
    const left = polarity(rows[0].label);
    const right = polarity(rows[1].label);
    if (left && right && left !== right) values = [left, right];
  }
  return rows.map((row, index) => ({
    key: row.key,
    label: row.label,
    value: values[index],
    selected: row.selected,
  }));
}

function extractCommand(tail: string[]): string {
  for (let i = 0; i < tail.length; i++) {
    const line = tail[i];
    const permMatch = line.match(/requesting permission for:\s*(.*)/i);
    if (permMatch) {
      if (permMatch[1] && permMatch[1].trim()) return permMatch[1].trim();
      if (tail[i + 1] && !tail[i + 1].includes('Run this command')) return tail[i + 1].trim();
      return '';
    }
    if (/^bash command\b/i.test(line) && tail[i + 1]) return tail[i + 1].trim();
  }
  return '';
}

function findQuestion(tail: string[]): string {
  for (let i = tail.length - 1; i >= 0; i--) {
    if (!isQuestionLine(tail[i]) || parseNumberedOption(tail[i])) continue;
    return tail[i];
  }
  return '';
}

function lastChoiceRun(tail: string[]): Array<{ label: string; selected: boolean }> | null {
  const runs: Array<Array<{ label: string; selected: boolean }>> = [];
  let current: Array<{ label: string; selected: boolean }> = [];
  const flush = () => {
    if (current.length > 0) runs.push(current);
    current = [];
  };
  for (const line of tail) {
    if (isPromptHintLine(line) || isPermissionHeaderLine(line) || isQuestionLine(line) || isBinaryPromptLine(line) || parseNumberedOption(line)) {
      flush();
      continue;
    }
    const choice = parseUnnumberedChoice(line);
    if (choice) current.push(choice);
    else flush();
  }
  flush();
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].length >= 2) return runs[i];
  }
  return null;
}

function buildMenu(
  cliName: string,
  type: 'permission' | 'question',
  command: string,
  question: string,
  options: PromptOption[],
): DetectedTerminalPrompt {
  const commandBrief = command ? command.slice(0, 80) : '';
  const spoken = commandBrief
    ? `${cliName} is requesting permission to run: ${commandBrief}. Say 'yes' or '1' to allow, or 'no' to cancel.`
    : `${cliName} has a question: ${question}. Options are: ${options.map((o) => `${o.key}: ${o.label}`).slice(0, 3).join(', ')}. What would you like to do?`;
  return {
    id: `prompt-${command.slice(0, 32)}-${options.map((o) => o.key).join('')}-${question.slice(0, 24)}`,
    type,
    command,
    question,
    options,
    spokenPrompt: spoken,
    detectedAt: Date.now(),
  };
}

function buildBinary(cliName: string, question: string): DetectedTerminalPrompt {
  return {
    id: `binary-${question.slice(0, 40)}`,
    type: 'confirm',
    question,
    options: [
      { key: '1', label: 'Yes', value: 'y', selected: true },
      { key: '2', label: 'No', value: 'n' },
    ],
    spokenPrompt: `${cliName} is asking: ${question}. Say 'yes' to proceed, or 'no' to cancel.`,
    detectedAt: Date.now(),
  };
}

const BINARY_INLINE = /^(.+?)\s*(?:\[[yYnN]\/[yYnN]\]|\([yYnN]\/[yYnN]\)|\(yes\/no\))\s*[:?]?\s*$/i;
const BINARY_BARE = /^(?:\[[yYnN]\/[yYnN]\]|\([yYnN]\/[yYnN]\)|\(yes\/no\))\s*[:?]?\s*$/i;

function findBinary(lines: string[], cliName: string): DetectedTerminalPrompt | null {
  const window = lines.slice(-8);
  for (let i = window.length - 1; i >= 0; i--) {
    const line = window[i];
    if (isPromptHintLine(line) && !isBinaryPromptLine(line)) continue;
    const inline = line.match(BINARY_INLINE);
    if (inline && isBinaryPromptLine(line)) {
      const qText = inline[1].trim();
      if (qText) return buildBinary(cliName, qText);
    }
    if (BINARY_BARE.test(line)) {
      let qText = 'Proceed?';
      for (let j = i - 1; j >= 0; j--) {
        if (isQuestionLine(window[j])) {
          qText = window[j];
          break;
        }
      }
      return buildBinary(cliName, qText);
    }
  }
  return null;
}

/**
 * Parses the live terminal buffer to detect if the CLI is currently waiting
 * for user permission or answering a question.
 */
export function detectTerminalPrompt(rawLines: string[], cliName: string = 'Antigravity'): DetectedTerminalPrompt | null {
  if (!rawLines || rawLines.length === 0) return null;

  const tail = rawLines.map(normalizePromptLine).filter(Boolean).slice(-25);
  if (tail.length === 0) return null;

  const command = extractCommand(tail);
  let question = findQuestion(tail);
  const hasPermission = tail.some((line) => isPermissionHeaderLine(line));
  if (!question && hasPermission) question = 'Run this command?';

  const numbered = tail
    .map((line) => parseNumberedOption(line))
    .filter((row): row is ParsedOption => row !== null);
  if (numbered.length >= 2 && (hasPermission || question)) {
    return buildMenu(cliName, hasPermission ? 'permission' : 'question', command, question, toOptions(numbered, false));
  }

  const choices = !hasPermission && !question ? null : lastChoiceRun(tail);
  if (choices && choices.length >= 2) {
    const rows = choices.map((choice, index) => ({
      key: String(index + 1),
      label: choice.label,
      selected: choice.selected,
    }));
    return buildMenu(cliName, hasPermission ? 'permission' : 'question', command, question, toOptions(rows, true));
  }

  return findBinary(tail, cliName);
}

/**
 * Checks whether the terminal has completed a running task and returned to idle.
 */
export function detectTaskCompletion(
  rawLines: string[],
  wasWorking: boolean,
  taskStartTime: number = 0,
): { isCompleted: boolean; summary?: string } {
  if (!wasWorking || !rawLines || rawLines.length === 0) {
    return { isCompleted: false };
  }

  // Guard: minimum 1.5 seconds since task started before concluding completion
  if (Date.now() - taskStartTime < 1500) {
    return { isCompleted: false };
  }

  const lines = rawLines.map((l) => stripAnsi(l).trimEnd());
  const nonBlank = lines.map((l) => l.trim()).filter(Boolean);
  if (nonBlank.length === 0) return { isCompleted: false };

  const lastLine = nonBlank[nonBlank.length - 1] || '';
  const secondLast = nonBlank[nonBlank.length - 2] || '';
  const recentTail = nonBlank.slice(-10).join('\n');

  // 1. If actively asking a question or running tools, it is NOT completed
  if (/requesting permission|run this command\?|do you want to proceed|thinking\.\.\.|\bexecuting\b|\brunning\b/i.test(recentTail)) {
    return { isCompleted: false };
  }

  // 2. Check for universal prompt indicators (idle waiting for next instruction)
  const isAtIdlePrompt =
    /^[❯>$#%]\s*$/.test(lastLine) ||
    /^[>❯]\s*(?:\[\s*\]|Try\s+["']|type\s+a\s+message|ask\s+anything)/i.test(lastLine) ||
    (/^[❯>$#%]\s*$/.test(secondLast) && /\?\s*for\s*shortcuts|press\s*\?/i.test(lastLine));

  // 3. Completion markers in recent lines
  const completionMatch = recentTail.match(
    /(?:thought for\s+[\d.]+s|✔\s+applied|✓\s+done|completed\b|finished\b|tests?\s+passed|success(?:fully)?\b)/i
  );

  if (isAtIdlePrompt) {
    let summary = 'Task execution completed.';
    for (let i = nonBlank.length - 1; i >= Math.max(0, nonBlank.length - 12); i--) {
      const line = nonBlank[i];
      if (/thought for\s+[\d.]+s/i.test(line)) {
        summary = line;
        break;
      }
      if (/✔|✓|completed|finished|passed|done/i.test(line) && !/shortcuts|hints/i.test(line)) {
        summary = line;
        break;
      }
    }
    return { isCompleted: true, summary };
  }

  if (completionMatch && isAtIdlePrompt) {
    return { isCompleted: true, summary: completionMatch[0] };
  }

  return { isCompleted: false };
}
