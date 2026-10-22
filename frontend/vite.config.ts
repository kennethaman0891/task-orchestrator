import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Dev-only shared secret. Set the same value the sidecar was started with
// (TTO_SESSION_TOKEN or VITE_TTO_SESSION_TOKEN). The proxy injects it on
// relative /api and /ws calls. It is not baked into production builds.
function devSessionToken(): string {
  return (process.env.VITE_TTO_SESSION_TOKEN || process.env.TTO_SESSION_TOKEN || '').trim();
}

function injectSession(proxy: { on: (event: string, handler: (...args: any[]) => void) => void }) {
  proxy.on('proxyReq', (proxyReq: { setHeader: (name: string, value: string) => void }) => {
    const token = devSessionToken();
    if (token) proxyReq.setHeader('X-Task-Orchestrator-Token', token);
  });
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: command === 'serve'
    ? { 'import.meta.env.VITE_TTO_SESSION_TOKEN': JSON.stringify(devSessionToken()) }
    : {},
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1421,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        configure: injectSession,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8765',
        ws: true,
        rewrite: (requestPath) => {
          const token = devSessionToken();
          if (!token || requestPath.includes('session_token=')) return requestPath;
          const join = requestPath.includes('?') ? '&' : '?';
          return `${requestPath}${join}session_token=${encodeURIComponent(token)}`;
        },
        configure: injectSession,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
}));
