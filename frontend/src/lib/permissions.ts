/**
 * User-controlled permission toggles (Settings → Permissions).
 *
 * macOS/OS permissions (mic, folder access) are binary truths the app can only
 * request — but several TTO features can and should be user-revocable from
 * inside the app. These toggles give each enforceable permission a working
 * Enable/Disable control that the whole app respects at the feature site:
 *
 *   • microphone      — voice dictation (terminal input + IDE voice)
 *   • clipboard       — copy/paste in terminals and copy buttons
 *   • terminalExec    — launching/restarting the OpenCode CLI agent
 *   • embeddedBrowser — the in-IDE browser panel and its pop-out window
 *
 * State is draft-edited in SettingsModal and persisted via `savePerms()` on
 * "Save Settings". Feature sites read live state through `isPermEnabled()`,
 * so disabling a permission immediately gates the feature everywhere.
 */

export type PermKey = 'microphone' | 'clipboard' | 'terminalExec' | 'embeddedBrowser';

export type PermState = Record<PermKey, boolean>;

const STORAGE_KEY = 'tto-permissions';

const DEFAULTS: PermState = {
  microphone: true,
  clipboard: true,
  terminalExec: true,
  embeddedBrowser: true,
};

/** Human-readable label for each toggle (also used in enforcement toasts). */
export const PERM_LABELS: Record<PermKey, string> = {
  microphone: 'Microphone (voice input)',
  clipboard: 'Clipboard access',
  terminalExec: 'Terminal execution (OpenCode CLI)',
  embeddedBrowser: 'Embedded browser',
};

export function loadPerms(): PermState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PermState>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePerms(perms: PermState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(perms));
  } catch {
    /* storage unavailable — toggles stay session-only */
  }
}

/** Live check for enforcement sites. A missing/corrupt store means enabled. */
export function isPermEnabled(key: PermKey): boolean {
  return loadPerms()[key];
}
