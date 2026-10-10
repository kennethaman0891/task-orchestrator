"use client";

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { buttonBase, buttonSize, buttonVariant, inputBase, cardStyle, scrollbarStyle } from '@/lib/theme';
import { 
  Users, UserPlus, UserMinus, Wifi, WifiOff, 
  Terminal, FileText, Eye, Key,
  Shield, X, Copy, Check, Activity, Radio, AlertCircle, CheckCircle2,
  Mail, Send, Share2, Settings, UserCheck, Sparkles, RefreshCw
} from 'lucide-react';
import type { 
  CollabUser, CollabSettings, PresenceUser, AuditEvent, OwnerProfile, SmtpConfig, CreateUserResponse
} from '@/lib/collab';
import {
  listCollabUsers, createCollabUser, updateCollabUser, changeCollabPin,
  revokeCollabUser, getCollabSettings, updateCollabSettings, updateSmtpSettings,
  testSmtpConnection, getCollabPresence, getCollabAudit, getOwnerProfile,
  setOwnerProfile, generateCollabInvite
} from '@/lib/collab';

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

interface CollabViewProps {
  workspaces: Array<{ id: string; name: string }>;
}

export function CollabView({ workspaces }: CollabViewProps) {
  const { theme: t } = useTheme();

  // Host Owner State
  const [owner, setOwner] = useState<OwnerProfile | null>(null);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [ownerForm, setOwnerForm] = useState({
    name: '',
    email: '',
    instance_name: '',
    tagline: '',
  });

  // Collaborators & Presence State
  const [users, setUsers] = useState<CollabUser[]>([]);
  const [settings, setSettings] = useState<CollabSettings>({ lan_access: false, log_on_desktop: true });
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditWorkspace, setAuditWorkspace] = useState<string>('');

  // Modals & UI Controls
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedInviteUrl, setCopiedInviteUrl] = useState(false);
  const [copiedInviteText, setCopiedInviteText] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSmtpModal, setShowSmtpModal] = useState(false);

  // Forms
  const [newUserForm, setNewUserForm] = useState({
    email: '',
    name: '',
    pin: '',
    confirmPin: '',
    permission: 'worker' as 'viewer' | 'worker',
    allowedWorkspaces: [] as string[],
  });

  const [activeInvite, setActiveInvite] = useState<{
    email: string;
    invite_url: string;
    subject: string;
    body: string;
  } | null>(null);

  const [smtpForm, setSmtpForm] = useState<SmtpConfig>({
    enabled: false,
    host: '',
    port: 587,
    username: '',
    password: '',
    use_tls: true,
    from_email: '',
    from_name: 'Task Orchestrator Colab',
  });
  const [testingSmtp, setTestingSmtp] = useState(false);

  const clearMessages = () => { setError(null); setSuccess(null); };

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Load Host Owner Profile
  const loadOwner = useCallback(async () => {
    try {
      const data = await getOwnerProfile();
      setOwner(data.owner);
      if (data.owner) {
        setOwnerForm({
          name: data.owner.name || '',
          email: data.owner.email || '',
          instance_name: data.owner.instance_name || '',
          tagline: data.owner.tagline || '',
        });
      }
    } catch (e: any) {
      console.warn('Failed to load owner profile:', e);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const data = await listCollabUsers();
      setUsers(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load collaborators');
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await getCollabSettings();
      setSettings(data);
      if (data.smtp) {
        setSmtpForm(data.smtp);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load settings');
    }
  }, []);

  const loadPresence = useCallback(async () => {
    try {
      const data = await getCollabPresence();
      setPresence(data.users);
    } catch {
      // Optional presence
    }
  }, []);

  useEffect(() => {
    loadOwner();
    loadUsers();
    loadSettings();
    loadPresence();
    const interval = setInterval(() => {
      loadUsers();
      loadPresence();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadOwner, loadUsers, loadSettings, loadPresence]);

  // Host Owner Save
  const handleSaveOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerForm.email.trim() || !ownerForm.name.trim()) {
      setError('Host Name and Email are required');
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const res = await setOwnerProfile(ownerForm);
      setOwner(res.owner);
      setSuccess('Host profile saved successfully');
      setShowOwnerModal(false);
    } catch (e: any) {
      setError(e.message || 'Failed to save host profile');
    } finally {
      setLoading(false);
    }
  };

  // Generate a random secure 6-digit PIN
  const handleGeneratePin = () => {
    const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
    setNewUserForm(prev => ({ ...prev, pin: randomPin, confirmPin: randomPin }));
  };

  // Create Collaborator
  const handleCreateUser = async () => {
    if (!newUserForm.email.trim()) {
      setError('Collaborator email is required');
      return;
    }
    if (!newUserForm.pin) {
      setError('Access PIN is required');
      return;
    }
    if (newUserForm.pin !== newUserForm.confirmPin) {
      setError('PINs do not match');
      return;
    }
    if (newUserForm.pin.length < 6) {
      setError('PIN must be at least 6 characters');
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const res: CreateUserResponse = await createCollabUser({
        email: newUserForm.email.trim(),
        name: newUserForm.name.trim(),
        pin: newUserForm.pin,
        permission: newUserForm.permission,
        allowed_workspaces: newUserForm.allowedWorkspaces,
      });

      setSuccess(`Collaborator "${newUserForm.email}" created`);
      setShowCreateModal(false);

      // Show the invitation dialog with magic link and email template
      setActiveInvite({
        email: newUserForm.email.trim(),
        invite_url: res.invite_url,
        subject: res.email_subject,
        body: res.email_body,
      });
      setShowInviteModal(true);

      setNewUserForm({
        email: '',
        name: '',
        pin: '',
        confirmPin: '',
        permission: 'worker',
        allowedWorkspaces: [],
      });
      loadUsers();
    } catch (e: any) {
      setError(e.message || 'Failed to create collaborator');
    } finally {
      setLoading(false);
    }
  };

  // Open invite for existing collaborator
  const handleOpenInvite = async (userEmail: string) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await generateCollabInvite({ email: userEmail });
      setActiveInvite({
        email: userEmail,
        invite_url: res.invite_url,
        subject: res.subject,
        body: res.body,
      });
      setShowInviteModal(true);
    } catch (e: any) {
      setError(e.message || 'Failed to generate invite');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (username: string, params: { permission?: 'viewer' | 'worker'; allowed_workspaces?: string[] }) => {
    clearMessages();
    setLoading(true);
    try {
      await updateCollabUser(username, params);
      setSuccess(`Updated permissions for "${username}"`);
      loadUsers();
    } catch (e: any) {
      setError(e.message || 'Failed to update collaborator');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePin = async (username: string, newPin: string) => {
    if (!newPin || newPin.length < 6) {
      setError('PIN must be at least 6 characters');
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      await changeCollabPin(username, newPin);
      setSuccess(`PIN updated for "${username}"`);
      loadUsers();
    } catch (e: any) {
      setError(e.message || 'Failed to change PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeUser = async (username: string) => {
    if (!confirm(`Revoke collaborator "${username}"? This invalidates their tokens immediately.`)) return;
    clearMessages();
    setLoading(true);
    try {
      await revokeCollabUser(username);
      setSuccess(`Collaborator "${username}" revoked`);
      loadUsers();
      loadPresence();
    } catch (e: any) {
      setError(e.message || 'Failed to revoke collaborator');
    } finally {
      setLoading(false);
    }
  };

  const handleSettingsChange = async (params: { lan_access?: boolean; log_on_desktop?: boolean }) => {
    clearMessages();
    setLoading(true);
    try {
      const newSettings = await updateCollabSettings(params);
      setSettings(newSettings);
      setSuccess('Settings saved');
      if (params.lan_access !== undefined && params.lan_access !== settings.lan_access) {
        try {
          if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('collab_restart_sidecar');
            setSuccess('Settings saved. Sidecar restarted with new LAN setting.');
          }
        } catch {
          setSuccess('Settings saved. Please restart app to apply network change.');
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      const updated = await updateSmtpSettings(smtpForm);
      setSettings(updated);
      setSuccess('SMTP email settings saved');
      setShowSmtpModal(false);
    } catch (e: any) {
      setError(e.message || 'Failed to save SMTP settings');
    } finally {
      setLoading(false);
    }
  };

  const handleTestSmtp = async () => {
    if (!owner?.email) {
      setError('Please set up your Host Email before testing SMTP');
      return;
    }
    setTestingSmtp(true);
    clearMessages();
    try {
      const res = await testSmtpConnection(owner.email);
      setSuccess(res.message || 'Test email dispatched successfully');
    } catch (e: any) {
      setError(e.message || 'SMTP test failed');
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleSelectUserAudit = async (username: string) => {
    setSelectedUser(username);
    setAuditWorkspace('');
    if (!username) {
      setAuditEvents([]);
      return;
    }
    setLoading(true);
    try {
      const data = await getCollabAudit(username);
      setAuditEvents(data.events);
    } catch (e: any) {
      setError(e.message || 'Failed to load audit');
    } finally {
      setLoading(false);
    }
  };

  const handleViewAudit = async (username: string) => {
    setSelectedUser(username);
    setAuditWorkspace('');
    setShowAuditModal(true);
    try {
      const data = await getCollabAudit(username);
      setAuditEvents(data.events);
    } catch (e: any) {
      setError(e.message || 'Failed to load audit');
    }
  };

  const handleViewWorkspaceAudit = async (username: string, workspaceId: string) => {
    setSelectedUser(username);
    setAuditWorkspace(workspaceId);
    try {
      const data = await getCollabAudit(username, workspaceId);
      setAuditEvents(data.events);
    } catch (e: any) {
      setError(e.message || 'Failed to load audit');
    }
  };

  const lanUrl = typeof window !== 'undefined' ? `http://${window.location.hostname || 'localhost'}:8765` : 'http://localhost:8765';

  const handleCopyUrl = async () => {
    if (!lanUrl) return;
    try {
      await navigator.clipboard.writeText(lanUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (err) {
      console.warn('Failed to copy URL:', err);
    }
  };

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: t.colors.bg.primary,
        color: t.colors.text.primary,
        padding: '28px 32px 56px',
        boxSizing: 'border-box',
        ...scrollbarStyle(t),
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: t.colors.accent.primary + '18',
                  border: `1px solid ${t.colors.accent.primary}33`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Users style={{ width: 22, height: 22, color: t.colors.accent.primary }} />
              </div>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>
                Colab Hub & Remote Access
              </h1>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: t.colors.text.muted, lineHeight: '1.5' }}>
              Manage your Host Account, invite collaborators via email, track live terminal presence, and review audit records.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => setShowCreateModal(true)}
              style={{
                ...buttonBase(t),
                ...buttonSize(t, 'md'),
                ...buttonVariant(t, 'primary'),
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
              }}
            >
              <UserPlus style={{ width: 16, height: 16 }} />
              Invite Collaborator
            </button>
          </div>
        </div>

        {/* Feedback Notices */}
        {error && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              background: t.colors.danger.primary + '15',
              border: `1px solid ${t.colors.danger.primary}40`,
              color: t.colors.danger.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertCircle style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        )}

        {success && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              background: t.colors.success.primary + '15',
              border: `1px solid ${t.colors.success.primary}40`,
              color: t.colors.success.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CheckCircle2 style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span>{success}</span>
            </div>
            <button
              onClick={() => setSuccess(null)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        )}

        {/* ── Host / Owner Master Account Banner ── */}
        {!owner ? (
          <div
            style={{
              ...cardStyle(t),
              padding: '24px 28px',
              background: `linear-gradient(135deg, ${t.colors.accent.primary}12, ${t.colors.bg.elevated})`,
              border: `1px solid ${t.colors.accent.primary}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: t.colors.accent.primary + '20',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles style={{ width: 24, height: 24, color: t.colors.accent.primary }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                  Set Up Your Host Account
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: t.colors.text.secondary, maxWidth: '600px' }}>
                  Register your host identity (Name & Email) so collaborators can identify your instance and receive personal invitations.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowOwnerModal(true)}
              style={{
                ...buttonBase(t),
                ...buttonSize(t, 'md'),
                ...buttonVariant(t, 'primary'),
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
              }}
            >
              <UserCheck style={{ width: 16, height: 16 }} />
              Create Host Account
            </button>
          </div>
        ) : (
          <div
            style={{
              ...cardStyle(t),
              padding: '20px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: t.colors.accent.primary + '20',
                  border: `1px solid ${t.colors.accent.primary}40`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: t.colors.accent.primary,
                  fontWeight: 700,
                  fontSize: '18px',
                }}
              >
                {owner.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                    {owner.name}
                  </h3>
                  <span
                    style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: t.colors.accent.primary + '20',
                      color: t.colors.accent.primary,
                    }}
                  >
                    Host & Owner
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', fontSize: '12px', color: t.colors.text.muted }}>
                  <span>{owner.email}</span>
                  <span>•</span>
                  <span>{owner.instance_name || "Host's Machine"}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setShowSmtpModal(true)}
                style={{
                  ...buttonBase(t),
                  ...buttonSize(t, 'sm'),
                  ...buttonVariant(t, 'ghost'),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                title="Configure Outgoing Mail Server"
              >
                <Mail style={{ width: 14, height: 14 }} />
                <span>Mail / SMTP Settings</span>
              </button>
              <button
                onClick={() => setShowOwnerModal(true)}
                style={{
                  ...buttonBase(t),
                  ...buttonSize(t, 'sm'),
                  ...buttonVariant(t, 'ghost'),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Settings style={{ width: 14, height: 14 }} />
                <span>Edit Profile</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Settings Grid (LAN & Desktop Logs) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: '18px',
          }}
        >
          {/* LAN Access Card */}
          <div
            style={{
              ...cardStyle(t),
              padding: '20px 22px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: '170px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: settings.lan_access ? t.colors.accent.primary + '20' : t.colors.bg.tertiary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {settings.lan_access ? (
                      <Wifi style={{ width: 20, height: 20, color: t.colors.accent.primary }} />
                    ) : (
                      <WifiOff style={{ width: 20, height: 20, color: t.colors.text.muted }} />
                    )}
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>LAN & Remote Access</h3>
                    <p style={{ margin: '3px 0 0', fontSize: '12px', color: t.colors.text.muted }}>
                      Allow remote collaborator browsers to log into this instance
                    </p>
                  </div>
                </div>
                <label
                  style={{
                    position: 'relative',
                    width: 48,
                    height: 26,
                    borderRadius: 13,
                    background: settings.lan_access ? t.colors.accent.primary : t.colors.border.primary,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'background 0.2s',
                    flexShrink: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={settings.lan_access}
                    onChange={(e) => handleSettingsChange({ lan_access: e.target.checked })}
                    disabled={loading}
                    style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: settings.lan_access ? 24 : 2,
                      top: 2,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'white',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
                      transition: 'left 0.2s',
                    }}
                  />
                </label>
              </div>
            </div>

            {settings.lan_access ? (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 14px',
                  background: t.colors.bg.tertiary,
                  borderRadius: '8px',
                  border: `1px solid ${t.colors.border.subtle}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <Radio style={{ width: 14, height: 14, color: t.colors.success.primary, flexShrink: 0 }} />
                  <code style={{ fontSize: '12px', color: t.colors.accent.primary, fontFamily: t.fontFamily.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lanUrl}
                  </code>
                </div>
                <button
                  onClick={handleCopyUrl}
                  style={{
                    ...buttonBase(t),
                    ...buttonSize(t, 'sm'),
                    ...buttonVariant(t, copiedUrl ? 'primary' : 'ghost'),
                    padding: '4px 8px',
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    flexShrink: 0,
                  }}
                  title="Copy LAN URL"
                >
                  {copiedUrl ? <Check style={{ width: 12, height: 12 }} /> : <Copy style={{ width: 12, height: 12 }} />}
                  {copiedUrl ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: t.colors.text.muted, marginTop: '8px' }}>
                LAN access is disabled. Collaborators cannot reach this instance over network.
              </div>
            )}
          </div>

          {/* Desktop Audit Log Card */}
          <div
            style={{
              ...cardStyle(t),
              padding: '20px 22px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: '170px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: settings.log_on_desktop ? t.colors.success.primary + '20' : t.colors.bg.tertiary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <FileText
                      style={{
                        width: 20,
                        height: 20,
                        color: settings.log_on_desktop ? t.colors.success.primary : t.colors.text.muted,
                      }}
                    />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Desktop Audit Logs</h3>
                    <p style={{ margin: '3px 0 0', fontSize: '12px', color: t.colors.text.muted }}>
                      Mirror commands & events to ~/Desktop/TTO-Collab-*.txt
                    </p>
                  </div>
                </div>
                <label
                  style={{
                    position: 'relative',
                    width: 48,
                    height: 26,
                    borderRadius: 13,
                    background: settings.log_on_desktop ? t.colors.success.primary : t.colors.border.primary,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'background 0.2s',
                    flexShrink: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={settings.log_on_desktop}
                    onChange={(e) => handleSettingsChange({ log_on_desktop: e.target.checked })}
                    disabled={loading}
                    style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: settings.log_on_desktop ? 24 : 2,
                      top: 2,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'white',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
                      transition: 'left 0.2s',
                    }}
                  />
                </label>
              </div>
            </div>

            <div
              style={{
                marginTop: '12px',
                padding: '10px 14px',
                background: t.colors.bg.tertiary,
                borderRadius: '8px',
                border: `1px solid ${t.colors.border.subtle}`,
                fontSize: '12px',
                color: t.colors.text.secondary,
              }}
            >
              Status:{' '}
              <strong style={{ color: settings.log_on_desktop ? t.colors.success.primary : t.colors.text.muted }}>
                {settings.log_on_desktop ? 'Logging Active' : 'Disabled'}
              </strong>{' '}
              — writes timestamped plaintext command records.
            </div>
          </div>
        </div>

        {/* ── Collaborators & Live Presence Grid ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
            gap: '20px',
          }}
        >
          {/* Collaborators Card */}
          <div
            style={{
              ...cardStyle(t),
              padding: 0,
              minHeight: '340px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: t.shadow.sm,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: `1px solid ${t.colors.border.primary}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users style={{ width: 18, height: 18, color: t.colors.accent.primary }} />
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Collaborators</h3>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: t.colors.bg.tertiary,
                    color: t.colors.text.secondary,
                    fontWeight: 600,
                  }}
                >
                  {users.length}
                </span>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                style={{
                  ...buttonBase(t),
                  ...buttonSize(t, 'sm'),
                  ...buttonVariant(t, 'ghost'),
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <UserPlus style={{ width: 14, height: 14 }} />
                Invite
              </button>
            </div>

            <div style={{ flex: 1, padding: '16px', overflowY: 'auto', ...scrollbarStyle(t) }}>
              {users.length === 0 ? (
                <div
                  style={{
                    padding: '48px 24px',
                    textAlign: 'center',
                    color: t.colors.text.muted,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '220px',
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: '50%',
                      background: t.colors.bg.tertiary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '14px',
                    }}
                  >
                    <Mail style={{ width: 28, height: 28, color: t.colors.text.muted, opacity: 0.8 }} />
                  </div>
                  <h4 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: t.colors.text.primary }}>
                    No collaborators invited yet
                  </h4>
                  <p style={{ margin: '0 0 18px', fontSize: '13px', maxWidth: '320px', lineHeight: '1.4' }}>
                    Invite team members via email with Worker or Viewer roles to collaborate on your workspaces.
                  </p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      ...buttonVariant(t, 'primary'),
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <UserPlus style={{ width: 14, height: 14 }} />
                    Invite First Collaborator
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {users.map((user) => {
                    const isOnline = presence.some((p) => p.username === user.username || (p.email && p.email === user.email));
                    const isWorker = user.permission === 'worker';
                    return (
                      <div
                        key={user.username}
                        style={{
                          padding: '12px 14px',
                          background: t.colors.bg.secondary,
                          borderRadius: '8px',
                          border: `1px solid ${t.colors.border.subtle}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 8,
                              background: isWorker ? t.colors.accent.primary + '20' : t.colors.warning.primary + '20',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {isWorker ? (
                              <Terminal style={{ width: 18, height: 18, color: t.colors.accent.primary }} />
                            ) : (
                              <Eye style={{ width: 18, height: 18, color: t.colors.warning.primary }} />
                            )}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {user.name || user.email || user.username}
                              </span>
                              <span
                                style={{
                                  fontSize: '10px',
                                  textTransform: 'uppercase',
                                  fontWeight: 700,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  background: isWorker ? t.colors.accent.primary + '20' : t.colors.warning.primary + '20',
                                  color: isWorker ? t.colors.accent.primary : t.colors.warning.primary,
                                }}
                              >
                                {user.permission}
                              </span>
                              {user.revoked && (
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    background: t.colors.danger.primary + '20',
                                    color: t.colors.danger.primary,
                                  }}
                                >
                                  Revoked
                                </span>
                              )}
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  background: isOnline ? t.colors.success.primary : t.colors.text.muted,
                                  boxShadow: isOnline ? `0 0 0 2px ${t.colors.success.primary}40` : 'none',
                                }}
                                title={isOnline ? 'Online' : 'Offline'}
                              />
                            </div>
                            <div style={{ fontSize: '11px', color: t.colors.text.muted, marginTop: '2px' }}>
                              <span style={{ marginRight: '8px' }}>{user.email || user.username}</span>
                              <span>•</span>
                              <span style={{ marginLeft: '8px' }}>
                                {user.allowed_workspaces.length === 0
                                  ? 'All workspaces'
                                  : user.allowed_workspaces
                                      .map((id) => {
                                        const ws = workspaces.find((w) => w.id === id);
                                        return ws ? ws.name : id;
                                      })
                                      .join(', ')}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => handleOpenInvite(user.email || user.username)}
                            style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: '6px 8px' }}
                            title="View / Copy Email Invite"
                          >
                            <Share2 style={{ width: 14, height: 14 }} />
                          </button>
                          <button
                            onClick={() => handleViewAudit(user.username)}
                            style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: '6px 8px' }}
                            title="Inspect Audit Log"
                          >
                            <FileText style={{ width: 14, height: 14 }} />
                          </button>
                          <button
                            onClick={() =>
                              handleUpdateUser(user.username, {
                                permission: user.permission === 'worker' ? 'viewer' : 'worker',
                              })
                            }
                            style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: '6px 8px' }}
                            title={user.permission === 'worker' ? 'Switch to Viewer (read-only)' : 'Switch to Worker (full access)'}
                          >
                            <Shield style={{ width: 14, height: 14 }} />
                          </button>
                          <button
                            onClick={() => {
                              const newPin = prompt('Enter new PIN (6+ chars):');
                              if (newPin) handleChangePin(user.username, newPin);
                            }}
                            style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost'), padding: '6px 8px' }}
                            title="Change PIN"
                          >
                            <Key style={{ width: 14, height: 14 }} />
                          </button>
                          <button
                            onClick={() => handleRevokeUser(user.username)}
                            style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'danger'), padding: '6px 8px' }}
                            title="Revoke access"
                          >
                            <UserMinus style={{ width: 14, height: 14 }} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Live Presence Card */}
          <div
            style={{
              ...cardStyle(t),
              padding: 0,
              minHeight: '340px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: t.shadow.sm,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: `1px solid ${t.colors.border.primary}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity style={{ width: 18, height: 18, color: t.colors.success.primary }} />
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Live Presence</h3>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: presence.length > 0 ? t.colors.success.primary + '20' : t.colors.bg.tertiary,
                    color: presence.length > 0 ? t.colors.success.primary : t.colors.text.secondary,
                    fontWeight: 600,
                  }}
                >
                  {presence.length} active
                </span>
              </div>
            </div>

            <div style={{ flex: 1, padding: '16px', overflowY: 'auto', ...scrollbarStyle(t) }}>
              {presence.length === 0 ? (
                <div
                  style={{
                    padding: '48px 24px',
                    textAlign: 'center',
                    color: t.colors.text.muted,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '220px',
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: '50%',
                      background: t.colors.bg.tertiary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '14px',
                    }}
                  >
                    <Activity style={{ width: 28, height: 28, color: t.colors.text.muted, opacity: 0.8 }} />
                  </div>
                  <h4 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: t.colors.text.primary }}>
                    No active remote sessions
                  </h4>
                  <p style={{ margin: 0, fontSize: '13px', maxWidth: '300px', lineHeight: '1.4' }}>
                    When collaborators log in with their email and access your terminals, their active status appears here in real time.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {presence.map((p) => (
                    <div
                      key={p.username + p.token_prefix}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '12px 14px',
                        background: t.colors.bg.secondary,
                        borderRadius: '8px',
                        border: `1px solid ${t.colors.border.subtle}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: t.colors.success.primary,
                            boxShadow: `0 0 0 2px ${t.colors.success.primary}40`,
                          }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '13px' }}>{p.name || p.username}</div>
                          <div style={{ fontSize: '11px', color: t.colors.text.muted }}>{p.email || p.username}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <code
                          style={{
                            fontSize: '11px',
                            color: t.colors.text.muted,
                            fontFamily: t.fontFamily.mono,
                            background: t.colors.bg.tertiary,
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {p.token_prefix}…
                        </code>
                        <span
                          style={{
                            fontSize: '11px',
                            textTransform: 'uppercase',
                            fontWeight: 600,
                            color: p.permission === 'worker' ? t.colors.accent.primary : t.colors.warning.primary,
                          }}
                        >
                          {p.permission}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Audit Log Section ── */}
        <div
          style={{
            ...cardStyle(t),
            padding: 0,
            minHeight: '340px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: t.shadow.sm,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: `1px solid ${t.colors.border.primary}`,
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText style={{ width: 18, height: 18, color: t.colors.accent.primary }} />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Audit Trail & Activity Stream</h3>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <select
                value={selectedUser || ''}
                onChange={(e) => handleSelectUserAudit(e.target.value)}
                style={{
                  ...inputBase(t),
                  ...buttonSize(t, 'sm'),
                  padding: '6px 12px',
                  minWidth: '160px',
                  fontSize: '12px',
                }}
              >
                <option value="">Select Collaborator…</option>
                {users.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.name ? `${u.name} (${u.email})` : u.email || u.username}
                  </option>
                ))}
              </select>

              {selectedUser && (
                <select
                  value={auditWorkspace}
                  onChange={(e) => handleViewWorkspaceAudit(selectedUser, e.target.value)}
                  style={{
                    ...inputBase(t),
                    ...buttonSize(t, 'sm'),
                    padding: '6px 12px',
                    minWidth: '160px',
                    fontSize: '12px',
                  }}
                >
                  <option value="">All Workspaces</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column' }}>
            {selectedUser ? (
              <div
                style={{
                  flex: 1,
                  maxHeight: '360px',
                  overflowY: 'auto',
                  fontSize: '12px',
                  fontFamily: t.fontFamily.mono,
                  background: t.colors.bg.secondary,
                  borderRadius: '8px',
                  border: `1px solid ${t.colors.border.subtle}`,
                  padding: '12px',
                  ...scrollbarStyle(t),
                }}
              >
                {auditEvents.length === 0 ? (
                  <div style={{ color: t.colors.text.muted, textAlign: 'center', padding: '40px' }}>
                    No audit events recorded for <strong>{selectedUser}</strong>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {auditEvents
                      .slice()
                      .reverse()
                      .map((event, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '8px 12px',
                            background: t.colors.bg.tertiary,
                            borderRadius: '6px',
                            border: `1px solid ${t.colors.border.subtle}`,
                            fontSize: '12px',
                            fontFamily: t.fontFamily.mono,
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'flex-start',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ color: t.colors.text.muted, whiteSpace: 'nowrap', minWidth: '70px' }}>
                            {formatDate(event.ts)}
                          </span>
                          <span
                            style={{
                              color: t.colors.accent.primary,
                              whiteSpace: 'nowrap',
                              fontWeight: 600,
                              minWidth: '90px',
                            }}
                          >
                            {event.type}
                          </span>
                          <span style={{ flex: 1, color: t.colors.text.primary, wordBreak: 'break-word', minWidth: '180px' }}>
                            {JSON.stringify(event.details)}
                          </span>
                          {event.ws && (
                            <span style={{ color: t.colors.text.muted, fontSize: '11px', background: t.colors.bg.primary, padding: '1px 6px', borderRadius: '4px' }}>
                              ws: {event.ws}
                            </span>
                          )}
                          {event.tty && (
                            <span style={{ color: t.colors.text.muted, fontSize: '11px', background: t.colors.bg.primary, padding: '1px 6px', borderRadius: '4px' }}>
                              tty: {event.tty}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  color: t.colors.text.muted,
                  textAlign: 'center',
                  padding: '48px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FileText style={{ width: 32, height: 32, opacity: 0.4, marginBottom: '10px' }} />
                <p style={{ margin: 0, fontSize: '13px' }}>
                  Select a collaborator above to inspect real-time command events and logs.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Host / Owner Master Account Modal ── */}
      {showOwnerModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }} onClick={() => setShowOwnerModal(false)}>
          <div style={{ background: t.colors.bg.primary, borderRadius: '12px', padding: '28px', width: '100%', maxWidth: 480, border: `1px solid ${t.colors.border.primary}`, boxShadow: t.shadow.xl }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <UserCheck style={{ width: 22, height: 22, color: t.colors.accent.primary }} />
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Host Account Setup</h2>
              </div>
              <button onClick={() => setShowOwnerModal(false)} style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer' }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <form onSubmit={handleSaveOwner} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Your Name</label>
                <input
                  required
                  value={ownerForm.name}
                  onChange={e => setOwnerForm({ ...ownerForm, name: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '10px 12px', boxSizing: 'border-box' }}
                  placeholder="e.g. Kenneth Aman"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Your Host Email</label>
                <input
                  type="email"
                  required
                  value={ownerForm.email}
                  onChange={e => setOwnerForm({ ...ownerForm, email: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '10px 12px', boxSizing: 'border-box' }}
                  placeholder="kenneth@example.com"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Instance / Machine Name</label>
                <input
                  value={ownerForm.instance_name}
                  onChange={e => setOwnerForm({ ...ownerForm, instance_name: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '10px 12px', boxSizing: 'border-box' }}
                  placeholder="e.g. Kenneth's Engineering Hub"
                />
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: t.colors.text.muted }}>Shown to remote collaborators when they connect.</p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowOwnerModal(false)} style={{ ...buttonBase(t), ...buttonSize(t, 'md'), ...buttonVariant(t, 'ghost') }}>
                  Cancel
                </button>
                <button type="submit" disabled={loading} style={{ ...buttonBase(t), ...buttonSize(t, 'md'), ...buttonVariant(t, 'primary') }}>
                  {loading ? 'Saving…' : 'Save Host Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Add Collaborator Modal ── */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }} onClick={() => setShowCreateModal(false)}>
          <div style={{ background: t.colors.bg.primary, borderRadius: '12px', padding: '28px', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${t.colors.border.primary}`, boxShadow: t.shadow.xl }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <UserPlus style={{ width: 22, height: 22, color: t.colors.accent.primary }} />
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Invite Collaborator</h2>
              </div>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer' }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Collaborator Email Address</label>
                <input
                  type="email"
                  required
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '10px 12px', boxSizing: 'border-box' }}
                  placeholder="colleague@company.com"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Display Name (Optional)</label>
                <input
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '10px 12px', boxSizing: 'border-box' }}
                  placeholder="e.g. Sarah Chen"
                />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>Access PIN / Passcode</label>
                  <button
                    type="button"
                    onClick={handleGeneratePin}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: t.colors.accent.primary,
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: 0,
                    }}
                  >
                    <RefreshCw style={{ width: 12, height: 12 }} />
                    Auto-Generate PIN
                  </button>
                </div>
                <input
                  type="text"
                  value={newUserForm.pin}
                  onChange={(e) => setNewUserForm({ ...newUserForm, pin: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '10px 12px', boxSizing: 'border-box' }}
                  placeholder="6+ characters (e.g. 849201)"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Confirm PIN</label>
                <input
                  type="text"
                  value={newUserForm.confirmPin}
                  onChange={(e) => setNewUserForm({ ...newUserForm, confirmPin: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '10px 12px', boxSizing: 'border-box' }}
                  placeholder="••••••"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Permission Level</label>
                <select
                  value={newUserForm.permission}
                  onChange={(e) => setNewUserForm({ ...newUserForm, permission: e.target.value as 'viewer' | 'worker' })}
                  style={{ ...inputBase(t), width: '100%', padding: '10px 12px', boxSizing: 'border-box' }}
                >
                  <option value="worker">Worker — Full access (can execute terminal commands and run tasks)</option>
                  <option value="viewer">Viewer — Read-only access (can observe terminal output only)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>Allowed Workspaces</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {workspaces.map(ws => (
                    <label key={ws.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', background: newUserForm.allowedWorkspaces.includes(ws.id) ? t.colors.accent.primary + '20' : t.colors.bg.secondary, border: `1px solid ${newUserForm.allowedWorkspaces.includes(ws.id) ? t.colors.accent.primary : t.colors.border.primary}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                      <input
                        type="checkbox"
                        checked={newUserForm.allowedWorkspaces.includes(ws.id)}
                        onChange={(e) => setNewUserForm({
                          ...newUserForm,
                          allowedWorkspaces: e.target.checked
                            ? [...newUserForm.allowedWorkspaces, ws.id]
                            : newUserForm.allowedWorkspaces.filter(id => id !== ws.id)
                        })}
                      />
                      {ws.name}
                    </label>
                  ))}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: t.colors.text.muted }}>Leave unchecked to allow all workspaces.</p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button onClick={() => setShowCreateModal(false)} style={{ ...buttonBase(t), ...buttonSize(t, 'md'), ...buttonVariant(t, 'ghost') }}>
                  Cancel
                </button>
                <button onClick={handleCreateUser} disabled={loading} style={{ ...buttonBase(t), ...buttonSize(t, 'md'), ...buttonVariant(t, 'primary') }}>
                  {loading ? 'Creating…' : 'Create & Generate Invite'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Sharing Dialog ── */}
      {showInviteModal && activeInvite && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }} onClick={() => setShowInviteModal(false)}>
          <div style={{ background: t.colors.bg.primary, borderRadius: '12px', padding: '28px', width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${t.colors.border.primary}`, boxShadow: t.shadow.xl }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Share2 style={{ width: 22, height: 22, color: t.colors.accent.primary }} />
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Invitation for {activeInvite.email}</h2>
              </div>
              <button onClick={() => setShowInviteModal(false)} style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer' }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: '13px', color: t.colors.text.secondary }}>
              Share this invite link or email template with your collaborator to grant them access to your instance.
            </p>

            {/* Direct Magic Link */}
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                Direct Magic Login Link (One-Click)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  readOnly
                  value={activeInvite.invite_url}
                  style={{ ...inputBase(t), flex: 1, padding: '8px 12px', fontSize: '12px', fontFamily: t.fontFamily.mono }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(activeInvite.invite_url);
                    setCopiedInviteUrl(true);
                    setTimeout(() => setCopiedInviteUrl(false), 2000);
                  }}
                  style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, copiedInviteUrl ? 'primary' : 'ghost'), display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {copiedInviteUrl ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
                  <span>{copiedInviteUrl ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Pre-Formatted Email Template */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Formatted Email Invitation</label>
                <button
                  type="button"
                  onClick={async () => {
                    const fullText = `Subject: ${activeInvite.subject}\n\n${activeInvite.body}`;
                    await navigator.clipboard.writeText(fullText);
                    setCopiedInviteText(true);
                    setTimeout(() => setCopiedInviteText(false), 2000);
                  }}
                  style={{ background: 'transparent', border: 'none', color: t.colors.accent.primary, fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {copiedInviteText ? <Check style={{ width: 12, height: 12 }} /> : <Copy style={{ width: 12, height: 12 }} />}
                  <span>{copiedInviteText ? 'Copied Email' : 'Copy Full Email'}</span>
                </button>
              </div>
              <textarea
                readOnly
                rows={8}
                value={`Subject: ${activeInvite.subject}\n\n${activeInvite.body}`}
                style={{
                  ...inputBase(t),
                  width: '100%',
                  padding: '10px 12px',
                  boxSizing: 'border-box',
                  fontSize: '12px',
                  fontFamily: t.fontFamily.mono,
                  resize: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
              {settings.smtp?.enabled ? (
                <button
                  type="button"
                  onClick={async () => {
                    setLoading(true);
                    clearMessages();
                    try {
                      const res = await generateCollabInvite({ email: activeInvite.email, send_email: true });
                      setSuccess(res.send_status || 'Email dispatched via SMTP');
                    } catch (e: any) {
                      setError(e.message || 'SMTP dispatch failed');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  style={{ ...buttonBase(t), ...buttonSize(t, 'md'), ...buttonVariant(t, 'ghost'), display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Send style={{ width: 14, height: 14 }} />
                  <span>Send via SMTP</span>
                </button>
              ) : (
                <div style={{ fontSize: '11px', color: t.colors.text.muted }}>
                  Paste into Apple Mail, Gmail, or Slack.
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                style={{ ...buttonBase(t), ...buttonSize(t, 'md'), ...buttonVariant(t, 'primary') }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SMTP Configuration Modal ── */}
      {showSmtpModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }} onClick={() => setShowSmtpModal(false)}>
          <div style={{ background: t.colors.bg.primary, borderRadius: '12px', padding: '28px', width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${t.colors.border.primary}`, boxShadow: t.shadow.xl }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Mail style={{ width: 22, height: 22, color: t.colors.accent.primary }} />
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>SMTP Mailer Settings</h2>
              </div>
              <button onClick={() => setShowSmtpModal(false)} style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer' }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            <form onSubmit={handleSaveSmtp} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={smtpForm.enabled}
                  onChange={e => setSmtpForm({ ...smtpForm, enabled: e.target.checked })}
                />
                <span style={{ fontWeight: 600 }}>Enable Direct Outgoing Email Delivery</span>
              </label>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>SMTP Host</label>
                <input
                  value={smtpForm.host}
                  onChange={e => setSmtpForm({ ...smtpForm, host: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '8px 12px', boxSizing: 'border-box' }}
                  placeholder="smtp.gmail.com or smtp.sendgrid.net"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Port</label>
                  <input
                    type="number"
                    value={smtpForm.port}
                    onChange={e => setSmtpForm({ ...smtpForm, port: parseInt(e.target.value) || 587 })}
                    style={{ ...inputBase(t), width: '100%', padding: '8px 12px', boxSizing: 'border-box' }}
                    placeholder="587"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Security</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', height: '36px' }}>
                    <input
                      type="checkbox"
                      checked={smtpForm.use_tls}
                      onChange={e => setSmtpForm({ ...smtpForm, use_tls: e.target.checked })}
                    />
                    <span>STARTTLS</span>
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Username / API Key</label>
                <input
                  value={smtpForm.username}
                  onChange={e => setSmtpForm({ ...smtpForm, username: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '8px 12px', boxSizing: 'border-box' }}
                  placeholder="user@example.com"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Password / App Password</label>
                <input
                  type="password"
                  value={smtpForm.password}
                  onChange={e => setSmtpForm({ ...smtpForm, password: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '8px 12px', boxSizing: 'border-box' }}
                  placeholder="••••••••••••"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Sender From Email</label>
                <input
                  type="email"
                  value={smtpForm.from_email}
                  onChange={e => setSmtpForm({ ...smtpForm, from_email: e.target.value })}
                  style={{ ...inputBase(t), width: '100%', padding: '8px 12px', boxSizing: 'border-box' }}
                  placeholder="colab@company.com"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={handleTestSmtp}
                  disabled={testingSmtp}
                  style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost') }}
                >
                  {testingSmtp ? 'Sending Ping…' : 'Send Test Ping to Host Email'}
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => setShowSmtpModal(false)} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost') }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={loading} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'primary') }}>
                    Save SMTP
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Audit Modal ── */}
      {showAuditModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }} onClick={() => setShowAuditModal(false)}>
          <div style={{ background: t.colors.bg.primary, borderRadius: '12px', padding: '24px', width: '90vw', maxWidth: 800, maxHeight: '90vh', overflow: 'auto', border: `1px solid ${t.colors.border.primary}`, boxShadow: t.shadow.xl }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Audit Log for {selectedUser}</h2>
              <button onClick={() => setShowAuditModal(false)} style={{ ...buttonBase(t), ...buttonSize(t, 'sm'), ...buttonVariant(t, 'ghost') }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>
            {auditEvents.length === 0 ? (
              <p style={{ color: t.colors.text.muted, textAlign: 'center', padding: '40px' }}>No audit events recorded.</p>
            ) : (
              <div style={{ fontSize: '12px', fontFamily: t.fontFamily.mono, background: t.colors.bg.secondary, borderRadius: '8px', border: `1px solid ${t.colors.border.primary}` }}>
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {auditEvents.slice().reverse().map((event, idx) => (
                    <div key={idx} style={{ padding: '8px 12px', background: t.colors.bg.secondary, borderRadius: '6px', border: `1px solid ${t.colors.border.primary}`, fontSize: '12px', fontFamily: t.fontFamily.mono, display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <span style={{ color: t.colors.text.muted, whiteSpace: 'nowrap', minWidth: '70px' }}>{formatDate(event.ts)}</span>
                      <span style={{ color: t.colors.accent.primary, whiteSpace: 'nowrap', minWidth: '100px' }}>{event.type}</span>
                      <span style={{ flex: 1, color: t.colors.text.primary, wordBreak: 'break-word' }}>{JSON.stringify(event.details)}</span>
                      {event.ws && <span style={{ color: t.colors.text.muted, fontSize: '11px' }}>ws: {event.ws}</span>}
                      {event.tty && <span style={{ color: t.colors.text.muted, fontSize: '11px' }}>tty: {event.tty}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
