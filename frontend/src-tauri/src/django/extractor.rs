//! Zip extraction and file tree building.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::read::ZipArchive;

use super::{FileNode, IssueSeverity, ProjectInfo};

/// Extract a zip file to a unique temp directory and build a file tree.
/// Uses UUID-based naming to handle multiple zips safely, even with identical names.
pub fn extract_zip(zip_path: &str) -> Result<ProjectInfo, String> {
    let zip_file = fs::File::open(zip_path).map_err(|e| format!("Cannot open zip: {e}"))?;
    let mut archive = ZipArchive::new(zip_file).map_err(|e| format!("Invalid zip file: {e}"))?;

    // Create temp extraction directory
    let extract_dir = tempfile::tempdir().map_err(|e| format!("Temp dir failed: {e}"))?;
    let extract_path = extract_dir.keep();

    // Extract all files
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Cannot read zip entry: {e}"))?;
        let out_path = extract_path.join(entry.mangled_name());

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("Cannot create dir: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Cannot create dir: {e}"))?;
            }
            let mut out_file =
                fs::File::create(&out_path).map_err(|e| format!("Cannot create file: {e}"))?;
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("Cannot read entry: {e}"))?;
            out_file
                .write_all(&buf)
                .map_err(|e| format!("Cannot write file: {e}"))?;
        }
    }

    // Determine project root (may be nested one level if zip contains a single folder)
    let project_root = find_project_root(&extract_path);

    // Determine project name from zip filename
    let zip_name = Path::new(zip_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("project")
        .to_string();

    // Build file tree
    let file_tree = build_file_tree(&project_root, &project_root)?;
    let has_manage_py = project_root.join("manage.py").exists();
    let has_settings_py = find_settings_py(&project_root).is_some();
    let python_files = find_python_files(&project_root);
    let total_files = count_files(&project_root);

    // Move extracted content to a persistent location with UNIQUE ID to avoid collisions
    // when processing multiple zips (even with same name)
    let unique_id = uuid::Uuid::new_v4().to_string();
    let persist_dir = std::env::temp_dir().join(format!("tto-django-{zip_name}-{unique_id}"));
    if persist_dir.exists() {
        fs::remove_dir_all(&persist_dir).ok();
    }
    fs::rename(&project_root, &persist_dir)
        .or_else(|_| {
            // If rename fails (cross-device), copy instead
            fs::create_dir_all(&persist_dir)?;
            copy_dir_all(&project_root, &persist_dir)?;
            Ok::<(), std::io::Error>(())
        })
        .map_err(|e| format!("Cannot persist project: {e}"))?;

    Ok(ProjectInfo {
        name: zip_name,
        path: persist_dir.to_string_lossy().to_string(),
        file_tree,
        has_manage_py,
        has_settings_py,
        python_files,
        total_files,
    })
}

/// Find the actual Django project root (look for manage.py).
fn find_project_root(base: &Path) -> PathBuf {
    // Check if manage.py is at the base
    if base.join("manage.py").exists() {
        return base.to_path_buf();
    }
    // Check one level down (common: zip contains a single folder)
    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten() {
            if entry.path().join("manage.py").exists() {
                return entry.path();
            }
        }
    }
    base.to_path_buf()
}

/// Recursively build a file tree with issue status markers.
pub fn build_file_tree(root: &Path, base: &Path) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| format!("Cannot read dir: {e}"))?;

    let mut sorted: Vec<_> = entries.flatten().collect();
    sorted.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    for entry in sorted {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and __pycache__
        if name.starts_with('.') || name == "__pycache__" || name == "node_modules" {
            continue;
        }

        let relative = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        if path.is_dir() {
            let children = build_file_tree(&path, base)?;
            let status = Some(determine_dir_status(&path));
            nodes.push(FileNode {
                name,
                path: relative,
                is_dir: true,
                children,
                status,
            });
        } else {
            let status = Some(determine_file_status(&path));
            nodes.push(FileNode {
                name,
                path: relative,
                is_dir: false,
                children: vec![],
                status,
            });
        }
    }
    Ok(nodes)
}

/// Determine file status based on content analysis.
fn determine_file_status(path: &Path) -> IssueSeverity {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    match name {
        "views.py" | "urls.py" | "models.py" | "admin.py" | "apps.py" => {
            // Check if file is empty
            if let Ok(meta) = fs::metadata(path) {
                if meta.len() == 0 {
                    return IssueSeverity::Warning;
                }
            }
            // Check for syntax issues by looking for common patterns
            if let Ok(content) = fs::read_to_string(path) {
                if content.contains("TODO") || content.contains("FIXME") || content.contains("XXX")
                {
                    return IssueSeverity::Warning;
                }
            }
            IssueSeverity::Ok
        }
        "settings.py" => {
            if let Ok(content) = fs::read_to_string(path) {
                if content.contains("SECRET_KEY") && content.contains("INSTALLED_APPS") {
                    IssueSeverity::Ok
                } else {
                    IssueSeverity::Warning
                }
            } else {
                IssueSeverity::Warning
            }
        }
        "manage.py" => IssueSeverity::Ok,
        name if name.ends_with(".py") => IssueSeverity::Ok,
        name if name.ends_with(".html") => IssueSeverity::Ok,
        _ => IssueSeverity::Ok,
    }
}

/// Determine directory status based on Django project structure.
fn determine_dir_status(path: &Path) -> IssueSeverity {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    // Django app directories should have __init__.py
    if name != "__pycache__" && name != "migrations" && name != "static" && name != "templates" {
        if !path.join("__init__.py").exists() {
            // Check if it looks like a Python package (has .py files)
            if let Ok(entries) = fs::read_dir(path) {
                let has_py = entries
                    .flatten()
                    .any(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("py"));
                if has_py {
                    return IssueSeverity::Warning;
                }
            }
        }
    }
    IssueSeverity::Ok
}

/// Find settings.py in the project.
pub fn find_settings_py(root: &Path) -> Option<PathBuf> {
    for entry in walkdir::WalkDir::new(root)
        .max_depth(3)
        .into_iter()
        .flatten()
    {
        if entry.file_name().to_string_lossy() == "settings.py" {
            return Some(entry.into_path());
        }
    }
    None
}

/// Find all Python files.
pub fn find_python_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .flatten()
        .filter(|e| !e.file_type().is_dir())
    {
        if entry.path().extension().and_then(|e| e.to_str()) == Some("py") {
            if let Ok(relative) = entry.path().strip_prefix(root) {
                files.push(relative.to_string_lossy().to_string());
            }
        }
    }
    files
}

/// Count total files in directory.
pub fn count_files(root: &Path) -> usize {
    walkdir::WalkDir::new(root)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .count()
}

/// Recursively copy a directory.
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Clean up old extracted Django project directories from temp.
/// Removes any `tto-django-*` directories older than max_age_minutes.
/// Returns the number of directories removed.
pub fn cleanup_old_projects(max_age_minutes: u64) -> Result<usize, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let temp_dir = std::env::temp_dir();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get current time: {e}"))?;
    let cutoff_age = std::time::Duration::from_secs(max_age_minutes * 60);
    let cutoff = now
        .checked_sub(cutoff_age)
        .ok_or("Invalid cutoff calculation")?;

    let mut cleaned = 0;

    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("tto-django-") {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        // Compare as durations since UNIX_EPOCH
                        if let Ok(modified_duration) = modified.duration_since(UNIX_EPOCH) {
                            if modified_duration < cutoff {
                                let path = entry.path();
                                crate::safe_eprintln!(
                                    "[TTO DJANGO] Cleaning up old project: {}",
                                    path.display()
                                );
                                if let Err(e) = fs::remove_dir_all(&path) {
                                    crate::safe_eprintln!(
                                        "[TTO DJANGO] Failed to remove {:?}: {}",
                                        path,
                                        e
                                    );
                                } else {
                                    cleaned += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(cleaned)
}
