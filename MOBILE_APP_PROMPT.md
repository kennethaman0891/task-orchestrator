# Task Orchestrator Mobile App — Google AI Studio / Gemini Prompt (v1)

> Paste the entire section between the `=== PROMPT START ===` and `=== PROMPT END ===`
> markers into a fresh Google AI Studio conversation with Gemini 2.5 Pro (or another
> large model), together with the attached context files listed in "STEP 2".
> Attach the files in `context-files/` to the conversation before sending.

---

=== PROMPT START ===

You are a senior React Native / TypeScript engineer. I am going to ask you to build
a production-grade mobile client for my existing remote-terminal system, Task Orchestrator
(Terminal Task Orchestration). The desktop backend ALREADY EXISTS and is fully
working — you are building ONLY the mobile client + a thin web fallback. Do not
redesign the backend, do not invent a new protocol, and do not change anything the
attached spec defines. Follow the attached spec exactly.

## 1. SYSTEM CONTEXT (what already exists)

- A desktop app "Task Orchestrator" (Tauri/Rust) runs on the user's home PC. It runs real
  terminals, manages tasks/agents, and reads/writes files in a workspace.
- The desktop keeps an OUTBOUND persistent WSS connection to a central gateway
  server (TypeScript/Node). Outbound means: no port forwarding, no static IP, no
  same-Wi-Fi requirement. The desktop is reachable from anywhere in the world as
  long as the gateway is online.
- The gateway relays authenticated JSON envelopes between the desktop and remote
  "client" peers (phones). The gateway NEVER executes commands — it only routes.
- Your mobile app is the CLIENT peer. It must authenticate with the gateway, find
  the user's desktop device, and relay envelopes to/from it.

## 2. ATTACHED CONTEXT (read these files first)

Attached to this conversation:
- `gateway/src/protocol.ts`   — the exact envelope shape + all message types
- `gateway/src/router.ts`     — how desktop vs client peers authenticate and route
- `gateway/src/pairing.ts`    — device pairing flow (desktop initiates, phone confirms)
- `gateway/src/auth.ts`       — login/session/auth primitives
- `gateway/src/config.ts`     — env vars for the gateway
- `gateway/README.md`         — quick start, API table, production notes

If any of these files are not attached, TELL ME which ones are missing and keep
going using your best reconstruction — but flag every assumption you make.

## 3. WHAT TO BUILD (the mobile client)

Build a complete Expo (React Native) app, TypeScript, that implements:

### A. Auth & onboarding
1. Login screen: username + password → `POST {gateway}/api/auth/login` → store
   access + refresh tokens securely (expo-secure-store). Handle
   `POST /api/auth/refresh` (rotate refresh token) and `POST /api/auth/logout`.
2. First-run gateway URL config: user enters or scans the gateway public URL
   (e.g. `https://gw.example.com`).
3. After login, list the user's paired desktop devices:
   `GET /api/devices` (Bearer token) — show device id + online/offline presence.

### B. Pairing (phone confirms desktop's pairing request)
Per `pairing.ts`: desktop shows a single-use code or QR containing ONLY
`{ gatewayUrl, code }`. In the app:
1. "Add device" screen: type the 18-char group code (or scan QR).
2. `POST /api/pairing/confirm` (Bearer token) with the code → links the pending
   pairing to the user. Response is `{ ok: true, deviceId }` or `{ ok: false, reason }`.
3. The desktop polls `pairing.status`, sees `used`, then claims a credential —
   so pairing completes automatically without any further phone action.
4. Revocation: `POST /api/devices/revoke` (Bearer) — list + revoke screen.

### C. Live terminal preview (the core feature)
The phone must show LIVE terminal output of tasks running on the desktop, over
cellular data — different network from the PC's Wi-Fi.

1. Connect a WSS socket to `wss://{gateway}` (TLS in production).
2. Authenticate as a CLIENT peer — EXACT handshake (from `server.ts`):
   - First message MUST be a `hello` envelope:
     `{ v:1, id:"<new-id>", type:"hello", payload:{ role:"client", token:"<accessToken>", deviceId:"<deviceId>" } }`
   - The gateway replies `ack` (`{type:"ack", payload:{ ok:true, kind:"client", userId, deviceId }}`)
     then a `device.status` snapshot.
   - Any first message that is not a valid `hello` gets `ws.close(4400, 'hello_required')`.
     A bad token closes 4401.
   - After `ack`, send/receive normal `terminal.*`, `session.*`, `agent.*`, `file.*`
     envelopes. Heartbeats: send `{type:"heartbeat"}` → gateway replies `pong`.
3. Listen for `terminal.output` envelopes from the desktop; render each
   base64-decoded chunk with a terminal emulator. Use `@xterm/xterm`
   (or react-native-terminal-emulator) for correct ANSI rendering.
4. Keyboard: a text input that sends `terminal.input` (base64 data) on submit.
5. `terminal.resize`: send cols/rows on layout change. `terminal.signal`:
   Ctrl-C etc. must work.
6. Reconnect with backoff on disconnect; heartbeat per protocol.
7. **INBOUND-ACK CONTRACT (v1.1, MUST implement — this is critical):**
   - EVERY `terminal.input` / `terminal.send_command` / `task.dispatch` /
     `terminal.resize` / `terminal.signal` you send gets an **`ack`** or
     **`error`** reply echoing your request `id`. **Nothing is dropped silently.**
   - Success: `{ v:1, id:<your id>, type:'ack', payload:{ ok:true, kind, sessionId? } }`
   - Failure: `{ v:1, id:<your id>, type:'error', payload:{ ok:false, kind, sessionId?, error } }`
   - **You MUST show the error on screen** (red banner / toast). "Sent" is only
     shown when `ack` arrives. Common errors: `no session <id>` (session died →
     offer session list refresh), `unknown_type`, `empty_command`.
   - **task.dispatch flow:** to start a new task, send
     `task.dispatch { command, cwd?, cols?, rows?, workspaceId? }` (no sessionId).
     The desktop spawns a NEW terminal, runs the command, and replies
     `ack { ok:true, sessionId:<new> }`. Then send `terminal.attach { sessionId }`
     to stream its live output. This is how "dispatch a task from the phone and
     watch it run on the PC" works end-to-end.

### D. Session & task list
`session.list` / `terminal.list` → show running sessions: id, tty, title, cwd,
status, agent, pid. Tap a session to attach (subscribe to that session's output).
Also `agent.list` / `agent.status` for the agent-tasks view if available.

### E. File browser (stretch)
`file.list` / `file.read` / `file.write` — simple workspace file browser.

### F. Push notifications (must-have for "not in front of laptop")
When you cannot keep a WSS socket open (app killed), the user must still know a
task finished. Design the integration point:
- The gateway already logs events; for now implement a background Expo task /
  headless JS that keeps a lightweight socket alive when the app is backgrounded,
  and a local notification when a `terminal.output`/`session.state` marker arrives
  for "task done". If you instead recommend FCM + a gateway push webhook, spell
  out the exact gateway-side endpoint needed and stub it cleanly.

### G. Google Assistant / voice (final feature)
Define the intents file so the app can be invoked by voice ("start task X",
"show task status"). Use expo-intent-launcher or a deep link scheme
(`tto://task?name=...`). Mark clearly what is a stub vs implemented.

## 4. HARD REQUIREMENTS

- Works over ANY network: phone on cellular + PC on home Wi-Fi is the default
  scenario. Both are "different internet sources". Nothing may depend on
  same-LAN or same-Wi-Fi.
- Security: tokens in expo-secure-store; never log credentials; TLS required in
  production; verify the gateway's TLS cert; no plaintext fallback outside dev.
- Resilience: WSS reconnect with exponential backoff + jitter; offline banner;
  "waiting for desktop online" states; graceful permission denied.
- Performance: terminal streaming should feel near-realtime on LTE. Batch base64
  chunks gracefully; throttle re-renders.
- Code quality: TypeScript strict, typed API client generated from the envelope
  types, unit tests for protocol encode/decode, a 10 file max change-per-commit
  workflow, and a README for running locally.

## 5. DELIVER

1. Complete Expo project (package.json, app.json, tsconfig, src/ tree).
2. `src/protocol/` — envelope builder/parser mirroring protocol.ts exactly.
3. `src/api/` — typed REST client (login, refresh, devices, pairing).
4. `src/gateway/` — WSS client peer (handshake, subscribe, relay, reconnect).
5. `src/screens/` — Login, GatewayConfig, DeviceList, TerminalView, SessionList,
   FileBrowser, Settings.
6. `src/push/` — background socket + local notification bridge.
7. `test/` — protocol + auth flow tests.
8. A `BUILD_AND_DEPLOY.md` — steps to run on phone (Expo Go / dev build) and ship
   to stores, plus the gateway production checklist (TLS, Postgres, public URL).
9. End with a checklist "Integration points that must match my real gateway" —
   list every auth header, endpoint path, and envelope type you assumed, so I can
   diff them against the attached spec.
10. Confirm in the checklist that you implemented the **inbound-ack contract**
    (`ack`/`error` for every sent envelope, errors rendered on screen, task.dispatch
    returns a new sessionId) — this is the single most important reliability
    requirement of this app.

Ask me one clarifying question ONLY if truly blocked on the routing/auth
handshake details — otherwise make reasonable assumptions and FLAG them in the
final checklist.

=== PROMPT END ===

---

## STEP 2 — Context files to attach (in this repo)

Attach these exact files from the repo to the AI Studio conversation:

| File | Why |
|---|---|
| `gateway/src/protocol.ts` | Envelope spec + message taxonomy |
| `gateway/src/router.ts` | Peer auth + routing rules |
| `gateway/src/pairing.ts` | Pairing flow |
| `gateway/src/auth.ts` | Login/token primitives |
| `gateway/src/config.ts` | Gateway env config |
| `gateway/README.md` | Architecture + API table |

## STEP 3 — After generation

1. The model returns an Expo project — copy it into `mobile/` in this repo.
2. Run `cd mobile && npm install` — fix any version issues the model may have
   left (models are commonly ~2 patch versions behind on Expo SDK).
3. Smoke test against your LOCAL gateway first:
   `cd gateway && Task Orchestrator_GATEWAY_TLS_CERT= Task Orchestrator_GATEWAY_TLS_KEY= npm start`
   then point the app at `http://<your-lan-ip>:8787` for dev.
4. Then deploy the gateway to a public host (TLS + Postgres), set
   `Task Orchestrator_GATEWAY_PUBLIC_URL`, and test over cellular.

## Quick architecture recap (the part to mirror in your own words when prompting)

- Desktop (Rust) — outbound WSS, authenticates with device credential
- Gateway (Node/TS) — relay only; never executes commands
- Mobile client (this app) — WSS client, authenticates with user access token,
  subscribes to a device id, relays `terminal.*`, `session.*`, `agent.*`,
  `file.*` envelopes
- Envelope: `{ v: 1, id, type, payload }` — terminal data as base64 in
  `payload.data`