/**
 * Shared file-drop extraction and routing utilities for TTO.
 */

/** Extract absolute file paths from a DataTransfer (empty when nothing usable). */
export function extractDropPaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];

  // Ignore internal pane and tab reorder drags
  if (
    dt.types &&
    (Array.from(dt.types).includes('application/x-tto-grid-pane') ||
      Array.from(dt.types).includes('application/x-tto-terminal-tab'))
  ) {
    return [];
  }

  // 1) OS file drag (HTML5 DataTransfer.files)
  const files = Array.from(dt.files || []);
  const filePaths = files
    .map((f: any) => (typeof f.path === 'string' && f.path ? f.path : f.name || ''))
    .filter(Boolean);
  if (filePaths.length > 0) return filePaths;

  // 2) Internal drag: application/x-tto-file or text/plain
  const custom = dt.getData('application/x-tto-file');
  if (custom && custom.trim()) return [custom.trim()];

  const plain = dt.getData('text/plain');
  if (plain && plain.trim()) return [plain.trim()];

  // 3) WebKit text/uri-list fallback (file:// URIs)
  const uriList = dt.getData('text/uri-list');
  if (uriList) {
    const paths = uriList
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        if (line.startsWith('file://')) {
          const raw = line.slice('file://'.length);
          try {
            return decodeURIComponent(raw);
          } catch {
            return raw;
          }
        }
        if (line.startsWith('file:')) {
          const raw = line.slice('file:'.length);
          try {
            return decodeURIComponent(raw);
          } catch {
            return raw;
          }
        }
        return line;
      })
      .filter(Boolean);
    if (paths.length > 0) return paths;
  }

  return [];
}

/** Shell-quote a path safely for terminal input */
export function shellQuotePath(path: string): string {
  if (!path) return '';
  // Wrap in single quotes, escaping any single quotes
  return `'${path.replace(/'/g, "'\\''")}'`;
}
