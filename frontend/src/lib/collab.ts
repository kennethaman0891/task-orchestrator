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
  signin_alerts?: boolean;
  visit_retention_days?: number;
  session_hours?: number;
  idle_minutes?: number;
  smtp?: SmtpConfig;
}

export interface VisitEvent {
  id: number;
  visit_id: string;
  ts: number;
  type: string;
  details: Record<string, any>;
  workspace_id?: string | null;
  tty?: string | null;
}

export interface VisitRecord {
  id: string;
  username: string;
  email: string;
  name: string;
  invite_code?: string;
  auth_method?: string;
  ip: string;
  user_agent?: string;
  browser?: string;
  os?: string;
  device?: string;
  signed_in_at: number;
  last_seen_at?: number;
  signed_out_at?: number | null;
  end_reason?: string | null;
  status: string;
  token_prefix?: string;
  current_activity?: string;
  duration_seconds?: number;
  event_count?: number;
  verified?: boolean | null;
  verify_reason?: string;
  kind?: 'visit' | 'attempt';
  events?: VisitEvent[];
}

export interface AccessInfo {
  lan_access: boolean;
  port: number;
  localhost_url: string;
  lan_urls: string[];
  tunnel: {
    available: boolean;
    running: boolean;
    url: string | null;
    error: string | null;
  };
  signin_alerts?: boolean;
  visit_retention_days?: number;
  session_hours?: number;
  idle_minutes?: number;
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
  visit_id?: string | null;
  current_activity?: string;
  ip?: string;
  browser?: string;
  os?: string;
  device?: string;
  signed_in_at?: number | null;
  last_seen_at?: number | null;
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
  signin_alerts?: boolean;
  visit_retention_days?: number;
  session_hours?: number;
  idle_minutes?: number;
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

export interface VisitQuery {
  person?: string;
  q?: string;
  status?: string;
  start?: number;
  end?: number;
  id?: string;
}

function visitQuery(params: VisitQuery = {}): URLSearchParams {
  const url = new URLSearchParams();
  if (params.person) url.set('person', params.person);
  if (params.q) url.set('q', params.q);
  if (params.status) url.set('status', params.status);
  if (params.start) url.set('start', String(params.start));
  if (params.end) url.set('end', String(params.end));
  if (params.id) url.set('id', params.id);
  return url;
}

export async function listVisits(params: VisitQuery = {}): Promise<{ visits: VisitRecord[] }> {
  const url = new URL(`${apiBase()}/api/collab/visits`);
  visitQuery(params).forEach((value, key) => url.searchParams.set(key, value));
  const res = await fetchWithTimeout(url.toString());
  return handle(res);
}

export async function getVisit(visitId: string): Promise<{ visit: VisitRecord }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/visits/${encodeURIComponent(visitId)}`);
  return handle(res);
}

export async function endVisit(visitId: string): Promise<{ ok: boolean; visit: VisitRecord }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/visits/${encodeURIComponent(visitId)}/end`, {
    method: 'POST',
  });
  return handle(res);
}

export function visitExportUrl(format: 'csv' | 'html' | 'pdf', params: VisitQuery = {}): string {
  const url = new URL(`${apiBase()}/api/collab/visits/export`, window.location.origin);
  url.searchParams.set('format', format);
  visitQuery(params).forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
}

export async function downloadVisitExport(format: 'csv' | 'html' | 'pdf', params: VisitQuery = {}): Promise<void> {
  const res = await fetchWithTimeout(visitExportUrl(format, params), {}, 30000);
  if (!res.ok) {
    let msg = `Could not export (${res.status})`;
    try {
      const body = await res.json();
      if (body.detail) msg = typeof body.detail === 'string' ? body.detail : msg;
    } catch { /* keep msg */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const header = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(header);
  const filename = match?.[1] || `visitor-records.${format === 'html' ? 'html' : format}`;
  const objectUrl = URL.createObjectURL(blob);
  if (format === 'html') {
    window.open(objectUrl, '_blank', 'noopener');
    return;
  }
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function getCollabAccess(): Promise<AccessInfo> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/access`);
  return handle(res);
}

export async function setPublicTunnel(enabled: boolean): Promise<AccessInfo['tunnel']> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/tunnel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }, 30000);
  return handle(res);
}

export async function collabHeartbeat(token: string, activity?: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/heartbeat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(activity ? { activity } : {}),
  });
  return handle(res);
}

export async function listCollabWorkspaces(token: string): Promise<{ allowed: string[]; all_workspaces: boolean }> {
  const res = await fetchWithTimeout(`${apiBase()}/api/collab/workspaces`, {
    headers: authHeaders(token),
  });
  return handle(res);
}
