// TerminalManager — owns persistent per-session xterm instances (the "pool").
// Views render TerminalAnchor that reposition the host div. Input, resize,
// attach, scrollback-replay, and synchronized-output filters all live here.
// `tauri.attach()` is the ONLY source of terminal streaming.

import type { Terminal } from '@xterm/xterm';
import { WriteQueue } from './writeQueue';
import { SynchronizedOutputFilter } from './synchronizedOutputFilter';

function menuKeystrokes(value: string, opts: { enter: boolean }): string[] {
  if (value.toLowerCase() === 'escape') return ['\x1b'];
  return opts.enter ? [value, '\r'] : [value];
}

/** Whole-window device pixels for TIOCSWINSZ. 0 means the cell grid is not measured yet. */
function ptyPixelSize(term: Terminal, cols: number, rows: number): { pixelWidth: number; pixelHeight: number } {
  const none = { pixelWidth: 0, pixelHeight: 0 };
  try {
    const cell = (term as any)._core?._renderService?.dimensions?.css?.cell as
      | { width?: number; height?: number }
      | undefined;
    const w = Number(cell?.width);
    const h = Number(cell?.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return none;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    return {
      pixelWidth: Math.min(65535, Math.max(0, Math.round(cols * w * dpr))),
      pixelHeight: Math.min(65535, Math.max(0, Math.round(rows * h * dpr))),
    };
  } catch {
    return none;
  }
}

interface Handle {
  sessionId: string;
  tty?: string;
  term: Terminal;
  host: HTMLDivElement;
  queue: WriteQueue;
  attached: boolean;
  fit: () => void;
  onExit?: () => void;
  /** Unix ms of when this session handle was created. */
  createdAt: number;
  /** Unix ms of the most recent terminal output delivered to xterm. */
  lastOutputAt: number;
  /** Unix ms of when the active working turn started. */
  workStartedAt: number;
  /** Unix ms of when work completed/ended. */
  workEndedAt: number;
  /** Whether the session is currently in an alternate-screen TUI. */
  tuiActive: boolean;
  /** Fires on TUI transitions — used for auto-expand layout. */
  onTuiChange?: (active: boolean) => void;
}

// Cached Tauri IPC references (imported once, reused for every write/resize/etc.)
let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<any>) | null = null;
let _Channel: (new (...args: any[]) => any) | null = null;
/** Currently PTY-focused session — at most one. */
let _focusedId: string | null = null;
/** lastLines cache: conceptually `${id}:${n}:${lastOutputAt}`; dropped when lastOutputAt changes. */
const _lastLinesCache = new Map<string, { lastOutputAt: number; byN: Map<number, string[]> }>();

/** Park style — the host is hidden off-screen until an anchor claims it. */
const POOL_HOST_STYLE =
  'position:absolute;left:-99999px;top:0;width:800px;height:600px;';

async function ensureTauri() {
  if (_invoke) return;
  const mod = await import('@tauri-apps/api/core');
  _invoke = mod.invoke;
  _Channel = mod.Channel;
  console.log('[TerminalManager] Tauri IPC initialized');
}

function cachedInvoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
  if (!_invoke) throw new Error('Tauri not initialized');
  return _invoke(cmd, args);
}

export const TerminalManager = {
  handles: new Map<string, Handle>(),
  handlesByTty: new Map<string, Handle>(),
  registered: [] as string[],
  // Pool container: TerminalPool publishes its hidden div here so park() can
  // re-parent hosts back into it (the previous park() only restyled the host
  // but left it orphaned in a removed DOM subtree → isConnected=false → blank).
  _poolRoot: null as HTMLElement | null,
  setPoolRoot(el: HTMLElement): void { TerminalManager._poolRoot = el; },
  _resizeTimers: new Map<string, number>(),
  _lastSizes: new Map<string, { cols: number; rows: number; pixelWidth: number; pixelHeight: number }>(),
  _outputListeners: new Map<string, Set<() => void>>(),
  _syncFilters: new Map<string, SynchronizedOutputFilter>(),
  _writeQueues: new Map<string, Promise<void>>(),
  _attachPromises: new Map<string, Promise<void>>(),
  _writeTimeoutMs: 2000,

  /** Test hook to inject mock Tauri IPC */
  _setIpcForTesting(invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<any>) | null, channel?: (new (...args: any[]) => any) | null): void {
    _invoke = invoke;
    if (channel !== undefined) _Channel = channel;
  },

  setTty(sessionId: string, tty: string): void {
    const handle = TerminalManager.handles.get(sessionId);
    if (!handle) return;
    const cleanTty = tty.startsWith('/dev/') ? tty.slice(5) : tty;
    handle.tty = cleanTty;
    TerminalManager.handlesByTty.set(cleanTty, handle);
    TerminalManager.handlesByTty.set(tty, handle);
  },

  onOutput(id: string, fn: () => void): () => void {
    let set = TerminalManager._outputListeners.get(id);
    if (!set) {
      set = new Set();
      TerminalManager._outputListeners.set(id, set);
    }
    set.add(fn);
    return () => {
      const s = TerminalManager._outputListeners.get(id);
      s?.delete(fn);
      if (s && s.size === 0) TerminalManager._outputListeners.delete(id);
    };
  },

  _notifyOutput(id: string): void {
    const set = TerminalManager._outputListeners.get(id);
    if (set) {
      for (const fn of set) {
        try { fn(); } catch {}
      }
    }
  },

  /** Resolve canonical session ID from either canonical ID or slave tty without loose substring matching */
  resolveSessionId(id: string): string {
    if (!id) return id;
    if (TerminalManager.handles.has(id)) return id;
    const cleanId = id.startsWith('/dev/') ? id.slice(5) : id;
    const byTty = TerminalManager.handlesByTty.get(id) || TerminalManager.handlesByTty.get(cleanId);
    if (byTty) return byTty.sessionId;
    for (const [key, handle] of TerminalManager.handles.entries()) {
      if (key === id || key === cleanId) return key;
      if (handle.sessionId === id || handle.sessionId === cleanId) return handle.sessionId;
      if (handle.tty && (handle.tty === id || handle.tty === cleanId)) return handle.sessionId;
      const cleanKey = key.startsWith('/dev/') ? key.slice(5) : key;
      if (cleanKey === cleanId) return key;
    }
    return id;
  },

  has(id: string): boolean {
    if (!id) return false;
    const cleanId = id.startsWith('/dev/') ? id.slice(5) : id;
    return (
      TerminalManager.handles.has(id) ||
      TerminalManager.handles.has(cleanId) ||
      TerminalManager.handlesByTty.has(id) ||
      TerminalManager.handlesByTty.has(cleanId) ||
      TerminalManager.handles.has(TerminalManager.resolveSessionId(id))
    );
  },

  register(opts: {
    sessionId: string; tty?: string; term: Terminal; host: HTMLDivElement;
    deliver?: (data: Uint8Array) => void; fit?: () => void; onExit?: () => void;
  }): Handle {
    const existing = TerminalManager.handles.get(opts.sessionId);
    if (existing) {
      existing.host.remove();
      existing.term.dispose();
      if (existing.tty) {
        TerminalManager.handlesByTty.delete(existing.tty);
        TerminalManager.handlesByTty.delete(`/dev/${existing.tty}`);
      }
    }

    const deliverFn = opts.deliver || ((data: Uint8Array, cb?: () => void) => {
      opts.term.write(data, cb);
    });

    const cleanTty = opts.tty ? (opts.tty.startsWith('/dev/') ? opts.tty.slice(5) : opts.tty) : undefined;

    _lastLinesCache.delete(opts.sessionId);

    // Per-handle write completion; WriteQueue stallMs (1500) calls this once if xterm drops the callback.
    let writeDone: (() => void) | null = null;
    const handle: Handle = {
      sessionId: opts.sessionId,
      tty: cleanTty,
      term: opts.term,
      host: opts.host,
      queue: new WriteQueue({
        deliver: (data: Uint8Array, done: () => void) => {
          // Notify chat after xterm has parsed the bytes. Notifying from the
          // PTY channel reads the previous frame and drops the rest of a burst.
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            TerminalManager._notifyOutput(opts.sessionId);
            done();
          };
          writeDone = finish;
          try {
            deliverFn(data, finish);
          } catch {
            finish();
          }
        },
        onStall: () => {
          writeDone?.();
        },
      }),
      attached: false,
      fit: opts.fit || (() => {}),
      onExit: opts.onExit,
      createdAt: Date.now(),
      lastOutputAt: 0,
      workStartedAt: 0,
      workEndedAt: 0,
      tuiActive: false,
      onTuiChange: undefined,
    };
    TerminalManager.handles.set(opts.sessionId, handle);
    if (cleanTty) {
      TerminalManager.handlesByTty.set(cleanTty, handle);
      TerminalManager.handlesByTty.set(`/dev/${cleanTty}`, handle);
    }
    if (!TerminalManager.registered.includes(opts.sessionId)) {
      TerminalManager.registered.push(opts.sessionId);
      TerminalManager._notify(opts.sessionId);
    }
    console.log(`[TerminalManager] Registered session ${opts.sessionId}${cleanTty ? ` (tty=${cleanTty})` : ''}`);
    return handle;
  },

  unregister(id: string): void {
    const resolvedId = TerminalManager.resolveSessionId(id);
    const h = TerminalManager.handles.get(resolvedId) || TerminalManager.handles.get(id) || TerminalManager.handlesByTty.get(id);
    if (h) {
      h.attached = false;
      h.host.remove();
      h.term.dispose();
      if (h.tty) {
        TerminalManager.handlesByTty.delete(h.tty);
        TerminalManager.handlesByTty.delete(`/dev/${h.tty}`);
      }
    }
    TerminalManager.handles.delete(resolvedId);
    TerminalManager.handles.delete(id);
    TerminalManager.registered = TerminalManager.registered.filter((r) => r !== id && r !== resolvedId);
    TerminalManager.invalidateMetaCache(id);
    TerminalManager.invalidateMetaCache(resolvedId);
    _lastLinesCache.delete(id);
    _lastLinesCache.delete(resolvedId);
    if (_focusedId === resolvedId || _focusedId === id) _focusedId = null;
    TerminalManager._lastSizes.delete(id);
    TerminalManager._lastSizes.delete(resolvedId);
    TerminalManager._writeQueues.delete(id);
    TerminalManager._writeQueues.delete(resolvedId);
    TerminalManager._attachPromises.delete(id);
    TerminalManager._attachPromises.delete(resolvedId);
    const resizeTimer = TerminalManager._resizeTimers.get(resolvedId) || TerminalManager._resizeTimers.get(id);
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
      TerminalManager._resizeTimers.delete(id);
      TerminalManager._resizeTimers.delete(resolvedId);
    }
    // Detach from Rust PTY so the output channel is released and output
    // stops accumulating in the bounded queue.
    ensureTauri()
      .then(() => cachedInvoke('terminal_detach', { id: resolvedId }))
      .catch(() => {});
  },

  /**
   * Attach to the Rust PTY output stream. This is the critical connection:
   * Rust PTY output → Tauri Channel → WriteQueue → xterm.write().
   */
  async attachToPty(id: string, onExit?: () => void): Promise<void> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    const h = TerminalManager.handles.get(resolvedId);
    if (!h) {
      console.log(`[TerminalManager] attachToPty skip: no handle for id=${id} (resolved=${resolvedId})`);
      return;
    }
    if (onExit) {
      h.onExit = onExit;
    }
    if (h.attached) {
      console.log(`[TerminalManager] attachToPty skip: already attached id=${id} (resolved=${resolvedId})`);
      return;
    }
    const inFlight = TerminalManager._attachPromises.get(resolvedId);
    if (inFlight) {
      console.log(`[TerminalManager] attachToPty join in-flight attach for ${resolvedId}`);
      return inFlight;
    }

    const attachPromise = (async () => {
      console.log(`[TerminalManager] attachToPty start: id=${id} (resolved=${resolvedId})`);

      try {
        await ensureTauri();
        if (!_Channel) {
          console.error('[TerminalManager] _Channel is null after ensureTauri');
          h.attached = false;
          return;
        }

        // Output channel: PTY bytes → WriteQueue → xterm
        const outputChannel = new _Channel();
        let chunkCount = 0;
        outputChannel.onmessage = (data: number[] | Uint8Array) => {
          try {
            chunkCount++;
            if (chunkCount <= 3) {
              console.log(`[TerminalManager] Channel output chunk #${chunkCount} for ${resolvedId}: ${data?.length ?? 0} bytes`);
            }
            const now = Date.now();
            h.lastOutputAt = now;
            let filter = TerminalManager._syncFilters.get(resolvedId);
            if (!filter) {
              filter = new SynchronizedOutputFilter();
              TerminalManager._syncFilters.set(resolvedId, filter);
            }
            const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
            h.queue.push(filter.filter(u8));
          } catch (err) {
            console.warn(`[TerminalManager] Channel onmessage error for ${resolvedId}:`, err);
          }
        };

        // Exit channel: PTY exited → cleanup
        const exitChannel = new _Channel();
        exitChannel.onmessage = () => {
          console.log(`[TerminalManager] Channel exit for ${resolvedId}`);
          h.attached = false;
          try {
            h.onExit?.();
          } catch (err) {
            console.warn(`[TerminalManager] onExit error for ${resolvedId}:`, err);
          }
        };

        // Replay scrollback FIRST before the live channel opens.
        // This guarantees proper ordering: historical output is pushed to the queue
        // first, and live chunks from the PTY follow via onOutput.
        // GUARD: if the session is in a TUI alternate screen (OpenCode/Claude/
        // vim), replaying stale MAIN-screen scrollback over the live TUI is the
        // classic cause of a "stuck"/corrupt-looking screen — the TUI only
        // repaints on its own events, so the stale frame can persist indefinitely.
        // TUIs manage their own screen; skip the replay when the alt buffer is
        // active (checked both from the renderer and from Rust-tracked meta).
        let tuiAlt = false;
        try { tuiAlt = h.term.buffer.active !== h.term.buffer.normal; } catch {}
        if (tuiAlt || TerminalManager.isTui(resolvedId)) {
          console.log(`[TerminalManager] skipping scrollback replay for ${resolvedId}: TUI alt-screen active`);
        } else {
          try {
            const scrollback = await cachedInvoke('terminal_get_scrollback', { id: resolvedId }) as unknown as number[] | Uint8Array;
            const u8 = scrollback instanceof Uint8Array ? scrollback : Array.isArray(scrollback) ? new Uint8Array(scrollback) : null;
            console.log(`[TerminalManager] Scrollback for ${resolvedId}: ${u8 ? u8.length : 'N/A'} bytes`);
            if (u8 && u8.length > 0) {
              const now = Date.now();
              h.lastOutputAt = now;
              h.queue.push(u8);
            }
          } catch (err) {
            console.warn(`[TerminalManager] Scrollback failed for ${resolvedId}:`, err);
          }
        }

        await cachedInvoke('terminal_attach', {
          id: resolvedId,
          // Tauri v2 #[tauri::command] uses camelCase parameter names for JSON deserialization
          onOutput: outputChannel,
          onExit: exitChannel,
        });
        h.attached = true;
        console.log(`[TerminalManager] terminal_attach SUCCESS for ${resolvedId}`);
      } catch (err) {
        console.error(`[TerminalManager] terminal_attach FAILED for ${resolvedId}:`, err);
        h.attached = false;
      }
    })().finally(() => {
      TerminalManager._attachPromises.delete(resolvedId);
    });

    TerminalManager._attachPromises.set(resolvedId, attachPromise);
    return attachPromise;
  },

  /** Legacy attach (kept for API compat) */
  attach(id: string, _onOutput: (chunk: number[]) => void, onExit: () => void): void {
    const h = TerminalManager.handles.get(id);
    if (!h || h.attached) return;
    h.attached = true;
    h.onExit = onExit;
  },

  get(id: string): Handle | undefined {
    if (!id) return undefined;
    const direct = TerminalManager.handles.get(id);
    if (direct) return direct;
    const cleanId = id.startsWith('/dev/') ? id.slice(5) : id;
    const byTty = TerminalManager.handlesByTty.get(id) || TerminalManager.handlesByTty.get(cleanId);
    if (byTty) return byTty;
    return TerminalManager.handles.get(TerminalManager.resolveSessionId(id));
  },

  all(): Handle[] {
    return Array.from(TerminalManager.handles.values());
  },

  /**
   * Per-session diagnostics for "stuck terminal" investigations. Exposed on
   * window as __ttoDiag(). Shows whether the renderer is connected/parked,
   * write-queue depth, last output age, TUI alt-screen state, and whether
   * the PTY channel is attached.
   */
  diag(): Array<{
    id: string;
    attached: boolean;
    parked: boolean;
    hostConnected: boolean;
    queuedBytes: number;
    queueChunks: number;
    lastOutputAgoMs: number;
    tuiActive: boolean;
    cols: number;
    rows: number;
  }> {
    const now = Date.now();
    return TerminalManager.all().map((h) => ({
      id: h.sessionId,
      attached: h.attached,
      parked: TerminalManager.isParked(h.sessionId),
      hostConnected: h.host.isConnected,
      queuedBytes: h.queue.stats().bytes,
      queueChunks: h.queue.stats().chunks,
      lastOutputAgoMs: h.lastOutputAt ? now - h.lastOutputAt : -1,
      tuiActive: h.tuiActive,
      cols: h.term.cols,
      rows: h.term.rows,
    }));
  },

  async write(id: string, data: string): Promise<void> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    const h = TerminalManager.handles.get(resolvedId);
    if (h) {
      h.lastOutputAt = Date.now();
    }
    await ensureTauri();
    const bytes = Array.from(new TextEncoder().encode(data));
    const timeoutMs = TerminalManager._writeTimeoutMs;
    const prev = TerminalManager._writeQueues.get(resolvedId) || Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`[TerminalManager] write timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const writePromise = cachedInvoke('terminal_write', { id: resolvedId, data: bytes }).catch((err) => {
        if (timedOut) {
          // Late rejection after timeout — suppress to avoid unhandled rejection
          return;
        }
        throw err;
      });

      try {
        await Promise.race([writePromise, timeoutPromise]);
      } catch (err: any) {
        if (timedOut || err?.message?.includes('timed out')) {
          console.warn(`[TerminalManager] write timed out for ${resolvedId} (orig=${id})`);
        } else {
          console.warn(`[TerminalManager] write failed for ${resolvedId} (orig=${id}):`, err);
          throw err;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }).finally(() => {
      if (TerminalManager._writeQueues.get(resolvedId) === next) {
        TerminalManager._writeQueues.delete(resolvedId);
      }
    });
    TerminalManager._writeQueues.set(resolvedId, next);
    return next;
  },

  /**
   * Send an interactive prompt/message to a terminal PTY.
   * Decouples the prompt text from the carriage return (\r) with a brief delay (60ms)
   * so that interactive TUIs (Claude Code, OpenCode, Codex, Gemini) process \r
   * as an explicit onSubmit submission rather than treating it as a pasted newline.
   * Auto-heals detached PTY channels before sending to guarantee the wire never breaks.
   */
  async sendPrompt(id: string, prompt: string): Promise<void> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    const h = TerminalManager.handles.get(resolvedId);
    if (h) {
      const now = Date.now();
      h.lastOutputAt = now;
      h.workStartedAt = now;
      h.workEndedAt = 0;
      // Watchdog: If output channel got detached or failed previously, re-attach before sending!
      if (!h.attached) {
        console.warn(`[TerminalManager] Re-attaching unattached PTY before sendPrompt for ${resolvedId}`);
        await this.attachToPty(resolvedId);
      }
    }
    await ensureTauri();
    // 1. Write prompt text payload
    if (prompt) {
      await this.write(resolvedId, prompt);
      // 2. Allow event loop / Ink TUI input buffer to ingest the text
      await new Promise((r) => setTimeout(r, 60));
    }
    // 3. Write carriage return as distinct event to trigger onSubmit
    await this.write(resolvedId, '\r');
  },

  /**
   * Select a choice in an interactive CLI prompt.
   * y/n is a single byte. Numbered rows send Enter only when opts.enter is set
   * (Claude/Codex, or a tail that says "Enter to confirm"). Escape is one \x1b.
   */
  async sendMenuSelection(id: string, keyOrEscape: string, opts?: { enter?: boolean }): Promise<void> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    const h = TerminalManager.handles.get(resolvedId);
    if (h) {
      const now = Date.now();
      h.lastOutputAt = now;
      h.workStartedAt = now;
      h.workEndedAt = 0;
      if (!h.attached) {
        await this.attachToPty(resolvedId);
      }
    }
    await ensureTauri();
    const strokes = menuKeystrokes(keyOrEscape, { enter: opts?.enter ?? true });
    for (let i = 0; i < strokes.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 60));
      await this.write(resolvedId, strokes[i]);
    }
  },

  /** Send a command followed by Enter (\r) to the terminal via Tauri IPC */
  async sendCommand(id: string, command: string): Promise<void> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    const h = TerminalManager.handles.get(resolvedId);
    if (h) {
      const now = Date.now();
      h.lastOutputAt = now;
      h.workStartedAt = now;
      h.workEndedAt = 0;
      if (!h.attached) {
        await this.attachToPty(resolvedId);
      }
    }
    await ensureTauri();
    try {
      await cachedInvoke('terminal_send_command', { id: resolvedId, command });
    } catch (err) {
      console.warn(`[TerminalManager] sendCommand failed for ${resolvedId}, falling back to sendPrompt:`, err);
      await this.sendPrompt(resolvedId, command);
    }
  },

  /**
   * Resizes the PTY window with a 100ms trailing debounce per session.
   * Deduplicating identical dimensions eliminates redundant SIGWINCH signals
   * that cause Claude Code and full-screen TUIs to re-render duplicate banners
   * during initial grid mount, layout transitions, and window drags.
   */
  async resize(id: string, cols: number, rows: number, immediate = false): Promise<void> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    const handle = TerminalManager.handles.get(resolvedId);
    const px = handle ? ptyPixelSize(handle.term, cols, rows) : { pixelWidth: 0, pixelHeight: 0 };
    const last = TerminalManager._lastSizes.get(resolvedId);
    if (last && last.cols === cols && last.rows === rows) {
      const samePixels = last.pixelWidth === px.pixelWidth && last.pixelHeight === px.pixelHeight;
      const stillUnknown = px.pixelWidth === 0 && px.pixelHeight === 0;
      if (samePixels || stillUnknown) {
        return; // Dimensions unchanged — skip redundant resize and avoid SIGWINCH thrashing
      }
    }

    const existing = TerminalManager._resizeTimers.get(resolvedId);
    if (existing) window.clearTimeout(existing);

    const doResize = async () => {
      TerminalManager._resizeTimers.delete(resolvedId);
      const live = TerminalManager.handles.get(resolvedId);
      const livePx = live ? ptyPixelSize(live.term, cols, rows) : px;
      TerminalManager._lastSizes.set(resolvedId, { cols, rows, ...livePx });
      await ensureTauri();
      try {
        await cachedInvoke('terminal_resize', {
          id: resolvedId,
          cols,
          rows,
          pixelWidth: livePx.pixelWidth,
          pixelHeight: livePx.pixelHeight,
        });
      } catch {}
    };

    if (immediate || TerminalManager.isTui(resolvedId)) {
      await doResize();
    } else {
      const timer = window.setTimeout(doResize, 35);
      TerminalManager._resizeTimers.set(resolvedId, timer);
    }
  },

  async setVisible(id: string, visible: boolean): Promise<void> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    await ensureTauri();
    try {
      await cachedInvoke('terminal_set_visible', { id: resolvedId, visible });
    } catch {}
  },

  async setFocus(id: string, focused: boolean): Promise<void> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    await ensureTauri();
    if (focused) {
      const prev = _focusedId;
      _focusedId = resolvedId;
      if (prev && prev !== resolvedId) {
        try {
          await cachedInvoke('terminal_set_focus', { id: prev, focused: false });
        } catch {}
      }
      if (_focusedId !== resolvedId) return;
      try {
        await cachedInvoke('terminal_set_focus', { id: resolvedId, focused: true });
      } catch {}
    } else {
      if (_focusedId === resolvedId) _focusedId = null;
      try {
        await cachedInvoke('terminal_set_focus', { id: resolvedId, focused: false });
      } catch {}
    }
  },

  /** True when the terminal's host is parked in the hidden pool or disconnected. */
  isParked(id: string): boolean {
    const h = TerminalManager.get(id);
    if (!h) return true;
    return !h.host.isConnected || (!!TerminalManager._poolRoot && h.host.parentElement === TerminalManager._poolRoot);
  },

  /** Pure repaint of all rows without altering the viewport scroll position. */
  repaint(id: string): void {
    const h = TerminalManager.get(id);
    if (!h) return;
    try {
      h.term.refresh(0, Math.max(0, h.term.rows - 1));
    } catch {}
  },

  /** Forces xterm to repaint all rows from buffer; optionally scrolls to bottom. */
  refresh(id: string, forceScroll = false): void {
    const h = TerminalManager.get(id);
    if (!h) return;
    try {
      h.term.refresh(0, Math.max(0, h.term.rows - 1));
      if (forceScroll) {
        h.term.scrollToBottom();
      }
    } catch {}
  },

  /**
   * Repaint-only nudge: force xterm to re-render its full buffer and snap to
   * the bottom WITHOUT touching the PTY (no SIGWINCH, no write). Used to fix
   * "stuck" TUI frames (OpenCode/Claude) after the app was backgrounded —
   * WebKit throttles canvas/rAF while backgrounded, so the renderer layer can
   * sit on a stale frame while the buffer kept updating.
   */
  nudge(id: string): void {
    const h = TerminalManager.get(id);
    if (!h) return;
    if (TerminalManager.isParked(id)) return; // parked — nothing to repaint
    try {
      h.term.refresh(0, Math.max(0, h.term.rows - 1));
      h.term.scrollToBottom();
    } catch {}
  },

  /** Nudge every attached (non-parked) terminal. Safe: pure repaint. */
  nudgeAll(): number {
    let n = 0;
    for (const h of TerminalManager.handles.values()) {
      if (TerminalManager.isParked(h.sessionId)) continue;
      try {
        h.term.refresh(0, Math.max(0, h.term.rows - 1));
        h.term.scrollToBottom();
      } catch {}
      n++;
    }
    return n;
  },

  /**
   * Fit a terminal to the CURRENT size of its host element, but ONLY when the
   * host is actually visible (not parked in the hidden pool). Sizes are
   * re-measured, so it's safe to call on ResizeObserver events, window resizes,
   * and TUI transitions. When the host is parked or dimensions are bogus, this is a no-op.
   */
  fitNow(id: string): boolean {
    const h = TerminalManager.get(id);
    if (!h) return false;
    // 1. Ownership guard: only fit when the host div is a live child of its
    // current container (i.e. visible).
    if (!h.host.isConnected) return false;
    // 2. CRITICAL: Hidden pool host is parked at left:-99999px and must NOT be measured/fitted.
    if (TerminalManager._poolRoot && h.host.parentElement === TerminalManager._poolRoot) {
      return false;
    }
    // 3. Guard against zero/collapsed host dimensions (e.g. during transitions or drag)
    const w = h.host.clientWidth;
    const hPx = h.host.clientHeight;
    if (w < 80 || hPx < 40) return false;

    const fitAddon = (h.host as any).__ttoFitAddon as
      | { fit(): void; proposeDimensions?: () => { cols: number; rows: number } | undefined }
      | undefined;
    if (!fitAddon) return false;

    try {
      // 4. Guard against bogus tiny dimensions that corrupt CLI TUIs (OpenCode, Claude, etc.)
      if (typeof fitAddon.proposeDimensions === 'function') {
        const dims = fitAddon.proposeDimensions();
        if (!dims || isNaN(dims.cols) || isNaN(dims.rows)) return false;
        if (dims.cols < 15 || dims.rows < 4) return false;
      }
      fitAddon.fit();
      // 5. Force canvas repaint so the screen never remains blank after resize/reparent
      try {
        h.term.refresh(0, Math.max(0, h.term.rows - 1));
      } catch {}
      return true;
    } catch {
      // DOM not ready (host hidden/detached) — harmless, try again next event.
      return false;
    }
  },

  /** True when the terminal's host is currently a child of the given anchor. */
  isOwnedBy(id: string, container: HTMLElement): boolean {
    const h = TerminalManager.get(id);
    return !!h && h.host.parentElement === container;
  },

  /** Park a host back into the pool container (orphan-safe).
   *  Previous park() only restyled the host, leaving it orphaned in a
   *  removed DOM subtree → isConnected=false → fitNow bails → blank. */
  park(id: string): void {
    const h = TerminalManager.get(id);
    if (!h) return;
    const resolvedId = h.sessionId;
    // Already in the pool — nothing to do.
    if (TerminalManager._poolRoot && h.host.parentElement === TerminalManager._poolRoot) return;
    const root = TerminalManager._poolRoot;
    if (root) {
      root.appendChild(h.host);
    }
    h.host.style.cssText = POOL_HOST_STYLE;
    TerminalManager.setVisible(resolvedId, false).catch(() => {});
    TerminalManager.setFocus(resolvedId, false).catch(() => {});
  },

  _listeners: new Set<(id: string) => void>(),
  _notify(id: string): void { for (const l of TerminalManager._listeners) l(id); },
  onRegister(fn: (id: string) => void): () => void {
    TerminalManager._listeners.add(fn);
    for (const id of TerminalManager.registered) fn(id);
    return () => { TerminalManager._listeners.delete(fn); };
  },

  // ── Status tracking (ported from src-legacy) ────────────────────────

  /** Mark a session as TUI active/inactive. Fires onTuiChange callback and toggles DOM class. */
  setTui(id: string, active: boolean): void {
    const h = TerminalManager.get(id);
    const resolvedId = h ? h.sessionId : TerminalManager.resolveSessionId(id);
    if (h) {
      h.tuiActive = active;
      h.onTuiChange?.(active);
      if (h.host) {
        h.host.classList.toggle('tui-active', active);
        if (h.host.parentElement) {
          h.host.parentElement.classList.toggle('tui-active', active);
        }
      }
    }
    // Notify Rust so the scheduler knows the presentation context
    ensureTauri().then(() => {
      try { cachedInvoke('terminal_set_tui', { id: resolvedId, active }); } catch {}
    }).catch(() => {});
  },

  /** Clears the terminal scrollback buffer and resets active screen (Cmd+K). */
  clear(id: string): void {
    const h = TerminalManager.get(id);
    if (!h) return;
    try {
      h.term.clear();
      h.term.refresh(0, Math.max(0, h.term.rows - 1));
    } catch {}
  },

  /** Focus the xterm instance so user input is accepted immediately. */
  focus(id: string): void {
    const h = TerminalManager.get(id);
    if (!h) return;
    TerminalManager.setFocus(h.sessionId, true).catch(() => {});
    try {
      h.term.options.cursorBlink = true;
      h.term.focus();
    } catch {}
  },

  /** Whether a session is in an alternate-screen TUI (opencode/vim/htop). */
  isTui(id: string): boolean {
    return TerminalManager.get(id)?.tuiActive ?? false;
  },

  /** Unix ms of the last terminal output delivered to xterm (0 = unknown). */
  outputAt(id: string): number {
    return TerminalManager.get(id)?.lastOutputAt ?? 0;
  },

  /** True if the session produced output within the given window. */
  recentlyActive(id: string, windowMs = 4000): boolean {
    const h = TerminalManager.get(id);
    if (!h) return false;
    return Date.now() - h.lastOutputAt < windowMs;
  },

  /** Last N rendered lines of a session's active xterm buffer. */
  lastLines(id: string, n = 60): string[] {
    const h = TerminalManager.get(id);
    if (!h) return [];
    const sid = h.sessionId;
    const at = h.lastOutputAt;
    let entry = _lastLinesCache.get(sid);
    if (!entry || entry.lastOutputAt !== at) {
      entry = { lastOutputAt: at, byN: new Map() };
      _lastLinesCache.set(sid, entry);
    } else {
      const hit = entry.byN.get(n);
      if (hit !== undefined) return hit;
    }
    try {
      const buf = h.term.buffer.active;
      const out: string[] = [];
      for (let i = buf.length - 1; i >= Math.max(0, buf.length - n); i--) {
        out.unshift(buf.getLine(i)?.translateToString(true) ?? '');
      }
      const lines = out.filter((l) => l.trim().length > 0);
      entry.byN.set(n, lines);
      return lines;
    } catch {
      return [];
    }
  },

  /** Visible rows of the active screen. Scrollback above the viewport is excluded. */
  getViewportText(id: string): string[] {
    const h = TerminalManager.get(id);
    if (!h) return [];
    try {
      const term = h.term;
      const buf = term.buffer.active;
      if (!buf) return [];
      const rows = term.rows > 0 ? term.rows : buf.length;
      const start = buf.viewportY ?? 0;
      const end = Math.min(buf.length, start + rows);
      const out: string[] = [];
      for (let i = Math.max(0, start); i < end; i++) {
        out.push(buf.getLine(i)?.translateToString(true) ?? '');
      }
      return out;
    } catch {
      return [];
    }
  },

  /** True when xterm is showing the alternate screen (full-screen TUI). */
  isAlternateScreen(id: string): boolean {
    const h = TerminalManager.get(id);
    if (!h) return false;
    try {
      return h.term.buffer.active.type === 'alternate';
    } catch {
      return false;
    }
  },

  /** Full lines of a session's buffer (active or normal) up to maxLines, preserving blanks. */
  getBufferText(id: string, maxLines = 1500): string[] {
    const h = TerminalManager.get(id);
    if (!h) return [];
    try {
      const activeBuf = h.term.buffer.active;
      const normalBuf = h.term.buffer.normal;
      const buf = (activeBuf && activeBuf.length > 0) ? activeBuf : normalBuf;
      if (!buf) return [];
      const total = buf.length;
      const start = Math.max(0, total - maxLines);
      const out: string[] = [];
      for (let i = start; i < total; i++) {
        out.push(buf.getLine(i)?.translateToString(true) ?? '');
      }
      return out;
    } catch {
      return [];
    }
  },

  /** Full scrollback text directly from Tauri Rust PTY buffer */
  async getFullScrollbackText(id: string): Promise<string> {
    const resolvedId = TerminalManager.resolveSessionId(id);
    try {
      await ensureTauri();
      const scrollback = await cachedInvoke('terminal_get_scrollback', { id: resolvedId }) as unknown as number[] | Uint8Array;
      const u8 = scrollback instanceof Uint8Array ? scrollback : Array.isArray(scrollback) ? new Uint8Array(scrollback) : null;
      if (u8 && u8.length > 0) {
        return new TextDecoder().decode(u8);
      }
    } catch {}
    return '';
  },

  /** Unix ms when the session was created. */
  createdAt(id: string): number {
    return TerminalManager.get(id)?.createdAt ?? 0;
  },

  /** Unix ms when active work/output started (0 if no task has run). */
  workStartedAt(id: string): number {
    const h = TerminalManager.get(id);
    if (!h) return 0;
    return h.workStartedAt || 0;
  },

  /** Unix ms when active work completed/ended (0 if in progress or never started). */
  workEndedAt(id: string): number {
    return TerminalManager.get(id)?.workEndedAt ?? 0;
  },

  /** Set work ended timestamp when task is over or stopped. */
  setWorkEnded(id: string, ts = Date.now()): void {
    const h = TerminalManager.get(id);
    if (h) h.workEndedAt = ts;
  },

  /** Manually trigger work started timestamp. */
  setWorkStarted(id: string, ts = Date.now()): void {
    const h = TerminalManager.get(id);
    if (h) {
      h.workStartedAt = ts;
      h.workEndedAt = 0;
    }
  },

  /**
   * High-performance cached metadata resolver: returns CLI, title, status, and duration
   * without re-reading xterm buffer lines or re-running regexes on idle terminals.
   * Scales to 200+ terminals with near-zero CPU usage.
   */
  getTerminalMetadata<TStatus, TDuration>(
    tty: string,
    entry: any,
    closed: boolean,
    detectCliFn: (lines: string[], processCli?: string, agent?: string) => { detected: boolean; cli: string; cliName: string },
    deriveStatusFn: (tty: string, entry: any, closed: boolean) => TStatus,
    durationFn: (tty: string, status: TStatus) => TDuration,
    defaultCli = 'shell'
  ): { cli: string; cliName: string; status: TStatus; duration: TDuration } {
    const h = TerminalManager.get(tty);
    const now = Date.now();
    const lastOut = h?.lastOutputAt ?? 0;
    const entryCli = entry?.cli || '';
    const cached = _metaCache.get(tty);

    // Fast-path: return cached metadata if checked recently (< 1000ms),
    // output hasn't changed, and status is not a live-ticking state (running/asking)
    if (
      cached &&
      now - cached.cachedAt < 1000 &&
      cached.lastOutputAt === lastOut &&
      cached.entryCli === entryCli &&
      cached.status !== 'running' &&
      cached.status !== 'asking'
    ) {
      return {
        cli: cached.cli,
        cliName: cached.cliName,
        status: cached.status as TStatus,
        duration: cached.duration as TDuration,
      };
    }

    const lines = h ? TerminalManager.lastLines(tty, 60) : [];
    const detected = detectCliFn(lines, entry?.cli, entry?.agent);
    const status = deriveStatusFn(tty, entry, closed);

    // State transition tracking: automatically manage workStartedAt and workEndedAt
    const prevStatus = cached?.status as string | undefined;
    if (h) {
      if (status === 'running') {
        if (!h.workStartedAt || (prevStatus && prevStatus !== 'running')) {
          h.workStartedAt = now;
          h.workEndedAt = 0;
        }
      } else if (status === 'stopped' || status === 'over' || status === 'idle') {
        if (prevStatus === 'running' && h.workStartedAt > 0 && !h.workEndedAt) {
          h.workEndedAt = h.lastOutputAt || now;
        }
      }
    }

    const duration = durationFn(tty, status);

    // Strict truth-based resolution:
    // 1. High-fidelity active buffer detection (what is visibly rendered on screen)
    // 2. Active antigravity execution (explicit antigravity_running or entryCli)
    // 3. Fallback to user-specified initial command (only if not generic default)
    // 4. Fallback to detected non-empty cli
    // 5. Fallback to defaultCli
    // 6. Fallback to shell (NEVER random guess or workspace command default)
    let cli = 'shell';
    let cliName = 'Terminal';

    if (detected.detected && detected.cli && detected.cli !== 'unknown' && detected.cli !== 'shell') {
      cli = detected.cli.toLowerCase().trim();
      cliName = detected.cliName || CLI_DISPLAY_NAMES[cli] || (cli.charAt(0).toUpperCase() + cli.slice(1));
      if (entry) {
        entry.cli = cli;
        entry.agent = cli;
      }
    } else if ((entry as any)?.antigravity_running || entryCli === 'antigravity' || entryCli === 'agy') {
      cli = 'antigravity';
      cliName = 'Antigravity';
      if (entry) {
        entry.cli = 'antigravity';
        entry.agent = 'antigravity';
      }
    } else if (entryCli && entryCli !== 'shell' && entryCli !== 'unknown' && entryCli !== 'zsh' && entryCli !== 'bash') {
      cli = entryCli.toLowerCase().trim();
      cliName = CLI_DISPLAY_NAMES[cli] || (cli.charAt(0).toUpperCase() + cli.slice(1));
    } else if (detected.detected && detected.cli && detected.cli !== 'unknown') {
      cli = detected.cli.toLowerCase().trim();
      cliName = detected.cliName || CLI_DISPLAY_NAMES[cli] || 'Terminal';
    } else if (defaultCli && defaultCli !== 'shell' && defaultCli !== 'opencode') {
      cli = defaultCli.toLowerCase().trim();
      cliName = CLI_DISPLAY_NAMES[cli] || (cli.charAt(0).toUpperCase() + cli.slice(1));
    } else {
      cli = entryCli || 'shell';
      cliName = CLI_DISPLAY_NAMES[cli] || 'Terminal';
    }

    const result = { cli, cliName, status, duration };
    _metaCache.set(tty, {
      ...result,
      entryCli,
      lastOutputAt: lastOut,
      cachedAt: now,
    });
    return result;
  },

  /** Clear cache for a terminal (e.g. on close or unregister). */
  invalidateMetaCache(tty: string): void {
    _metaCache.delete(tty);
  },
};

const CLI_DISPLAY_NAMES: Record<string, string> = {
  prime: 'Prime Agent',
  'prime-agent': 'Prime Agent',
  primeagent: 'Prime Agent',
  'prime-intellect': 'Prime Agent',
  antigravity: 'Antigravity',
  agy: 'Antigravity',
  jetski: 'Antigravity',
  codex: 'Codex',
  'codex-cli': 'Codex',
  'openai-codex': 'Codex',
  claude: 'Claude Code',
  'claude-code': 'Claude Code',
  anthropic: 'Claude Code',
  opencode: 'OpenCode',
  gemini: 'Gemini',
  'gemini-cli': 'Gemini',
  cursor: 'Cursor',
  'cursor-agent': 'Cursor',
  qwen: 'Qwen',
  python: 'Python',
  python3: 'Python',
  node: 'Node',
  npm: 'npm',
  git: 'Git',
  docker: 'Docker',
  vim: 'Vim',
  nvim: 'Neovim',
  htop: 'htop',
  tmux: 'tmux',
  php: 'PHP',
  artisan: 'Artisan',
  zsh: 'Zsh',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
};

const _metaCache = new Map<string, {
  cli: string;
  cliName: string;
  status: any;
  duration: any;
  entryCli: string;
  lastOutputAt: number;
  cachedAt: number;
}>();

