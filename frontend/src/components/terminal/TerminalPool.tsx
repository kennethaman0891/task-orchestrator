'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { isLightTheme } from '@/lib/theme';
import { isTauri as checkTauri, tauri } from '@/lib/tauri';
import { TerminalManager } from '@/terminal/TerminalManager';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { patchXtermDecrqm } from '@/terminal/xtermPatches';


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
  const isLight = isLightTheme(t);
  const isSystemTerminal = t.name === 'System Terminal';

  if (isSystemTerminal) {
    return {
      background: isLight ? '#ffffff' : '#000000',
      foreground: isLight ? '#000000' : '#f5f5f7',
      cursor: isLight ? '#000000' : '#00ff00',
      selectionBackground: isLight ? 'rgba(0,122,255,0.25)' : 'rgba(0,122,255,0.35)',
      // macOS / System Terminal ANSI 0–7 (standard)
      black: '#000000',
      red: '#c91b00',
      green: '#00c200',
      yellow: '#c7c400',
      blue: '#0225c7',
      magenta: '#c930c7',
      cyan: '#00c5c7',
      white: isLight ? '#202020' : '#c7c7c7',
      // ANSI 8–15 (bright)
      brightBlack: '#686868',
      brightRed: '#ff6d67',
      brightGreen: '#5ff967',
      brightYellow: '#fefb67',
      brightBlue: '#6871ff',
      brightMagenta: '#ff76ff',
      brightCyan: '#5ffdff',
      brightWhite: '#ffffff',
    };
  }

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

  const latestSessionIdsRef = useRef(new Set<string>(sessionIds));
  latestSessionIdsRef.current = new Set(sessionIds);

  const pruneTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const effectRunIdRef = useRef(0);

  // Clean up pending prune timers on component unmount
  useEffect(() => {
    return () => {
      for (const timer of pruneTimersRef.current.values()) {
        clearTimeout(timer);
      }
      pruneTimersRef.current.clear();
      creatingRef.current.clear();
    };
  }, []);

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
    const runId = ++effectRunIdRef.current;

    // Publish the pool root so TerminalAnchor's park() can re-parent hosts
    // back here (previous park() only restyled the host but left it orphaned
    // in a removed DOM subtree → disconnected → fitNow bails → blank).
    TerminalManager.setPoolRoot(containerRef.current);

    const currentIds = new Set(sessionIds);
    latestSessionIdsRef.current = currentIds;
    console.log('[TerminalPool] Effect running, sessionIds:', Array.from(currentIds));

    // Cancel any pending prune timers for sessions that are present
    for (const sid of currentIds) {
      const timer = pruneTimersRef.current.get(sid);
      if (timer) {
        clearTimeout(timer);
        pruneTimersRef.current.delete(sid);
      }
      const resolved = TerminalManager.resolveSessionId(sid);
      if (resolved && resolved !== sid) {
        const rTimer = pruneTimersRef.current.get(resolved);
        if (rTimer) {
          clearTimeout(rTimer);
          pruneTimersRef.current.delete(resolved);
        }
      }
    }

    // Create terminals for new sessions — with error handling
    (async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { Unicode11Addon } = await import('@xterm/addon-unicode11');
        // Canvas draws block and box glyphs with fillRect, so logo pixels
        // meet. Import failure keeps the DOM renderer (open() creates it
        // only when no addon renderer registered during onWillOpen).
        let CanvasAddon: typeof import('@xterm/addon-canvas').CanvasAddon | null = null;
        try {
          CanvasAddon = (await import('@xterm/addon-canvas')).CanvasAddon;
        } catch (e) {
          console.warn('[TerminalPool] CanvasAddon unavailable, DOM renderer will be used:', e);
        }

        for (const sessionId of currentIds) {
          if (effectRunIdRef.current !== runId || !containerRef.current || !mountedRef.current) {
            console.log(`[TerminalPool] Container gone or unmounted, stopping`);
            break;
          }
          if (TerminalManager.has(sessionId)) {
            continue;
          }
          if (creatingRef.current.has(sessionId)) {
            continue;
          }

          creatingRef.current.add(sessionId);
          try {
            // Yield to browser event loop so UI and WindowServer remain 100% responsive during creation
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (effectRunIdRef.current !== runId || !containerRef.current || !mountedRef.current) break;

            if (TerminalManager.has(sessionId)) {
              continue;
            }

            // Use latest theme from ref
            const t = themeRef.current;
            const term = new Terminal({
              fontFamily: t.fontFamily.mono,
              fontSize: 13,
              // 1.0 is xterm's own default. 1.15 left empty leading around
              // Menlo's block glyphs, so splash logos painted as gapped bricks.
              lineHeight: 1,
              cursorBlink: false,
              cursorStyle: 'block',
              scrollback: 2000,
              allowProposedApi: true,
              cols: 120,
              rows: 40,
              theme: buildXtermTheme(t),
              disableStdin: false,
              allowTransparency: false,
              drawBoldTextInBrightColors: true,
              // Fills ▀▄█ and box-drawing as cell rectangles. Ignored on the
              // DOM renderer; the canvas addon below is what honors it.
              customGlyphs: true,
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

            // Load before open(). Terminal.open() skips the DOM renderer when
            // a canvas renderer is already registered from onWillOpen. Loading
            // after open leaves the DOM row layer in place under the canvas.
            if (CanvasAddon) {
              try {
                term.loadAddon(new CanvasAddon());
              } catch (e) {
                console.warn(`[TerminalPool] CanvasAddon load failed for ${sessionId}, DOM renderer will be used:`, e);
              }
            }

            term.open(host);
            patchXtermDecrqm(term);

            if (host.querySelector('canvas.xterm-text-layer')) {
              host.dataset.ttoRenderer = 'canvas';
              host.classList.add('oc-canvas');
            } else {
              host.dataset.ttoRenderer = 'dom';
              console.warn(`[TerminalPool] Canvas renderer did not attach for ${sessionId}; DOM fallback is active`);
            }

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
          } catch (itemErr) {
            console.error(`[TerminalPool] Failed to create terminal for ${sessionId}:`, itemErr);
          } finally {
            creatingRef.current.delete(sessionId);
          }
        }
        console.log('[TerminalPool] IIFE loop complete');
      } catch (err) {
        console.error('[TerminalPool] IIFE FAILED:', err);
      }
    })();

    // Cleanup: remove terminals that are no longer in sessionIds
    // Safeguard: If currentIds is empty and we have existing handles, DO NOT immediately destroy all terminals.
    // This protects against empty flashes during boot or workspace transitions.
    if (currentIds.size === 0) {
      if (TerminalManager.all().length > 0) {
        console.log(`[TerminalPool] sessionIds flashed empty (${TerminalManager.all().length} handles preserved)`);
      }
    } else {
      for (const handle of TerminalManager.all()) {
        const sid = handle.sessionId;
        const isPresent =
          currentIds.has(sid) ||
          (handle.tty && currentIds.has(handle.tty)) ||
          currentIds.has(TerminalManager.resolveSessionId(sid));

        if (!isPresent) {
          if (!pruneTimersRef.current.has(sid)) {
            const timer = setTimeout(() => {
              pruneTimersRef.current.delete(sid);
              // Verify again that sessionIds is non-empty and the session is truly still absent
              const latest = latestSessionIdsRef.current;
              const stillPresent =
                latest.has(sid) ||
                (handle.tty && latest.has(handle.tty)) ||
                latest.has(TerminalManager.resolveSessionId(sid));

              if (latest.size > 0 && !stillPresent) {
                console.log(`[TerminalPool] Pruning absent session ${sid} after grace period`);
                const h = TerminalManager.get(sid);
                if (h) {
                  const host = h.host;
                  const resizeDisp = (host as any).__ttoResizeDisposable;
                  if (resizeDisp) {
                    try { resizeDisp.dispose(); } catch {}
                  }
                  try { host.remove(); } catch {}
                  TerminalManager.unregister(sid);
                }
              }
            }, 1000);
            pruneTimersRef.current.set(sid, timer);
          }
        }
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
        if (!TerminalManager.isParked(h.sessionId)) {
          TerminalManager.fitNow(h.sessionId);
        }
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
export interface TerminalAnchorProps {
  sessionId: string;
  className?: string;
  style?: React.CSSProperties;
}

export function TerminalAnchor({ sessionId, className, style }: TerminalAnchorProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const [tuiActive, setTuiActive] = useState(() => TerminalManager.isTui(sessionId));

  useEffect(() => {
    const handle = TerminalManager.get(sessionId);
    if (handle) {
      setTuiActive(handle.tuiActive);
      const prevCb = handle.onTuiChange;
      handle.onTuiChange = (active) => {
        setTuiActive(active);
        prevCb?.(active);
      };
      return () => {
        handle.onTuiChange = prevCb;
      };
    }
  }, [sessionId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId) return;
    attachedRef.current = false;

    let disposed = false;
    let teardownEvents: (() => void) | null = null;

    /** Park the host back in the hidden pool — only if WE still own it. */
    const park = () => {
      try {
        if (!TerminalManager.isOwnedBy(sessionId, container)) return;
        const handle = TerminalManager.get(sessionId);
        if (handle) {
          try {
            handle.term.options.cursorBlink = false;
          } catch {}
        }
        TerminalManager.park(sessionId);
      } catch (e) {
        console.error(`[TerminalAnchor] Failed to park ${sessionId}:`, e);
      }
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
      try {
        handle.host.style.cssText = ANCHOR_HOST_STYLE;
        if (handle.host.parentElement !== container) {
          container.appendChild(handle.host);
        }
        if (handle.host.dataset.ttoRenderer === 'canvas' || handle.host.classList.contains('oc-canvas')) {
          container.classList.add('oc-canvas');
        }
      } catch (e) {
        console.error(`[TerminalAnchor] Failed to reparent host for ${sessionId}:`, e);
        attachedRef.current = false;
        return;
      }

      setTuiActive(handle.tuiActive);

      TerminalManager.setVisible(sessionId, true);
      // Attach never marks focus. Focus is exclusive and is set only when
      // the user selects this card (GridView / IDEView call TerminalManager.focus).
      try {
        handle.term.options.cursorBlink = false;
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
          } catch {}
        }
      }, 80);

      let lastW = 0;
      let lastH = 0;
      let ro: ResizeObserver | null = null;
      try {
        ro = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry) {
            const cr = entry.contentRect;
            if (Math.abs(cr.width - lastW) < 2 && Math.abs(cr.height - lastH) < 2) {
              return;
            }
            lastW = cr.width;
            lastH = cr.height;
          }
          requestFit();
        });
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
        try { ro?.disconnect(); } catch {}
        try { window.removeEventListener('resize', requestFit); } catch {}
        try { container.removeEventListener('wheel', onWheel); } catch {}
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
      try { unsub(); } catch {}
      clearInterval(pollTimer);
      try { teardownEvents?.(); } catch {}
      park();
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className={`term-pane${tuiActive ? ' tui-active' : ''} ${className || ''}`.trim()}
      onClick={() => {
        const handle = TerminalManager.get(sessionId);
        try {
          if (handle) {
            handle.term.options.cursorBlink = true;
          }
          requestAnimationFrame(() => {
            try {
              handle?.term.focus();
            } catch {}
          });
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
        background: theme.colors.bg.primary,
        ...style,
      }}
    />
  );
}