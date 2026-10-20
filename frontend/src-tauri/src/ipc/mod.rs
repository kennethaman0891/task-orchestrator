//! Tauri IPC: terminal commands + streaming channels (spec §36).
//!
//! Terminal DATA flows through binary channels (Vec<u8>) — never through
//! React state. UI metadata flows through cheap command invocations.
//! All arguments are validated (id lookup, dimension clamps) before touching
//! the PTY (spec §37).

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::terminal::session::{SessionDiag, SessionMeta};
use crate::AppState;

#[tauri::command]
pub async fn terminal_create(
    state: State<'_, Arc<AppState>>,
    cwd: Option<String>,
    workspace_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    command: Option<String>,
) -> Result<SessionMeta, String> {
    eprintln!("[IPC] terminal_create cwd={:?} ws_id={:?} cols={} rows={} cmd={:?}", cwd, workspace_id, cols.unwrap_or(120), rows.unwrap_or(40), command);
    // Async command: runs on the Tauri worker runtime, NOT the main (UI) thread.
    // This keeps PTY process spawn + the `ps` tty lookup (pty::tty_for_pid)
    // from blocking the webview and causing "Not Responding" freezes on create.
    let result = state.manager.create(
        cwd,
        workspace_id.unwrap_or_default(),
        cols.unwrap_or(120),
        rows.unwrap_or(40),
        command,
    );
    eprintln!("[IPC] terminal_create result: {:?}", result.as_ref().map(|m| &m.id).unwrap_or(&"ERROR".to_string()));
    result
}

#[tauri::command]
pub async fn terminal_attach(
    state: State<'_, Arc<AppState>>,
    id: String,
    on_output: Channel<Vec<u8>>,
    on_exit: Channel<()>,
) -> Result<(), String> {
    eprintln!("[IPC] terminal_attach id={}", id);
    let r = state.manager.attach(&id, on_output, on_exit);
    eprintln!("[IPC] terminal_attach id={} -> {:?}", id, r.as_ref().err());
    r
}

#[tauri::command]
pub async fn terminal_detach(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    state.manager.detach(&id)
}

/// Return the full persistent scrollback for a session (FIX: full-history
/// replay). The frontend calls this after (re)creating a renderer so the
/// terminal shows the ENTIRE output history instead of only the newest chunks.
#[tauri::command]
pub async fn terminal_get_scrollback(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<u8>, String> {
    state.manager.get_scrollback(&id)
}

/// Space view: secondary read-only mirror channel (primary renderer untouched).
#[tauri::command]
pub async fn terminal_subscribe(
    state: State<'_, Arc<AppState>>,
    id: String,
    sub_id: u64,
    on_output: Channel<Vec<u8>>,
) -> Result<(), String> {
    state.manager.subscribe(&id, sub_id, on_output)
}

/// Remove a Space view mirror subscriber (idempotent).
#[tauri::command]
pub async fn terminal_unsubscribe(
    state: State<'_, Arc<AppState>>,
    id: String,
    sub_id: u64,
) -> Result<(), String> {
    state.manager.unsubscribe(&id, sub_id)
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, Arc<AppState>>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    // Async: PTY write_all+flush no longer runs on the main thread, so typing
    // into a busy/backpressured terminal can't freeze the webview.
    state.manager.write(&id, &data)
}

#[tauri::command]
pub async fn terminal_send_command(
    state: State<'_, Arc<AppState>>,
    id: String,
    command: String,
) -> Result<(), String> {
    state.manager.send_command(&id, &command)
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, Arc<AppState>>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.manager.resize(&id, cols, rows)
}

#[tauri::command]
pub async fn terminal_close(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    state.manager.close(&id)
}

#[tauri::command]
pub async fn terminal_restart(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    // Async: shell respawn + `ps` tty lookup run off the main thread.
    state.manager.restart(&id)
}

#[tauri::command]
pub async fn terminal_list(state: State<'_, Arc<AppState>>) -> Result<Vec<SessionMeta>, String> {
    Ok(state.manager.list())
}

#[tauri::command]
pub async fn terminal_set_title(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: String,
) -> Result<(), String> {
    state.manager.set_title(&id, &title);
    Ok(())
}

#[tauri::command]
pub async fn terminal_set_tui(
    state: State<'_, Arc<AppState>>,
    id: String,
    active: bool,
) -> Result<(), String> {
    state.manager.set_tui(&id, active);
    Ok(())
}

#[tauri::command]
pub async fn terminal_set_focus(
    state: State<'_, Arc<AppState>>,
    id: String,
    focused: bool,
) -> Result<(), String> {
    state.manager.set_focus(&id, focused);
    Ok(())
}

#[tauri::command]
pub async fn terminal_set_visible(
    state: State<'_, Arc<AppState>>,
    id: String,
    visible: bool,
) -> Result<(), String> {
    state.manager.set_visible(&id, visible);
    Ok(())
}

/// Update the grid layout mode for a session (auto | grid | compact | large).
/// Stored in metadata so the scheduler and diagnostics know the presentation
/// context.
#[tauri::command]
pub async fn terminal_set_grid_mode(
    state: State<'_, Arc<AppState>>,
    id: String,
    mode: String,
) -> Result<(), String> {
    state.manager.set_grid_mode(&id, &mode);
    Ok(())
}

/// Batch-resize all sessions in a workspace to the given dimensions.
/// Called when the user switches grid layout modes so every terminal gets a
/// SIGWINCH at the new card size in one pass.
#[tauri::command]
pub async fn terminal_batch_resize(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    cols: u16,
    rows: u16,
) -> Result<usize, String> {
    Ok(state.manager.batch_resize(&workspace_id, cols, rows))
}

#[tauri::command]
pub async fn terminal_drop_files(
    state: State<'_, Arc<AppState>>,
    id: String,
    paths: Vec<String>,
) -> Result<(), String> {
    // Shell-escape each path (handles spaces, quotes, glob chars) then type
    // them as if the user dragged them into a real terminal. Files are joined
    // with spaces and followed by \r so the shell accepts the input.
    let mut joined = String::new();
    for path in &paths {
        if !joined.is_empty() {
            joined.push(' ');
        }
        // Shell-escape: wrap in single quotes, escaping any embedded single quotes
        let escaped = path.replace('\'', "'\\''");
        joined.push_str(&format!("'{}'", escaped));
    }
    // Insert shell-quoted paths without trailing newline so the user can edit/append args before pressing Enter.
    state.manager.write(&id, joined.as_bytes())
}

#[tauri::command]
pub async fn terminal_diagnostics(state: State<'_, Arc<AppState>>) -> Result<Vec<SessionDiag>, String> {
    Ok(state.manager.diagnostics())
}

// --- Workspace index (session↔workspace association, spec §22/§29) ---

#[tauri::command]
pub async fn workspace_index_set(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    session_ids: Vec<String>,
) -> Result<(), String> {
    state.workspaces.set_workspace_sessions(&workspace_id, session_ids);
    Ok(())
}

#[tauri::command]
pub async fn workspace_index_get(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<Vec<String>, String> {
    Ok(state.workspaces.sessions_for(&workspace_id))
}

// --- Python sidecar health (Phase 4) ---

/// Health check with IDENTITY verification. A plain TCP/HTTP "any server
/// answered" signal once let an orphaned `python -m http.server` squatting
/// :8765 pose as the sidecar — the UI showed 🟢 connected while every API
/// call returned the impostor's 404 HTML. We now require the TTO health
/// signature (`"status"` + `"ok"` in the /api/health response body).
#[tauri::command]
pub async fn sidecar_status() -> bool {
    let addr = crate::sidecar::sidecar_addr();
    tokio::task::spawn_blocking(move || crate::sidecar::is_real_sidecar(&addr))
        .await
        .unwrap_or(false)
}

/// The port the sidecar is currently serving on (8765 normally, 8766 when the
/// default port is unusable). The frontend builds its apiBase() from this.
#[tauri::command]
pub async fn sidecar_port() -> u16 {
    crate::sidecar::SIDECAR_PORT.load(std::sync::atomic::Ordering::Relaxed)
}

/// Restart the sidecar to pick up new TTO_HOST (e.g. after collab LAN toggle).
/// Kills existing sidecar, clears cooldown, spawns fresh with updated env.
#[tauri::command]
pub async fn collab_restart_sidecar() -> Result<bool, String> {
    match crate::sidecar::restart_sidecar() {
        Some(_) => Ok(true),
        None => Err("Failed to restart sidecar".to_string()),
    }
}

/// Open the Web Inspector for the invoking window's webview (release builds
/// too — the `devtools` cargo feature is enabled). Used by the browser
/// pop-out's Inspect button so users can debug remote pages.
#[tauri::command]
pub async fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    Ok(())
}

// --- Folder picker (workspace wizard) ---

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    // The desktop dialog API is callback-based (must run on the main thread);
    // bridge it to the async command with a oneshot channel.
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let picked = rx
        .await
        .map_err(|_| "folder picker failed".to_string())?;
    Ok(picked.map(|p| match p {
        tauri_plugin_dialog::FilePath::Path(s) => s.to_string_lossy().to_string(),
        tauri_plugin_dialog::FilePath::Url(u) => {
            // Convert file:// URL to a real filesystem path.
            match u.to_file_path() {
                Ok(pb) => pb.to_string_lossy().to_string(),
                Err(_) => u.to_string(),
            }
        }
    }))
}

/// Return the user's HOME directory (cross-platform).
#[tauri::command]
pub async fn get_home_dir() -> Option<String> {
    let home = super::home_dir();
    let s = home.to_string_lossy().to_string();
    if s.is_empty() { return None; }
    Some(s)
}

/// True when a filesystem path exists. Used by the frontend to avoid
/// injecting `cd <workspace path>` into terminals when the workspace
/// directory was deleted/moved (the PTY spawn already falls back to HOME,
/// but the injected cd would fail noisily and leave users confused).
#[tauri::command]
pub async fn path_exists(path: String) -> bool {
    !path.is_empty() && std::path::Path::new(&path).exists()
}

// --- ego-lite browser automation status ---

#[derive(serde::Serialize)]
pub struct EgoLiteStatus {
    /// Whether the ego-lite.app is installed.
    pub app_installed: bool,
    /// Whether the ego-browser skill is available for agents.
    pub skill_installed: bool,
    /// Path to the skill directory if found.
    pub skill_path: Option<String>,
}

/// Check if ego-lite (browser automation for AI agents) is installed.
#[tauri::command]
pub async fn ego_lite_status() -> EgoLiteStatus {
    let home = super::home_dir();
    let home_str = home.display().to_string();

    // macOS: /Applications/ego-lite.app or /Applications/ego (lite).app
    #[cfg(not(target_os = "windows"))]
    let app_installed = std::path::Path::new("/Applications/ego-lite.app").exists()
        || std::path::Path::new("/Applications/ego (lite).app").exists();
    // Windows: modern install locations (winget/NSIS place here)
    #[cfg(target_os = "windows")]
    let app_installed = [
        // winget / common installer locations
        format!("{}\\AppData\\Local\\Programs\\ego-lite", home.display()),
        format!("{}\\AppData\\Roaming\\ego-lite", home.display()),
        // Traditional Program Files locations
        "C:\\Program Files\\ego-lite".to_string(),
        "C:\\Program Files (x86)\\ego-lite".to_string(),
    ].iter().any(|p| std::path::Path::new(p).exists());

    // Check for the ego-browser skill in common agent skill directories
    let skill_dirs = [
        format!("{home_str}/.agents/skills/ego-browser"),
        format!("{home_str}/.claude/skills/ego-browser"),
        format!("{home_str}/.codex/skills/ego-browser"),
        format!("{home_str}/.gemini/skills/ego-browser"),
    ];
    let mut skill_installed = false;
    let mut skill_path = None;
    for dir in &skill_dirs {
        if std::path::Path::new(dir).exists() {
            skill_installed = true;
            skill_path = Some(dir.to_string());
            break;
        }
    }

    EgoLiteStatus { app_installed, skill_installed, skill_path }
}

// --- Launch CWD (the directory the user ran `tto` from) ---

#[tauri::command]
pub async fn get_launch_cwd() -> Option<String> {
    // Read the CWD that the `tto` script wrote before launching the app.
    let path = crate::home_dir().join(".tto-web/launch-cwd");
    let content = std::fs::read_to_string(&path).ok()?;
    let cwd = content.trim().to_string();
    // Validate it's a real directory
    if cwd.is_empty() || !std::path::Path::new(&cwd).is_dir() {
        return None;
    }
    Some(cwd)
}

// ── Django Project Reviewer ────────────────────────────────────────────────

#[tauri::command]
pub async fn django_extract_zip(zip_path: String) -> Result<crate::django::ProjectInfo, String> {
    crate::django::extractor::extract_zip(&zip_path)
}

#[tauri::command]
pub async fn django_analyze(project_path: String) -> Result<crate::django::AnalysisReport, String> {
    let root = std::path::Path::new(&project_path);
    // If it's a zip file, extract first; if it's a directory, analyze directly.
    let info = if project_path.ends_with(".zip") {
        crate::django::extractor::extract_zip(&project_path)?
    } else {
        crate::django::ProjectInfo {
            name: root.file_name().and_then(|n| n.to_str()).unwrap_or("project").to_string(),
            path: project_path.clone(),
            file_tree: crate::django::extractor::build_file_tree(root, root).unwrap_or_default(),
            has_manage_py: root.join("manage.py").exists(),
            has_settings_py: crate::django::extractor::find_settings_py(root).is_some(),
            python_files: crate::django::extractor::find_python_files(root),
            total_files: crate::django::extractor::count_files(root),
        }
    };
    crate::django::analyzer::analyze_project(&info)
}

#[tauri::command]
pub async fn django_fix(project_path: String) -> Result<crate::django::FixReport, String> {    let info = crate::django::ProjectInfo {
            name: "fix-target".to_string(),
            path: project_path.clone(),
            file_tree: vec![],
            has_manage_py: std::path::Path::new(&project_path).join("manage.py").exists(),
            has_settings_py: true,
            python_files: crate::django::extractor::find_python_files(
                std::path::Path::new(&project_path)
            ),
            total_files: 0,
        };
    let report = crate::django::analyzer::analyze_project(&info)?;
    crate::django::fixer::fix_project(&report)
}

#[tauri::command]
pub async fn django_run_checks(project_path: String) -> Result<crate::django::CheckResults, String> {
    crate::django::executor::run_checks(&project_path)
}

#[tauri::command]
pub fn django_check_python() -> bool {
    crate::django::executor::check_django_available()
}

#[tauri::command]
pub async fn django_package(project_path: String) -> Result<String, String> {
    crate::django::packager::package_project(&project_path, None)
}

/// Clean up old extracted Django project directories from temp.
/// Removes any tto-django-* directories older than the specified age (in minutes).
/// Default is 60 minutes (1 hour).
#[tauri::command]
pub async fn django_cleanup_old_projects(max_age_minutes: u64) -> Result<usize, String> {
    crate::django::extractor::cleanup_old_projects(max_age_minutes)
}

/// Open a URL in the user's default system browser (Safari, Chrome, etc.).
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Only http:// and https:// URLs are allowed".to_string());
    }
    // Strict validation: disallow control characters, quotes, and command separators
    if trimmed.chars().any(|c| c.is_control() || "&|;`\"'<>^% \t\r\n".contains(c)) {
        return Err("URL contains illegal characters".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        // Avoid cmd.exe command injection by using rundll32 FileProtocolHandler
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", trimmed])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}

/// Reveal a file or folder in macOS Finder (or Windows Explorer / Linux file manager).
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    if path.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let parent = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}

/// Open an application by bundle name / executable name (e.g. GhostPepper, handy) on macOS.
#[tauri::command]
pub async fn open_app(name: String) -> Result<(), String> {
    if name.is_empty() {
        return Err("App name cannot be empty".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", &name])
            .spawn()
            .map_err(|e| format!("Failed to open app {}: {}", name, e))?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("open_app is only supported on macOS".to_string())
    }
}

/// Check if a process matching a name is currently running on the system.
#[tauri::command]
pub async fn is_app_running(name: String) -> Result<bool, String> {
    if name.is_empty() {
        return Ok(false);
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("pgrep")
            .args(["-i", "-f", &name])
            .output();
        match output {
            Ok(out) => Ok(out.status.success()),
            Err(_) => Ok(false),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}
