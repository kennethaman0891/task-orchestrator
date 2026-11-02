//! Native PTY spawning via `portable-pty` (cross-platform: macOS/Linux/Windows).
//!
//! Spawns the user's real login shell directly on the PTY — no tmux, no
//! Termux, no compatibility layer. The shell inherits the app's environment,
//! PATH, filesystem and installed CLIs.

use std::io::{Read, Write};
use std::path::Path;
#[cfg(target_os = "windows")]
use std::process::Command;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

/// A live PTY: master handle (resize), writer (stdin), and the spawned child.
/// The cloned reader is returned separately so it can move into the reader
/// thread without partial-move gymnastics.
pub struct PtyHandle {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub pid: u32,
}

// ─── Shell resolution ───────────────────────────────────────────────────────

/// Resolve the user's real login shell.
///
/// Unix: `$SHELL` if non-empty, otherwise `/bin/zsh`.
/// Windows: prefers `cmd.exe` (via `%COMSPEC%` or the system path), then
///   `pwsh.exe` (PowerShell 7), then `powershell.exe` (Windows PowerShell).
pub fn user_shell() -> String {
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/zsh".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        // %COMSPEC% points at cmd.exe by default; fall back through known PS
        // locations before giving up.
        if let Ok(s) = std::env::var("COMSPEC") {
            if !s.is_empty() {
                return s;
            }
        }
        for candidate in ["pwsh.exe", "powershell.exe"] {
            if Command::new(candidate).arg("--version").output().is_ok() {
                return candidate.to_string();
            }
        }
        "cmd.exe".to_string()
    }
}

/// Return the CLI args for the resolved shell (login mode / no-logo mode).
fn shell_args(shell: &str) -> &'static [&'static str] {
    let name = Path::new(shell).file_name().map(|n| n.to_string_lossy());
    match name.as_deref() {
        Some("cmd.exe") | Some("cmd") => &[],
        Some(n) if n.contains("powershell") || n.contains("pwsh") => &["-NoLogo"],
        _ => &["-l"],
    }
}

// ─── TTY detection ──────────────────────────────────────────────────────────

/// Resolve the slave tty name for a process (e.g. `ttys004`) via `ps`.
///
/// On Windows there is no tty concept; we synthesise a stable key from the PID
/// so the tty-keyed maps in the manager and relay stay functional across the
/// whole app without silently matching an empty string to some session.
pub fn tty_for_pid(pid: u32) -> String {
    if pid == 0 {
        return String::new();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let out = std::process::Command::new("ps")
            .args(["-o", "tty=", "-p", &pid.to_string()])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok();
        match out {
            Some(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            _ => String::new(),
        }
    }
    #[cfg(target_os = "windows")]
    {
        format!("pid-{pid}")
    }
}

/// Query the foreground or active child command running in a PTY session.
/// Returns Some(cli_name) if a child process is running (e.g. "codex", "agy", "opencode", "claude", "gemini", etc.),
/// or None if the shell is sitting idle.
pub fn active_child_process(shell_pid: u32) -> Option<String> {
    if shell_pid == 0 {
        return None;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let out = std::process::Command::new("pgrep")
            .args(["-P", &shell_pid.to_string(), "-l"])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            let mut parts = line.split_whitespace();
            let child_pid_str = match parts.next() {
                Some(p) => p,
                None => continue,
            };
            if let Some(cmd) = parts.next() {
                let name = cmd.rsplit('/').next().unwrap_or(cmd).to_lowercase();
                if name != "zsh" && name != "bash" && name != "sh" && name != "login" {
                    // If the child is a runner like node, python, bun, npx, pnpm, etc., inspect its full args
                    if name == "node"
                        || name == "python"
                        || name == "python3"
                        || name == "bun"
                        || name == "npx"
                        || name == "pnpm"
                        || name == "bunx"
                        || name == "yarn"
                        || name == "uvx"
                    {
                        if let Ok(args_out) = std::process::Command::new("ps")
                            .args(["-o", "args=", "-p", child_pid_str])
                            .stdin(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .output()
                        {
                            let args = String::from_utf8_lossy(&args_out.stdout).to_lowercase();
                            if args.contains("claude") {
                                return Some("claude".to_string());
                            } else if args.contains("gemini") {
                                return Some("gemini".to_string());
                            } else if args.contains("codex") {
                                return Some("codex".to_string());
                            } else if args.contains("opencode") {
                                return Some("opencode".to_string());
                            } else if args.contains("prime-agent")
                                || args.contains("prime_agent")
                                || args.contains("prime")
                            {
                                return Some("prime".to_string());
                            } else if args.contains("agy") || args.contains("antigravity") {
                                return Some("antigravity".to_string());
                            } else if args.contains("cursor") {
                                return Some("cursor".to_string());
                            }
                        }
                    }
                    if name == "agy" || name == "antigravity" {
                        return Some("antigravity".to_string());
                    }
                    if name == "prime-agent" || name == "prime" || name == "primeagent" {
                        return Some("prime".to_string());
                    }
                    return Some(name);
                }
            }
        }
        None
    }
    #[cfg(target_os = "windows")]
    {
        None
    }
}

// ─── Spawn ──────────────────────────────────────────────────────────────────

/// Spawn a native login shell inside a fresh PTY.
/// Returns `(PtyHandle, reader)` — reader is owned by the caller's reader thread.
pub fn spawn_shell(
    cwd: &Path,
    cols: u16,
    rows: u16,
) -> Result<(PtyHandle, Box<dyn Read + Send>), String> {
    let shell = user_shell();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    // Login shell (Unix): sources the user's profile so PATH/env match a real
    // terminal. On Windows PowerShell gets `-NoLogo`; cmd.exe has no equivalent.
    cmd.args(shell_args(&shell));
    cmd.cwd(cwd);
    // TERM / COLORTERM are meaningful to ConPTY-hosted shells but meaningless
    // to the PTY layer itself — keep them only on Unix where they affect the
    // rendered palette.
    #[cfg(not(target_os = "windows"))]
    {
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // The GUI process can inherit a no-color parent (NO_COLOR=1,
        // FORCE_COLOR=0, CLICOLOR=0). Claude, Codex, and Antigravity honor
        // those and draw their logos in the default foreground. Drop them
        // for the interactive PTY only. Do not env_clear(): HOME and the
        // rest of the user environment stay.
        for key in [
            "NO_COLOR",
            "FORCE_COLOR",
            "CLICOLOR_FORCE",
            "NPM_CONFIG_COLOR",
            "CARGO_TERM_COLOR",
            "PIP_NO_COLOR",
        ] {
            cmd.env_remove(key);
        }
        cmd.env("CLICOLOR", "1");

        // Ensure ~/.local/bin and Homebrew bin paths are on PATH for GUI launches
        let home = std::env::var("HOME").unwrap_or_default();
        let existing_path = std::env::var("PATH").unwrap_or_default();
        let mut path_entries = vec![
            format!("{home}/.local/bin"),
            format!("{home}/.cargo/bin"),
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
        ];
        if !existing_path.is_empty() {
            path_entries.push(existing_path);
        }
        cmd.env("PATH", path_entries.join(":"));
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn {shell}: {e}"))?;
    let pid = child.process_id().unwrap_or(0);
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer: {e}"))?;

    let handle = PtyHandle {
        master: pair.master,
        writer,
        child,
        pid,
    };
    Ok((handle, reader))
}

/// Resize the PTY window so the process sees the new terminal dimensions.
///
/// `pixel_width` and `pixel_height` are the whole window in device pixels
/// (`cols * cell_width`, `rows * cell_height`). Zero tells graphics-aware
/// CLIs that the terminal has no pixel grid. Pass the last known non-zero
/// size rather than wiping it on a cols-only update.
pub fn resize(
    pty: &dyn MasterPty,
    cols: u16,
    rows: u16,
    pixel_width: u16,
    pixel_height: u16,
) -> Result<(), String> {
    pty.resize(PtySize {
        rows,
        cols,
        pixel_width,
        pixel_height,
    })
    .map_err(|e| format!("pty resize: {e}"))
}
