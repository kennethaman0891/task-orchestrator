//! Device identity for the TTO gateway.
//!
//! Every desktop install gets a unique identity: a random device id, an
//! Ed25519 keypair (the private key NEVER leaves this machine), and — once
//! paired — a device credential. The private key is stored in the app's
//! data dir with 0600 permissions (0600 on POSIX; ACL-protected on Windows
//! via the user profile dir). The credential is only ever held locally.
//!
//! Nothing here is a secret that the gateway stores; the gateway stores the
//! public key and a hash of the credential only.

use std::fs;
use std::path::PathBuf;

use base64::Engine;
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

/// Human-readable device name shown in "My Devices" (defaults to hostname).
pub fn default_device_name() -> String {
    hostname().unwrap_or_else(|| "TTO Desktop".to_string())
}

fn hostname() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("hostname").arg("-s").output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("hostname")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let out = std::process::Command::new("hostname").output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DeviceIdentity {
    pub device_id: String,
    /// base64 of the 32-byte Ed25519 private key seed.
    pub private_key_seed: String,
    /// base64 of the SPKI DER public key.
    pub public_key_der: String,
    pub device_name: String,
    /// Device credential (random 32 bytes, base64url). Empty until paired.
    pub credential: String,
    /// Gateway URL the device is paired to (e.g. wss://host:port).
    pub gateway_url: String,
}

impl DeviceIdentity {
    pub fn signing_key(&self) -> Option<SigningKey> {
        let seed = base64::engine::general_purpose::STANDARD
            .decode(&self.private_key_seed)
            .ok()?;
        let arr: [u8; 32] = seed.try_into().ok()?;
        Some(SigningKey::from_bytes(&arr))
    }

    pub fn verifying_key(&self) -> Option<VerifyingKey> {
        self.signing_key().map(|k| k.verifying_key())
    }

    pub fn is_paired(&self) -> bool {
        !self.credential.is_empty()
    }
}

/// Create a fresh device identity (new keypair).
pub fn generate_identity(device_name: &str) -> DeviceIdentity {
    let signing = SigningKey::generate(&mut OsRng);
    let verifying = signing.verifying_key();
    let pub_bytes = verifying.to_bytes();

    let device_id = format!(
        "dev-{}",
        hex16(rand::random::<u64>()) + &hex16(rand::random::<u64>())
    );

    DeviceIdentity {
        device_id,
        private_key_seed: base64::engine::general_purpose::STANDARD.encode(signing.to_bytes()),
        public_key_der: base64::engine::general_purpose::STANDARD.encode(pub_bytes),
        device_name: device_name.to_string(),
        credential: String::new(),
        gateway_url: String::new(),
    }
}

fn hex16(v: u64) -> String {
    format!("{v:016x}")
}

/// Path to the identity file: ~/.local/share/tto/gateway-identity.json
/// (on Windows: %APPDATA%/tto/gateway-identity.json).
pub fn identity_path() -> PathBuf {
    let home = crate::home_dir();
    #[cfg(target_os = "windows")]
    {
        home.join("AppData").join("Roaming").join("tto").join("gateway-identity.json")
    }
    #[cfg(not(target_os = "windows"))]
    {
        home.join(".local").join("share").join("tto").join("gateway-identity.json")
    }
}

/// Load the identity if it exists; otherwise generate + persist a new one.
pub fn load_or_create(device_name: &str) -> DeviceIdentity {
    let path = identity_path();
    if let Ok(contents) = fs::read_to_string(&path) {
        if let Ok(ident) = serde_json::from_str::<DeviceIdentity>(&contents) {
            return ident;
        }
    }
    let ident = generate_identity(device_name);
    let _ = save(&ident);
    ident
}

/// Persist the identity with restrictive permissions.
pub fn save(ident: &DeviceIdentity) -> Result<(), String> {
    let path = identity_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(ident).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    set_private_perms(&path);
    Ok(())
}

/// 0600 on POSIX; on Windows NTFS ACLs protect the user profile already.
#[cfg(not(target_os = "windows"))]
fn set_private_perms(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(target_os = "windows")]
fn set_private_perms(_path: &PathBuf) {
    // User profile dirs are ACL-protected by default on Windows.
}

/// DER public key as base64 (what the gateway stores).
#[allow(dead_code)]
pub fn public_key_b64(ident: &DeviceIdentity) -> String {
    ident.public_key_der.clone()
}

/// Sign a challenge nonce (bytes) with the device key. Returns base64 sig.
pub fn sign_challenge(ident: &DeviceIdentity, nonce: &str) -> Option<String> {
    let key = ident.signing_key()?;
    use ed25519_dalek::Signer;
    let sig = key.sign(nonce.as_bytes());
    Some(base64::engine::general_purpose::STANDARD.encode(sig.to_bytes()))
}