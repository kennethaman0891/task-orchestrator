import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Store, UserRow, DeviceRow } from './store.js';

/**
 * Authentication primitives. Passwords/device credentials are hashed with
 * scrypt (with a random per-record salt) and NEVER stored in plaintext.
 * Sessions use random 256-bit opaque tokens; we only store their SHA-256.
 * Nothing secret is ever logged — callers must use `redacted()`.
 */

const SCRYPT_KEYLEN = 64;
const TOKEN_BYTES = 32;

export function newId(prefix = 'id'): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

export function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashSecret(secret: string, salt: string): string {
  return scryptSync(secret, salt, SCRYPT_KEYLEN).toString('hex');
}

export function verifySecret(secret: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** The bootstrap admin is created on first run from config. */
export function ensureAdminUser(store: Store, username: string, password: string): void {
  if (!username || !password) return;
  if (store.getUserByUsername(username)) return;
  const salt = randomBytes(16).toString('hex');
  const hash = hashSecret(password, salt);
  store.createUser({
    id: newId('user'),
    username,
    password_hash: hash,
    password_salt: salt,
  });
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export interface AuthResult {
  ok: boolean;
  reason?: string;
  user?: UserRow;
  accessToken?: string;
  refreshToken?: string;
}

export function loginWithPassword(
  store: Store,
  username: string,
  password: string,
  accessTtlMs: number,
  refreshTtlMs: number,
): AuthResult {
  const user = store.getUserByUsername(username);
  if (!user || !verifySecret(password, user.password_salt, user.password_hash)) {
    return { ok: false, reason: 'invalid_credentials' };
  }
  return issueTokens(store, user.id, null, accessTtlMs, refreshTtlMs);
}

/** Refresh: exchange a valid refresh token for a new access+refresh pair. */
export function refreshSession(
  store: Store,
  refreshToken: string,
  accessTtlMs: number,
  refreshTtlMs: number,
): AuthResult {
  const h = sha256(refreshToken);
  const session = store.getSession(h);
  if (!session || session.kind !== 'refresh') return { ok: false, reason: 'invalid_refresh' };
  if (session.expires_at <= Date.now()) {
    store.deleteSession(h);
    return { ok: false, reason: 'expired' };
  }
  const user = store.getUserById(session.user_id);
  if (!user) return { ok: false, reason: 'no_user' };
  // Rotate: invalidate the old refresh token.
  store.deleteSession(h);
  return issueTokens(store, user.id, session.device_id, accessTtlMs, refreshTtlMs);
}

function issueTokens(
  store: Store,
  userId: string,
  deviceId: string | null,
  accessTtlMs: number,
  refreshTtlMs: number,
): AuthResult {
  const now = Date.now();
  const access = randomToken();
  const refresh = randomToken();
  store.createSession({
    token_hash: sha256(access),
    kind: 'access',
    user_id: userId,
    device_id: deviceId,
    expires_at: now + accessTtlMs,
    created_at: now,
  });
  store.createSession({
    token_hash: sha256(refresh),
    kind: 'refresh',
    user_id: userId,
    device_id: deviceId,
    expires_at: now + refreshTtlMs,
    created_at: now,
  });
  const user = store.getUserById(userId);
  return { ok: true, user: user ?? undefined, accessToken: access, refreshToken: refresh };
}

/** Validate an access token → user (or null). Expired tokens are removed. */
export function authenticateAccessToken(store: Store, token: string): UserRow | null {
  const h = sha256(token);
  const session = store.getSession(h);
  if (!session || session.kind !== 'access') return null;
  if (session.expires_at <= Date.now()) {
    store.deleteSession(h);
    return null;
  }
  return store.getUserById(session.user_id);
}

export function logoutToken(store: Store, token: string): void {
  store.deleteSession(sha256(token));
}

// ── Device credential auth ──────────────────────────────────────────────────
// A device proves itself with a long random credential (minted during pairing).
// The gateway stores only its hash. The device sends the raw credential once
// on its persistent outbound connection; the server verifies the hash.

export function verifyDeviceCredential(device: DeviceRow, credential: string): boolean {
  return verifySecret(credential, device.credential_salt, device.credential_hash);
}

// ── Simple sliding-window rate limiter ───────────────────────────────────────

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private windowMs = 60_000, private max = 10) {}

  /** Returns true when the key is allowed (under limit). */
  allow(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}