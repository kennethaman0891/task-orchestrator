// ═══════════════════════════════════════════════════════════════════════════
// tto Format Helpers — ported from legacy
// ═══════════════════════════════════════════════════════════════════════════

import type { UnifiedTerminal } from '@/types';

/** Is this terminal closed (agent includes "closed" or is_live false)? */
export function isClosed(t: UnifiedTerminal): boolean {
  return t.is_live === false || (t.agent || '').includes('closed');
}

/** Short model name (strip provider prefix) */
export function cleanModel(model: string): string {
  if (!model) return '';
  const parts = model.split('/');
  return parts[parts.length - 1];
}

/** Get the basename of a path */
export function baseName(path: string): string {
  if (!path) return '';
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || parts[parts.length - 2] || path;
}

/** Get the modifier key label */
export function modifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return navigator.platform?.includes('Mac') ? 'Cmd' : 'Ctrl';
}

/** Get a display name for a terminal */
export function termName(t: UnifiedTerminal): string {
  return t.session_name || t.pane_title || t.tty || 'Unknown';
}

/** Format bytes to human-readable */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Format cost */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

/** Format token count */
export function formatTokens(tokens: number): string {
  if (tokens === 0) return '0';
  if (tokens < 1000) return String(tokens);
  if (tokens < 1000000) return (tokens / 1000).toFixed(1) + 'K';
  return (tokens / 1000000).toFixed(1) + 'M';
}

/** Time ago string */
export function timeAgo(timestamp: number): string {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Get file extension */
export function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/** Get language from file extension */
export function getLanguage(filename: string): string {
  const ext = getExtension(filename);
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    html: 'html', css: 'css', json: 'json', md: 'markdown',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash',
    sql: 'sql', xml: 'xml', php: 'php', swift: 'swift',
    mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', m4v: 'video', avi: 'video',
    mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio', ogg: 'audio',
    png: 'image', jpg: 'image', jpeg: 'image', svg: 'image', gif: 'image', webp: 'image',
  };
  return map[ext] || 'text';
}

/** Image file extensions the editor should render as a preview, not text. */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif',
]);

/** True when `filename` has a known image extension. */
export function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filename));
}

/** Video file extensions the editor should render in a video player. */
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'ogg', 'mov', 'm4v', 'mkv', 'avi',
]);

/** True when `filename` has a known video extension. */
export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filename));
}

/** Audio file extensions the editor can render with audio controls. */
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'oga',
]);

/** True when `filename` has a known audio extension. */
export function isAudioFile(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtension(filename));
}

/** True when `filename` is an image, video, or audio file. */
export function isMediaFile(filename: string): boolean {
  return isImageFile(filename) || isVideoFile(filename) || isAudioFile(filename);
}

const SQLITE_EXTENSIONS = new Set(['sqlite3', 'sqlite', 'db', 'db3', 's3db']);

/** True when `filename` is a SQLite database file. */
export function isSqliteDatabase(filename: string): boolean {
  return SQLITE_EXTENSIONS.has(getExtension(filename));
}

/** Binary extensions that should never be shown as editable text. */
const BINARY_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...SQLITE_EXTENSIONS,
  // Archives & packages
  'zip', 'gz', 'tar', 'tgz', '7z', 'rar', 'bz2', 'xz', 'dmg', 'iso', 'pkg', 'deb', 'rpm',
  // Compiled code & bytecode
  'pyc', 'pyo', 'pyd', 'dylib', 'so', 'dll', 'bin', 'o', 'a', 'wasm', 'class', 'jar', 'exe',
  // Documents & spreadsheets
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // Media (audio & video)
  'mp4', 'mp3', 'mov', 'avi', 'mkv', 'webm', 'wav', 'flac', 'ogg', 'm4a', 'aac',
  // Fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // Data formats
  'parquet', 'feather', 'pkl', 'pickle', 'dat',
]);

/** True when `filename` is a binary file (image or other non-text). */
export function isBinaryFile(filename: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(filename));
}

/** Format seconds into a human-readable elapsed string (e.g. "2h 15m", "3m", "now"). */
export function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return '';
  if (seconds < 60) return 'now';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Format milliseconds into live duration string (e.g. "45s", "12m 30s", "1h 14m"). */
export function formatLiveDuration(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

/** Format a timestamp into exact local time (e.g. "14:22:05"). */
export function formatTimeOfDay(timestamp: number): string {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

