//! Re-package a Django project as a zip file.

use std::fs;
use std::io::Write;
use std::path::Path;
use zip::write::FileOptions;
use zip::ZipWriter;

/// Package a Django project directory into a zip file.
/// Returns the path to the created zip file.
pub fn package_project(project_path: &str, output_dir: Option<&str>) -> Result<String, String> {
    let root = Path::new(project_path);
    if !root.exists() {
        return Err(format!("Project path does not exist: {project_path}"));
    }

    let project_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");

    let default_dir = std::env::temp_dir();
    let out_dir = output_dir.map(Path::new).unwrap_or(&default_dir);
    let zip_path = out_dir.join(format!("{project_name}-fixed.zip"));

    let zip_file =
        fs::File::create(&zip_path).map_err(|e| format!("Cannot create zip file: {e}"))?;
    let mut writer = ZipWriter::new(zip_file);
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    // Walk the project directory and add all files
    add_dir_to_zip(&mut writer, root, root, &options)?;

    writer
        .finish()
        .map_err(|e| format!("Cannot finish zip: {e}"))?;

    Ok(zip_path.to_string_lossy().to_string())
}

/// Recursively add a directory to the zip archive.
fn add_dir_to_zip(
    writer: &mut ZipWriter<fs::File>,
    dir: &Path,
    base: &Path,
    options: &FileOptions,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Cannot read dir: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Skip unwanted files
        if name_str.starts_with('.')
            || name_str == "__pycache__"
            || name_str == "node_modules"
            || name_str == "*.pyc"
            || name_str == ".git"
        {
            continue;
        }

        let relative = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        if path.is_dir() {
            // Add directory entry
            let dir_name = format!("{relative}/");
            writer
                .add_directory(&dir_name, *options)
                .map_err(|e| format!("Cannot add dir to zip: {e}"))?;
            add_dir_to_zip(writer, &path, base, options)?;
        } else {
            // Add file
            let content = fs::read(&path).map_err(|e| format!("Cannot read file: {e}"))?;
            writer
                .start_file(&relative, *options)
                .map_err(|e| format!("Cannot start zip entry: {e}"))?;
            writer
                .write_all(&content)
                .map_err(|e| format!("Cannot write to zip: {e}"))?;
        }
    }

    Ok(())
}
