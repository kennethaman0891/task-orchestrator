// Developer City — live registry feed.
// One dedicated /ws socket that ONLY reacts to `projects_changed`
// (the sidecar broadcasts it on every project mutation).
// Also re-syncs periodically as a cheap recovery path.

import { useEffect } from 'react';
import { wsBase } from '@/lib/api';
import { withSessionToken } from '@/lib/sessionAuth';
import { listProjects } from '@/city/api';
import { useCityStore } from '@/city/store';

export function useProjectsFeed() {
  const setProjects = useCityStore((s) => s.setProjects);
  const setLoaded = useCityStore((s) => s.setLoaded);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const sync = async (): Promise<boolean> => {
      try {
        const { projects } = await listProjects();
        setProjects(projects);
        setLoaded(true);
        return true;
      } catch {
        return false;
      }
    };

    void sync().then((ok) => {
      if (ok) setLoaded(true);
      else setLoaded(false, 'sidecar unreachable — showing last cached registry');
    });

    const connect = () => {
      if (disposed) return;
      const base = wsBase();
      if (!base) return;
      const collab = typeof window !== 'undefined' ? localStorage.getItem('tto_collab_token') : null;
      const wsUrl = withSessionToken(collab ? `${base}/ws?token=${encodeURIComponent(collab)}` : `${base}/ws`);
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.warn('[Developer City] WebSocket creation failed:', err);
        return;
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg && msg.type === 'projects_changed') void sync();
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        ws = null;
        if (!disposed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
    };
    connect();

    // Recovery poll (only when the socket is down — mirrors useTerminals).
    const poll = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) return;
      void sync();
    }, 10000);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      clearInterval(poll);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, [setProjects, setLoaded]);
}
