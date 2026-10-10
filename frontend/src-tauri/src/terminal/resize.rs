//! PTY resize helpers (spec §14, §35).
//!
//! The frontend debounces ResizeObserver events (~150 ms) before invoking the
//! resize command. This module clamps dimensions and validates them so a
//! pathological event stream can never corrupt the PTY or trigger resize loops.
//! (Actual ioctl lives in `pty::resize`.)

pub const MIN_COLS: u16 = 2;
pub const MAX_COLS: u16 = 1000;
pub const MIN_ROWS: u16 = 2;
pub const MAX_ROWS: u16 = 500;

/// Clamp raw cols/rows from the frontend into valid PTY dimensions.
pub fn clamp(cols: u16, rows: u16) -> (u16, u16) {
    (
        cols.clamp(MIN_COLS, MAX_COLS),
        rows.clamp(MIN_ROWS, MAX_ROWS),
    )
}

/// True when the new size differs from the stored one (avoids redundant ioctls).
pub fn changed(current_cols: u16, current_rows: u16, cols: u16, rows: u16) -> bool {
    current_cols != cols || current_rows != rows
}
