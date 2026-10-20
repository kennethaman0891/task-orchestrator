import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App';
import { BrowserShell } from './components/BrowserShell';
import { ThemeProvider } from './contexts/ThemeContext';
import { IntroVideo } from './components/IntroVideo';
// xterm.js's own stylesheet. CRITICAL and easy to miss: Vite does not honour
// the package's `"style": "css/xterm.css"` field, so it must be imported
// explicitly. Without it the `.xterm-helpers` layer stays `position:static`
// instead of `position:absolute` and its inner `.xterm-helper-textarea`
// (opacity:0 by default) renders as a plain bordered browser <textarea> — a
// stray box drawn directly above the shell prompt in every terminal.
import '@xterm/xterm/css/xterm.css';
import './styles.css';
// Dedicated OpenCode CLI stylesheet — scoped to [data-agent="opencode"] only;
// imported SEPARATELY from styles.css (per requirement: never touch styles.css
// for OpenCode fixes).
import './opencode.css';
// OpenDots CallView styles — scoped to .call-view only
import '@/opendots/styles/call-view.css';

// ---- Diagnostic: capture errors so we can see why the page is blank ----
// NOTE: diagnostic posts go to the sidecar's default port; they are
// best-effort and never block rendering when the sidecar is on the fallback
// port or not yet up.
try {
  const diagPost = (payload: Record<string, unknown>) => {
    fetch('http://127.0.0.1:8765/api/diag-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };
  const origError = console.error;
  (console as any).error = (...args: any[]) => {
    try {
      diagPost({ source: 'console.error', args: args.map(String) });
    } catch {}
    origError.apply(console, args);
  };

  // Also capture console.log, but ONLY lines carrying one of these prefixes,
  // and rate-limited per prefix. The webview console is not forwarded to the
  // Rust stdout, so without this every frontend trace is invisible and a broken
  // terminal looks identical to a working one.
  const LOG_TAGS = [
    '[TerminalManager]',
    '[TerminalPool]',
    '[TerminalAnchor]',
    '[App]',
    '[MANAGER]',
  ];
  const logBudget = new Map<string, number>();
  const origLog = console.log;
  (console as any).log = (...args: any[]) => {
    try {
      const text = args.map(String).join(' ');
      const tag = LOG_TAGS.find((t) => text.includes(t));
      if (tag) {
        // Budget PER MESSAGE SIGNATURE (digits normalised), not per tag — a
        // chatty tag like [TerminalManager] would otherwise exhaust the cap
        // and silently swallow the lines that actually matter.
        const sig = `${tag}:${text.replace(/\d+/g, '#').slice(0, 60)}`;
        const seen = logBudget.get(sig) ?? 0;
        if (seen < 6) {
          logBudget.set(sig, seen + 1);
          // The diag sink reads `message` (or `args`) — `text` is ignored.
          diagPost({ source: 'console.log', tag, message: text.slice(0, 500) });
        }
      }
    } catch {}
    origLog.apply(console, args);
  };

  window.addEventListener('error', (e) => {
    try {
      diagPost({
        source: 'window.error',
        message: e.message,
        stack: e.error?.stack || '',
      });
    } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      diagPost({ source: 'unhandledrejection', reason: String(e.reason) });
    } catch {}
  });
  // Also log successful boot (retry a few times — the sidecar may still be
  // starting when the page first loads, and the boot line is our key signal
  // that the webview rendered instead of showing a blank screen).
  const postBoot = (attempt: number) => {
    fetch('http://127.0.0.1:8765/api/diag-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'boot', message: 'main.tsx loaded, mounting React' }),
    }).catch(() => {
      if (attempt < 5) setTimeout(() => postBoot(attempt + 1), 800 * (attempt + 1));
    });
  };
  postBoot(0);

} catch {}

// Nuke any legacy PWA service worker (removed in v1.5): it served stale cached
// CSS/JS that made the dashboard look broken after updates.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      regs.forEach((r) => r.unregister());
    })
    .catch(() => {});
}

// The "real browser" pop-out window loads this same bundle with
// ?tto-shell=1&url=… — render the branded browser shell instead of the app.
function Root() {
  const isBrowserShell = new URLSearchParams(window.location.search).get('tto-shell') === '1';
  // Show intro video on first launch (unless reduced motion or browser shell)
  const [showIntro, setShowIntro] = useState(!isBrowserShell);

  return (
    <ThemeProvider>
      {showIntro ? (
        <IntroVideo onComplete={() => setShowIntro(false)} />
      ) : isBrowserShell ? (
        <BrowserShell />
      ) : (
        <App />
      )}
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
