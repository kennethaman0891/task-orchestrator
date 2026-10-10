import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * TTO Gateway configuration, loaded from environment variables with safe
 * local-development defaults. Never log the resolved secrets — use
 * `redacted()` for any value you might print.
 *
 * Production must set: TTO_GATEWAY_HOST, TTO_GATEWAY_WSS_PORT,
 * TTO_GATEWAY_ADMIN_USERNAME, TTO_GATEWAY_ADMIN_PASSWORD,
 * and TLS cert/key paths for WSS.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface GatewayConfig {
  host: string;
  wssPort: number;
  httpPort: number | null;
  /** Path to SQLite database file. Storage is swappable (see store.ts). */
  dbPath: string;
  /** Static web/mobile client directory to serve over HTTP (optional). */
  webClientDir: string | null;
  /** TLS cert/key for WSS. If absent, falls back to plain WS (dev only). */
  tlsCertPath: string | null;
  tlsKeyPath: string | null;
  /** First-run bootstrap admin credentials. */
  adminUsername: string;
  adminPassword: string;
  /** Session / token lifetimes (ms). */
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
  pairingCodeTtlMs: number;
  /** Heartbeat / presence timeouts (ms). */
  heartbeatIntervalMs: number;
  offlineAfterMs: number;
  /** Simple per-IP rate limits. */
  maxAuthAttemptsPerMinute: number;
  maxPairingAttemptsPerMinute: number;
  /** Max message size a peer may send (protects against runaway relays). */
  maxMessageBytes: number;
  /** Base URL published to clients for building links (e.g. wss://host:port). */
  publicUrl: string;
  /** When true, log protocol-level message names (never payload contents). */
  verbose: boolean;
}

export function loadConfig(): GatewayConfig {
  const root = join(__dirname, '..', '..');
  return {
    host: envStr('TTO_GATEWAY_HOST', '0.0.0.0'),
    wssPort: envInt('TTO_GATEWAY_WSS_PORT', 8787),
    httpPort: envInt('TTO_GATEWAY_HTTP_PORT', 8788),
    dbPath: envStr('TTO_GATEWAY_DB', join(root, 'data', 'tto-gateway.db')),
    webClientDir: envStr('TTO_GATEWAY_WEB_CLIENT', join(root, 'client-dist')) || null,
    tlsCertPath: envStr('TTO_GATEWAY_TLS_CERT', '') || null,
    tlsKeyPath: envStr('TTO_GATEWAY_TLS_KEY', '') || null,
    adminUsername: envStr('TTO_GATEWAY_ADMIN_USERNAME', 'admin'),
    adminPassword: envStr('TTO_GATEWAY_ADMIN_PASSWORD', ''),
    accessTokenTtlMs: envInt('TTO_GATEWAY_ACCESS_TTL_MS', 15 * 60 * 1000),
    refreshTokenTtlMs: envInt('TTO_GATEWAY_REFRESH_TTL_MS', 30 * 24 * 60 * 60 * 1000),
    pairingCodeTtlMs: envInt('TTO_GATEWAY_PAIRING_TTL_MS', 10 * 60 * 1000),
    heartbeatIntervalMs: envInt('TTO_GATEWAY_HEARTBEAT_MS', 15_000),
    offlineAfterMs: envInt('TTO_GATEWAY_OFFLINE_AFTER_MS', 60_000),
    maxAuthAttemptsPerMinute: envInt('TTO_GATEWAY_MAX_AUTH_PER_MIN', 10),
    maxPairingAttemptsPerMinute: envInt('TTO_GATEWAY_MAX_PAIRING_PER_MIN', 5),
    maxMessageBytes: envInt('TTO_GATEWAY_MAX_MSG_BYTES', 256 * 1024),
    publicUrl: envStr('TTO_GATEWAY_PUBLIC_URL', `wss://localhost:${envInt('TTO_GATEWAY_WSS_PORT', 8787)}`),
    verbose: envStr('TTO_GATEWAY_VERBOSE', '0') === '1',
  };
}

/** True when TLS cert/key are both present → WSS is available. */
export function wssAvailable(cfg: GatewayConfig): boolean {
  if (!cfg.tlsCertPath || !cfg.tlsKeyPath) return false;
  return existsSync(cfg.tlsCertPath) && existsSync(cfg.tlsKeyPath);
}

export function loadTls(cfg: GatewayConfig): { key: Buffer; cert: Buffer } | null {
  if (!cfg.tlsCertPath || !cfg.tlsKeyPath) return null;
  try {
    return {
      key: readFileSync(cfg.tlsKeyPath),
      cert: readFileSync(cfg.tlsCertPath),
    };
  } catch {
    return null;
  }
}

/** Redact a string for logging — never reveal secrets/tokens. */
export function redacted(v: string | undefined | null): string {
  if (!v) return '(unset)';
  if (v.length <= 8) return '••••';
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}