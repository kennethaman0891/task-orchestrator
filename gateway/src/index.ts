import { loadConfig } from './config.js';
import { openStore } from './store.js';
import { ensureAdminUser } from './auth.js';
import { createGatewayServer } from './server.js';

/**
 * TTO Gateway entry point.
 *
 * Run:  npm run build && npm start
 * Env:  see config.ts / .env.example. In production set TLS cert/key so the
 *       listener is WSS (the phone/web clients connect over wss://).
 */
function main() {
  const cfg = loadConfig();

  if (!cfg.adminPassword) {
    // eslint-disable-next-line no-console
    console.error(
      '[gateway] TTO_GATEWAY_ADMIN_PASSWORD is unset — refusing to start with an empty admin password.',
    );
    process.exit(1);
  }

  const store = openStore(cfg.dbPath);
  ensureAdminUser(store, cfg.adminUsername, cfg.adminPassword);

  // eslint-disable-next-line no-console
  console.log(`[gateway] db: ${cfg.dbPath}`);
  if (cfg.webClientDir) console.log(`[gateway] web client dir: ${cfg.webClientDir}`);
  if (cfg.tlsCertPath && cfg.tlsKeyPath) console.log('[gateway] TLS configured → WSS');
  else console.log('[gateway] WARNING: no TLS configured → plain WS (dev only)');

  const server = createGatewayServer(store, cfg);
  server.start();

  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[gateway] ${signal} — shutting down`);
    server.stop();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();