# Task Orchestrator Remote Control (WhatsApp via OpenWA)

Control your Task Orchestrator workstation from your phone through WhatsApp. Task Orchestrator runs a thin,
optional remote subsystem (`backend/remote/`) that talks to the **external**
[OpenWA](https://github.com/rmyndharis/OpenWA) service. OpenWA is never bundled
or forked — Task Orchestrator just uses its REST API + webhook. When OpenWA is offline or the
subsystem is disabled, **Task Orchestrator works exactly as before**.

```
Phone → WhatsApp → OpenWA (:2785) → webhook → Task Orchestrator remote subsystem (:8765)
                                         → existing Task Orchestrator pipelines (tasks/input)
```

---

## 1. Architecture

- **`backend/remote/`** — the whole subsystem (independent, stdlib-only):
  - `config.py` — env + `.env` loader, settings, secret redaction
  - `parser.py` — WhatsApp text → structured `ParsedCommand`
  - `auth.py` — webhook secret, sender allowlist, rate limiting
  - `safety.py` — shell command classification (safe / dangerous / blocked)
  - `confirmations.py` — sender-bound, expiring confirmation tokens
  - `service.py` — executes commands against the EXISTING Task Orchestrator APIs via a bridge
  - `formatter.py` — Task Orchestrator state → concise WhatsApp messages
  - `openwa_client.py` — OpenWA HTTP client (retries, timeouts)
  - `webhook.py` — FastAPI router `/api/remote/*`
  - `notify.py` — proactive notifications (dedup + cooldown)
- **`main.py`** — registers the bridge (reuses `_place_task`, `send_to_terminal_shell`,
  the `/ws/command-relay` for Rust sessions), mounts the router, starts loops.
- **Rust** — the relay (`relay.rs`) gained `raw_input`, `terminal_restart`,
  `terminal_close` message kinds; the manager gained `write_by_tty`,
  `restart_by_tty`, `close_by_tty`. Remote input goes through the same PTY the
  desktop app owns — nothing bypasses the terminal engine.
- **Frontend** — a compact Remote Control panel (🛰️ in the header) shows status
  and actions; never secrets.

```
WhatsApp ──► parser ──► service ──► bridge ──► existing Task Orchestrator pipelines
REST client ──► /api/remote/* ──► service ──► existing Task Orchestrator pipelines
```

---

## 2. OpenWA installation

```bash
git clone https://github.com/rmyndharis/OpenWA ~/openwa
cd ~/openwa
npm install
npm run start:dev          # listens on http://127.0.0.1:2785
```

Or use the helper scripts:

```bash
./scripts/start-openwa.sh            # start (installs deps on first run)
./scripts/stop-openwa.sh             # stop
./scripts/check-openwa.sh            # OpenWA + Task Orchestrator remote status
```

## 3. OpenWA configuration

- Default port **2785** (no conflict with Task Orchestrator's **8765**).
- **Important:** OpenWA's SSRF guard blocks webhooks to internal hosts by
  default. Add this to OpenWA's own `.env` (`~/OpenWA/.env`) so it may deliver
  events to the local Task Orchestrator sidecar:

  ```
  SSRF_ALLOWED_HOSTS=127.0.0.1
  ```

  Then restart OpenWA. (This is the documented escape hatch — prefer it over
  `WEBHOOK_SSRF_PROTECT=false`, which disables SSRF protection wholesale.)
- The session and webhook are created automatically by Task Orchestrator's connect flow — you
  only need the API key.
- Generate an API key for Task Orchestrator (OpenWA settings) → `OPENWA_API_KEY`.

## 4. WhatsApp QR pairing

1. Set `Task Orchestrator_REMOTE_ENABLED=true`, `OPENWA_API_KEY`, `OPENWA_WEBHOOK_SECRET` and
   your allowlist in `~/tto-web/.env`, then restart the sidecar (`tto`).
2. In the app, open the 🛰️ Remote Control panel → **Connect WhatsApp**.
   Task Orchestrator creates/ensures the `tto-remote` session, starts QR login, **registers
   the webhook**, and shows the QR (`POST /api/remote/connect`).
3. WhatsApp → Linked Devices → Link a Device → scan the QR.
4. The panel flips to `paired`; commands now work.

**How you message Task Orchestrator (single-phone setup):** Task Orchestrator is a linked device of YOUR
WhatsApp account, so there is no separate bot number. Open the **"Message
yourself"** chat (the chat with your own number at the top of your chat list)
and type commands there — `/status`, `/terminals`, `/queue 7 <task>`, etc.

Self-chat sends arrive at OpenWA as `message.sent` (the account's own outgoing
messages), so the webhook subscribes to `message.received` **and**
`message.sent`. Task Orchestrator only acts on `message.sent` when the body is a real
command AND the message is self-addressed (`from == to == chatId`) — replies
Task Orchestrator itself sends never loop back, and a stray command typed into a friend's
chat is ignored (never acted on, never replied to there).

   If you prefer manual control: `POST /api/sessions` `{name: "tto-remote"}`,
   `POST /api/sessions/{id}/start`, then read the QR from the app or
   `GET /api/remote/qr`.

## 5. Environment variables

Copy `.env.example` → `~/tto-web/.env` (the sidecar auto-loads `~/tto-web/.env`
or `~/tto-web/backend/.env` when it starts):

| Variable | Meaning |
|---|---|
| `Task Orchestrator_REMOTE_ENABLED` | master switch (also `OPENWA_ENABLED`) |
| `OPENWA_BASE_URL` | default `http://127.0.0.1:2785` |
| `OPENWA_API_KEY` | OpenWA REST API key |
| `OPENWA_SESSION_ID` | WhatsApp session to use |
| `OPENWA_WEBHOOK_SECRET` | secret for webhook auth |
| `OPENWA_ALLOWED_CHAT_IDS` | authorized chats (comma/space list) |
| `OPENWA_ALLOWED_PHONE_NUMBERS` | authorized phone numbers |
| `Task Orchestrator_REMOTE_RATE_LIMIT` | commands per sender per minute (default 30) |
| `Task Orchestrator_REMOTE_CONFIRM_TTL` | confirmation expiry seconds (default 60) |
| `Task Orchestrator_REMOTE_LOGS_MAX` / `Task Orchestrator_REMOTE_LOGS_DEFAULT` | log line caps |
| `Task Orchestrator_REMOTE_NOTIFY_*` | per-category notification toggles |
| `Task Orchestrator_REMOTE_NOTIFY_MIN_INTERVAL` | cooldown per category (default 30s) |
| `Task Orchestrator_REMOTE_AUDIT_LOG` | optional audit log path |
| `Task Orchestrator_TELEGRAM_ENABLED` | Telegram bot switch |
| `TELEGRAM_BOT_TOKEN` | token from @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | authorized Telegram user ids |
| `TELEGRAM_POLL_INTERVAL` | long-poll interval (default 1s) |

Secrets are never logged, never returned by the status API, never shown in the UI.

## 6. Webhook setup

Task Orchestrator's connect flow registers it for you, but the manual equivalent is OpenWA's
real per-session endpoint:

```
POST /api/sessions/{sessionId}/webhooks
{"url": "http://127.0.0.1:8765/api/remote/whatsapp/webhook",
 "events": ["message.received"],
 "secret": "<OPENWA_WEBHOOK_SECRET>"}
```

OpenWA then signs every delivery with `X-OpenWA-Signature: sha256=<hex
HMAC-SHA256 of the exact raw body>` using that secret; Task Orchestrator verifies the
signature (a plain `X-Webhook-Secret` header is also accepted). Unauthenticated
webhooks are rejected. The delivered body is OpenWA's standard envelope:
`{event, timestamp, sessionId, idempotencyKey, deliveryId, data}` where `data`
is the message (`id`, `from`, `author` for groups, `chatId`, `body`, `type`,
`timestamp`, `fromMe`). Processed message ids are remembered for 1 hour so
retries never double-execute a command. WhatsApp addresses the account's own
chat by a privacy **LID** (e.g. `218068491980857@lid`) — the sender of a
self-chat send is the account's own LID, not the phone number, which is why
self-chat authorization keys on self-addressed `from == to == chatId` rather
than the allowlist alone.

## 7. Allowed senders

Without an allowlist the subsystem **fails closed** — nobody can control Task Orchestrator.
Authorized = chat id **or** phone number in the list.

## 8. Telegram bot (alternative transport — no second SIM)

WhatsApp has no Telegram-style bots on one number, so Task Orchestrator also ships a real
Telegram bot that reuses the **entire** command engine (parser → safety →
confirmations → service → formatter) — only the transport differs:

1. Create a bot with **@BotFather** and copy the token.
2. Put it in `~/tto-web/.env`:
   ```
   Task Orchestrator_TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_ALLOWED_USER_IDS=
   ```
3. Restart the sidecar, open the bot in Telegram and send `/start`.
4. The bot replies with **your numeric user id** — put it in
   `TELEGRAM_ALLOWED_USER_IDS` (comma-separated) and restart the sidecar.

That's it. The bot appears as a normal Telegram contact (open the chat, type
`/help`). Unauthorized users are silently ignored; `/start` is the only thing
an unauthorized user hears (so they can self-report their id). The bot also
advertises its command palette (`/help /status /terminals /terminal /logs
/queue /tokens …`) in the Telegram UI. Proactive notifications are delivered to
the first allowed user id as well.

The bot long-polls `api.telegram.org` (works on localhost — no public webhook
URL needed) and never crashes Task Orchestrator when Telegram is offline.

## 9. Commands

```
/help            full command list
/status          overall state
/terminals [n]   paged terminal list
/terminal <id>   terminal detail
/logs <id> [n]   last N lines (max 200)
/run <id> <cmd>  run a command in the terminal (safety-classified)
/input <id> <t>  raw terminal input
/queue <id> <t>  queue a task (existing task pipeline)
/next <id> [t]   show / set the next task
/pause <id>      pause (queued tasks won't auto-start)
/resume <id>     resume (promotes the next queued task)
/restart <id>    restart the terminal shell
/stop <id>       interrupt (Ctrl+C)
/kill <id>       close the terminal
/files [path]    workspace file listing (sandboxed)
/tokens          token usage
/agents          agent list
/workspace       workspaces
/health          system health
/shutdown        stop the sidecar (confirmed)
```

Natural language is mapped deterministically: "what is terminal 12 doing?" →
`/terminal 12`, "show agents that are stuck" → `/agents`, etc. The AI layer
never bypasses validation or authorization.

## 9. Confirmation system

`/kill`, `/stop`, `/restart`, `/pause`, `/resume`, `/shutdown`, and dangerous
shell commands (`rm file`, `kill …`, `git clean …`) never run immediately. Task Orchestrator
replies with `CONFIRM <TOKEN>` instructions; only the **same sender** can
confirm, within the TTL (default 60 s), and tokens are single-use. `CANCEL`
clears pending confirmations. Blocked commands (`rm -rf /`, `sudo`, `reboot`,
`git push --force`, `curl | sh`, …) are refused outright — confirmation does
not bypass the safety policy.

## 11. Security model

1. Webhook secret/signature check (fail closed).
2. Sender + chat allowlist (fail closed without config).
3. Rate limiting (default 30 commands/min/sender).
4. Permission classes: read / write / dangerous.
5. Shell command classification: safe → run; dangerous → confirm; blocked → refuse.
6. Confirmations bound to sender + command + target + token + expiry.
7. File access sandboxed to `$HOME`, secrets paths blocked, traversal rejected.
8. Audit log with sender/command/result/duration — never secrets.
9. Local-first: everything binds 127.0.0.1; remote access should go through a
   VPN/tunnel, not open ports.

## 12. Proactive notifications

Task complete / failed / agent waiting / terminal crash / system error are
pushed to the first authorized chat (WhatsApp) and the first allowed Telegram
user id (parallel channel), gated by per-category toggles, a cooldown
(default 30 s) and 60 s dedup, so neither WhatsApp nor Telegram is ever
spammed.

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| Panel shows "Disabled" | Set `Task Orchestrator_REMOTE_ENABLED=true` (and `OPENWA_ENABLED=true`) in `~/tto-web/.env`, restart sidecar (`tto`) |
| "OpenWA unreachable" | `./scripts/check-openwa.sh`; is `npm run start:dev` up on :2785? |
| Webhook 403 | Wrong/missing secret in OpenWA webhook registration |
| Webhook registration fails `400 Destination address is not allowed` | OpenWA's SSRF guard — set `SSRF_ALLOWED_HOSTS=127.0.0.1` in `~/OpenWA/.env` and restart OpenWA |
| "sender not allowed" | Add the chat id / phone to the allowlist |
| Commands say "Terminal #N does not exist" | The id is the position in `/terminals` (1-based) |
| No notifications | Toggles off, no allowed chat configured, or cooldown active |
| Bot silent (Telegram) | `Task Orchestrator_TELEGRAM_ENABLED` + valid `TELEGRAM_BOT_TOKEN` set, sidecar restarted; send `/start` first to get your user id |

## 14. Testing

```bash
cd backend
~/tto-web/venv/bin/python -m unittest tests.test_remote -v
```

Covers parser, auth, rate limit, webhook secret+signature, command
classification, path sandbox, confirmations (expiry/sender-bound/cancel),
formatters, service dispatch (dangerous flow, confirm-execute, blocked
commands), webhook idempotency, and the Telegram handler (update parsing,
unauthorized silence, `/start` self-reporting, command dispatch, confirmation
flow). No real WhatsApp messages or Telegram API calls are ever made.

## 15. Development / local deployment

```bash
# Terminal 1 — OpenWA
cd ~/openwa && npm run start:dev

# Terminal 2 — Task Orchestrator sidecar (loads ~/.env)
cd ~/tto-web/backend && ~/tto-web/venv/bin/python main.py

# Terminal 3 — desktop app
cd ~/tto-web/frontend && npm run tauri dev
```

`tto` (the one-word launcher) keeps everything current: restarts the sidecar on
backend changes, rebuilds the app on source changes, syncs the `.app`.

> Note: the desktop-app-spawned sidecar reads the same `~/tto-web/.env`, so
> remote control works whether the sidecar was started by `tto`, by
> `start_server.sh`, or by the app itself.

## 16. Remaining limitations

- **Telegram live round-trip needs a real BotFather token** — everything up
  to the Bot API call is unit-tested (dispatch, auth, confirmations); actual
  message delivery requires a token and an authorized user id.
- **The pipeline up to pairing is verified against a real OpenWA** (session
  creation, QR generation, webhook registration + HMAC delivery, command
  parsing, sender auth, dedup, reply sending). The final QR **scan** needs your
  phone, and replies only flow once the session is `ready` — automated tests
  stub the WhatsApp side.
- `/stop` on non-Rust, non-tmux terminals (plain Terminal.app tabs) is best
  effort (macOS keystroke injection may need Accessibility permission).
- Notification "agent waiting" detection is minimal (task status based).
- Natural-language interpretation maps a fixed set of intents; it does not
  own authorization.
