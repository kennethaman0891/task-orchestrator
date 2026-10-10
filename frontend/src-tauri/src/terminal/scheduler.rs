//! Centralized render scheduler (spec §10, §27, §31, §12).
//!
//! Priority model:
//!   focused    → flush up to 64 chunks per 16 ms tick (instant typing/UX)
//!   visible    → flush up to 16 chunks per 16 ms tick (normal live output)
//!   visible+compact → flush up to 24 chunks per 16 ms tick (smaller panes
//!                     need more frequent updates to stay readable)
//!   background → flush up to 8 chunks per 250 ms tick (throttled, coalesced)
//!
//! Round-robin across sessions prevents one terminal from starving others.
//! IMPORTANT: only RENDERING is throttled — the PTY/process always runs.
//!
//! Flush deadlines: the 16 ms tick is the max-age deadline for focused/visible
//! terminals, so live output streams while an agent works (never waits for a
//! whole burst).

use std::sync::Arc;
use std::time::Duration;

use super::manager::TerminalManager;

/// ms between scheduler ticks.
const TICK_MS: u64 = 16;

pub fn spawn_scheduler(manager: Arc<TerminalManager>) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(TICK_MS));
            tick += 1;

            // Snapshot active sessions and their budgets in a single lock acquisition per tick
            let tasks: Vec<(Arc<super::session::TerminalSession>, usize)> = {
                let sessions = manager.sessions.lock();
                sessions
                    .values()
                    .filter_map(|s| {
                        let mode = s.mode();
                        let budget = match mode {
                            "focused" => 64,
                            "visible" => {
                                let m = s.meta.lock();
                                if m.grid_mode == "compact" { 24 } else { 16 }
                            }
                            _ => {
                                // Background & detached sessions: drain smoothly every 4th tick (≈64ms)
                                // with 32-chunk budget so long-running tasks never accumulate backpressure.
                                if tick % 4 == 0 {
                                    32
                                } else {
                                    0
                                }
                            }
                        };
                        if budget > 0 {
                            Some((Arc::clone(s), budget))
                        } else {
                            None
                        }
                    })
                    .collect()
            };

            for (session, budget) in tasks {
                manager.drain_session(&session, budget);
            }
        }
    });
}
