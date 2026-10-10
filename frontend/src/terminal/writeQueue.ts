// Per-terminal serialized renderer write queue (spec §9, §11, §12).
//
// Guarantees:
// - Single in-flight xterm.write() per terminal — concurrent writes never
//   interleave.
// - Bounded payloads: a burst is flushed in ≤ MAX_PAYLOAD chunks.
// - Flush deadlines: output also flushes on MAX_AGE (live streaming while an
//   agent works — never "nothing until the whole burst").
// - Watchdog: if xterm's write callback is lost/stalled, `onStall` fires and
//   the TerminalManager can recreate + reattach the renderer without killing
//   the PTY (recovery, spec §28).

export interface WriteQueueOptions {
  /** Actually deliver bytes to the renderer (xterm.write with callback). */
  deliver: (data: Uint8Array, done: () => void) => void;
  /** Watchdog fired when a write callback stalls. */
  onStall?: () => void;
  maxPayload?: number; // bytes — default 256 KB (spec §11 guideline)
  maxAgeMs?: number; // flush deadline — default 33 ms (≈30 fps live)
  stallMs?: number; // watchdog timeout — default 1500 ms
}

export class WriteQueue {
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private inFlight = false;

  private ageTimer: number | null = null;
  private stallTimer: number | null = null;

  private readonly deliver: WriteQueueOptions['deliver'];
  private readonly onStall?: () => void;
  private readonly maxPayload: number;
  private readonly maxAgeMs: number;
  private readonly stallMs: number;

  /** Coalesced bytes dropped by background throttling (diagnostics). */
  dropped = 0;
  /** Total chunks handed to the renderer (diagnostics). */
  flushed = 0;

  /** Live queue depth (diagnostics — exposed for window.__ttoDiag()). */
  stats(): { chunks: number; bytes: number } {
    return { chunks: this.pending.length, bytes: this.pendingBytes };
  }

  constructor(opts: WriteQueueOptions) {
    this.deliver = opts.deliver;
    this.onStall = opts.onStall;
    this.maxPayload = opts.maxPayload ?? 256 * 1024;
    this.maxAgeMs = opts.maxAgeMs ?? 33;
    this.stallMs = opts.stallMs ?? 1500;
  }

  /** Enqueue renderer bytes (from the Tauri output channel). */
  push(data: Uint8Array) {
    if (data.byteLength === 0) return;
    this.pending.push(data);
    this.pendingBytes += data.byteLength;

    if (this.inFlight) {
      // A write is in progress; the completion callback will flush next.
      return;
    }
    if (this.pendingBytes >= this.maxPayload) {
      this.flush();
    } else {
      this.scheduleAgeFlush();
    }
  }

  /** Called when the renderer signals output is ready (xterm write callback). */
  onWriteComplete() {
    this.clearStallTimer();
    this.inFlight = false;
    if (this.pending.length > 0) this.flush();
  }

  /** Watchdog recovery: drop queue state so the terminal keeps working. */
  reset() {
    this.clearStallTimer();
    this.clearAgeTimer();
    this.pending = [];
    this.pendingBytes = 0;
    this.inFlight = false;
  }

  /** Flush now (used by the scheduler for hidden→visible transitions). */
  flushNow() {
    this.clearAgeTimer();
    this.flush();
  }

  /** Drop queued bytes (e.g. renderer recreated mid-burst) — diagnostic count. */
  discardPending() {
    this.pending.forEach((p) => (this.dropped += p.byteLength));
    this.pending = [];
    this.pendingBytes = 0;
  }

  private flush() {
    if (this.inFlight || this.pending.length === 0) return;
    this.clearAgeTimer();

    // Batch up to maxPayload bytes per write (never split a chunk — the Rust
    // side already guarantees UTF-8/ANSI-safe boundaries per chunk).
    const batch: Uint8Array[] = [];
    let bytes = 0;
    while (this.pending.length > 0 && bytes < this.maxPayload) {
      const next = this.pending[0];
      if (bytes + next.byteLength > this.maxPayload && bytes > 0) break;
      bytes += next.byteLength;
      this.pending.shift();
      batch.push(next);
    }
    this.pendingBytes -= bytes;

    const merged = batch.length === 1 ? batch[0] : concat(batch);
    this.inFlight = true;
    this.flushed += 1;

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      this.onWriteComplete();
    };

    this.deliver(merged, done);

    // Watchdog: if the callback never fires, recover the renderer.
    this.stallTimer = window.setTimeout(() => {
      if (this.inFlight) {
        this.inFlight = false;
        this.onStall?.();
      }
    }, this.stallMs);
  }

  private scheduleAgeFlush() {
    if (this.ageTimer !== null || this.inFlight) return;
    this.ageTimer = window.setTimeout(() => {
      this.ageTimer = null;
      if (this.pending.length > 0 && !this.inFlight) this.flush();
    }, this.maxAgeMs);
  }

  private clearAgeTimer() {
    if (this.ageTimer !== null) {
      clearTimeout(this.ageTimer);
      this.ageTimer = null;
    }
  }

  private clearStallTimer() {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
