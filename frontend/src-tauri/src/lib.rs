//! tto — Terminal Task Orchestrator (native desktop workspace).
//!
//! Rust owns the native terminal engine (PTY via `portable-pty`), the render
//! scheduler and workspace session index. The Python FastAPI server remains a
//! local sidecar for tasks / token usage / file browser / LLM suggestions.

mod gateway;
mod ipc;
mod relay;
mod sidecar;
mod terminal;
mod workspace;
mod django;

pub use gateway::ipc as gateway_ipc;

/// Safe stderr writer that silently swallows broken-pipe errors instead of
/// panicking. The `.app` bundle runs without an attached terminal, so stderr
/// is closed and the default `eprintln!` triggers a main-thread abort.
macro_rules! safe_eprintln {
    ($($arg:tt)*) => {{
        use std::io::Write;
        let _ = writeln!(std::io::stderr(), $($arg)*);
    }};
}

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{Emitter, Manager, WindowEvent};

/// Resolve the user's home directory across platforms.
///
/// macOS/Linux: `$HOME`. Windows: checks `USERPROFILE`, then `HOMEDRIVE+HOMEPATH`.
/// Falls back to `/tmp` on Unix and the system temp dir on Windows if none are set.
pub fn home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                return PathBuf::from(profile);
            }
        }
        if let (Ok(drive), Ok(path)) = (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH")) {
            if !drive.is_empty() && !path.is_empty() {
                return format!("{}{}", drive, path).into();
            }
        }
    }
    // Fallbacks for truly headless / containerised environments.
    std::env::temp_dir()
}

pub struct AppState {
    pub manager: Arc<terminal::manager::TerminalManager>,
    pub workspaces: workspace::WorkspaceIndex,
    /// The Python sidecar child — only `Some` when WE spawned it.
    pub backend: Mutex<Option<std::process::Child>>,
    /// Gateway connection client (outbound WSS to the TTO gateway).
    pub gateway: Arc<gateway::GatewayClient>,
    /// Device identity (id + keypair + credential). Shared with the worker.
    pub gateway_identity: Arc<Mutex<gateway::identity::DeviceIdentity>>,
}

/// Install a non-aborting global panic hook.
///
/// A panic on a background tokio worker (e.g. the sidecar command relay or a
/// terminal auto-create task) would otherwise run the default hook, which calls
/// `abort()` and takes down the whole app with SIGABRT at launch — exactly the
/// intermittent crash signature we saw. Instead we log the full panic
/// (file:line + message + backtrace) to `~/.local/share/tto/rust-panics.log`
/// and swallow it, so a single misbehaving background task can never crash the
/// process. Real bugs are still visible to us through the log.
fn install_panic_hook() {
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    // Only the main thread may abort the process; background workers must not.
    let main_thread = std::thread::current().id();

    std::panic::set_hook(Box::new(move |info| {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let thread = std::thread::current();
        let is_worker = thread.id() != main_thread;
        let backtrace = std::backtrace::Backtrace::force_capture();
        let mut msg = String::new();
        msg.push_str(&format!(
            "[panic-hook] ts={ts} worker={is_worker} thread={:?}\n  {}\n  {backtrace}\n",
            thread.name().unwrap_or("<unnamed>"),
            info
        ));
        // Persistent log so we can always diagnose panics later.
        let log_path: PathBuf =
            home_dir().join(".local/share/tto/rust-panics.log");
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = writeln!(f, "{msg}");
        }
        if is_worker {
            // Swallow background-worker panics: never let them abort the app.
            eprintln!("[tto] background worker panicked (continuing):\n{msg}");
        } else {
            // Main-thread panic still aborts so the failure is not silently
            // swallowed — but the message is now captured for diagnosis.
            eprintln!("[tto] main-thread panic:\n{msg}");
            std::process::abort();
        }
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Native OS file drag-drop. The webview (WKWebView on macOS) does NOT
        // reliably expose dataTransfer.files[].path to the JS side, so we catch
        // the drop here in Rust and emit the absolute paths to the frontend,
        // which already listens for the `tauri://drag-drop` event and routes
        // them into the focused terminal / command line.
        .on_window_event(|window, event| {
            safe_eprintln!("[TTO DRAG] WindowEvent: {:?}", event);
            if let WindowEvent::DragDrop(dnd) = event {
                safe_eprintln!("[TTO DRAG] DragDropEvent received: {:?}", dnd);
                use tauri::DragDropEvent;
                match dnd {
                    DragDropEvent::Drop { paths, position: _ } => {
                        safe_eprintln!("[TTO DRAG] Drop paths: {:?}", paths);
                        let payload = serde_json::json!({ "paths": paths });
                        safe_eprintln!("[TTO DRAG] Emitting payload: {}", payload);
                        let _ = window.emit("tto://drag-drop", payload);
                    }
                    DragDropEvent::Enter { paths, position: _ } => {
                        safe_eprintln!("[TTO DRAG] Enter paths: {:?}", paths);
                    }
                    DragDropEvent::Over { position: _ } => {
                        safe_eprintln!("[TTO DRAG] Over");
                    }
                    DragDropEvent::Leave => {
                        safe_eprintln!("[TTO DRAG] Leave");
                    }
                    _ => {}
                }
            }
        })
        .setup(|app| {
            let manager = Arc::new(terminal::manager::TerminalManager::new(app.handle().clone()));
            terminal::scheduler::spawn_scheduler(manager.clone());
            terminal::manager::spawn_detector(manager.clone());
            // Kill all PTY children on exit so shells/TUIs (opencode, etc.) are
            // never orphaned with a dead terminal — orphaned TUIs spin at 100%
            // CPU and can crash their runtime (Bun SIGTRAP in the renderer).
            let backend_child = sidecar::spawn_if_needed();
            // Sidecar command relay: lets the Python backend forward task
            // commands for Rust PTY sessions (it cannot inject into them).
            relay::spawn(app.handle().clone(), manager.clone());

            // Gateway client: device identity + outbound WSS worker. The worker
            // runs even when the UI is closed so the device stays ONLINE (and
            // remote terminal/file access keeps working).
            let gateway_client = Arc::new(gateway::GatewayClient::new());
            let gateway_identity = Arc::new(Mutex::new(
                gateway::identity::load_or_create(&gateway::identity::default_device_name()),
            ));
            tauri::async_runtime::spawn(gateway::run_connection(
                app.handle().clone(),
                manager.clone(),
                gateway_client.clone(),
                gateway_identity.clone(),
            ));
// Set the window title-bar icon to match the app icon.
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
                // Debug: listen for webview-level DragDrop events (separate from window events)
                let _ = window.on_webview_event(|event| {
                    safe_eprintln!("[TTO DRAG] WebviewEvent: {:?}", event);
                });
                // ---- Webview page-load diagnostic (white-screen tracing) ----
                // 2s after launch, evaluate JS inside the webview and write the
                // resulting DOM state to rust-diag.log. This tells us whether
                // tauri://localhost served our index.html, whether the React
                // bundle executed, and whether #root got content — decisive for
                // the white-screen bug (window shows but webview never loads).
                {
                    use std::io::Write;
                    use std::time::{SystemTime, UNIX_EPOCH};
                    let log_path = crate::home_dir().join(".local/share/tto/rust-diag.log");
                    let js = r#"JSON.stringify({
                        ready: document.readyState,
                        url: location.href,
                        title: document.title,
                        rootChildren: (document.getElementById('root')?.children.length ?? -1),
                        rootText: (document.getElementById('root')?.innerText ?? '').slice(0, 120),
                        hasReact: !!(window.__REACT_DEVTOOLS_GLOBAL_HOOK__),
                        bodyBg: getComputedStyle(document.body).backgroundColor
                    })"#;
                    let ts = || SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
                    let w = window.clone();
                    let _ = window.eval_with_callback(js, move |result| {
                        let mut f = std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&log_path)
                            .ok();
                        if let Some(f) = f.as_mut() {
                            let _ = writeln!(f, "{} | WEBVIEW-STATE {}", ts(), result);
                        } else {
                            safe_eprintln!("[tto] WEBVIEW-STATE {}", result);
                        }
                        let _ = w;
                    });
                }
            }
            app.manage(Arc::new(AppState {
                manager: manager.clone(),
                workspaces: Default::default(),
                backend: Mutex::new(backend_child),
                gateway: gateway_client,
                gateway_identity,
            }));
            // Sidecar supervisor: every 20 s verify the backend answers AND
            // can still list every macOS-TCC-protected workspace folder
            // (~/Documents, ~/Desktop, ~/Downloads). A sidecar that passes
            // /api/health but fails those folders is TCC-broken (an orphaned
            // sidecar from a previous run carries a stale macOS permission
            // attribution) — reclaim the port and respawn a fresh child
            // attributed to THIS app instance so workspace permissions heal
            // themselves without any user action.
            {
                let state2 = app.state::<Arc<AppState>>().inner().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(20));
                    let Some(child) = sidecar::supervisor_tick() else {
                        continue;
                    };
                    let mut b = state2.backend.lock();
                    if let Some(mut old) = b.replace(child) {
                        // The replaced child was SIGTERMed by the reclaim;
                        // reap it so it never lingers as a zombie.
                        let _ = old.wait();
                    }
                });
            }
            // Diagnostic: log page load events to a file so we can see what the webview does.
            {
                use std::io::Write;
                use std::time::{SystemTime, UNIX_EPOCH};
                let ts = || SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
                let log_path = crate::home_dir().join(".local/share/tto/rust-diag.log");
                if let Some(parent) = log_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
                    let _ = writeln!(f, "{} | setup done", ts());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::terminal_create,
            ipc::terminal_attach,
            ipc::terminal_detach,
            ipc::terminal_get_scrollback,
            ipc::terminal_subscribe,
            ipc::terminal_unsubscribe,
            ipc::terminal_write,
            ipc::terminal_drop_files,
            ipc::terminal_send_command,
            ipc::terminal_resize,
            ipc::terminal_close,
            ipc::terminal_restart,
            ipc::terminal_list,
            ipc::terminal_set_title,
            ipc::terminal_set_tui,
            ipc::terminal_set_focus,
            ipc::terminal_set_visible,
            ipc::terminal_set_grid_mode,
            ipc::terminal_batch_resize,
            ipc::terminal_diagnostics,
            ipc::workspace_index_set,
            ipc::workspace_index_get,
            ipc::sidecar_status,
            ipc::sidecar_port,
            ipc::open_devtools,
            gateway_ipc::gateway_status,
            gateway_ipc::gateway_enabled,
            gateway_ipc::gateway_set_enabled,
            gateway_ipc::gateway_pair,
            gateway_ipc::gateway_pair_status,
            gateway_ipc::gateway_pair_claim,
            gateway_ipc::gateway_set_url,
            gateway_ipc::gateway_identity,
            ipc::pick_folder,
            ipc::get_home_dir,
            ipc::path_exists,
            ipc::get_launch_cwd,
            ipc::ego_lite_status,
            ipc::django_extract_zip,
            ipc::django_analyze,
            ipc::django_fix,
            ipc::django_run_checks,
            ipc::django_package,
            ipc::django_cleanup_old_projects,
            ipc::django_check_python,
            ipc::open_url,
            ipc::reveal_in_finder,
            ipc::open_app,
            ipc::is_app_running,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tto")
        .run(|app_handle, event| {
            // Kill all PTY children on exit so shells/TUIs (opencode, etc.) are
            // never orphaned with a dead terminal — orphaned TUIs spin at 100%
            // CPU and can crash their runtime (Bun SIGTRAP in the renderer).
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                    state.manager.kill_all();
                    // Gracefully stop the sidecar WE spawned (SIGTERM so it can
                    // flush state on shutdown; externally-started servers are
                    // left alone).
                    if let Some(mut child) = state.backend.lock().take() {
                        sidecar::stop(&mut child);
                    }
                }
            }
        });
}
