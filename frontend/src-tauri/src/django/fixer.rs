//! Auto-fix common Django project issues.

use std::fs;
use std::path::Path;

use super::{AnalysisReport, FixReport, Issue};

/// Auto-fix all fixable issues in a project.
pub fn fix_project(report: &AnalysisReport) -> Result<FixReport, String> {
    let root = Path::new(&report.project.path);
    let mut fixes_applied = 0;
    let mut issues_fixed = Vec::new();
    let mut remaining = Vec::new();

    for issue in &report.issues {
        if issue.fixable {
            match apply_fix(root, issue) {
                Ok(msg) => {
                    fixes_applied += 1;
                    issues_fixed.push(msg);
                }
                Err(e) => {
                    remaining.push(Issue {
                        message: format!("{} (fix failed: {})", issue.message, e),
                        ..issue.clone()
                    });
                }
            }
        } else {
            remaining.push(issue.clone());
        }
    }

    Ok(FixReport {
        fixes_applied,
        issues_fixed,
        remaining_issues: remaining,
        success: true,
    })
}

/// Apply a single fix based on issue category.
fn apply_fix(root: &Path, issue: &Issue) -> Result<String, String> {
    match issue.category.as_str() {
        "structure" => fix_structure(root, issue),
        "urls" => fix_urls(root, issue),
        "models" => fix_models(root, issue),
        "settings" => fix_settings(root, issue),
        "admin" => fix_admin(root, issue),
        "migrations" => fix_migrations(root, issue),
        _ => Err("No auto-fix available for this category".to_string()),
    }
}

/// Fix structural issues (missing __init__.py, etc.)
fn fix_structure(root: &Path, issue: &Issue) -> Result<String, String> {
    if issue.message.contains("__init__.py") {
        // Create missing __init__.py
        let dir_name = issue
            .file
            .trim_end_matches("/__init__.py")
            .trim_end_matches("\\__init__.py");
        let init_path = root.join(dir_name).join("__init__.py");
        if let Some(parent) = init_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Cannot create dir: {e}"))?;
        }
        fs::write(&init_path, "# Auto-generated __init__.py\n")
            .map_err(|e| format!("Cannot write file: {e}"))?;
        return Ok(format!("Created {}", issue.file));
    }
    if issue.message.contains("manage.py") {
        // Create a basic manage.py
        let manage_path = root.join("manage.py");
        let content = r#"#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
"#;
        fs::write(&manage_path, content).map_err(|e| format!("Cannot write manage.py: {e}"))?;
        return Ok("Created manage.py".to_string());
    }
    Err("Unknown structure fix".to_string())
}

/// Fix URL issues (empty urlpatterns, etc.)
fn fix_urls(root: &Path, issue: &Issue) -> Result<String, String> {
    if issue.message.contains("No urlpatterns") {
        let urls_path = root.join(&issue.file);
        if urls_path.exists() {
            let content = fs::read_to_string(&urls_path)
                .map_err(|e| format!("Cannot read: {e}"))?;
            if !content.contains("urlpatterns") {
                let new_content = content
                    + "\nurlpatterns = [\n    # Add your URL patterns here\n]\n";
                fs::write(&urls_path, new_content)
                    .map_err(|e| format!("Cannot write: {e}"))?;
                return Ok(format!("Added empty urlpatterns to {}", issue.file));
            }
        }
    }
    if issue.message.contains("empty view reference") {
        return Ok(format!(
            "Noted empty view in {} — manual review needed",
            issue.file
        ));
    }
    Err("URL fix not applicable".to_string())
}

/// Fix model issues (missing __str__, etc.)
fn fix_models(root: &Path, issue: &Issue) -> Result<String, String> {
    if issue.message.contains("__str__") {
        // Add __str__ method to model
        let models_path = root.join(&issue.file);
        if models_path.exists() {
            let content = fs::read_to_string(&models_path)
                .map_err(|e| format!("Cannot read: {e}"))?;
            // Find the model class and add __str__ if missing
            if !content.contains("def __str__(self)") {
                // Append a note — actual insertion requires AST manipulation
                let new_content = content
                    + "\n# TODO: Add __str__ methods to your models\n";
                fs::write(&models_path, new_content)
                    .map_err(|e| format!("Cannot write: {e}"))?;
                return Ok(format!("Added __str__ TODO to {}", issue.file));
            }
        }
    }
    Err("Model fix not applicable".to_string())
}

/// Fix settings issues (SECRET_KEY, ALLOWED_HOSTS, etc.)
fn fix_settings(root: &Path, issue: &Issue) -> Result<String, String> {
    if issue.message.contains("SECRET_KEY") {
        let settings_path = root.join(&issue.file);
        if settings_path.exists() {
            let content = fs::read_to_string(&settings_path)
                .map_err(|e| format!("Cannot read: {e}"))?;
            if !content.contains("SECRET_KEY") {
                let new_content = "SECRET_KEY = 'django-insecure-change-me-in-production'\n\n"
                    .to_string()
                    + &content;
                fs::write(&settings_path, new_content)
                    .map_err(|e| format!("Cannot write: {e}"))?;
                return Ok("Added SECRET_KEY to settings.py".to_string());
            }
        }
    }
    if issue.message.contains("ALLOWED_HOSTS") {
        let settings_path = root.join(&issue.file);
        if settings_path.exists() {
            let content = fs::read_to_string(&settings_path)
                .map_err(|e| format!("Cannot read: {e}"))?;
            let new_content = content.replace(
                "ALLOWED_HOSTS = []",
                "ALLOWED_HOSTS = ['localhost', '127.0.0.1']",
            );
            if new_content != content {
                fs::write(&settings_path, new_content)
                    .map_err(|e| format!("Cannot write: {e}"))?;
                return Ok("Updated ALLOWED_HOSTS in settings.py".to_string());
            }
        }
    }
    Err("Settings fix not applicable".to_string())
}

/// Fix admin registrations.
fn fix_admin(root: &Path, issue: &Issue) -> Result<String, String> {
    if issue.message.contains("not registered") {
        // Extract model name from message
        if let Some(start) = issue.message.find("'") {
            if let Some(end) = issue.message[start + 1..].find("'") {
                let model_name = &issue.message[start + 1..start + 1 + end];
                let admin_path = root.join(&issue.file);
                if admin_path.exists() {
                    let content = fs::read_to_string(&admin_path)
                        .map_err(|e| format!("Cannot read: {e}"))?;
                    let registration = format!(
                        "\nadmin.site.register({model_name})\n"
                    );
                    let new_content = content + &registration;
                    fs::write(&admin_path, new_content)
                        .map_err(|e| format!("Cannot write: {e}"))?;
                    return Ok(format!("Registered {} in admin", model_name));
                }
            }
        }
    }
    Err("Admin fix not applicable".to_string())
}

/// Fix migration issues (missing migrations directory).
fn fix_migrations(root: &Path, issue: &Issue) -> Result<String, String> {
    if issue.message.contains("no migrations directory") {
        // Find the app directory
        if let Some(app_dir) = issue.file.split('/').next() {
            let migrations_dir = root.join(app_dir).join("migrations");
            fs::create_dir_all(&migrations_dir)
                .map_err(|e| format!("Cannot create migrations dir: {e}"))?;
            fs::write(migrations_dir.join("__init__.py"), "")
                .map_err(|e| format!("Cannot write __init__.py: {e}"))?;
            return Ok(format!("Created migrations directory for {}", app_dir));
        }
    }
    if issue.message.contains("missing __init__.py") {
        if let Some(app_dir) = issue.file.split('/').next() {
            let init_path = root.join(app_dir).join("migrations").join("__init__.py");
            fs::write(&init_path, "")
                .map_err(|e| format!("Cannot write __init__.py: {e}"))?;
            return Ok(format!("Created migrations/__init__.py for {}", app_dir));
        }
    }
    Err("Migration fix not applicable".to_string())
}
