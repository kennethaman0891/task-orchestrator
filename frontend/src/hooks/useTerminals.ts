// useTerminals — live terminal + token data from the Python sidecar.
// Connects via WebSocket /ws for real-time state broadcasts, with HTTP
// polling fallback when the socket is down.

import { useEffect, useState } from 'react';
import type { TerminalEntry, TokenUsage } from '@/types';
import { getTerminals, wsBase } from '@/lib/api';
import { withSessionToken } from '@/lib/sessionAuth';

export function useTerminals() {
  const [terminals, setTerminals] = useState<Record<string, TerminalEntry>>({});
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let lastHash = '';

    const connect = () => {
      if (closed) return;
      const base = wsBase();
      if (!base) return; // No WS base available (SSR)
      const collab = typeof window !== 'undefined' ? localStorage.getItem('tto_collab_token') : null;
      const wsUrl = withSessionToken(collab ? `${base}/ws?token=${encodeURIComponent(collab)}` : `${base}/ws`);
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg && msg.type === 'state' && msg.terminals) {
            const h = JSON.stringify(msg.terminals);
            if (h !== lastHash) {
              lastHash = h;
              setTerminals(msg.terminals);
              setLastUpdate(Date.now());
            }
            if (msg.token_usage) setTokenUsage(msg.token_usage);
          }
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        ws = null;
        if (!closed) retry = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        try { ws?.close(); } catch { /* noop */ }
      };
    };

    connect();

    // HTTP polling fallback: only when WebSocket is NOT connected
    const poll = setInterval(async () => {
      if (ws && ws.readyState === WebSocket.OPEN) return; // WS is live — skip
      try {
        const data = await getTerminals();
        const h = JSON.stringify(data.terminals);
        if (h !== lastHash) {
          lastHash = h;
          setTerminals(data.terminals);
          setLastUpdate(Date.now());
        }
        if (data.token_usage) setTokenUsage(data.token_usage);
      } catch {
        /* silent — WebSocket will cover it */
      }
    }, 3000);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      clearInterval(poll);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, []);

  return { terminals, tokenUsage, connected, lastUpdate };
}
