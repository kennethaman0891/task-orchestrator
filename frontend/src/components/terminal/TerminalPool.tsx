'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { isTauri as checkTauri, tauri } from '@/lib/tauri';
import { TerminalManager } from '@/terminal/TerminalManager';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';


/** Style used when a host div is parked in the hidden pool (never measured). */
const POOL_HOST_STYLE =
  'position:absolute;left:-99999px;top:0;width:800px;height:600px;';

/** Style used when a host div is anchored into a visible container. */
const ANCHOR_HOST_STYLE = 'position:absolute;left:0;top:0;width:100%;height:100%;';

/**
 * Builds the full xterm.js ITheme — including all 16 ANSI palette colors —
 * from the current app Theme. Without these, xterm falls back to its own
 * defaults and every cell renders monochrome.
 */
function buildXtermTheme(t: import('@/lib/theme').Theme) {
  const isLight = t.name === 'Paper';
  return {
    background: t.colors.bg.primary,
    foreground: t.colors.text.primary,
    cursor: t.colors.accent.primary,
    selectionBackground: t.colors.accent.light,
    // ANSI 0–7 (standard)
    black: isLight ? '#1a1a1a' : '#3d3d3d',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: isLight ? '#374151' : '#e4e4e4',
    // ANSI 8–15 (bright)
    brightBlack: isLight ? '#4b5563' : '#6b7280',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: isLight ? '#111827' : '#ffffff',
  };
}

interface PoolProps {
  sessionIds: string[];
}

/**
 * TerminalPool — renders hidden xterm instances, one per session.
 * Each xterm is wired to Tauri via TerminalManager (attach/write/resize).
 * Views use TerminalAnchor to position visible terminals.
 *
 * Anti-patterns fixed:
 *  - No blind `setInterval(fit)` — fitting is event-driven (ResizeObserver in
 *    TerminalAnchor) + TUI-transition driven (global poll below) + ownership
 *    guarded so parked (hidden pool) hosts are NEVER measured. Previously the
 *    pool resized every terminal to the 800x600 pool every 2s, firing
 *    SIGWINCH at TUIs (opencode/vim) and thrashing their layout.
 */
export function TerminalPool({ sessionIds }: PoolProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const creatingRef = useRef(new Set<string>());
  // Capture latest theme without re-running the main creation effect
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Update theme on all existing terminals when theme changes (no recreation)
  useEffect(() => {
    for (const handle of TerminalManager.all()) {
      try {
        handle.term.options.theme = buildXtermTheme(theme);
        handle.term.options.fontFamily = theme.fontFamily.mono;
      } catch {}
    }
  }, [theme]);

  useEffect(() => {
    if (!checkTauri() || !containerRef.current) {
      console.log('[TerminalPool] Skipping: isTauri=', checkTauri(), 'container=', !!containerRef.current);
      return;
    }
    mountedRef.current = true;
    // Publish the pool root so TerminalAnchor's park() can re-parent hosts
    // back here (previous park() only restyled the host but left it orphaned
    // in a removed DOM subtree → disconnected → fitNow bails → blank).
    TerminalManager.setPoolRoot(containerRef.current);

    const currentIds = new Set(sessionIds);
    console.log('[TerminalPool] Effect running, sessionIds:', Array.from(currentIds));

    // Create terminals for new sessions — with error handling
    (async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { Unicode11Addon } = await import('@xterm/addon-unicode11');

        let createdCount = 0;
        for (const sessionId of currentIds) {
          if (TerminalManager.has(sessionId)) {
            continue;
          }
          if (creatingRef.current.has(sessionId)) {
            continue;
          }
          if (!containerRef.current || !mountedRef.current) {
            console.log(`[TerminalPool] Container gone or unmounted, stopping`);
            continue;
          }

          creatingRef.current.add(sessionId);
          createdCount++;
          // Yield to browser event loop every 4 terminals so UI remains 100% responsive during bulk creation
          if (createdCount % 4 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (!containerRef.current || !mountedRef.current) break;
          }

          // Use latest theme from ref
          const t = themeRef.current;
          const term = new Terminal({
            fontFamily: t.fontFamily.mono,
            fontSize: 13,
            lineHeight: 1.0,
            cursorBlink: true,
            cursorStyle: 'bar',
            // Moderate scrollback (5,000 lines = ~150 screens) keeps RAM light with 100-200 terminals
            scrollback: 5000,
            allowProposedApi: true,
            cols: 80,
            rows: 25,
            theme: buildXtermTheme(t),
            // TUI/Full-screen app support (Claude Code, vim, htop, etc.)
            convertEol: true,
            macOptionIsMeta: true,
            minimumContrastRatio: 1,
            disableStdin: false,
            allowTransparency: true,
            drawBoldTextInBrightColors: true,
          });

          const fitAddon = new FitAddon();
          term.loadAddon(fitAddon);
          term.loadAddon(
            new WebLinksAddon((event, uri) => {
              event.preventDefault();
              console.log('[TerminalPool] Opening link:', uri);
              tauri.openUrl(uri).catch((err) => {
                console.error('[TerminalPool] Failed to open link:', uri, err);
              });
            })
          );

          // Create host div, parked off-screen until an anchor claims it
          const host = document.createElement('div');
          host.style.cssText = POOL_HOST_STYLE;
          containerRef.current.appendChild(host);

          term.open(host);

          // Use DOM renderer for all terminals to ensure proper ANSI color rendering.
          // CanvasAddon has known issues with color rendering in some environments.

          // Unicode 11 addon for accurate glyph widths
          try {
            const unicode11Addon = new Unicode11Addon();
            term.loadAddon(unicode11Addon);
            term.unicode.activeVersion = '11';
          } catch (e) {
            console.warn(`[TerminalPool] Unicode11Addon failed for ${sessionId}:`, e);
          }

          // Wire keyboard input → PTY
          term.onData((data) => {
            TerminalManager.write(sessionId, data);
          });

          // Register with TerminalManager
          TerminalManager.register({ sessionId, term, host });
          console.log(`[TerminalPool] Registered ${sessionId} with TerminalManager`);

          // Attach to PTY output stream
          TerminalManager.attachToPty(sessionId, () => {
            // Shell exited — show exit indicator in xterm
            term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
          }).then(() => {
            console.log(`[TerminalPool] attachToPty resolved for ${sessionId}`);
          }).catch((err) => {
            console.error(`[TerminalPool] attachToPty FAILED for ${sessionId}:`, err);
          });

          // Wire resize: xterm geometry change → PTY SIGWINCH (fit-driven)
          const resizeDisposable = term.onResize(({ cols, rows }) => {
            TerminalManager.resize(sessionId, cols, rows);
          });
          (host as any).__ttoFitAddon = fitAddon;
          (host as any).__ttoResizeDisposable = resizeDisposable;

          console.log(`[TerminalPool] Terminal ${sessionId} fully created and registered`);
        }
        console.log('[TerminalPool] IIFE loop complete');
      } catch (err) {
        console.error('[TerminalPool] IIFE FAILED:', err);
      }
    })();

    // Cleanup: remove terminals that are no longer in sessionIds
    for (const handle of TerminalManager.all()) {
      if (!currentIds.has(handle.sessionId)) {
        const host = handle.host;
        const resizeDisp = (host as any).__ttoResizeDisposable;
        if (resizeDisp) resizeDisp.dispose();
        host.remove();
        TerminalManager.unregister(handle.sessionId);
      }
    }

    // ── Global TUI poll (1s) ─────────────────────────────────────────────
    // Detects alternate-screen transitions (opencode/vim/htop) so Rust's
    // scheduler knows the presentation context, and safety-net-fits only
    // VISIBLE hosts. xterm's fit() no-ops when dimensions are unchanged, so
    // this cannot cause a SIGWINCH resize loop.
    const tuiPoll = setInterval(() => {
      if (!mountedRef.current) return;
      for (const handle of TerminalManager.all()) {
        let tuiActive = false;
        try {
          tuiActive =
            !!handle.term.buffer.active &&
            handle.term.buffer.active !== handle.term.buffer.normal;
        } catch {}
        if (tuiActive !== handle.tuiActive) {
          TerminalManager.setTui(handle.sessionId, tuiActive);
        }
      }
    }, 1000);

    return () => {
      mountedRef.current = false;
      clearInterval(tuiPoll);
    };
  }, [sessionIds]); // theme handled by separate effect above

  // Expose TerminalManager globally for debugging
  useEffect(() => {
    (window as any).__ttoTerminalManager = TerminalManager;
    // Per-terminal diagnostics for stuck-terminal investigations:
    //   (window as any).__ttoDiag()
    // returns queued bytes/chunks, last-output age, TUI alt-screen state,
    // parked/connected/attached flags for every xterm handle.
    (window as any).__ttoDiag = () => TerminalManager.diag();
  }, []);

  // ── Repaint nudge on return from background ─────────────────────────
  // WebKit throttles rAF/canvas while the app is backgrounded (Space
  // switch, Mission Control, another app on top). xterm's renderer layer
  // can sit on a stale frame while its buffer keeps updating — the classic
  // "OpenCode UI looks stuck" symptom. Nothing repaints on return unless
  // the user switches terminals or resizes. On visibility/focus return we
  // nudge every attached terminal: pure repaint (refresh + scrollToBottom)
  // plus a guarded fit. Zero PTY impact — no write, no SIGWINCH.
  useEffect(() => {
    let lastNudgeAt = 0;
    const nudge = (source: string) => {
      const now = Date.now();
      if (now - lastNudgeAt < 500) return; // coalesce focus+visibility bursts
      lastNudgeAt = now;
      // Guarded fit first (no-op when geometry unchanged → no SIGWINCH),
      // then a pure-repaint nudge on every attached terminal.
      for (const h of TerminalManager.all()) {
        if (h.host.isConnected) TerminalManager.fitNow(h.sessionId);
      }
      const count = TerminalManager.nudgeAll();
      if (count > 0) {
        console.log(`[TerminalPool] repaint nudge (${source}): ${count} attached terminals refreshed`);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') nudge('visibilitychange');
    };
    const onFocus = () => nudge('window focus');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: '-99999px',
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

/**
 * TerminalAnchor — positions an xterm from the pool into a visible container.
 *
 * Fitting is EVENT-DRIVEN, never timer-driven:
 *  - A `ResizeObserver` on the container fires when the flex layout changes
 *    the terminal area (window resize, split toggles, sidebar collapse).
 *  - A `window` resize listener is a belt-and-braces fallback for webviews
 *    that don't reflow the flex container on zoom/CSS-pixel changes.
 *  - Callbacks are requestAnimationFrame-debounced so a burst of resize
 *    events coalesces into exactly one fit with the final geometry.
 * Every fit is ownership-guarded via `TerminalManager.fitNow` / `isOwnedBy`,
 * so a stale observer can never resize a terminal that a different anchor
 * (or the hidden pool) currently owns.
 */
export function TerminalAnchor({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId) return;
    attachedRef.current = false;

    let disposed = false;
    let teardownEvents: (() => void) | null = null;

    /** Park the host back in the hidden pool — only if WE still own it. */
    const park = () => {
      if (!TerminalManager.isOwnedBy(sessionId, container)) return;
      TerminalManager.park(sessionId);
    };

    /** rAF-debounced fit request (ResizeObserver can fire in bursts). */
    const requestFit = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (!disposed && attachedRef.current) {
          TerminalManager.fitNow(sessionId);
          const handle = TerminalManager.get(sessionId);
          try {
            handle?.term.refresh(0, Math.max(0, (handle.term.rows || 1) - 1));
          } catch {}
        }
      });
    };

    /** Move the host into this anchor and subscribe to size events. */
    const attach = () => {
      if (attachedRef.current || disposed) return;
      const handle = TerminalManager.get(sessionId);
      if (!handle) return;
      attachedRef.current = true;

      console.log(`[TerminalAnchor] Found handle for ${sessionId}, moving host into anchor`);
      handle.host.style.cssText = ANCHOR_HOST_STYLE;
      container.appendChild(handle.host);

      TerminalManager.setVisible(sessionId, true);
      TerminalManager.setFocus(sessionId, true);

      // Focus the terminal instance so user input is accepted immediately
      try {
        handle.term.focus();
      } catch {}

      // Immediately repaint buffer onto canvas after DOM reparenting (WebKit canvas context restore)
      try {
        handle.term.refresh(0, Math.max(0, handle.term.rows - 1));
        handle.term.scrollToBottom();
      } catch {}

      // First fit on the next frame (container has layout by then); the
      // ResizeObserver keeps it correct afterwards.
      requestFit();

      // Delayed fit guarantees geometry stabilizes if dock animated or mounted in background
      const stabilizeTimer = setTimeout(() => {
        if (!disposed && attachedRef.current) {
          TerminalManager.fitNow(sessionId);
          try {
            handle.term.refresh(0, Math.max(0, handle.term.rows - 1));
            handle.term.scrollToBottom();
          } catch {}
        }
      }, 80);

      let ro: ResizeObserver | null = null;
      try {
        ro = new ResizeObserver(requestFit);
        ro.observe(container);
      } catch {
        // ResizeObserver unavailable (very old webview) — the window resize
        // listener below still covers the main case.
      }
      window.addEventListener('resize', requestFit);

      const onWheel = (e: WheelEvent) => {
        // Prevent terminal history scroll from bubbling up and displacing/scrolling outer grid or workspace view
        e.stopPropagation();
      };
      container.addEventListener('wheel', onWheel, { passive: true });

      teardownEvents = () => {
        clearTimeout(stabilizeTimer);
        ro?.disconnect();
        window.removeEventListener('resize', requestFit);
        container.removeEventListener('wheel', onWheel);
        ro = null;
      };
      console.log(`[TerminalAnchor] Attached and visible: ${sessionId}`);
    };

    attach();

    // Handle not registered yet — subscribe to registrations + poll.
    const unsub = TerminalManager.onRegister((id) => {
      if (id === sessionId) attach();
    });
    const pollTimer = setInterval(() => {
      if (!attachedRef.current && !disposed) attach();
    }, 500);

    return () => {
      disposed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      unsub();
      clearInterval(pollTimer);
      teardownEvents?.();
      park();
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      onWheel={(e) => {
        // React synthetic wheel event barrier
        e.stopPropagation();
      }}
      onClick={() => {
        const handle = TerminalManager.get(sessionId);
        try {
          handle?.term.focus();
        } catch {}
      }}
      style={{
        position: 'relative',
        flex: 1,
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        overscrollBehavior: 'contain',
        background: '#0a0a0a',
      }}
    />
  );
}