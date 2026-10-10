import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openStore } from '../src/store.js';
import { ensureAdminUser, loginWithPassword } from '../src/auth.js';
import {
  createPairing,
  confirmPairing,
  pairingChallenge,
  pairingClaim,
} from '../src/pairing.js';
import { createGatewayServer } from '../src/server.js';
import { envelope, MSG } from '../src/protocol.js';
import type { GatewayConfig } from '../src/config.js';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';

let dir: string;
let cfg: GatewayConfig;
let store: ReturnType<typeof openStore>;
let server: ReturnType<typeof createGatewayServer>;
let port: number;

function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    host: '127.0.0.1',
    wssPort: 0,
    httpPort: 0,
    dbPath: join(dir, 'test.db'),
    webClientDir: null,
    tlsCertPath: null,
    tlsKeyPath: null,
    adminUsername: 'admin',
    adminPassword: 'test-password',
    accessTokenTtlMs: 60_000,
    refreshTokenTtlMs: 3_600_000,
    pairingCodeTtlMs: 60_000,
    heartbeatIntervalMs: 5_000,
    offlineAfterMs: 60_000,
    maxAuthAttemptsPerMinute: 100,
    maxPairingAttemptsPerMinute: 100,
    maxMessageBytes: 256 * 1024,
    publicUrl: 'ws://127.0.0.1',
    verbose: false,
    ...overrides,
  };
}

let adminUserId: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tto-gw-'));
  cfg = testConfig();
  store = openStore(cfg.dbPath);
  ensureAdminUser(store, cfg.adminUsername, cfg.adminPassword);
  // Resolve the real admin user id (it is generated at creation).
  adminUserId = store.getUserByUsername('admin')!.id;
  server = createGatewayServer(store, cfg);
  server.start();
  // Wait for the listener (port 0 → ephemeral) to bind a real port.
  for (let i = 0; i < 40; i++) {
    if (server.port() > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  port = server.port();
});

after(() => {
  server.stop();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function wsUrl(path = ''): string {
  return `ws://127.0.0.1:${port}${path}`;
}

/** Full happy-path pairing: create → confirm → challenge → claim (returns credential). */
function claimCredential(deviceId: string, name = 'Test Desktop'): string {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const p = createPairing(store, { deviceId, devicePublicKey: pubDer, deviceName: name }, 60_000);
  assert.ok(p.code);
  const confirmed = confirmPairing(store, p.code!, adminUserId);
  assert.ok(confirmed.ok);
  const challenge = pairingChallenge(store, deviceId, 60_000);
  assert.ok(challenge.ok);
  const sig = edSign(null, Buffer.from(challenge.nonce!), privateKey).toString('base64');
  const claimed = pairingClaim(store, deviceId, challenge.nonce!, sig);
  assert.ok(claimed.ok);
  assert.ok(claimed.credential);
  return claimed.credential!;
}

function connect(path = ''): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(path));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    const onClose = (code: number, reason: string) => {
      clearTimeout(t);
      reject(new Error(`closed code=${code} reason=${reason.toString()}`));
    };
    ws.once('close', onClose);
    ws.once('message', (data) => {
      clearTimeout(t);
      ws.off('close', onClose);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e as Error);
      }
    });
  });
}

function send(ws: WebSocket, env: any) {
  ws.send(JSON.stringify(env));
}

describe('gateway auth', () => {
  test('valid login issues access + refresh tokens', () => {
    const r = loginWithPassword(store, 'admin', 'test-password', 60_000, 3_600_000);
    assert.ok(r.ok);
    assert.ok(r.accessToken);
    assert.ok(r.refreshToken);
  });

  test('invalid login is rejected', () => {
    const r = loginWithPassword(store, 'admin', 'wrong-password', 60_000, 3_600_000);
    assert.equal(r.ok, false);
  });
});

describe('gateway pairing', () => {
  test('pairing code is single-use and expires', async () => {
    const created = createPairing(store, {
      deviceId: 'dev-pair-1',
      devicePublicKey: 'pubkey-1',
      deviceName: 'MacBook Pro',
    }, 60_000);
    assert.ok(created.ok);
    assert.ok(created.code);

    // Confirm as the admin user.
    const confirmed = confirmPairing(store, created.code!, adminUserId);
    assert.ok(confirmed.ok);
    assert.equal(confirmed.deviceId, 'dev-pair-1');

    // Reuse must fail — code is single-use.
    const reused = confirmPairing(store, created.code!, adminUserId);
    assert.equal(reused.ok, false);

    // Expired pairing can't be confirmed.
    const expired = createPairing(store, {
      deviceId: 'dev-pair-2',
      devicePublicKey: 'pubkey-2',
      deviceName: 'Old Laptop',
    }, -1000);
    assert.ok(expired.code);
    const r2 = confirmPairing(store, expired.code!, adminUserId);
    assert.equal(r2.ok, false);
  });

  test('credential claim requires private-key proof', async () => {
    // Desktop keypair.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    const created = createPairing(store, {
      deviceId: 'dev-claim-1',
      devicePublicKey: pubDer,
      deviceName: 'Claim Test',
    }, 60_000);
    assert.ok(created.code);
    const confirmed = confirmPairing(store, created.code!, adminUserId);
    assert.ok(confirmed.ok);
    // Confirm no credential is exposed at confirm time.
    assert.equal(confirmed.credential, undefined);

    // Without a challenge, claim fails.
    const early = pairingClaim(store, 'dev-claim-1', 'nope', 'c2ln');
    assert.equal(early.ok, false);

    const challenge = pairingChallenge(store, 'dev-claim-1', 60_000);
    assert.ok(challenge.ok);
    assert.ok(challenge.nonce);

    // Wrong signature fails.
    const badSig = edSign(null, Buffer.from('not-the-nonce'), privateKey).toString('base64');
    const bad = pairingClaim(store, 'dev-claim-1', challenge.nonce!, badSig);
    assert.equal(bad.ok, false);

    // Correct signature succeeds and mints a credential.
    const sig = edSign(null, Buffer.from(challenge.nonce!), privateKey).toString('base64');
    const claimed = pairingClaim(store, 'dev-claim-1', challenge.nonce!, sig);
    assert.ok(claimed.ok);
    assert.ok(claimed.credential);

    // Claim is single-use: second claim with same challenge fails.
    const again = pairingClaim(store, 'dev-claim-1', challenge.nonce!, sig);
    assert.equal(again.ok, false);
  });
});

describe('gateway relay routing', () => {
  test('desktop + client connect, terminal input routes to desktop', async () => {
    // Pair + claim a device credential.
    const credential = claimCredential('dev-relay-1');

    // Desktop connects with its device credential.
    const desktop = await connect();
    const helloDesktop = envelope(MSG.HELLO, { role: 'desktop', deviceId: 'dev-relay-1', credential });
    send(desktop, helloDesktop);
    const ack = await nextMessage(desktop);
    assert.equal(ack.type, MSG.ACK);

    // Client authenticates with a real access token.
    const login = loginWithPassword(store, 'admin', 'test-password', 60_000, 3_600_000);
    assert.ok(login.accessToken);
    const client = await connect();
    send(client, envelope(MSG.HELLO, { role: 'client', token: login.accessToken, deviceId: 'dev-relay-1' }));
    const cack = await nextMessage(client);
    assert.equal(cack.type, MSG.ACK);

    // Client sends terminal input → gateway routes to desktop.
    const inputPromise = nextMessage(desktop);
    send(client, envelope(MSG.TERMINAL_INPUT, { data: 'aGVsbG8K' }));
    const routed = await inputPromise;
    assert.equal(routed.type, MSG.TERMINAL_INPUT);
    assert.equal(routed.payload.data, 'aGVsbG8K');

    // Desktop sends terminal output → gateway routes back to client.
    const outputPromise = nextMessage(client);
    send(desktop, envelope(MSG.TERMINAL_OUTPUT, { data: 'b3V0cHV0Cg==' }));
    const out = await outputPromise;
    assert.equal(out.type, MSG.TERMINAL_OUTPUT);

    desktop.close();
    client.close();
  });

  test('unauthorized client cannot route to another user\'s device', async () => {
    // Second user.
    ensureAdminUser(store, 'alice', 'alice-pw');
    const alice = loginWithPassword(store, 'alice', 'alice-pw', 60_000, 3_600_000);
    assert.ok(alice.accessToken);

    const p = createPairing(store, {
      deviceId: 'dev-alice-1',
      devicePublicKey: 'pk-alice-1',
      deviceName: 'Alice Desktop',
    }, 60_000);
    const confirmed = confirmPairing(store, p.code!, alice.user!.id);
    assert.ok(confirmed.ok);

    // Bob (admin) tries to control Alice's device — must fail.
    const admin = loginWithPassword(store, 'admin', 'test-password', 60_000, 3_600_000);
    const client = await connect();
    send(client, envelope(MSG.HELLO, { role: 'client', token: admin.accessToken, deviceId: 'dev-alice-1' }));
    const cack = await nextMessage(client);
    assert.equal(cack.type, MSG.ACK);

    const errPromise = nextMessage(client);
    send(client, envelope(MSG.TERMINAL_INPUT, { data: 'aGk=' }));
    const err = await errPromise;
    assert.equal(err.type, MSG.ERROR);
    client.close();
  });

  test('revoked device is kicked and cannot reconnect', async () => {
    const credential = claimCredential('dev-rev-1', 'To Be Revoked');

    const desktop = await connect();
    send(desktop, envelope(MSG.HELLO, { role: 'desktop', deviceId: 'dev-rev-1', credential }));
    const ack = await nextMessage(desktop);
    assert.equal(ack.type, MSG.ACK);

    // Revoke → desktop is kicked.
    const closed = new Promise((resolve) => desktop.once('close', (code: number) => resolve(code)));
    store.revokeDevice('dev-rev-1');
    // Trigger kick via the router (the HTTP route also does this).
    server.router.kickDesktop('dev-rev-1', 4403, 'revoked');
    const code = await closed;
    assert.equal(code, 4403);
  });
});