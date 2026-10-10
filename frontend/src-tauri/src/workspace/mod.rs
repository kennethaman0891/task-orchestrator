//! Workspace model (spec §22).
//!
//! Rust owns terminal sessions; the frontend owns workspace *metadata*
//! (name, color, template, pane-slot→terminal map) persisted in localStorage,
//! which survives Tauri restarts inside the WebView. This module keeps the
//! session↔workspace association so sessions can be restored into their
//! workspace after an app restart (spec §29).

use std::collections::HashMap;
use std::sync::Mutex;

/// Mutable mapping: workspace_id → ordered session ids (pane order).
pub struct WorkspaceIndex {
    map: Mutex<HashMap<String, Vec<String>>>,
}

impl Default for WorkspaceIndex {
    fn default() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }
}

impl WorkspaceIndex {
    /// Record which sessions belong to a workspace (called by the frontend
    /// after it reconciles a workspace's panes).
    pub fn set_workspace_sessions(&self, workspace_id: &str, session_ids: Vec<String>) {
        let mut map = self.map.lock().unwrap();
        map.insert(workspace_id.to_string(), session_ids);
    }

    pub fn sessions_for(&self, workspace_id: &str) -> Vec<String> {
        let map = self.map.lock().unwrap();
        map.get(workspace_id).cloned().unwrap_or_default()
    }

    pub fn all(&self) -> Vec<(String, Vec<String>)> {
        let map = self.map.lock().unwrap();
        map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }
}
