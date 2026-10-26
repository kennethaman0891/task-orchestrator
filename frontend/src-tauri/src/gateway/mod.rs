//! TTO Gateway client — outbound persistent connection.
//!
//! The desktop connects OUTBOUND to the gateway (WSS), so no inbound ports,
//! port forwarding, or static IP are ever needed on the home network. The
//! connection survives UI closure (spawned as a tokio task) and reconnects
//! with exponential backoff + jitter on network changes / gateway restarts.
//!
//! Protocol: versioned JSON envelopes `{ v, id, type, payload }` (see
//! gateway/src/protocol.ts). This module speaks the DESKTOP role:
//!   hello (deviceId + credential) → ack → heartbeat / pong
//!   terminal.input / terminal.resize / terminal.signal → local PTY manager
//!   session.list / terminal.list → local manager list
//!   terminal.output (from remote clients) → forwarded to local PTY manager
//!   file.list / file.read → scoped filesystem access

pub mod identity;
pub mod ipc;

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::Message;

use crate::terminal::manager::TerminalManager;

use identity::DeviceIdentity;

/// Connection state surfaced to the UI.
#[derive(Clone, serde::Serialize, PartialEq, Debug)]
#[serde(rename_all = "UPPERCASE")]
pub enum GatewayState {
    OFFLINE,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    /// Remote access is switched off in Settings → Permissions; the worker
    /// idles (no connection attempts, no WSS traffic) until re-enabled.
    DISABLED,
}

pub struct GatewayClient {
    /// Shared connection state (updated by the worker task).
    pub state: Mutex<GatewayState>,
    /// How many reconnect attempts have happened in the current cycle.
    pub attempts: Mutex<u32>,
    /// Remote-access toggle (Settings → Permissions). The worker watches this
    /// so toggling it off disconnects immediately and toggling it on wakes the
    /// worker to reconnect without waiting on backoff timers.
    enabled: tokio::sync::watch::Sender<bool>,
}

impl GatewayClient {
    pub fn new() -> Self {
        let (tx, _rx) = tokio::sync::watch::channel(true);
        Self {
            state: Mutex::new(GatewayState::OFFLINE),
            attempts: Mutex::new(0),
            enabled: tx,
        }
    }

    pub fn status(&self) -> GatewayState {
        self.state.lock().clone()
    }

    /// Receiver for the remote-access toggle (worker side).
    pub fn enabled_rx(&self) -> tokio::sync::watch::Receiver<bool> {
        self.enabled.subscribe()
    }

    /// Flip the remote-access toggle (IPC side). No-op on same value.
    pub fn set_enabled(&self, enabled: bool) {
        let _ = self.enabled.send(enabled);
    }
}

impl Default for GatewayClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Worker: connects to the gateway and keeps the connection alive.
/// Returns when the connection is intentionally stopped.
pub async fn run_connection(
    app: AppHandle,
    manager: Arc<TerminalManager>,
    client: Arc<GatewayClient>,
    ident: Arc<Mutex<DeviceIdentity>>,
) {
    let mut attempt: u32 = 0;
    let mut rx = client.enabled_rx();
    loop {
        // Respect the remote-access toggle. When disabled we idle here until
        // the user re-enables it (the watch wakes this task instantly).
        if !*rx.borrow() {
            *client.state.lock() = GatewayState::DISABLED;
            let _ = app.emit("gateway-status", client.status());
            if rx.changed().await.is_err() {
                return; // sender dropped (app shutdown)
            }
            continue;
        }
        // Clone values under the lock, then drop the guard before any .await
        // (parking_lot::MutexGuard is !Send and cannot cross await points).
        let (url, has_credential) = {
            let id = ident.lock();
            (id.gateway_url.clone(), !id.credential.is_empty())
        };
        if url.is_empty() || !has_credential {
            // Not paired yet — wait for the user to pair.
            *client.state.lock() = GatewayState::OFFLINE;
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        }

        *client.state.lock() = GatewayState::CONNECTING;
        let _ = app.emit("gateway-status", client.status());

        match connect_once(&app, &manager, &client, &ident, &url, rx.clone()).await {
            Ok(_) => {
                // Clean disconnect (e.g. app exit or explicit stop).
                *client.state.lock() = GatewayState::OFFLINE;
                let _ = app.emit("gateway-status", client.status());
                return;
            }
            Err(_) => {
                attempt += 1;
                *client.attempts.lock() = attempt;
                *client.state.lock() = if attempt > 1 {
                    GatewayState::RECONNECTING
                } else {
                    GatewayState::CONNECTING
                };
                let _ = app.emit("gateway-status", client.status());
                // Exponential backoff with jitter: 2s, 4s, 8s, ... capped at 60s.
                // Race the sleep against a toggle change so disabling remote
                // access takes effect promptly even mid-backoff.
                let backoff = Duration::from_secs((2u64 << attempt.min(5)) + rand::random::<u64>() % 2);
                tokio::select! {
                    _ = tokio::time::sleep(backoff) => {}
                    _ = rx.changed() => {}
                }
            }
        }
    }
}

/// One connect cycle: handshake, heartbeat, message loop. Returns Ok on clean
/// disconnect (stops the worker) or Err on failure (triggers reconnect).
async fn connect_once(
    app: &AppHandle,
    manager: &Arc<TerminalManager>,
    client: &Arc<GatewayClient>,
    ident: &Arc<Mutex<DeviceIdentity>>,
    url: &str,
    mut rx: tokio::sync::watch::Receiver<bool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (device_id, credential) = {
        let id = ident.lock();
        (id.device_id.clone(), id.credential.clone())
    };

    let (mut ws, _resp) = tokio_tungstenite::connect_async(url).await?;

    // Handshake: hello with device identity.
    ws.send(Message::Text(
        json!({
            "v": 1,
            "id": "hello",
            "type": "hello",
            "payload": { "role": "desktop", "deviceId": device_id, "credential": credential }
        })
        .to_string(),
    ))
    .await?;

    *client.state.lock() = GatewayState::CONNECTED;
    let _ = app.emit("gateway-status", client.status());
    // TODO(remote): reset attempts on successful connect
    *client.attempts.lock() = 0;

    let (mut write, mut read) = ws.split();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                write.send(Message::Text(json!({
                    "v": 1, "id": "hb", "type": "heartbeat", "payload": {}
                }).to_string())).await?;
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(env) = serde_json::from_str::<Envelope>(&text) {
                            handle_message(app, manager, env, &mut write).await;
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        write.send(Message::Pong(p)).await?;
                    }
                    Some(Ok(Message::Close(_))) => {
                        return Err("gateway closed connection".into());
                    }
                    Some(Err(e)) => {
                        return Err(e.into());
                    }
                    None => {
                        return Err("gateway connection ended".into());
                    }
                    _ => {}
                }
            }
            changed = rx.changed() => {
                // Remote-access toggle flipped while connected: a clean Ok
                // return stops this cycle so the outer loop can idle (disabled)
                // or reconnect immediately (re-enabled). Err = sender dropped.
                match changed {
                    Ok(_) if !*rx.borrow() => return Ok(()),
                    Err(_) => return Ok(()),
                    _ => {}
                }
            }
        }
    }
}

#[derive(serde::Deserialize)]
struct Envelope {
    #[serde(default)]
    id: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    payload: serde_json::Value,
}

async fn handle_message(
    app: &AppHandle,
    manager: &Arc<TerminalManager>,
    env: Envelope,
    write: &mut (impl SinkExt<Message> + Unpin),
) {
    match env.kind.as_str() {
        "pong" | "ack" => {}
        "session.list" | "terminal.list" => {
            let sessions: Vec<_> = manager
                .list()
                .into_iter()
                .map(|m| {
                    json!({
                        "id": m.id,
                        "tty": m.tty,
                        "title": m.title,
                        "cwd": m.cwd,
                        "status": m.status,
                        "agent": m.agent,
                        "cols": m.cols,
                        "rows": m.rows,
                        "pid": m.pid,
                    })
                })
                .collect();
            let resp = json!({
                "v": 1, "id": env.id, "type": "terminal.list", "payload": { "sessions": sessions }
            });
            let _ = write.send(Message::Text(resp.to_string())).await;
        }
        "terminal.input" => {
            // Remote client typed into a terminal. ACK the result instead of
            // silently dropping — a wrong/stale sessionId must be visible.
            let session_id = env.payload.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            let data = env.payload.get("data").and_then(|v| v.as_str()).unwrap_or("");
            let bytes = decode_b64(data);
            match manager.write(&session_id, &bytes) {
                Ok(()) => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "ack",
                        "payload": { "ok": true, "kind": "terminal.input", "sessionId": session_id } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                }
                Err(e) => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "error",
                        "payload": { "ok": false, "kind": "terminal.input", "sessionId": session_id, "error": e } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                }
            }
        }
        "terminal.send_command" | "task.dispatch" => {
            // Shared dispatch path: run a command in an existing session, or
            // create a NEW session when only a command is given (task.dispatch).
            let session_id = env.payload.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            let command = env.payload.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let cwd = env.payload.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            let is_task_dispatch = env.kind == "task.dispatch";

            if command.is_empty() {
                let resp = json!({ "v": 1, "id": env.id, "type": "error",
                    "payload": { "ok": false, "kind": env.kind, "error": "empty_command" } });
                let _ = write.send(Message::Text(resp.to_string())).await;
                return;
            }

            // task.dispatch with no sessionId → start a fresh terminal session
            // and run the command there, then hand the id back to the client.
            let target_session = if is_task_dispatch && session_id.is_empty() {
                let cols = env.payload.get("cols").and_then(|v| v.as_u64()).unwrap_or(120) as u16;
                let rows = env.payload.get("rows").and_then(|v| v.as_u64()).unwrap_or(40) as u16;
                let ws = env.payload.get("workspaceId").and_then(|v| v.as_str()).unwrap_or("remote").to_string();
                let cwd_owned: Option<String> =
                    if cwd.is_empty() { None } else { Some(cwd.to_string()) };
                match manager.create(cwd_owned, ws, cols, rows, None) {
                    Ok(meta) => Some(meta.id.clone()),
                    Err(e) => {
                        let resp = json!({ "v": 1, "id": env.id, "type": "error",
                            "payload": { "ok": false, "kind": "task.dispatch", "error": format!("create_failed: {e}") } });
                        let _ = write.send(Message::Text(resp.to_string())).await;
                        return;
                    }
                }
            } else if !session_id.is_empty() {
                Some(session_id.to_string())
            } else {
                None
            };

            let Some(target) = target_session else {
                let resp = json!({ "v": 1, "id": env.id, "type": "error",
                    "payload": { "ok": false, "kind": env.kind, "error": "no_session_id" } });
                let _ = write.send(Message::Text(resp.to_string())).await;
                return;
            };

            match manager.send_command(&target, &command) {
                Ok(()) => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "ack",
                        "payload": { "ok": true, "kind": env.kind, "sessionId": target } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                }
                Err(e) => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "error",
                        "payload": { "ok": false, "kind": env.kind, "sessionId": target, "error": e } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                }
            }
        }
        "terminal.resize" => {
            let session_id = env.payload.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            let cols = env.payload.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
            let rows = env.payload.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
            // 0 keeps the pixel size last reported by the desktop renderer.
            match manager.resize(&session_id, cols, rows, 0, 0) {
                Ok(()) => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "ack",
                        "payload": { "ok": true, "kind": "terminal.resize", "sessionId": session_id } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                }
                Err(e) => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "error",
                        "payload": { "ok": false, "kind": "terminal.resize", "sessionId": session_id, "error": e } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                }
            }
        }
        "terminal.signal" => {
            let session_id = env.payload.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            let signal = env.payload.get("signal").and_then(|v| v.as_str()).unwrap_or("");
            let result = match signal {
                "SIGINT" => manager.write(&session_id, b"\x03"),
                "SIGQUIT" => manager.write(&session_id, b"\x1c"),
                "SIGTSTP" => manager.write(&session_id, b"\x1a"),
                "SIGTERM" | "close" => manager.close(&session_id),
                other => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "error",
                        "payload": { "ok": false, "kind": "terminal.signal", "sessionId": session_id, "error": format!("unknown_signal: {other}") } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                    return;
                }
            };
            match result {
                Ok(()) => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "ack",
                        "payload": { "ok": true, "kind": "terminal.signal", "sessionId": session_id, "signal": signal } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                }
                Err(e) => {
                    let resp = json!({ "v": 1, "id": env.id, "type": "error",
                        "payload": { "ok": false, "kind": "terminal.signal", "sessionId": session_id, "error": e } });
                    let _ = write.send(Message::Text(resp.to_string())).await;
                }
            }
        }
        "terminal.attach" => {
            let session_id = env.payload.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            // Send current scrollback so the remote client can render history.
            if let Ok(scrollback) = manager.get_scrollback(session_id) {
                let resp = json!({
                    "v": 1, "id": env.id, "type": "terminal.output", "payload": {
                        "sessionId": session_id, "data": encode_b64(&scrollback), "initial": true
                    }
                });
                let _ = write.send(Message::Text(resp.to_string())).await;
            }
        }
        "file.list" => {
            let path = env.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let resp = handle_file_list(path);
            let out = json!({ "v": 1, "id": env.id, "type": "file.meta", "payload": resp });
            let _ = write.send(Message::Text(out.to_string())).await;
        }
        "file.read" => {
            let path = env.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let resp = handle_file_read(path);
            let out = json!({ "v": 1, "id": env.id, "type": "file.meta", "payload": resp });
            let _ = write.send(Message::Text(out.to_string())).await;
        }
        other => {
            // Never silently swallow an unknown type — the remote client should
            // see exactly why its message was not acted on.
            let resp = json!({ "v": 1, "id": env.id, "type": "error",
                "payload": { "ok": false, "kind": other, "error": "unknown_type" } });
            let _ = write.send(Message::Text(resp.to_string())).await;
        }
    }
    let _ = app;
}

/// SEC-FIX SEC-10: Sensitive path fragments that are never served via the Gateway
/// file API, even though they live under $HOME.  Mirrors BLOCKED_PATH_FRAGMENTS
/// in backend/remote/config.py so both layers enforce the same policy.
const GATEWAY_BLOCKED_FRAGMENTS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".config/opencode",
    "credentials",
    ".env",
    "id_rsa",
    "id_ed25519",
    "id_dsa",
    ".npmrc",
    ".bash_history",
    ".zsh_history",
    ".netrc",
    "key.pem",
    "secret",
    ".tto-web/state.json",
];

/// Returns true when the resolved path contains a sensitive fragment and must
/// not be returned to a remote gateway client.
fn is_gateway_blocked(path: &std::path::Path) -> bool {
    let s = path.to_string_lossy().to_lowercase();
    GATEWAY_BLOCKED_FRAGMENTS.iter().any(|frag| s.contains(frag))
}

/// Validate and canonicalize a path, enforcing that it resides strictly within $HOME.
fn safe_resolve_path(raw_path: &str) -> Result<std::path::PathBuf, &'static str> {
    if raw_path.trim().is_empty() {
        return Err("empty_path");
    }
    let home = crate::home_dir()
        .canonicalize()
        .map_err(|_| "home_dir_error")?;

    let candidate = if raw_path == "~" {
        home.clone()
    } else if let Some(stripped) = raw_path.strip_prefix("~/") {
        home.join(stripped)
    } else {
        std::path::PathBuf::from(raw_path)
    };

    let canonical = candidate
        .canonicalize()
        .map_err(|_| "not_found")?;

    if !canonical.starts_with(&home) {
        return Err("access_denied");
    }

    Ok(canonical)
}

/// List a directory (scoped: within $HOME; hidden entries included).
fn handle_file_list(path: &str) -> serde_json::Value {
    let dir = match safe_resolve_path(path) {
        Ok(p) => p,
        Err("access_denied") => return json!({ "ok": false, "error": "access_denied" }),
        Err(_) => return json!({ "ok": false, "error": "not_a_directory" }),
    };
    // SEC-FIX SEC-10: block sensitive directories even within $HOME.
    if is_gateway_blocked(&dir) {
        return json!({ "ok": false, "error": "access_denied" });
    }
    if !dir.is_dir() {
        return json!({ "ok": false, "error": "not_a_directory" });
    }
    let mut entries: Vec<serde_json::Value> = Vec::new();
    if let Ok(read) = std::fs::read_dir(&dir) {
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let size = if is_dir {
                None
            } else {
                entry.metadata().ok().map(|m| m.len())
            };
            entries.push(json!({ "name": name, "isDir": is_dir, "size": size }));
        }
    }
    entries.sort_by(|a, b| {
        let ad = a["isDir"].as_bool().unwrap_or(false);
        let bd = b["isDir"].as_bool().unwrap_or(false);
        bd.cmp(&ad).then(a["name"].as_str().cmp(&b["name"].as_str()))
    });
    json!({ "ok": true, "path": dir.to_string_lossy(), "entries": entries })
}

/// Read a file (scoped: within $HOME; text-safe; binary returned as base64 with a flag).
fn handle_file_read(path: &str) -> serde_json::Value {
    let p = match safe_resolve_path(path) {
        Ok(p) => p,
        Err("access_denied") => return json!({ "ok": false, "error": "access_denied" }),
        Err(_) => return json!({ "ok": false, "error": "not_a_file" }),
    };
    // SEC-FIX SEC-10: block sensitive files (SSH keys, .env, AWS creds…) even
    // within $HOME — the $HOME boundary alone is not sufficient since credentials
    // like ~/.ssh/id_rsa and ~/.env live there.
    if is_gateway_blocked(&p) {
        return json!({ "ok": false, "error": "access_denied" });
    }
    if !p.is_file() {
        return json!({ "ok": false, "error": "not_a_file" });
    }
    match std::fs::read(&p) {
        Ok(bytes) => {
            if bytes.iter().all(|b| b.is_ascii() || *b >= 0x20 || *b == b'\n' || *b == b'\r' || *b == b'\t') {
                json!({ "ok": true, "path": p.to_string_lossy(), "text": String::from_utf8_lossy(&bytes).to_string() })
            } else {
                json!({ "ok": true, "path": p.to_string_lossy(), "base64": encode_b64(&bytes), "binary": true })
            }
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

fn encode_b64(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn decode_b64(s: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandboxed_file_read_blocks_etc_passwd() {
        let resp = handle_file_read("/etc/passwd");
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["error"], "access_denied");
    }

    #[test]
    fn test_sandboxed_file_list_blocks_root() {
        let resp = handle_file_list("/etc");
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["error"], "access_denied");
    }

    #[test]
    fn test_sandboxed_file_read_blocks_path_traversal() {
        let home = crate::home_dir();
        let traversal = format!("{}/../../../../etc/passwd", home.display());
        let resp = handle_file_read(&traversal);
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["error"], "access_denied");
    }

    // SEC-FIX SEC-10: verify the gateway blocklist guards sensitive files within $HOME.
    #[test]
    fn test_gateway_blocked_detects_ssh() {
        let home = crate::home_dir();
        let ssh_key = home.join(".ssh").join("id_rsa");
        assert!(
            is_gateway_blocked(&ssh_key),
            ".ssh/id_rsa must be blocked by gateway blocklist"
        );
    }

    #[test]
    fn test_gateway_blocked_detects_env() {
        let home = crate::home_dir();
        let env_file = home.join(".env");
        assert!(
            is_gateway_blocked(&env_file),
            ".env must be blocked by gateway blocklist"
        );
    }

    #[test]
    fn test_gateway_blocked_detects_aws_credentials() {
        let home = crate::home_dir();
        let creds = home.join(".aws").join("credentials");
        assert!(
            is_gateway_blocked(&creds),
            ".aws/credentials must be blocked by gateway blocklist"
        );
    }

    #[test]
    fn test_gateway_blocked_allows_normal_file() {
        let home = crate::home_dir();
        let normal = home.join("Documents").join("notes.txt");
        assert!(
            !is_gateway_blocked(&normal),
            "Documents/notes.txt must not be blocked"
        );
    }

    #[test]
    fn test_gateway_blocked_detects_shell_history() {
        let home = crate::home_dir();
        assert!(is_gateway_blocked(&home.join(".zsh_history")));
        assert!(is_gateway_blocked(&home.join(".npmrc")));
        let notes = home.join("projects").join("notes.txt");
        assert!(!is_gateway_blocked(&notes));
    }
}