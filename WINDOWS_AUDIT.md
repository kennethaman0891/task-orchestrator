# 🪟 tto-web — Windows Compatibility Audit Report
**Date:** 2026-08-27  
**Status:** NOT YET DEPLOYED TO GITHUB  
**Build System:** Tauri v2 + FastAPI backend + React frontend

---

## Executive Summary

The tto-web application is currently **macOS-only in practice**, despite claiming cross-platform support. The Windows build pipeline exists and compiles, but the runtime behavior is completely non-functional on Windows due to:

1. **Backend**: All terminal/process management code is POSIX-only (osascript, tmux, pty, lsof)
2. **Frontend**: Hardcoded macOS paths in fallback logic
3. **Build**: DMG target breaks Windows CI builds
4. **Distribution**: No code-signing → SmartScreen warnings

---

## 🔴 CRITICAL — Build Will Fail on Windows

### W1. DMG Target Breaks Windows Builds
**File:** `frontend/src-tauri/tauri.conf.json` line 34
```json
"targets": ["app", "dmg", "msi"]
```
`dmg` requires macOS disk-image tooling. `cargo tauri build` on Windows will fail trying to create a DMG.

**Fix:**
- Option A: Remove `"dmg"` from targets entirely, add `--bundles dmg` to macOS workflow
- Option B (quick): Add `--bundles app,msi` to the Windows workflow command

### W2. GitHub Workflow Doesn't Override Bundles — CI Will Fail
**File:** `.github/workflows/build-windows.yml` line 40
```yaml
run: cargo tauri build --target ${{ matrix.target }}
# Missing: --bundles app,msi
```
Without bundle override, this hits W1 and fails every time.

**Fix:**
```yaml
run: cargo tauri build --target ${{ matrix.target }} --bundles app,msi
```

### W3. MSVC Toolchain Not Explicitly Specified
**File:** `build-scripts/build-windows.bat`, `build-scripts/build-windows.sh`, `.github/workflows/build-windows.yml`

Local developers may have GNU toolchain by default. CI uses `dtolnay/rust-toolchain@stable` which defaults to MSVC on Windows, but local builds may fail.

**Fix:** Add to both scripts and workflow:
```bat
rustup target add x86_64-pc-windows-msvc
```

---

## 🟠 HIGH — Runtime Will Be Broken on Windows

### W4. Backend Terminal Spawning Is Fully macOS-Only
**File:** `backend/main.py` (multiple functions)

| Function | Lines | What It Does | Windows Status |
|----------|-------|-------------|----------------|
| `_spawn_pty` | 2955-2980 | Creates pseudo-terminal | ❌ `pty.openpty()`, `fcntl.ioctl()`, `termios` all missing |
| `_open_terminal_window` | 1023-1224 | Opens Terminal.app via osascript | ❌ No Terminal.app on Windows |
| `scan_terminals` | 828-960 | Lists PTYs via `ps` + `lsof` | ❌ Neither command available |
| `send_to_terminal_shell` | 1285-1370 | Delivers agent output via AppleScript | ❌ AppleScript doesn't exist |
| `_kill_pid` | 33-50 | Kills terminal process | ⚠️ Has taskkill path but callers don't use it |

**Fix Required:** Every function must check `IS_WINDOWS` and use Windows-native equivalents:
- PTY → `conpty.dll` via `portable-pty` (already a dependency!)
- Terminal window → PowerShell.exe or Windows Terminal
- Process scanning → WMI / `tasklist` / `wmic`
- Agent delivery → Direct stdin write to process

### W5. Backend File Watcher Traverses Everything, No Exclusions
**File:** `backend/file_watcher.py` lines 75-106
```python
for entry in search_root.rglob("*"):  # Goes into node_modules, .git, .venv, etc.
```
On Windows, paths use backslashes but the logic should work. However, there's **no exclusion list** at all — any project with `node_modules/` or `.git/` will cause severe I/O pressure.

**Fix:** Add standard exclusions:
```python
EXCLUDED_DIRS = {'.git', '.venv', 'node_modules', '__pycache__', 'dist', 'build', '.tox', '.mypy_cache'}
```

### W6. Backend Path Depth Calculation Uses Forward Slashes
**File:** `backend/main.py` lines 3361, 3364
```python
depth = len(rel.split("/"))
if any(ex in rel.split("/") for ex in excluded):
```
On Windows, `Path.relative_to()` returns backslash-separated strings. `split("/")` returns `[single_element]`, so depth is always 1 and exclusion list never matches.

**Fix:**
```python
parts = rel.replace("\\", "/").split("/")
depth = len(parts)
```

### W7. Backend `tty` Label Format is macOS-Only
**File:** `backend/main.py` lines 4078, 4093, 4106
```python
label = tty.replace("ttys", "")
```
- macOS: `ttys003` → `"003"` ✓
- Linux: `pts/0` → `""` (empty) ✗
- Windows: no ttys at all → crash or garbage ✗

**Fix:** Use platform-aware formatting:
```python
if sys.platform == "win32":
    label = f"Terminal-{pid}"
elif tty.startswith("ttys"):
    label = tty.replace("ttys", "")
else:
    label = tty.replace("pts/", "").replace("tty", "")
```

### W8. Hardcoded macOS Home Path in IDEView.tsx
**File:** `frontend/src/components/IDEView.tsx` line 53
```tsx
const rootPath = projectPath || '/Users/kennethaman';
```
Every Windows user with no project path set will get a broken file tree (path doesn't exist).

**Fix:**
```tsx
const rootPath = projectPath || '';
```

### W9. ego-lite Detection Misses Modern Windows Paths
**File:** `frontend/src-tauri/src/ipc/mod.rs` lines ~110-130
```rust
// Current Windows probes:
format!("{}\\ego-lite", home.display()),
"C:\\Program Files\\ego-lite",
"C:\\Program Files (x86)\\ego-lite",
```
Missing common Windows install locations:
- `%LOCALAPPDATA%\Programs\ego-lite`
- `%APPDATA%\ego-lite`

**Fix:** Add modern paths:
```rust
format!("{}\\AppData\\Local\\Programs\\ego-lite", home.display()),
format!("{}\\AppData\\Roaming\\ego-lite", home.display()),
```

### W10. Batch Script Path Separator Inconsistency
**File:** `build-scripts/build-windows.bat` lines 14-21
```bat
cd /d "%~dp0..\frontend"        # forward slash mixed with backslash
cd /d "%~dp0..\\frontend\\src-tauri"   # escaped backslashes
```
Works by accident but is fragile.

**Fix:** Use a consistent anchor variable:
```bat
set "REPO_ROOT=%~dp0.."
cd /d "%REPO_ROOT%\frontend"
...
cd /d "%REPO_ROOT%\frontend\src-tauri"
```

---

## 🟡 MEDIUM — Runtime Risks on Windows

### M1. No Code-Signing in CI Release
**File:** `.github/workflows/build-windows.yml`

Unsigned MSI → Windows SmartScreen shows "Unknown Publisher" warning → most users won't install.

**Fix:** Add signing step (requires code-signing certificate stored as GitHub Secret):
```yaml
- name: Sign MSI
  if: startsWith(github.ref, 'refs/tags/')
  run: signtool sign /fd SHA256 /tr http://timestamp.sectigo.com /td SHA256 /f ${{ secrets.WIN_CERT_PFX }} /p ${{ secrets.WIN_CERT_PASSWORD }} frontend/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/tto_*.msi
```

### M2. portable-pty ConPTY Requires Windows 10 1809+
**File:** `frontend/src-tauri/src/terminal/pty.rs`

The `portable-pty` crate uses native ConPTY API on Windows, only available on Windows 10 version 1809 (build 17763) and later. Older versions will crash at runtime.

**Fix:** Document minimum OS requirement in README. Optionally add runtime version check.

### M3. No Minimized/Maximized Window State Handling
**File:** `frontend/src-tauri/src/lib.rs` or `main.rs`

No visible handling of window minimize/maximize events. Window controls in IDEView are decorative (see frontend audit item #49).

### M4. Icons Include macOS-Only .icns Format
**File:** `frontend/src-tauri/tauri.conf.json` line 37
```json
"icons/icon.icns"
```
Harmless (Tauri ignores on Windows) but clutters the bundle.

---

## ✅ What Already Works on Windows

| Component | Status | Notes |
|-----------|--------|-------|
| Tauri frontend compilation | ✅ | `cargo tauri build` succeeds on Windows |
| Rust sidecar binary | ✅ | Compiles, launches Python sidecar |
| Sidecar process spawning | ✅ | `sidecar.rs` has `#[cfg(target_os = "windows")]` python path |
| WebSocket relay | ✅ | Platform-agnostic tokio-tungstenite |
| API base URL detection | ✅ | `isTauri()` via `__TAURI_INTERNALS__` works cross-platform |
| MSBuild artifacts upload | ✅ | Workflow uploads both MSI and NSIS correctly |

---

## 📋 Priority Fix List for Windows Support

### Must-Fix Before Any Windows Testing
1. **W1 + W2** — Remove DMG from targets + add `--bundles app,msi` to workflow (5 min)
2. **W3** — Add `rustup target add` to build scripts (3 min)
3. **W8** — Remove hardcoded `/Users/kennethaman` in IDEView (2 min)
4. **W9** — Add modern Windows paths to ego-lite detection (5 min)
5. **W10** — Fix batch script path consistency (5 min)

### Must-Fix Before Windows Distribution
6. **W4** — Implement Windows terminal spawning (8-12 hours)
7. **W5** — Add directory exclusions to file watcher (10 min)
8. **W6** — Fix path separators in backend search (10 min)
9. **W7** — Fix tty label formatting (10 min)
10. **M1** — Add code-signing to CI release (30 min, needs cert)

### Nice-to-Have
11. **M2** — Document Windows 10 1809+ requirement (5 min)
12. **M4** — Remove .icns from cross-platform icon list (2 min)
13. Add Windows README section with setup instructions (15 min)

---

## 📊 Windows vs macOS Feature Parity

| Feature | macOS | Windows |
|---------|-------|---------|
| Terminal spawning | ✅ | ❌ (needs ConPTY rewrite) |
| File browser | ✅ | ✅ (works once projectPath set) |
| Agent orchestration | ✅ | ❌ (depends on terminal) |
| Git operations | ✅ | ✅ |
| Task center | ✅ | ✅ |
| Settings/UI | ✅ | ✅ |
| Remote control (WhatsApp) | ✅ | ✅ |
| Workspace management | ✅ | ✅ |
| File upload (drag-drop) | ✅ | ✅ |
| Code editor | ✅ | ✅ |

**Bottom line:** The frontend (React) works cross-platform. The backend (Python) is fully macOS-only. The Rust sidecar bridges them but assumes the Python sidecar runs on macOS.
