/**
 * TTO remote protocol — versioned envelope + message taxonomy.
 *
 * Every message is a JSON object with the shape:
 *   { v: 1, id: string, type: string, payload: {...} }
 *
 * `v` is the protocol version (currently 1). `id` is an opaque request id the
 * sender can use to correlate responses. Peers reject envelopes with an
 * unknown `v` or unknown `type`.
 *
 * The gateway relays these between a remote client and the user's TTO desktop
 * instance. It never executes commands itself — it only routes authorized
 * messages. Terminal data travels as base64 in `payload.data` so the envelope
 * stays a single JSON text frame (simple, resumable, and length-bounded).
 */

export const PROTOCOL_VERSION = 1;

export const PROTOCOL_NAMESPACE = 'tto';

/** Reserved top-level message types (desktop ↔ client via gateway). */
export const MSG = {
  // control
  HELLO: 'hello',
  HEARTBEAT: 'heartbeat',
  PONG: 'pong',
  ACK: 'ack',
  ERROR: 'error',
  // device / presence
  DEVICE_STATUS: 'device.status',
  DEVICE_LIST: 'device.list',
  // pairing
  PAIRING_CREATE: 'pairing.create',
  PAIRING_CONFIRM: 'pairing.confirm',
  PAIRING_STATUS: 'pairing.status',
  // session
  SESSION_LIST: 'session.list',
  SESSION_ATTACH: 'session.attach',
  SESSION_DETACH: 'session.detach',
  SESSION_STATE: 'session.state',
  // terminal
  TERMINAL_INPUT: 'terminal.input',
  TERMINAL_OUTPUT: 'terminal.output',
  TERMINAL_RESIZE: 'terminal.resize',
  TERMINAL_SIGNAL: 'terminal.signal',
  TERMINAL_LIST: 'terminal.list',
  TERMINAL_SEND_COMMAND: 'terminal.send_command',
  // task dispatch — create a fresh session on the desktop and run a command
  // in it. Replies `ack { ok, sessionId, ... }` or `error` (never silent).
  TASK_DISPATCH: 'task.dispatch',
  // agent
  AGENT_INPUT: 'agent.input',
  AGENT_OUTPUT: 'agent.output',
  AGENT_STATUS: 'agent.status',
  AGENT_LIST: 'agent.list',
  // files
  FILE_LIST: 'file.list',
  FILE_READ: 'file.read',
  FILE_WRITE: 'file.write',
  FILE_META: 'file.meta',
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

export interface Envelope {
  v: number;
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

/** Validate an incoming envelope. Returns null when valid, else an error string. */
export function parseEnvelope(raw: unknown): { env: Envelope | null; error?: string } {
  if (typeof raw !== 'string') return { env: null, error: 'non_text' };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { env: null, error: 'bad_json' };
  }
  if (typeof obj !== 'object' || obj === null) return { env: null, error: 'bad_object' };
  const e = obj as Record<string, unknown>;
  if (typeof e['v'] !== 'number' || e['v'] !== PROTOCOL_VERSION) {
    return { env: null, error: 'unsupported_version' };
  }
  if (typeof e['id'] !== 'string' || !e['id']) return { env: null, error: 'missing_id' };
  if (typeof e['type'] !== 'string' || !e['type']) return { env: null, error: 'missing_type' };
  const payload = typeof e['payload'] === 'object' && e['payload'] !== null ? e['payload'] : {};
  return {
    env: {
      v: e['v'] as number,
      id: e['id'] as string,
      type: e['type'] as string,
      payload: payload as Record<string, unknown>,
    },
  };
}

export function envelope(type: MsgType | string, payload: Record<string, unknown>, id = newId()): Envelope {
  return { v: PROTOCOL_VERSION, id, type, payload };
}

export function newId(): string {
  // crypto-free stable fallback is fine for request ids; the gateway's auth
  // layer uses node:crypto for anything security-relevant.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Base64 encode/decode helpers for binary (terminal) payloads. */
export function toB64(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}
export function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Inbound-ACK contract (v1.1, enforced by the desktop worker).
 *
 * EVERY inbound dispatch MUST be answered — nothing is ever dropped silently.
 * The reply echoes the request `id` so the client can correlate it.
 *
 *   success → ack
 *     { v:1, id:<requestId>, type:'ack',
 *       payload: { ok:true, kind:'terminal.input'|'terminal.send_command'|
 *                          'terminal.resize'|'terminal.signal'|'task.dispatch',
 *                  sessionId?:string } }
 *
 *   failure → error  (never a silent nothing)
 *     { v:1, id:<requestId>, type:'error',
 *       payload: { ok:false, kind:<same>, sessionId?:string, error:string } }
 *
 * `error` values seen in practice:
 *   - 'no session <id>'   session id/tty unknown on the desktop (stale list)
 *   - 'empty_command'     command missing
 *   - 'no_session_id'     no sessionId and not a task.dispatch
 *   - 'unknown_type'      type not implemented by the desktop worker
 *   - 'create_failed: …'  task.dispatch could not spawn a new session
 *   - 'empty_credential' / 'auth_failed' (gateway-level, pre-hello)
 *
 * task.dispatch (new in v1.1):
 *   request:  { v:1, id, type:'task.dispatch',
 *               payload:{ command:string, cwd?:string, cols?:number,
 *                         rows?:number, workspaceId?:string } }
 *   desktop creates a NEW terminal session, runs `command` in it, and replies:
 *     ack     { ok:true, kind:'task.dispatch', sessionId:<new id> }
 *   (optional sessionId in the request routes the command into that session
 *   instead of creating one — same as terminal.send_command.)
 *   The client then sends `terminal.attach { sessionId }` to receive its
 *   live output, and `terminal.input { sessionId, data(b64) }` to interact.
 */
export const PROTOCOL_PAYLOAD_CONTRACT = 'v1.1-inbound-ack';