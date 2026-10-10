# Task Orchestrator — Terminal Task Orchestrator
## Complete Instruction Guide (v2.4.0: Tauri 2 Native Desktop)

---

## 0. Plain-English Overview (For Non-Tech Readers)

**What the app does:** tto watches the terminals on your Mac that run AI coding
agents (opencode, Claude, Codex, Gemini…), lets you assign tasks to them, and
shows you what each one is doing in one dashboard. You can type **one goal** and
the built-in **Orchestrator** splits it into sub-tasks — one per terminal — and
runs them all in parallel, live.

### Frontend — what you see on screen
- The interface: terminal windows, **Orchestrator board** (Kanban), Task
  Center, file browser, code editor, token-usage panel, **IDE view** (VS Code
  layout), **floating colorful wire connections**, **Command Palette**, and
  **UI Inspector**.
- Lives in `frontend/`. Runs as a **desktop app** (Tauri) and also as a web
  page at `http://localhost:1420` (dev) or `http://localhost:8765`.

### Backend — the brains behind the scenes
- Python program (`backend/main.py`) that runs locally on port 8765.
- Scans the computer for terminals running AI agents, tracks tasks/sessions,
  asks the local AI for "next task" suggestions and session summaries, and
  controls terminals (opens windows, sends commands).
- The desktop app also has a **Rust engine** (`frontend/src-tauri/`) that owns
  the real terminal windows and auto-starts the Python backend.
- **`tto` launcher** (`~/.local/bin/tto`): one-word command that restarts the
  sidecar when the backend changed, rebuilds the app when sources changed,
  syncs the `.app` bundle, and replaces any stale running instance.

### Database — how things are saved
- **No traditional database** (no Postgres, MySQL, MongoDB, etc.).
- Backend state is saved to a simple JSON file: `~/.tto-web/state.json`.
- Reads (read-only) opencode's SQLite file for token-usage stats.
- Frontend preferences (workspaces, theme) live in the browser's localStorage.

### Frameworks we use
- **Frontend:** React 19 (UI), Vite 6 (build tool), xterm.js (in-app
  terminals), CodeMirror 6 (code editor), Tauri 2 (desktop shell).
- **Backend:** Python + FastAPI (server), Uvicorn, Pydantic.
- **Desktop engine:** Rust + Tauri 2, portable-pty (real terminal sessions).

### CSS / styling
- One hand-written file (`frontend/src/styles.css`) — **no CSS framework**
  (not Tailwind, not Bootstrap).
- Dark theme by default, with colors defined once as CSS variables so the
  whole look changes by swapping a few values.
- 7 built-in themes: Void, Neon Tokyo, Synthwave, Dracula, Carbon, Obsidian,
  Paper.
- Layout uses Flexbox + CSS Grid and adapts to smaller windows.

---

## 1. What Is This?

Task Orchestrator solves exactly one problem: you have 30+ terminals open, each running an AI
agent (opencode, Claude Code, Codex, Gemini CLI, etc.), and you can't remember
which terminal is doing what.

The **v2.0.0 architecture** is a native desktop application (Tauri 2 + Rust +
React) that:

- Renders a **multi-terminal workspace grid** — every pane is a **real PTY**
  running your actual login shell (no tmux, no browser tricks)
- Lets you **launch any AI CLI** (opencode, claude, codex, gemini) inside a pane
  and gives it a full-workspace canvas automatically when it starts (TUI
  auto-expand)
- Tracks **token usage** per model across ALL opencode sessions (with editable
  limits for OmniRoute Local AI / FreeLLMPool / LLMBuffet)
- Manages **tasks** per terminal: current / next / queue / history / context /
  AI-suggested next task — with **auto-completion**: a task flips to `done` on
  its own the moment the agent's turn finishes (opencode `step-finish/stop`
  marker in `~/.local/share/opencode/opencode.db`)
- Includes a **file browser + built-in code editor** (CodeMirror 6)
- Shows the same live data in **4 views**: Workspace grid · **Kanban
  (Orchestrator)** · Cards · Table
- **Orchestrator** (Kanban view): a ChatGPT-style chat — type ONE goal, it
  splits it into sub-terminals (the terminals open in the selected workspace)
  and dispatches a real task to each, with live split cards updating as the
  agents work
- Uses a **Rust engine** for terminals (fast, priority-scheduled output) and a
  **Python sidecar** for tasks / token usage / files / LLM suggestions

---

## 2. Architecture Overview

```
┌───────────────────────────────────────────────────────────────┐
│              Task Orchestrator DESKTOP APP (Tauri 2 + React 19)             │
│   Workspace grid · Kanban · Cards · Table · Editor · Sidebar  │
│   Vite dev server :1420  (proxies /api + /ws → :8765)         │
└───────┬──────────────────────────────┬────────────────────────┘
        │ Tauri IPC (invoke + Channels)│ REST /api/* + WS /ws
        ▼                              ▼
┌──────────────────────┐   ┌────────────────────────────────────┐
│  RUST NATIVE ENGINE  │   │  PYTHON SIDECAR (FastAPI :8765)    │
│  (src-tauri/)        │   │  • Tasks / queue / history         │
│  • portable-pty      │   │  • Token usage (opencode.db)       │
│  • real login shell  │   │  • File browser + editor API       │
│  • binary channels   │   │  • LLM next-task suggestions       │
│  • render scheduler  │   │  • WebSocket state broadcast       │
│  • workspace index   │   │  • Agent socket (/ws/terminal/{tty})│
└──────────────────────┘   └────────────────────────────────────┘
        │  linked by slave tty (ttys004)
        ▼
┌──────────────────────────────────────────────────────────────┐
│  TERMINAL AGENTS (optional) — agent/agent.py in a shell      │
│  Connects via WebSocket · runs tasks · reports completions   │
└──────────────────────────────────────────────────────────────┘
```

**Key point:** there are two data planes.

- **Rust plane (terminals):** Rust spawns your real shell on a PTY. Output
  streams to the frontend as **binary data over Tauri Channels** (never through
  React state — a serialized `WriteQueue` feeds xterm.js). Input / resize /
  title go via cheap `invoke()` commands. A scheduler gives the focused pane
  the biggest render budget (focused → 64 chunks/tick, visible → 16, background
  → 8 throttled).
- **Python plane (intelligence):** the FastAPI sidecar handles tasks, token
  usage, the file browser, and LLM suggestions. The frontend reaches it over
  REST/WebSocket — **absolute URL `http://127.0.0.1:8765`** in the packaged app
  (the embedded webview cannot use relative URLs), proxied through Vite in dev.

The sidecar is **auto-spawned by Rust** on app launch if port 8765 is free and
auto-stopped on exit (only if Rust spawned it — an externally started
`./start_server.sh` server is left alone).

---

## 3. Installation & Quick Start

### 3.1 Prerequisites

- macOS (or Linux/Windows via `portable-pty`)
- Rust toolchain (for the desktop app) — `rustup`
- Node.js ≥ 20 + npm (frontend)
- Python 3.12+ + venv (sidecar)

### 3.2 Backend / Sidecar

```bash
# Create the venv once
cd ~/tto-web
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn websockets

# Start the backend manually (the desktop app also auto-spawns it)
cd ~/tto-web/backend
~/tto-web/venv/bin/python main.py
# Server runs at http://127.0.0.1:8765  →  health check: /api/health
```

### 3.3 Frontend (Vite dev)

```bash
cd ~/tto-web/frontend
npm install
npm run dev          # http://localhost:1420 — proxies /api + /ws to :8765
```

### 3.4 Build the Desktop App (Tauri)

```bash
cd ~/tto-web/frontend
npm run build        # typecheck (tsc) + bundle to dist/
npm run tauri dev    # or: npm run tauri build  →  .app/.dmg in src-tauri/target/
```

### 3.5 Open the Dashboard

- **Desktop app:** launch the built `.app` — full workspace experience.
- **Browser:** open `http://localhost:1420` (dev) — the same UI in a tab.

---

## 4. How It Works (Detailed)

### 4.1 Terminal Engine (Rust, native)

- Every pane = one **native PTY session** (`terminal-N`), spawned by
  `src-tauri/src/terminal/pty.rs` using `portable-pty` with your real login
  shell (`$SHELL`, `-l` so profile/PATH match a real terminal).
- Output is read by a dedicated thread, split into safe chunks (16 KB, never
  splitting UTF-8 or ANSI/OSC sequences), and queued (128 chunks ≈ 2 MB bound).
- A **render scheduler** flushes chunks to the attached frontend channel by
  priority (focused / visible / background) — only rendering is throttled; the
  PTY always runs.
- **Attach/detach recovery:** while a pane is hidden or swapped, output stays
  queued; reattaching resumes exactly where it left off. The PTY is never
  restarted on reload — only explicit Restart/Kill from the pane menu.

### 4.2 Workspaces & Sessions

- The frontend owns workspace **metadata** (name, color, template 1–16 panes,
  theme, `autoExpandTui`, `maxColumns`) persisted in `localStorage`.
- Rust owns the **session index** (`workspace_index_set/get`) so sessions can be
  restored into their workspace after an app restart (stale session ids are
  re-created in the workspace's project directory on launch).
- **TUI auto-expand:** when a pane enters full-screen CLI mode (alternate
  screen), it expands to the full workspace so the CLI gets a proper 80×24+
  canvas; the grid restores automatically when the CLI exits (per-workspace
  toggle, and manual green-light expansions are never overridden).

### 4.3 Task Flow

1. Dashboard UI → `POST /api/terminals/{tty}/tasks` (Python sidecar)
2. Sidecar stores current/next/queue and broadcasts state. A task sent from
   the Task Center **carries the model you just picked** (pinned optimistically
   so there is no race with the async save).
3. If the task carries a model different from the one running in the
   terminal's CLI, the watcher **closes the CLI (`/exit`) and relaunches it on
   the selected model**, waits for boot, then types the prompt. Same-model
   follow-up tasks deliver straight in without a restart.
4. If the agent (`agent/agent.py`) is connected on that tty it receives
   `run_task` over WebSocket and executes the description as a shell command
   (300 s timeout); otherwise the prompt is delivered into the terminal's CLI
   (Terminal.app / tmux via the sidecar, Rust PTY sessions via the frontend
   watcher).
5. **Auto-completion:** every 3 s the sidecar reads opencode's session DB and
   marks a running task `done` when its turn ends with a `step-finish` part
   whose reason is `stop` — so tasks stop showing "running" the moment the
   agent returns to the prompt. The next queued task is then promoted and
   delivered.
6. State is broadcast to ALL dashboards over `/ws`

### 4.6 Orchestrator (Kanban view)

- A **ChatGPT-style chat**: centered "Where should we begin?" empty state,
  your goal as a right-aligned bubble, the live orchestration as the reply
  (one card per sub-terminal with `○ queued → ● running → ✓ done`), and a
  composer at the bottom (Enter to send).
- Pick the **workspace** in the header dropdown — the orchestrator splits
  across the terminals open in THAT workspace, and each workspace sees ONLY
  its own conversations (runs are tagged with `workspace_id` and filtered
  server-side; switching workspace re-fetches instantly).
- The split is done by an LLM (`opencode run` with your model); if the LLM is
  unreachable a deterministic splitter (bullets → sentences → chunks,
  round-robin) guarantees it still works.
- Each sub-task goes through the **same pipeline as the Task Center**
  (`_place_task`), so model restarts, delivery, and auto-completion behave
  identically.
- Conversation order is ChatGPT-style: the newest message and its live output
  appear at the **bottom** (the backend returns newest-first; the UI renders
  oldest-first and auto-scrolls to the latest turn).

### 4.4 Token Usage

- Aggregated from `~/.local/share/opencode/opencode.db` (top-level sessions
  only, strict sums of input+output+reasoning), cached 60 s.
- Configured budgets: OmniRoute Local AI (1.5B), FreeLLMPool (1B),
  LLMBuffet (800M) — always visible even at 0 usage.
- 1-lakh rule: models under 100k tokens are hidden.
- Limits are editable in the UI (PATCH `/api/token-usage/limits`) and persisted
  in `~/.tto-web/state.json`.

### 4.5 State Persistence

- Sidecar state: `~/.tto-web/state.json` (terminals, tasks, history, context,
  tmux metadata, token limits). Survives restarts.
- Workspace UI state: `localStorage` (`tto-workspaces`, `tto-active-workspace`,
  `tto-theme`).

---

## 5. Dashboard Features

### 5.0 Views

- **Workspace** — default. Two-panel layout: left side shows a full-height
  terminal with header (status dot, agent badge, model, CWD, context menu),
  and right side shows a control panel with terminal list, model picker,
  task queue, and inline code editor. `SplitView` makes the divider
  draggable. Every xterm instance is persistent across view switches
  (parked offscreen, never unmounted).
- **Grid** — multi-pane card grid (templates 1/2/4/6/8/10/12/14/16),
  each pane a live terminal with traffic-light controls, expand/restore,
  proportional drag-to-resize, and TUI auto-expand (fullscreen CLI mode).
- **IDE** — VS Code-like layout: activity bar (Explorer / Search / Git /
  Settings), resizable sidebar with file tree, tabbed editor (CodeMirror 6),
  breadcrumbs, welcome page with Task Orchestrator logo, "Send to Terminal" panel, and
  status bar (file info, dirty indicator, encoding).
- **Kanban (Orchestrator)** — a ChatGPT-style orchestrator: type one goal,
  pick a workspace, and it splits the goal into sub-tasks across the
  workspace's terminals with live progress. The 🆘 **Emergency To-do → Fitted
  Prompt** tool sits below it (compiles a long to-do list into a prompt sized
  to the selected model's context window).
- **Cards (Task Center)** — one card per terminal with full task/context/
  history/tokens. **Floating colorful wire connections**: click endpoint dots
  on terminals to draw animated wires that route tasks between linked
  terminals automatically. Each wire gets a unique vibrant color (blue,
  purple, green, orange, pink, cyan, yellow, red). Wires are persisted per
  workspace in localStorage.
- **Table** — compact terminal list (terminal, agent, path, current task, tokens).
- **Memory** — workspace session memory, persisting context across tasks.
- **CEO Scheduler** — day-by-day task plan with calendar view, dispatch
  today button, plan progress bar, and Telegram notifications on dispatch.
- **Wizard** — workspace creation wizard with project path, terminal count,
  and CLI auto-launch.

### 5.1 Live Updates

- Sidecar pushes state over **WebSocket `/ws`** (plus 3 s REST fallback).
- Rust emits `terminal-updated` on every session change → workspace
  open/close reflects instantly in kanban/cards/table.
- Live clock in the header proves it's live; connection status dot
  (green = connected, red = retrying).

### 5.2 Per-Terminal Card

| Element | Description |
|---|---|
| TTY / session | `terminal-N · ttys004` (Rust session + slave tty) |
| Agent badge | opencode / claude / codex / gemini (auto-detected) |
| CWD | Working directory |
| Tokens | Input / output, with model name (cleaned) |
| Current Task | Running task + status badge + context + live output + summary |
| Next Task / Queue | Follow-ups |
| History | Last 10 completed tasks with summaries |
| Suggested Next Task | AI-generated via OmniRoute (`auto/coding:cheap`) — Accept / Regenerate / Dismiss, or ⚡ anytime |
| Session Context | Persists across tasks; ⚡ generates a one-line session summary |

### 5.3 Themes

Void · Neon Tokyo · Synthwave · Dracula · Carbon · Obsidian · Paper — applied
via CSS variables, saved to localStorage.

---

## 5.4 Task Center (Cards view)

- Workspace dropdown + per-terminal model picker; tasks sent from here carry
  the **selected model** (pinned optimistically — the CLI restarts on that
  model before the task runs, see §4.3).
- Supports `@terminal` mentions to target specific terminals, bulk sends, and
  "Apply now" (restarts the CLI on the chosen model immediately, with
  recovery if the model fails to launch).
- **Floating Wire Connections**: click the endpoint dot on any terminal in the
  sidebar to start a wire, click another terminal to connect them. Wires are
  colorful (each connection gets a unique vibrant color), animated with
  flowing particles, and persist per workspace. Tasks sent to a wired
  terminal are automatically routed to all connected terminals.
- **@mention routing**: type `@terminal-name` in the task input to target
  specific terminals. Mentioned terminals get live wire previews while typing.

## 5.5 IDE View (VS Code Layout)

A full IDE experience within Task Orchestrator:

- **Activity Bar**: Explorer (file tree), Search (full-text), Git (source
  control), Settings (editor preferences).
- **Explorer Sidebar**: collapsible file tree from the workspace's project
  path, with expand/collapse, loading indicators, and file type icons.
- **Tabbed Editor**: CodeMirror 6 with syntax highlighting, line numbers,
  word wrap, minimap toggle, tab size, and font size settings.
- **Welcome Page**: Task Orchestrator logo with floating animation, keyboard shortcuts.
- **Send to Terminal**: select a terminal and file from the sidebar, click
  Send to paste file content into the terminal's PTY.
- **Breadcrumbs**: file path segments above the editor.
- **Status Bar**: current file, line/column, encoding, dirty indicator.
- **Resizable Sidebar**: drag the divider to resize.
- **Keyboard Shortcuts**: `⌘⇧F` Search, `⌘⇧G` Git, `⌘⇧,` Settings.

## 5.6 UI Inspector (⌘+Shift+A)

Annotate any UI element on screen:

- Toggle with `⌘+Shift+A` — highlights elements under the cursor.
- Click to select and add annotations (text notes, bug reports, design
  feedback).
- Annotations are managed through the InspectorPanel floating panel.
- Counter badge in the header shows total annotations.

## 5.7 Command Palette (⌘+P)

Quick access to files and actions:

- Press `⌘+P` to open the palette.
- Type to search files (indexed from the workspace project path).
- Quick actions: New Terminal, New Workspace.
- Keyboard navigation: ↑↓ to move, Enter to select, Esc to close.

## 5.8 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘+T` | New workspace (wizard) |
| `⌘+P` | Command palette |
| `⌘⇧F` | Search files |
| `⌘⇧G` | Source control |
| `⌘⇧,` | Settings |
| `⌘⇧A` | UI Inspector |
| `⌘+1–9` | Switch to workspace 1–9 |
| `⌃+⇧+F` | Toggle Grid Focus Mode |
| `Esc` (in grid focus) | Exit Grid Focus Mode |

## 5.9 File Drag & Drop

Drag files from your OS file manager directly onto a terminal pane. The file
path is automatically escaped and injected into the PTY.


---

---

## 5.10 Remote Control (WhatsApp via OpenWA) — optional

A thin, optional subsystem (`backend/remote/`) lets you control Task Orchestrator from your
phone through WhatsApp. It talks to the EXTERNAL OpenWA service (port 2785)
via REST + webhook — never bundled, never forked. When disabled or offline,
Task Orchestrator is completely unaffected.

- **Commands:** `/status /terminals /terminal <id> /logs <id> /run <id> <cmd>
  /input <id> <text> /queue <id> <task> /next <id> /pause <id> /resume <id>
  /restart <id> /stop <id> /kill <id> /files [path] /tokens /agents
  /workspace /health /help`
- **Security:** webhook secret + sender allowlist (fail closed), rate limiting,
  permission classes, shell command classification (safe / dangerous / blocked),
  sender-bound expiring confirmation tokens for destructive actions, sandboxed
  file access, audit log without secrets.
- **Notifications:** proactive task-complete/failed/waiting/crash messages with
  dedup + cooldown.
- **Config:** `.env` (see `.env.example` + `docs/remote-control.md`).
- **UI:** 🛰️ button in the header → Remote Control panel (status, QR, test).
- **Tests:** `cd backend && ~/tto-web/venv/bin/python -m unittest tests.test_remote -v`


## 5.11 Grid Focus Mode

A distraction-free view that hides the sidebar and lets the terminal grid fill the workspace.

- **Toggle:** Click the magnifying glass icon (🔍⤢) in the workspace bar, or press `Ctrl+Shift+F` / `⌃+⇧+F`
- **Exit:** Press `Esc` or click the toggle again
- **Behavior:** When active, the sidebar is hidden and the grid uses native overflow with scrollbars instead of scaling down
- **Per-workspace:** Grid Focus Mode state is stored per workspace in localStorage

## 5.12 CLI Logo Brand Icons

Each grid pane header now shows the brand logo of the running CLI tool instead of the old macOS traffic-light dots.

**Supported brands** (with bundled SVG/PNG assets):
- **opencode**, **codex**, **claude** (Claude), **gemini** (Google Gemini)
- **vim**, **nvim/neovim**, **htop**, **tmux**
- **python**, **node**, **npm**, **git**, **docker**
- **zsh**, **bash**

**Fallback badge:** For tools without a bundled logo (e.g., cargo, go, rust, kubectl), a colored letter badge is shown.

Detection logic prioritizes: real foreground CLI (vim, htop, git, tmux) > agent brand (opencode, claude, codex, gemini) > idle shell/runtime.

Assets live in `frontend/src/assets/cli-logos/`. The component is at `frontend/src/lib/cliLogos.tsx`.

## 5.13 Live Sound Wave Equalizer

When using voice input (speech-to-text), a real-time audio equalizer visualization appears beside the mic button.

- **How it works:** Uses the Web Audio API AnalyserNode to read microphone frequencies
- **Visual:** Mirrored, frequency-driven bars with exponential smoothing for buttery motion
- **Rendering:** Direct DOM writes in a requestAnimationFrame loop (zero React re-renders)
- **Fallback:** If Web Audio is unavailable, a CSS-only bouncing animation is used
- **Styling:** Glassy pill with pink/red gradient bars matching the listening state


---

## 6. Commands Reference (API)

```bash
# Health
curl http://127.0.0.1:8765/api/health

# All terminals (includes tokens, tasks, tmux info)
curl http://127.0.0.1:8765/api/terminals

# Assign a task to a terminal
curl -X POST http://127.0.0.1:8765/api/terminals/ttys004/tasks \
  -H "Content-Type: application/json" \
  -d '{"description":"your task here","status":"pending"}'

# Complete a task with a summary
curl -X POST "http://127.0.0.1:8765/api/terminals/ttys004/tasks/<task_id>/complete?summary=Done"

# Session context (persists across tasks)
curl -X PATCH "http://127.0.0.1:8765/api/terminals/ttys004/session-context?context=..."

# Token usage + editable limits
curl http://127.0.0.1:8765/api/token-usage
curl -X PATCH http://127.0.0.1:8765/api/token-usage/limits \
  -H "Content-Type: application/json" -d '{"key":"omniroute","limit":1500000000}'

# AI next-task suggestion
curl -X POST http://127.0.0.1:8765/api/terminals/ttys004/suggest-task
curl -X POST http://127.0.0.1:8765/api/terminals/ttys004/suggest-task/accept

# Orchestrator — split ONE goal across a workspace's terminals
curl -X POST http://127.0.0.1:8765/api/orchestrator/run \
  -H "Content-Type: application/json" \
  -d '{"task":"Build the todo app: backend, frontend, tests",
       "workspace_id":"ws_abc", "workspace_name":"Alpha",
       "terminals":[{"tty":"ttys004","label":"terminal-1","model":"opencode/deepseek-v4-flash-free"}]}'

# Orchestrator runs — each workspace sees ONLY its own
curl "http://127.0.0.1:8765/api/orchestrator/runs?workspace_id=ws_abc"
# Clear a workspace's finished runs only
curl -X DELETE "http://127.0.0.1:8765/api/orchestrator/runs?workspace_id=ws_abc"

# Available models + per-model context/output limits
curl http://127.0.0.1:8765/api/models
curl http://127.0.0.1:8765/api/models/limits

# Emergency To-do → fitted prompt (sized to the model's context window)
curl -X POST http://127.0.0.1:8765/api/todo/compile \
  -H "Content-Type: application/json" \
  -d '{"todo_text":"- fix login\n- add export","model":"opencode/deepseek-v4-flash-free","context":{"cwd":"/Users/me/project"}}'

# Files (home-scoped, traversal-protected)
curl "http://127.0.0.1:8765/api/files?path=frontend/src"
curl "http://127.0.0.1:8765/api/file?path=INSTRUCTION_GUIDE.md"
curl -X PUT http://127.0.0.1:8765/api/file -H "Content-Type: application/json" \
  -d '{"path":"notes.txt","content":"hello"}'
```

**Tauri IPC (desktop app only):** `terminal_create`, `terminal_attach`,
`terminal_detach`, `terminal_write`, `terminal_send_command`, `terminal_resize`,
`terminal_close`, `terminal_restart`, `terminal_list`, `terminal_set_title`,
`terminal_set_tui`, `terminal_set_focus`, `terminal_set_visible`,
`terminal_diagnostics`, `workspace_index_set`, `workspace_index_get`,
`sidecar_status`.

---

## 7. Daily Workflow

### Morning

```bash
# One command: restarts the sidecar if the backend changed, rebuilds the app
# if sources changed, syncs the .app, kills any stale instance, then opens it
tto

# Manual alternative:
# 1. Start the backend (or let the desktop app auto-spawn it)
cd ~/tto-web/backend && ~/tto-web/venv/bin/python main.py &
# 2. Open the app
open ~/tto-web/frontend/src-tauri/target/release/bundle/macos/Task Orchestrator.app   # built app
# 3. (optional) in each shell you'll use directly:
cd ~/tto-web && source venv/bin/activate && python3 agent/agent.py
```

### During Work

- Open new terminals in the workspace; type `opencode`, `claude`, `codex`,
  `gemini` in a pane to launch a CLI there.
- **Orchestrator (Kanban view):** pick the workspace, type ONE goal, press
  Enter — it splits across that workspace's terminals and updates live. No
  need to write a task per terminal.
- Assign tasks from the Task Center (Cards view) — pick a model per terminal
  and the CLI restarts on it before the task runs.
- Tasks **auto-complete** when the agent finishes; completed tasks stay in
  history. Use 🆘 Emergency To-do to fit a long to-do list into a
  small-context model.
- Watch token usage; set limits for your free providers.

### End of Day

- All completed tasks with summaries remain in history.
- State auto-saved; next day the same terminals, same history (desktop app
  restores workspace sessions on launch).

---

## 8. Supported Agents (Auto-Detected)

| Agent | Detection | Notes |
|---|---|---|
| opencode | "opencode" in command | Primary |
| claude | "claude" in command | Claude Code CLI |
| codex | "codex" in command | OpenAI Codex |
| gemini | "gemini" / "gemini-cli" | Google Gemini CLI |
| aider | "aider" in command | Aider |
| cursor-agent | "cursor-agent" in command | Cursor CLI |
| tto-agent | "agent.py" in command | Built-in agent |
| unknown | shell only | Shows as shell |

Detection lives in both Rust (`manager.rs`) and Python (`detect_agent` + `detect_cli` in
`backend/main.py`).

In addition to AI agents, the backend and Rust engine detect **any foreground CLI** running in a terminal (vim, nvim, htop, tmux, python, node, git, docker, cargo, go, etc.) and display its brand logo in the pane header via the `cli` field.

---

## 9. Files & Locations

```
~/tto-web/
├── backend/
│   ├── main.py              # FastAPI sidecar (:8765): tasks, tokens, files, LLM
│   └── frontend/ → ../frontend   # symlink to the frontend
├── frontend/
│   ├── index.html / package.json / tsconfig.json / vite.config.ts
│   ├── src/                 # React app (App.tsx, workspace.ts, api/, components/,
│   │                        #   terminal/ — xterm renderers + IPC layer, hooks/)
│   ├── src/assets/cli-logos/  # Brand logos for CLI panes (SVGs + Claude PNG)
│   ├── src/lib/cliLogos.tsx    # CliLogo component + logo registry
│   ├── src-tauri/           # Rust engine (src/terminal/*, src/ipc/, sidecar.rs)
│   └── dist/                # production build
├── agent/
│   └── agent.py             # optional per-terminal task agent
├── venv/                    # Python virtual environment
├── start_server.sh          # starts the sidecar with the venv python
├── INSTRUCTION_GUIDE.md     # this guide
└── api_usage.py             # token-usage CLI helper
~/.tto-web/state.json        # sidecar state (terminals, tasks, token limits)
~/.local/share/opencode/opencode.db  # opencode token usage source
~/.local/share/tto/          # rust diag log + sidecar log
```

---

## 10. Troubleshooting

| Issue | Fix |
|---|---|
| Blank page in webview | Check `~/.local/share/tto/rust-diag.log` + `sidecar.log`; frontend posts console errors to `/api/diag-log` |
| Backend not responding | Start it manually: `cd ~/tto-web/backend && ~/tto-web/venv/bin/python main.py`; verify `/api/health` |
| Port 8765 busy | Change port in `backend/main.py` + `frontend/src/api/base.ts` + `src-tauri/src/ipc/mod.rs` |
| Terminal shows nothing after reload | Expected: output is re-buffered and resumes on reattach; PTY is never restarted. Use Restart from the pane menu if needed |
| Orphaned shell/TUI at 100% CPU | Rust kills all PTY children on app exit (`kill_all`) to prevent orphaned TUIs |
| State corrupted | Delete `~/.tto-web/state.json` and restart |
| Agent not executing tasks | Ensure `agent/agent.py` is running in that shell and shows "connected to server" |

---

## 11. Extending (For Developers)

### Add a new agent type

- Rust: `detect_agent()` in `frontend/src-tauri/src/terminal/manager.rs`
- Python: `detect_agent()` in `backend/main.py`

### Add task fields

- `class Task(BaseModel)` in `backend/main.py`, then mirror the type in
  `frontend/src/types.ts`.

### Add a view/component

- Create `frontend/src/components/MyComponent.tsx`, wire it into
  `App.tsx` and the `WorkspaceBar` view switcher.

### Add an IPC command

- Rust: implement in `src-tauri/src/ipc/mod.rs` + register in
  `tauri::generate_handler!` (lib.rs); mirror in
  `frontend/src/terminal/channels.ts`.

### Change the frontend

```bash
cd ~/tto-web/frontend
# edit files under src/ ...
npm run build        # typecheck + bundle
npm run tauri build  # rebuild the desktop app with the new UI
```

---

## 12. Version History

| Version | Date | Changes |
|---|---|---|
| 0.1.0 | 2026-08-06 | Legacy CLI: dashboard, register, done, orphans |
| 0.2.0 | 2026-08-06 | Web dashboard, FastAPI backend, terminal agents, live updates, context, summaries |
| 0.3.0 | 2026-08-06 | TMUX session/window/pane detection, auto-refresh, black/green/sky theme |
| 0.4.0 | 2026-08-07 | React + TypeScript + Vite frontend, PWA, Cards + Terminal List views, dark responsive theme |
| 0.5.0 | 2026-08-07 | "New Terminal" card, tto-agent auto-detection, fresh tasks auto-run (run_task fix) |
| 0.6.0 | 2026-08-07 | Live Output (1s) via tmux capture-pane, CLI launch via tmux send-keys |
| 0.7.0 | 2026-08-07 | Token Usage dashboard (per-model, 1-lakh rule, editable limits) + AI Next-Task Suggestions |
| 0.8.0 | 2026-08-07 | BridgeSpace workspace overhaul: templates 1–16, 7 themes, file browser, CodeMirror editor, Kanban, embedded tmux terminals |
| 1.0.0 | 2026-08-12 | **Tauri 2 native desktop migration** — Rust PTY engine (portable-pty), binary output channels, priority render scheduler, workspace session index + restore, sidecar auto-spawn/stop |
| 2.0.0 | 2026-08-13 | Tauri 2 Desktop (React 19 + Vite 6 + xterm.js + CodeMirror 6). Native terminals replace the Python/tmux engine; Python sidecar stays for tasks/tokens/files/LLM. Unified terminal map links workspace panes ↔ cards/kanban/table |
| 2.1.0 | 2026-08-16 | Kanban becomes the **Orchestrator**: ChatGPT-style chat that splits one goal into per-terminal sub-tasks with live progress, per-workspace isolation (`workspace_id`-filtered runs), task **auto-completion** via opencode's `step-finish/stop` DB marker, Task Center model pinning with CLI restart, CLI recovery on broken models, workspace-scoped clear, `tto` one-word launcher, mobile-responsive chat UI |
| 2.2.0 | 2026-08-16 | **Remote Control (WhatsApp via OpenWA)**: optional `backend/remote/` subsystem (parser, auth/allowlist, rate limit, safety classification, expiring confirmations, formatter, service bridge, OpenWA client, webhook, notifications), `/api/remote/*` routes, Rust relay `raw_input`/`restart`/`close` by tty, Remote Control panel in the header, `scripts/start-openwa.sh` etc., `.env` support, stdlib test suite, `docs/remote-control.md` |
| 2.4.0 | 2026-09-13 | **Grid Focus Mode** (hide sidebar, zoom grid; toggle via button or Ctrl+Shift+F, exit with Esc), **CLI Logo Brand Icons** (replace traffic lights with branded SVG/png for opencode/claude/codex/gemini/vim/nvim/htop/tmux/python/node/npm/git/docker/zsh/bash + letter badges for others), **Live Sound Wave Equalizer** (Web Audio API analyser with rAF loop, mirrored frequency-driven bars, CSS fallback), **Async WebSocket connection** (wsBaseAsync resolves live port before connecting), **Foreground CLI detection** (backend + Rust detect any running CLI — vim, htop, git, tmux, node, etc. — not just AI agents), **Gateway URL validation** (reject empty/scheme-only URLs in Rust) |
| 2.3.0 | 2026-08-29 | **IDE View** (VS Code layout: activity bar, file explorer sidebar, tabbed CodeMirror editor, breadcrumbs, welcome page with Task Orchestrator logo, Send-to-Terminal panel, resizable sidebar, status bar), **Workspace two-panel layout** (SplitView: terminal + control panel), **UI Inspector** (`⌘+Shift+A`), **Command Palette** (`⌘+P`), **File Drag & Drop** onto terminals, **Floating colorful wire connections** in Task Center (8-color palette, animated flowing particles, click-to-connect endpoints), **Attractive sidebar redesign** (gradient background, glowing live dots, hover animations, active state with accent border), improved **CEO Scheduler dispatch** with Tauri PTY support, keyboard shortcuts table, `ide-send-file` Tauri fallback for native sessions |

---

## 13. License

MIT — use freely, modify freely, sell if you want.

---

\*End of Guide — v2.4.0 Tauri 2 Native Desktop Architecture\*
*Built for Kenneth Aman's 30+ terminal workflow. Solves: "I don't know which
terminal has which task, I can't see tmux session names, I need to send tasks
from a web UI without page reloads."*
