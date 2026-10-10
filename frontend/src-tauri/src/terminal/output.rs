//! Bounded terminal output pipeline: PTY reader thread → safe chunks → queue.
//!
//! Backpressure design (spec §8, §11, §12, §30):
//! - Reads are bounded (64 KB per syscall), chunks are bounded (16 KB).
//! - The per-terminal queue is bounded (128 chunks ≈ 2 MB) — never unbounded.
//! - If the queue is saturated the reader applies backpressure until the
//!   renderer drains it. Terminal byte streams are stateful: dropping a chunk
//!   can remove an ANSI cursor/control sequence and corrupt all later output.
//! - Chunks are split only at UTF-8 / ANSI / OSC-safe boundaries so terminal
//!   state is never corrupted.

use std::io::Read;
use tokio::sync::mpsc;

/// Maximum bytes emitted in a single renderer payload.
pub const MAX_CHUNK: usize = 16 * 1024;
/// Per-terminal queue depth in chunks (16 KB × 1024 ≈ 16 MB budget).
/// Raised from 128 (~2 MB): a DETACHED but busy session (e.g. an agent
/// streaming while the user reads another terminal) used to fill 2 MB,
/// backpressure the PTY reader, stall the child process, and on re-attach
/// replay only the newest 2 MB — permanently losing everything earlier
/// ("content window does not show the full content"). Chunks are allocated
/// lazily per message, so idle sessions cost ~nothing.
pub const QUEUE_CAP: usize = 1024;
/// Reader syscall size.
const READ_SIZE: usize = 64 * 1024;

#[derive(Debug)]
pub struct OutputChunk {
    pub data: Vec<u8>,
    /// Bytes dropped by backpressure before this chunk (cumulative diagnostic).
    pub dropped: u64,
    /// Set when the PTY hit EOF (process exited).
    pub eof: bool,
}

/// Split `buf` at the latest safe boundary ≤ MAX_CHUNK.
/// Returns (emit, defer): `defer` is re-prefixed onto the next chunk.
fn safe_split(buf: Vec<u8>) -> (Vec<u8>, Vec<u8>) {
    if buf.len() <= MAX_CHUNK {
        return (buf, Vec::new());
    }
    let mut cut = MAX_CHUNK;

    // Never split a multi-byte UTF-8 character: step back over continuation
    // bytes, and if a lead byte now sits at the cut, step back past it too.
    while cut > 0 && (buf[cut - 1] & 0xC0) == 0x80 {
        cut -= 1;
    }
    if cut > 0 && (0xC0..=0xF7).contains(&buf[cut - 1]) {
        cut -= 1;
    }

    // Never split an ANSI/OSC escape sequence: if an ESC appears near the cut
    // and its sequence is not yet terminated, defer from the ESC onward.
    if let Some(idx) = buf[..cut].iter().rposition(|&b| b == 0x1b) {
        let tail = &buf[idx..cut];
        let terminated = if tail.len() >= 2 {
            match tail[1] {
                // CSI: terminated by a final byte 0x40..=0x7E (after params).
                0x5b => tail[2..].iter().any(|&b| (0x40..=0x7e).contains(&b)),
                // OSC: terminated by BEL (0x07), single-byte ST (0x9C) or ST (ESC \).
                0x5d => tail[2..].iter().any(|&b| b == 0x07 || b == 0x9c)
                    || tail[2..].windows(2).any(|w| w == [0x1b, 0x5c]),
                // ESC + single char (e.g. ESC c, ESC ( B) is self-terminated.
                _ => true,
            }
        } else {
            false // lone ESC at the boundary — defer it
        };
        if !terminated && tail.len() < 64 {
            cut = idx;
        }
    }
    if cut == 0 {
        cut = MAX_CHUNK;
    }

    let mut buf = buf;
    let defer = buf.split_off(cut);
    (buf, defer)
}

/// Spawn the blocking reader thread for one PTY.
/// Reads from `reader`, applies bounded backpressure, and forwards every chunk
/// to `tx` in order. PTY output is an ANSI protocol stream, not a log: it is
/// invalid to discard arbitrary bytes while a full-screen CLI is rendering.
pub fn spawn_reader(
    mut reader: Box<dyn Read + Send>,
    tx: mpsc::Sender<OutputChunk>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = vec![0u8; READ_SIZE];
        let mut pending: Vec<u8> = Vec::new();
        // Retained in the message schema for diagnostics compatibility. It
        // remains zero because terminal protocol bytes are never discarded.
        let dropped: u64 = 0;

        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) => break, // EOF — process exited
                Ok(n) => n,
                Err(_) => break,
            };
            pending.extend_from_slice(&buf[..n]);

            while pending.len() > MAX_CHUNK {
                let (emit, defer) = safe_split(std::mem::take(&mut pending));
                pending = defer;
                if tx.blocking_send(OutputChunk { data: emit, dropped, eof: false }).is_err() {
                    // Receiver gone (session dropped) — stop reading.
                    return;
                }
            }

            // FIX (blank-terminal bug): flush small interactive output (prompts,
            // keystrokes echoed, agent progress) immediately. Previously we only
            // forwarded when pending exceeded MAX_CHUNK, so a quiet shell's
            // ~50-byte prompt sat buffered until EOF/16 KB and the renderer
            // showed nothing. The receiver preserves arrival order, so partial
            // ANSI sequences are safely completed by the next xterm.write.
            if !pending.is_empty() {
                let emit = std::mem::take(&mut pending);
                if tx.blocking_send(OutputChunk { data: emit, dropped, eof: false }).is_err() {
                    return;
                }
            }
        }

        // Flush remainder + signal EOF.
        let _ = tx.blocking_send(OutputChunk {
            data: pending,
            dropped,
            eof: true,
        });
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_output_passes_through() {
        let (emit, defer) = safe_split(b"hello world".to_vec());
        assert_eq!(emit, b"hello world");
        assert!(defer.is_empty());
    }

    #[test]
    fn splits_at_utf8_boundary() {
        let mut v = vec![b'a'; MAX_CHUNK - 1];
        v.extend_from_slice("é".as_bytes()); // 2-byte char straddles the cut
        let (emit, defer) = safe_split(v);
        assert_eq!(emit.len(), MAX_CHUNK - 1);
        assert_eq!(defer, "é".as_bytes());
    }

    #[test]
    fn defers_unterminated_osc() {
        let mut v = vec![b'a'; MAX_CHUNK - 8];
        v.extend_from_slice(b"\x1b]0;untitled");
        let (emit, defer) = safe_split(v);
        assert_eq!(emit.len(), MAX_CHUNK - 8);
        assert_eq!(defer, b"\x1b]0;untitled");
    }
}
