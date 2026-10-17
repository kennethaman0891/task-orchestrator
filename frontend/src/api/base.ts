// Sidecar API base URL (spec §4).
//
// Dev mode: Vite serves the frontend on :1420 and proxies /api + /ws to the
// Python sidecar on :8765 — relative URLs work.
//
// Release mode: the frontend is embedded and served from tauri://localhost, so
// relative URLs would resolve to port 80 and fail. We must call the sidecar
// directly at its absolute address.
//
// The port is not assumed: the Rust side health-verifies the sidecar and may
// fall back to 8766 when 8765 is unusable (e.g. squatted by a process that
// cannot be evicted). `sidecar_port()` returns the live port; until the first
// IPC answer arrives we optimistically use 8765 (the normal case).

import { isTauri, tauri } from '@/lib/tauri';
export { isTauri };

/** Fallback port used until the live port is known (the normal case). */
export const SIDECAR_ORIGIN = 'http://127.0.0.1:8765';

let livePort: number | null = null;
let portPromise: Promise<number> | null = null;

/** Ask Rust which port the sidecar is serving on (cached after first call). */
function sidecarPort(): Promise<number> {
  if (livePort !== null) return Promise.resolve(livePort);
  if (!portPromise) {
    portPromise = tauri
      .sidecarPort()
      .then((p: number) => {
        livePort = p;
        return p;
      })
      .catch(() => 8765);
  }
  return portPromise || Promise.resolve(8765);
}

// Warm the cache at module load so most calls never await.
if (isTauri()) void sidecarPort();

/** Absolute URL prefix for sidecar REST calls. */
export function apiBase(): string {
  if (!isTauri()) return '';
  const port = livePort ?? 8765;
  return `http://127.0.0.1:${port}`;
}

/** Same as apiBase() but resolves the live port first (async contexts). */
export async function apiBaseAsync(): Promise<string> {
  if (!isTauri()) return '';
  const port = await sidecarPort();
  return `http://127.0.0.1:${port}`;
}

/** Absolute WebSocket URL for the sidecar live state stream. */
export function wsBase(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  if (isTauri()) return `${proto}://127.0.0.1:${livePort ?? 8765}`;
  return `${proto}://${location.host}`;
}
