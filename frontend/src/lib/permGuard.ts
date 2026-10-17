import { isPermEnabled, PERM_LABELS, type PermKey } from './permissions';

/**
 * Enforcement-site guard: true when the permission toggle is on AND the
 * capability actually exists in this webview. `reason` explains a block,
 * ready to be shown as a toast/error at the call site.
 */
export function permGuard(key: PermKey): { ok: boolean; reason: string } {
  if (!isPermEnabled(key)) {
    return { ok: false, reason: `${PERM_LABELS[key]} is disabled in Settings → Permissions` };
  }
  if (key === 'microphone' && !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'Microphone capture is not available in this webview' };
  }
  if (key === 'clipboard' && !navigator.clipboard) {
    return { ok: false, reason: 'Clipboard is not available in this webview' };
  }
  return { ok: true, reason: '' };
}
