import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Storage abstraction for the gateway. The default implementation uses
 * node:sqlite (zero native deps). The interface is intentionally small so a
 * PostgreSQL adapter can be dropped in behind it without touching the rest of
 * the gateway (see gateway/README.md → Production).
 *
 * Stored secrets are ALWAYS pre-hashed by the caller (auth.ts). We never store
 * raw passwords, tokens, or private keys. Terminal output is never persisted.
 */

export interface DeviceRow {
  id: string;
  name: string;
  public_key: string; // PEM of the device's Ed25519 public key (identity)
  credential_hash: string; // device credential (random secret) — hashed
  credential_salt: string;
  user_id: string | null;
  created_at: number;
  last_seen: number | null;
  revoked: boolean;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: number;
}

export interface SessionRow {
  token_hash: string;
  kind: 'access' | 'refresh';
  user_id: string;
  device_id: string | null;
  expires_at: number;
  created_at: number;
}

export interface PairingRow {
  code_hash: string;
  code_salt: string;
  device_id: string;
  device_public_key: string;
  device_name: string;
  user_id: string | null;
  status: 'pending' | 'used' | 'expired' | 'revoked' | 'claimed';
  expires_at: number;
  created_at: number;
  used_by: string | null;
  nonce: string | null;
  nonce_expires_at: number | null;
}

export interface PermissionRow {
  device_id: string;
  resource: string; // e.g. 'terminal', 'files', 'agent'
  allow: boolean;
}

export interface Store {
  close(): void;
  createUser(u: Omit<UserRow, 'created_at'>): void;
  getUserByUsername(username: string): UserRow | null;
  getUserById(id: string): UserRow | null;

  createDevice(d: Omit<DeviceRow, 'created_at' | 'last_seen'>): void;
  getDevice(id: string): DeviceRow | null;
  getDevicesForUser(userId: string): DeviceRow[];
  updateDeviceLastSeen(id: string, ts: number): void;
  revokeDevice(id: string): void;
  setDeviceCredentials(id: string, hash: string, salt: string): void;
  linkDeviceToUser(id: string, userId: string): void;

  createSession(s: SessionRow): void;
  getSession(tokenHash: string): SessionRow | null;
  deleteSession(tokenHash: string): void;
  deleteSessionsForUser(userId: string, kind?: SessionRow['kind']): void;
  deleteSessionsForDevice(deviceId: string): void;

  createPairing(p: PairingRow): void;
  getPairingByDevice(deviceId: string): PairingRow | null;
  getPendingPairings(): PairingRow[];
  updatePairingStatus(codeHash: string, status: PairingRow['status'], usedBy?: string | null): void;
  setPairingNonce(codeHash: string, nonce: string, expiresAt: number): void;
  purgeExpiredPairings(now: number): void;

  getPermissions(deviceId: string): PermissionRow[];
  setPermission(deviceId: string, resource: string, allow: boolean): void;
}

// ── SQLite implementation ────────────────────────────────────────────────────

const MIGRATIONS: string[] = [
  // 001 — initial schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    credential_hash TEXT NOT NULL,
    credential_salt TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL,
    last_seen INTEGER,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    user_id TEXT NOT NULL,
    device_id TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pairings (
    code_hash TEXT PRIMARY KEY,
    code_salt TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    device_name TEXT NOT NULL,
    user_id TEXT,
    status TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    used_by TEXT,
    nonce TEXT,
    nonce_expires_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS permissions (
    device_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    allow INTEGER NOT NULL,
    PRIMARY KEY (device_id, resource)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
  CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
  `,
];

export function openStore(dbPath: string): Store {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  for (const migration of MIGRATIONS) {
    db.exec(migration);
  }

  const intToBool = (v: number | bigint | null): boolean => Number(v ?? 0) === 1;

  return {
    close() {
      db.close();
    },

    createUser(u) {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(u.id, u.username, u.password_hash, u.password_salt, Date.now());
    },
    getUserByUsername(username) {
      const row = db
        .prepare(`SELECT * FROM users WHERE username = ?`)
        .get(username) as any;
      return row ? mapUser(row) : null;
    },
    getUserById(id) {
      const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as any;
      return row ? mapUser(row) : null;
    },

    createDevice(d) {
      db.prepare(
        `INSERT INTO devices (id, name, public_key, credential_hash, credential_salt, user_id, created_at, revoked)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(d.id, d.name, d.public_key, d.credential_hash, d.credential_salt, d.user_id, Date.now());
    },
    getDevice(id) {
      const row = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id) as any;
      return row ? mapDevice(row) : null;
    },
    getDevicesForUser(userId) {
      const rows = db
        .prepare(`SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC`)
        .all(userId) as any[];
      return rows.map(mapDevice);
    },
    updateDeviceLastSeen(id, ts) {
      db.prepare(`UPDATE devices SET last_seen = ? WHERE id = ?`).run(ts, id);
    },
    revokeDevice(id) {
      db.prepare(`UPDATE devices SET revoked = 1 WHERE id = ?`).run(id);
    },
    setDeviceCredentials(id, hash, salt) {
      db.prepare(`UPDATE devices SET credential_hash = ?, credential_salt = ? WHERE id = ?`).run(
        hash,
        salt,
        id,
      );
    },
    linkDeviceToUser(id, userId) {
      db.prepare(`UPDATE devices SET user_id = ? WHERE id = ?`).run(userId, id);
    },

    createSession(s) {
      db.prepare(
        `INSERT INTO sessions (token_hash, kind, user_id, device_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(s.token_hash, s.kind, s.user_id, s.device_id, s.expires_at, Date.now());
    },
    getSession(tokenHash) {
      const row = db.prepare(`SELECT * FROM sessions WHERE token_hash = ?`).get(tokenHash) as any;
      return row ? mapSession(row) : null;
    },
    deleteSession(tokenHash) {
      db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
    },
    deleteSessionsForUser(userId, kind) {
      if (kind) {
        db.prepare(`DELETE FROM sessions WHERE user_id = ? AND kind = ?`).run(userId, kind);
      } else {
        db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
      }
    },
    deleteSessionsForDevice(deviceId) {
      db.prepare(`DELETE FROM sessions WHERE device_id = ?`).run(deviceId);
    },

    createPairing(p) {
      db.prepare(
        `INSERT INTO pairings (code_hash, code_salt, device_id, device_public_key, device_name, user_id, status, expires_at, created_at, used_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        p.code_hash,
        p.code_salt,
        p.device_id,
        p.device_public_key,
        p.device_name,
        p.user_id,
        p.status,
        p.expires_at,
        p.created_at,
        p.used_by,
      );
    },
    getPairingByDevice(deviceId) {
      const row = db
        .prepare(`SELECT * FROM pairings WHERE device_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(deviceId) as any;
      return row ? mapPairing(row) : null;
    },
    getPendingPairings() {
      const rows = db.prepare(`SELECT * FROM pairings WHERE status = 'pending'`).all() as any[];
      return rows.map(mapPairing);
    },
    updatePairingStatus(codeHash, status, usedBy = null) {
      db.prepare(`UPDATE pairings SET status = ?, used_by = ? WHERE code_hash = ?`).run(
        status,
        usedBy,
        codeHash,
      );
    },
    setPairingNonce(codeHash, nonce, expiresAt) {
      db.prepare(`UPDATE pairings SET nonce = ?, nonce_expires_at = ? WHERE code_hash = ?`).run(
        nonce,
        expiresAt,
        codeHash,
      );
    },
    purgeExpiredPairings(now) {
      db.prepare(`UPDATE pairings SET status = 'expired' WHERE expires_at < ? AND status = 'pending'`).run(now);
    },

    getPermissions(deviceId) {
      const rows = db
        .prepare(`SELECT resource, allow FROM permissions WHERE device_id = ?`)
        .all(deviceId) as any[];
      return rows.map((r) => ({ device_id: deviceId, resource: r.resource, allow: intToBool(r.allow) }));
    },
    setPermission(deviceId, resource, allow) {
      db.prepare(
        `INSERT INTO permissions (device_id, resource, allow) VALUES (?, ?, ?)
         ON CONFLICT(device_id, resource) DO UPDATE SET allow = excluded.allow`,
      ).run(deviceId, resource, allow ? 1 : 0);
    },
  };
}

function mapUser(row: any): UserRow {
  return {
    id: row.id,
    username: row.username,
    password_hash: row.password_hash,
    password_salt: row.password_salt,
    created_at: row.created_at,
  };
}
function mapDevice(row: any): DeviceRow {
  return {
    id: row.id,
    name: row.name,
    public_key: row.public_key,
    credential_hash: row.credential_hash,
    credential_salt: row.credential_salt,
    user_id: row.user_id ?? null,
    created_at: row.created_at,
    last_seen: row.last_seen ?? null,
    revoked: Number(row.revoked ?? 0) === 1,
  };
}
function mapSession(row: any): SessionRow {
  return {
    token_hash: row.token_hash,
    kind: row.kind,
    user_id: row.user_id,
    device_id: row.device_id ?? null,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}
function mapPairing(row: any): PairingRow {
  return {
    code_hash: row.code_hash,
    code_salt: row.code_salt,
    device_id: row.device_id,
    device_public_key: row.device_public_key,
    device_name: row.device_name,
    user_id: row.user_id ?? null,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at,
    used_by: row.used_by ?? null,
    nonce: row.nonce ?? null,
    nonce_expires_at: row.nonce_expires_at ?? null,
  };
}