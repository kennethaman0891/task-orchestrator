let meta = #{
    name: "tto-quit-sweep",
    description: "Read-only sweep for mid-session abort paths in Task Orchestrator",
    phases: [ #{ title: "Sweep", detail: "50 slices" }, #{ title: "Synthesize" } ],
};

let site_schema = #{
    "type": "object", "required": ["ok", "notes"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "notes": #{ "type": "string" }
    }
};

phase("Sweep");
let jobs = [];
jobs.push(#{
    prompt: "You are agent 1 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/lib.rs. The panic hook, isolate_panic, isolate_invoke, setup(), and the eval_with_callback around the webview. Report any path that can still abort the process on the main thread during a live session. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "lib-panic",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 2 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/ipc. Tauri commands. Sync commands run on the main thread. Report unwrap/expect/panic that isolate_invoke does not actually cover, with file and line. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "ipc",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 3 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/terminal/manager.rs. PTY manager. Report panics that can run on the main thread or poison a mutex the main thread later unwraps. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "term-manager",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 4 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/terminal. Every file except manager.rs. Report main-thread panics and eprintln that can panic on a closed stderr. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "term-rest",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 5 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/sidecar.rs. Sidecar supervisor. Report expect/unwrap that runs during a live session, not only at launch. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "sidecar",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 6 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/django. Django helpers. Report main-thread panics. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "django",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 7 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/gateway. Gateway client. Report main-thread panics. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "gateway",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 8 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/workspace. Workspace index. Report mutex poison that the UI thread can hit. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "workspace",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 9 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/relay. Command relay. Report panics that take down the process rather than one task. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "relay",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 10 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/app.rs. TaoApp sendEvent. Confirm the body is inside ffi_catch. Report any remaining panic that still sits directly in the extern C function. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-app",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 11 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/window.rs. TaoWindow sendEvent and other extern C methods. Report value-returning extern C methods that still unwrap. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-window",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 12 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/view.rs. Mouse and scroll extern C methods. Confirm they call ffi_catch. Report any void callback that is NOT wrapped. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-view-mouse",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 13 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/view.rs. Key, IME, and marked-text extern C methods. Report value-returning ones that unwrap on the main thread. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-view-key",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 14 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/window_delegate.rs. Window delegate. Report extern C methods that return a value and can panic (drag, close, fullscreen). A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-delegate",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 15 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/observer.rs. CFRunLoop observers. Confirm stop_app_on_panic no longer calls NSApp stop, and the handlers use ffi_catch. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-observer",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 16 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/app_state.rs. Event queue mutexes. Confirm lock() uses unwrap_or_else into_inner. Report any remaining lock().unwrap(). A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-state",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 17 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/ffi_guard.rs. Confirm ffi_catch is #[inline(never)] and uses catch_unwind. Say if LTO could still inline it. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-guard",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 18 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/event_loop.rs. stop_app_on_panic and run_return. Report if a caught panic can still resume_unwind or stop the app. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-loop",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 19 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/app_delegate.rs. Launch and open-URL handlers. Report unwraps that still abort if the ffi_catch wrapper is missing or returns a value. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-appdelegate",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 20 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos. Files other than app, window, view, window_delegate, observer, app_state, event_loop, app_delegate, ffi_guard. Report extern C or unwrap on the main thread. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-other-macos",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 21 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src/wkwebview/class/wry_web_view_delegate.rs. IPC did_receive. Confirm URL unwraps are gone and the body is inside ffi_catch. Report holes. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-ipc",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 22 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src/wkwebview/class/wry_navigation_delegate.rs. Navigation delegate. Report objc methods that unwrap on the main thread. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-nav",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 23 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src/wkwebview/class/wry_web_view_ui_delegate.rs. UI delegate. Report objc methods that unwrap on the main thread. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-ui",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 24 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src/wkwebview/class/url_scheme_handler.rs. Custom protocol handler. Report panics on the main thread. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-scheme",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 25 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src/wkwebview/drag_drop.rs. Drag and drop. Report panics on the main thread. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-drag",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 26 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src/wkwebview/class/wry_web_view.rs. WKWebView subclass. Report panics on the main thread. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-webview",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 27 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src/wkwebview. download.rs and wry_download_delegate.rs. Report main-thread panics. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-download",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 28 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src. Any other wry file that panics inside an objc or extern C callback. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-rest",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 29 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src/main.tsx. Boot path. Report anything that can tear down the webview or call a native API in a loop that would panic Rust. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "fe-main",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 30 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src/components. Terminal components. Report invoke() calls that pass data which would panic a sync Rust command. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "fe-term",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 31 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src. Agent chat and session code. Report unhandled promise rejections that navigate or destroy the window. Do not claim a JS exception aborts the process unless you can show a native call. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "fe-chat",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 32 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src. Developer City / grid. Report hot-loop invokes. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "fe-city",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 33 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on backend/main.py. Process signals and anything that kills the parent app. The native abort is not a Python traceback. Say so if you find no kill path. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "be-main",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 34 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on backend. FastAPI routes that could crash the sidecar. Distinguish sidecar death from the native SIGABRT. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "be-routes",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 35 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on scripts/build-and-install.sh. Confirm the installer does not pkill -x tto or pkill -f backend/main.py. Quote the kill lines. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "script-install",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 36 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/Cargo.toml. Confirm panic = unwind, and the patch.crates-io paths for tao and wry. Report if lto could undo inline(never). A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "cargo-profile",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 37 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/lib.rs. Read install_panic_hook. Confirm it does not call abort or eprintln. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "hook-log",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 38 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src. Search for remaining eprintln! and .expect( and .unwrap() outside tests. List the ones reachable on the main thread during a session. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "eprintln-left",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 39 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/view.rs. List every extern C function whose signature contains -> and whether its body calls unwrap or expect. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-view-return",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 40 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/window_delegate.rs. List every extern C function whose signature contains -> and whether its body calls unwrap or expect. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "tao-delegate-return",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 41 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/wry/src/wkwebview. Every .unwrap() or .expect( inside an objc method. File and line. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "wry-unwrap",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 42 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/vendor/tao/src/platform_impl/macos/app.rs. Explain whether an ObjC exception inside msg_send in send_event is now caught by ffi_catch. Read the wrapped function. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "objc-exception",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 43 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src. Search lock().unwrap() and parking_lot. Report locks taken on the main thread that can poison. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "mutex-other",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 44 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/terminal. Can a PTY read error panic the main thread? Read the code and answer with the function names. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "pty-panic",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 45 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/lib.rs. Drag-drop handler. Confirm it is inside isolate_panic and does not eprintln. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "drag-path",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 46 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/lib.rs. setup() closure. Does a panic there still abort, and is it launch-only? A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "setup-panic",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 47 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/lib.rs. eval_with_callback completion. Is it on the main thread and outside isolate_panic? A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "eval-callback",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 48 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src-tauri/src/lib.rs. Read the invoke_handler list. Identify any command that is synchronous and unwraps. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "invoke-list",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 49 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on scripts/build-and-install.sh. Confirm a rebuild will not kill /Applications/Terminal Task Orchestrator.app or port 8775. Quote the process match. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "clone-safety",
    capability_mode: "read-only",
    output_schema: site_schema,
});
jobs.push(#{
    prompt: "You are agent 50 of 50 in a read-only sweep of /Users/kennethaman/tto-golden. Do not edit files. Do not run installers. Do not kill processes. Use grep and read_file on frontend/src. Search for window.location reload, location.href, and unhandledrejection. Say if any of them quit the native process. A macOS dialog 'Task Orchestrator quit unexpectedly' is SIGABRT from a Rust panic that reaches an extern C / AppKit frame (panic in a function that cannot unwind). JavaScript exceptions and the Python sidecar dying are not that dialog unless you show a native abort. Set ok=true only if this slice cannot abort a live mid-session. Put file:line and the reason in notes. Keep notes under 800 characters. If the path is missing, say so and set ok=true.",
    label: "frontend-error-boundary",
    capability_mode: "read-only",
    output_schema: site_schema,
});
let results = parallel(jobs);

phase("Synthesize");
let bundle = "";
let i = 0;
for r in results {
    i += 1;
    if r != () && r.success && r.output != () {
        let flag = if r.output.ok == true { "OK" } else { "RISK" };
        let notes = r.output.notes;
        if notes == () { notes = ""; }
        bundle += flag + " " + i.to_string() + ": " + notes + "\n";
    } else {
        bundle += "FAIL " + i.to_string() + "\n";
    }
}
let synth = agent(
    "You are the synthesizer. Below are 50 read-only slice notes about why Task Orchestrator quits with a macOS abort dialog. "
    + "List only risks that can SIGABRT the native process during a live session. Ignore sidecar-only and JS-only notes. "
    + "Quote the file from the note. If a note says a callback is already inside ffi_catch or isolate_panic, do not report it as an open abort. Keep the answer under 40 lines.\n\n"
    + bundle,
    #{ label: "synthesize", capability_mode: "read-only" }
);
let text = "";
if synth != () && synth.success && synth.output != () { text = synth.output; }
if text == () { text = bundle; }
complete(#{ report: text });

