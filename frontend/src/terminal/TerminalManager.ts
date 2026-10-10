// TerminalManager — owns persistent per-session xterm instances (the "pool").
// Views render TerminalAnchor that reposition the host div. Input, resize,
// attach, scrollback-replay, and synchronized-output filters all live here.
// `tauri.attach()` is the ONLY source of terminal streaming.

import type { Terminal } from '@xterm/xterm';
import { WriteQueue } from './writeQueue';
import { SynchronizedOutputFilter } from './synchronizedOutputFilter';

interface Handle {
  sessionId: string;
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
  registered: [] as string[],
  // Pool container: TerminalPool publishes its hidden div here so park() can
  // re-parent hosts back into it (the previous park() only restyled the host
  // but left it orphaned in a removed DOM subtree → isConnected=false → blank).
  _poolRoot: null as HTMLElement | null,
  setPoolRoot(el: HTMLElement): void { TerminalManager._poolRoot = el; },
  _resizeTimers: new Map<string, number>(),
  _lastSizes: new Map<string, { cols: number; rows: number }>(),
  _outputListeners: new Map<string, Set<() => void>>(),

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

  has(id: string): boolean { return TerminalManager.handles.has(id); },

  register(opts: {
    sessionId: string; term: Terminal; host: HTMLDivElement;
    deliver?: (data: Uint8Array) => void; fit?: () => void; onExit?: () => void;
  }): Handle {
    const existing = TerminalManager.handles.get(opts.sessionId);
    if (existing) {
      existing.host.remove();
      existing.term.dispose();
    }

    const syncFilter = new SynchronizedOutputFilter();
    const deliverFn = opts.deliver || ((data: Uint8Array, cb?: () => void) => {
      opts.term.write(data, cb);
    });

    const handle: Handle = {
      sessionId: opts.sessionId,
      term: opts.term,
      host: opts.host,
      queue: new WriteQueue({
        deliver: (data: Uint8Array, done: () => void) => {
          const filtered = syncFilter.filter(data);
          let finished = false;
          const safeDone = () => {
            if (!finished) {
              finished = true;
              done();
            }
          };
          try {
            deliverFn(filtered, safeDone);
            // Watchdog fallback ensures long streams never stall if xterm drops a write callback
            window.setTimeout(safeDone, 60);
          } catch {
            safeDone();
          }
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
    if (!TerminalManager.registered.includes(opts.sessionId)) {
      TerminalManager.registered.push(opts.sessionId);
      TerminalManager._notify(opts.sessionId);
    }
    console.log(`[TerminalManager] Registered session ${opts.sessionId}`);
    return handle;
  },

  unregister(id: string): void {
    const h = TerminalManager.handles.get(id);
    if (h) { h.host.remove(); h.term.dispose(); }
    TerminalManager.handles.delete(id);
    TerminalManager.registered = TerminalManager.registered.filter((r) => r !== id);
    TerminalManager.invalidateMetaCache(id);
    TerminalManager._lastSizes.delete(id);
    const resizeTimer = TerminalManager._resizeTimers.get(id);
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
      TerminalManager._resizeTimers.delete(id);
    }
    // Detach from Rust PTY so the output channel is released and output
    // stops accumulating in the bounded queue.
    ensureTauri()
      .then(() => cachedInvoke('terminal_detach', { id }))
      .catch(() => {});
  },

  /**
   * Attach to the Rust PTY output stream. This is the critical connection:
   * Rust PTY output → Tauri Channel → WriteQueue → xterm.write().
   */
  async attachToPty(id: string, onExit?: () => void): Promise<void> {
    const h = TerminalManager.handles.get(id);
    if (!h || h.attached) {
      console.log(`[TerminalManager] attachToPty skip: id=${id} handle=${!!h} attached=${h?.attached}`);
      return;
    }
    h.attached = true;
    h.onExit = onExit;

    console.log(`[TerminalManager] attachToPty start: id=${id}`);

    await ensureTauri();
    if (!_Channel) {
      console.error('[TerminalManager] _Channel is null after ensureTauri');
      h.attached = false;
      return;
    }

    // Output channel: PTY bytes → WriteQueue → xterm
    const outputChannel = new _Channel();
    let chunkCount = 0;
    outputChannel.onmessage = (data: number[]) => {
      chunkCount++;
      if (chunkCount <= 3) {
        console.log(`[TerminalManager] Channel output chunk #${chunkCount} for ${id}: ${data.length} bytes`);
      }
      const now = Date.now();
      if (!h.workStartedAt) {
        h.workStartedAt = now;
      }
      h.lastOutputAt = now;
      h.queue.push(new Uint8Array(data));
      TerminalManager._notifyOutput(id);
    };

    // Exit channel: PTY exited → cleanup
    const exitChannel = new _Channel();
    exitChannel.onmessage = () => {
      console.log(`[TerminalManager] Channel exit for ${id}`);
      h.attached = false;
      h.onExit?.();
    };

    try {
      await cachedInvoke('terminal_attach', {
        id,
        // Tauri v2 maps Rust `on_output` / `on_exit` to camelCase JS keys.
        // Sending snake_case here silently drops the channels and every
        // attach fails with "missing required key onOutput" => blank terminal.
        onOutput: outputChannel,
        onExit: exitChannel,
      });
      console.log(`[TerminalManager] terminal_attach SUCCESS for ${id}`);
    } catch (err) {
      console.error(`[TerminalManager] terminal_attach FAILED for ${id}:`, err);
      h.attached = false;
      return;
    }

    // Replay scrollback so the terminal shows full history.
    // GUARD: if the session is in a TUI alternate screen (OpenCode/Claude/
    // vim), replaying stale MAIN-screen scrollback over the live TUI is the
    // classic cause of a "stuck"/corrupt-looking screen — the TUI only
    // repaints on its own events, so the stale frame can persist indefinitely.
    // TUIs manage their own screen; skip the replay when the alt buffer is
    // active (checked both from the renderer and from Rust-tracked meta).
    let tuiAlt = false;
    try { tuiAlt = h.term.buffer.active !== h.term.buffer.normal; } catch {}
    if (tuiAlt || TerminalManager.isTui(id)) {
      console.log(`[TerminalManager] skipping scrollback replay for ${id}: TUI alt-screen active`);
    } else {
    try {
      const scrollback = await cachedInvoke('terminal_get_scrollback', { id }) as unknown as number[];
      console.log(`[TerminalManager] Scrollback for ${id}: ${Array.isArray(scrollback) ? scrollback.length : 'N/A'} bytes`);
      if (Array.isArray(scrollback) && scrollback.length > 0) {
        const now = Date.now();
        if (!h.workStartedAt) {
          h.workStartedAt = now;
        }
        h.lastOutputAt = now;
        h.queue.push(new Uint8Array(scrollback));
      }
    } catch (err) {
      console.warn(`[TerminalManager] Scrollback failed for ${id}:`, err);
    }
    } // end TUI alt-screen replay guard
  },

  /** Legacy attach (kept for API compat) */
  attach(id: string, _onOutput: (chunk: number[]) => void, onExit: () => void): void {
    const h = TerminalManager.handles.get(id);
    if (!h || h.attached) return;
    h.attached = true;
    h.onExit = onExit;
  },

  get(id: string): Handle | undefined {
    return TerminalManager.handles.get(id);
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
    const h = TerminalManager.handles.get(id);
    if (h) {
      h.lastOutputAt = Date.now();
    }
    await ensureTauri();
    const bytes = Array.from(new TextEncoder().encode(data));
    try {
      await cachedInvoke('terminal_write', { id, data: bytes });
    } catch (err) {
      console.warn(`[TerminalManager] write failed for ${id}:`, err);
    }
  },

  /** Send a command followed by Enter (\r) to the terminal via Tauri IPC */
  async sendCommand(id: string, command: string): Promise<void> {
    const h = TerminalManager.handles.get(id);
    if (h) {
      h.lastOutputAt = Date.now();
      if (!h.workStartedAt) h.workStartedAt = Date.now();
    }
    await ensureTauri();
    try {
      await cachedInvoke('terminal_send_command', { id, command });
    } catch (err) {
      console.warn(`[TerminalManager] sendCommand failed for ${id}, falling back to write:`, err);
      await this.write(id, `${command}\r`);
    }
  },

  /**
   * Resizes the PTY window with a 100ms trailing debounce per session.
   * Deduplicating identical dimensions eliminates redundant SIGWINCH signals
   * that cause Claude Code and full-screen TUIs to re-render duplicate banners
   * during initial grid mount, layout transitions, and window drags.
   */
  async resize(id: string, cols: number, rows: number, immediate = false): Promise<void> {
    const last = TerminalManager._lastSizes.get(id);
    if (last && last.cols === cols && last.rows === rows) {
      return; // Dimensions unchanged — skip redundant resize and avoid SIGWINCH thrashing
    }

    const existing = TerminalManager._resizeTimers.get(id);
    if (existing) window.clearTimeout(existing);

    const doResize = async () => {
      TerminalManager._resizeTimers.delete(id);
      TerminalManager._lastSizes.set(id, { cols, rows });
      await ensureTauri();
      try {
        await cachedInvoke('terminal_resize', { id, cols, rows });
      } catch {}
    };

    if (immediate) {
      await doResize();
    } else {
      const timer = window.setTimeout(doResize, 100);
      TerminalManager._resizeTimers.set(id, timer);
    }
  },

  async setVisible(id: string, visible: boolean): Promise<void> {
    await ensureTauri();
    try {
      await cachedInvoke('terminal_set_visible', { id, visible });
    } catch {}
  },

  async setFocus(id: string, focused: boolean): Promise<void> {
    await ensureTauri();
    try {
      await cachedInvoke('terminal_set_focus', { id, focused });
    } catch {}
  },

  /** True when the terminal's host is parked in the hidden pool or disconnected. */
  isParked(id: string): boolean {
    const h = TerminalManager.handles.get(id);
    if (!h) return true;
    return !h.host.isConnected || (!!TerminalManager._poolRoot && h.host.parentElement === TerminalManager._poolRoot);
  },

  /** Forces xterm to repaint all rows from buffer and scroll to bottom. */
  refresh(id: string): void {
    const h = TerminalManager.handles.get(id);
    if (!h) return;
    try {
      h.term.refresh(0, Math.max(0, h.term.rows - 1));
      h.term.scrollToBottom();
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
    const h = TerminalManager.handles.get(id);
    if (!h) return;
    if (!h.host.isConnected) return; // parked — nothing to repaint
    try {
      h.term.refresh(0, Math.max(0, h.term.rows - 1));
      h.term.scrollToBottom();
    } catch {}
  },

  /** Nudge every attached (non-parked) terminal. Safe: pure repaint. */
  nudgeAll(): number {
    let n = 0;
    for (const h of TerminalManager.handles.values()) {
      if (!h.host.isConnected) continue;
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
    const h = TerminalManager.handles.get(id);
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
    const h = TerminalManager.handles.get(id);
    return !!h && h.host.parentElement === container;
  },

  /** Park a host back into the pool container (orphan-safe).
   *  Previous park() only restyled the host, leaving it orphaned in a
   *  removed DOM subtree → isConnected=false → fitNow bails → blank. */
  park(id: string): void {
    const h = TerminalManager.handles.get(id);
    if (!h) return;
    // Already in the pool — nothing to do.
    if (TerminalManager._poolRoot && h.host.parentElement === TerminalManager._poolRoot) return;
    const root = TerminalManager._poolRoot;
    if (root) {
      root.appendChild(h.host);
    }
    h.host.style.cssText = POOL_HOST_STYLE;
    TerminalManager.setVisible(id, false).catch(() => {});
    TerminalManager.setFocus(id, false).catch(() => {});
  },

  _listeners: new Set<(id: string) => void>(),
  _notify(id: string): void { for (const l of TerminalManager._listeners) l(id); },
  onRegister(fn: (id: string) => void): () => void {
    TerminalManager._listeners.add(fn);
    for (const id of TerminalManager.registered) fn(id);
    return () => { TerminalManager._listeners.delete(fn); };
  },

  // ── Status tracking (ported from src-legacy) ────────────────────────

  /** Mark a session as TUI active/inactive. Fires onTuiChange callback. */
  setTui(id: string, active: boolean): void {
    const h = TerminalManager.handles.get(id);
    if (h) {
      h.tuiActive = active;
      h.onTuiChange?.(active);
    }
    // Notify Rust so the scheduler knows the presentation context
    ensureTauri().then(() => {
      try { cachedInvoke('terminal_set_tui', { id, active }); } catch {}
    }).catch(() => {});
  },

  /** Whether a session is in an alternate-screen TUI (opencode/vim/htop). */
  isTui(id: string): boolean {
    return TerminalManager.handles.get(id)?.tuiActive ?? false;
  },

  /** Unix ms of the last terminal output delivered to xterm (0 = unknown). */
  outputAt(id: string): number {
    return TerminalManager.handles.get(id)?.lastOutputAt ?? 0;
  },

  /** True if the session produced output within the given window. */
  recentlyActive(id: string, windowMs = 4000): boolean {
    const h = TerminalManager.handles.get(id);
    if (!h) return false;
    return Date.now() - h.lastOutputAt < windowMs;
  },

  /** Last N rendered lines of a session's active xterm buffer. */
  lastLines(id: string, n = 60): string[] {
    const h = TerminalManager.handles.get(id);
    if (!h) return [];
    try {
      const buf = h.term.buffer.active;
      const out: string[] = [];
      for (let i = buf.length - 1; i >= Math.max(0, buf.length - n); i--) {
        out.unshift(buf.getLine(i)?.translateToString(true) ?? '');
      }
      return out.filter((l) => l.trim().length > 0);
    } catch {
      return [];
    }
  },

  /** Full lines of a session's buffer (active or normal) up to maxLines, preserving blanks. */
  getBufferText(id: string, maxLines = 1500): string[] {
    const h = TerminalManager.handles.get(id);
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
    try {
      await ensureTauri();
      const scrollback = await cachedInvoke('terminal_get_scrollback', { id }) as unknown as number[];
      if (Array.isArray(scrollback) && scrollback.length > 0) {
        return new TextDecoder().decode(new Uint8Array(scrollback));
      }
    } catch {}
    return '';
  },

  /** Unix ms when the session was created. */
  createdAt(id: string): number {
    return TerminalManager.handles.get(id)?.createdAt ?? 0;
  },

  /** Unix ms when active work/output started. */
  workStartedAt(id: string): number {
    const h = TerminalManager.handles.get(id);
    if (!h) return 0;
    return h.workStartedAt || h.createdAt || 0;
  },

  /** Unix ms when active work completed/ended (0 if in progress). */
  workEndedAt(id: string): number {
    return TerminalManager.handles.get(id)?.workEndedAt ?? 0;
  },

  /** Set work ended timestamp when task is over or stopped. */
  setWorkEnded(id: string, ts = Date.now()): void {
    const h = TerminalManager.handles.get(id);
    if (h) h.workEndedAt = ts;
  },

  /** Manually trigger work started timestamp. */
  setWorkStarted(id: string, ts = Date.now()): void {
    const h = TerminalManager.handles.get(id);
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
    const h = TerminalManager.handles.get(tty);
    const now = Date.now();
    const lastOut = h?.lastOutputAt ?? 0;
    const entryCli = entry?.cli || '';
    const cached = _metaCache.get(tty);

    // Fast-path: return cached metadata if checked recently (< 1500ms) and neither output nor process changed
    if (cached && now - cached.cachedAt < 1500 && cached.lastOutputAt === lastOut && cached.entryCli === entryCli) {
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
    const duration = durationFn(tty, status);

    // Strict truth-based resolution:
    // 1. High-fidelity active buffer detection (what is visibly rendered on screen)
    // 2. OS process detection from Rust PTY inspection (what process is actively running in PTY)
    // 3. Fallback to user-specified initial command (only if not generic default)
    // 4. Fallback to shell (NEVER random guess or workspace command default)
    let cli = 'shell';
    let cliName = 'Terminal';

    if (detected.detected && detected.cli && detected.cli !== 'unknown' && detected.cli !== 'shell') {
      cli = detected.cli.toLowerCase().trim();
      cliName = detected.cliName || CLI_DISPLAY_NAMES[cli] || (cli.charAt(0).toUpperCase() + cli.slice(1));
      if (entry) {
        entry.cli = cli;
        entry.agent = cli;
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

