# TTO Gateway

Secure WSS relay between remote clients (phone / web / other devices) and the
user's TTO desktop instance. The desktop establishes an **outbound** persistent
connection to the gateway, so **no port forwarding, static IP, or public port
exposure on the home network is ever required**.

```
Phone / Web client ──WSS──▶ Gateway ◀──WSS── TTO Desktop (outbound)
                                 │
                          (routes authenticated messages only)
```

The gateway **never executes shell commands**. It authenticates peers, tracks
device presence, and relays protocol envelopes between a client and the device
it controls. Terminal/agent/files logic lives entirely on the desktop side.

## Quick start (local dev)

```bash
cd gateway
npm install
npm run build
export TTO_GATEWAY_ADMIN_PASSWORD=dev-password      # or use .env
export TTO_GATEWAY_DB=./data/dev.db
TTO_GATEWAY_TLS_CERT= TTO_GATEWAY_TLS_KEY= npm start  # plain WS for local dev
```

Health check: `curl http://127.0.0.1:8787/api/health`

## Production

- **WSS (required for internet):** generate a TLS cert and set
  `TTO_GATEWAY_TLS_CERT` / `TTO_GATEWAY_TLS_KEY`. The same HTTPS server also
  serves the web client and control-plane API.
- **Postgres:** the storage layer (`src/store.ts`) is a small interface. Swap
  the SQLite implementation for a Postgres adapter behind the same interface
  (users / devices / sessions / pairings / permissions). Migrations live in
  `gateway/migrations/` and are applied on startup for SQLite; the Postgres
  adapter applies the same DDL.
- **Public URL:** set `TTO_GATEWAY_PUBLIC_URL` to the externally reachable
  `wss://host:port` so clients can build connection links.

## API (control plane, over the same HTTPS server)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness |
| `POST /api/auth/login` | Password login → access + refresh tokens |
| `POST /api/auth/refresh` | Rotate refresh token |
| `POST /api/auth/logout` | Invalidate access token |
| `POST /api/pairing/confirm` | Confirm a pairing code (Bearer token) |
| `GET /api/devices` | List the user's devices + online status (Bearer) |
| `POST /api/devices/revoke` | Revoke a device (Bearer) |

## WebSocket protocol

Two roles connect:

- **Desktop** (`hello.role=desktop`, authenticated with device id + credential)
  — maintains one persistent outbound connection per device.
- **Client** (`hello.role=client`, authenticated with an access token, selects
  a `deviceId`) — controls that device.

All messages use the versioned envelope `{ v, id, type, payload }` (see
`src/protocol.ts`). The gateway routes client→desktop messages only when the
client's user owns the device and the device grants the required permission
(terminal / agent default-allow; files require an explicit grant).

## Security model

- Device identity: random id + public key; a long random **credential** is
  minted at pairing time and only its scrypt hash is stored server-side.
- Pairing codes: single-use, expiring, contain no permanent secret.
- Passwords/tokens: scrypt-hashed / SHA-256-hashed at rest; never logged.
- Rate limiting on auth + pairing; origin checks are handled at the client.
- Revocation kicks live desktop connections and deletes device sessions.
- Terminal output is never persisted by the gateway.

## Tests

```bash
npm test   # builds + runs node:test suites (auth, pairing, routing, isolation)
```