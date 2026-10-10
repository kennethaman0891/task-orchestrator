//! Renderer attach/detach + stale-channel recovery (spec §28, §29).
//!
//! - `attach`: swaps in a fresh renderer channel. The PTY is NEVER restarted —
//!   the session keeps running while detached; output accumulates in the
//!   bounded queue.
//! - `send_chunk`: returns false when the channel is gone (webview unloaded /
//!   stale) so the scheduler marks the session detached instead of crashing.
//! - `detach`: clears the channel; output stays bounded and is resumed on the
//!   next attach.

use std::sync::Arc;

use tauri::ipc::Channel;

use super::session::TerminalSession;

pub fn attach(session: &Arc<TerminalSession>, on_output: Channel<Vec<u8>>, on_exit: Channel<()>) {
    *session.channel.lock() = Some(on_output);
    *session.exit_channel.lock() = Some(on_exit);
    // The session is considered alive again from the renderer's perspective.
    session.meta.lock().last_activity = now();
}

pub fn detach(session: &Arc<TerminalSession>) {
    *session.channel.lock() = None;
    *session.exit_channel.lock() = None;
}

/// Register a secondary read-only mirror subscriber (Space view renderer).
/// Idempotent per sub_id — re-subscribing replaces nothing, duplicates are skipped.
pub fn subscribe(session: &Arc<TerminalSession>, sub_id: u64, channel: Channel<Vec<u8>>) {
    let mut subs = session.subscribers.lock();
    if !subs.iter().any(|(id, _)| *id == sub_id) {
        subs.push((sub_id, channel));
    }
}

/// Remove a secondary subscriber (idempotent).
pub fn unsubscribe(session: &Arc<TerminalSession>, sub_id: u64) {
    session.subscribers.lock().retain(|(id, _)| *id != sub_id);
}

/// Forward one chunk to the primary renderer AND all mirror subscribers.
/// Returns true when the PRIMARY channel delivered (or when only mirrors exist
/// and at least one mirror got it — mirrors keep the Space view alive even
/// while no primary grid renderer is attached).
pub fn send_chunk(session: &Arc<TerminalSession>, data: Vec<u8>) -> bool {
    // Fan-out to secondary subscribers (Space view mirrors). Best-effort:
    // a stale subscriber is dropped silently; it never affects the primary
    // renderer path below.
    let mirror_delivered = {
        let mut subs = session.subscribers.lock();
        let mut stale: Vec<u64> = Vec::new();
        let mut any_ok = false;
        for (id, ch) in subs.iter() {
            if ch.send(data.clone()).is_ok() {
                any_ok = true;
            } else {
                stale.push(*id);
            }
        }
        if !stale.is_empty() {
            subs.retain(|(id, _)| !stale.contains(id));
        }
        any_ok
    };
    let channel = {
        let guard = session.channel.lock();
        guard.clone()
    };
    match channel {
        Some(ch) => match ch.send(data) {
            Ok(_) => {
                session.meta.lock().last_activity = now();
                true
            }
            Err(_) => {
                // Stale channel — webview reloaded or panes swapped.
                *session.channel.lock() = None;
                mirror_delivered
            }
        },
        None => mirror_delivered,
    }
}

pub fn notify_exit(session: &Arc<TerminalSession>) {
    let channel = {
        let guard = session.exit_channel.lock();
        guard.clone()
    };
    if let Some(ch) = channel {
        let _ = ch.send(());
        *session.exit_channel.lock() = None;
    }
}

fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}
