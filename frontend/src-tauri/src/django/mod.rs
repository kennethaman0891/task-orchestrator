//! Django project reviewer — automated analysis, fixing, and packaging.
//!
//! Pipeline: extract → analyze → fix → test → package

pub mod extractor;
pub mod analyzer;
pub mod fixer;
pub mod executor;
pub mod packager;

use serde::{Deserialize, Serialize};

/// A node in the project file tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<IssueSeverity>,
}

/// Severity of an issue found during analysis.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Error,
    Warning,
    Info,
    Ok,
}

/// A single issue found in a Django project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub severity: IssueSeverity,
    pub file: String,
    pub line: usize,
    pub message: String,
    pub fixable: bool,
    pub category: String,
}

/// Info about a URL pattern.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlPattern {
    pub pattern: String,
    pub view: String,
    pub name: Option<String>,
    pub file: String,
    pub line: usize,
}

/// Info about a view function or class.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewInfo {
    pub name: String,
    pub kind: String, // "function" or "class"
    pub file: String,
    pub line: usize,
    pub models_used: Vec<String>,
}

/// Info about a Django model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub app: String,
    pub file: String,
    pub line: usize,
    pub fields: Vec<String>,
    pub has_migration: bool,
}

/// Result of extracting a zip file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub file_tree: Vec<FileNode>,
    pub has_manage_py: bool,
    pub has_settings_py: bool,
    pub python_files: Vec<String>,
    pub total_files: usize,
}

/// Full analysis report for a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReport {
    pub project: ProjectInfo,
    pub issues: Vec<Issue>,
    pub url_patterns: Vec<UrlPattern>,
    pub views: Vec<ViewInfo>,
    pub models: Vec<ModelInfo>,
    pub score: u32, // 0-100
}

/// Result of running manage.py checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResults {
    pub system_check: String,
    pub migration_check: String,
    pub test_results: String,
    pub all_passed: bool,
}

/// Result of fixing a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixReport {
    pub fixes_applied: usize,
    pub issues_fixed: Vec<String>,
    pub remaining_issues: Vec<Issue>,
    pub success: bool,
}

/// Summary of all projects processed.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchResult {
    pub projects: Vec<AnalysisReport>,
    pub total_issues: usize,
    pub total_fixable: usize,
    pub avg_score: u32,
}
