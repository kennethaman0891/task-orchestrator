"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { buttonBase, buttonSize, buttonVariant, inputBase, cardStyle, scrollbarStyle } from '@/lib/theme';
import {
  ShieldCheck, ShieldAlert, Search, Download, FileText, Clock, Ban, LogOut,
  ChevronRight, X,
} from 'lucide-react';
import type { CollabUser, VisitRecord, VisitEvent } from '@/lib/collab';
import {
  listVisits, getVisit, endVisit, downloadVisitExport, revokeCollabUser,
  getCollabSettings, updateCollabSettings,
} from '@/lib/collab';

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All visits' },
  { value: 'active', label: 'Signed in now' },
  { value: 'ended', label: 'Finished visits' },
  { value: 'logout', label: 'Signed out' },
  { value: 'idle_timeout', label: 'Idle timeout' },
  { value: 'tab_close', label: 'Tab closed' },
  { value: 'revoked', label: 'Ended by you' },
  { value: 'failed', label: 'Failed sign-ins' },
];

function reasonLabel(reason?: string | null, status?: string): string {
  const labels: Record<string, string> = {
    logout: 'Signed out',
    idle_timeout: 'Idle timeout',
    tab_close: 'Tab closed',
    revoked: 'Ended by you',
    user_not_found: 'Unknown email',
    bad_pin: 'Wrong PIN',
    invalid_or_expired_invite: 'Invite not valid',
    rate_limited: 'Too many attempts',
    active: 'Signed in',
    failed: 'Sign-in failed',
    ended: 'Finished',
  };
  if (reason && labels[reason]) return labels[reason];
  if (status && labels[status]) return labels[status];
  return reason || status || '';
}

function formatWhen(ts?: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(seconds?: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function eventLabel(event: VisitEvent): string {
  const details = event.details || {};
  const summary = details.summary || details.command || details.description || details.task || details.message || details.reason || details.path || '';
  const names: Record<string, string> = {
    login: 'Signed in',
    logout: 'Signed out',
    visit_ended: 'Visit ended',
    workspace_open: 'Opened a workspace',
    terminal_open: 'Opened a terminal',
    command: 'Ran a command',
    workspace_change: 'Changed a workspace',
    message: 'Sent a message',
    orchestrator_started: 'Started an orchestrator task',
    orchestrator_outcome: 'Orchestrator task finished',
    qwen_task: 'Ran a Qwen task',
    task_started: 'Started a task',
    task_outcome: 'Task finished',
    agent_task: 'Started an agent task',
    denied: 'Action was denied',
    failed: 'Action failed',
    login_failed: 'Sign-in failed',
  };
  const base = names[event.type] || event.type.replace(/_/g, ' ');
  const extra = String(summary || '').replace(/\s+/g, ' ').trim();
  return extra ? `${base}: ${extra}` : base;
}

interface VisitorRecordsProps {
  users: CollabUser[];
  onChanged?: () => void;
}

export function VisitorRecords({ users, onChanged }: VisitorRecordsProps) {
  const { theme: t } = useTheme();
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [selected, setSelected] = useState<VisitRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [signinAlerts, setSigninAlerts] = useState(false);
  const [retentionDays, setRetentionDays] = useState(90);
  const [sessionHours, setSessionHours] = useState(168);
  const [idleMinutes, setIdleMinutes] = useState(30);

  const filters = useMemo(() => {
    const start = fromDate ? Math.floor(new Date(`${fromDate}T00:00:00`).getTime() / 1000) : undefined;
    const end = toDate ? Math.floor(new Date(`${toDate}T23:59:59`).getTime() / 1000) : undefined;
    return {
      q: query.trim() || undefined,
      person: person || undefined,
      status: status || undefined,
      start,
      end,
    };
  }, [query, person, status, fromDate, toDate]);

  const load = useCallback(async () => {
    try {
      const data = await listVisits(filters);
      setVisits(data.visits || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Could not load visitor records');
    }
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => { if (!cancelled) setLoading(false); });
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    getCollabSettings().then((settings) => {
      setSigninAlerts(!!settings.signin_alerts);
      setRetentionDays(settings.visit_retention_days ?? 90);
      setSessionHours(settings.session_hours ?? 168);
      setIdleMinutes(settings.idle_minutes ?? 30);
    }).catch(() => {});
  }, []);

  const openVisit = async (visit: VisitRecord) => {
    setSelected(visit);
    try {
      const data = await getVisit(visit.id);
      setSelected(data.visit);
    } catch (err: any) {
      setError(err.message || 'Could not open this visit');
    }
  };

  const saveSetting = async (patch: Parameters<typeof updateCollabSettings>[0]) => {
    try {
      const updated = await updateCollabSettings(patch);
      setSigninAlerts(!!updated.signin_alerts);
      setRetentionDays(updated.visit_retention_days ?? retentionDays);
      setSessionHours(updated.session_hours ?? sessionHours);
      setIdleMinutes(updated.idle_minutes ?? idleMinutes);
    } catch (err: any) {
      setError(err.message || 'Could not save that setting');
    }
  };

  const exportSet = async (format: 'csv' | 'html' | 'pdf', onlySelected = false) => {
    try {
      await downloadVisitExport(format, onlySelected && selected ? { id: selected.id } : filters);
    } catch (err: any) {
      setError(err.message || 'Export failed');
    }
  };

  const forceEnd = async (visit: VisitRecord) => {
    if (!confirm(`End ${visit.name || visit.email}'s session now? They will be signed out.`)) return;
    try {
      const res = await endVisit(visit.id);
      setSelected(res.visit);
      await load();
      onChanged?.();
    } catch (err: any) {
      setError(err.message || 'Could not end the session');
    }
  };

  const blockPerson = async (visit: VisitRecord) => {
    const who = visit.name || visit.email || visit.username;
    if (!confirm(`Block ${who}? They will be signed out and cannot sign in again until you invite them back.`)) return;
    try {
      await revokeCollabUser(visit.username || visit.email);
      await load();
      if (selected?.id === visit.id) {
        const data = await getVisit(visit.id);
        setSelected(data.visit);
      }
      onChanged?.();
    } catch (err: any) {
      setError(err.message || 'Could not block this person');
    }
  };

  const fieldStyle = {
    ...inputBase(t),
    ...buttonSize(t, 'sm'),
    padding: '6px 10px',
    fontSize: '12px',
    width: 'auto',
  };

  return (
    <div style={{ ...cardStyle(t), padding: 0, display: 'flex', flexDirection: 'column', boxShadow: t.shadow.sm }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        padding: '16px 20px', borderBottom: `1px solid ${t.colors.border.primary}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock style={{ width: 18, height: 18, color: t.colors.accent.primary }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Visitor Records</h3>
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
            background: t.colors.bg.tertiary, color: t.colors.text.secondary,
          }}>{visits.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => exportSet('csv')} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download style={{ width: 13, height: 13 }} /> CSV
          </button>
          <button onClick={() => exportSet('html')} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileText style={{ width: 13, height: 13 }} /> Report
          </button>
          <button onClick={() => exportSet('pdf')} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download style={{ width: 13, height: 13 }} /> PDF
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 20px', borderBottom: `1px solid ${t.colors.border.subtle}` }}>
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160 }}>
          <Search style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: t.colors.text.muted }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, or address"
            style={{ ...fieldStyle, width: '100%', paddingLeft: 30, boxSizing: 'border-box' }}
          />
        </div>
        <select value={person} onChange={(e) => setPerson(e.target.value)} style={fieldStyle}>
          <option value="">Anyone</option>
          {users.map((user) => (
            <option key={user.username} value={user.email || user.username}>
              {user.name || user.email || user.username}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={fieldStyle}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>{option.label}</option>
          ))}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={fieldStyle} aria-label="From date" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={fieldStyle} aria-label="To date" />
      </div>

      {error && (
        <div style={{ margin: '12px 20px 0', padding: '8px 12px', borderRadius: 8, background: t.colors.danger.primary + '18', color: t.colors.danger.primary, fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(280px, 0.9fr) minmax(320px, 1.2fr)' : '1fr', minHeight: 280 }}>
        <div style={{ maxHeight: 520, overflowY: 'auto', ...scrollbarStyle(t) }}>
          {visits.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: t.colors.text.muted }}>
              <h4 style={{ margin: '0 0 6px', color: t.colors.text.primary, fontSize: 15 }}>
                {loading ? 'Loading visits…' : 'No visits yet'}
              </h4>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>
                When someone you invited signs in, their visit, what they did, and when they left will show up here.
              </p>
            </div>
          ) : visits.map((visit) => {
            const active = visit.status === 'active';
            const failed = visit.status === 'failed';
            const open = selected?.id === visit.id;
            return (
              <button
                key={visit.id}
                onClick={() => openVisit(visit)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '12px 16px', border: 'none',
                  borderBottom: `1px solid ${t.colors.border.subtle}`,
                  background: open ? t.colors.bg.tertiary : 'transparent',
                  color: t.colors.text.primary, display: 'flex', gap: 12, alignItems: 'flex-start',
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                  background: active ? t.colors.success.primary : failed ? t.colors.danger.primary : t.colors.text.muted,
                }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <strong style={{ fontSize: 13 }}>{visit.name || visit.email || 'Unknown'}</strong>
                    <span style={{ fontSize: 11, color: t.colors.text.muted, whiteSpace: 'nowrap' }}>{reasonLabel(visit.end_reason, visit.status)}</span>
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: t.colors.text.muted, marginTop: 2 }}>
                    {visit.email} · {formatWhen(visit.signed_in_at)} · {formatDuration(visit.duration_seconds)}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: t.colors.text.secondary, marginTop: 4 }}>
                    {active ? (visit.current_activity || 'Signed in') : `${visit.browser || 'Unknown browser'} on ${visit.os || 'unknown system'}`}
                  </span>
                </span>
                {visit.verified === true && <ShieldCheck style={{ width: 14, height: 14, color: t.colors.success.primary, flexShrink: 0 }} />}
                {visit.verified === false && <ShieldAlert style={{ width: 14, height: 14, color: t.colors.danger.primary, flexShrink: 0 }} />}
                <ChevronRight style={{ width: 14, height: 14, color: t.colors.text.muted, flexShrink: 0 }} />
              </button>
            );
          })}
        </div>

        {selected && (
          <div style={{ borderLeft: `1px solid ${t.colors.border.primary}`, padding: '16px 18px', maxHeight: 520, overflowY: 'auto', ...scrollbarStyle(t) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: 16 }}>{selected.name || selected.email}</h4>
                <div style={{ fontSize: 12, color: t.colors.text.muted, marginTop: 4, lineHeight: 1.5 }}>
                  {selected.email}<br />
                  {selected.invite_code ? `Invite ${selected.invite_code.slice(0, 10)}…` : selected.status === 'failed' ? 'Sign-in did not succeed' : 'Signed in with email and PIN'}<br />
                  {selected.browser || 'Unknown browser'} on {selected.os || 'unknown system'} ({selected.device || 'device'})<br />
                  Address {selected.ip || 'unknown'}<br />
                  {formatWhen(selected.signed_in_at)}
                  {selected.signed_out_at ? ` → ${formatWhen(selected.signed_out_at)}` : ''} · {formatDuration(selected.duration_seconds)}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: 4 }} aria-label="Close visit">
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
              {selected.verified === true && (
                <span style={{ fontSize: 11, fontWeight: 700, color: t.colors.success.primary, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ShieldCheck style={{ width: 14, height: 14 }} /> Verified
                </span>
              )}
              {selected.verified === false && (
                <span style={{ fontSize: 11, fontWeight: 700, color: t.colors.danger.primary, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ShieldAlert style={{ width: 14, height: 14 }} /> {selected.verify_reason || 'Record check failed'}
                </span>
              )}
              <span style={{ fontSize: 11, color: t.colors.text.muted }}>{reasonLabel(selected.end_reason, selected.status)}</span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {selected.status === 'active' && (
                <button onClick={() => forceEnd(selected)} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <LogOut style={{ width: 13, height: 13 }} /> End session
                </button>
              )}
              {selected.kind !== 'attempt' && selected.status !== 'failed' && (
                <button onClick={() => blockPerson(selected)} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'danger'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Ban style={{ width: 13, height: 13 }} /> Block this person
                </button>
              )}
              <button onClick={() => exportSet('csv', true)} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost') }}>CSV</button>
              <button onClick={() => exportSet('html', true)} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost') }}>Report</button>
              <button onClick={() => exportSet('pdf', true)} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost') }}>PDF</button>
            </div>

            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(selected.events || []).length === 0 ? (
                <div style={{ fontSize: 12, color: t.colors.text.muted }}>No activity was recorded for this visit.</div>
              ) : (selected.events || []).map((event) => (
                <div key={`${event.id}-${event.ts}-${event.type}`} style={{
                  display: 'grid', gridTemplateColumns: '168px 1fr', gap: 10,
                  padding: '8px 10px', borderRadius: 8, background: t.colors.bg.secondary,
                  border: `1px solid ${t.colors.border.subtle}`, fontSize: 12,
                }}>
                  <span style={{ color: t.colors.text.muted, fontFamily: t.fontFamily.mono }}>{formatWhen(event.ts)}</span>
                  <span style={{ color: t.colors.text.primary, wordBreak: 'break-word' }}>
                    {eventLabel(event)}
                    {event.tty ? <span style={{ color: t.colors.text.muted }}> · {event.tty}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
        padding: '12px 20px', borderTop: `1px solid ${t.colors.border.primary}`,
        fontSize: 12, color: t.colors.text.secondary,
      }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={signinAlerts}
            onChange={(e) => {
              setSigninAlerts(e.target.checked);
              saveSetting({ signin_alerts: e.target.checked });
            }}
          />
          Email me when someone signs in
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Keep records
          <input
            type="number"
            min={0}
            max={3650}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            onBlur={() => saveSetting({ visit_retention_days: retentionDays })}
            style={{ ...fieldStyle, width: 72 }}
          />
          days
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Sign-in lasts
          <select
            value={sessionHours}
            onChange={(e) => {
              const hours = Number(e.target.value);
              setSessionHours(hours);
              saveSetting({ session_hours: hours });
            }}
            style={fieldStyle}
          >
            <option value={8}>8 hours</option>
            <option value={24}>1 day</option>
            <option value={168}>7 days</option>
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Idle sign-out
          <input
            type="number"
            min={1}
            max={1440}
            value={idleMinutes}
            onChange={(e) => setIdleMinutes(Number(e.target.value))}
            onBlur={() => saveSetting({ idle_minutes: idleMinutes })}
            style={{ ...fieldStyle, width: 72 }}
          />
          min
        </label>
      </div>
    </div>
  );
}
