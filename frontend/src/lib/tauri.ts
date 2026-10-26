// ═══════════════════════════════════════════════════════════════════════════
// tto Tauri IPC Bridge — ported from legacy channels.ts
// Wraps all @tauri-apps/api invoke calls behind a stable facade.
// ═══════════════════════════════════════════════════════════════════════════

import type { NativeSessionEntry } from '@/types';

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Not in Tauri');
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke(cmd, args);
}

async function listenEvent(event: string, handler: (payload: any) => void): Promise<() => void> {
  const mod = await import('@tauri-apps/api/event');
  return mod.listen(event, (e) => handler(e.payload));
}

// ── Terminal IPC ──────────────────────────────────────────────────────

export const tauri = {
  // Create a new terminal PTY session
  create: (cwd?: string, workspaceId?: string, cols?: number, rows?: number, command?: string) =>
    invoke<NativeSessionEntry>('terminal_create', {
      cwd: cwd || null,
      workspaceId: workspaceId || null,
      cols: cols || 120,
      rows: rows || 40,
      command: command || null,
    }),

  // Attach to a session's output stream via Tauri Channels
  attach: async (id: string, onOutput: (data: number[]) => void, onExit: () => void) => {
    const { Channel } = await import('@tauri-apps/api/core');
    const outputChannel = new Channel<number[]>();
    outputChannel.onmessage = onOutput;
    const exitChannel = new Channel<void>();
    exitChannel.onmessage = onExit;
    return invoke('terminal_attach', {
      id,
      onOutput: outputChannel,
      onExit: exitChannel,
    });
  },

  detach: (id: string) => invoke('terminal_detach', { id }),

  getScrollback: (id: string) => invoke<number[]>('terminal_get_scrollback', { id }),

  write: (id: string, data: number[]) => invoke('terminal_write', { id, data }),

  sendCommand: (id: string, command: string) => invoke('terminal_send_command', { id, command }),

  resize: (id: string, cols: number, rows: number, pixelWidth = 0, pixelHeight = 0) =>
    invoke('terminal_resize', { id, cols, rows, pixelWidth, pixelHeight }),

  close: (id: string) => invoke('terminal_close', { id }),

  restart: (id: string) => invoke('terminal_restart', { id }),

  list: () => invoke<NativeSessionEntry[]>('terminal_list'),

  setTitle: (id: string, title: string) => invoke('terminal_set_title', { id, title }),

  setTui: (id: string, tui: boolean) => invoke('terminal_set_tui', { id, active: tui }),

  setFocus: (id: string, focused: boolean) => invoke('terminal_set_focus', { id, focused }),

  setVisible: (id: string, visible: boolean) => invoke('terminal_set_visible', { id, visible }),

  setGridMode: (id: string, mode: string) => invoke('terminal_set_grid_mode', { id, mode }),

  diagnostics: () => invoke<any[]>('terminal_diagnostics'),

  dropFiles: (id: string, paths: string[]) => invoke('terminal_drop_files', { id, paths }),

  // ── Workspace IPC ───────────────────────────────────────────────

  indexSet: (workspaceId: string, sessionIds: string[]) =>
    invoke('workspace_index_set', { workspaceId, sessionIds }),

  indexGet: (workspaceId: string) =>
    invoke<string[]>('workspace_index_get', { workspaceId }),

  // ── Sidecar ─────────────────────────────────────────────────────

  sidecarStatus: () => invoke<string>('sidecar_status'),
  sidecarPort: () => invoke<number>('sidecar_port'),

  // ── System ──────────────────────────────────────────────────────

  pickFolder: () => invoke<string>('pick_folder'),
  pickFile: () => invoke<string>('pick_file'),
  getLaunchCwd: () => invoke<string>('get_launch_cwd'),
  pathExists: (path: string) => invoke<boolean>('path_exists', { path }),
  egoLiteStatus: () => invoke<any>('ego_lite_status'),

  // ── Gateway ─────────────────────────────────────────────────────

  gatewayStatus: () => invoke<string>('gateway_status'),
  gatewayEnabled: () => invoke<boolean>('gateway_enabled'),
  gatewaySetEnabled: (enabled: boolean) => invoke('gateway_set_enabled', { enabled }),
  gatewayIdentity: () => invoke<any>('gateway_identity'),
  gatewayPair: (claim: string) => invoke<any>('gateway_pair', { claim }),
  gatewayPairStatus: () => invoke<any>('gateway_pair_status'),
  gatewaySetUrl: (url: string) => invoke('gateway_set_url', { url }),

  // ── Django ──────────────────────────────────────────────────────

  djangoExtractZip: (path: string) => invoke<{ path: string; name: string }>('django_extract_zip', { path }),
  djangoAnalyze: (path: string) => invoke<any>('django_analyze', { path }),
  djangoFix: (path: string) => invoke<any>('django_fix', { path }),
  djangoRunChecks: (path: string) => invoke<any>('django_run_checks', { path }),
  djangoPackage: (path: string) => invoke<any>('django_package', { path }),

  // ── Dev tools ───────────────────────────────────────────────────

  openDevtools: () => invoke('open_devtools'),

  // ── System / OS ──────────────────────────────────────────────────

  openUrl: async (url: string) => {
    if (isTauri()) {
      return invoke('open_url', { url });
    } else {
      window.open(url, '_blank');
    }
  },
  revealInFinder: async (path: string) => {
    if (isTauri()) {
      return invoke('reveal_in_finder', { path });
    }
  },
  openApp: async (name: string): Promise<void> => {
    if (isTauri()) {
      return invoke('open_app', { name });
    }
  },
  isAppRunning: async (name: string): Promise<boolean> => {
    if (isTauri()) {
      return invoke<boolean>('is_app_running', { name });
    }
    return false;
  },
};

export { listenEvent };

