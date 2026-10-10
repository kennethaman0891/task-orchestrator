import { useCallback, useEffect, useRef, useState } from 'react';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import './BrowserShell.css';

/**
 * Height (logical px) of the branded header bar. The child webview starts
 * right below it, so the remote site never overlaps the logo/title bar.
 */
const HEADER_H = 40;

function parseTarget(): string {
  try {
    return new URLSearchParams(window.location.search).get('url') || '';
  } catch {
    return '';
  }
}

/** Add a scheme when the user types a bare domain ("google.com"). */
function normalizeInputUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(t)) return 'http://' + t;
  return 'https://' + t;
}

/**
 * Branded shell for the "real browser" pop-out window.
 *
 * The window loads this shell page (through the native asset protocol — no
 * proxy, no X-Frame-Options issues), which renders a title bar with the TTO
 * logo + an EDITABLE address field and spawns a CHILD webview (positioned
 * below the bar) that loads the real site natively. Clicking the address,
 * typing a new URL and pressing Enter re-navigates by recreating the child
 * webview at the new target. Logins, downloads and JS-heavy apps behave
 * exactly like a real browser — only the chrome around the page is ours.
 *
 * Native macOS traffic lights are kept via `titleBarStyle: 'overlay'` +
 * `hiddenTitle` (set by the caller).
 */
export function BrowserShell() {
  const [targetUrl, setTargetUrl] = useState(parseTarget());
  const [loadState, setLoadState] = useState<'creating' | 'ready' | 'error'>('creating');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const childRef = useRef<Webview | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = targetUrl ? `Task Orchestrator Browser — ${targetUrl}` : 'Task Orchestrator Browser';
  }, [targetUrl]);

  // (Re)create the child webview whenever the target URL changes — including
  // the first mount and every address-bar navigation.
  useEffect(() => {
    if (!targetUrl) {
      setLoadState('error');
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let child: Webview | null = null;

    (async () => {
      try {
        const win = getCurrentWindow();
        const sf = await win.scaleFactor();
        const size = (await win.innerSize()).toLogical(sf);

        child = new Webview(win, `tto-child-${Date.now()}`, {
          url: targetUrl,
          x: 0,
          y: HEADER_H,
          width: size.width,
          height: Math.max(200, size.height - HEADER_H),
        });
        childRef.current = child;

        child.once('tauri://created', () => {
          if (disposed) return;
          setLoadState('ready');
          child?.setFocus().catch(() => {});
        });
        child.once('tauri://error', (e) => {
          console.error('BrowserShell: child webview failed:', e);
          if (!disposed) setLoadState('error');
        });

        // Keep the child webview pinned below the header as the window resizes.
        unlisten = await win.onResized(async ({ payload }) => {
          if (!child || disposed) return;
          try {
            const sfNow = await win.scaleFactor();
            const s = payload.toLogical(sfNow);
            await child.setSize(new LogicalSize(s.width, Math.max(200, s.height - HEADER_H)));
            await child.setPosition(new LogicalPosition(0, HEADER_H));
          } catch {
            /* resizing is best-effort; the webview may be gone */
          }
        });
      } catch (err) {
        console.error('BrowserShell: could not create child webview:', err);
        if (!disposed) setLoadState('error');
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      childRef.current = null;
      // Tear down the previous child when navigating (or unmounting).
      child?.close().catch(() => {});
    };
  }, [targetUrl]);

  const displayUrl = (() => {
    try {
      const u = new URL(targetUrl);
      return u.host + u.pathname + u.search;
    } catch {
      return targetUrl;
    }
  })();

  // ── Editable address ───────────────────────────────────────────────────
  const startEdit = useCallback(() => {
    setDraft(targetUrl);
    setEditing(true);
    window.setTimeout(() => {
      editRef.current?.focus();
      editRef.current?.select();
    }, 10);
  }, [targetUrl]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const next = normalizeInputUrl(draft);
    if (!next || next === targetUrl) return;
    setLoadState('creating');
    setTargetUrl(next);
  }, [draft, targetUrl]);

  // Open the native Web Inspector for the CHILD webview (the remote page),
  // not this shell document. Works in release builds (devtools cargo feature).
  const openInspect = useCallback(async () => {
    try {
      const label = childRef.current?.label;
      if (!label) return;
      await invoke('plugin:webview|internal_toggle_devtools', { label });
    } catch (err) {
      console.error('inspect failed:', err);
    }
  }, []);

  return (
    <div className="bshell">
      <header className="bshell-bar" data-tauri-drag-region>
        {editing ? (
          <form
            className="bshell-url-form"
            onSubmit={(e) => {
              e.preventDefault();
              commitEdit();
            }}
          >
            <input
              ref={editRef}
              className="bshell-url-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitEdit}
              spellCheck={false}
              placeholder="Type a URL and press Enter…"
            />
          </form>
        ) : (
          <button
            type="button"
            className="bshell-title"
            onClick={startEdit}
            title="Click to edit the address"
          >
            {targetUrl ? `Browser — ${displayUrl}` : 'Task Orchestrator Browser'}
          </button>
        )}
        <button type="button" className="bshell-inspect" onClick={openInspect} title="Open Web Inspector for this page">
          Inspect
        </button>
        <div className="bshell-brand" data-tauri-drag-region>
          <img src="/desktop-icon.png" alt="Task Orchestrator" className="bshell-logo" draggable={false} />
          <span className="bshell-word">Task Orchestrator</span>
        </div>
      </header>
      <div className="bshell-body">
        {loadState === 'creating' && (
          <div className="bshell-loading">
            <div className="bshell-spinner" />
            <span>{targetUrl ? `Opening ${displayUrl}…` : 'Preparing browser…'}</span>
          </div>
        )}
        {loadState === 'error' && (
          <div className="bshell-error">
            <div className="bshell-error-icon">🌐</div>
            <h3>Could not open the browser window</h3>
            <p>
              {targetUrl
                ? `The page could not be loaded in a native webview.`
                : 'No URL was provided. Click the address bar above to enter one.'}
            </p>
            {!targetUrl && (
              <button type="button" className="bshell-inspect" onClick={startEdit}>
                Enter a URL
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
