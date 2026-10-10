# 🔭 tto-web — Project Architecture & Quality Audit

**Date:** 2026-09-07
**Repo:** `/Users/kennethaman/tto-web` (branch `main`)
**History:** ~60 commits, single author, 2026-08-26 → 2026-09-07 (two-week, fast-growth codebase)
**Prior audits:** `AUDIT_REPORT.md` (2026-08-27, 79 findings), `SECURITY_REVIEW.md`, `WINDOWS_AUDIT.md` — this report focuses on **architecture, modularity, hygiene, and formatting governance** at the current state.

> Method note: this audit was done directly with static analysis (git, ripgrep, wc, du, tsc, py_compile). It is evidence-based, not speculative. No sub-agent infrastructure exists in this environment.

---

## 1. Executive summary

The project is a genuinely ambitious product: a **desktop terminal orchestrator** (Tauri v2 + React + xterm.js), a **Python FastAPI sidecar** (terminal state, tasks, remote control, git/search/file APIs), a **Rust PTY backend** inside the Tauri app, a **remote-control layer** (WhatsApp/OpenWA + Telegram), and an **embedded IDE** with file tree, editor, git, search, Django command runner, and a native webview browser.

It compiles cleanly (`tsc --noEmit`, `py_compile`, CI builds) — but the architecture has **one dominant structural weakness**: almost every subsystem was built as an ever-growing monolith with **three parallel terminal stacks** and **no lint/format/test enforcement**, so "everything feels messy" is an accurate description even though individual pieces work.

### Snapshot

| Metric | Value | Verdict |
|---|---|---|
| `backend/main.py` | **6,001 LOC, ~90 endpoints** | 🔴 Monolith |
| `frontend/src/styles.css` | **7,289 LOC** | 🔴 Monolith |
| `frontend/src/App.tsx` | **2,616 LOC** | 🔴 Monolith |
| `IDEView.tsx` | 1,208 LOC | 🟠 Large |
| Terminal backends | Python sidecar + Rust PTY + JS xterm, 3 state machines | 🔴 Duplication |
| ESLint / Prettier / Ruff / Black / EditorConfig | **none found** | 🔴 No formatting governance |
| Frontend tests | **0** | 🔴 |
| Backend tests | 1 file (`test_remote.py`, network-dependent) | 🔴 |
| CI | Build-only (macOS/Windows); no typecheck/test/lint job | 🟠 |
| Tracked files | 261 | 🟢 small |
| Trailing-whitespace offenders | 7 source files | 🟢 minor |
| Secrets in git | none tracked (`.env` ignored) | 🟢 |

---

## 2. Architecture findings

### 🔴 2.1 Three overlapping terminal stacks
Terminal lifecycle is implemented **three times**, chosen by runtime and merged at the frontend:

1. **Rust** (`frontend/src-tauri/src/terminal/*`) — real PTY sessions, resize, recovery, scheduler; owned by the desktop build. 8 files incl. `manager.rs` (542 LOC), `session.rs`, `pty.rs`.
2. **Python sidecar** (`backend/main.py`) — its own `terminals` dict + `/api/terminals`, `/api/terminal/open`, `/api/term-panes`, `/ws/term/{pane_id}`, task queues, orchestrator. Primary path for the **web** build and for Terminal.app scanning.
3. **Frontend glue** — `terminal/TerminalManager.ts`, `TerminalPane.tsx` (xterm), `TerminalScheduler.ts`, plus `useTerminals` polling `/api/terminals` **and** `App.tsx` listening to Rust `tauri.list()` events, then a hand-written merge (`unifiedTerminals`) keyed ambiguously by `tty` vs `session_id`.

Consequences: every command has two transports (`tauri.write` vs `POST /api/terminals/{tty}/command`); identifiers ("terminal-7") collide conceptually; bugs are split-brain (session alive in Rust but stale in Python, and vice versa).

**Recommendation:** pick the Rust PTY as the desktop truth and treat the Python layer as an *observer* (it already receives pushed session links). Delete the sidecar's own session-creation code paths, or formalize the sidecar as the only backend and drop the Rust PTY duplication. Then delete the merge shim in `App.tsx`.

### 🔴 2.2 Monolith files concentrate all risk
- `backend/main.py` — 6k LOC, 90 decorators, DB-persistence, git helpers, file watcher trigger, remote control imports, search, uploads, websockets. Any refactor or test requires loading the whole app.
- `frontend/src/styles.css` — 7.3k LOC of global CSS with `!important`-era selectors, view-specific styles and theme variables side by side.
- `App.tsx` — 2.6k LOC: terminal merging, drag/drop routing, workspace CRUD, wizard, restore logic, remote watchers, IDE orchestration, shortcuts — all in one component.

**Recommendation:** split by module ownership (workspaces, terminals, ide, remote, search/git, settings). CSS: adopt CSS modules or scoped component styles per feature area. This is the single biggest "make the project feel professional" lever.

### 🟠 2.3 The IDE is a full second UI grafted into the main window
The app already had FileBrowser/workspace/kanban/planner views; then a VS Code-style IDE (Explorer tree, tabs, CodeMirror editor, git panel, search, Run/Compile, GoLive, Django command runner, native-webview browser) was added as `IDEView.tsx` inside the same React tree, duplicating FileBrowser/GitStatusBadge/SettingsModal surfaces. Domain-specific content (a huge Django `manage.py` command catalog) is hard-coded in `IDEView.tsx`, and code is now conditional on `view === 'ide'` in `App.tsx`.

**Recommendation:** promote `IDEView` to a real route/feature module (it partially exists in `features/agent-workspace/` — apply that pattern), share file-tree/git components with the classic FileBrowser instead of re-implementing.

### 🟠 2.4 Layering is unclear between Rust app, Python sidecar, and remote web
- The Python FastAPI app doubles as the local **sidecar** (spawned by Rust) and as the **remote/mobile backend** (notify/webhook/WhatsApp/Telegram) — one process, two audiences, mixed auth models.
- `backend/remote/` (auth, webhook, telegram, safety, confirmations) is a coherent module; that's the good news. The bad news: `main.py` imports/starts remote concerns inline instead of being a thin composition root.

**Recommendation:** treat `main.py` as a router composition root; move sessions/tasks/orchestrator/git/search/file handlers into `backend/routers/*`.

### 🟠 2.5 Repo contains a second project and OS-absolute symlinks
- `backend/todo-app/` is a full nested Django demo (its own `backend/` + `frontend/`, ~52 MB on disk, 19 tracked files). It is not wired into the app and looks like an experiment or template living inside the real repo.
- `dmg_temp/Applications` is a **tracked symlink → `/Applications`** (the real macOS apps dir). Any tree walker (ripgrep, zip tools, future CI `npm pack`) follows it into Microsoft Word / Telegram bundles; on any other machine the link is broken. This is exactly the kind of thing that makes "the whole project feels messy" to tools.
- On-disk (ignored) but confusing: `backend/frontend` symlink → absolute path, `server.log`, `backend/backend.log`, `frontend/vite.log`, `tauri-dev.log`, `.DS_Store` files, a 22 MB `.dmg` at repo root, `venv/` (59 MB).

**Recommendation:** remove `dmg_temp` (or replace with a real temp dir + gitignore it), delete or relocate `backend/todo-app`, drop the OS symlinks. Add `.DS_Store`, `dmg_temp/`, `*.dmg` already partly covered — confirm ignore list.

---

## 3. Cleanliness & hygiene findings

### 🟠 Duplicated/oversized tracked binaries
- `frontend/public/videos/welcome.mp4` — **14.8 MB** in git history.
- `INSTRUCTION_GUIDE.pdf` (~400 KB), `bot-icon.jpg`, Tauri icon sets ×4 platforms, plus `frontend/public/desktop-icon.png` (1 MB).
- Screenshot **twins**: `screenshots/03_main_view.png` + `frontend/public/screenshots/03_main_view.png`, and the same for `04_filebrowser`, `05_scrolled`, `06_feature_showcase`, `hero_banner`, `logo_readme`. Two copies of the same PNG in one repo.
- `screenshots/download.png`, `main_app.png`, `swagger_ui.png`, `01_workspace.png`, `02_fullpage.png` appear once in `screenshots/`.

**Recommendation:** keep one canonical `frontend/public/screenshots/` set; delete `screenshots/` (or vice versa). Consider git-lfs for `welcome.mp4` or trim it from history.

### 🟠 Stray artifacts at repo root
`api_usage.py` (orphan), `server.log`, `start_server.sh` (one-liner), `remote.sh`, `GEMINI_VIDEO_PROMPT.md`, `graphify-out/` (ignored but present), `screenshots/`, `docs/` — mixed purposes with no folder convention (docs vs scripts vs tools vs audit reports live side by side).

**Recommendation:** adopt a root convention: `docs/audits/`, `scripts/dev/`, `tools/`; move one-off `*.md` prompt files out of the root.

### 🟢 What is actually fine
- `.gitignore` is genuinely good (secrets, build dirs, logs, `.DS_Store`, dmg covered).
- No tracked secrets (`git ls-files | grep .env` → only `.env.example`).
- Low `as any`/`any` count (~26 in 2,600-line App.tsx), few TODO/FIXME markers (18 across FE+BE+Rust).
- TypeScript strict build passes; Python compiles; `backend/remote/` and `frontend/features/agent-workspace/` are good module examples to copy.
- Source files show little trailing-whitespace rot (7 files).

---

## 4. Formatting & engineering-governance findings

1. **No formatter or linter anywhere:** no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `.editorconfig`, `pyproject.toml`/`ruff.toml`/`.flake8`, no rustfmt config beyond defaults. Nothing *enforces* clean formatting, so each feature shipped its own style. CI runs **build only** — it cannot catch unformatted/messy code.
2. **No frontend tests** and one network-dependent backend test file. The 90-endpoint FastAPI monolith is effectively untested.
3. **No pre-commit / husky / githooks**, so whitespace, secrets, and junk creep into commits (see the `dmg_temp` symlink, which should have been caught by a simple path check).
4. Naming/UI drift (observed): the brand appears as "tto", "tto — Terminal Task Orchestrator", "tto IDE", "Task Orchestrator IDE", and "Terminal Task Orchestrator" in different bars/screens; version hard-coded in several places (`v2.3.0` in `App.tsx` header, `tauri.conf.json`, `backend/version.json`).

---

## 5. Risk map

| Severity | Finding | Effort to fix |
|---|---|---|
| 🔴 High | Triple terminal backends (Rust + Python + JS merge) | Large (strategic) |
| 🔴 High | `backend/main.py` 6k LOC / 90 endpoints | Large (mechanical split) |
| 🔴 High | No lint/format/test governance → "messy" is the steady state | Medium (tooling) |
| 🟠 Med | `styles.css` + `App.tsx` monoliths | Medium |
| 🟠 Med | Tracked symlink `dmg_temp/Applications → /Applications` | Trivial |
| 🟠 Med | `backend/todo-app` nested project + duplicated screenshots + large binaries in git | Small |
| 🟠 Med | IDE re-implements FileBrowser/git surfaces | Medium |
| 🟢 Low | Root-level stray files/logs, brand-name drift, hard-coded version | Small |

---

## 6. Recommended action plan (priority order)

**P0 – Governance (fastest path to "professional")**
1. Add `Prettier` + `eslint` (with `typescript-eslint`) to `frontend`; add `ruff` or `black + flake8` to `backend`; add `rustfmt` + `clippy` to `src-tauri`. Add one CI job: `typecheck → lint → format-check → test`.
2. Add `EditorConfig` + a pre-commit hook (husky or `pre-commit`) running format + secret scan + path checks.

**P1 – Hygiene quick wins (hours)**
3. `git rm` the `dmg_temp/Applications` symlink; ensure `dmg_temp/`, `*.dmg`, `server.log` ignored.
4. Delete `backend/todo-app` (move out of repo if still wanted) and the root `screenshots/` duplicate set; keep `frontend/public/screenshots/`.
5. Move stray root scripts/docs into `scripts/` + `docs/audits/`; remove root logs.

**P2 – Architecture (days–weeks, do incrementally)**
6. Refactor `backend/main.py` → routers package (`backend/routers/{terminals,tasks,git,files,search,orchestrator,remote}.py`); keep `main.py` as composition root.
7. Decide the terminal truth: Rust PTY on desktop, sidecar as observer; delete the other path + the `unifiedTerminals` merge in `App.tsx`.
8. Componentize `App.tsx` and `styles.css` by feature; extract IDE's file-tree/git to shared components.
9. Route the IDE through `features/ide/`; remove hard-coded Django catalog duplication and version string drift (read from `backend/version.json`).

---

*Report generated from a static sweep; no files were modified during the audit (working tree contains uncommitted fixes from an earlier session — listed in `git status`).*
