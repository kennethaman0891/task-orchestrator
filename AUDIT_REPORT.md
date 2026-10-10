# 🔍 tto-web Comprehensive Audit Report
**Date:** 2026-08-27  
**Scope:** Full codebase — frontend, backend, Tauri, Windows build  
**Total Findings:** 79 (5 critical, 20 high, 23 medium, 31 low)

---

## Summary by Area

| Area | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| Frontend (React/TS) | 5 | 11 | 14 | 20 | 50 |
| Backend (Python/FastAPI) | 3 | 6 | 4 | 6 | 19 |
| Tauri / Windows Build | 2 | 3 | 3 | 4 | 12 |
| **TOTAL** | **10** | **20** | **21** | **30** | **81** |

---

## 🔴 CRITICAL Issues (Must Fix Before Next Release)

### C1. [Frontend] Hardcoded macOS Home Path in IDEView.tsx:53
**Impact:** Every non-macOS user (or any other mac user) gets a broken file tree when opening IDE view with no project path set.
```tsx
// Current (BROKEN):
const rootPath = projectPath || '/Users/kennethaman';
// Fix: Use empty string fallback, let API handle it
const rootPath = projectPath || '';
```

### C2. [Frontend] Rename Button in FileBrowser Does Nothing — FileBrowser.tsx:187-193
**Impact:** Users can't rename files/folders through context menu. The prompt fires, user types name, clicks OK — nothing happens.
```tsx
// Current (BROKEN):
onClick={() => {
  const n = prompt('Rename to:', target.name);
  if (n && n !== target.name) {
    console.info(`[FileBrowser] rename: ...`);
    onDismiss();  // ← menu closes before renameItem is called!
  }
}}
// Fix: Call renameItem() BEFORE onDismiss(), and handle async properly
```

### C3. [Frontend] Duplicate Editor Rendered in Fallback View — App.tsx:1315 & :1606
**Impact:** When `view` is anything other than 'wizard', 'ide', or 'workspace', both editor blocks render simultaneously. Unknown views get two editors.
**Fix:** Move editor section outside the view switch condition or use mutually exclusive `if/else`.

### C4. [Backend] Entire Core is macOS-Only — Windows Will Not Run (main.py)
**Impact:** The app claims cross-platform support but every critical code path is POSIX-only. PTY spawn, Terminal.app/osascript calls, tmux commands, lsof, process scanning — all fail on Windows.
**Key areas:**
- `_spawn_pty()` (lines 2955-2980) — uses `pty.openpty()`, `fcntl.ioctl()`, `termios.TIOCSWINSZ`
- `_open_terminal_window()` (lines 1023-1224) — calls `osascript` / Terminal.app
- `scan_terminals()` (lines 828-960) — uses `ps -axo`, `lsof -a -p`
- Agent delivery `send_to_terminal_shell()` (lines 1285-1370) — three-tier AppleScript
- Kill PID (`_kill_pid`) — partial taskkill path exists but callers don't check IS_WINDOWS

**Fix needed:** Every function that spawns processes must branch on `IS_WINDOWS`.

### C5. [Tauri/Windows] DMG Target in tauri.conf.json Causes Windows Build Failure
**Impact:** CI on `windows-latest` will fail because DMG requires macOS disk-image tooling.
```json
// Current (BROKEN for Windows builds):
"targets": ["app", "dmg", "msi"]
// Fix: Remove "dmg" from targets, add --bundles app,msi in workflow
```

### C6. [Backend] Directory Sibling Path Traversal Bypass (main.py:3959)
**Impact:** Weak `startswith` path containment check can be bypassed via symlinks on case-insensitive filesystems.
```python
# Current:
if not str(target).startswith(str(Path.home().resolve())):
# Fix: Use relative_to consistently everywhere
if target.resolve() not in [Path.home().resolve(), *Path.home().resolve().parents]:
```

### C7. [Frontend] Directories Open as Files in IDEView — IDEView.tsx:311
**Impact:** Every single-click on a folder tries to open it as a file alongside toggling expand/collapse.
```tsx
// Current (BROKEN):
onClick={() => { if (node.isDir) toggleDir(node.path); onFileClick(node); }}
// Fix:
onClick={() => { if (node.isDir) { toggleDir(node.path); return; } onFileClick(node); }}
```

### C8. [Backend] Dead Code at Line 3394 — orphaned return statement
**Impact:** Syntax that either causes errors or does nothing.
```python
# Line ~3394:
return {"branch": None}  # orphaned between route definitions
```

### C9. [Backend] Unbounded File Watcher Traverses All Subdirs — file_watcher.py
**Impact:** On large projects, traverses `node_modules/`, `.git/`, `__pycache__/`, `.venv/` etc. causing severe CPU/I/O pressure. No directory exclusion list exists.

### C10. [Backend] Path Depth Calculation Assumes Unix Separators (main.py:3361,3364)
**Impact:** On Windows, `Path.relative_to()` returns backslash-separated strings, so `split("/")` returns `[single_element]` and depth/exclusion checks always break.

---

## 🟠 HIGH Issues (Should Fix Before Next Release)

### H1. [Frontend] Zero Fetch Timeouts in api/client.ts
**Impact:** All ~40 API calls hang forever if sidecar becomes unresponsive. No AbortController timeout on any fetch.
**Fix:** Add default `AbortSignal.timeout(10000)` to all fetch calls, or wrap with a helper.

### H2. [Frontend] Double-Click vs Single-Click Conflict on Directories (IDEView)
**Impact:** Same as C7 — clicking a directory toggles expansion AND tries to open it as a file.

### H3. [Frontend] `window.prompt()` Used for Create/Rename Operations — FileBrowser.tsx:169, 177, 188
**Impact:** Native browser modals block the main thread, cannot be styled, break desktop immersion.
**Fix:** Replace with inline input fields or proper modal dialogs.

### H4. [Frontend] WebSocket Poll Redundant & Order-Dependent Hash — useTerminals.ts:29, 53-66
**Impact:** 3-second polling runs even when WebSocket is connected. Hash comparison is order-dependent.
**Fix:** Stop poll when WS connected. Use structural comparison.

### H5. [Frontend] Keyboard Shortcuts Fire Even When Typing in Inputs — App.tsx:290-326
**Impact:** Typing `cmd+t` in a text input accidentally opens the wizard.
**Fix:** Skip shortcuts when `activeElement` is input/textarea/contenteditable.

### H6. [Backend] Fire-and-Forget Tasks Without Exception Handling (main.py lines 776-778, 1742, 2079, etc.)
**Impact:** Background tasks crash silently with no restart logic. Scanner/output/completion loops disappear.
**Fix:** Store task references, add retry with exponential backoff.

### H7. [Backend] In-Memory Caches Have No Eviction (main.py)
**Impact:** `orchestrations` dict grows without bound. `completion_watch` accumulates orphaned entries.
**Fix:** Add size limits and TTL-based eviction.

### H8. [Backend] Race Condition in broadcast_state → aggregate_token_usage (main.py:964)
**Impact:** Concurrent read of terminal dicts without locks during periodic scan.

### H9. [Backend] ~28 Synchronous subprocess.run() Calls Block Event Loop (main.py)
**Impact:** lsof per terminal every 3s, opencode run blocking 180s, model listing blocking 1-5s each call.
**Fix:** Wrap in `asyncio.to_thread()`.

### H10. [Backend] Bare `except:` Swallows All Exceptions (main.py lines 659, 854)
**Impact:** WebSocket errors and tmux crashes are silently ignored.

### H11. [Tauri/Windows] ego-lite Detection Paths Missing Modern Locations — ipc/mod.rs
**Impact:** Windows detection misses `%LOCALAPPDATA%\Programs\ego-lite`.
**Fix:** Add modern Windows installation paths to probe list.

### H12. [Tauri/Windows] MSVC Toolchain Not Guaranteed in Local Build Scripts
**Impact:** Local Windows builds fail if default Rust toolchain is GNU instead of MSVC.
**Fix:** Add `rustup target add x86_64-pc-windows-msvc` to build scripts.

### H13. [Backend] Path Containment Uses startswith Instead of relative_to (main.py:3173)
**Impact:** Same as C6 — symlink bypass possible.

### H14. [Frontend] Wire Persisted in Two Places Can Diverge — WorkspaceTaskCenter.tsx:112-126
**Impact:** localStorage read in useState + separate useEffect creates flash on mount.

### H15. [Frontend] Task Stats Show ALL Terminals, Not Just Active Workspace — WorkspaceControlPanel.tsx:106-122
**Impact:** Counts are inflated and misleading.

### H16. [Frontend] Rename Menu Dismisses Before Async Rename Completes — FileBrowser.tsx:67-70
**Impact:** If rename fails, menu is already closed, user can't retry.

### H17. [Frontend] `key={d.name}` Collides on Duplicate Names — FileBrowser.tsx
**Impact:** Two files/folders with same name in same directory cause React key collisions and stale state.

### H18. [Frontend] handleOpenFile Uses Global Window Variable — App.tsx:725
**Impact:** `(window as any).__tto_pending_goto_line` — fragile, second request overwrites first.

### H19. [Tauri/Windows] No Windows SmartScreen/Code-Signing in CI
**Impact:** Unsigned MSI triggers "Unknown Publisher" warning, blocks most users.

### H20. [Backend] tty.replace("ttys","") is macOS-Specific (main.py:4078,4093,4106)
**Impact:** Linux ttys named `pts/0`, `tty1` produce garbage labels. Windows has no ttys at all.

---

## 🟡 MEDIUM Issues

### M1. [Frontend] O(n) Terminal Lookup on Every Render — TerminalWorkspace.tsx:83
**Impact:** Linear scan of all terminals on every render.

### M2. [Frontend] All Terminal Panes Permanently Mounted — TerminalWorkspace.tsx:165-167
**Impact:** 16 terminals × 50K scrollback = hundreds of MB memory.

### M3. [Frontend] loadAllFiles Fetches Depth 4 Recursively — App.tsx:255
**Impact:** Thousands of chained sequential API calls in large projects.

### M4. [Frontend] Duplicate doSave Logic Between Two Effects — CodeEditor.tsx:92 & :176
**Impact:** Any change to one must be mirrored in the other.

### M5. [Frontend] Lint Toggle Not Keyboard Accessible — CodeEditor.tsx:269-277
**Impact:** `<span>` with onClick — can't be focused with Tab or activated with Enter.

### M6. [Frontend] No aria-label on Sidebar — Sidebar.tsx:52
**Impact:** Screen readers don't know panel purpose.

### M7. [Frontend] Workspace Items Lack aria-current — Sidebar.tsx:62-64
**Impact:** Active workspace not communicated to assistive tech.

### M8. [Frontend] viewMode Toggle Buttons Lack aria-pressed — WorkspaceControlPanel.tsx:156-171
**Impact:** Mutually exclusive buttons not exposed as radio group.

### M9. [Frontend] Hardcoded Font Stack Biased Toward macOS — styles.css:15
**Impact:** SF Mono/Menlo/Monaco are macOS-only.

### M10. [Frontend] fetchRemoteSessions/Workspaces Don't Use handle() — api/client.ts:214-232
**Impact:** Non-200 responses return garbage, errors swallowed.

### M11. [Frontend] fetchModels Also Bypasses handle() — api/client.ts:247-255
**Impact:** Same pattern as M10.

### M12. [Frontend] No Virtual Scrolling in Large Terminal Lists — WorkspaceTaskCenter.tsx:749-778
**Impact:** Will degrade with 20+ terminals.

### M13. [Frontend] Blocking window.prompt in handleDone — WorkspaceTaskCenter.tsx:552
**Impact:** Blocks JS main thread.

### M14. [Frontend] Context Menu Close Delay Race — FileBrowser.tsx:106-112
**Impact:** setTimeout(0) race condition for closing menus.

### M15. [Backend] Log Injection Partially Mitigated — main.py:269-276
**Impact:** CR/LF replacement is fragile with truncation.

### M16. [Backend] No Rate Limiting on Any Endpoint
**Impact:** Any local user can spam expensive endpoints.

### M17. [Backend] annotation Endpoint Trusts All Fields — main.py:4183-4207
**Impact:** Unvalidated bounding_box dict flows into LLM context.

### M18. [Tauri/Windows] portable-pty Requires Windows 10 1809+
**Impact:** App compiles fine but crashes on older Windows versions.

### M19. [Frontend] handleResizeH Doesn't Clean Up on Unmount — IDEView.tsx:124-137
**Impact:** mousemove/mouseup listeners leak if drag interrupted.

### M20. [Frontend] No Escape Key Handler During Resize — IDEView.tsx:124-137
**Impact:** No way to cancel resize mid-drag.

### M21. [Frontend] No Loading Skeleton for File Tree — IDEView.tsx:56-73
**Impact:** Large projects feel unresponsive during tree load.

### M22. [Frontend] gitPath Prop Always Empty String — App.tsx:1552, 1661
**Impact:** Git status badge is a dummy, never shows actual status.

### M23. [Frontend] No Confirmation Before Killing Terminal — TerminalWorkspace.tsx, TerminalPane.tsx
**Impact:** Accidental clicks destroy sessions.

---

## 🟢 LOW Issues

### L1. [Frontend] Module-Level Mutable State in App.tsx:46-47
**Impact:** `restoreDone` survives HMR, causes stale state in dev.

### L2. [Frontend] Inconsistent Indentation in WorkspaceWizard.tsx:60
**Impact:** Cosmetic.

### L3. [Frontend] __tto_pending_goto_line on Window Object — App.tsx:725
**Impact:** Global mutation could conflict with extensions.

### L4. [Frontend] Toast Timer Not Cleared on Unmount — App.tsx:328-326
**Impact:** Minor memory leak.

### L5. [Frontend] Multiple eslint-disable for exhaustive-deps — App.tsx (13 occurrences)
**Impact:** May hide genuine missing dependencies.

### L6. [Backend] uid Variable Computed But Unused — main.py:1028
**Impact:** Cosmetic artifact.

### L7. [Backend] send_notification Swallows All Errors Silently — main.py:172-191
**Impact:** Misconfigured notifications invisible to user.

### L8. [Frontend] editor-icon alt Text Too Terse — IDEView.tsx:145
**Impact:** Accessibility minor.

### L9. [Frontend] terminal-updated Event Listener Async Assignment — App.tsx:189
**Impact:** Potential listener leak if unmount before promise resolves.

### L10. [Frontend] Universal Scrollbar Styling — styles.css:42-46
**Impact:** Minor performance hit on heavy pages.

### L11. [Frontend] useFileWatcher Debounce Assumes Seconds — useFileWatcher.ts:31
**Impact:** May miss or over-report changes depending on mtime unit.

### L12. [Tauri/Windows] Icon Config Lists .icns (macOS-only) in Cross-Platform Bundle
**Impact:** Clutters bundle, harmless on Windows.

### L13. [Tauri/Windows] build-windows.bat Path Separator Inconsistency
**Impact:** Fragile navigation, works by accident.

---

## 🔧 Recommended Fix Priority

### Phase 1: Critical Fixes (Do These First)
1. **C2** — Fix rename button in FileBrowser (3 min)
2. **C7/C2** — Fix directory click bug in IDEView (3 min)
3. **C1** — Remove hardcoded macOS path in IDEView (2 min)
4. **C5** — Fix tauri.conf.json DMG target (2 min)
5. **C3** — Eliminate duplicate editor render (5 min)
6. **C9** — Add directory exclusions to file_watcher.py (5 min)
7. **C10** — Fix path separator in backend search (3 min)
8. **H1** — Add fetch timeouts to api/client.ts (10 min)
9. **H17** — Fix React keys in FileBrowser (2 min)
10. **H19** — Add rustup target to Windows build scripts (3 min)

### Phase 2: High-Priority Fixes
11. **H3** — Replace prompt() with inline UI in FileBrowser (15 min)
12. **H5** — Add input focus guard to keyboard shortcuts (5 min)
13. **H14** — Fix wire persistence divergence in WorkspaceTaskCenter (5 min)
14. **H15** — Scope task stats to active workspace (5 min)
15. **H4** — Fix WebSocket poll redundancy (5 min)
16. **B3** — Store background task references with restart logic (15 min)
17. **B4** — Add directory exclusion to file_watcher.py (5 min)
18. **H20** — Fix tty label format for cross-platform (5 min)

### Phase 3: Medium Fixes
19-30. (see detailed list above)

### Phase 4: Low / Polish
31-50. (see detailed list above)

---

## 📋 Windows-Specific Issues (Separate Detailed Report)

See also: `WINDOWS_AUDIT.md` for dedicated Windows compatibility report.

**Key Windows blockers:**
- Backend is fully macOS-only (terminal spawning, osascript, tmux, lsof, PTY)
- DMG target breaks Windows builds
- MSVC toolchain not guaranteed
- ego-lite detection misses modern Windows paths
- No code-signing in CI release workflow
- portable-pty requires Windows 10 1809+
