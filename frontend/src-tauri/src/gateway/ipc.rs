//! Gateway IPC commands (frontend ↔ Rust).
//!
//! These give the UI a thin, safe control plane for the gateway connection:
//!   gateway_status()             → current connection state
//!   gateway_pair()               → begin pairing (returns code + expiresAt)
//!   gateway_pair_status()        → poll pairing status
//!   gateway_pair_claim()         → sign challenge, claim credential
//!   gateway_set_url(url)         → set gateway URL (persisted with identity)
//!   gateway_disconnect()         → stop the connection
//!
//! Pairing never sends the private key off-device. The frontend only ever
//! sees non-secret values (connection state, pairing code, device name).

use std::io::Write;
use std::sync::Arc;

use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::AppState;

#[derive(Serialize)]
pub struct PairStart {
    pub code: String,
    pub expires_at: u64,
    pub device_id: String,
    pub device_name: String,
    pub public_key: String,
}

#[derive(Serialize)]
pub struct PairStatus {
    pub status: String,
    pub device_id: String,
}

#[derive(Serialize)]
pub struct PairClaim {
    pub ok: bool,
    pub error: Option<String>,
    pub credential: Option<String>,
}

/// Normalize a gateway URL: trim whitespace, prepend wss:// if no scheme,
/// strip trailing slash. Returns an error if the result is scheme-only
/// (e.g. "wss://") with no host.
fn normalize_gateway_url(raw: &str) -> Result<String, String> {
    let mut url = raw.trim().to_string();
    if url.is_empty() {
        return Err("gateway URL cannot be empty".to_string());
    }
    if !url.contains("://") {
        url = format!("wss://{url}");
    }
    // Strip trailing slash (but keep scheme + host intact).
    while url.ends_with('/') && url.len() > "wss://".len() {
        url.pop();
    }
    // Reject scheme-only (no host) — would cause connect loop.
    if url == "wss://" || url.len() <= "wss://".len() {
        return Err("gateway URL must include a host (e.g. wss://example.com)".to_string());
    }
    Ok(url)
}

/// Current connection state (OFFLINE/CONNECTING/CONNECTED/RECONNECTING).
#[tauri::command]
pub async fn gateway_status(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let s = state.gateway.status();
    Ok(serde_json::to_string(&s).unwrap_or_else(|_| "\"OFFLINE\"".to_string()))
}

/// Remote-access toggle state + current connection state (Settings → Permissions).
#[derive(Serialize)]
pub struct GatewayToggle {
    pub enabled: bool,
    pub status: String,
}

/// Read the remote-access toggle + live connection state.
#[tauri::command]
pub async fn gateway_enabled(state: State<'_, Arc<AppState>>) -> Result<GatewayToggle, String> {
    let enabled = *state.gateway.enabled_rx().borrow();
    let status = serde_json::to_string(&state.gateway.status())
        .unwrap_or_else(|_| "\"OFFLINE\"".to_string());
    Ok(GatewayToggle { enabled, status })
}

/// Enable/disable remote access at runtime. Disabling immediately ends any
/// live connection and parks the worker in DISABLED (no WSS traffic) until
/// re-enabled; enabling wakes the worker for an immediate reconnect.
#[tauri::command]
pub async fn gateway_set_enabled(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<GatewayToggle, String> {
    state.gateway.set_enabled(enabled);
    let status = serde_json::to_string(&state.gateway.status())
        .unwrap_or_else(|_| "\"OFFLINE\"".to_string());
    Ok(GatewayToggle { enabled, status })
}

/// Begin pairing against a gateway URL. Stores the URL with the identity and
/// asks the gateway for a pairing code. Returns the code for QR/display.
#[tauri::command]
pub async fn gateway_pair(
    state: State<'_, Arc<AppState>>,
    gateway_url: String,
) -> Result<PairStart, String> {
    let url = normalize_gateway_url(&gateway_url)?;
    let ident = state.gateway_identity.clone();

    // Persist the URL so the connection worker knows where to connect.
    {
        let mut id = ident.lock();
        id.gateway_url = url.clone();
        crate::gateway::identity::save(&id).map_err(|e| e.to_string())?;
    }

    let (device_id, device_name, public_key) = {
        let id = ident.lock();
        (
            id.device_id.clone(),
            id.device_name.clone(),
            id.public_key_der.clone(),
        )
    };

    // POST /api/pairing/create
    let body = serde_json::json!({
        "deviceId": device_id,
        "devicePublicKey": public_key,
        "deviceName": device_name
    });
    let resp = http_post(&url, "/api/pairing/create", &body.to_string()).await?;
    let v: serde_json::Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;

    if v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false) {
        let code = v
            .get("code")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let expires = v.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
        Ok(PairStart {
            code,
            expires_at: expires,
            device_id,
            device_name,
            public_key,
        })
    } else {
        Err(v
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("pairing_failed")
            .to_string())
    }
}

/// Poll pairing status for the current device id.
#[tauri::command]
pub async fn gateway_pair_status(
    state: State<'_, Arc<AppState>>,
    gateway_url: String,
) -> Result<PairStatus, String> {
    let url = normalize_gateway_url(&gateway_url)?;
    let device_id = state.gateway_identity.lock().device_id.clone();
    let resp = http_get(&url, &format!("/api/pairing/status?deviceId={device_id}")).await?;
    let v: serde_json::Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;
    let status = v
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or("pending")
        .to_string();
    Ok(PairStatus { status, device_id })
}

/// Complete pairing: fetch a challenge, sign it with the device key, claim the
/// credential, and store it (persisted). Returns ok/error.
#[tauri::command]
pub async fn gateway_pair_claim(
    state: State<'_, Arc<AppState>>,
    gateway_url: String,
) -> Result<PairClaim, String> {
    let url = normalize_gateway_url(&gateway_url)?;
    let ident = state.gateway_identity.clone();

    let device_id = ident.lock().device_id.clone();

    // 1. Challenge
    let body = serde_json::json!({ "deviceId": device_id });
    let resp = http_post(&url, "/api/pairing/challenge", &body.to_string()).await?;
    let cv: serde_json::Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;
    let nonce = cv
        .get("nonce")
        .and_then(|n| n.as_str())
        .ok_or("no_nonce")?
        .to_string();

    // 2. Sign the nonce with the device private key.
    let sig = {
        let id = ident.lock();
        crate::gateway::identity::sign_challenge(&id, &nonce).ok_or("no_key")?
    };

    // 3. Claim → credential.
    let claim_body = serde_json::json!({
        "deviceId": device_id,
        "nonce": nonce,
        "signature": sig
    });
    let resp = http_post(&url, "/api/pairing/claim", &claim_body.to_string()).await?;
    let rv: serde_json::Value = serde_json::from_str(&resp).map_err(|e| e.to_string())?;

    if rv.get("ok").and_then(|o| o.as_bool()).unwrap_or(false) {
        let credential = rv
            .get("credential")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        if credential.is_empty() {
            return Ok(PairClaim {
                ok: false,
                error: Some("empty_credential".into()),
                credential: None,
            });
        }
        // Persist the credential + URL so the worker can connect.
        {
            let mut id = ident.lock();
            id.credential = credential.clone();
            id.gateway_url = url.clone();
            crate::gateway::identity::save(&id).map_err(|e| e.to_string())?;
        }
        // Bump the worker: it will pick up the new credential on its next loop.
        *state.gateway.attempts.lock() = 0;
        Ok(PairClaim {
            ok: true,
            error: None,
            credential: Some(credential),
        })
    } else {
        Ok(PairClaim {
            ok: false,
            error: Some(
                rv.get("error")
                    .and_then(|e| e.as_str())
                    .unwrap_or("claim_failed")
                    .to_string(),
            ),
            credential: None,
        })
    }
}

/// Set the gateway URL only (persisted). Does not pair.
#[tauri::command]
pub async fn gateway_set_url(
    state: State<'_, Arc<AppState>>,
    gateway_url: String,
) -> Result<(), String> {
    let url = normalize_gateway_url(&gateway_url)?;
    let mut id = state.gateway_identity.lock();
    id.gateway_url = url.clone();
    crate::gateway::identity::save(&id).map_err(|e| e.to_string())
}

/// Return the current identity (device id + name, never the secret).
#[tauri::command]
pub async fn gateway_identity(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let id = state.gateway_identity.lock();
    Ok(serde_json::json!({
        "deviceId": id.device_id,
        "deviceName": id.device_name,
        "gatewayUrl": id.gateway_url,
        "paired": id.is_paired(),
    }))
}

/// HTTP helpers (sync over a tokio task; gateway uses HTTP control-plane).
async fn http_get(base: &str, path: &str) -> Result<String, String> {
    let url = format!("{base}{path}");
    http_request("GET", &url, None).await
}
async fn http_post(base: &str, path: &str, body: &str) -> Result<String, String> {
    let url = format!("{base}{path}");
    http_request("POST", &url, Some(body)).await
}

async fn http_request(method: &str, url: &str, body: Option<&str>) -> Result<String, String> {
    let url = url.to_string();
    let method = method.to_string();
    let body = body.map(|b| b.to_string());
    // Run the blocking reqwest-less call on a dedicated thread so we don't hold
    // the async runtime. We use tokio::net::TcpStream + a minimal HTTP client
    // to avoid adding reqwest (keeps the dependency surface small).
    tauri::async_runtime::spawn_blocking(move || minimal_http(method, url, body))
        .await
        .map_err(|e| e.to_string())?
}

/// Minimal HTTP client over std TcpStream (for gateway control-plane calls).
/// Supports http:// and wss:// URLs (uses TLS via native-tls for wss).
fn minimal_http(method: String, url: String, body: Option<String>) -> Result<String, String> {
    let parsed = parse_url(&url).ok_or("bad_url")?;

    let tcp = std::net::TcpStream::connect((parsed.host.as_str(), parsed.port))
        .map_err(|e| e.to_string())?;
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .ok();
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(10)))
        .ok();

    let req = build_http_request(&method, &parsed.host, &parsed.path, body.as_deref());

    let mut buf = Vec::new();
    if parsed.tls {
        // TLS: wrap the stream, then write + read from the single TlsStream
        // (native_tls::TlsStream is not Clone, so no separate read/write halves).
        let connector = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
        let mut tls_stream = connector
            .connect(&parsed.host, tcp)
            .map_err(|e| e.to_string())?;
        tls_stream
            .write_all(req.as_bytes())
            .map_err(|e| e.to_string())?;
        tls_stream.flush().map_err(|e| e.to_string())?;
        read_to_end(&mut tls_stream, &mut buf)?;
    } else {
        // Plain TCP: write + read from the single TcpStream.
        let mut stream = tcp;
        stream
            .write_all(req.as_bytes())
            .map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
        read_to_end(&mut stream, &mut buf)?;
    }

    let text = String::from_utf8_lossy(&buf).to_string();
    // Split headers from body.
    if let Some(idx) = text.find("\r\n\r\n") {
        Ok(text[idx + 4..].to_string())
    } else {
        Ok(text)
    }
}

/// Read until EOF/timeout into `buf` (4 MB cap).
fn read_to_end<R: std::io::Read>(reader: &mut R, buf: &mut Vec<u8>) -> Result<(), String> {
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                break
            }
            Err(_) => break,
        }
        if buf.len() > 4 * 1024 * 1024 {
            break;
        }
    }
    Ok(())
}

fn build_http_request(method: &str, host: &str, path: &str, body: Option<&str>) -> String {
    let path = if path.is_empty() { "/" } else { path };
    let body = body.unwrap_or("");
    let mut req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    if body.is_empty() {
        req = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    }
    req
}

struct ParsedUrl {
    host: String,
    port: u16,
    path: String,
    tls: bool,
}

fn parse_url(url: &str) -> Option<ParsedUrl> {
    let (scheme, rest) = url.split_once("://")?;
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let tls = scheme.eq_ignore_ascii_case("wss") || scheme.eq_ignore_ascii_case("https");
    let default_port = if tls { 443 } else { 80 };
    let (host, port) = match hostport.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().unwrap_or(default_port)),
        None => (hostport.to_string(), default_port),
    };
    Some(ParsedUrl {
        host,
        port,
        path: path.to_string(),
        tls,
    })
}

#[allow(dead_code)]
pub(crate) fn encode_b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}
