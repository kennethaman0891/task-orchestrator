//! Execute manage.py commands (check, migrate, test) for Django projects.

use std::path::Path;
use std::process::Command;

use super::CheckResults;

/// Run Django management commands against a project.
pub fn run_checks(project_path: &str) -> Result<CheckResults, String> {
    let root = Path::new(project_path);
    let manage_py = root.join("manage.py");

    if !manage_py.exists() {
        return Ok(CheckResults {
            system_check: "SKIP: manage.py not found".to_string(),
            migration_check: "SKIP: manage.py not found".to_string(),
            test_results: "SKIP: manage.py not found".to_string(),
            all_passed: false,
        });
    }

    // Check if Python with Django is available
    let python = match find_python() {
        Some(p) => p,
        None => {
            let msg = get_django_unavailable_message();
            return Ok(CheckResults {
                system_check: msg.clone(),
                migration_check: msg.clone(),
                test_results: msg,
                all_passed: false,
            });
        }
    };

    let settings_module = find_settings_module(root);

    let system_check = run_manage_py(&python, root, &settings_module, &["check"]);
    let migration_check = run_manage_py(
        &python,
        root,
        &settings_module,
        &["migrate", "--run-syncdb", "--check"],
    );
    let test_results = run_manage_py(
        &python,
        root,
        &settings_module,
        &["test", "--no-input", "--verbosity=0"],
    );

    let all_passed = system_check.contains("System check identified no issues")
        || system_check.to_lowercase().contains("ok");

    Ok(CheckResults {
        system_check,
        migration_check,
        test_results,
        all_passed,
    })
}

/// Find the Python interpreter and verify Django is installed.
fn find_python() -> Option<String> {
    // Try python3 first, then python
    for py in ["python3", "python"] {
        if Command::new(py)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            // Verify Django is installed
            if Command::new(py)
                .args(["-c", "import django; print(django.VERSION)"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return Some(py.to_string());
            }
        }
    }
    None
}

/// Check if Django is installed in the environment.
pub fn check_django_available() -> bool {
    find_python().is_some()
}

/// Get a friendly error message when Python/Django is not available.
pub fn get_django_unavailable_message() -> String {
    let python_hint = if cfg!(target_os = "windows") {
        "Install Python from https://www.python.org/downloads/"
    } else if cfg!(target_os = "macos") {
        "Install Python via Homebrew: `brew install python`"
    } else {
        "Install Python via your package manager (e.g., `apt install python3`)"
    };
    format!(
        "Python with Django is required but not found.\n\n\
         1. Install Python: {}\n\
         2. Install Django: `pip install django`\n\
         3. Restart the app and try again.\n\n\
         Note: Static code analysis still works without Python — \
         only the `Run Checks` button requires it.",
        python_hint
    )
}

/// Find the DJANGO_SETTINGS_MODULE from the project structure.
fn find_settings_module(root: &Path) -> String {
    // Walk the project looking for settings.py
    for entry in walkdir::WalkDir::new(root)
        .max_depth(3)
        .into_iter()
        .flatten()
    {
        if entry.file_name().to_string_lossy() == "settings.py" {
            let relative = entry.path().strip_prefix(root).unwrap_or(entry.path());
            let module_path = relative
                .with_extension("")
                .to_string_lossy()
                .replace('/', ".")
                .replace('\\', ".");
            // Validate: settings module must match safe charset [a-zA-Z0-9_.]
            // This prevents environment variable injection via malicious paths
            if module_path
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '.')
                && !module_path.starts_with('.')
                && !module_path.contains("..")
            {
                return module_path;
            }
            // Fall back to safe default if validation fails
            return "settings".to_string();
        }
    }
    // Fallback: assume 'settings' at root
    "settings".to_string()
}

/// Run a manage.py command and capture output.
fn run_manage_py(python: &str, root: &Path, settings_module: &str, args: &[&str]) -> String {
    let mut cmd = Command::new(python);
    cmd.arg("manage.py")
        .args(args)
        .current_dir(root)
        .env("DJANGO_SETTINGS_MODULE", settings_module)
        .env("PYTHONDONTWRITEBYTECODE", "1");

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let combined = format!("{}\n{}", stdout, stderr);
            // Trim to reasonable length
            if combined.len() > 2000 {
                format!("{}...(truncated)", &combined[..2000])
            } else {
                combined.trim().to_string()
            }
        }
        Err(e) => format!("Failed to run manage.py: {e}"),
    }
}
