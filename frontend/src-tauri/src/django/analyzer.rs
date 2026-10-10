//! Django project code analyzer — reviews views, urls, models for connectivity.

use std::fs;
use std::path::Path;

use regex::Regex;

use super::{AnalysisReport, Issue, IssueSeverity, ModelInfo, ProjectInfo, UrlPattern, ViewInfo};

/// Analyze a Django project and produce a full report.
pub fn analyze_project(project: &ProjectInfo) -> Result<AnalysisReport, String> {
    let root = Path::new(&project.path);
    let mut issues = Vec::new();
    let mut url_patterns = Vec::new();
    let mut views = Vec::new();
    let mut models = Vec::new();

    // Analyze each Python file
    for py_file in &project.python_files {
        let file_path = root.join(py_file);
        if let Ok(content) = fs::read_to_string(&file_path) {
            let lines: Vec<&str> = content.lines().collect();

            if py_file.ends_with("/urls.py") || py_file == "urls.py" {
                analyze_urls(&content, &lines, py_file, &mut url_patterns, &mut issues);
            }
            if py_file.ends_with("/views.py") || py_file == "views.py" {
                analyze_views(&content, &lines, py_file, &mut views, &mut issues);
            }
            if py_file.ends_with("/models.py") || py_file == "models.py" {
                analyze_models(&content, &lines, py_file, &mut models, &mut issues, project);
            }
            if py_file.ends_with("/settings.py") || py_file == "settings.py" {
                analyze_settings(&content, &lines, py_file, &mut issues);
            }
            if py_file.ends_with("/admin.py") || py_file == "admin.py" {
                analyze_admin(&content, &lines, py_file, &mut issues, &models);
            }
            if py_file.ends_with("/apps.py") || py_file == "apps.py" {
                analyze_apps(&content, &lines, py_file, &mut issues);
            }

            // General Python file checks
            analyze_generic_py(&content, &lines, py_file, &mut issues);
        }
    }

    // Cross-reference checks
    cross_reference_urls_views(&url_patterns, &views, &mut issues);
    cross_reference_models_views(&models, &views, &mut issues);

    // Check for missing __init__.py
    check_init_files(root, project, &mut issues);

    // Check manage.py
    if !project.has_manage_py {
        issues.push(Issue {
            severity: IssueSeverity::Error,
            file: "manage.py".to_string(),
            line: 0,
            message: "manage.py is missing — cannot run the project".to_string(),
            fixable: true,
            category: "structure".to_string(),
        });
    }

    // Check settings.py
    if !project.has_settings_py {
        issues.push(Issue {
            severity: IssueSeverity::Error,
            file: "settings.py".to_string(),
            line: 0,
            message: "settings.py is missing — Django cannot start".to_string(),
            fixable: false,
            category: "structure".to_string(),
        });
    }

    // Calculate health score
    let score = calculate_score(&issues, project);

    Ok(AnalysisReport {
        project: project.clone(),
        issues,
        url_patterns,
        views,
        models,
        score,
    })
}

/// Analyze urls.py for URL patterns and view references.
fn analyze_urls(
    content: &str,
    lines: &[&str],
    file: &str,
    patterns: &mut Vec<UrlPattern>,
    issues: &mut Vec<Issue>,
) {
    let re_path = Regex::new(r#"path\s*\(\s*['\"](.+?)['\"].*?,\s*(\w[\w.]*)"#).unwrap();
    let re_url = Regex::new(r#"url\s*\(\s*r?['\"](.+?)['\"].*?,\s*(\w[\w.]*)"#).unwrap();
    let re_include = Regex::new(r#"include\s*\(\s*['\"](.+?)['\"]"#).unwrap();

    for (i, line) in lines.iter().enumerate() {
        let line_num = i + 1;

        if let Some(caps) = re_path.captures(line) {
            let pattern = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let view = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let name = extract_kw_arg(line, "name");

            patterns.push(UrlPattern {
                pattern: pattern.to_string(),
                view: view.to_string(),
                name,
                file: file.to_string(),
                line: line_num,
            });

            // Check if view reference looks valid
            if view.contains('.') && !view.starts_with("views.") && !view.contains("include") {
                // Might be a dotted import path — ok
            } else if view == "''" || view == "\"\"" {
                issues.push(Issue {
                    severity: IssueSeverity::Warning,
                    file: file.to_string(),
                    line: line_num,
                    message: format!("URL pattern '{pattern}' has empty view reference"),
                    fixable: true,
                    category: "urls".to_string(),
                });
            }
        }

        if let Some(caps) = re_url.captures(line) {
            let pattern = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let view = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            patterns.push(UrlPattern {
                pattern: pattern.to_string(),
                view: view.to_string(),
                name: None,
                file: file.to_string(),
                line: line_num,
            });
        }

        if re_include.is_match(line) {
            // Included URL patterns — check if the included module exists
        }
    }

    // Check for urlpatterns variable
    if !content.contains("urlpatterns") {
        issues.push(Issue {
            severity: IssueSeverity::Error,
            file: file.to_string(),
            line: 0,
            message: "No urlpatterns defined — no routes will work".to_string(),
            fixable: true,
            category: "urls".to_string(),
        });
    }
}

/// Analyze views.py for view functions and classes.
fn analyze_views(
    _content: &str,
    lines: &[&str],
    file: &str,
    views: &mut Vec<ViewInfo>,
    issues: &mut Vec<Issue>,
) {
    let re_def = Regex::new(r#"^(?:async\s+)?def\s+(\w+)\s*\("#).unwrap();
    let re_class = Regex::new(r#"^class\s+(\w+)\s*\(([^)]*)\):"#).unwrap();

    for (i, line) in lines.iter().enumerate() {
        let line_num = i + 1;

        if let Some(caps) = re_def.captures(line) {
            let name = caps.get(1).unwrap().as_str();
            // Check if it looks like a view (takes request as first param)
            let models_used = extract_model_refs(line, lines, i);
            views.push(ViewInfo {
                name: name.to_string(),
                kind: "function".to_string(),
                file: file.to_string(),
                line: line_num,
                models_used,
            });

            // Check for missing request parameter
            if !line.contains("request") && !line.contains("HttpRequest") {
                issues.push(Issue {
                    severity: IssueSeverity::Warning,
                    file: file.to_string(),
                    line: line_num,
                    message: format!("View '{name}' may be missing 'request' parameter"),
                    fixable: false,
                    category: "views".to_string(),
                });
            }
        }

        if let Some(caps) = re_class.captures(line) {
            let name = caps.get(1).unwrap().as_str();
            let bases = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let kind = if bases.contains("View") || bases.contains("APIView") {
                "class"
            } else {
                "class"
            };
            let models_used = extract_model_refs(line, lines, i);
            views.push(ViewInfo {
                name: name.to_string(),
                kind: kind.to_string(),
                file: file.to_string(),
                line: line_num,
                models_used,
            });
        }
    }

    // Check for empty views file
    if views.is_empty() && lines.len() > 5 {
        issues.push(Issue {
            severity: IssueSeverity::Warning,
            file: file.to_string(),
            line: 0,
            message: "views.py has no view functions or classes defined".to_string(),
            fixable: false,
            category: "views".to_string(),
        });
    }
}

/// Analyze models.py for model definitions.
fn analyze_models(
    content: &str,
    lines: &[&str],
    file: &str,
    models: &mut Vec<ModelInfo>,
    issues: &mut Vec<Issue>,
    project: &ProjectInfo,
) {
    let re_class = Regex::new(r#"^class\s+(\w+)\s*\(([^)]*)\):"#).unwrap();
    let re_field = Regex::new(r#"^\s+(\w+)\s*=\s*(\w+)\.(\w+)"#).unwrap();

    // Extract app name from file path (e.g., "myapp/models.py" → "myapp")
    let app_name = file
        .split('/')
        .next()
        .unwrap_or("unknown")
        .to_string();

    let mut current_model: Option<String> = None;

    for (i, line) in lines.iter().enumerate() {
        let line_num = i + 1;

        if let Some(caps) = re_class.captures(line) {
            let name = caps.get(1).unwrap().as_str();
            let bases = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            // Only count Django models (inherit from Model)
            if bases.contains("Model") || bases.contains("AbstractUser") {
                current_model = Some(name.to_string());
                models.push(ModelInfo {
                    name: name.to_string(),
                    app: app_name.clone(),
                    file: file.to_string(),
                    line: line_num,
                    fields: Vec::new(),
                    has_migration: false, // Will be checked later
                });
            }
        } else if let Some(caps) = re_field.captures(line) {
            if let Some(ref model_name) = current_model {
                let field_name = caps.get(1).unwrap().as_str();
                if let Some(last) = models.last_mut() {
                    if last.name == *model_name {
                        last.fields.push(field_name.to_string());
                    }
                }
            }
        }

        // Reset current model on blank line or new class
        if line.trim().is_empty() || re_class.is_match(line) {
            if !re_class.is_match(line) {
                // Keep current model if just a blank line
            }
        }
    }

    // Check for missing __str__ methods
    for model in models.iter() {
        if !content.contains(&format!("def __str__")) {                issues.push(Issue {
                severity: IssueSeverity::Info,
                file: file.to_string(),
                line: 0,
                message: format!("Model '{}' has no __str__ method", model.name),
                fixable: true,
                category: "models".to_string(),
            });
        }
    }

    // Check for migrations
    let migrations_dir = Path::new(&project.path)
        .join(&app_name)
        .join("migrations");
    if models.is_empty() {
        // No models — no migration check needed
    } else if !migrations_dir.exists() {
        issues.push(Issue {
            severity: IssueSeverity::Error,
            file: format!("{}/migrations/", app_name),
            line: 0,
            message: format!(
                "App '{}' has models but no migrations directory",
                app_name
            ),
            fixable: true,
            category: "migrations".to_string(),
        });
    } else {
        // Check if there's at least an __init__.py in migrations
        if !migrations_dir.join("__init__.py").exists() {
            issues.push(Issue {
                severity: IssueSeverity::Warning,
                file: format!("{}/migrations/__init__.py", app_name),
                line: 0,
                message: format!(
                    "Migrations directory in '{}' is missing __init__.py",
                    app_name
                ),
                fixable: true,
                category: "migrations".to_string(),
            });
        }
    }
}

/// Analyze settings.py for required configuration.
fn analyze_settings(content: &str, _lines: &[&str], file: &str, issues: &mut Vec<Issue>) {
    let required = [
        ("SECRET_KEY", "Django secret key is required"),
        ("INSTALLED_APPS", "INSTALLED_APPS must be configured"),
        ("DATABASES", "DATABASE configuration is required"),
        ("ROOT_URLCONF", "ROOT_URLCONF should be set"),
        ("WSGI_APPLICATION", "WSGI_APPLICATION should be set"),
    ];

    for (key, msg) in &required {
        if !content.contains(key) {
            issues.push(Issue {
                severity: if *key == "SECRET_KEY" || *key == "INSTALLED_APPS" {
                    IssueSeverity::Error
                } else {
                    IssueSeverity::Warning
                },
                file: file.to_string(),
                line: 0,
                message: msg.to_string(),
                fixable: *key == "SECRET_KEY",
                category: "settings".to_string(),
            });
        }
    }

    // Check DEBUG setting
    if content.contains("DEBUG = True") {
        issues.push(Issue {
            severity: IssueSeverity::Info,
            file: file.to_string(),
            line: 0,
            message: "DEBUG is set to True — remember to disable in production".to_string(),
            fixable: false,
            category: "settings".to_string(),
        });
    }

    // Check ALLOWED_HOSTS
    if content.contains("ALLOWED_HOSTS") && content.contains("ALLOWED_HOSTS = []") {
        issues.push(Issue {
            severity: IssueSeverity::Warning,
            file: file.to_string(),
            line: 0,
            message: "ALLOWED_HOSTS is empty — no hosts will be allowed".to_string(),
            fixable: true,
            category: "settings".to_string(),
        });
    }
}

/// Analyze admin.py for model registrations.
fn analyze_admin(
    content: &str,
    _lines: &[&str],
    file: &str,
    issues: &mut Vec<Issue>,
    models: &[ModelInfo],
) {
    let re_register = Regex::new(r#"admin\.site\.register\s*\(\s*(\w+)"#).unwrap();
    let registered: Vec<String> = re_register
        .captures_iter(content)
        .filter_map(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        .collect();

    for model in models {
        if !registered.contains(&model.name) {
            issues.push(Issue {
                severity: IssueSeverity::Info,
                file: file.to_string(),
                line: 0,
                message: format!("Model '{}' is not registered in admin", model.name),
                fixable: true,
                category: "admin".to_string(),
            });
        }
    }
}

/// Analyze apps.py for app configuration.
fn analyze_apps(content: &str, _lines: &[&str], file: &str, issues: &mut Vec<Issue>) {
    if !content.contains("class") || !content.contains("AppConfig") {
        issues.push(Issue {
            severity: IssueSeverity::Info,
            file: file.to_string(),
            line: 0,
            message: "apps.py does not define an AppConfig subclass".to_string(),
            fixable: false,
            category: "apps".to_string(),
        });
    }
}

/// Generic Python file analysis.
fn analyze_generic_py(content: &str, lines: &[&str], file: &str, issues: &mut Vec<Issue>) {
    // Check for syntax errors (basic: unmatched parentheses/brackets)
    let open_parens = content.matches('(').count();
    let close_parens = content.matches(')').count();
    if (open_parens as i32 - close_parens as i32).abs() > 2 {
        issues.push(Issue {
            severity: IssueSeverity::Warning,
            file: file.to_string(),
            line: 0,
            message: format!(
                "Possible syntax issue: {} '(' vs {} ')' in file",
                open_parens, close_parens
            ),
            fixable: false,
            category: "syntax".to_string(),
        });
    }

    // Check for TODO/FIXME/HACK
    for (i, line) in lines.iter().enumerate() {
        if line.contains("TODO") || line.contains("FIXME") || line.contains("HACK") {
            issues.push(Issue {
                severity: IssueSeverity::Info,
                file: file.to_string(),
                line: i + 1,
                message: format!("Contains {}: {}", 
                    if line.contains("TODO") { "TODO" } else if line.contains("FIXME") { "FIXME" } else { "HACK" },
                    line.trim().chars().take(80).collect::<String>()
                ),
                fixable: false,
                category: "maintenance".to_string(),
            });
        }
    }
}

/// Cross-reference URL patterns with defined views.
fn cross_reference_urls_views(
    patterns: &[UrlPattern],
    views: &[ViewInfo],
    issues: &mut Vec<Issue>,
) {
    let view_names: Vec<&str> = views.iter().map(|v| v.name.as_str()).collect();

    for pattern in patterns {
        let view_ref = &pattern.view;
        // Simple check: if the view name is a simple function name, check if it exists
        if !view_ref.contains('.') && !view_ref.contains("include") {
            if !view_names.contains(&view_ref.as_str()) {
                issues.push(Issue {
                    severity: IssueSeverity::Error,
                    file: pattern.file.clone(),
                    line: pattern.line,
                    message: format!(
                        "URL '{}' references view '{}' which is not defined in views.py",
                        pattern.pattern, view_ref
                    ),
                    fixable: false,
                    category: "urls".to_string(),
                });
            }
        }
    }
}

/// Cross-reference models used in views.
fn cross_reference_models_views(
    models: &[ModelInfo],
    views: &[ViewInfo],
    issues: &mut Vec<Issue>,
) {
    let model_names: Vec<&str> = models.iter().map(|m| m.name.as_str()).collect();

    for view in views {
        for model_ref in &view.models_used {
            if !model_names.contains(&model_ref.as_str()) {
                issues.push(Issue {
                    severity: IssueSeverity::Error,
                    file: view.file.clone(),
                    line: view.line,
                    message: format!(
                        "View '{}' references model '{}' which is not defined",
                        view.name, model_ref
                    ),
                    fixable: false,
                    category: "models".to_string(),
                });
            }
        }
    }
}

/// Check for missing __init__.py files in Python packages.
fn check_init_files(root: &Path, project: &ProjectInfo, issues: &mut Vec<Issue>) {
    for py_file in &project.python_files {
        if let Some(parent) = Path::new(py_file).parent() {
            if !parent.as_os_str().is_empty() {
                let init_path = root.join(parent).join("__init__.py");
                if !init_path.exists() {
                    // Check if sibling .py files exist (meaning this is a package)
                    let has_sibling = fs::read_dir(root.join(parent))
                        .map(|entries| {
                            entries.flatten().any(|e| {
                                e.path().extension().and_then(|ext| ext.to_str()) == Some("py")
                                    && e.file_name() != "__init__.py"
                            })
                        })
                        .unwrap_or(false);

                    if has_sibling {
                        issues.push(Issue {
                            severity: IssueSeverity::Warning,
                            file: format!("{}/__init__.py", parent.display()),
                            line: 0,
                            message: format!(
                                "Missing __init__.py in '{}' — Python package may not import correctly",
                                parent.display()
                            ),
                            fixable: true,
                            category: "structure".to_string(),
                        });
                    }
                }
            }
        }
    }
}

/// Extract keyword argument from a line (e.g., name='foo').
fn extract_kw_arg(line: &str, key: &str) -> Option<String> {
    let pattern = format!(r#"{}\s*=\s*['\"]([^'\"]+)['\"]"#, key);
    let re = Regex::new(&pattern).ok()?;
    re.captures(line)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extract model references from context around a view definition.
fn extract_model_refs(_line: &str, lines: &[&str], idx: usize) -> Vec<String> {
    let re = Regex::new(r#"(\w+)\.objects\."#).unwrap();
    let mut models = Vec::new();

    // Look in surrounding lines (imports + function body)
    let start = idx.saturating_sub(20);
    let end = (idx + 50).min(lines.len());
    for line in &lines[start..end] {
        for caps in re.captures_iter(line) {
            let name = caps.get(1).unwrap().as_str().to_string();
            // Filter out common non-model names
            if !["self", "request", "response", "form", "context", "User", "os", "json"]
                .contains(&name.as_str())
            {
                if !models.contains(&name) {
                    models.push(name);
                }
            }
        }
    }
    models
}

/// Calculate a health score (0-100) based on issues and project state.
fn calculate_score(issues: &[Issue], project: &ProjectInfo) -> u32 {
    let mut score: i32 = 100;

    // Base deductions
    for issue in issues {
        match issue.severity {
            IssueSeverity::Error => score -= 15,
            IssueSeverity::Warning => score -= 5,
            IssueSeverity::Info => score -= 1,
            IssueSeverity::Ok => {}
        }
    }

    // Bonus for having key files
    if project.has_manage_py {
        score += 5;
    }
    if project.has_settings_py {
        score += 5;
    }

    // Clamp to 0-100
    score.max(0).min(100) as u32
}
