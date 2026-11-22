// ═══════════════════════════════════════════════════════════════════════════
// AUTO TERMINAL NAME — Zero-API-Key, Read-Only Conversation Task Summarizer
//
// Reads rendered terminal buffer lines (read-only, never writes to PTY, never
// calls external APIs or requires API keys) and distills the active user task
// from ANY CLI (Antigravity, OpenCode, Claude Code, Codex, Gemini, Cursor,
// Qwen, Prime, generic shell/TUI) into a concise 2–5 word terminal name.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_NAME_LEN = 28;
const MAX_WORDS = 5;

/** Acronyms / technical tokens whose uppercase casing should be preserved. */
const PRESERVE_UPPER = new Set([
  'API', 'UI', 'UX', 'CLI', 'CSS', 'HTML', 'DOM', 'DB', 'SQL', 'JWT',
  'AUTH', 'TTO', 'PR', 'CI', 'CD', 'TS', 'JS', 'TSX', 'JSX', 'JSON',
  'YAML', 'XML', 'MCP', 'PTY', 'SSH', 'URL', 'URI', 'HTTP', 'HTTPS',
  'LLM', 'AI', 'OS', 'ID', 'SDK', 'IDE', 'SVG', 'PNG', 'PDF', 'DMG',
  'AWS', 'GCP', 'K8S', 'NPM', 'PIP', 'UV', 'RAG', 'SSE', 'WS', 'RPC',
  'CRUD', 'REST', 'TUI', 'LCP', 'CLS', 'INP', 'A11Y', 'E2E', 'QA',
]);

/** Leading filler/politeness phrases stripped before extracting the core task. */
const LEADING_FILLER_RE = new RegExp(
  '^(?:' +
    '(?:hey|hi|hello|yo|ok|okay|alright|so|now|well|um|uh|actually|basically)\\b[,!.:\\s]*|' +
    '(?:please|pls|kindly)\\b[,!.:\\s]*|' +
    '(?:can|could|would|will)\\s+you\\b[,!.:\\s]*|' +
    '(?:i\\s+(?:want|need|would\\s+like)\\s+(?:you\\s+)?to)\\b[,!.:\\s]*|' +
    '(?:help\\s+me(?:\\s+to)?)\\b[,!.:\\s]*|' +
    '(?:let\'?s|go\\s+ahead\\s+and|make\\s+sure(?:\\s+you|\\s+to)?|try\\s+to)\\b[,!.:\\s]*' +
  ')+',
  'i'
);

/** Weak filler words dropped when trimming long titles to fit MAX_WORDS / MAX_NAME_LEN. */
const DROP_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'your',
  'its', 'their', 'some', 'any', 'very', 'really', 'just', 'also', 'out',
  'there', 'here', 'into', 'onto', 'from', 'with', 'about', 'for', 'of',
  'to', 'in', 'on', 'at', 'by', 'and', 'or', 'but', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'should', 'would', 'could', 'please',
  'like', 'kind', 'manner', 'stuff', 'things', 'thing', 'all', 'actually',
]);

/** Known CLI / TUI boilerplate, status bars, permission prompts, and hints to ignore. */
const NOISE_LINE_RE = new RegExp(
  [
    // Welcome / hint / placeholder prompts
    '\\?\\s*for\\s*shortcuts',
    'type\\s+a\\s+message',
    'ask\\s+anything',
    'shift\\+tab\\s+to\\s+cycle',
    'ctrl\\+[a-z]\\s+(?:commands|to\\s+)',
    'auto\\s+mode\\s+on',
    'tab\\s+agents\\b',
    'try\\s+["\']',
    'welcome\\s+to\\s+(?:claude|opencode|antigravity|codex|gemini|cursor|qwen)',
    'api\\s+usage\\s+billing',
    'bypass\\s+permissions',
    'bypasssandbox',
    'terminal_sandbox',
    'mcp\\s+/status',
    '/connect\\s+to\\s+add',
    // Permission / confirmation prompts
    'requesting\\s+permission\\s+for:',
    'do\\s+you\\s+want\\s+to\\s+proceed',
    '\\[(?:y/n|yes/no)\\]|\\((?:y/n|yes/no)\\)',
    '^(?:allow|deny|approve|reject|yes|no|y|n)\\b',
    // Thinking / tool execution status
    '^(?:thinking|thought\\s+for|analyzing|generating|searching|executing|running\\s+tool|reading\\s+file|editing\\s+file|writing\\s+file|updating|exploring)\\b',
    '^(?:added|removed)\\s+\\d+\\s+line',
    '^(?:tool\\s+result|viewed\\s+file|created\\s+file|updated\\s+file|command\\s+exited)\\b',
    // Token / cost / model status bars
    '\\b\\d+(?:\\.\\d+)?[kKmM]?\\s*tokens\\b',
    '\\$\\d+\\.\\d{2,}',
    '\\bcontext\\s*:\\s*\\d+%',
    '^(?:build|plan)\\s*[·•]\\s*\\S+',
  ].join('|'),
  'i'
);

/** Trivial shell / CLI launcher commands that are not a real task. */
const TRIVIAL_CMD_RE = new RegExp(
  '^(?:' +
    '(?:ls|ll|la|cd|pwd|clear|cls|exit|quit|logout|history|whoami|id|date|uptime|env|export|alias|unalias|which|where|type|echo|cat|head|tail|less|more|touch|mkdir|rm|cp|mv|chmod|chown|ps|top|htop|kill|jobs|fg|bg|man)(?:\\s+.*)?|' +
    'git\\s+(?:status|diff|log|branch|fetch|pull|stash|show)(?:\\s+.*)?|' +
    '(?:claude|opencode|agy|antigravity|codex|gemini|cursor|qwen|prime|zsh|bash|sh|fish|tmux|screen|vim|nvim|nano|code)(?:\\s+.*)?|' +
    '/[a-z][a-z0-9_-]*(?:\\s+.*)?' +
  ')$',
  'i'
);

/** Strip ANSI escape sequences and box-drawing / TUI border chrome from a line. */
function cleanLine(raw: string): string {
  // Remove ANSI CSI / OSC sequences if any survived
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  // Strip leading/trailing box-drawing & block chrome (│ ┃ ╭ ╮ ╰ ╯ ─ ━ ▌ ▐ █ ░ ▒ ▓ •)
  s = s.replace(/^[\s│┃┆┇┊┋╭╮╰╯┌┐└┘├┤┬┴┼─━═║╔╗╚╝╠╣╦╩╬▌▐█▀▄░▒▓]+/, '');
  s = s.replace(/[\s│┃┆┇┊┋╭╮╰╯┌┐└┘├┤┬┴┼─━═║╔╗╚╝╠╣╦╩╬▌▐█▀▄░▒▓]+$/, '');
  return s.trim();
}

/** True if the cleaned line is empty, pure punctuation/borders, or CLI noise. */
function isNoiseOrTrivial(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 3) return true;
  // Must contain at least 2 ASCII letters
  const letters = t.match(/[a-zA-Z]/g);
  if (!letters || letters.length < 2) return true;
  // Ignore pure box/separator lines or bracketed empty inputs like "[ ]"
  if (/^[\[\]\(\)\{\}\s._\-=*#~`'"<>|/\\:;,!?+@$%^&0-9]+$/.test(t)) return true;
  if (/^\[\s*\]$/.test(t)) return true;
  // Ignore URLs or bare file paths
  if (/^(?:https?:\/\/|\/[\w.-]+|~\/[\w.-]+|\.\.?\/[\w.-]+)\S*$/.test(t)) return true;
  // Ignore known CLI chrome / status / permission lines
  if (NOISE_LINE_RE.test(t)) return true;
  // Ignore trivial shell commands & slash commands
  if (TRIVIAL_CMD_RE.test(t)) return true;
  return false;
}

/** Format a single word in clean Title Case, preserving known acronyms. */
function formatWord(word: string): string {
  const upper = word.toUpperCase();
  if (PRESERVE_UPPER.has(upper)) return upper;
  // Preserve camelCase / PascalCase identifiers like "App.tsx" or "TerminalManager"
  if (/[a-z][A-Z]/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Distill a raw user prompt / task line into a concise, clean short name
 * (2–5 words, max 28 characters). Returns null if the text isn't a real task.
 */
export function summarizeTaskToShortName(rawText: string): string | null {
  if (!rawText) return null;

  let text = cleanLine(rawText);
  if (isNoiseOrTrivial(text)) return null;

  // Strip explicit prefix labels like "Task:", "Goal:", "Prompt:", "You:"
  text = text.replace(/^(?:task|goal|objective|plan|prompt|summary|you|user|human)\s*:\s*/i, '').trim();

  // Strip markdown formatting (backticks, bold/italic, quotes)
  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, ' ')
    .replace(/["'“”‘’]/g, '')
    // Shorten long file paths to just the basename
    .replace(/(?:\/[\w.-]+)+\/([\w.-]+)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Take only the first clause/sentence if the prompt is multi-sentence
  const firstClause = text.split(/(?:[.!?]\s+|\s+[-–—]\s+|\n)/)[0]?.trim() || text;
  text = firstClause;

  // Strip leading conversational filler ("please can you help me...")
  text = text.replace(LEADING_FILLER_RE, '').trim();
  // Strip trailing punctuation
  text = text.replace(/[,:;!?.\-–—]+$/, '').trim();

  if (isNoiseOrTrivial(text)) return null;

  // Tokenize into clean words
  const rawTokens = text
    .split(/[\s/]+/)
    .map((tok) => tok.replace(/^[^a-zA-Z0-9.#+-]+|[^a-zA-Z0-9.#+-]+$/g, ''))
    .filter((tok) => tok.length > 0 && /[a-zA-Z0-9]/.test(tok));

  if (rawTokens.length === 0) return null;

  // Prefer keeping the first word (usually the action verb: Fix, Add, Build, Refactor, Debug...)
  // and filtering out weak filler words when there are more than 4 tokens.
  let chosen: string[];
  if (rawTokens.length <= 4) {
    chosen = rawTokens;
  } else {
    const first = rawTokens[0];
    const rest = rawTokens.slice(1).filter((w) => !DROP_WORDS.has(w.toLowerCase()));
    chosen = [first, ...rest];
    if (chosen.length < 2) {
      chosen = rawTokens.slice(0, MAX_WORDS);
    }
  }

  // Build final string within MAX_WORDS and MAX_NAME_LEN
  const formatted: string[] = [];
  let currentLen = 0;
  for (const tok of chosen) {
    if (formatted.length >= MAX_WORDS) break;
    const fw = formatWord(tok);
    const nextLen = currentLen === 0 ? fw.length : currentLen + 1 + fw.length;
    if (nextLen > MAX_NAME_LEN) {
      if (formatted.length === 0) {
        // Single long word — truncate cleanly
        formatted.push(fw.slice(0, MAX_NAME_LEN - 1) + '…');
      }
      break;
    }
    formatted.push(fw);
    currentLen = nextLen;
  }

  const result = formatted.join(' ').trim();
  if (!result || result.length < 2) return null;
  return result;
}

/**
 * Extract the most recent user task / prompt from terminal buffer lines.
 * Works read-only across ANY CLI (Antigravity, OpenCode, Claude Code, Codex,
 * Gemini, Cursor, Qwen, Prime, or generic shell/TUI).
 */
export function extractTaskFromBuffer(bufferLines: string[], _cli?: string): string | null {
  if (!bufferLines || bufferLines.length === 0) return null;

  const cleaned = bufferLines.map(cleanLine);

  // Pass 1: Explicit task/goal/objective/prompt headers (scan from bottom for latest)
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const line = cleaned[i];
    const m = line.match(/^(?:task|goal|objective|prompt)\s*:\s*(.+)$/i);
    if (m && m[1]) {
      const name = summarizeTaskToShortName(m[1]);
      if (name) return name;
    }
  }

  // Pass 2: User prompt lines in ANY CLI (❯, >, ›, », You:, User:, Human:)
  // Scan from bottom so if the user starts a new task, the terminal updates to the latest task.
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const line = cleaned[i];
    const m = line.match(/^(?:[❯>›»]{1,2}|(?:You|User|Human)\s*:)\s+(.+)$/i);
    if (!m || !m[1]) continue;

    const candidate = m[1].trim();
    if (isNoiseOrTrivial(candidate)) continue;

    // Skip lines that look like shell prompts with just a command (e.g. "user@host % ls")
    if (/^[a-z0-9._-]+@[a-z0-9._-]+/i.test(candidate)) continue;

    const name = summarizeTaskToShortName(candidate);
    if (name) return name;
  }

  return null;
}

// ── Per-terminal sticky cache (keyed by lastOutputAt for near-zero CPU) ──────

interface AutoNameCacheEntry {
  lastOutputAt: number;
  name?: string;
}

const _autoNameCache = new Map<string, AutoNameCacheEntry>();

/**
 * Read-only, cached auto-name resolver for a terminal.
 * - Re-evaluates only when `lastOutputAt` advances.
 * - Sticky: once a task name is extracted, keeps it even if the original prompt
 *   scrolls off-screen during long tool output.
 * - Updates if a newer user task is detected in the conversation.
 */
export function getAutoTerminalName(
  tty: string,
  bufferLines: string[],
  cli: string | undefined,
  lastOutputAt: number
): string | undefined {
  const cached = _autoNameCache.get(tty);
  if (cached && cached.lastOutputAt === lastOutputAt) {
    return cached.name;
  }

  const extracted = extractTaskFromBuffer(bufferLines, cli);
  const resolved = extracted || cached?.name;

  _autoNameCache.set(tty, {
    lastOutputAt,
    name: resolved,
  });

  return resolved;
}

/** Clear cached auto-name when a terminal is closed or disposed. */
export function clearAutoTerminalName(tty: string): void {
  _autoNameCache.delete(tty);
}
