// ═══════════════════════════════════════════════════════════════════════════
// Collab API Client — remote collaboration with sidecar
// ═══════════════════════════════════════════════════════════════════════════

import { apiBase, fetchWithTimeout, handle } from '@/lib/api';

export interface OwnerProfile {
  email: string;
  name: string;
  instance_name: string;
  tagline?: string;
  plan?: 'paid' | 'pro' | 'plus';
  created_at?: number;
  updated_at?: number;
}

export interface CollabUser {
  username: string;
  email: string;
  name: string;
  permission: 'viewer' | 'worker' | 'admin';
  allowed_workspaces: string[];
  created_at: number;
  last_login_at?: number;
  revoked: boolean;
}

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  use_tls: boolean;
  from_email: string;
  from_name: string;
}

export interface CollabSettings {
  lan_access: boolean;
  log_on_desktop: boolean;
  smtp?: SmtpConfig;
}

export interface LoginResponse {
  token: string;
  username: string;
  email: string;
  name: string;
  permission: 'viewer' | 'worker' | 'admin';
  allowed_workspaces: string[];
  owner?: OwnerProfile | null;
}

export interface InviteResponse {
  invite_code: string;
  invite_url: string;
  subject: string;
  body: string;
  email_sent?: boolean;
  send_status?: string;
}

export interface CreateUserResponse {
  user: CollabUser;
  invite_code: string;
  invite_url: string;
  email_subject: string;
  email_body: string;
}

export interface AuditEvent {
  ts: number;
  user: string;
  type: string;
  details: Record<string, any>;
  ws?: string;
  tty?: string;
}

export interface PresenceUser {
  username: string;
  email?: string;
  name?: string;
  permission: 'viewer' | 'worker';
  token_prefix: string;
}

function authHeaders(token: string): HeadersInit {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// --- Host Owner API ---

export async function getOwnerProfile(): Promise<{ owner: OwnerProfile | null }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/owner`);
  return handle(res);
}

export async function setOwnerProfile(params: {
  email: string;
  name: string;
  instance_name?: string;
  tagline?: string;
  plan?: 'paid' | 'pro' | 'plus';
}): Promise<{ owner: OwnerProfile }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle(res);
}

export async function setOwnerPlan(plan: 'paid' | 'pro' | 'plus'): Promise<{ owner: OwnerProfile; plan: string }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/owner/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  return handle(res);
}

// --- Collaborator Management API ---

export async function listCollabUsers(): Promise<CollabUser[]> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/users`);
  const data = await handle<{ users: CollabUser[] }>(res);
  return data.users;
}

export async function createCollabUser(params: {
  email: string;
  pin: string;
  name?: string;
  permission?: 'viewer' | 'worker';
  allowed_workspaces?: string[];
  username?: string;
}): Promise<CreateUserResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle<CreateUserResponse>(res);
}

export async function updateCollabUser(usernameOrEmail: string, params: {
  name?: string;
  permission?: 'viewer' | 'worker';
  allowed_workspaces?: string[];
}): Promise<CollabUser> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/users/${encodeURIComponent(usernameOrEmail)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle<CollabUser>(res);
}

export async function changeCollabPin(usernameOrEmail: string, newPin: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/users/${encodeURIComponent(usernameOrEmail)}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_pin: newPin }),
  });
  return handle(res);
}

export async function revokeCollabUser(usernameOrEmail: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/users/${encodeURIComponent(usernameOrEmail)}/revoke`, {
    method: 'POST',
  });
  return handle(res);
}

export async function deleteCollabUser(usernameOrEmail: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/users/${encodeURIComponent(usernameOrEmail)}`, {
    method: 'DELETE',
  });
  return handle(res);
}

export async function generateCollabInvite(params: {
  email: string;
  pin?: string;
  send_email?: boolean;
  base_url?: string;
}): Promise<InviteResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle<InviteResponse>(res);
}

// --- Settings & SMTP ---

export async function getCollabSettings(): Promise<CollabSettings> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/settings`);
  return handle<CollabSettings>(res);
}

export async function updateCollabSettings(params: {
  lan_access?: boolean;
  log_on_desktop?: boolean;
}): Promise<CollabSettings> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle<CollabSettings>(res);
}

export async function updateSmtpSettings(params: SmtpConfig): Promise<CollabSettings> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/settings/smtp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle<CollabSettings>(res);
}

export async function testSmtpConnection(targetEmail: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/settings/smtp/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_email: targetEmail }),
  });
  return handle(res);
}

export async function getCollabPresence(): Promise<{ users: PresenceUser[] }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/presence`);
  return handle(res);
}

export async function getCollabAudit(username: string, workspaceId?: string, lines = 200): Promise<{ events: AuditEvent[] }> {
  const url = new URL(`${apiBase()}/api/collab/audit/${encodeURIComponent(username)}`);
  if (workspaceId) url.searchParams.set('workspace_id', workspaceId);
  url.searchParams.set('lines', String(lines));
  const res = await fetchWithTimeout(url.toString());
  return handle(res);
}

export async function getCollabAuditTxt(username: string, workspaceId: string, lines = 200): Promise<{ lines: string[] }> {
  const url = new URL(`${apiBase()}/api/collab/audit/${encodeURIComponent(username)}/txt`);
  url.searchParams.set('workspace_id', workspaceId);
  url.searchParams.set('lines', String(lines));
  const res = await fetchWithTimeout(url.toString());
  return handle(res);
}

// --- Remote API (requires token) ---

export async function collabLogin(params: {
  email?: string;
  username?: string;
  pin?: string;
  invite_code?: string;
}): Promise<LoginResponse> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handle<LoginResponse>(res);
}

export async function getCollabSession(token: string): Promise<{ user: CollabUser; owner: OwnerProfile | null }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/session`, {
    headers: authHeaders(token),
  });
  return handle(res);
}

export async function collabLogout(token: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/logout`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return handle(res);
}

export async function injectCollabCommand(token: string, tty: string, command: string, workspaceId?: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/terminals/${encodeURIComponent(tty)}/command`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ command, workspace_id: workspaceId }),
  });
  return handle(res);
}

export async function sendCollabInput(token: string, tty: string, data: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/terminals/${encodeURIComponent(tty)}/input`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function listCollabWorkspaces(token: string): Promise<{ allowed: string[]; all_workspaces: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/workspaces`, {
    headers: authHeaders(token),
  });
  return handle(res);
}
