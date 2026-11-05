//! Terminal manager: registry + lifecycle (spec §4, §7, §36).
//!
//! Owns every terminal session. Creating T5 spawns PTY #5 + reader #5 and
//! leaves T1–T4 untouched.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

use super::output::{spawn_reader, QUEUE_CAP};
use super::pty::{self};
use super::recovery;
use super::session::{SessionDiag, SessionMeta, TerminalSession};

pub struct TerminalManager {
    pub app: AppHandle,
    pub sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
    counter: AtomicU64,
    /// Per-process launch salt. Session ids are `t-{n}-{salt}` (e.g.
    /// `t-3-8m2xq1kz`) so they are COMPACT yet UNIQUE across app launches and
    /// concurrent instances — persisted pane ids from an older run can never
    /// alias a live session from a newer one (the old `terminal-1..N` scheme
    /// restarted its counter on every launch, so restore skipped panes whose
    /// stale id collided with a fresh session, panes silently bound to
    /// dead/wrong sessions, killing one terminal killed another, and two app
    /// instances fought over one id space). The salt is the launch wall-clock
    /// in base36 (8 chars, ~89-year wrap), ms resolution → each launch gets a
    /// fresh salt.
    salt: String,
}

/// Heuristic agent detection from the launched command (spec §26).
fn detect_agent(command: &str) -> String {
    let lower = command.to_lowercase();
    let candidates: &[(&str, &[&str])] = &[
        ("antigravity", &["antigravity", "agy", "jetski"][..]),
        ("codex", &["codex", "codex-cli"][..]),
        ("prime", &["prime-agent", "primeagent", "prime"][..]),
        ("opencode", &["opencode"][..]),
        ("claude", &["claude", "claude-code"][..]),
        ("gemini", &["gemini", "gemini-cli"][..]),
        ("cursor", &["cursor", "cursor-agent"][..]),
        ("aider", &["aider"][..]),
        ("grok", &["grok"][..]),
    ];
    let tokens: Vec<&str> = lower.split_whitespace().collect();
    for (name, keys) in candidates {
        for key in *keys {
            if tokens.iter().any(|tok| {
                let base = tok.rsplit('/').next().unwrap_or(tok);
                base == *key
                    || base.starts_with(&format!("{key}-"))
                    || base.starts_with(&format!("{key}_"))
            }) {
                return name.to_string();
            }
        }
    }
    String::new()
}

/// Directories the PTY adds to PATH for a GUI launch. The inject check has to
/// see the same places, or `agy` / `claude` / `grok` in ~/.local/bin are
/// skipped and the shell starts empty.
fn cli_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".cargo/bin"));
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    if let Ok(path_var) = std::env::var("PATH") {
        dirs.extend(std::env::split_paths(&path_var));
    }
    dirs
}

/// Checks whether the primary executable token exists on disk or in PATH.
fn is_executable_available(command: &str) -> bool {
    let first = command
        .split(|c| c == '|' || c == ';' || c == '&' || c == '\n')
        .next()
        .unwrap_or("")
        .split_whitespace()
        .next()
        .unwrap_or("");
    if first.is_empty() {
        return false;
    }
    if first.contains('/') {
        return std::path::Path::new(first).exists();
    }
    for dir in cli_search_dirs() {
        let p = dir.join(first);
        if p.is_file() {
            return true;
        }
    }
    false
}

/// True when `command` actually *invokes* the `claude` binary as the program
/// being run, rather than merely mentioning it in a string.
///
/// `detect_agent` matches on substrings, so commands like
/// `grep -r claude ~/src` or `cd ~/claude-app && npm test` report agent
/// "claude" even though nothing launches Claude Code. Appending `--no-banner`
/// to those corrupts them. This inspects the FIRST token of the LAST
/// shell-separated segment, so:
///   `claude --resume`            -> true
///   `cd ~/proj && claude`        -> true
///   `sudo claude`                -> true
///   `grep -r claude .`           -> false
///   `cd ~/claude-app && npm dev` -> false
fn invokes_claude(command: &str) -> bool {
    // Split on shell command separators (covers `&&`, `||`, `|`, `;`) and keep
    // the last segment — that is the program actually being executed.
    let last = command
        .split(|c| c == '|' || c == ';' || c == '&' || c == '\n')
        .filter(|s| !s.trim().is_empty())
        .last()
        .unwrap_or("")
        .trim();

    let mut tokens = last.split_whitespace();
    let mut prog = match tokens.next() {
        Some(t) => t,
        None => return false,
    };

    // Step over leading `VAR=value` assignments and common wrappers
    // (sudo, env, time, nice, nohup) to reach the real program token.
    loop {
        let is_env_assign = prog.contains('=') && !prog.starts_with('-');
        let is_wrapper = matches!(
            prog.rsplit('/').next(),
            Some("sudo") | Some("env") | Some("time") | Some("nice") | Some("nohup")
        );
        if !is_env_assign && !is_wrapper {
            break;
        }
        prog = match tokens.next() {
            Some(t) => t,
            None => return false,
        };
    }

    // The basename must be exactly `claude` (or a `claude-*` variant) —
    // never a substring of a longer word.
    match prog.rsplit('/').next() {
        Some(p) => p == "claude" || p.starts_with("claude-"),
        None => false,
    }
}

/// Broader CLI detection — returns a recognizable cli id for ANY terminal
/// tool the user launches (matches the frontend CliLogo map keys).
fn detect_cli(command: &str) -> String {
    let a = detect_agent(command);
    if !a.is_empty() {
        return a;
    }
    let base = command
        .split_whitespace()
        .next()
        .map(|w| w.rsplit('/').next().unwrap_or(w))
        .unwrap_or("")
        .trim_start_matches('-')
        .to_lowercase();
    let table: &[(&str, &str)] = &[
        ("vim", "vim"),
        ("nvim", "nvim"),
        ("neovim", "nvim"),
        ("htop", "htop"),
        ("top", "top"),
        ("btop", "btop"),
        ("tmux", "tmux"),
        ("python", "python"),
        ("python3", "python"),
        ("node", "node"),
        ("nodejs", "node"),
        ("npm", "npm"),
        ("npx", "npm"),
        ("yarn", "npm"),
        ("pnpm", "npm"),
        ("git", "git"),
        ("docker", "docker"),
        ("zsh", "zsh"),
        ("bash", "bash"),
        ("sh", "bash"),
        ("fish", "bash"),
        ("cargo", "cargo"),
        ("ssh", "ssh"),
        ("curl", "curl"),
        ("wget", "curl"),
        ("php", "php"),
        ("artisan", "php"),
        ("prime-agent", "prime"),
        ("primeagent", "prime"),
        ("prime", "prime"),
        ("grok", "grok"),
        // Cursor's agent CLI is installed as `agent`, not `cursor`.
        ("agent", "cursor"),
    ];
    for (key, id) in table {
        if *key == base {
            return id.to_string();
        }
    }
    String::new()
}

impl TerminalManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            sessions: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1),
            salt: launch_salt(),
        }
    }

    fn next_id(&self) -> String {
        let n = self
            .counter
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        format!("t-{n}-{}", self.salt)
    }

    /// Create a native terminal session (spec §7: creates ONLY the new session).
    pub fn create(
        &self,
        cwd: Option<String>,
        workspace_id: String,
        cols: u16,
        rows: u16,
        initial_command: Option<String>,
    ) -> Result<SessionMeta, String> {
        let id = self.next_id();
        crate::safe_eprintln!(
            "[MANAGER] create() id={}, cwd={:?}, ws={}",
            id,
            cwd,
            workspace_id
        );
        let shell = pty::user_shell();
        let cwd_path = {
            let raw = cwd
                .unwrap_or_default()
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            // Expand ~ to the user's home directory (shell convention).
            // Uses crate::home_dir() which handles USERPROFILE on Windows.
            let expanded = if raw.starts_with('~') {
                let home = crate::home_dir();
                if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
                    format!("{}", home.join(rest).display())
                } else if raw == "~" {
                    home.to_string_lossy().to_string()
                } else {
                    raw.clone()
                }
            } else {
                raw.clone()
            };
            let candidate = PathBuf::from(&expanded);
            let p = if !expanded.is_empty() {
                if candidate.is_absolute() {
                    candidate
                } else {
                    crate::home_dir().join(&expanded)
                }
            } else {
                PathBuf::new()
            };
            // Validate the path exists and is a directory; fall back to HOME.
            if !expanded.is_empty() && p.is_dir() {
                crate::safe_eprintln!("[MANAGER] using resolved cwd: {:?}", p);
                p
            } else {
                if !raw.is_empty() {
                    crate::safe_eprintln!(
                        "[MANAGER] cwd {:?} is not a directory or invalid; falling back to {:?}",
                        raw,
                        crate::home_dir()
                    );
                }
                crate::home_dir()
            }
        };
        let (handle, reader) = pty::spawn_shell(&cwd_path, cols.max(2), rows.max(2))?;
        let pid = handle.pid;

        let (tx, rx) = tokio::sync::mpsc::channel(QUEUE_CAP);
        let _reader = spawn_reader(reader, tx);

        let mut meta = SessionMeta {
            id: id.clone(),
            workspace_id,
            shell,
            cwd: cwd_path.to_string_lossy().to_string(),
            title: "tto · shell".to_string(),
            status: "running".to_string(),
            agent: String::new(),
            cli: String::new(),
            created_at: now(),
            last_activity: now(),
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
            tui_active: false,
            pid,
            tty: pty::tty_for_pid(pid),
            grid_mode: "auto".to_string(),
        };

        // If an initial command is specified, pre-populate CLI, agent, and title
        let mut cmd_to_inject: Option<String> = None;
        if let Some(ref cmd) = initial_command {
            let trimmed = cmd.trim();
            let is_bare_shell = matches!(
                trimmed,
                "zsh" | "zshl" | "/bin/zsh" | "bash" | "/bin/bash" | "sh" | "/bin/sh" | "exec zsh"
            );
            if !trimmed.is_empty() && !is_bare_shell {
                let cli = detect_cli(trimmed);
                let cmd_to_send = trimmed.to_string();
                if !cli.is_empty() && is_executable_available(&cmd_to_send) {
                    meta.cli = cli.clone();
                    meta.agent = cli.clone();
                    meta.title = format!("tto · {cli}");
                    cmd_to_inject = Some(cmd_to_send);
                }
            }
        }

        let session = Arc::new(TerminalSession::new(meta.clone(), handle, rx));
        if let Some(cmd) = cmd_to_inject {
            *session.pending_command.lock() = Some(cmd);
        }
        crate::safe_eprintln!("[MANAGER] insert session={} tty={}", id, meta.tty);
        self.sessions.lock().insert(id.clone(), session.clone());
        let _ = self.app.emit("terminal-updated", ());

        Ok(meta)
    }

    /// Resolve a session by its canonical id or slave tty (e.g. "ttys004" or "/dev/ttys004").
    pub fn get_session(&self, id: &str) -> Result<Arc<TerminalSession>, String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(id) {
            return Ok(session.clone());
        }
        let clean_id = id.strip_prefix("/dev/").unwrap_or(id);
        for session in sessions.values() {
            let meta = session.meta.lock();
            if meta.id == id {
                return Ok(session.clone());
            }
            if !meta.tty.is_empty() && !id.is_empty() {
                let clean_tty = meta.tty.strip_prefix("/dev/").unwrap_or(&meta.tty);
                if meta.tty == id
                    || clean_tty == clean_id
                    || meta.tty == clean_id
                    || clean_tty == id
                {
                    return Ok(session.clone());
                }
            }
        }
        Err(format!("no session {id}"))
    }

    /// Attach a frontend renderer channel + exit channel to an existing session
    /// (spec §28: reattach, never restart the process).
    pub fn attach(
        &self,
        id: &str,
        on_output: Channel<Vec<u8>>,
        on_exit: Channel<()>,
    ) -> Result<(), String> {
        crate::safe_eprintln!("[MANAGER] attach() id={}", id);
        let session = self.get_session(id)?;
        recovery::attach(&session, on_output, on_exit);
        crate::safe_eprintln!("[MANAGER] attach() id={} -> OK", id);

        // If this session has a pending initial command, execute it now that the
        // frontend has attached and established the real terminal geometry!
        let pending = session.pending_command.lock().take();
        if let Some(cmd) = pending {
            let session_clone = session.clone();
            let id_clone = id.to_string();
            tokio::spawn(async move {
                // Allow a safe 1500ms for zsh login profile (.zshrc) and initial fit to settle
                // Increased to ensure PATH, shell init, and prompt are ready before
                // launching TUI apps like claude, codex, etc.
                tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                // Use decoupled send_command (command payload + 60ms pause + \r)
                // so interactive TUIs (OpenCode, Claude Code, Codex) process the submission
                // cleanly without dropping characters or corrupting input buffers.
                if let Err(e) = session_clone.send_command(&cmd) {
                    crate::safe_eprintln!(
                        "[MANAGER] attach() failed to inject pending command for {}: {}",
                        id_clone,
                        e
                    );
                } else {
                    crate::safe_eprintln!(
                        "[MANAGER] attach() injected pending command '{}' into {}",
                        cmd,
                        id_clone
                    );
                }
            });
        }

        Ok(())
    }

    /// Explicitly detach (e.g. window unload). PTY keeps running; output stays
    /// bounded in the queue.
    pub fn detach(&self, id: &str) -> Result<(), String> {
        if let Ok(session) = self.get_session(id) {
            recovery::detach(&session);
        }
        Ok(())
    }

    /// Register a secondary read-only mirror subscriber (Space view renderer).
    pub fn subscribe(
        &self,
        id: &str,
        sub_id: u64,
        channel: Channel<Vec<u8>>,
    ) -> Result<(), String> {
        let session = self.get_session(id)?;
        recovery::subscribe(&session, sub_id, channel);
        Ok(())
    }

    /// Remove a secondary subscriber (idempotent).
    pub fn unsubscribe(&self, id: &str, sub_id: u64) -> Result<(), String> {
        if let Ok(session) = self.get_session(id) {
            recovery::unsubscribe(&session, sub_id);
        }
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let session = self.get_session(id)?;
        session.write(data)
    }

    pub fn send_command(&self, id: &str, command: &str) -> Result<(), String> {
        let session = self.get_session(id)?;
        crate::safe_eprintln!("[MANAGER] send_command id={} cmd={:?}", id, command);
        let agent = detect_agent(command);
        // Auto-append --no-banner only when the command *invokes* claude
        // (not when it merely mentions it, e.g. `grep -r claude .`).
        let cmd_to_send = if invokes_claude(command) && !command.contains("--no-banner") {
            let mut c = command.to_string();
            if !c.ends_with(' ') {
                c.push(' ');
            }
            c.push_str("--no-banner");
            crate::safe_eprintln!("[MANAGER] Appended --no-banner to claude command");
            c
        } else {
            command.to_string()
        };
        if !agent.is_empty() {
            session.meta.lock().agent = agent;
        }
        let cli = detect_cli(&cmd_to_send);
        if !cli.is_empty() {
            session.meta.lock().cli = cli;
        }
        let r = session.send_command(&cmd_to_send);
        crate::safe_eprintln!("[MANAGER] send_command id={} -> {:?}", id, r.as_ref().err());
        r
    }

    /// Look up a session by its slave tty (e.g. "ttys004") and inject a
    /// command. Used by the sidecar command relay: the sidecar knows only the
    /// tty, and only we (the Rust process) hold the PTY master fd.
    pub fn send_command_by_tty(&self, tty: &str, command: &str) -> Result<(), String> {
        if tty.is_empty() {
            return Err("empty tty".to_string());
        }
        let session = {
            let sessions = self.sessions.lock();
            let clean_tty = tty.strip_prefix("/dev/").unwrap_or(tty);
            sessions
                .values()
                .find(|s| {
                    let m = s.meta.lock();
                    let s_clean = m.tty.strip_prefix("/dev/").unwrap_or(&m.tty);
                    m.tty == tty || s_clean == clean_tty || m.tty == clean_tty || s_clean == tty
                })
                .cloned()
        };
        let Some(session) = session else {
            return Err(format!("no session with tty {tty}"));
        };
        let agent = detect_agent(command);
        // Auto-append --no-banner only when the command *invokes* claude
        // (not when it merely mentions it, e.g. `grep -r claude .`).
        let cmd_to_send = if invokes_claude(command) && !command.contains("--no-banner") {
            let mut c = command.to_string();
            if !c.ends_with(' ') {
                c.push(' ');
            }
            c.push_str("--no-banner");
            crate::safe_eprintln!("[MANAGER] Appended --no-banner to claude command");
            c
        } else {
            command.to_string()
        };
        if !agent.is_empty() {
            session.meta.lock().agent = agent;
        }
        let cli = detect_cli(&cmd_to_send);
        if !cli.is_empty() {
            session.meta.lock().cli = cli;
        }
        session.send_command(&cmd_to_send)
    }

    /// Write raw bytes to a session found by its slave tty (remote /stop
    /// sends Ctrl+C this way). Mirrors `send_command_by_tty`.
    pub fn write_by_tty(&self, tty: &str, data: &str) -> Result<(), String> {
        if tty.is_empty() {
            return Err("empty tty".to_string());
        }
        let session = {
            let sessions = self.sessions.lock();
            let clean_tty = tty.strip_prefix("/dev/").unwrap_or(tty);
            sessions
                .values()
                .find(|s| {
                    let m = s.meta.lock();
                    let s_clean = m.tty.strip_prefix("/dev/").unwrap_or(&m.tty);
                    m.tty == tty || s_clean == clean_tty || m.tty == clean_tty || s_clean == tty
                })
                .cloned()
        };
        let Some(session) = session else {
            return Err(format!("no session with tty {tty}"));
        };
        session.write(data.as_bytes())
    }

    /// Restart the shell inside the session whose slave tty matches
    /// (remote /restart for Rust sessions).
    pub fn restart_by_tty(&self, tty: &str) -> Result<(), String> {
        if tty.is_empty() {
            return Err("empty tty".to_string());
        }
        let id = self.id_for_tty(tty)?;
        self.restart(&id)
    }

    /// Close/kill the session whose slave tty matches (remote /kill).
    pub fn close_by_tty(&self, tty: &str) -> Result<(), String> {
        if tty.is_empty() {
            return Err("empty tty".to_string());
        }
        let id = self.id_for_tty(tty)?;
        self.close(&id)
    }

    fn id_for_tty(&self, tty: &str) -> Result<String, String> {
        let sessions = self.sessions.lock();
        let clean_tty = tty.strip_prefix("/dev/").unwrap_or(tty);
        for (id, session) in sessions.iter() {
            let m = session.meta.lock();
            let s_clean = m.tty.strip_prefix("/dev/").unwrap_or(&m.tty);
            if m.tty == tty || s_clean == clean_tty || m.tty == clean_tty || s_clean == tty {
                return Ok(id.clone());
            }
        }
        Err(format!("no session with tty {tty}"))
    }

    pub fn resize(
        &self,
        id: &str,
        cols: u16,
        rows: u16,
        pixel_width: u16,
        pixel_height: u16,
    ) -> Result<(), String> {
        use super::resize as rz;
        let session = self.get_session(id)?;
        let (cols, rows) = rz::clamp(cols, rows);
        // A 0 from the caller means "unknown", not "clear the pixel grid".
        let (pixel_width, pixel_height) = {
            let m = session.meta.lock();
            let pw = if pixel_width == 0 {
                m.pixel_width
            } else {
                pixel_width
            };
            let ph = if pixel_height == 0 {
                m.pixel_height
            } else {
                pixel_height
            };
            if !rz::changed(m.cols, m.rows, cols, rows)
                && m.pixel_width == pw
                && m.pixel_height == ph
            {
                return Ok(()); // no-op: avoids ioctl + resize loops (spec §35)
            }
            (pw, ph)
        };
        {
            let pty = session.pty.lock();
            pty::resize(&*pty.master, cols, rows, pixel_width, pixel_height)?;
        }
        {
            let mut m = session.meta.lock();
            m.cols = cols;
            m.rows = rows;
            m.pixel_width = pixel_width;
            m.pixel_height = pixel_height;
        }
        Ok(())
    }

    /// Kill the process and drop the session. The frontend recreates on demand.
    pub fn close(&self, id: &str) -> Result<(), String> {
        let session_to_kill = {
            let mut sessions = self.sessions.lock();
            let clean_id = id.strip_prefix("/dev/").unwrap_or(id);
            let target_key = if sessions.contains_key(id) {
                Some(id.to_string())
            } else {
                sessions.iter().find_map(|(k, s)| {
                    let meta = s.meta.lock();
                    if meta.id == id {
                        return Some(k.clone());
                    }
                    if !meta.tty.is_empty() && !id.is_empty() {
                        let clean_tty = meta.tty.strip_prefix("/dev/").unwrap_or(&meta.tty);
                        if meta.tty == id
                            || clean_tty == clean_id
                            || meta.tty == clean_id
                            || clean_tty == id
                        {
                            return Some(k.clone());
                        }
                    }
                    None
                })
            };
            target_key.and_then(|k| sessions.remove(&k))
        };
        if let Some(session) = session_to_kill {
            let _ = session.pty.lock().child.kill();
            let _ = session.pty.lock().child.wait();
        }
        let _ = self.app.emit("terminal-updated", ());
        Ok(())
    }

    /// Kill every PTY child. Called on app exit so shells/TUIs (e.g. opencode)
    /// are NOT orphaned with a dead terminal — orphaned TUI processes spin at
    /// 100% CPU and can crash their runtime (Bun SIGTRAP in the renderer).
    pub fn kill_all(&self) {
        let sessions: Vec<Arc<TerminalSession>> = {
            let sessions = self.sessions.lock();
            sessions.values().cloned().collect()
        };
        for session in sessions {
            let mut pty = session.pty.lock();
            let _ = pty.child.kill();
            let _ = pty.child.wait();
        }
    }

    /// Restart the shell process inside the same session (same id, same cwd).
    /// The renderer channel is preserved; the reader queue is swapped.
    pub fn restart(&self, id: &str) -> Result<(), String> {
        let session = self.get_session(id)?;

        let (cwd, cols, rows, grid_mode) = {
            let m = session.meta.lock();
            (m.cwd.clone(), m.cols, m.rows, m.grid_mode.clone())
        };

        {
            let mut pty = session.pty.lock();
            let _ = pty.child.kill();
            let _ = pty.child.wait();
        }

        let (handle, reader) = pty::spawn_shell(&PathBuf::from(&cwd), cols, rows)?;
        let pid = handle.pid;
        let (tx, rx) = tokio::sync::mpsc::channel(QUEUE_CAP);
        let _reader = spawn_reader(reader, tx);

        // Swap PTY + queue; keep id + channels (detach/re-attach handled by UI).
        recovery::detach(&session);
        session.reset_scrollback();
        *session.pty.lock() = handle;
        *session.rx.lock() = Some(rx);

        {
            let mut m = session.meta.lock();
            m.status = "running".to_string();
            m.pid = pid;
            m.tty = pty::tty_for_pid(pid);
            m.last_activity = now();
            m.grid_mode = grid_mode;
        }
        let _ = self.app.emit("terminal-updated", ());
        Ok(())
    }

    pub fn list(&self) -> Vec<SessionMeta> {
        let sessions = self.sessions.lock();
        sessions.values().map(|s| s.meta()).collect()
    }

    pub fn get_meta(&self, id: &str) -> Option<SessionMeta> {
        self.get_session(id).ok().map(|s| s.meta())
    }

    /// Return the full persistent scrollback for a session (FIX: full-history
    /// replay). The frontend calls this after (re)creating a renderer so the
    /// terminal shows the ENTIRE output history, not just the newest chunks.
    pub fn get_scrollback(&self, id: &str) -> Result<Vec<u8>, String> {
        let session = self.get_session(id)?;
        Ok(session.scrollback_copy())
    }

    pub fn set_title(&self, id: &str, title: &str) {
        if let Ok(session) = self.get_session(id) {
            session.meta.lock().title = title.to_string();
            let _ = self.app.emit("terminal-updated", ());
        }
    }

    pub fn set_tui(&self, id: &str, active: bool) {
        if let Ok(session) = self.get_session(id) {
            session.meta.lock().tui_active = active;
        }
    }

    pub fn set_focus(&self, id: &str, focused: bool) {
        if let Ok(session) = self.get_session(id) {
            let changed = session.focused.load(std::sync::atomic::Ordering::Relaxed) != focused;
            session
                .focused
                .store(focused, std::sync::atomic::Ordering::Relaxed);
            if changed {
                let _ = self.app.emit("terminal-updated", ());
            }
        }
    }

    pub fn set_visible(&self, id: &str, visible: bool) {
        if let Ok(session) = self.get_session(id) {
            let changed = session.visible.load(std::sync::atomic::Ordering::Relaxed) != visible;
            session
                .visible
                .store(visible, std::sync::atomic::Ordering::Relaxed);
            if changed {
                let _ = self.app.emit("terminal-updated", ());
            }
        }
    }

    /// Update the grid layout mode for a session (auto | grid | compact | large).
    /// Stored in metadata so the scheduler and diagnostics know the presentation
    /// context. Also emits a terminal-updated event so the frontend can react.
    pub fn set_grid_mode(&self, id: &str, mode: &str) {
        let valid = matches!(mode, "auto" | "grid" | "compact" | "large");
        let mode = if valid { mode } else { "auto" };
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(id) {
            session.meta.lock().grid_mode = mode.to_string();
            drop(sessions);
            let _ = self.app.emit("terminal-updated", ());
        }
    }

    /// Batch-resize all sessions belonging to a workspace to the given dimensions.
    /// Called when the user switches grid layout modes so every terminal in the
    /// workspace gets a SIGWINCH at the new card size in one pass.
    pub fn batch_resize(&self, workspace_id: &str, cols: u16, rows: u16) -> usize {
        use super::resize as rz;
        let (cols, rows) = rz::clamp(cols, rows);
        let sessions: Vec<Arc<TerminalSession>> = {
            let sessions = self.sessions.lock();
            sessions
                .values()
                .filter(|s| s.meta.lock().workspace_id == workspace_id)
                .cloned()
                .collect()
        };
        let mut resized = 0usize;
        for session in sessions {
            {
                let m = session.meta.lock();
                if !rz::changed(m.cols, m.rows, cols, rows) {
                    continue;
                }
            }
            let (pixel_width, pixel_height) = {
                let m = session.meta.lock();
                (m.pixel_width, m.pixel_height)
            };
            {
                let pty = session.pty.lock();
                if pty::resize(&*pty.master, cols, rows, pixel_width, pixel_height).is_err() {
                    continue;
                }
            }
            {
                let mut m = session.meta.lock();
                m.cols = cols;
                m.rows = rows;
            }
            resized += 1;
        }
        if resized > 0 {
            let _ = self.app.emit("terminal-updated", ());
        }
        resized
    }

    pub fn diagnostics(&self) -> Vec<SessionDiag> {
        self.sessions.lock().values().map(|s| s.diag()).collect()
    }

    /// Drain up to `budget` chunks from a specific session directly without holding the sessions map lock.
    ///
    /// Chunks are ALWAYS drained from `rx`, appended to the persistent scrollback, and
    /// tapped for Rust subscribers (like the gateway bridge) regardless of whether a frontend
    /// renderer is currently attached. This prevents the bounded `QUEUE_CAP` channel from
    /// saturating and halting the PTY reader thread on `tx.blocking_send()`, which would
    /// freeze child processes at the kernel PTY buffer level when detached or in the background.
    ///
    /// Forwarding via `recovery::send_chunk` and exit notification via `recovery::notify_exit`
    /// are gated by `has_listeners`. When a frontend renderer attaches later, it retrieves
    /// the full accumulated scrollback via `get_scrollback`.
    pub fn drain_session(&self, session: &Arc<TerminalSession>, budget: usize) -> (usize, bool) {
        let has_primary = session.channel.lock().is_some();
        let has_subscribers = !session.subscribers.lock().is_empty();
        let has_listeners = has_primary || has_subscribers;
        let mut forwarded = 0usize;
        let mut exited = false;
        for _ in 0..budget {
            let chunk = {
                let mut rx_guard = session.rx.lock();
                match rx_guard.as_mut().map(|r| r.try_recv()) {
                    Some(Ok(chunk)) => chunk,
                    _ => break,
                }
            };
            session
                .dropped
                .fetch_add(chunk.dropped, std::sync::atomic::Ordering::Relaxed);
            session.append_scrollback(&chunk.data);
            if chunk.eof {
                exited = true;
                let _ = session.pty.lock().child.try_wait();
                session.meta.lock().status = "exited".to_string();
            }
            if !chunk.data.is_empty() {
                session.publish_rust_taps(&chunk.data);
                if has_listeners && recovery::send_chunk(session, chunk.data) {
                    session
                        .chunks_sent
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    forwarded += 1;
                }
            }
            if chunk.eof && has_listeners {
                recovery::notify_exit(session);
            }
        }
        if exited {
            let _ = self.app.emit("terminal-updated", ());
        }
        (forwarded, exited)
    }

    pub fn drain(&self, id: &str, budget: usize) -> (usize, bool) {
        let session = {
            let sessions = self.sessions.lock();
            sessions.get(id).cloned()
        };
        if let Some(session) = session {
            self.drain_session(&session, budget)
        } else {
            (0, false)
        }
    }
}

fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Per-process unique salt: boot timestamp compacted to 8 base36 digits.
/// Unique across app launches and concurrent instances (ms-resolution wall
/// clock, ~89-year wrap), so a persisted pane id can never alias a live
/// session from a different run — while keeping ids short (`t-{n}-{hash}`).
fn launch_salt() -> String {
    let boot = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    base36(boot as u64)
}

/// Compact base36 encoding (digits `0-9a-z`): ~33% shorter than hex for the
/// same value (11 hex chars → 8 base36 chars), and unambiguous for display,
/// keys, and our `t-{n}-{salt}` ids.
fn base36(mut v: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if v == 0 {
        return "0".to_string();
    }
    let mut out = Vec::with_capacity(13);
    while v > 0 {
        out.push(DIGITS[(v % 36) as usize]);
        v /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("base36 digits are ASCII")
}

/// Background worker that queries child processes asynchronously.
/// Runs completely off the central sessions lock and off the main thread,
/// eliminating any process-spawning lock contention or beachballs.
pub fn spawn_detector(manager: Arc<TerminalManager>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(3500));
        loop {
            interval.tick().await;

            // 1. Snapshot running sessions without holding sessions lock during external process queries
            let targets: Vec<(String, u32, String)> = {
                let sessions = manager.sessions.lock();
                sessions
                    .values()
                    .filter_map(|s| {
                        let m = s.meta.lock();
                        if m.status == "running" && m.pid > 0 {
                            Some((m.id.clone(), m.pid, m.cli.clone()))
                        } else {
                            None
                        }
                    })
                    .collect()
            };

            if targets.is_empty() {
                continue;
            }

            let mut updates = Vec::new();
            for (id, pid, current_cli) in targets {
                let active = tokio::task::spawn_blocking(move || pty::active_child_process(pid))
                    .await
                    .unwrap_or(None);

                if let Some(active_cmd) = active {
                    let detected = detect_cli(&active_cmd);
                    let cli_to_set = if !detected.is_empty() {
                        detected
                    } else {
                        active_cmd
                    };
                    if cli_to_set != current_cli {
                        updates.push((id, cli_to_set));
                    }
                } else if !current_cli.is_empty()
                    && current_cli != "zsh"
                    && current_cli != "bash"
                    && current_cli != "sh"
                {
                    updates.push((id, "zsh".to_string()));
                }
            }

            if !updates.is_empty() {
                {
                    let sessions = manager.sessions.lock();
                    for (id, cli_name) in updates {
                        if let Some(session) = sessions.get(&id) {
                            let mut m = session.meta.lock();
                            let agent_name = if cli_name == "zsh" {
                                "shell".to_string()
                            } else {
                                cli_name.clone()
                            };
                            m.cli = cli_name;
                            m.agent = agent_name;
                        }
                    }
                }
                let _ = manager.app.emit("terminal-updated", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invokes_claude() {
        assert!(invokes_claude("claude --resume"));
        assert!(invokes_claude("cd ~/proj && claude"));
        assert!(invokes_claude("sudo claude"));
        assert!(!invokes_claude("grep -r claude ."));
        assert!(!invokes_claude("cd ~/claude-app && npm dev"));
    }

    #[test]
    fn test_detect_agent() {
        assert_eq!(detect_agent("claude"), "claude");
        assert_eq!(detect_agent("codex"), "codex");
        assert_eq!(detect_agent("antigravity"), "antigravity");
        assert_eq!(detect_agent("ls -la"), "");
    }

    #[test]
    fn test_detect_cli() {
        assert_eq!(detect_cli("nvim file.txt"), "nvim");
        assert_eq!(detect_cli("git status"), "git");
        assert_eq!(detect_cli("cargo test"), "cargo");
    }
}
