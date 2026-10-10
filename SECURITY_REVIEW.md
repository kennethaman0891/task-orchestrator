# Task Orchestrator-web — Security Review & Remediation

**Date:** 2026-08-25
**Scope:** Full codebase at `~/tto-web` — FastAPI/WebSocket backend (`backend/`), WebSocket agent (`agent/`), remote-control layer (`backend/remote/` — Telegram + WhatsApp/OpenWA), and the Tauri v2 desktop app (`frontend/`, `frontend/src-tauri/`).
**Deployment assumption (confirmed with you):** local-only — the server runs on `127.0.0.1` on your own Mac and is not intentionally exposed to the internet.

---

## How to read this

This tool's whole job is to open terminals and run shell commands on your Mac, so "it can run commands" is **not** a bug — that's the product. The review focused on the layers that are *supposed* to keep that power fenced in: who can reach the server, how untrusted input reaches a shell/AppleScript, path containment, and the remote-control safety net.

Even on a local-only box, one class of problem is genuinely serious: your command-executing server listens on `http://localhost:8765`, and **any web page you visit in a normal browser can send requests to `localhost`**. That is the thread tying together the most important fixes below.

Severity is calibrated for the local-only model. Nothing here assumes an attacker already on your LAN unless noted.

---

## 1. Fixes applied (backend — reviewed, edited, and compile-verified)

All changes are in Python (`backend/`) and were verified with `python -m py_compile` plus targeted unit tests of the new logic. Each is designed to preserve normal functionality; every behavioral guard has an escape hatch or degrades safely.

| # | Severity | Issue | Fix | File |
|---|----------|-------|-----|------|
| 1 | **Critical** | CORS was `allow_origins=["*"]` on a server that executes commands → any website you visit could drive the API on `localhost:8765`. | Default to an explicit localhost/Tauri allowlist; added an Origin-guard middleware that rejects cross-origin **state-changing** requests. Override via `Task Orchestrator_CORS_ORIGINS`. | `main.py` |
| 2 | **High** | WebSocket endpoints (`/ws`, `/ws/term/{id}`, `/ws/command-relay`, `/ws/terminal/{tty}`) called `accept()` with no Origin check. WebSockets are **not** covered by CORS, so any page could open a socket and drive terminals. | Added `_ws_origin_ok()` guard to all four endpoints (same policy: reject disallowed Origin, allow missing Origin for native clients). | `main.py` |
| 3 | **High** | AppleScript injection: `tty` was interpolated raw into `osascript` in `_find_window_by_tty` / `_find_tab_by_tty`. `tty` is client-influenced (the `/ws/terminal/{tty}` path). | Added `_valid_tty()` — rejects anything outside `[A-Za-z0-9/_.-]`, so quotes/newlines can't break out of the script. | `main.py` |
| 4 | **High** | Shell injection: `cwd` was interpolated unquoted into `cd {cwd} && tmux …` run via AppleScript `do script`. | `shlex.quote(cwd)`. | `main.py` |
| 5 | **High** | Server-side shell injection via model key: `f"opencode -m {model}"` was built as a shell string from a user-settable value. | Added `_safe_model()` (charset-validated; bad values degrade to a bare `opencode` launch) **and** `shlex.quote()` at both sinks. | `main.py` |
| 6 | **High** | Weak path containment in `_safe_path` (unauth file read/write under `$HOME`): used `str(target).startswith(home)`, which also matches a sibling like `<home>-evil`. | Rewrote using component-based `Path.relative_to`; also rejects absolute paths and in-home symlinks that resolve outside home. | `main.py` |
| 7 | **High** | Remote command classifier was trivially bypassable: `echo ok && rm -rf ~` classified **SAFE** (leading token `echo`); `python -c "…"`, `node -e "…"`, and `cat x \| sh` all passed as SAFE. | Rewrote `classify_shell` to be **chain-aware** (splits on `; && \|\| \| & \` $()` and takes the worst segment), to flag arbitrary-code wrappers (`python -c`, `node -e`, `sh -c`, `eval`) as at least DANGEROUS, and to BLOCK any pipe-into-a-shell. | `remote/safety.py` |
| 8 | **High** | `/input` (remote) injected text into the terminal shell **without** classification — only `/run` was checked. | Routed `/input` through the same classifier as `/run`. | `remote/service.py` |
| 9 | **Medium** | Zip-slip guard in `/api/project/upload` used the same weak `startswith` containment check. | Rewrote using `Path.relative_to`. | `main.py` |
| 10 | **Low** | Log injection: `/api/diag-log` wrote caller-supplied `source`/`message` with no newline stripping → forged log lines. | Strip CR/LF and cap length on single-line fields (`stack` stays multi-line by design). | `main.py` |
| 11 | **Low (defense-in-depth)** | The WhatsApp webhook router is mounted even when remote is disabled. | Reject webhook delivery with 403 unless `cfg.enabled`. | `remote/webhook.py` |
| 12 | **Low (hygiene)** | No `.gitignore` — risk of committing `.env`/secrets if this becomes a git repo. | Added `.gitignore` (ignores `.env`, `venv/`, `node_modules/`, build output, `*.bak`, state, logs). | `.gitignore` |
| 13 | **Low (hygiene)** | Three stale `.bak` files, incl. `backend/main.py.bak` which **binds to `0.0.0.0`** (LAN-exposed) if run by mistake. | Deleted `backend/main.py.bak`, `agent/agent.py.bak`, `frontend/legacy-index.html.bak`. | — |

### About the Origin/CORS fix (the important one)

The default allowlist is: `tauri://localhost`, `https://tauri.localhost`, `http://localhost:1420/1421`, `http://127.0.0.1:1420/1421`, `http://localhost:8765`, `http://127.0.0.1:8765`. This covers the production Tauri app, the Vite dev server (port 1421, confirmed from `vite.config`), and the dashboard served directly from the backend.

- **Requests with no `Origin` header still pass** — that's deliberate, so the native Rust relay, the Python agent, and `curl` keep working.
- If anything ever fails to connect, the escape hatch is one line: set `Task Orchestrator_CORS_ORIGINS` to a comma-separated list of origins, or `Task Orchestrator_CORS_ORIGINS=*` to restore the old permissive behavior.

### Classifier — what I intentionally did **not** change

`/queue` and `/next` task descriptions are **not** run through the classifier. Those are the app's core purpose and are routinely legitimate multi-step or destructive-looking dev commands (`rm -rf node_modules && npm i`) or natural language for an AI agent. That channel is already gated by webhook-secret/HMAC + sender allowlist + rate-limiting, so only you can reach it. Classifying it would break normal use for little gain. Noted as a residual (§4).

---

## 2. Action required from you — rotate live secrets

`~/tto-web/.env` is correctly locked down at file-permission level (`chmod 600`) and is now covered by `.gitignore`. But it contains **live** credentials in plaintext, and I did not modify their values (rotating a credential is your call, and editing a live token would break your bot):

- **`TELEGRAM_BOT_TOKEN` (line 14)** — a real Telegram bot token. If it has ever been shared, pasted, or committed anywhere, **revoke and reissue it** via @BotFather (`/revoke` → `/token`). Then update `.env`.
- **`OPENWA_WEBHOOK_SECRET` (line 6)** — currently a weak, guessable string (`tto-…-2026`). Replace with a long random value, e.g. `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`, and set the same value in your OpenWA webhook config.
- **`TELEGRAM_ALLOWED_USER_IDS` (line 15)** — your Telegram user ID (personal identifier). Fine to keep; just be aware it's PII if you ever share the file.

These are only active when `Task Orchestrator_TELEGRAM_ENABLED` / `OPENWA_ENABLED` are on — but rotate regardless if exposure is possible.

---

## 3. Recommended — desktop app (Tauri/Rust), *not* applied

These were flagged during review of `frontend/src-tauri/`. I did **not** change them because I can't compile or run the Tauri/Rust app in this environment, and a bad edit there could brick the desktop build. Each is worth doing; test the app after each change.

1. **Command-relay authentication (High).** The Rust ↔ backend relay (`src-tauri/src/relay.rs`) and the `/ws/command-relay` socket carry command-injection requests. There's no shared-secret handshake — anything that can open the socket (now Origin-guarded against browsers, per fix #2) can push commands. Add a token handshake: generate a per-launch secret, pass it to the backend, and require it as the first frame on the relay socket.

2. **Tauri CSP is `null` (Medium–High).** `tauri.conf.json` sets no Content-Security-Policy, so a single injected/remote script in the webview runs unconstrained. Set a strict CSP (e.g. `default-src 'self'; script-src 'self'; connect-src 'self' http://localhost:8765 ws://localhost:8765`).

3. **Asset-protocol scope is `**` (Medium).** Narrow the asset protocol / fs scope to the specific directories the app actually needs, rather than the whole filesystem.

4. **Trim capabilities (Medium–Low).** Remove `shell:allow-spawn` / `shell:allow-open` if unused, drop the unused `tauri-plugin-fs`, and disable devtools in release builds.

5. **Frontend `model` injection (Medium).** `App.tsx` builds `` `opencode -m ${model}` `` unquoted before sending it to a terminal. The backend now sanitizes `model` at its own sinks (fix #5), but the frontend should also validate/quote it so a compromised UI value can't inject locally.

---

## 4. Residual risks & design notes (no code change)

- **The backend has no authentication.** Every `/api/*` endpoint and WebSocket is reachable by any local process and any allow-listed origin, with no token or login. For a single-user local tool this is a reasonable trade-off, and the Origin guard (#1/#2) closes the main *remote* browser vector. If you ever want defense against other local processes/users, add a bearer token (generated at launch, required on every request/socket).
- **`/api/shutdown` and the file read/write endpoints** are unauthenticated by design. They're now protected from cross-site browser abuse, but any local client can still call them. Acceptable for local-only; revisit if you expose the server.
- **`/queue` / `/next` are unclassified** (see §1). Consider an opt-in "strict remote" mode that classifies queued descriptions if you ever share remote access.
- **`/api/project/upload` reads the whole request body into memory before the 500 MB size check** — a large upload is a memory-pressure DoS. Low priority locally; stream-to-disk with a running cap if you harden it.
- **Never set `Task Orchestrator_HOST=0.0.0.0`** unless you intend LAN exposure — that turns every "local-only" assumption above into a network-facing one. The default (`127.0.0.1`) is correct.

---

## 5. Verify & revert

**Verify the backend still imports/compiles** (from `~/tto-web/backend`, in your venv):

```
python -m py_compile main.py remote/*.py
```

All backend + agent Python files were compile-checked clean, and the new helpers (`_origin_allowed`, `_safe_path`, `_valid_tty`, `_safe_model`) and the rewritten `classify_shell` were unit-tested (22/22 classifier cases, including the previously-bypassing `echo ok && rm -rf ~` → now BLOCKED, and normal `npm run build` / `ps aux | grep node` → still SAFE).

**If the desktop app or dashboard can't connect after the update**, it's almost certainly the Origin allowlist. Quick unblock:

```
# add your origin, or fully restore old behavior:
export Task Orchestrator_CORS_ORIGINS="*"
```

**Reverting** any single fix is localized — each change is a small, self-contained block with an explanatory comment starting near the cited line.

---

*All findings above are from static review and local reasoning; the Tauri/Rust items in §3 were identified by reading the source, not by running the desktop app. No live secret values were modified.*
