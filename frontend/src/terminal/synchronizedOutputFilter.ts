/**
 * Work around xterm.js 6.0's scrollback bug for synchronized terminal output.
 *
 * Some streaming CLIs bracket a redraw in DEC mode 2026 and issue ED2
 * (`ESC[2J`) inside that block. xterm 6.0 moves the scroll viewport as a side
 * effect of ED2 even though rendering is synchronized, corrupting the history
 * the user is reading. Keep every other byte intact and suppress only ED2
 * while that one mode is active. The parser carries incomplete CSI sequences
 * across PTY/channel chunks, so it is safe for streaming output.
 */
export class SynchronizedOutputFilter {
  private synchronized = false;
  private pending: number[] = [];

  filter(data: Uint8Array): Uint8Array {
    const out: number[] = [];

    const emitPending = () => {
      if (!this.pending.length) return;
      const sequence = this.pending;
      this.pending = [];

      const text = String.fromCharCode(...sequence);
      if (text === '\x1b[?2026h') {
        this.synchronized = true;
        out.push(...sequence);
      } else if (text === '\x1b[?2026l') {
        this.synchronized = false;
        out.push(...sequence);
      } else if (!(this.synchronized && text === '\x1b[2J')) {
        out.push(...sequence);
      }
    };

    for (const byte of data) {
      if (!this.pending.length) {
        if (byte === 0x1b) this.pending.push(byte);
        else out.push(byte);
        continue;
      }

      this.pending.push(byte);
      if (this.pending.length === 2 && byte !== 0x5b) {
        // A non-CSI ESC sequence; it cannot be one of the sequences above.
        emitPending();
        continue;
      }

      if (this.pending.length > 2 && this.pending[1] === 0x5b) {
        // CSI is complete once it reaches a final byte (ECMA-48 0x40–0x7E).
        if (byte >= 0x40 && byte <= 0x7e) emitPending();
        // Do not hold malformed/unbounded data indefinitely.
        else if (this.pending.length >= 1024) emitPending();
      }
    }

    return Uint8Array.from(out);
  }
}
