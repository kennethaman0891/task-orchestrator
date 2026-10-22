//! Sidecar command relay — desktop-side delivery bridge.
//!
//! The sidecar (Python) can store tasks but cannot inject input into native
//! Rust PTY sessions — only we (the Rust process) hold the master fd.  This
//! module opens a WebSocket to the sidecar's `/ws/command-relay` and, when the
//! sidecar forwards an `inject_command` message (tty + command), types it into
//! the matching Rust session via `TerminalManager::send_command_by_tty`.
//!
//! Reconnects with a 3 s backoff so a freshly-spawned sidecar is picked up
//! automatically (same retry behaviour as the frontend dashboard socket).

use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::Emitter;
use tokio_tungstenite::tungstenite::Message;

use crate::terminal::manager::TerminalManager;

#[derive(Deserialize, Debug)]
struct InjectCommand {
    #[serde(rename = "type")]
    kind: String,
    tty: String,
    #[serde(default)]
    command: String,
    #[serde(default)]
    data: String,
    #[serde(default)]
    task_id: String,
}

fn urlencoding_query(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Spawn the relay loop as a background tokio task.
pub fn spawn(app: tauri::AppHandle, manager: Arc<TerminalManager>) {
    tauri::async_runtime::spawn(async move {
        loop {
            match run_once(&app, &manager).await {
                Ok(_) => {
                    log::info!("[relay] disconnected cleanly");
                }
                Err(e) => {
                    log::warn!("[relay] connection error: {e}");
                }
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
}

async fn run_once(
    app: &tauri::AppHandle,
    manager: &Arc<TerminalManager>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = crate::sidecar::sidecar_addr();
    let token = crate::sidecar::session_token();
    let url = format!(
        "ws://{addr}/ws/command-relay?session_token={}",
        urlencoding_query(&token)
    );
    log::info!("[relay] connecting to ws://{addr}/ws/command-relay");

    let (ws, _resp) = tokio_tungstenite::connect_async(&url).await?;
    log::info!("[relay] connected");

    let (mut _write, mut read) = ws.split();
    while let Some(msg) = read.next().await {
        let msg = msg?;
        if !msg.is_text() && !msg.is_binary() {
            continue;
        }
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Binary(b) => String::from_utf8_lossy(&b).to_string(),
            _ => continue,
        };
        let Ok(cmd) = serde_json::from_str::<InjectCommand>(&text) else {
            continue;
        };
        match cmd.kind.as_str() {
            "inject_command" => {
                log::info!("[relay] injecting into {}: {}", cmd.tty, cmd.command);
                match manager.send_command_by_tty(&cmd.tty, &cmd.command) {
                    Ok(()) => {
                        let _ = app.emit("relay-injected", (cmd.tty, cmd.task_id));
                    }
                    Err(e) => {
                        log::warn!("[relay] inject into {} failed: {e}", cmd.tty);
                    }
                }
            }
            "raw_input" => {
                log::info!("[relay] raw input into {}: {:?}", cmd.tty, cmd.data);
                match manager.write_by_tty(&cmd.tty, &cmd.data) {
                    Ok(()) => {}
                    Err(e) => {
                        log::warn!("[relay] raw input into {} failed: {e}", cmd.tty);
                    }
                }
            }
            "terminal_restart" => {
                log::info!("[relay] restarting session on {}", cmd.tty);
                match manager.restart_by_tty(&cmd.tty) {
                    Ok(()) => {
                        let _ = app.emit("relay-injected", (cmd.tty, ""));
                    }
                    Err(e) => {
                        log::warn!("[relay] restart {} failed: {e}", cmd.tty);
                    }
                }
            }
            "terminal_close" => {
                log::info!("[relay] closing session on {}", cmd.tty);
                match manager.close_by_tty(&cmd.tty) {
                    Ok(()) => {
                        let _ = app.emit("relay-injected", (cmd.tty, ""));
                    }
                    Err(e) => {
                        log::warn!("[relay] close {} failed: {e}", cmd.tty);
                    }
                }
            }
            _ => continue,
        }
    }
    Ok(())
}
