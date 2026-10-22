// Loopback session token for the Python sidecar.
//
// Tauri holds the token in the native process and the webview asks for it
// once. Vite dev reads VITE_TTO_SESSION_TOKEN (or TTO_SESSION_TOKEN, injected
// by vite.config.ts). The token is attached to sidecar fetch calls and to
// WebSocket / image URLs, which cannot set the header.

import { invoke, isTauri } from './tauri';

const HEADER = 'X-Task-Orchestrator-Token';

let token: string | null = null;
let ready: Promise<void> = Promise.resolve();

export function getSessionToken(): string | null {
  return token;
}

function devToken(): string {
  const value = import.meta.env.VITE_TTO_SESSION_TOKEN;
  return typeof value === 'string' ? value.trim() : '';
}

function isSidecarUrl(raw: string): boolean {
  if (raw.startsWith('/api') || raw.startsWith('/ws')) return true;
  try {
    const url = new URL(raw, window.location.origin);
    const host = url.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') {
      return false;
    }
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (port !== '8765' && port !== '8766') return false;
    return url.pathname.startsWith('/api') || url.pathname.startsWith('/ws');
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function withSessionToken(wsUrl: string): string {
  if (!token) return wsUrl;
  try {
    const url = new URL(wsUrl, window.location.origin);
    url.searchParams.set('session_token', token);
    return url.toString();
  } catch {
    const join = wsUrl.includes('?') ? '&' : '?';
    return `${wsUrl}${join}session_token=${encodeURIComponent(token)}`;
  }
}

export function appendSessionToken(url: string): string {
  return withSessionToken(url);
}

const FETCH_FLAG = '__ttoSessionFetch';

function installFetchWrapper(): void {
  const marked = window as Window & { [FETCH_FLAG]?: boolean };
  if (marked[FETCH_FLAG]) return;
  marked[FETCH_FLAG] = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!token || !isSidecarUrl(requestUrl(input))) return orig(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(HEADER)) headers.set(HEADER, token);
    if (input instanceof Request) {
      return orig(new Request(input, { ...init, headers }));
    }
    return orig(input, { ...init, headers });
  };
}

/** Load the token and wrap fetch. Call before the first sidecar request. */
export function installSessionAuth(): Promise<void> {
  const baked = devToken();
  if (baked) token = baked;
  installFetchWrapper();
  ready = (async () => {
    if (isTauri()) {
      try {
        const value = (await invoke<string>('session_token')).trim();
        if (value) token = value;
      } catch {
        /* sidecar command unavailable — dev token, if any, still applies */
      }
    }
  })();
  return ready;
}

export function sessionAuthReady(): Promise<void> {
  return ready;
}
