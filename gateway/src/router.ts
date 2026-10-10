import type { WebSocket } from 'ws';
import type { Store } from './store.js';
import type { Envelope } from './protocol.js';
import { MSG } from './protocol.js';
import { authenticateAccessToken, verifyDeviceCredential, newId } from './auth.js';

/**
 * Connection registry + routing.
 *
 * Two kinds of peers connect:
 *  - DESKTOP peers: the user's TTO desktop app, connected OUTBOUND from the
 *    home network. Authenticates with its device credential. One live
 *    connection per device (a new connection replaces a stale one).
 *  - CLIENT peers: the user's phone/web client. Authenticates with a user
 *    access token, then subscribes to a device id to relay messages to it.
 *
 * The gateway NEVER executes commands; it only forwards authenticated
 * envelopes between a client and the matching desktop device. Everything
 * a client sends to a device is scoped by: the client's user identity, the
 * device's owner, and the device's permission grants.
 */

export type PeerKind = 'desktop' | 'client';

export interface Peer {
  id: string; // socket id (opaque)
  kind: PeerKind;
  ws: WebSocket;
  /** Desktop: device id. Client: device id it is controlling (subscribed). */
  deviceId: string | null;
  userId: string | null;
  authedAt: number;
  alive: boolean;
}

export interface RouterEvents {
  onDesktopConnected: (deviceId: string) => void;
  onDesktopDisconnected: (deviceId: string) => void;
  onClientConnected: (userId: string) => void;
  onClientDisconnected: (userId: string) => void;
}

export class Router {
  private desktops = new Map<string, Peer>(); // deviceId -> peer
  private clients = new Map<string, Peer>(); // socket id -> peer
  private socketToDevice = new Map<string, string>(); // socket id -> deviceId (desktop)
  private events: RouterEvents;
  private offlineTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: Store,
    private cfg: {
      offlineAfterMs: number;
      heartbeatIntervalMs: number;
    },
    events: RouterEvents,
  ) {
    this.events = events;
    this.offlineTimer = setInterval(() => this.markStaleOffline(), this.cfg.offlineAfterMs / 2);
    this.offlineTimer.unref?.();
  }

  close() {
    if (this.offlineTimer) clearInterval(this.offlineTimer);
  }

  // ── Presence ─────────────────────────────────────────────────────────────

  isDeviceOnline(deviceId: string): boolean {
    return this.desktops.has(deviceId);
  }

  deviceStatus(deviceId: string): { online: boolean; lastSeen: number | null } {
    const dev = this.store.getDevice(deviceId);
    return {
      online: this.isDeviceOnline(deviceId),
      lastSeen: dev?.last_seen ?? null,
    };
  }

  private markStaleOffline() {
    const now = Date.now();
    for (const [deviceId, peer] of this.desktops) {
      if (!peer.alive) continue;
      if (now - peer.authedAt > this.cfg.offlineAfterMs) {
        // Still connected but silent too long — treat as offline for presence
        // purposes (the UI wants a truthful badge).
        this.store.updateDeviceLastSeen(deviceId, now);
      }
    }
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /** Register a DESKTOP (device) connection. Replaces any stale one. */
  registerDesktop(ws: WebSocket, deviceId: string): Peer {
    const existing = this.desktops.get(deviceId);
    if (existing && existing.ws !== ws) {
      // A newer connection replaced the old one — close the stale socket.
      try {
        existing.alive = false;
        existing.ws.close(4001, 'replaced');
      } catch {
        /* noop */
      }
    }
    const peer: Peer = {
      id: newId('sock'),
      kind: 'desktop',
      ws,
      deviceId,
      userId: null,
      authedAt: Date.now(),
      alive: true,
    };
    this.desktops.set(deviceId, peer);
    this.socketToDevice.set(peer.id, deviceId);
    this.store.updateDeviceLastSeen(deviceId, Date.now());
    this.events.onDesktopConnected(deviceId);
    return peer;
  }

  /** Register a CLIENT connection (authenticated user controlling a device). */
  registerClient(ws: WebSocket, userId: string, deviceId: string | null): Peer {
    const peer: Peer = {
      id: newId('sock'),
      kind: 'client',
      ws,
      deviceId,
      userId,
      authedAt: Date.now(),
      alive: true,
    };
    this.clients.set(peer.id, peer);
    this.events.onClientConnected(userId);
    return peer;
  }

  unregister(peer: Peer) {
    peer.alive = false;
    if (peer.kind === 'desktop' && peer.deviceId) {
      if (this.desktops.get(peer.deviceId) === peer) {
        this.desktops.delete(peer.deviceId);
        this.socketToDevice.delete(peer.id);
        this.events.onDesktopDisconnected(peer.deviceId);
      }
    } else if (peer.kind === 'client') {
      this.clients.delete(peer.id);
      if (peer.userId) this.events.onClientDisconnected(peer.userId);
    }
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  /** Send an envelope to a desktop device by id. Returns false if offline. */
  sendToDesktop(deviceId: string, env: Envelope): boolean {
    const peer = this.desktops.get(deviceId);
    if (!peer || !peer.alive) return false;
    try {
      peer.ws.send(JSON.stringify(env));
      return true;
    } catch {
      return false;
    }
  }

  /** Send an envelope to a client socket. Returns false if offline. */
  sendToClient(socketId: string, env: Envelope): boolean {
    const peer = this.clients.get(socketId);
    if (!peer || !peer.alive) return false;
    try {
      peer.ws.send(JSON.stringify(env));
      return true;
    } catch {
      return false;
    }
  }

  /** Route a message from a client to the desktop it controls (authorized). */
  routeClientToDesktop(socketId: string, env: Envelope): { ok: boolean; error?: string } {
    const client = this.clients.get(socketId);
    if (!client || !client.alive) return { ok: false, error: 'not_connected' };
    const deviceId = client.deviceId;
    if (!deviceId) return { ok: false, error: 'no_device' };
    // Ownership check: the device must belong to the client's user.
    const dev = this.store.getDevice(deviceId);
    if (!dev || dev.revoked) return { ok: false, error: 'device_unavailable' };
    if (dev.user_id !== client.userId) return { ok: false, error: 'forbidden' };
    // Permission check by message class.
    const perm = this.permissionFor(env.type);
    if (perm && !this.deviceAllows(dev, perm)) return { ok: false, error: 'permission_denied' };

    if (!this.sendToDesktop(deviceId, env)) return { ok: false, error: 'device_offline' };
    return { ok: true };
  }

  /** Route a message from a desktop to all clients controlling that device. */
  routeDesktopToClients(deviceId: string, env: Envelope): number {
    let sent = 0;
    for (const peer of this.clients.values()) {
      if (!peer.alive || peer.deviceId !== deviceId) continue;
      if (peer.userId) {
        const dev = this.store.getDevice(deviceId);
        if (!dev || dev.user_id !== peer.userId) continue;
      }
      try {
        peer.ws.send(JSON.stringify(env));
        sent++;
      } catch {
        /* skip */
      }
    }
    return sent;
  }

  /** Map a message type to the permission resource it requires. */
  private permissionFor(type: string): string | null {
    switch (type) {
      case MSG.TERMINAL_INPUT:
      case MSG.TERMINAL_OUTPUT:
      case MSG.TERMINAL_RESIZE:
      case MSG.TERMINAL_SIGNAL:
      case MSG.SESSION_ATTACH:
      case MSG.SESSION_DETACH:
      case MSG.SESSION_LIST:
      case MSG.TERMINAL_LIST:
      case MSG.SESSION_STATE:
        return 'terminal';
      case MSG.AGENT_INPUT:
      case MSG.AGENT_OUTPUT:
      case MSG.AGENT_STATUS:
      case MSG.AGENT_LIST:
        return 'agent';
      case MSG.FILE_LIST:
      case MSG.FILE_READ:
      case MSG.FILE_WRITE:
      case MSG.FILE_META:
        return 'files';
      default:
        return null;
    }
  }

  private deviceAllows(dev: { id: string }, resource: string): boolean {
    const perms = this.store.getPermissions(dev.id);
    const found = perms.find((p) => p.resource === resource);
    // Default: allow terminal + agent, require explicit grant for files.
    if (found) return found.allow;
    return resource === 'terminal' || resource === 'agent';
  }

  // ── Socket lookup (used by the server layer) ────────────────────────────

  /** Device id of a live desktop socket, or null. */
  deviceIdForSocket(ws: WebSocket): string | null {
    for (const [deviceId, p] of this.desktops) {
      if (p.ws === ws) return deviceId;
    }
    return null;
  }

  /** Client peer for a socket, or null. */
  clientForSocket(ws: WebSocket): Peer | null {
    for (const p of this.clients.values()) {
      if (p.ws === ws) return p;
    }
    return null;
  }

  /** Live desktop peer for a device, or null. */
  desktopForDevice(deviceId: string): Peer | null {
    return this.desktops.get(deviceId) ?? null;
  }

  /** Live connection counts (for health/status). */
  counts(): { desktops: number; clients: number } {
    return { desktops: this.desktops.size, clients: this.clients.size };
  }

  /** Hard-close a live desktop connection (e.g. revocation). */
  kickDesktop(deviceId: string, code = 4403, reason = 'revoked'): void {
    const peer = this.desktops.get(deviceId);
    if (peer) {
      try {
        peer.alive = false;
        peer.ws.close(code, reason);
      } catch {
        /* noop */
      }
    }
  }

  /** Send a hello/status snapshot to a peer. */
  statusSnapshot(socketId: string): void {
    const peer = this.clients.get(socketId);
    if (!peer) return;
    const deviceId = peer.deviceId;
    if (!deviceId) return;
    const status = this.deviceStatus(deviceId);
    this.sendToClient(socketId, {
      v: 1,
      id: newId(),
      type: MSG.DEVICE_STATUS,
      payload: { deviceId, online: status.online, lastSeen: status.lastSeen },
    });
  }
}

/** Handshake helpers shared by server + tests. */
export function authenticateDesktop(
  store: Store,
  deviceId: string,
  credential: string,
): { ok: boolean; error?: string } {
  const dev = store.getDevice(deviceId);
  if (!dev) return { ok: false, error: 'device_not_registered' };
  if (dev.revoked) return { ok: false, error: 'device_revoked' };
  if (!dev.credential_hash) return { ok: false, error: 'device_not_confirmed' };
  if (!verifyDeviceCredential(dev, credential)) return { ok: false, error: 'bad_credential' };
  return { ok: true };
}

export function authenticateClient(
  store: Store,
  token: string,
): { ok: boolean; user?: import('./store.js').UserRow; error?: string } {
  const user = authenticateAccessToken(store, token);
  if (!user) return { ok: false, error: 'invalid_token' };
  return { ok: true, user };
}