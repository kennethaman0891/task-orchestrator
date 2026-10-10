# Task Orchestrator (Terminal Task Orchestrator) — System Architecture

Comprehensive architecture documentation for **Task Orchestrator (Terminal Task Orchestrator)**, generated and verified with [Archify](https://github.com/tt-a1i/archify).

---

## Interactive Architecture Diagram

- **Standalone Interactive HTML**: [`ARCHITECTURE.html`](file:///Users/kennethaman/tto-golden/ARCHITECTURE.html)
- **Archify Candidate Specification**: [`.archify/architecture-tto-system-20261003-171635/candidate.json`](file:///Users/kennethaman/tto-golden/.archify/architecture-tto-system-20261003-171635/candidate.json)
- **Archify Delivery Receipt**: [`.archify/architecture-tto-system-20261003-171635/tto-system.finalize.json`](file:///Users/kennethaman/tto-golden/.archify/architecture-tto-system-20261003-171635/tto-system.finalize.json)
- **Specification SHA256**: `771ce1556ec55f896bae8bc8841d5284bbbf68834793fefe56c8b001600a367a`
- **Artifact SHA256**: `0302dd7da6a3ff0cbff8ef1c0fe697b59661ee3f9b71b6d620d1faab72d602a8` (788 KB)

To open the interactive diagram locally:
```bash
open ARCHITECTURE.html
```

---

## High-Level Topology & Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. CLIENT & INTERACTIVE DESKTOP PATH                                                                        │
│   Developer ───> React 19 Shell ───> xterm.js DOM Pool ───> Tauri Desktop ───> PTY Engine ───> AI Agents    │
│   (Keyboard)     (Workspaces/IDE)   (Offscreen Anchors)    (Rust State)        (portable-pty)   (Subprocesses) │
└──────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                               │ Spawns & Supervises
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. SUPERVISORY & PYTHON SIDECAR LAYER (:8765)                                                               │
│   Sidecar Supervisor ───> FastAPI Monolith ◄─── File Watcher (mtime poller)                                 │
│   (TCC Permissions)       │  • State Broadcast (/ws)                                                        │
│                           │  • OpenCode HTTP/SSE Proxy (:4097)                                              │
│                           ▼                                                                                 │
│   Process Scanner (ps & tmux capture) ───> Injects State into Terminal Sessions                             │
└──────────────────────────────────────────────▲──────────────────────────────────────────────────────────────┘
                                               │ Dispatches Verified Commands
┌──────────────────────────────────────────────┴──────────────────────────────────────────────────────────────┐
│ 3. REMOTE INGRESS & SPEECH PIPELINE                                                                         │
│   Remote User ───> Chat Gateways ───> Local Whisper ───> Safety Hub ───> Command Relay ───> PTY Engine      │
│   (WhatsApp/Voice) (OpenWA / Discord) (faster-whisper)   (HMAC & 2FA)   (Tokio WS Bridge)  (Terminal Input) │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Architectural Subsystems

### 1. Interactive Workstation & Desktop Runtime (Tauri v2 + React 19)

| Component | Layer | Description | Verified Source Link |
|---|---|---|---|
| **Developer** | External | Physical keyboard, mouse, and display inputs | — |
| **React 19 Shell** | Frontend | Application shell managing multi-view modes (`workspace`, `grid`, `ide`, `jarvis`, `kanban`, `planner`) | [`frontend/src/components/App.tsx:41-100`](file:///Users/kennethaman/tto-golden/frontend/src/components/App.tsx#L41-L100) |
| **xterm.js Pool** | Frontend | Recycled in-DOM terminal pool (`@xterm/xterm`) parked offscreen to preserve scrollback without re-rendering | [`frontend/src/terminal/TerminalManager.ts:30-75`](file:///Users/kennethaman/tto-golden/frontend/src/terminal/TerminalManager.ts#L30-L75) |
| **Tauri v2 Desktop** | Security / Host | Native Rust host application managing window lifecycle, IPC channel dispatch, and system permissions | [`frontend/src-tauri/src/lib.rs:60-130`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/src/lib.rs#L60-L130) |
| **Native PTY Engine** | Backend | Cross-platform pseudo-terminal abstraction (`portable-pty`), session scheduling, and master/slave descriptors | [`frontend/src-tauri/src/terminal/manager.rs:20-80`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/src/terminal/manager.rs#L20-L80) |
| **Agent Subprocesses** | Execution | Autonomous CLI coding agents (OpenCode, Claude Code, Codex, Aider) executing inside dedicated PTY/tmux sessions | — |
| **Task Orchestrator Gateway** | Cloud | Node.js outbound WebSocket relay for zero-port-forwarding remote pairing with mobile/web clients | — |

---

### 2. Python FastAPI Sidecar (`127.0.0.1:8765`)

| Component | Layer | Description | Verified Source Link |
|---|---|---|---|
| **Sidecar Supervisor** | Security | Rust watchdog that verifies sidecar liveness, recovers from port collisions, and attributes macOS TCC folder permissions | [`frontend/src-tauri/src/sidecar.rs:295-355`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/src/sidecar.rs#L295-L355) |
| **FastAPI Monolith** | Backend | Core backend server managing terminal state persistence, task queues, git/search APIs, and WebSocket broadcast (`/ws`) | [`backend/main.py:151-210`](file:///Users/kennethaman/tto-golden/backend/main.py#L151-L210) |
| **Process Scanner** | Backend | 1-second asynchronous loop scanning active processes via `ps` and capturing live terminal text via `tmux capture-pane` | [`backend/main.py:1566-1640`](file:///Users/kennethaman/tto-golden/backend/main.py#L1566-L1640) |
| **Async File Watcher** | Backend | Non-blocking directory poller diffing filesystem modification times (`mtime`) and broadcasting file events | [`backend/file_watcher.py:43-95`](file:///Users/kennethaman/tto-golden/backend/file_watcher.py#L43-L95) |
| **OpenCode Server** | Backend | Headless OpenCode agent server on port `:4097` providing REST session control and Server-Sent Events (SSE) | — |

---

### 3. Remote Ingress, Safety & Speech Engine

| Component | Layer | Description | Verified Source Link |
|---|---|---|---|
| **Remote Users** | External | External users sending text commands or voice messages over WhatsApp and Discord | — |
| **Chat Gateways** | Cloud | Bridges to external chat APIs: OpenWA daemon (`:2785`) for WhatsApp and Discord gateway API bot client | [`backend/remote/discord_bot.py:45-120`](file:///Users/kennethaman/tto-golden/backend/remote/discord_bot.py#L45-L120) |
| **Local Whisper AI** | Backend | 100% offline speech-to-text inference engine running `faster-whisper` (int8 on CPU) for voice notes without cloud APIs | [`backend/remote/whisper_local.py:1-50`](file:///Users/kennethaman/tto-golden/backend/remote/whisper_local.py#L1-L50) |
| **Remote Safety Hub** | Security | Ingress protection with HMAC secret verification, command classification (`SAFE`, `DANGEROUS`, `BLOCKED`), and 2FA tokens | [`backend/remote/webhook.py:32-180`](file:///Users/kennethaman/tto-golden/backend/remote/webhook.py#L32-L180), [`backend/remote/safety.py:24-135`](file:///Users/kennethaman/tto-golden/backend/remote/safety.py#L24-L135) |
| **Command Relay** | Messagebus | Tokio asynchronous WebSocket bridge connecting to `/ws/command-relay` to inject verified remote commands into native PTY | [`frontend/src-tauri/src/relay.rs:35-85`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/src/relay.rs#L35-L85) |

---

## Key Protocols & Inter-Process Communication

1. **Frontend ↔ Rust Host (Tauri IPC)**:
   - High-throughput byte streaming via `tauri::ipc::Channel` for low-latency terminal rendering.
   - Tauri commands (`terminal_create`, `terminal_write`, `terminal_resize`, `terminal_close`).
2. **Frontend ↔ Python Sidecar (WebSockets & REST)**:
   - Real-time reactive state push via `ws://127.0.0.1:8765/ws` (terminal list, active tasks, token usage, file changes).
   - REST RPC for file tree retrieval, file editing, git operations, and task completions.
3. **Python Sidecar ↔ Rust Desktop (Command Relay)**:
   - Rust connects to `ws://127.0.0.1:8765/ws/command-relay`.
   - When commands arrive from WhatsApp or Discord, the sidecar pushes an `inject_command` envelope; the Tokio relay task writes directly into the PTY master descriptor.
4. **Desktop Host ↔ External Gateway (Outbound WSS)**:
   - Outbound-only TLS WebSocket connection authenticated via Ed25519 cryptographic keypairs, avoiding public inbound port exposure.
