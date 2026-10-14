//! Per-terminal session model (spec §7).
//!
//! Every terminal has a stable id (`terminal-<n>`), owns ONE PTY, ONE renderer
//! channel, and is never rebuilt when other terminals are added/removed.
//! Interior mutability (parking_lot) lets the scheduler/manager mutate metadata
//! and even swap the PTY on restart while sessions are shared across threads.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::ipc::Channel;

use super::output::OutputChunk;
use super::pty::PtyHandle;

/// Public metadata exposed to the frontend.
#[derive(Clone, Debug, Serialize)]
pub struct SessionMeta {
    pub id: String,
    pub workspace_id: String,
    pub shell: String,
    pub cwd: String,
    pub title: String,
    pub status: String, // running | exited | killed | restarting
    pub agent: String,  // detected agent CLI (claude, codex, opencode, ...)
    pub cli: String,    // detected foreground CLI (vim, htop, python, node, git, ...)
    pub created_at: f64,
    pub last_activity: f64,
    pub cols: u16,
    pub rows: u16,
    pub tui_active: bool,
    pub pid: u32,
    /// Slave tty name (e.g. "ttys004") — links the session to the sidecar's
    /// terminal map so workspace panes and kanban/cards/table stay in sync.
    pub tty: String,
    /// Current grid layout mode for this session's workspace.
    /// Helps the scheduler and diagnostics know the presentation context.
    pub grid_mode: String, // auto | grid | compact | large
}

/// Diagnostics for one session (spec §49, surfaced via dev diagnostics).
#[derive(Clone, Debug, Serialize, Default)]
pub struct SessionDiag {
    pub id: String,
    pub queue_len: usize,
    pub dropped_bytes: u64,
    pub chunks_sent: u64,
    pub mode: String, // focused | visible | background
    pub grid_mode: String, // auto | grid | compact | large
}

pub struct TerminalSession {
    pub meta: Mutex<SessionMeta>,
    pub pty: Mutex<PtyHandle>,
    /// Output queue receiver. Wrapped in Option so `restart` can swap it.
    pub rx: Mutex<Option<tokio::sync::mpsc::Receiver<OutputChunk>>>,
    /// Attached frontend renderer channel. None while detached (recovery.rs).
    pub channel: Mutex<Option<Channel<Vec<u8>>>>,
    /// Attached exit-notify channel.
    pub exit_channel: Mutex<Option<Channel<()>>>,
    /// Secondary read-only mirror subscribers (the Space view's renderers).
    /// They receive a COPY of every chunk via fan-out in recovery::send_chunk,
    /// so the Space view can watch a PTY without owning the primary channel.
    /// Keyed by a frontend-chosen u64 id for idempotent subscribe/unsubscribe.
    pub subscribers: Mutex<Vec<(u64, Channel<Vec<u8>>)>>,
    /// Rust-side output taps (e.g. the gateway bridge). Each subscriber
    /// receives a COPY of every output chunk, so a remote client can stream
    /// terminal output without owning a JS renderer channel.
    pub rust_taps: Mutex<Vec<tokio::sync::mpsc::Sender<Vec<u8>>>>,
    /// Full persistent scrollback for the session (spec §30 FIX).
    ///
    /// Every chunk of PTY output is appended here regardless of whether a
    /// renderer is currently attached. This is the authoritative full history —
    /// like a real terminal's scrollback — so a frontend renderer that is
    /// recreated (view switch, watchdog recovery) can request and see the
    /// ENTIRE output, not just the newest bounded chunks.
    ///
    /// Bounded only by `SCROLLBACK_CAP` (a large ceiling far beyond any single
    /// task's output), so the beginning of a long run is never silently lost.
    pub scrollback: Mutex<VecDeque<u8>>,
    /// Initial command waiting to be injected once the frontend attaches and stabilizes geometry.
    pub pending_command: Mutex<Option<String>>,
    pub focused: AtomicBool,
    pub visible: AtomicBool,
    pub chunks_sent: AtomicU64,
    pub dropped: AtomicU64,
}

/// Maximum retained scrollback bytes per session (~16 MB). Generous ceiling for
/// tens of thousands of lines of history while keeping RAM bounded.
pub const SCROLLBACK_CAP: usize = 16 * 1024 * 1024;

impl TerminalSession {
    pub fn new(meta: SessionMeta, pty: PtyHandle, rx: tokio::sync::mpsc::Receiver<OutputChunk>) -> Self {
        Self {
            meta: Mutex::new(meta),
            pty: Mutex::new(pty),
            rx: Mutex::new(Some(rx)),
            channel: Mutex::new(None),
            exit_channel: Mutex::new(None),
            subscribers: Mutex::new(Vec::new()),
            rust_taps: Mutex::new(Vec::new()),
            scrollback: Mutex::new(VecDeque::new()),
            pending_command: Mutex::new(None),
            focused: AtomicBool::new(false),
            visible: AtomicBool::new(true),
            chunks_sent: AtomicU64::new(0),
            dropped: AtomicU64::new(0),
        }
    }

    pub fn meta(&self) -> SessionMeta {
        self.meta.lock().clone()
    }

    /// Write bytes to the PTY master (serialized via the pty lock, spec §9).
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let mut pty = self.pty.lock();
        pty.writer.write_all(data).map_err(|e| e.to_string())?;
        pty.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Append a chunk of PTY output to the persistent scrollback (bounded by
    /// `SCROLLBACK_CAP`). VecDeque ring buffer allows O(1) front eviction so
    /// long-running multi-hour sessions never stall the scheduler with 64MB memmoves.
    pub fn append_scrollback(&self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let mut sb = self.scrollback.lock();
        let room = SCROLLBACK_CAP.saturating_sub(sb.len());
        if room < data.len() {
            let drop_len = data.len().saturating_sub(room).min(sb.len());
            sb.drain(..drop_len);
        }
        sb.extend(data.iter().copied());
        if sb.len() > SCROLLBACK_CAP {
            let excess = sb.len() - SCROLLBACK_CAP;
            sb.drain(..excess);
        }
    }

    /// Return a copy of the full retained scrollback for replay on a fresh
    /// renderer attachment (frontend recreation / view switch / recovery).
    pub fn scrollback_copy(&self) -> Vec<u8> {
        let sb = self.scrollback.lock();
        let (s1, s2) = sb.as_slices();
        let mut v = Vec::with_capacity(s1.len() + s2.len());
        v.extend_from_slice(s1);
        v.extend_from_slice(s2);
        v
    }

    /// Clear the persistent scrollback (e.g. the user restarts the session).
    pub fn reset_scrollback(&self) {
        self.scrollback.lock().clear();
    }

    /// Publish a chunk to all Rust-side taps (gateway bridge). Best-effort:
    /// a full/dropped tap is removed so it never blocks the terminal.
    pub fn publish_rust_taps(&self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let mut taps = self.rust_taps.lock();
        let mut stale: Vec<usize> = Vec::new();
        for (i, tx) in taps.iter().enumerate() {
            if tx.try_send(data.to_vec()).is_err() {
                stale.push(i);
            }
        }
        if !stale.is_empty() {
            for &i in stale.iter().rev() {
                taps.remove(i);
            }
        }
    }

    /// Add a Rust-side tap; returns the id to unregister later.
    pub fn add_rust_tap(&self, tx: tokio::sync::mpsc::Sender<Vec<u8>>) {
        self.rust_taps.lock().push(tx);
    }

    pub fn remove_rust_taps(&self) {
        self.rust_taps.lock().clear();
    }

    /// Write a full command line (text + Enter) into the PTY.
    /// Decouples writing the command payload from the carriage return (\r)
    /// with a brief 60ms pause so interactive TUIs (Claude Code, OpenCode, etc.)
    /// process \r as an explicit Return key submission rather than a pasted newline.
    pub fn send_command(&self, command: &str) -> Result<(), String> {
        if !command.is_empty() {
            self.write(command.as_bytes())?;
            std::thread::sleep(std::time::Duration::from_millis(60));
        }
        self.write(b"\r")
    }

    /// Compute the scheduler mode for this session.
    pub fn mode(&self) -> &'static str {
        if self.focused.load(std::sync::atomic::Ordering::Relaxed) {
            "focused"
        } else if self.visible.load(std::sync::atomic::Ordering::Relaxed) {
            "visible"
        } else {
            "background"
        }
    }

    pub fn diag(&self) -> SessionDiag {
        let m = self.meta();
        SessionDiag {
            id: m.id,
            queue_len: self.rx.lock().as_ref().map(|r| r.len()).unwrap_or(0),
            dropped_bytes: self.dropped.load(std::sync::atomic::Ordering::Relaxed),
            chunks_sent: self.chunks_sent.load(std::sync::atomic::Ordering::Relaxed),
            mode: self.mode().to_string(),
            grid_mode: m.grid_mode,
        }
    }
}
