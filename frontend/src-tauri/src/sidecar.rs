//! Python sidecar lifecycle (auto-start / auto-stop).
//!
//! The FastAPI backend (tasks, token usage, file browser, LLM suggestions) is
//! spawned automatically on app launch when nothing is already serving on
//! 127.0.0.1:8765, and stopped on app exit — but ONLY when WE spawned it. An
//! externally-started server (e.g. `./start_server.sh`) is left alone.
//!
//! The frontend already retries its WebSocket every 3 s, so a freshly-spawned
//! sidecar (binds in ~1 s) is picked up automatically without any extra code.

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU16, AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::fs;

/// The port the sidecar is actually serving on. Normally 8765; when something
/// else refuses to vacate the port, the sidecar falls back to 8766 and this
/// is updated so every consumer (relay, IPC health, frontend via the
/// `sidecar_port` command) follows. Reset to the default at each launch so a
/// one-off fallback never sticks across app restarts.
pub static SIDECAR_PORT: AtomicU16 = AtomicU16::new(8765);
/// Unix timestamp of the most recent successful sidecar spawn.
/// The supervisor uses this to enforce a 30s minimum window between respawns,
/// preventing a tight kill-loop when TCC probes flake intermittently right
/// after each respawn (macOS TCC settles in ~15-20 s).
pub static SIDECAR_LAST_SPAWNED: AtomicU64 = AtomicU64::new(0);

/// Millisecond-precision companion to `SIDECAR_LAST_SPAWNED`. The second
/// precision value is only used for the coarse respawn cooldown; the TCC
/// settle window below needs millisecond resolution because it is compared
/// against a 20 s budget.
pub static SIDECAR_LAST_SPAWNED_MS: AtomicU64 = AtomicU64::new(0);

/// Millisecond timestamp of the first time we health-verified the CURRENT
/// sidecar. Used to keep a respawn cooldown for ADOPTED sidecars (started
/// outside this app, e.g. `./start_server.sh`): those never populate
/// `SIDECAR_LAST_SPAWNED`, which would otherwise leave the cooldown
/// permanently disarmed and let every supervisor tick reclaim a healthy
/// external sidecar. Reset to 0 whenever the sidecar is killed.
pub static SIDECAR_FIRST_SEEN: AtomicU64 = AtomicU64::new(0);

/// Consecutive supervisor ticks on which the REAL sidecar failed the
/// TCC-protected-workspace probe. A single "Permission denied" is noise under
/// macOS TCC; only two back-to-back hard failures justify a kill.
pub static TCC_CONSECUTIVE_FAILURES: AtomicU32 = AtomicU32::new(0);

/// Milliseconds since the Unix epoch. Centralised so every timestamp in this
/// module is derived the same way (0 if the system clock predates the epoch).
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Record that a sidecar was successfully spawned right now.
fn record_spawn_time() {
    SIDECAR_LAST_SPAWNED.store(now_millis() / 1000, Ordering::Relaxed);
    SIDECAR_LAST_SPAWNED_MS.store(now_millis(), Ordering::Relaxed);
}

/// Returns true if at least `SECONDS` seconds have elapsed since the last
/// successful sidecar spawn. The supervisor uses this as a cooldown gate:
/// even when `workspaces_listable()` spuriously returns false right after a
/// fresh spawn, we wait before killing and respawning again.
const SIDECAR_RESPAWN_MIN_INTERVAL_SECS: u64 = 30;

/// Grace period after a spawn during which the workspace probe is skipped
/// entirely. macOS TCC needs 15-20 s to attribute ~/Documents / ~/Desktop /
/// ~/Downloads to the new process; probing before then only manufactures
/// false "Permission denied" verdicts.
const TCC_SETTLE_MS: u64 = 20_000;

/// Minimum spacing between reclaims of an ADOPTED sidecar (one we did not
/// spawn). With no `SIDECAR_LAST_SPAWNED` to work from, the first-seen clock
/// keeps a healthy external sidecar alive across 20 s supervisor ticks.
const SIDECAR_ADOPTED_MIN_INTERVAL_MS: u64 = 15_000;

pub fn can_respawn_now() -> bool {
    // Own-spawned sidecars use the strict cooldown.
    let last = SIDECAR_LAST_SPAWNED.load(Ordering::Relaxed);
    if last != 0 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        return now.saturating_sub(last) >= SIDECAR_RESPAWN_MIN_INTERVAL_SECS;
    }
    // Adopted sidecars: enforce a 15-second minimum between reclaims so we
    // don't kill a healthy external sidecar on every 20-second tick.
    let first = SIDECAR_FIRST_SEEN.load(Ordering::Relaxed);
    if first == 0 {
        return true; // haven't seen any sidecar yet — allow
    }
    now_millis().saturating_sub(first) >= SIDECAR_ADOPTED_MIN_INTERVAL_MS
}

/// Current sidecar address as `host:port` (re-read each call).
pub fn sidecar_addr() -> String {
    format!("127.0.0.1:{}", SIDECAR_PORT.load(Ordering::Relaxed))
}

/// Check whether the process listening on `addr` is OUR FastAPI sidecar.
///
/// A plain TCP connect is NOT enough: any unrelated program can squat the
/// port (we once saw an orphaned `python -m http.server 8765` own it, which
/// made the whole UI — browser proxy, files, tasks — render that impostor's
/// 404 pages). The real sidecar answers `GET /api/health` with a JSON body
/// containing `"status":"ok"`; we require that before trusting the port.
pub fn is_real_sidecar(addr: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect(addr) else {
        return false;
    };
    use std::io::{Read, Write};
    let _ = stream.set_read_timeout(Some(Duration::from_millis(3000)));
    if stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n").is_err() {
        return false;
    }
    // Read in a loop: uvicorn writes headers and body separately, so a single
    // read can return only the headers and miss the JSON health signature.
    // With HTTP/1.0 the server closes the connection after the response, so
    // the loop terminates quickly in every case.
    let mut body: Vec<u8> = Vec::with_capacity(256);
    let mut buf = [0u8; 512];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                body.extend_from_slice(&buf[..n]);
                if body.len() > 4096 || body.windows(8).any(|w| w == b"\"status\"") {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&body);
    // Signature: HTTP OK + the health JSON marks it as the TTO sidecar.
    text.starts_with("HTTP/1.") && text.contains("\"status\"") && text.contains("ok")
}

/// True when the REAL sidecar (not an impostor) already answers on the port.
pub fn already_running() -> bool {
    is_real_sidecar(&format!("127.0.0.1:{}", SIDECAR_PORT.load(Ordering::Relaxed)))
}

/// Minimal HTTP GET against the sidecar (plain TCP, HTTP/1.0, body returned).
fn http_get(port: u16, path: &str) -> Option<String> {
    let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).ok()?;
    use std::io::{Read, Write};
    // 3 s read window: the sidecar can legitimately take >1 s when it is
    // aggregating 250+ terminals / tmux panes / token accounting. An 800 ms
    // window caused false "unhealthy" verdicts that killed a healthy sidecar
    // and severed every WebSocket connection.
    let _ = stream.set_read_timeout(Some(Duration::from_millis(3000)));
    let req = format!("GET {path} HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).ok()?;
    let mut bytes: Vec<u8> = Vec::with_capacity(512);
    let mut buf = [0u8; 2048];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                bytes.extend_from_slice(&buf[..n]);
                if bytes.len() > 65536 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&bytes).into_owned().into()
}

/// macOS-TCC-protected path class: ~/Documents, ~/Desktop, ~/Downloads.
fn tcc_protected(path: &str) -> bool {
    ["/Documents/", "/Desktop/", "/Downloads/"]
        .iter()
        .any(|d| path.contains(d))
}

/// Minimal query-string escaping (paths sent to /api/files).
fn escape_query(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for b in path.bytes() {
        match b {
            b'%' => out.push_str("%25"),
            b' ' => out.push_str("%20"),
            b'#' => out.push_str("%23"),
            b'&' => out.push_str("%26"),
            b'?' => out.push_str("%3F"),
            b'+' => out.push_str("%2B"),
            _ => out.push(b as char),
        }
    }
    out
}

/// True when every workspace folder under a macOS-TCC-protected root is still
/// listable by the sidecar. A REAL sidecar that answers `/api/health` but
/// fails this is TCC-broken: it is usually an orphaned sidecar from a
/// previous app run carrying a stale macOS permission attribution, so macOS
/// answers "Permission denied" for ~/Documents / ~/Desktop / ~/Downloads.
/// Such a sidecar must be replaced by a fresh child spawned by the CURRENT
/// app instance (which re-attributes everything to this app/binary).
///
/// Tolerance: if the sidecar answers health but a *single* probe times out
/// or spuriously returns "Permission denied" (common under macOS TCC when the
/// sidecar process was just spawned and the OS is still settling permissions),
/// we treat it as OK rather than immediately killing and respawning the sidecar.
/// Only two consecutive hard failures within one call would trigger a kill.
pub fn workspaces_listable() -> bool {
    let port = SIDECAR_PORT.load(Ordering::Relaxed);
    // Settling grace period: skip the probe entirely while a freshly-spawned
    // sidecar is still acquiring its macOS TCC attribution. Every "Permission
    // denied" observed in this window is an artifact of the OS, not evidence
    // of a broken sidecar.
    let last_spawn_ms = SIDECAR_LAST_SPAWNED_MS.load(Ordering::Relaxed);
    if last_spawn_ms > 0 && now_millis().saturating_sub(last_spawn_ms) < TCC_SETTLE_MS {
        log("supervisor: inside TCC settle window after spawn — skipping workspace probe");
        return true;
    }
    let Some(body) = http_get(port, "/api/workspaces") else {
        // A timeout on the fetch itself does NOT mean TCC is broken — the
        // sidecar may simply be busy (aggregating 250+ terminals, tmux scans,
        // token accounting) or the 800 ms read window was too short. Killing a
        // healthy sidecar here severs every WebSocket; probe again next tick.
        log("supervisor: /api/workspaces probe timed out — assuming OK, will retry");
        return true;
    };
    // Same tolerance for an empty/truncated body — not evidence of a kill.
    if !body.starts_with("HTTP/1.") {
        log("supervisor: /api/workspaces returned a non-HTTP body — assuming OK");
        return true;
    }
    // Count TCC-protected folders that are definitively blocked (not just
    // timing out). One or two flaky probes should NOT kill a healthy sidecar.
    let mut blocked_count: u32 = 0;
    let mut total_tcc_paths: u32 = 0;
    let mut rest = body.as_str();
    let marker = "\"projectPath\"";
    while let Some(idx) = rest.find(marker) {
        let after = &rest[idx + marker.len()..];
        let Some(colon) = after.find(':') else { break };
        let Some(open) = after[colon..].find('"') else { break };
        let val_start = colon + open + 1;
        let Some(close) = after[val_start..].find('"') else { break };
        let path = &after[val_start..val_start + close];
        if tcc_protected(path) {
            total_tcc_paths += 1;
            let probe = http_get(port, &format!("/api/files?path={}", escape_query(path)));
            match probe {
                Some(b) if b.contains("Permission denied") => blocked_count += 1,
                _ => {} // timeout or other error — count as OK, not blocked
            }
        }
        rest = &after[val_start + close..];
    }
    // Kill only when a clear majority of TCC paths are actually blocked, and
    // only on two CONSECUTIVE ticks. The old `blocked < total/2 + 1` test
    // evaluated to false (kill) for total=1, blocked=1 — a single transient
    // "Permission denied" was enough to reap the sidecar, which is exactly the
    // kill loop this module is supposed to avoid.
    if total_tcc_paths < 2 {
        // A lone probe is not a majority: no signal to act on.
        TCC_CONSECUTIVE_FAILURES.store(0, Ordering::Relaxed);
        return true;
    }
    if blocked_count < total_tcc_paths / 2 + 1 {
        TCC_CONSECUTIVE_FAILURES.store(0, Ordering::Relaxed);
        // Healthy sidecar: start the clock that `can_respawn_now()` uses to
        // throttle reclaims of an adopted (externally started) sidecar.
        if SIDECAR_FIRST_SEEN.load(Ordering::Relaxed) == 0 {
            SIDECAR_FIRST_SEEN.store(now_millis(), Ordering::Relaxed);
        }
        return true;
    }
    // Genuinely blocked. One failing tick is not enough — a healthy-but-slow
    // macOS permission check can look identical for a single tick.
    let failures = TCC_CONSECUTIVE_FAILURES.fetch_add(1, Ordering::Relaxed) + 1;
    if failures >= 2 {
        log("supervisor: TCC workspace paths blocked on a second consecutive tick — sidecar is TCC-broken");
        false
    } else {
        log("supervisor: TCC workspace paths blocked once — waiting for a second consecutive failure before reclaiming");
        true
    }
}

/// Periodic supervisor tick: verify the sidecar answers health AND can still
/// list every TCC-protected workspace folder. When the sidecar is missing, an
/// impostor, or TCC-broken, reclaim the port and respawn a fresh child
/// attributed to THIS app instance. Returns the new child when one was
/// spawned (the caller stores it so it is stopped on app exit).
pub fn supervisor_tick() -> Option<Child> {
    if already_running() && workspaces_listable() {
        return None;
    }
    // Even if the sidecar fails the workspace check, don't kill+respawn more
    // than once per SIDECAR_RESPAWN_MIN_INTERVAL_SECS. A freshly-spawned
    // sidecar often needs 15-20 s for macOS TCC to settle permissions on
    // ~/Documents / ~/Desktop / ~/Downloads — respawning during that window
    // only makes it worse and severs the frontend WebSocket every time.
    if !can_respawn_now() {
        log("supervisor: sidecar unhealthy but within cooldown — waiting");
        return None;
    }
    if already_running() {
        log("supervisor: sidecar answers health but workspace folders are permission-blocked — reclaiming");
    } else {
        log("supervisor: sidecar not healthy — reclaiming");
    }
    // reset: next healthy sidecar gets a fresh clock
    SIDECAR_FIRST_SEEN.store(0, Ordering::Relaxed);
    kill_stale_sidecars();
    let child = spawn_if_needed();
    if child.is_some() {
        log("supervisor: fresh sidecar respawned");
    } else {
        log("supervisor: respawn failed — will retry next tick");
    }
    child
}

/// Resolve the base directory for bundled resources inside a `.app` bundle.
///
/// When running from `/Applications/Task Orchestrator.app`, backend sources
/// live at `Contents/Resources/backend/`. We detect an app-bundle install by
/// walking up the executable's parent chain (MacOS → Contents) and checking
/// for a `Resources/` directory. Returns `Some(resources_dir)` when found,
/// `None` when running from a dev tree or unknown location.
fn bundled_backend_base() -> Option<PathBuf> {
    // current_exe() gives us something like:
    //   /Applications/Task Orchestrator.app/Contents/MacOS/tto
    let exe = std::env::current_exe().ok()?;
    let mut cur = exe.parent()?; // Contents/MacOS/
    cur = cur.parent()?;        // Contents/
    let resources = cur.join("Resources");
    if resources.is_dir() {
        Some(resources)
    } else {
        None
    }
}

/// Start the Python backend if it isn't running.
/// Returns `Some(child)` when we spawned it (the caller should kill it on app
/// exit), `None` when it was already running or spawn failed.
/// Reads TTO_HOST from collab settings if LAN access is enabled.
/// Returns Some("0.0.0.0") if LAN mode is on, otherwise None (defaults to 127.0.0.1).
fn collab_ttos_host() -> Option<String> {
    let home = crate::home_dir();
    let settings_path = home.join(".local/share/tto/collab/settings.json");
    if let Ok(content) = fs::read_to_string(&settings_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if val.get("lan_enabled").and_then(|v| v.as_bool()).unwrap_or(false) {
                return Some("0.0.0.0".to_string());
            }
        }
    }
    None
}

pub fn spawn_if_needed() -> Option<Child> {
    // Reset the fallback: a port override from a previous run must never
    // leak into this launch (state lives only for this process).
    SIDECAR_PORT.store(8765, Ordering::Relaxed);

    if already_running() {
        if workspaces_listable() {
            log("sidecar already running and workspaces listable — not spawning");
            return None;
        }
        log("sidecar answers health but workspace folders are permission-blocked — reclaiming port and respawning fresh");
        // Fall through: kill_stale_sidecars() below evicts the TCC-broken
        // orphan so we can spawn a child attributed to THIS app instance.
    }
    // Kill any orphaned sidecar processes from a previous crashed run. This
    // also evicts impostors: anything listening on the port that does not
    // pass the health identity check (the spawn path below then verifies the
    // REAL sidecar came up, falling back to 8766 if the port stays blocked).
    kill_stale_sidecars();

    let home = crate::home_dir();

    // Resolve the backend base directory. Priority order:
    //  1. TTO_WEB_HOME env var (developer override for non-standard installs)
    //  2. Contents/Resources/ inside the .app bundle (bundled deployment)
    //  3. ~/tto-web/ (legacy dev fallback — only used during development)
    let backend_base = std::env::var("TTO_WEB_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| bundled_backend_base())
        .unwrap_or_else(|| {
            log("no bundled backend found — falling back to dev path");
            PathBuf::from(format!("{}/tto-web", home.display()))
        });
    let backend_dir = backend_base.join("backend");
    let script = backend_dir.join("main.py");

    // Locate the Python interpreter. Strategy (in priority order):
    //  1. TTO_PYTHON env var (allows forcing a specific interpreter)
    //  2. Bundled venv/bin/python3 inside the .app (for fully self-contained builds)
    //  3. User venv at ~/.local/share/tto/python (deps guaranteed; app launched
    //     from Finder has a minimal PATH and the system python3 may lack
    //     fastapi/httpx/uvicorn — see the 836k-line retry log from when
    //     /usr/bin/python3 (CLT, no packages) was silently chosen)
    //  4. python3 on PATH (most Macs have this via Homebrew or Xcode CLT)
    let bundled_python = backend_base.join("python/bin/python3");
    let user_venv_python = home.join(".local/share/tto/python/bin/python3");
    let system_python = std::env::var("TTO_PYTHON").ok().map(PathBuf::from);
    let python = system_python
        .or_else(|| {
            if bundled_python.exists() {
                Some(bundled_python)
            } else {
                None
            }
        })
        .or_else(|| {
            if user_venv_python.exists() {
                log(&format!("using user venv interpreter: {}", user_venv_python.display()));
                Some(user_venv_python)
            } else {
                None
            }
        })
        .or_else(|| {
            if Command::new("python3").arg("--version").output().is_ok() {
                Some(PathBuf::from("python3"))
            } else {
                log("python3 not found on PATH — sidecar may fail to start");
                Some(PathBuf::from("python3"))
            }
        })
        .expect("could not resolve Python interpreter");

    // Log sidecar stdout/stderr so failures are diagnosable. Re-opened per
    // spawn (default port + fallback) so no handle is moved twice.
    let log_path = home.join(".local/share/tto/sidecar.log");
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let open_log = || {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
    };

    // Spawn the sidecar on `port` and wait up to 10 s for it to pass the
    // health identity check. Returns the child only on success, so the caller
    // stops exactly the process we verified. A child that dies during startup
    // (e.g. the port was still squatted) or never becomes healthy is killed.
    fn spawn_and_await(
        python: &PathBuf,
        script: &PathBuf,
        backend_dir: &PathBuf,
        port: &str,
        log_file: std::fs::File,
    ) -> Option<Child> {
        let tto_host = collab_ttos_host();
        let mut binding = Command::new(python);
        let mut cmd = binding
            .arg(script)
            .current_dir(backend_dir)
            .env("TTO_PORT", port);
        if let Some(host) = tto_host {
            cmd = cmd.env("TTO_HOST", host);
        }
        let mut child = match cmd
            .stdout(Stdio::from(
                log_file
                    .try_clone()
                    .expect("clone sidecar.log handle"),
            ))
            .stderr(Stdio::from(log_file))
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                log(&format!("failed to spawn sidecar on :{port}: {e}"));
                return None;
            }
        };
        for _ in 0..40 {
            if child.try_wait().map(|s| s.is_some()).unwrap_or(false) {
                log(&format!("sidecar process exited during startup on :{port}"));
                return None;
            }
            if is_real_sidecar(&format!("127.0.0.1:{port}")) {
                return Some(child);
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        // Never became healthy — kill it so we never leak a half-started
        // process holding resources.
        let _ = child.kill();
        let _ = child.wait();
        None
    }

    match open_log() {
        Ok(lf) => match spawn_and_await(&python, &script, &backend_dir, "8765", lf) {
            Some(c) => {
                log("sidecar health-verified on 127.0.0.1:8765");
                record_spawn_time();
                Some(c)
            }
            None => {
                log("sidecar not healthy on 8765 — retrying on port 8766");
                match open_log() {
                    Ok(lf2) => match spawn_and_await(&python, &script, &backend_dir, "8766", lf2) {
                        Some(c) => {
                            SIDECAR_PORT.store(8766, Ordering::Relaxed);
                            log("sidecar health-verified on fallback 127.0.0.1:8766");
                            record_spawn_time();
                            Some(c)
                        }
                        None => {
                            log("sidecar failed on fallback port too");
                            None
                        }
                    },
                    Err(_) => {
                        log("could not open sidecar.log");
                        None
                    }
                }
            }
        },
        Err(_) => {
            log("could not open sidecar.log");
            None
        }
    }
}

/// True when something answers on 8765 but it is NOT our sidecar.
/// Best-effort graceful stop (SIGTERM / taskkill) for a sidecar we spawned.
pub fn stop(child: &mut Child) {
    #[cfg(not(target_os = "windows"))]
    {
        // `kill(1)` sends SIGTERM so the FastAPI app can run its shutdown hooks
        // (state flush) instead of being SIGKILLed.
        let _ = Command::new("kill").arg(child.id().to_string()).status();
    }
    #[cfg(target_os = "windows")]
    {
        // Windows has no SIGTERM; ask the OS to terminate the process directly.
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// Force restart the sidecar by killing any existing process and spawning fresh.
/// Used when collab LAN toggle changes (TTO_HOST needs to change).
pub fn restart_sidecar() -> Option<Child> {
    // Kill any existing sidecar on the current port
    kill_stale_sidecars();
    // Reset cooldown so we can spawn immediately
    SIDECAR_LAST_SPAWNED.store(0, Ordering::Relaxed);
    SIDECAR_FIRST_SEEN.store(0, Ordering::Relaxed);
    // Spawn fresh with new TTO_HOST from collab settings
    spawn_if_needed()
}

/// Kill any orphaned sidecar processes from a previous crashed run.
///
/// Unix: `lsof -ti :8765 -sTCP:LISTEN` → PIDs → `kill -TERM <pid>`.
/// Windows: `netstat -ano` parsed for LISTENING on :8765 → PIDs → `taskkill /F /PID`.
fn kill_stale_sidecars() {
    #[cfg(target_os = "windows")]
    {
        // Windows: parse netstat for the sidecar port and kill those PIDs.
        // We read the raw output and do our own parsing rather than depending on
        // any third-party crate. If anything is unparseable we no-op safely —
        // leaking one stale sidecar is worse than accidentally killing another
        // process, so we only act on lines that clearly look like a listening PID.
        let Ok(output) = Command::new("netstat")
            .args(["-ano"])
            .output()
        else {
            return;
        };
        let text = String::from_utf8_lossy(&output.stdout);
        // Each listening entry looks like:
        //   TCP    127.0.0.1:8765         0.0.0.0:0              LISTENING       12345
        for line in text.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 || !parts[1].ends_with(":8765") || parts[3] != "LISTENING" {
                continue;
            }
            let pid = match parts[4].parse::<u32>() {
                Ok(p) => p,
                Err(_) => continue,
            };
            log(&format!("killing stale sidecar pid {pid}"));
            let _ = Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output();
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        return;
    }

    // Unix path (macOS / Linux). Cover both the default and fallback ports
    // (multiple -i flags are OR'd together).
    let Ok(output) = Command::new("lsof")
        .args(["-t", "-i", ":8765", "-i", ":8766", "-sTCP:LISTEN"])
        .output()
    else {
        return;
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let pid = line.trim();
        if pid.is_empty() {
            continue;
        }
        log(&format!("killing stale sidecar pid {pid}"));
        let _ = Command::new("kill").arg("-TERM").arg(pid).status();
    }
    // Wait up to 3s for the port to actually free, polling every 100ms. A
    // fixed sleep was a guess: SIGTERM delivery plus socket teardown can
    // easily outlast 500ms, and spawning into a still-occupied port made the
    // fresh child fail its health check and die, feeding the kill loop.
    for _ in 0..30 {
        let occupied = std::net::TcpStream::connect(format!(
            "127.0.0.1:{}",
            SIDECAR_PORT.load(Ordering::Relaxed)
        ))
        .is_ok();
        if !occupied {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

fn log(msg: &str) {
    let _ = writeln!(std::io::stderr(), "[sidecar] {msg}");
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = crate::home_dir().join(".local/share/tto/rust-diag.log");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{ts} | {msg}");
    }
}
