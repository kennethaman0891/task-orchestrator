import { randomBytes, createPublicKey, verify as edVerify } from 'node:crypto';
import type { Store } from './store.js';
import { hashSecret, newId } from './auth.js';

/**
 * Device pairing.
 *
 * Flow (desktop initiates, phone confirms):
 *   1. Desktop generates an Ed25519 keypair; the private key stays on the
 *      desktop. It asks the gateway to `pairing.create` with its device id,
 *      public key (PEM), and human name.
 *   2. The gateway mints a single-use, expiring pairing code. The desktop
 *      renders the code + a QR containing ONLY { gatewayUrl, code }. The
 *      private key never leaves the desktop.
 *   3. The user (authenticated in the web/mobile client) enters/scans the code
 *      → `pairing.confirm`. The gateway links the pending pairing to the user
 *      and marks it `used`. No credential is handed out yet.
 *   4. The desktop, which has been polling `pairing.status`, sees `used`. It
 *      asks the gateway for a random challenge nonce, signs it with its
 *      private key, and calls `pairing.claim`. The gateway verifies the
 *      signature against the stored public key, then mints the device
 *      credential (storing only its hash) and returns it to the desktop.
 *   5. The desktop connects with the credential.
 *
 * Security: the code is single-use and expiring and contains no permanent
 * secret. The credential is only issued after the device proves possession of
 * the private key registered at pairing time. A revoked device cannot
 * reconnect.
 */

const CODE_BYTES = 9; // 9 random bytes → 18-char grouping code
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const NONCE_BYTES = 32;

export interface PairingResponse {
  ok: boolean;
  reason?: string;
  code?: string;
  deviceId?: string;
  deviceName?: string;
  expiresAt?: number;
  credential?: string; // returned ONLY to the proven device owner
}

function generateCode(): string {
  const bytes = randomBytes(CODE_BYTES);
  let code = '';
  for (let i = 0; i < bytes.length; i++) {
    code += CODE_CHARS[bytes[i]! % CODE_CHARS.length] ?? '';
    if (i % 3 === 2 && i < bytes.length - 1) code += '-';
  }
  return code;
}

/** Desktop requests a pairing code for a new device identity. */
export function createPairing(
  store: Store,
  opts: { deviceId: string; devicePublicKey: string; deviceName: string },
  ttlMs: number,
): PairingResponse {
  const existing = store.getPairingByDevice(opts.deviceId);
  if (existing && (existing.status === 'pending' || existing.status === 'used') && existing.expires_at > Date.now()) {
    // Re-use the same code so a re-render of the QR doesn't invalidate it.
    return { ok: true, deviceId: opts.deviceId, deviceName: existing.device_name, expiresAt: existing.expires_at };
  }

  if (!store.getDevice(opts.deviceId)) {
    store.createDevice({
      id: opts.deviceId,
      name: opts.deviceName,
      public_key: opts.devicePublicKey,
      credential_hash: '',
      credential_salt: '',
      user_id: null,
      revoked: false,
    });
  }

  const code = generateCode();
  const salt = randomBytes(16).toString('hex');
  store.createPairing({
    code_hash: hashSecret(code, salt),
    code_salt: salt,
    device_id: opts.deviceId,
    device_public_key: opts.devicePublicKey,
    device_name: opts.deviceName,
    user_id: null,
    status: 'pending',
    expires_at: Date.now() + ttlMs,
    created_at: Date.now(),
    used_by: null,
    nonce: null,
    nonce_expires_at: null,
  });
  return { ok: true, code, deviceId: opts.deviceId, deviceName: opts.deviceName, expiresAt: Date.now() + ttlMs };
}

/** User (in the client) confirms a pairing code. Marks it used, links the user. */
export function confirmPairing(
  store: Store,
  code: string,
  userId: string,
): PairingResponse {
  if (!code) return { ok: false, reason: 'missing_code' };
  const all = store.getPendingPairings();
  const now = Date.now();
  for (const p of all) {
    if (p.status !== 'pending') continue;
    if (p.expires_at <= now) {
      store.updatePairingStatus(p.code_hash, 'expired');
      continue;
    }
    if (verifyPairingCode(code, p.code_salt, p.code_hash)) {
      store.updatePairingStatus(p.code_hash, 'used', userId);
      const device = store.getDevice(p.device_id);
      if (!device) return { ok: false, reason: 'device_missing' };
      if (device.revoked) return { ok: false, reason: 'device_revoked' };
      store.linkDeviceToUser(device.id, userId);
      return { ok: true, deviceId: device.id, deviceName: device.name, expiresAt: now };
    }
  }
  return { ok: false, reason: 'invalid_code' };
}

/** Desktop polls its pairing status. */
export function pairingStatus(
  store: Store,
  deviceId: string,
): { ok: boolean; status?: string; deviceId?: string } {
  const p = store.getPairingByDevice(deviceId);
  if (!p) return { ok: false };
  if (p.status === 'pending' && p.expires_at <= Date.now()) {
    store.updatePairingStatus(p.code_hash, 'expired');
    return { ok: true, status: 'expired', deviceId };
  }
  return { ok: true, status: p.status, deviceId };
}

/** Desktop requests a random challenge nonce to sign. */
export function pairingChallenge(
  store: Store,
  deviceId: string,
  nonceTtlMs: number,
): { ok: boolean; reason?: string; nonce?: string } {
  const p = store.getPairingByDevice(deviceId);
  if (!p) return { ok: false, reason: 'no_pairing' };
  if (p.status !== 'used') return { ok: false, reason: 'not_confirmed' };
  if (p.expires_at <= Date.now()) return { ok: false, reason: 'expired' };
  const nonce = randomBytes(NONCE_BYTES).toString('base64url');
  store.setPairingNonce(p.code_hash, nonce, Date.now() + nonceTtlMs);
  return { ok: true, nonce };
}

/**
 * Desktop proves possession of the device private key by signing the nonce
 * with Ed25519, then receives its credential (issued once, stored hashed).
 */
export function pairingClaim(
  store: Store,
  deviceId: string,
  nonce: string,
  signatureBase64: string,
): { ok: boolean; reason?: string; credential?: string; deviceId?: string } {
  const p = store.getPairingByDevice(deviceId);
  if (!p) return { ok: false, reason: 'no_pairing' };
  if (p.status !== 'used') return { ok: false, reason: 'not_confirmed' };
  if (!p.nonce || p.nonce_expires_at === null || p.nonce_expires_at <= Date.now()) {
    return { ok: false, reason: 'no_challenge' };
  }
  if (nonce !== p.nonce) return { ok: false, reason: 'bad_nonce' };

  // Verify the Ed25519 signature over the nonce against the registered public key.
  let valid = false;
  try {
    const pub = createPublicKey({ key: Buffer.from(p.device_public_key, 'base64'), format: 'der', type: 'spki' });
    valid = edVerify(null, Buffer.from(nonce, 'utf8'), pub, Buffer.from(signatureBase64, 'base64'));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  const device = store.getDevice(deviceId);
  if (!device || device.revoked) return { ok: false, reason: 'device_revoked' };

  // Mint the credential; only its hash is stored.
  const credential = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  store.setDeviceCredentials(device.id, hashSecret(credential, salt), salt);
  store.updatePairingStatus(p.code_hash, 'claimed');
  return { ok: true, credential, deviceId: device.id };
}

function verifyPairingCode(code: string, salt: string, expected: string): boolean {
  const a = Buffer.from(hashSecret(code, salt), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}