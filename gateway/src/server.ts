import { createServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { GatewayConfig } from './config.js';
import type { Store } from './store.js';
import { Router, authenticateDesktop, authenticateClient } from './router.js';
import { MSG, envelope, parseEnvelope, type Envelope } from './protocol.js';
import { loginWithPassword, refreshSession, logoutToken, RateLimiter, newId } from './auth.js';
import {
  createPairing,
  confirmPairing,
  pairingStatus,
  pairingChallenge,
  pairingClaim,
} from './pairing.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

export interface GatewayServer {
  router: Router;
  start(): void;
  stop(): void;
  /** For tests: access live peer counts. */
  presence(): { desktops: number; clients: number };
  /** The bound WSS port (useful when configured with port 0 in tests). */
  port(): number;
}

export function createGatewayServer(store: Store, cfg: GatewayConfig): GatewayServer {
  const router = new Router(
    store,
    { offlineAfterMs: cfg.offlineAfterMs, heartbeatIntervalMs: cfg.heartbeatIntervalMs },
    {
      onDesktopConnected: () => {},
      onDesktopDisconnected: () => {},
      onClientConnected: () => {},
      onClientDisconnected: () => {},
    },
  );

  const authLimiter = new RateLimiter(60_000, cfg.maxAuthAttemptsPerMinute);
  const pairingLimiter = new RateLimiter(60_000, cfg.maxPairingAttemptsPerMinute);

  let wss: WebSocketServer | null = null;
  let httpServer: ReturnType<typeof createServer> | ReturnType<typeof createHttpServer> | null =
    null;

  // ── Desktop (device) handshake over its outbound connection ──────────────
  // The desktop connects and immediately sends a hello with its device id +
  // credential. Until authenticated, it may only send hello.
  function handleDesktop(ws: WebSocket, firstMessage: Envelope) {
    const payload = firstMessage.payload as any;
    const deviceId: string = payload.deviceId ?? '';
    const credential: string = payload.credential ?? '';
    const auth = authenticateDesktop(store, deviceId, credential);
    if (!auth.ok) {
      ws.close(4401, auth.error ?? 'auth_failed');
      return;
    }
    const peer = router.registerDesktop(ws, deviceId);
    // Confirm the desktop's identity and give it a device status ack.
    sendRaw(ws, envelope(MSG.ACK, { ok: true, kind: 'desktop', deviceId }, firstMessage.id));
    void peer;
  }

  // ── Client handshake ─────────────────────────────────────────────────────
  function handleClient(ws: WebSocket, firstMessage: Envelope) {
    const payload = firstMessage.payload as any;
    const token: string = payload.token ?? '';
    const deviceId: string | null = typeof payload.deviceId === 'string' ? payload.deviceId : null;
    if (!authLimiter.allow(`${peerIp(ws)}:auth`)) {
      ws.close(4429, 'rate_limited');
      return;
    }
    const auth = authenticateClient(store, token);
    if (!auth.ok || !auth.user) {
      ws.close(4401, auth.error ?? 'auth_failed');
      return;
    }
    const peer = router.registerClient(ws, auth.user.id, deviceId);
    sendRaw(ws, envelope(MSG.ACK, { ok: true, kind: 'client', userId: auth.user.id, deviceId }, firstMessage.id));
    if (deviceId) router.statusSnapshot(peer.id);
  }

  function onMessage(ws: WebSocket, raw: string) {
    const { env, error } = parseEnvelope(raw);
    if (error || !env) {
      sendRaw(ws, envelope(MSG.ERROR, { error: error ?? 'invalid' }));
      return;
    }
    if (env.type === MSG.HEARTBEAT) {
      sendRaw(ws, envelope(MSG.PONG, {}, env.id));
      return;
    }
    // Associate socket → peer lazily. We track desktop vs client by whether the
    // socket authenticated as a desktop. To keep it robust, route by a flag.
    routeByPeerKind(ws, env);
  }

  function routeByPeerKind(ws: WebSocket, env: Envelope) {
    // Desktop vs client is distinguished by which registry holds the socket.
    const deviceId = router.deviceIdForSocket(ws);
    if (deviceId) {
      // Desktop → clients. Terminal output + status flow this way.
      router.routeDesktopToClients(deviceId, env);
      return;
    }
    // Assume client → desktop.
    const clientSocket = router.clientForSocket(ws);
    if (clientSocket) {
      const res = router.routeClientToDesktop(clientSocket.id, env);
      if (!res.ok) {
        sendRaw(ws, envelope(MSG.ERROR, { error: res.error ?? 'route_failed' }, env.id));
      }
      return;
    }
    sendRaw(ws, envelope(MSG.ERROR, { error: 'unauthenticated' }));
  }

  // ── REST / control-plane endpoints (over HTTP) ───────────────────────────
  // These handle auth (password login, refresh, pairing confirm) that isn't a
  // live relay. Kept minimal and stateless.
  async function handleHttp(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'GET' && url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'tto-gateway', time: Date.now() }));
      return;
    }

    if (method === 'POST' && url === '/api/auth/login') {
      const body = await readBody(req, 8 * 1024);
      const { username, password } = body ?? {};
      if (!authLimiter.allow(`${peerIp(req)}:login`)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
        return;
      }
      const r = loginWithPassword(store, str(username), str(password), cfg.accessTokenTtlMs, cfg.refreshTokenTtlMs);
      if (!r.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: r.reason ?? 'invalid_credentials' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: { username: r.user?.username } }));
      return;
    }

    if (method === 'POST' && url === '/api/auth/refresh') {
      const body = await readBody(req, 8 * 1024);
      const r = refreshSession(store, str(body?.refreshToken), cfg.accessTokenTtlMs, cfg.refreshTokenTtlMs);
      if (!r.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: r.reason ?? 'invalid_refresh' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accessToken: r.accessToken, refreshToken: r.refreshToken }));
      return;
    }

    if (method === 'POST' && url === '/api/auth/logout') {
      const body = await readBody(req, 8 * 1024);
      if (body?.accessToken) logoutToken(store, str(body.accessToken));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (method === 'POST' && url === '/api/pairing/create') {
      const body = await readBody(req, 8 * 1024);
      if (!pairingLimiter.allow(`${peerIp(req)}:pair`)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
        return;
      }
      const r = createPairing(
        store,
        {
          deviceId: str(body?.deviceId),
          devicePublicKey: str(body?.devicePublicKey),
          deviceName: str(body?.deviceName) || 'TTO Desktop',
        },
        cfg.pairingCodeTtlMs,
      );
      if (!r.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: r.reason ?? 'pairing_failed' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
      return;
    }

    if (method === 'POST' && url === '/api/pairing/confirm') {
      const body = await readBody(req, 8 * 1024);
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const user = authenticateClient(store, token);
      if (!user.ok || !user.user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (!pairingLimiter.allow(`${peerIp(req)}:pair`)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
        return;
      }
      const r = confirmPairing(store, str(body?.code), user.user.id);
      if (!r.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: r.reason ?? 'invalid_code' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
      return;
    }

    // Pairing status / challenge / claim are unauthenticated but bound to the
    // device's pairing record; only the holder of the private key can complete
    // the claim (verified via Ed25519 signature).
    if (method === 'GET' && url === '/api/pairing/status') {
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      const deviceId = str(q.get('deviceId'));
      const r = pairingStatus(store, deviceId);
      if (!r.ok) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_pairing' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
      return;
    }

    if (method === 'POST' && url === '/api/pairing/challenge') {
      const body = await readBody(req, 8 * 1024);
      const r = pairingChallenge(store, str(body?.deviceId), cfg.pairingCodeTtlMs);
      if (!r.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: r.reason ?? 'challenge_failed' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
      return;
    }

    if (method === 'POST' && url === '/api/pairing/claim') {
      const body = await readBody(req, 8 * 1024);
      const r = pairingClaim(store, str(body?.deviceId), str(body?.nonce), str(body?.signature));
      if (!r.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: r.reason ?? 'claim_failed' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
      return;
    }

    if (method === 'GET' && url === '/api/devices' && cfg.webClientDir) {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const user = authenticateClient(store, token);
      if (!user.ok || !user.user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const devices = store
        .getDevicesForUser(user.user.id)
        .map((d) => {
          const st = router.deviceStatus(d.id);
          return {
            id: d.id,
            name: d.name,
            online: st.online,
            lastSeen: st.lastSeen,
            revoked: d.revoked,
            created: d.created_at,
          };
        });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices }));
      return;
    }

    if (method === 'POST' && url === '/api/devices/revoke' && cfg.webClientDir) {
      const body = await readBody(req, 8 * 1024);
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const user = authenticateClient(store, token);
  if (!user.ok || !user.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const deviceId = str(body?.deviceId);
  const dev = deviceId ? store.getDevice(deviceId) : null;
      if (!dev || dev.user_id !== user.user.id) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }
      store.revokeDevice(dev.id);
      store.deleteSessionsForDevice(dev.id);
      // Kick any live desktop connection for this device.
      router.kickDesktop(dev.id, 4403, 'revoked');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Static web client (phone-friendly) if a build exists.
    const webDir = cfg.webClientDir;
    if (method === 'GET' && webDir && existsSync(webDir)) {
      serveStatic(webDir, url, req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────

  function start() {
    // Prefer WSS (TLS) when configured; otherwise plain WS for local dev.
    const tls = cfg.tlsCertPath && cfg.tlsKeyPath ? readFileSync(cfg.tlsKeyPath) : null;
    const tlsCert = cfg.tlsCertPath ? readFileSync(cfg.tlsCertPath) : null;
    if (tls && tlsCert) {
      httpServer = createServer(
        { key: tls, cert: tlsCert },
        (req, res) => {
          void handleHttp(req, res);
        },
      );
    } else {
      httpServer = createHttpServer((req, res) => {
        void handleHttp(req, res);
      });
    }

    wss = new WebSocketServer({ server: httpServer, maxPayload: cfg.maxMessageBytes });
    wss.on('connection', (ws) => {
      let authed = false;
      ws.on('message', (data) => {
        const text = data.toString();
        // First message must be the handshake hello; everything after is
        // dispatched to the routing layer.
        if (!authed) {
          const { env, error } = parseEnvelope(text);
          if (error || !env) {
            ws.close(4400, 'bad_hello');
            return;
          }
          if (env.type === MSG.HELLO) {
            authed = true;
            if (env.payload?.role === 'desktop') handleDesktop(ws, env);
            else handleClient(ws, env);
          } else {
            ws.close(4400, 'hello_required');
          }
          return;
        }
        onMessage(ws, text);
      });
      ws.on('close', () => {
        // Remove the socket from whichever registry holds it.
        const deviceId = router.deviceIdForSocket(ws);
        if (deviceId) {
          const peer = router.desktopForDevice(deviceId);
          if (peer) router.unregister(peer);
        } else {
          const client = router.clientForSocket(ws);
          if (client) router.unregister(client);
        }
      });
      ws.on('error', () => {
        /* handled by close */
      });
    });

    httpServer.listen(cfg.wssPort, cfg.host, () => {
      const mode = tls && tlsCert ? 'WSS' : 'WS';
      // eslint-disable-next-line no-console
      console.log(`[gateway] listening ${mode} on ${cfg.host}:${cfg.wssPort}`);
    });
    if (cfg.httpPort && cfg.httpPort !== cfg.wssPort) {
      // Secondary plain-HTTP listener for the static client when TLS is off.
      // Not used when WSS is on (the TLS server already serves HTTP+WS).
    }
  }

  function stop() {
    wss?.close();
    if (httpServer) httpServer.close();
    router.close();
  }

  return {
    router,
    start,
    stop,
    presence() {
      return router.counts();
    },
    port() {
      const addr = httpServer?.address();
      return typeof addr === 'object' && addr ? addr.port : 0;
    },
  };
}

function sendRaw(ws: WebSocket, env: Envelope) {
  try {
    ws.send(JSON.stringify(env));
  } catch {
    /* noop */
  }
}

function peerIp(req: { socket?: { remoteAddress?: string } } | WebSocket): string {
  const ws = req as WebSocket;
  if (typeof ws === 'object' && ws !== null && 'remoteAddress' in ws) {
    return String((ws as any).remoteAddress ?? 'unknown');
  }
  const r = req as { socket?: { remoteAddress?: string } };
  return r.socket?.remoteAddress ?? 'unknown';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function readBody(
  req: import('node:http').IncomingMessage,
  limit: number,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function serveStatic(
  root: string,
  url: string,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) {
  let rel = url === '/' ? '/index.html' : url;
  // Strict traversal guard against directory traversal and sibling directory access.
  const resolvedRoot = resolve(root);
  const target = resolve(root, '.' + rel);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden' }));
    return;
  }
  if (!existsSync(target) || statSync(target).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' });
  res.end(readFileSync(target));
}