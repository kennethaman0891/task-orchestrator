/**
 * Safe error serialization for the tto desktop app.
 *
 * Catches from `App.tsx`, `IDEView.tsx`, and `EmbeddedBrowser.tsx` can receive
 * *any* thrown value — including plain objects (`{ message, stack }`) from
 * Tauri / fetch / pty errors. Rendering one directly as JSX produces the
 * infamous `[object Object]` card.
 *
 * This module normalizes anything to a display-safe string without throwing
 * itself, so error boundaries never surface raw object references.
 */

export function formatError(err: unknown): string {
  if (err === null || err === undefined) return '(empty error)';

  // Already a string — nothing to do.
  if (typeof err === 'string') return err;

  // - Error instances
  // - Tauri Rust errors that come back as { message, code, details... }
  // - fetch failures that were constructed as literal objects
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;

    // It's an Error-like object or a plain { message } bag.
    const message =
      typeof o.message === 'string'
        ? o.message
        : typeof o.error === 'string'
          ? o.error
          : typeof o.reason === 'string'
            ? o.reason
            : typeof o.description === 'string'
              ? o.description
              : null;

    if (message) {
      const stack = typeof o.stack === 'string' ? o.stack : undefined;
      return stack ? `${message}\n${stack}` : message;
    }

    // Fall back to a JSON-safe summary of the object.
    try {
      const summary = JSON.stringify(o, (_key, value) => {
        if (typeof value === 'bigint') return `${value}n`;
        if (typeof value === 'function') return `[function ${value.name || '()'}]`;
        if (value instanceof Error) return { name: value.name, message: value.message };
        return value;
      });
      if (summary && summary !== '{}') return summary;
    } catch {
      /* JSON.stringify failed — fall through */
    }

    return '(unrecognized error object)';
  }

  // Numbers, booleans, symbols — show a readable summary.
  if (typeof err === 'number') return `Error code: ${err}`;
  if (typeof err === 'boolean') return err ? 'Error: true' : 'Error: false';
  if (typeof err === 'symbol') return err.toString();
  if (typeof err === 'bigint') return `Error code: ${err}n`;

  return String(err);
}

/** Like `formatError` but strips leading whitespace and collapses newlines
 * so a oneline toast / status chip doesn't grow unbounded. */
export function formatErrorShort(err: unknown, maxLength = 300): string {
  const raw = formatError(err);
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? singleLine.slice(0, maxLength - 3) + '...' : singleLine;
}
