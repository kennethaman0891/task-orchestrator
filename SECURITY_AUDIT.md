# Security Audit & Vulnerability Assessment Report

**Project:** Terminal Task Orchestrator (tto)  
**Date:** October 1, 2026  
**Scope:** Full repository codebase:
- Backend: FastAPI service, WebSockets, terminal orchestration, PTY manager (`backend/`)
- Remote control: Discord, Telegram, WhatsApp, and Webhook integrations (`backend/remote/`)
- Desktop shell: Tauri v2 desktop application & Rust PTY engine (`frontend/src-tauri/`)
- Gateway: WSS relay service and authentication layer (`gateway/`)
- Frontend: React 19 UI, terminal views, editor (`frontend/src/`)

---

## 1. Executive Summary

A comprehensive source-code security audit was conducted on the Terminal Task Orchestrator (`tto`) codebase. The application is designed to orchestrate local terminals, run developer tools, and manage AI agent sessions across local desktop and remote channels.

While the backend incorporates preliminary security controls (such as Origin checks and basic shell escaping), critical architectural and implementation gaps remain that expose the host machine to unauthorized access, command execution, and sensitive credential disclosure.

### Finding Distribution

| Severity | Count | Summary |
|:---|:---:|:---|
| 🔴 **Critical** | 3 | Missing Discord authorization, unauthenticated local API execution, DNS rebinding |
| 🟠 **High** | 4 | Path blocklist bypass, unbounded static file server, arbitrary file reading in send-file, SSRF/framing in browse proxy |
| 🟡 **Medium** | 4 | Gateway sibling directory traversal, archive upload DoS / zip bomb, gateway sensitive file exposure, insecure `.env` permissions |
| 🔵 **Low** | 2 | Deprecated/vulnerable dependencies (NPM & Cargo), insecure temporary files in auxiliary scripts |

---

## 2. Findings Matrix

| ID | Severity | Category | Vulnerability Description | Primary Location |
|:---|:---:|:---|:---|:---|
| **SEC-01** | 🔴 Critical | Access Control | Discord bot lacks user/channel authorization checks | [`backend/remote/discord_bot.py`](file:///Users/kennethaman/tto-golden/backend/remote/discord_bot.py#L1041-L1108) |
| **SEC-02** | 🔴 Critical | Authentication | Unauthenticated REST API and WebSocket endpoints allow arbitrary command execution | [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py#L4629-L4658), [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py#L5842-L5956) |
| **SEC-03** | 🔴 Critical | Network Security | Missing `TrustedHostMiddleware` allows DNS rebinding attacks to read sensitive data | [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py#L196-L210) |
| **SEC-04** | 🟠 High | Path Containment | `_is_blocked_path()` checks single path components, failing on multi-part paths like `.config/opencode` | [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py#L4928-L4948) |
| **SEC-05** | 🟠 High | Information Disclosure | `POST /api/serve/start` starts HTTP server without path containment checks | [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py#L7245-L7292) |
| **SEC-06** | 🟠 High | Arbitrary File Read | `POST /api/terminals/{tty}/send-file` reads arbitrary system files without path restrictions | [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py#L2187-L2202) |
| **SEC-07** | 🟠 High | SSRF / Framing | `GET /api/browse` strips frame-ancestors/XFO headers and allows loopback access without Origin checks | [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py#L737-L845) |
| **SEC-08** | 🟡 Medium | Path Traversal | Gateway static file server uses string prefix `startsWith` vulnerable to sibling directory traversal | [`gateway/src/server.ts`](file:///Users/kennethaman/tto-golden/gateway/src/server.ts#L482-L495) |
| **SEC-09** | 🟡 Medium | Denial of Service | Project archive upload reads entire file into RAM before checking size and lacks extraction decompression caps | [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py#L5722-L5751) |
| **SEC-10** | 🟡 Medium | Information Disclosure | Desktop gateway client allows remote clients to read sensitive user credentials under `$HOME` | [`frontend/src-tauri/src/gateway/mod.rs`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/src/gateway/mod.rs#L491-L511) |
| **SEC-11** | 🟡 Medium | Security Hygiene | Secret environment configuration files (`.env`) have world-readable permissions (`0644`) | [`.env`](file:///Users/kennethaman/tto-golden/.env), [`backend/.env`](file:///Users/kennethaman/tto-golden/backend/.env) |
| **SEC-12** | 🔵 Low | Supply Chain | Outdated packages in npm dependencies (`brace-expansion`, `fast-uri`) and Cargo (`glib`) | [`frontend/package.json`](file:///Users/kennethaman/tto-golden/frontend/package.json), [`frontend/src-tauri/Cargo.lock`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/Cargo.lock) |

---

## 3. Vulnerability Deep Dive & Remediation Guidance

### SEC-01: Discord Bot Missing User Authorization
- **Severity:** 🔴 Critical (CWE-306, CWE-862)
- **File:** [`backend/remote/discord_bot.py`](file:///Users/kennethaman/tto-golden/backend/remote/discord_bot.py#L1041-L1108)
- **Description:**
  While Telegram and WhatsApp integrations enforce strict allowlists (`TELEGRAM_ALLOWED_USER_IDS` and `OPENWA_ALLOWED_CHAT_IDS`), the Discord bot checks no user credentials. Any Discord user in any server where the bot is installed can run `/task`, `/new`, `/workspaces`, and `/abort`.
- **Impact:**
  An unauthorized remote user can send tasks to active AI agent sessions that have permission to read/write code and execute shell commands inside your local project workspaces.
- **Remediation:**
  1. Add `DISCORD_ALLOWED_USER_IDS` to [`backend/remote/config.py`](file:///Users/kennethaman/tto-golden/backend/remote/config.py).
  2. Implement an interaction check in [`backend/remote/discord_bot.py`](file:///Users/kennethaman/tto-golden/backend/remote/discord_bot.py) that rejects interactions from users not in the allowlist.

```python
# In backend/remote/discord_bot.py
@bot.check
async def globally_block_unauthorized_users(interaction: discord.Interaction) -> bool:
    allowed_ids = load_config().discord_allowed_user_ids
    if not allowed_ids or str(interaction.user.id) not in allowed_ids:
        await interaction.response.send_message("❌ Unauthorized", ephemeral=True)
        return False
    return True
```

---

### SEC-02: Unauthenticated Backend REST & WebSocket Endpoints
- **Severity:** 🔴 Critical (CWE-306)
- **Files:** [`backend/main.py:4629`](file:///Users/kennethaman/tto-golden/backend/main.py#L4629), [`backend/main.py:5842`](file:///Users/kennethaman/tto-golden/backend/main.py#L5842), [`backend/main.py:5979`](file:///Users/kennethaman/tto-golden/backend/main.py#L5979)
- **Description:**
  The server binds to `127.0.0.1:8765` and uses an Origin header check to protect against cross-site browser requests. However, requests without an `Origin` header (such as local non-browser applications, CLI utilities, curl, or scripts run by other users) are explicitly permitted (`_origin_allowed(None) == True`).
- **Impact:**
  Any local process can issue `POST /api/run` with `{"command": "..."}` to execute commands via `bash -lc`, or open `/ws/term/{pane_id}` and write arbitrary input directly to the terminal PTY master file descriptor.
- **Remediation:**
  Generate a random session token (e.g., UUID or `secrets.token_urlsafe(32)`) when the desktop app boots, pass it to the Python sidecar via an environment variable or flag, and require it via an `X-Task Orchestrator-Token` header on all HTTP requests and as a query parameter / initial frame on WebSocket connections.

---

### SEC-03: DNS Rebinding Vulnerability Exposing Sensitive Files & Chat History
- **Severity:** 🔴 Critical (CWE-290, CWE-346)
- **File:** [`backend/main.py:196-210`](file:///Users/kennethaman/tto-golden/backend/main.py#L196-L210)
- **Description:**
  FastAPI has no `TrustedHostMiddleware` enabled. In a DNS rebinding attack, an attacker configures a domain with short TTL resolving first to an external server and then to `127.0.0.1`.
  Because [`_origin_guard`](file:///Users/kennethaman/tto-golden/backend/main.py#L196-L210) specifically excludes `GET`, `HEAD`, and `OPTIONS` requests from rejection, the browser considers requests to the rebinding domain as same-origin, allowing JavaScript to read response bodies.
- **Impact:**
  External malicious websites visited in a browser can read user files via `GET /api/file`, list project folders via `GET /api/files`, view Git diffs via `GET /api/git/diff`, and extract AI session transcripts via `GET /api/opencode/sessions/{id}/messages`.
- **Remediation:**
  1. Add `TrustedHostMiddleware` to restrict valid `Host` headers:
     ```python
     from starlette.middleware.trustedhost import TrustedHostMiddleware
     app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "*.localhost"])
     ```
  2. Enforce Origin checks on `GET` requests when an `Origin` header is provided by the browser.

---

### SEC-04: Path Containment Bypass in `_is_blocked_path()`
- **Severity:** 🟠 High (CWE-22)
- **Files:** [`backend/main.py:4928-4948`](file:///Users/kennethaman/tto-golden/backend/main.py#L4928-L4948), [`backend/remote/config.py:25-38`](file:///Users/kennethaman/tto-golden/backend/remote/config.py#L25-L38)
- **Description:**
  [`_is_blocked_path`](file:///Users/kennethaman/tto-golden/backend/main.py#L4928) checks:
  ```python
  parts = p.parts
  for part in parts:
      if part in BLOCKED_PATH_FRAGMENTS:
          return True
  ```
  `BLOCKED_PATH_FRAGMENTS` contains slash-separated path strings such as `".config/opencode"` and `".tto-web/state.json"`. Because `Path.parts` splits paths by slash, individual components (e.g. `".config"`, `"opencode"`) never match `".config/opencode"`.
- **Impact:**
  Files in `~/.config/opencode/` (containing OpenCode API keys and auth tokens) and `~/.tto-web/state.json` can be read or written via `/api/file`. Other sensitive files like `~/.npmrc`, `~/.bash_history`, and `~/.zsh_history` are also not blocked.
- **Remediation:**
  Normalize the path and perform relative containment checks against `$HOME` or check POSIX path substrings:
  ```python
  def _is_blocked_path(p: Path) -> bool:
      posix = p.as_posix()
      for fragment in BLOCKED_PATH_FRAGMENTS:
          if f"/{fragment}/" in f"/{posix}/" or posix.endswith(f"/{fragment}"):
              return True
      return False
  ```

---

### SEC-05: Unrestricted Directory Exposure via `/api/serve/start`
- **Severity:** 🟠 High (CWE-200)
- **File:** [`backend/main.py:7245-7292`](file:///Users/kennethaman/tto-golden/backend/main.py#L7245-L7292)
- **Description:**
  `POST /api/serve/start` starts a static HTTP server (`python3 -m http.server`) rooted at any caller-specified directory path without verifying that the path is an allowed project workspace or excluding sensitive directories.
- **Impact:**
  Specifying `path: "/"` or `path: "/Users/kennethaman"` starts an unauthenticated HTTP server on the local machine exposing the entire home directory (keys, secrets, bash history, documents).
- **Remediation:**
  Pass the requested directory through [`_safe_path`](file:///Users/kennethaman/tto-golden/backend/main.py#L4950) and reject paths that equal `$HOME` or contain sensitive blocked fragments.

---

### SEC-06: Arbitrary File Read in `/api/terminals/{tty}/send-file`
- **Severity:** 🟠 High (CWE-22)
- **File:** [`backend/main.py:2187-2202`](file:///Users/kennethaman/tto-golden/backend/main.py#L2187-L2202)
- **Description:**
  [`send_file_to_terminal`](file:///Users/kennethaman/tto-golden/backend/main.py#L2188) reads file contents using `Path(file_path).read_bytes()` without validating the path against allowed workspace directories or sensitive file patterns.
- **Impact:**
  Any readable system file or credential file can be read and injected into the terminal stream.
- **Remediation:**
  Validate `file_path` with [`_safe_path`](file:///Users/kennethaman/tto-golden/backend/main.py#L4950) and [`_is_blocked_path`](file:///Users/kennethaman/tto-golden/backend/main.py#L4928) before reading.

---

### SEC-07: SSRF and Frame Header Stripping in `/api/browse`
- **Severity:** 🟠 High (CWE-918, CWE-1021)
- **File:** [`backend/main.py:737-845`](file:///Users/kennethaman/tto-golden/backend/main.py#L737-L845)
- **Description:**
  [`browse_proxy`](file:///Users/kennethaman/tto-golden/backend/main.py#L738) acts as an open reverse proxy for web rendering. It explicitly allows loopback (`127.0.0.1`, `localhost`) targets and removes upstream `X-Frame-Options` and `Content-Security-Policy` headers. However, the endpoint itself sets no frame restrictions on its own response and performs no origin check.
- **Impact:**
  External websites can iframe internal developer services (or external applications that forbid framing) via `http://localhost:8765/api/browse?url=http://127.0.0.1:...` to facilitate clickjacking attacks.
- **Remediation:**
  Set `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: frame-ancestors 'self' tauri://localhost https://tauri.localhost` on the response. Restrict loopback proxying unless explicitly authenticated.

---

### SEC-08: Sibling Directory Traversal in Gateway Static File Server
- **Severity:** 🟡 Medium (CWE-22)
- **File:** [`gateway/src/server.ts:482-495`](file:///Users/kennethaman/tto-golden/gateway/src/server.ts#L482-L495)
- **Description:**
  `serveStatic` checks `if (!target.startsWith(root))`. Because the check does not ensure a trailing directory separator, a requested URL like `/../root-secret/key.txt` resolves to `/app/root-secret/key.txt`, which satisfies `startsWith('/app/root')`.
- **Remediation:**
  Use `path.relative` or verify `target.startsWith(root + path.sep)`.

---

### SEC-09: Unbounded Memory Buffering and Zip Bombs in Archive Upload
- **Severity:** 🟡 Medium (CWE-400, CWE-409)
- **File:** [`backend/main.py:5722-5751`](file:///Users/kennethaman/tto-golden/backend/main.py#L5722-L5751)
- **Description:**
  `upload_project` buffers the entire uploaded file in memory via `content = await file.read()` before evaluating its size against the 500 MB limit. When extracting, the aggregate uncompressed byte size of entries is not validated against a threshold.
- **Remediation:**
  Stream incoming chunks to disk and calculate uncompressed byte sums across `ZipInfo` entries before extracting.

---

### SEC-10: Sensitive File Exposure via Desktop Gateway
- **Severity:** 🟡 Medium (CWE-200)
- **File:** [`frontend/src-tauri/src/gateway/mod.rs:491-511`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/src/gateway/mod.rs#L491-L511)
- **Description:**
  [`handle_file_read`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/src/gateway/mod.rs#L492) verifies that canonical paths reside under `$HOME`, but does not filter out private keys or credentials. Remote clients connected to the Gateway can read files such as `~/.ssh/id_rsa`, `~/.aws/credentials`, and `.env`.
- **Remediation:**
  Implement a sensitive file filter in the Rust gateway client mirroring the backend blocked patterns.

---

### SEC-11: World-Readable Permissions on Environment Secret Files
- **Severity:** 🟡 Medium (CWE-732)
- **Files:** [`.env`](file:///Users/kennethaman/tto-golden/.env), [`backend/.env`](file:///Users/kennethaman/tto-golden/backend/.env)
- **Description:**
  Both `.env` files contain active API secrets (`TELEGRAM_BOT_TOKEN`, `OPENWA_WEBHOOK_SECRET`, `Task Orchestrator_GROQ_API_KEY`) and are set to permissions `0644` (`-rw-r--r--`).
- **Remediation:**
  Restrict permissions to the file owner:
  ```bash
  chmod 600 .env backend/.env
  ```

---

### SEC-12: Known Vulnerabilities in Dependencies
- **Severity:** 🔵 Low (CWE-1395)
- **Files:** [`frontend/package.json`](file:///Users/kennethaman/tto-golden/frontend/package.json), [`frontend/src-tauri/Cargo.lock`](file:///Users/kennethaman/tto-golden/frontend/src-tauri/Cargo.lock)
- **Findings:**
  - `brace-expansion` (CVE/GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7): DoS via quadratic expansion and recursion stack exhaustion.
  - `fast-uri` (GHSA-hrr3-gc8f-f4qj): Host case normalization inconsistency.
  - `glib` (RUSTSEC-2024-0429): Unsoundness in iterator implementations.
- **Remediation:**
  Run `npm update brace-expansion fast-uri` in `frontend/`, and update cargo dependencies in `frontend/src-tauri/`.

---

## 4. Prioritized Remediation Roadmap

1. **Immediate (Deploy within 24 hours):**
   - Restrict `.env` permissions: `chmod 600 .env backend/.env`.
   - Add user ID validation to Discord slash commands in [`backend/remote/discord_bot.py`](file:///Users/kennethaman/tto-golden/backend/remote/discord_bot.py).
   - Fix `_is_blocked_path()` in [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py) to block multi-component paths like `.config/opencode`.
   - Add path checks to [`serve_start`](file:///Users/kennethaman/tto-golden/backend/main.py#L7245) and [`send_file_to_terminal`](file:///Users/kennethaman/tto-golden/backend/main.py#L2187).

2. **Short-Term (Next sprint):**
   - Add `TrustedHostMiddleware` to [`backend/main.py`](file:///Users/kennethaman/tto-golden/backend/main.py) against DNS rebinding.
   - Enforce an internal session token handshake between Tauri and the FastAPI sidecar.
   - Add clickjacking protections (`frame-ancestors`) to `/api/browse`.
   - Fix `startsWith` check in Gateway [`serveStatic`](file:///Users/kennethaman/tto-golden/gateway/src/server.ts#L482).

3. **Medium-Term:**
   - Implement stream-based project archive upload and zip bomb protections.
   - Add sensitive file blocklists to the desktop Gateway client.
   - Update vulnerable NPM and Cargo dependencies.
