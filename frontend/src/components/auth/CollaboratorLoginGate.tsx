"use client";

import { useState, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { buttonBase, buttonSize, buttonVariant, inputBase, cardStyle } from '@/lib/theme';
import { Users, Mail, Key, Sparkles, ArrowRight, AlertCircle, Shield } from 'lucide-react';
import { collabLogin, type LoginResponse } from '@/lib/collab';

interface CollaboratorLoginGateProps {
  onLoginSuccess: (resp: LoginResponse) => void;
}

export function CollaboratorLoginGate({ onLoginSuccess }: CollaboratorLoginGateProps) {
  const { theme: t } = useTheme();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check URL query parameters for invite link or prefilled email
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const urlEmail = params.get('email');
      const urlInvite = params.get('invite');
      if (urlEmail) setEmail(urlEmail);
      if (urlInvite) {
        setInviteCode(urlInvite);
        // Automatically attempt login with invite token if present!
        handleInviteLogin(urlInvite, urlEmail || '');
      }
    } catch {
      // Ignore query param parse failures
    }
  }, []);

  const handleInviteLogin = async (code: string, prefillEmail: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await collabLogin({ invite_code: code, email: prefillEmail });
      localStorage.setItem('tto_collab_token', resp.token);
      onLoginSuccess(resp);
    } catch (err: any) {
      setError(err.message || 'The invite link is invalid, expired, or has already been used.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }
    if (!pin.trim()) {
      setError('Please enter your access PIN');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await collabLogin({
        email: email.trim(),
        pin: pin.trim(),
        invite_code: inviteCode || undefined,
      });
      localStorage.setItem('tto_collab_token', resp.token);
      onLoginSuccess(resp);
    } catch (err: any) {
      setError(err.message || 'Invalid email or PIN. Please check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: t.colors.bg.primary,
        color: t.colors.text.primary,
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          ...cardStyle(t),
          padding: '36px 32px',
          boxShadow: t.shadow.xl,
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          boxSizing: 'border-box',
        }}
      >
        {/* Header Branding */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: t.colors.accent.primary + '18',
              border: `1px solid ${t.colors.accent.primary}33`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
            }}
          >
            <Users style={{ width: 28, height: 28, color: t.colors.accent.primary }} />
          </div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Task Orchestrator Colab
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: t.colors.text.muted, lineHeight: '1.4' }}>
            Log in with your collaborator account to access the host&apos;s workspaces and terminals.
          </p>
        </div>

        {/* Invite detected banner */}
        {inviteCode && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: t.colors.accent.primary + '15',
              border: `1px solid ${t.colors.accent.primary}30`,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: t.colors.accent.primary,
            }}
          >
            <Sparkles style={{ width: 16, height: 16, flexShrink: 0 }} />
            <span>Invite link detected. Click below to connect.</span>
          </div>
        )}

        {/* Error notice */}
        {error && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '8px',
              background: t.colors.danger.primary + '15',
              border: `1px solid ${t.colors.danger.primary}30`,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              fontSize: '12px',
              color: t.colors.danger.primary,
              lineHeight: '1.4',
            }}
          >
            <AlertCircle style={{ width: 16, height: 16, flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
              Collaborator Email
            </label>
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: t.colors.text.muted,
                }}
              >
                <Mail style={{ width: 16, height: 16 }} />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                style={{
                  ...inputBase(t),
                  width: '100%',
                  paddingLeft: '38px',
                  paddingRight: '12px',
                  height: '40px',
                  boxSizing: 'border-box',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
              Access PIN / Passcode
            </label>
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: t.colors.text.muted,
                }}
              >
                <Key style={{ width: 16, height: 16 }} />
              </div>
              <input
                type="password"
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••"
                style={{
                  ...inputBase(t),
                  width: '100%',
                  paddingLeft: '38px',
                  paddingRight: '12px',
                  height: '40px',
                  boxSizing: 'border-box',
                  fontSize: '13px',
                }}
              />
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: t.colors.text.muted }}>
              Provided by the Task Orchestrator host in your invitation.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              ...buttonBase(t),
              ...buttonSize(t, 'md'),
              ...buttonVariant(t, 'primary'),
              width: '100%',
              height: '42px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontWeight: 600,
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: '4px',
            }}
          >
            {loading ? (
              <span>Authenticating…</span>
            ) : (
              <>
                <span>Sign In to Workspaces</span>
                <ArrowRight style={{ width: 16, height: 16 }} />
              </>
            )}
          </button>
        </form>

        {/* Security Footer */}
        <div
          style={{
            borderTop: `1px solid ${t.colors.border.subtle}`,
            paddingTop: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontSize: '11px',
            color: t.colors.text.muted,
            textAlign: 'center',
          }}
        >
          <Shield style={{ width: 14, height: 14, color: t.colors.text.muted }} />
          <span>Local network session • Commands audited by host</span>
        </div>
      </div>
    </div>
  );
}
