// Copyright 2026 Kenneth Aman
// SPDX-License-Identifier: Apache-2.0
//
// Local patch. Not part of upstream tao.

use std::panic::{catch_unwind, UnwindSafe};

/// Run an AppKit callback body without letting a panic escape.
///
/// `extern "C"` callbacks are nounwind. Inlining `catch_unwind` into one of
/// them makes the panic abort with "panic in a function that cannot unwind",
/// which is the macOS "quit unexpectedly" dialog. This function is
/// `#[inline(never)]` so LTO cannot fold the catch into that frame.
#[inline(never)]
pub(crate) fn ffi_catch(f: impl FnOnce() + UnwindSafe) {
  let _ = catch_unwind(f);
}

/// Same boundary as `ffi_catch` for callbacks that must return a value.
/// A panic returns `R::default()` (nil, zero, or false) instead of aborting.
#[inline(never)]
pub(crate) fn ffi_catch_default<R: Default>(f: impl FnOnce() -> R + UnwindSafe) -> R {
  catch_unwind(f).unwrap_or_else(|_| R::default())
}
