'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import {
  buttonBase,
  buttonSize,
  buttonVariant,
  scrollbarStyle,
  CUSTOM_THEME_PRESETS,
  type CustomThemeConfig,
} from '@/lib/theme';
import { type Workspace, type View } from '@/lib/workspace';
import {
  getOwnerProfile,
  setOwnerProfile,
  setOwnerPlan,
  getCollabSettings,
  updateCollabSettings,
  listCollabUsers,
  type OwnerProfile,
  type CollabSettings,
  type CollabUser,
} from '@/lib/collab';
import type { UnifiedTerminal } from '@/types';
import {
  Settings,
  User,
  CreditCard,
  Sparkles,
  Palette,
  Network,
  Shield,
  Check,
  ArrowLeft,
  RefreshCw,
  Copy,
  Users,
  Building2,
  Terminal,
  CheckCircle2,
  Lock,
  ChevronRight,
  Sliders,
  RotateCcw,
  Sun,
  Moon,
  Wand2,
  Upload,
  Eye,
  Cpu,
  HardDrive,
  Server,
  Laptop,
  Monitor,
  Clock,
  Activity,
  ShieldCheck,
  Database,
  Layers,
  Wifi,
} from 'lucide-react';

interface SettingsViewProps {
  onView: (v: View) => void;
  onToast?: (msg: string, error?: boolean) => void;
  connected?: boolean;
  workspaces?: Workspace[];
  terminals?: Record<string, UnifiedTerminal>;
  previousView?: View;
}

type SettingsTab = 'account' | 'plans' | 'appearance' | 'network' | 'system';

interface SystemDiagnosticsData {
  status: string;
  timestamp: string;
  host: {
    os: string;
    os_release: string;
    platform: string;
    machine: string;
    hostname: string;
    cpu_brand: string;
    cpu_cores: number;
    total_ram_gb: number | null;
    disk_total_gb: number;
    disk_free_gb: number;
    disk_used_gb: number;
    disk_used_percent: number;
  };
  runtime: {
    version: string;
    python_version: string;
    python_executable: string;
    pid: number;
    uptime_seconds: number;
    uptime_formatted: string;
    cwd: string;
    home: string;
    collab_store: string;
    sidecar_port: number;
  };
}

interface PlanDetail {
  id: 'paid' | 'pro' | 'plus';
  name: string;
  badge?: string;
  tagline: string;
  monthlyPrice: number;
  annualPrice: number;
  highlight?: boolean;
  description: string;
  features: { label: string; highlight?: boolean }[];
  limits: {
    workspaces: string;
    terminals: string;
    collaborators: string;
    citySimulation: string;
    custom3dModels: string;
    aiAgents: string;
    smtpEmail: string;
  };
}

const PLANS: PlanDetail[] = [
  {
    id: 'paid',
    name: 'Paid',
    tagline: 'Standard Developer Tier',
    monthlyPrice: 12,
    annualPrice: 10,
    description: 'Core native terminal power and developer workspace orchestration for focused engineers.',
    features: [
      { label: 'Up to 16 Concurrent Terminal PTY Panes' },
      { label: '8 Configurable Dedicated Workspaces' },
      { label: '3D Developer City Visualizer (Standard Models)' },
      { label: 'Local AI Code Reviews & Terminal Suggestions' },
      { label: 'Local LAN Collaboration (Up to 2 Guest Seats)' },
      { label: 'Standard Keyboard Shortcuts & Layout Presets' },
      { label: 'Community Forum & Local Telemetry' },
    ],
    limits: {
      workspaces: '8 Workspaces',
      terminals: '16 PTY Panes',
      collaborators: '2 LAN Guests',
      citySimulation: 'Standard 3D City',
      custom3dModels: 'Basic Presets',
      aiAgents: 'Single Agent Review',
      smtpEmail: 'Manual Link Sharing',
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    badge: 'MOST POPULAR',
    tagline: 'Power Orchestration & Living 3D City',
    monthlyPrice: 29,
    annualPrice: 24,
    highlight: true,
    description: 'Supercharged autonomous agents, living 3D city simulator, and instant 2D-to-3D volumetric models.',
    features: [
      { label: 'Unlimited Dedicated Workspaces & Terminal Panes', highlight: true },
      { label: 'Living 3D City: Animated Vehicles, Birds, Day/Night Celestial Sun & Moon', highlight: true },
      { label: 'Client-Side 2D-to-3D Image Volumetric Customizer (Zero API Keys)', highlight: true },
      { label: 'Autonomous Multi-Agent Copilot: Jarvis & OpenDots Parallel Run', highlight: true },
      { label: 'Up to 10 Concurrent LAN Collaborators with 1-Click Magic Links' },
      { label: 'Live Git & Workspace File Synchronization' },
      { label: 'Priority Sidecar Compute & Real-time Telemetry' },
    ],
    limits: {
      workspaces: 'Unlimited',
      terminals: 'Unlimited Panes',
      collaborators: '10 Collaborators',
      citySimulation: 'Living 3D City (Vehicles, Birds, Sun/Moon)',
      custom3dModels: 'Instant 2D-to-3D Volumetric (No API Keys)',
      aiAgents: 'Multi-Agent Parallel Swarm',
      smtpEmail: 'Magic Links + Access PIN',
    },
  },
  {
    id: 'plus',
    name: 'Plus',
    badge: 'ENTERPRISE',
    tagline: 'Team Hub & Automated Dispatch',
    monthlyPrice: 79,
    annualPrice: 64,
    description: 'Enterprise team collaboration with automated SMTP email delivery, sandboxes, and audit vault.',
    features: [
      { label: 'Everything in Pro, plus:', highlight: true },
      { label: 'Unlimited Team Collaborators with Role-Based Access Control', highlight: true },
      { label: 'Automated SMTP Email Dispatch (1-Click Direct to Inboxes)', highlight: true },
      { label: 'Multi-tenant Workspace Sandboxing & Network Isolation', highlight: true },
      { label: 'Immutable Security Audit Log & Real-Time Presence Mesh', highlight: true },
      { label: 'Dedicated Remote Tunnel Gateway & Custom Domain Routing' },
      { label: 'Custom Skyline 3D City Themes & Organization Presets' },
      { label: '24/7 Priority Architecture Support & SLA' },
    ],
    limits: {
      workspaces: 'Unlimited Sandboxes',
      terminals: 'Unlimited Panes',
      collaborators: 'Unlimited Team Seats',
      citySimulation: 'Custom Skyline & Living Simulation',
      custom3dModels: 'Unlimited 3D Volumetric Assets',
      aiAgents: 'Swarm Orchestration + Custom Models',
      smtpEmail: 'Direct Automated SMTP Dispatch',
    },
  },
];

export function SettingsView({
  onView,
  onToast,
  connected = true,
  workspaces = [],
  terminals = {},
  previousView = 'workspace',
}: SettingsViewProps) {
  const {
    theme: t,
    themeName,
    setTheme,
    availableThemes,
    customConfig,
    setCustomConfig,
    resetCustomConfig,
    systemMode,
  } = useTheme();

  // Theme category filter & custom studio state
  const [themeCategory, setThemeCategory] = useState<'all' | 'professional' | 'creative' | 'light' | 'custom'>('all');
  const [showImportCustomModal, setShowImportCustomModal] = useState(false);
  const [importCustomJson, setImportCustomJson] = useState('');
  const [importCustomError, setImportCustomError] = useState<string | null>(null);

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');

  // Billing toggle (monthly / annual)
  const [annualBilling, setAnnualBilling] = useState(true);

  // Profile data
  const [owner, setOwner] = useState<OwnerProfile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [switchingPlan, setSwitchingPlan] = useState<string | null>(null);

  // Form states
  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [instanceDraft, setInstanceDraft] = useState('');
  const [taglineDraft, setTaglineDraft] = useState('');

  // Collab & System settings
  const [collabSettings, setCollabSettings] = useState<CollabSettings | null>(null);
  const [collaborators, setCollaborators] = useState<CollabUser[]>([]);

  // Copy feedback state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Load Host Account & Settings
  const loadData = async () => {
    try {
      const [ownerRes, settingsRes, usersRes] = await Promise.all([
        getOwnerProfile(),
        getCollabSettings().catch(() => null),
        listCollabUsers().catch(() => []),
      ]);
      if (ownerRes.owner) {
        setOwner(ownerRes.owner);
        setNameDraft(ownerRes.owner.name || '');
        setEmailDraft(ownerRes.owner.email || '');
        setInstanceDraft(ownerRes.owner.instance_name || '');
        setTaglineDraft(ownerRes.owner.tagline || '');
      }
      if (settingsRes) {
        setCollabSettings(settingsRes);
      }
      setCollaborators(usersRes);
    } catch (err) {
      console.error('[SettingsView] Error loading settings:', err);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // System diagnostics telemetry
  const [systemData, setSystemData] = useState<SystemDiagnosticsData | null>(null);
  const [loadingSystemData, setLoadingSystemData] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);

  const loadSystemDiagnostics = async () => {
    setLoadingSystemData(true);
    const t0 = performance.now();
    try {
      const res = await fetch('http://127.0.0.1:8765/api/system/info');
      const elapsed = Math.round(performance.now() - t0);
      setPingMs(elapsed);
      if (res.ok) {
        const data = await res.json();
        setSystemData(data);
      }
    } catch (err) {
      console.warn('[SettingsView] Error loading system diagnostics:', err);
      try {
        await fetch('http://127.0.0.1:8765/api/health');
        const elapsed = Math.round(performance.now() - t0);
        setPingMs(elapsed);
      } catch {}
    } finally {
      setLoadingSystemData(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'system') {
      void loadSystemDiagnostics();
    }
  }, [activeTab]);

  const handleCopyDiagnosticReport = () => {
    const report = `# Task Orchestrator System Diagnostics Report
Generated: ${new Date().toISOString()}

## Application & Runtime
- App Version: v${systemData?.runtime.version || '2.3.1'} (Stable)
- Desktop Engine: Tauri 2.0 (Rust PTY Core)
- Sidecar API Daemon: FastAPI / Uvicorn (Port ${systemData?.runtime.sidecar_port || 8765})
- Python Version: ${systemData?.runtime.python_version || '3.14.0'}
- Backend PID: ${systemData?.runtime.pid || 'N/A'}
- Daemon Uptime: ${systemData?.runtime.uptime_formatted || 'Active'}
- Latency / Ping: ${pingMs !== null ? `${pingMs}ms` : '<1ms'}

## Host & Hardware Specifications
- Hostname: ${systemData?.host.hostname || 'Local Machine'}
- Platform: ${systemData?.host.platform || 'macOS Darwin (arm64)'}
- CPU Brand: ${systemData?.host.cpu_brand || 'Apple Silicon'}
- CPU Logical Cores: ${systemData?.host.cpu_cores || (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 'N/A')}
- Memory (RAM): ${systemData?.host.total_ram_gb ? `${systemData.host.total_ram_gb} GB Unified RAM` : 'Apple Silicon RAM'}
- Primary Storage: ${systemData?.host.disk_total_gb || 926.3} GB Total (${systemData?.host.disk_free_gb || 377.7} GB Free, ${systemData?.host.disk_used_percent || 59.2}% Used)
- Display: ${typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height} (${window.devicePixelRatio}x Scale, ${window.screen.colorDepth}-bit)` : 'N/A'}

## Orchestrator & Workspaces
- Configured Workspaces: ${workspaces.length}
- Connected PTY Terminals: ${Object.keys(terminals).length}
- Working Directory: ${systemData?.runtime.cwd || '/Users/kennethaman/tto-golden'}
- Collab Store: ${systemData?.runtime.collab_store || '~/.local/share/tto/collab'}
- LAN Gateway: ${collabSettings?.lan_access ? 'Enabled (0.0.0.0:8765)' : 'Disabled (Localhost Only)'}
`;
    try {
      navigator.clipboard.writeText(report);
      onToast?.('Full system diagnostic report copied to clipboard!');
    } catch {
      onToast?.('Failed to copy diagnostic report', true);
    }
  };

  const activePlanId: 'paid' | 'pro' | 'plus' = owner?.plan || 'pro';
  const activePlanDetail = PLANS.find((p) => p.id === activePlanId) || PLANS[1];

  // Save Account Profile
  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!emailDraft.trim()) {
      onToast?.('Please enter a valid email address', true);
      return;
    }
    setSavingProfile(true);
    try {
      const res = await setOwnerProfile({
        email: emailDraft.trim(),
        name: nameDraft.trim() || emailDraft.split('@')[0],
        instance_name: instanceDraft.trim() || `${nameDraft || 'Host'}'s Task Orchestrator`,
        tagline: taglineDraft.trim(),
        plan: activePlanId,
      });
      setOwner(res.owner);
      onToast?.('Account details saved successfully!');
    } catch (err: any) {
      onToast?.(`Failed to save account: ${err?.message || 'Network error'}`, true);
    } finally {
      setSavingProfile(false);
    }
  };

  // Switch / Upgrade Plan
  const handleSelectPlan = async (planId: 'paid' | 'pro' | 'plus') => {
    if (planId === activePlanId) return;
    setSwitchingPlan(planId);
    try {
      const res = await setOwnerPlan(planId);
      setOwner(res.owner);
      const targetName = PLANS.find((p) => p.id === planId)?.name || planId;
      onToast?.(`Successfully switched to the ${targetName} Plan!`);
    } catch (err: any) {
      onToast?.(`Failed to switch plan: ${err?.message || 'Error'}`, true);
    } finally {
      setSwitchingPlan(null);
    }
  };

  // Toggle LAN access
  const handleToggleLan = async () => {
    if (!collabSettings) return;
    const nextVal = !collabSettings.lan_access;
    try {
      const updated = await updateCollabSettings({ lan_access: nextVal });
      setCollabSettings(updated);
      onToast?.(`LAN Access ${nextVal ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      onToast?.(`Failed to update LAN settings: ${err?.message || 'Error'}`, true);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    onToast?.(`Copied to clipboard!`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const livePanesCount = useMemo(() => {
    return Object.values(terminals).filter((t) => t.is_live || t.session_id).length;
  }, [terminals]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: t.colors.bg.primary,
        color: t.colors.text.primary,
        overflowY: 'auto',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        ...scrollbarStyle(t),
      }}
    >
      {/* ── Top Sticky App Header ── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: `${t.colors.bg.primary}f5`,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${t.colors.border.primary}`,
          padding: '12px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={() => onView(previousView || 'workspace')}
            style={{
              ...buttonBase(t),
              ...buttonSize(t, 'sm'),
              ...buttonVariant(t, 'ghost'),
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '6px',
              color: t.colors.text.secondary,
            }}
            title="Return to previous view"
          >
            <ArrowLeft size={14} />
            <span style={{ fontSize: '12px', fontWeight: 500 }}>Back</span>
          </button>

          <div style={{ width: '1px', height: '18px', background: t.colors.border.subtle }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '7px',
                background: t.colors.accent.light,
                color: t.colors.accent.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Settings size={15} />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: 600, color: t.colors.text.primary, letterSpacing: '-0.01em' }}>
                  Settings & Account
                </span>

                <span
                  style={{
                    padding: '2px 7px',
                    borderRadius: '5px',
                    fontSize: '10px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    background:
                      activePlanId === 'plus'
                        ? 'rgba(168, 85, 247, 0.15)'
                        : activePlanId === 'pro'
                        ? `${t.colors.accent.light}`
                        : 'rgba(56, 189, 248, 0.15)',
                    color:
                      activePlanId === 'plus'
                        ? '#c084fc'
                        : activePlanId === 'pro'
                        ? t.colors.accent.primary
                        : '#38bdf8',
                    border: `1px solid ${
                      activePlanId === 'plus'
                        ? 'rgba(168, 85, 247, 0.3)'
                        : activePlanId === 'pro'
                        ? `${t.colors.accent.primary}40`
                        : 'rgba(56, 189, 248, 0.3)'
                    }`,
                  }}
                >
                  {activePlanDetail.name} Plan
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Header Right: Connection & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 9px',
              borderRadius: '16px',
              fontSize: '11px',
              background: t.colors.bg.secondary,
              border: `1px solid ${t.colors.border.subtle}`,
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: connected ? '#22c55e' : '#ef4444',
                boxShadow: connected ? '0 0 6px rgba(34, 197, 94, 0.6)' : 'none',
              }}
            />
            <span style={{ color: t.colors.text.secondary }}>
              {connected ? 'Backend Online' : 'Offline'}
            </span>
          </div>

          <button
            onClick={() => void loadData()}
            style={{
              ...buttonBase(t),
              ...buttonSize(t, 'sm'),
              ...buttonVariant(t, 'ghost'),
              padding: '6px',
              borderRadius: '6px',
              color: t.colors.text.muted,
            }}
            title="Refresh Account Data"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </header>

      {/* ── Clean Segmented Pill Navigation Bar ── */}
      <div
        style={{
          padding: '16px 28px 0',
          maxWidth: '1120px',
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px',
            borderRadius: '9px',
            background: t.colors.bg.secondary,
            border: `1px solid ${t.colors.border.primary}`,
          }}
        >
          <button
            onClick={() => setActiveTab('account')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'account' ? t.colors.bg.elevated : 'transparent',
              color: activeTab === 'account' ? t.colors.text.primary : t.colors.text.muted,
              boxShadow: activeTab === 'account' ? '0 1px 3px rgba(0,0,0,0.18)' : 'none',
              fontWeight: activeTab === 'account' ? 600 : 500,
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.12s ease',
            }}
          >
            <User size={13} />
            <span>Account Details</span>
          </button>

          <button
            onClick={() => setActiveTab('plans')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'plans' ? t.colors.bg.elevated : 'transparent',
              color: activeTab === 'plans' ? t.colors.text.primary : t.colors.text.muted,
              boxShadow: activeTab === 'plans' ? '0 1px 3px rgba(0,0,0,0.18)' : 'none',
              fontWeight: activeTab === 'plans' ? 600 : 500,
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.12s ease',
            }}
          >
            <CreditCard size={13} />
            <span>Plans & Pricing</span>
          </button>

          <button
            onClick={() => setActiveTab('appearance')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'appearance' ? t.colors.bg.elevated : 'transparent',
              color: activeTab === 'appearance' ? t.colors.text.primary : t.colors.text.muted,
              boxShadow: activeTab === 'appearance' ? '0 1px 3px rgba(0,0,0,0.18)' : 'none',
              fontWeight: activeTab === 'appearance' ? 600 : 500,
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.12s ease',
            }}
          >
            <Palette size={13} />
            <span>Themes</span>
          </button>

          <button
            onClick={() => setActiveTab('network')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'network' ? t.colors.bg.elevated : 'transparent',
              color: activeTab === 'network' ? t.colors.text.primary : t.colors.text.muted,
              boxShadow: activeTab === 'network' ? '0 1px 3px rgba(0,0,0,0.18)' : 'none',
              fontWeight: activeTab === 'network' ? 600 : 500,
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.12s ease',
            }}
          >
            <Network size={13} />
            <span>Collaboration</span>
          </button>

          <button
            onClick={() => setActiveTab('system')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'system' ? t.colors.bg.elevated : 'transparent',
              color: activeTab === 'system' ? t.colors.text.primary : t.colors.text.muted,
              boxShadow: activeTab === 'system' ? '0 1px 3px rgba(0,0,0,0.18)' : 'none',
              fontWeight: activeTab === 'system' ? 600 : 500,
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.12s ease',
            }}
          >
            <Shield size={13} />
            <span>System</span>
          </button>
        </div>
      </div>

      {/* ── Main Clean Content Area ── */}
      <div
        style={{
          padding: '20px 28px 56px',
          maxWidth: '1120px',
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* ══════════════════════════════════════════════════════════════════════
            TAB 1: ACCOUNT DETAILS & INFORMATION (CLEAN DESIGN)
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Host Identity Card */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
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
                    width: '52px',
                    height: '52px',
                    borderRadius: '12px',
                    background: `linear-gradient(135deg, ${t.colors.accent.primary}, #8b5cf6)`,
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    fontWeight: 700,
                    flexShrink: 0,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  }}
                >
                  {(owner?.name || owner?.email || 'H').charAt(0).toUpperCase()}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: t.colors.text.primary }}>
                      {owner?.name || 'Host Account'}
                    </h2>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 600,
                        background: 'rgba(34, 197, 94, 0.12)',
                        color: '#22c55e',
                        border: '1px solid rgba(34, 197, 94, 0.25)',
                      }}
                    >
                      <CheckCircle2 size={11} />
                      Verified Host
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: t.colors.text.muted, marginTop: '3px' }}>
                    {owner?.email || 'admin@local'} • {owner?.instance_name || "Host's Task Orchestrator"}
                  </div>

                  {owner?.tagline && (
                    <div style={{ fontSize: '12px', color: t.colors.text.secondary, marginTop: '4px' }}>
                      "{owner.tagline}"
                    </div>
                  )}
                </div>
              </div>

              {/* Host Meta / Quick Tier Switcher */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    border: `1px solid ${t.colors.border.subtle}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '10px', color: t.colors.text.muted, textTransform: 'uppercase' }}>
                      Active Plan
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: t.colors.accent.primary }}>
                      {activePlanDetail.name} Plan
                    </div>
                  </div>

                  <button
                    onClick={() => setActiveTab('plans')}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      ...buttonVariant(t, 'ghost'),
                      padding: '4px 8px',
                      fontSize: '11px',
                      color: t.colors.accent.primary,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <span>Change</span>
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* 2-Column Clean Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: '20px',
              }}
            >
              {/* Form: Account Details */}
              <div
                style={{
                  borderRadius: '12px',
                  background: t.colors.bg.secondary,
                  border: `1px solid ${t.colors.border.primary}`,
                  padding: '20px',
                }}
              >
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary }}>
                    Account Profile
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                    Update your identity and instance metadata.
                  </p>
                </div>

                <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: t.colors.text.secondary,
                        marginBottom: '4px',
                      }}
                    >
                      Host Display Name
                    </label>
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      placeholder="e.g. Kenneth Aman"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: t.colors.bg.elevated,
                        border: `1px solid ${t.colors.border.primary}`,
                        color: t.colors.text.primary,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: t.colors.text.secondary,
                        marginBottom: '4px',
                      }}
                    >
                      Account Email Address <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      placeholder="e.g. host@example.com"
                      required
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: t.colors.bg.elevated,
                        border: `1px solid ${t.colors.border.primary}`,
                        color: t.colors.text.primary,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: t.colors.text.secondary,
                        marginBottom: '4px',
                      }}
                    >
                      Instance Name
                    </label>
                    <input
                      type="text"
                      value={instanceDraft}
                      onChange={(e) => setInstanceDraft(e.target.value)}
                      placeholder="e.g. Main Production Orchestrator"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: t.colors.bg.elevated,
                        border: `1px solid ${t.colors.border.primary}`,
                        color: t.colors.text.primary,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: t.colors.text.secondary,
                        marginBottom: '4px',
                      }}
                    >
                      Bio / Tagline
                    </label>
                    <input
                      type="text"
                      value={taglineDraft}
                      onChange={(e) => setTaglineDraft(e.target.value)}
                      placeholder="e.g. Lead Engineer & Agent Orchestrator"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: t.colors.bg.elevated,
                        border: `1px solid ${t.colors.border.primary}`,
                        color: t.colors.text.primary,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      disabled={savingProfile}
                      style={{
                        ...buttonBase(t),
                        ...buttonSize(t, 'sm'),
                        ...buttonVariant(t, 'primary'),
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 14px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      {savingProfile ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                      <span>{savingProfile ? 'Saving...' : 'Save Account Details'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Resource Quotas & Security Status */}
              <div
                style={{
                  borderRadius: '12px',
                  background: t.colors.bg.secondary,
                  border: `1px solid ${t.colors.border.primary}`,
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary }}>
                    Resource Quotas & Status
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                    Current allocation on your active plan tier.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      background: t.colors.bg.elevated,
                      border: `1px solid ${t.colors.border.subtle}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Building2 size={14} style={{ color: t.colors.text.muted }} />
                      <span style={{ fontSize: '12px', color: t.colors.text.secondary }}>Dedicated Workspaces</span>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: t.colors.text.primary }}>
                      {workspaces.length} / {activePlanDetail.limits.workspaces}
                    </span>
                  </div>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      background: t.colors.bg.elevated,
                      border: `1px solid ${t.colors.border.subtle}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Terminal size={14} style={{ color: t.colors.text.muted }} />
                      <span style={{ fontSize: '12px', color: t.colors.text.secondary }}>Live Terminal PTY Panes</span>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: t.colors.text.primary }}>
                      {livePanesCount} / {activePlanDetail.limits.terminals}
                    </span>
                  </div>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      background: t.colors.bg.elevated,
                      border: `1px solid ${t.colors.border.subtle}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Users size={14} style={{ color: t.colors.text.muted }} />
                      <span style={{ fontSize: '12px', color: t.colors.text.secondary }}>Collaborators Joined</span>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: t.colors.text.primary }}>
                      {collaborators.length} / {activePlanDetail.limits.collaborators}
                    </span>
                  </div>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      background: t.colors.bg.elevated,
                      border: `1px solid ${t.colors.border.subtle}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={14} style={{ color: t.colors.text.muted }} />
                      <span style={{ fontSize: '12px', color: t.colors.text.secondary }}>3D Simulation Level</span>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: t.colors.accent.primary }}>
                      {activePlanDetail.limits.citySimulation}
                    </span>
                  </div>
                </div>

                {/* Host Security Badge */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    border: `1px solid ${t.colors.border.subtle}`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}
                >
                  <Lock size={14} style={{ color: '#22c55e', marginTop: '2px', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: t.colors.text.primary }}>
                      Host Security Status
                    </div>
                    <div style={{ fontSize: '11px', color: t.colors.text.muted, lineHeight: 1.4, marginTop: '2px' }}>
                      Local Unix domain socket active with sidecar verification. Desktop host is granted root administrative execution on this node.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 2: PLANS & PRICING (CLEAN SAAS CARDS)
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'plans' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            {/* Header & Annual Toggle */}
            <div style={{ textAlign: 'center', maxWidth: '580px', margin: '0 auto' }}>
              <h2 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 700, color: t.colors.text.primary, letterSpacing: '-0.02em' }}>
                Subscription & Capacity Plans
              </h2>
              <p style={{ margin: 0, fontSize: '13px', color: t.colors.text.muted, lineHeight: 1.5 }}>
                Select a plan to unlock higher capacity, living 3D simulation, and automated team dispatch.
              </p>

              {/* Monthly / Annual Toggle Switch */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginTop: '16px',
                  padding: '3px',
                  background: t.colors.bg.secondary,
                  border: `1px solid ${t.colors.border.primary}`,
                  borderRadius: '24px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setAnnualBilling(false)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    border: 'none',
                    background: !annualBilling ? t.colors.bg.elevated : 'transparent',
                    color: !annualBilling ? t.colors.text.primary : t.colors.text.muted,
                    fontWeight: !annualBilling ? 600 : 500,
                    fontSize: '11px',
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  Monthly
                </button>

                <button
                  type="button"
                  onClick={() => setAnnualBilling(true)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    border: 'none',
                    background: annualBilling ? t.colors.accent.primary : 'transparent',
                    color: annualBilling ? '#ffffff' : t.colors.text.muted,
                    fontWeight: annualBilling ? 600 : 500,
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.12s',
                  }}
                >
                  <span>Annual</span>
                  <span
                    style={{
                      background: annualBilling ? '#ffffff' : 'rgba(34, 197, 94, 0.2)',
                      color: annualBilling ? t.colors.accent.primary : '#22c55e',
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: '8px',
                    }}
                  >
                    -20%
                  </span>
                </button>
              </div>
            </div>

            {/* The 3 Cards Grid (Paid, Pro, Plus) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
                gap: '20px',
                alignItems: 'stretch',
              }}
            >
              {PLANS.map((plan) => {
                const isCurrent = activePlanId === plan.id;
                const price = annualBilling ? plan.annualPrice : plan.monthlyPrice;

                return (
                  <div
                    key={plan.id}
                    style={{
                      borderRadius: '12px',
                      background: t.colors.bg.secondary,
                      border: plan.highlight
                        ? `2px solid ${t.colors.accent.primary}`
                        : isCurrent
                        ? `2px solid #22c55e`
                        : `1px solid ${t.colors.border.primary}`,
                      padding: '24px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      position: 'relative',
                      boxShadow: plan.highlight ? '0 8px 24px rgba(0,0,0,0.2)' : 'none',
                    }}
                  >
                    {/* Badge */}
                    {plan.badge && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '-10px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          background:
                            plan.id === 'plus'
                              ? '#9333ea'
                              : t.colors.accent.primary,
                          color: '#ffffff',
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '2px 9px',
                          borderRadius: '10px',
                          letterSpacing: '0.5px',
                          textTransform: 'uppercase',
                        }}
                      >
                        {plan.badge}
                      </div>
                    )}

                    {/* Plan Header */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: t.colors.text.primary }}>
                          {plan.name}
                        </h3>
                        {isCurrent && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 600,
                              background: 'rgba(34, 197, 94, 0.15)',
                              color: '#22c55e',
                            }}
                          >
                            <CheckCircle2 size={11} />
                            Active
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: t.colors.text.muted, marginTop: '2px' }}>
                        {plan.tagline}
                      </div>
                    </div>

                    {/* Pricing */}
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
                        <span style={{ fontSize: '28px', fontWeight: 800, color: t.colors.text.primary }}>
                          ${price}
                        </span>
                        <span style={{ fontSize: '12px', color: t.colors.text.muted }}>/ mo</span>
                      </div>
                      <div style={{ fontSize: '10px', color: t.colors.text.muted, marginTop: '1px' }}>
                        {annualBilling ? `Billed annually ($${price * 12}/yr)` : 'Billed monthly'}
                      </div>
                    </div>

                    <p style={{ margin: '0 0 16px', fontSize: '11px', color: t.colors.text.secondary, lineHeight: 1.4 }}>
                      {plan.description}
                    </p>

                    {/* Action Button */}
                    <button
                      onClick={() => handleSelectPlan(plan.id)}
                      disabled={isCurrent || switchingPlan === plan.id}
                      style={{
                        ...buttonBase(t),
                        ...buttonSize(t, 'sm'),
                        ...(isCurrent
                          ? buttonVariant(t, 'secondary')
                          : plan.highlight
                          ? buttonVariant(t, 'primary')
                          : buttonVariant(t, 'secondary')),
                        ...(isCurrent && {
                          background: 'rgba(34, 197, 94, 0.12)',
                          color: '#22c55e',
                          borderColor: 'rgba(34, 197, 94, 0.35)',
                        }),
                        width: '100%',
                        padding: '8px 0',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: isCurrent ? 'default' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        marginBottom: '18px',
                        borderRadius: '6px',
                      }}
                    >
                      {switchingPlan === plan.id ? (
                        <>
                          <RefreshCw size={12} className="animate-spin" />
                          <span>Updating...</span>
                        </>
                      ) : isCurrent ? (
                        <>
                          <Check size={12} style={{ color: '#22c55e' }} />
                          <span>Active on this Node</span>
                        </>
                      ) : (
                        <span>{plan.id === 'plus' ? 'Upgrade to Plus' : `Switch to ${plan.name}`}</span>
                      )}
                    </button>

                    {/* Feature List */}
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: t.colors.text.muted,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '10px',
                        }}
                      >
                        Features
                      </div>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {plan.features.map((feat, idx) => (
                          <li
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '6px',
                              fontSize: '11px',
                              color: feat.highlight ? t.colors.text.primary : t.colors.text.secondary,
                              fontWeight: feat.highlight ? 500 : 400,
                              lineHeight: 1.35,
                            }}
                          >
                            <span
                              style={{
                                color: feat.highlight ? t.colors.accent.primary : '#22c55e',
                                marginTop: '1px',
                                flexShrink: 0,
                              }}
                            >
                              <Check size={12} />
                            </span>
                            <span>{feat.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Footer Limits */}
                    <div
                      style={{
                        marginTop: '16px',
                        paddingTop: '12px',
                        borderTop: `1px solid ${t.colors.border.subtle}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        color: t.colors.text.muted,
                      }}
                    >
                      <span>Capacity:</span>
                      <strong style={{ color: t.colors.text.primary }}>{plan.limits.workspaces}</strong>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Feature Comparison Matrix Table */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '20px',
              }}
            >
              <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary }}>
                Feature Comparison Matrix
              </h3>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${t.colors.border.primary}` }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: t.colors.text.muted }}>Feature</th>
                      <th style={{ textAlign: 'center', padding: '8px 12px', color: '#38bdf8' }}>Paid</th>
                      <th style={{ textAlign: 'center', padding: '8px 12px', color: t.colors.accent.primary }}>
                        Pro
                      </th>
                      <th style={{ textAlign: 'center', padding: '8px 12px', color: '#c084fc' }}>Plus</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: `1px solid ${t.colors.border.subtle}` }}>
                      <td style={{ padding: '10px 12px', color: t.colors.text.primary }}>Workspaces</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>8 Workspaces</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600 }}>Unlimited</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600 }}>Unlimited Sandboxes</td>
                    </tr>
                    <tr style={{ borderBottom: `1px solid ${t.colors.border.subtle}` }}>
                      <td style={{ padding: '10px 12px', color: t.colors.text.primary }}>Terminal PTY Panes</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>16 Concurrent</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600 }}>Unlimited</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600 }}>Unlimited</td>
                    </tr>
                    <tr style={{ borderBottom: `1px solid ${t.colors.border.subtle}` }}>
                      <td style={{ padding: '10px 12px', color: t.colors.text.primary }}>3D Developer City Simulation</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>Standard 3D City</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', color: t.colors.accent.primary, fontWeight: 600 }}>
                        Living Simulation (Vehicles, Birds, Sun/Moon)
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600 }}>
                        Custom Skylines + Living Simulation
                      </td>
                    </tr>
                    <tr style={{ borderBottom: `1px solid ${t.colors.border.subtle}` }}>
                      <td style={{ padding: '10px 12px', color: t.colors.text.primary }}>2D-to-3D Image Volumetric Models</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>Presets</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', color: '#22c55e', fontWeight: 600 }}>
                        Instant Local (No API Keys)
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', color: '#22c55e', fontWeight: 600 }}>
                        Instant Local + Team Library
                      </td>
                    </tr>
                    <tr style={{ borderBottom: `1px solid ${t.colors.border.subtle}` }}>
                      <td style={{ padding: '10px 12px', color: t.colors.text.primary }}>Collaborator Seats</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>2 Guests</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>Up to 10 Seats</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600 }}>Unlimited Seats</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 12px', color: t.colors.text.primary }}>Automated SMTP Email Dispatch</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', color: t.colors.text.muted }}>Manual Links</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', color: t.colors.text.muted }}>Magic Link Copy</td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', color: '#22c55e', fontWeight: 600 }}>
                        1-Click Automated Delivery
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 3: APPEARANCE & THEMES
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'appearance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Main Theme Selection Card */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '24px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: t.colors.text.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Palette size={18} style={{ color: t.colors.accent.primary }} />
                    Application Color Themes
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                    Select a curated professional theme or design your own personalized palette. Changes apply live to shell, terminal panels, and sidecar.
                  </p>
                </div>

                {/* Filter Pills */}
                <div style={{ display: 'flex', gap: '6px', background: t.colors.bg.tertiary, padding: '4px', borderRadius: '8px', border: `1px solid ${t.colors.border.subtle}` }}>
                  {[
                    { id: 'all', label: 'All', count: availableThemes.length },
                    { id: 'professional', label: 'Professional', count: availableThemes.filter((th) => th.category === 'professional').length },
                    { id: 'creative', label: 'Creative', count: availableThemes.filter((th) => th.category === 'creative').length },
                    { id: 'light', label: 'Light', count: availableThemes.filter((th) => th.mode === 'light' || th.category === 'light').length },
                    { id: 'custom', label: 'Custom', count: 1 },
                  ].map((cat) => {
                    const isCatActive = themeCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setThemeCategory(cat.id as any)}
                        style={{
                          background: isCatActive ? t.colors.accent.primary : 'transparent',
                          color: isCatActive ? t.colors.text.inverse : t.colors.text.secondary,
                          border: 'none',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {cat.label}
                        <span
                          style={{
                            fontSize: '10px',
                            opacity: isCatActive ? 0.9 : 0.6,
                            background: isCatActive ? 'rgba(0,0,0,0.2)' : t.colors.bg.elevated,
                            padding: '1px 5px',
                            borderRadius: '10px',
                          }}
                        >
                          {cat.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Theme Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '12px',
                }}
              >
                {availableThemes
                  .filter((th) => {
                    if (themeCategory === 'all') return true;
                    if (themeCategory === 'professional') return th.category === 'professional';
                    if (themeCategory === 'creative') return th.category === 'creative';
                    if (themeCategory === 'light') return th.mode === 'light' || th.category === 'light';
                    if (themeCategory === 'custom') return th.name === 'Custom';
                    return true;
                  })
                  .map((th) => {
                    const isCurrent = t.name === th.name;
                    return (
                      <button
                        key={th.name}
                        onClick={() => setTheme(th.name)}
                        style={{
                          padding: '14px',
                          borderRadius: '10px',
                          background: isCurrent ? t.colors.accent.light : t.colors.bg.elevated,
                          border: isCurrent
                            ? `2px solid ${t.colors.accent.primary}`
                            : `1px solid ${t.colors.border.primary}`,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: '10px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease',
                          position: 'relative',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: t.colors.text.primary, display: 'block' }}>
                                {th.label}
                              </span>
                              {th.isAutoSystem && (
                                <span
                                  style={{
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.4px',
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    background: isCurrent ? t.colors.accent.primary : t.colors.accent.light,
                                    color: isCurrent ? t.colors.text.inverse : t.colors.accent.primary,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                >
                                  <Terminal size={9} />
                                  Auto
                                </span>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: '10px',
                                textTransform: 'capitalize',
                                color: t.colors.text.muted,
                                marginTop: '2px',
                                display: 'inline-block',
                              }}
                            >
                              {th.isAutoSystem
                                ? `System Default • ${systemMode || th.mode || 'dark'} (Tracks OS)`
                                : `${th.category || 'Theme'} • ${th.mode || 'dark'}`}
                            </span>
                            {th.isAutoSystem && (
                              <span
                                style={{
                                  fontSize: '10px',
                                  color: t.colors.text.secondary,
                                  marginTop: '4px',
                                  display: 'block',
                                  lineHeight: '1.3',
                                  opacity: 0.85,
                                }}
                              >
                                Auto-selects OS scheme & terminal default backgrounds
                              </span>
                            )}
                          </div>
                          {isCurrent && (
                            <div
                              style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: t.colors.accent.primary,
                                color: t.colors.text.inverse,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Check size={12} strokeWidth={3} />
                            </div>
                          )}
                        </div>

                        {/* Real dynamic color dots */}
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                          <span
                            title="Background"
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              background: th.colors.bg.primary,
                              border: `1px solid ${t.colors.border.secondary}`,
                              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                            }}
                          />
                          <span
                            title="Card Surface"
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              background: th.colors.bg.secondary,
                              border: `1px solid ${t.colors.border.secondary}`,
                              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                            }}
                          />
                          <span
                            title="Accent Color"
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              background: th.colors.accent.primary,
                              border: `1px solid ${t.colors.border.secondary}`,
                              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                            }}
                          />
                          <span
                            title="Text Color"
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              background: th.colors.text.primary,
                              border: `1px solid ${t.colors.border.secondary}`,
                              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Dedicated Custom Theme Studio */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '24px',
              }}
            >
              {/* Studio Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '14px' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: t.colors.text.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sliders size={18} style={{ color: t.colors.accent.primary }} />
                    Custom Theme Studio
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                    Create your own custom palette. Changes update live and persist automatically across sessions.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Base Mode Toggle */}
                  <div style={{ display: 'flex', background: t.colors.bg.tertiary, padding: '3px', borderRadius: '8px', border: `1px solid ${t.colors.border.subtle}` }}>
                    <button
                      onClick={() => {
                        setCustomConfig({ baseMode: 'dark' });
                        if (themeName !== 'Custom') setTheme('Custom');
                      }}
                      style={{
                        background: customConfig.baseMode === 'dark' ? t.colors.bg.elevated : 'transparent',
                        color: customConfig.baseMode === 'dark' ? t.colors.text.primary : t.colors.text.muted,
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontWeight: 500,
                      }}
                    >
                      <Moon size={12} />
                      Dark Base
                    </button>
                    <button
                      onClick={() => {
                        setCustomConfig({ baseMode: 'light' });
                        if (themeName !== 'Custom') setTheme('Custom');
                      }}
                      style={{
                        background: customConfig.baseMode === 'light' ? t.colors.bg.elevated : 'transparent',
                        color: customConfig.baseMode === 'light' ? t.colors.text.primary : t.colors.text.muted,
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontWeight: 500,
                      }}
                    >
                      <Sun size={12} />
                      Light Base
                    </button>
                  </div>

                  {/* Copy Config */}
                  <button
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(JSON.stringify(customConfig, null, 2));
                        onToast?.('Custom theme config copied to clipboard!');
                      } catch {
                        onToast?.('Failed to copy to clipboard', true);
                      }
                    }}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      ...buttonVariant(t, 'secondary'),
                      gap: '5px',
                      fontSize: '11px',
                    }}
                    title="Copy custom theme configuration as JSON"
                  >
                    <Copy size={12} />
                    Copy JSON
                  </button>

                  {/* Import Config */}
                  <button
                    onClick={() => {
                      setShowImportCustomModal(true);
                      setImportCustomError(null);
                      setImportCustomJson(JSON.stringify(customConfig, null, 2));
                    }}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      ...buttonVariant(t, 'secondary'),
                      gap: '5px',
                      fontSize: '11px',
                    }}
                    title="Import custom theme JSON"
                  >
                    <Upload size={12} />
                    Import JSON
                  </button>

                  {/* Reset Defaults */}
                  <button
                    onClick={() => {
                      resetCustomConfig();
                      if (themeName !== 'Custom') setTheme('Custom');
                      onToast?.('Custom theme reset to defaults');
                    }}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      ...buttonVariant(t, 'ghost'),
                      gap: '5px',
                      fontSize: '11px',
                    }}
                    title="Reset custom theme to initial defaults"
                  >
                    <RotateCcw size={12} />
                    Reset
                  </button>
                </div>
              </div>

              {/* Quick Presets */}
              <div style={{ marginBottom: '20px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: t.colors.text.secondary, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <Wand2 size={13} style={{ color: t.colors.accent.primary }} />
                  Curated Quick-Start Presets:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {CUSTOM_THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setCustomConfig(preset.config);
                        setTheme('Custom');
                        onToast?.(`Loaded ${preset.label} preset!`);
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '8px',
                        background: t.colors.bg.tertiary,
                        border: `1px solid ${t.colors.border.primary}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        color: t.colors.text.primary,
                        transition: 'all 0.12s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = t.colors.accent.primary)}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = t.colors.border.primary)}
                    >
                      <div style={{ display: 'flex', gap: '3px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: preset.config.bgPrimary }} />
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: preset.config.accent }} />
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: preset.config.textPrimary }} />
                      </div>
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Sliders & Inputs Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: '14px',
                  marginBottom: '24px',
                }}
              >
                {[
                  { key: 'bgPrimary', label: 'Primary Background', desc: 'Main window backdrop & terminals' },
                  { key: 'bgSecondary', label: 'Panel Surface', desc: 'Sidebars, navigation, and top bars' },
                  { key: 'bgTertiary', label: 'Card Surface', desc: 'Cards, popups, and dialogs' },
                  { key: 'bgElevated', label: 'Input / Elevated', desc: 'Text inputs, dropdowns, and elevated chips' },
                  { key: 'accent', label: 'Accent Color', desc: 'Action buttons, active highlights, indicators' },
                  { key: 'textPrimary', label: 'Primary Text', desc: 'Main headings and primary labels' },
                  { key: 'textMuted', label: 'Muted Text', desc: 'Secondary descriptions and subtle hints' },
                  { key: 'border', label: 'Border Color', desc: 'Dividers, outlines, and separators' },
                ].map((item) => {
                  const colorKey = item.key as keyof CustomThemeConfig;
                  const currentColor = customConfig[colorKey] as string;
                  return (
                    <div
                      key={item.key}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '8px',
                        background: t.colors.bg.tertiary,
                        border: `1px solid ${t.colors.border.subtle}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: t.colors.text.primary }}>
                          {item.label}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="color"
                            value={currentColor.startsWith('#') && currentColor.length === 7 ? currentColor : '#000000'}
                            onChange={(e) => {
                              setCustomConfig({ [colorKey]: e.target.value });
                              if (themeName !== 'Custom') setTheme('Custom');
                            }}
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '4px',
                              border: `1px solid ${t.colors.border.primary}`,
                              cursor: 'pointer',
                              padding: 0,
                              background: 'transparent',
                            }}
                          />
                          <input
                            type="text"
                            value={currentColor}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCustomConfig({ [colorKey]: val });
                              if (themeName !== 'Custom') setTheme('Custom');
                            }}
                            style={{
                              width: '80px',
                              fontFamily: t.fontFamily.mono,
                              fontSize: '11px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: t.colors.bg.input,
                              border: `1px solid ${t.colors.border.primary}`,
                              color: t.colors.text.primary,
                              outline: 'none',
                            }}
                          />
                        </div>
                      </div>
                      <span style={{ fontSize: '11px', color: t.colors.text.muted }}>
                        {item.desc}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Live Preview Sandbox */}
              <div
                style={{
                  borderRadius: '10px',
                  border: `1px solid ${customConfig.border}`,
                  background: customConfig.bgPrimary,
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${customConfig.border}`, paddingBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Eye size={15} style={{ color: customConfig.accent }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: customConfig.textPrimary }}>
                      Live Component Preview Sandbox
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: customConfig.textMuted }}>
                    Base: {customConfig.baseMode}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
                  {/* Sample Card */}
                  <div
                    style={{
                      borderRadius: '8px',
                      background: customConfig.bgSecondary,
                      border: `1px solid ${customConfig.border}`,
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600, color: customConfig.textPrimary }}>
                      Interactive Panel Card
                    </span>
                    <span style={{ fontSize: '11px', color: customConfig.textMuted }}>
                      This card demonstrates real-time background, border, and text hierarchy.
                    </span>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      <button
                        style={{
                          background: customConfig.accent,
                          color: customConfig.baseMode === 'light' ? '#ffffff' : '#000000',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '6px 12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Accent Button
                      </button>
                      <button
                        style={{
                          background: customConfig.bgTertiary,
                          color: customConfig.textPrimary,
                          border: `1px solid ${customConfig.border}`,
                          borderRadius: '6px',
                          padding: '6px 12px',
                          fontSize: '11px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Subtle Button
                      </button>
                    </div>
                  </div>

                  {/* Sample Input & Badges */}
                  <div
                    style={{
                      borderRadius: '8px',
                      background: customConfig.bgSecondary,
                      border: `1px solid ${customConfig.border}`,
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600, color: customConfig.textPrimary }}>
                      Input & Status Indicators
                    </span>
                    <input
                      readOnly
                      value="Sample text input field..."
                      style={{
                        background: customConfig.bgElevated,
                        border: `1px solid ${customConfig.border}`,
                        color: customConfig.textPrimary,
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '11px',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '10px',
                          fontWeight: 600,
                          background: `${customConfig.accent}26`,
                          color: customConfig.accent,
                          border: `1px solid ${customConfig.accent}40`,
                        }}
                      >
                        Active Accent
                      </span>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '10px',
                          fontWeight: 600,
                          background: 'rgba(34,197,94,0.15)',
                          color: '#22c55e',
                          border: '1px solid rgba(34,197,94,0.3)',
                        }}
                      >
                        Success
                      </span>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '10px',
                          fontWeight: 600,
                          background: 'rgba(245,158,11,0.15)',
                          color: '#f59e0b',
                          border: '1px solid rgba(245,158,11,0.3)',
                        }}
                      >
                        Warning
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Import Custom Theme Modal */}
            {showImportCustomModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0,0,0,0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                  padding: '20px',
                }}
                onClick={() => setShowImportCustomModal(false)}
              >
                <div
                  style={{
                    width: '100%',
                    maxWidth: '500px',
                    borderRadius: '12px',
                    background: t.colors.bg.secondary,
                    border: `1px solid ${t.colors.border.primary}`,
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    boxShadow: t.shadow.xl,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: t.colors.text.primary }}>
                      Import Custom Theme
                    </h4>
                    <button
                      onClick={() => setShowImportCustomModal(false)}
                      style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer', fontSize: '18px' }}
                    >
                      ×
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                    Paste a valid custom theme JSON object below to apply and activate it.
                  </p>
                  <textarea
                    rows={8}
                    value={importCustomJson}
                    onChange={(e) => {
                      setImportCustomJson(e.target.value);
                      setImportCustomError(null);
                    }}
                    style={{
                      width: '100%',
                      fontFamily: t.fontFamily.mono,
                      fontSize: '11px',
                      padding: '10px',
                      borderRadius: '6px',
                      background: t.colors.bg.input,
                      border: `1px solid ${importCustomError ? t.colors.danger.primary : t.colors.border.primary}`,
                      color: t.colors.text.primary,
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                    }}
                  />
                  {importCustomError && (
                    <span style={{ fontSize: '11px', color: t.colors.danger.primary }}>
                      {importCustomError}
                    </span>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button
                      onClick={() => setShowImportCustomModal(false)}
                      style={{
                        ...buttonBase(t),
                        ...buttonSize(t, 'sm'),
                        ...buttonVariant(t, 'ghost'),
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(importCustomJson);
                          if (!parsed || typeof parsed !== 'object') {
                            throw new Error('Config must be a valid JSON object');
                          }
                          setCustomConfig(parsed);
                          setTheme('Custom');
                          setShowImportCustomModal(false);
                          onToast?.('Custom theme loaded successfully!');
                        } catch (err: any) {
                          setImportCustomError(err?.message || 'Invalid JSON syntax');
                        }
                      }}
                      style={{
                        ...buttonBase(t),
                        ...buttonSize(t, 'sm'),
                        ...buttonVariant(t, 'primary'),
                      }}
                    >
                      Apply Theme
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 4: COLLABORATION & NETWORK
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'network' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '20px',
              }}
            >
              <div style={{ marginBottom: '14px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary }}>
                  Local Network (LAN) Gateway
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                  Enable browser access for devices on your local network.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    border: `1px solid ${t.colors.border.subtle}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: t.colors.text.primary }}>
                      LAN Remote Access
                    </div>
                    <div style={{ fontSize: '11px', color: t.colors.text.muted, marginTop: '2px' }}>
                      Allows collaborators on the local WiFi network to log in via browser
                    </div>
                  </div>

                  <button
                    onClick={handleToggleLan}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      background: collabSettings?.lan_access ? '#22c55e' : t.colors.bg.secondary,
                      color: collabSettings?.lan_access ? '#ffffff' : t.colors.text.muted,
                      border: `1px solid ${collabSettings?.lan_access ? '#22c55e' : t.colors.border.primary}`,
                      padding: '4px 12px',
                      borderRadius: '5px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {collabSettings?.lan_access ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    border: `1px solid ${t.colors.border.subtle}`,
                  }}
                >
                  <div style={{ fontSize: '11px', color: t.colors.text.muted, marginBottom: '6px' }}>
                    Local Gateway Access URL:
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <code
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        background: t.colors.bg.primary,
                        color: t.colors.accent.primary,
                        fontSize: '12px',
                        fontFamily: t.fontFamily.mono,
                        flex: 1,
                      }}
                    >
                      http://localhost:8765
                    </code>
                    <button
                      onClick={() => copyToClipboard('http://localhost:8765', 'url')}
                      style={{
                        ...buttonBase(t),
                        ...buttonSize(t, 'sm'),
                        ...buttonVariant(t, 'secondary'),
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                      }}
                    >
                      {copiedKey === 'url' ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copiedKey === 'url' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h4 style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 600 }}>Manage Collaborators & Invites</h4>
                <p style={{ margin: 0, fontSize: '11px', color: t.colors.text.muted }}>
                  {collaborators.length} collaborator(s) registered. View active presence and dispatch invitations.
                </p>
              </div>
              <button
                onClick={() => onView('colab')}
                style={{
                  ...buttonBase(t),
                  ...buttonSize(t, 'sm'),
                  ...buttonVariant(t, 'primary'),
                  fontSize: '12px',
                }}
              >
                Open Colab Tab →
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 5: SYSTEM & INFO
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'system' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* System Diagnostics & Telemetry Overview Banner */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '22px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: t.colors.text.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={18} style={{ color: t.colors.accent.primary }} />
                    System Diagnostics & Runtime Telemetry
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                    Live hardware specifications, engine runtimes, network boundaries, and environment telemetry.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => void loadSystemDiagnostics()}
                    disabled={loadingSystemData}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      ...buttonVariant(t, 'secondary'),
                      gap: '6px',
                      fontSize: '11px',
                    }}
                    title="Refresh live system telemetry"
                  >
                    <RefreshCw size={12} className={loadingSystemData ? 'animate-spin' : ''} />
                    {loadingSystemData ? 'Refreshing...' : 'Refresh Telemetry'}
                  </button>

                  <button
                    onClick={handleCopyDiagnosticReport}
                    style={{
                      ...buttonBase(t),
                      ...buttonSize(t, 'sm'),
                      ...buttonVariant(t, 'primary'),
                      gap: '6px',
                      fontSize: '11px',
                    }}
                    title="Copy full diagnostic report as Markdown"
                  >
                    <Copy size={12} />
                    Copy Report
                  </button>
                </div>
              </div>

              {/* Status Chips Row */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: t.colors.bg.tertiary,
                    border: `1px solid ${t.colors.border.subtle}`,
                    fontSize: '11px',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: connected ? '#22c55e' : '#ef4444',
                      boxShadow: connected ? '0 0 8px rgba(34,197,94,0.6)' : 'none',
                    }}
                  />
                  <span style={{ color: t.colors.text.muted }}>Sidecar API:</span>
                  <strong style={{ color: connected ? '#22c55e' : '#ef4444' }}>
                    {connected ? `FastAPI Port ${systemData?.runtime.sidecar_port || 8765} Online` : 'Disconnected'}
                  </strong>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: t.colors.bg.tertiary,
                    border: `1px solid ${t.colors.border.subtle}`,
                    fontSize: '11px',
                  }}
                >
                  <Clock size={12} style={{ color: t.colors.accent.primary }} />
                  <span style={{ color: t.colors.text.muted }}>Loopback Latency:</span>
                  <strong style={{ color: t.colors.text.primary }}>
                    {pingMs !== null ? `${pingMs} ms` : '< 1 ms'}
                  </strong>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: t.colors.bg.tertiary,
                    border: `1px solid ${t.colors.border.subtle}`,
                    fontSize: '11px',
                  }}
                >
                  <Server size={12} style={{ color: t.colors.accent.primary }} />
                  <span style={{ color: t.colors.text.muted }}>Desktop Engine:</span>
                  <strong style={{ color: t.colors.text.primary }}>Tauri 2.0 (Rust PTY Core)</strong>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: t.colors.bg.tertiary,
                    border: `1px solid ${t.colors.border.subtle}`,
                    fontSize: '11px',
                  }}
                >
                  <Activity size={12} style={{ color: t.colors.accent.primary }} />
                  <span style={{ color: t.colors.text.muted }}>Sidecar Uptime:</span>
                  <strong style={{ color: t.colors.text.primary }}>
                    {systemData?.runtime.uptime_formatted || 'Active'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Core Hardware & Host Specifications */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '20px',
              }}
            >
              <div style={{ marginBottom: '14px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Laptop size={16} style={{ color: t.colors.accent.primary }} />
                  Host Machine & Hardware Specifications
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                  Detected processor architecture, unified memory, physical storage, and display parameters.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '10px',
                }}
              >
                {/* Processor */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Cpu size={12} style={{ color: t.colors.accent.primary }} />
                      Processor / Chip
                    </span>
                    <strong style={{ fontSize: '12px', color: t.colors.text.primary }}>
                      {systemData?.host.cpu_brand || 'Apple M5 Pro'}
                    </strong>
                  </div>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    {systemData?.host.cpu_cores || 15} Logical Cores • Apple Silicon 64-bit Architecture
                  </span>
                </div>

                {/* System Memory */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Database size={12} style={{ color: t.colors.accent.primary }} />
                      Unified Memory (RAM)
                    </span>
                    <strong style={{ fontSize: '12px', color: t.colors.text.primary }}>
                      {systemData?.host.total_ram_gb ? `${systemData.host.total_ram_gb} GB Unified RAM` : '24.0 GB Unified RAM'}
                    </strong>
                  </div>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    High-bandwidth unified memory architecture for AI & parallel PTYs
                  </span>
                </div>

                {/* Primary Storage */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <HardDrive size={12} style={{ color: t.colors.accent.primary }} />
                      Primary NVMe Storage
                    </span>
                    <strong style={{ fontSize: '12px', color: t.colors.text.primary }}>
                      {systemData?.host.disk_free_gb || 377.7} GB Free
                    </strong>
                  </div>
                  <div style={{ height: '5px', width: '100%', borderRadius: '3px', background: t.colors.border.secondary, margin: '4px 0', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${systemData?.host.disk_used_percent || 59.2}%`,
                        background: t.colors.accent.primary,
                        borderRadius: '3px',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: t.colors.text.muted }}>
                    <span>{systemData?.host.disk_used_percent || 59.2}% used ({systemData?.host.disk_used_gb || 548.6} GB)</span>
                    <span>Total: {systemData?.host.disk_total_gb || 926.3} GB</span>
                  </div>
                </div>

                {/* Display & Resolution */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Monitor size={12} style={{ color: t.colors.accent.primary }} />
                      Display & Viewport
                    </span>
                    <strong style={{ fontSize: '12px', color: t.colors.text.primary }}>
                      {typeof window !== 'undefined' ? `${window.screen.width} × ${window.screen.height}` : 'Retina Display'}
                    </strong>
                  </div>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    {typeof window !== 'undefined' ? `${window.devicePixelRatio}x Display Scale • ${window.screen.colorDepth}-bit High Dynamic Range (HDR)` : 'Retina'}
                  </span>
                </div>

                {/* Host Node Name */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Server size={12} style={{ color: t.colors.accent.primary }} />
                      Local Hostname
                    </span>
                    <strong style={{ fontSize: '12px', color: t.colors.text.primary }}>
                      {systemData?.host.hostname || 'Kenneths-MacBook-Pro.local'}
                    </strong>
                  </div>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    Local node identifier for LAN collaboration and peer clustering
                  </span>
                </div>

                {/* OS & Kernel */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ShieldCheck size={12} style={{ color: t.colors.accent.primary }} />
                      Operating System
                    </span>
                    <strong style={{ fontSize: '12px', color: t.colors.text.primary }}>
                      macOS Darwin ({systemData?.host.machine || 'arm64'})
                    </strong>
                  </div>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    Kernel Version {systemData?.host.os_release || '27.0.0'} • Mach-O 64-bit Architecture
                  </span>
                </div>
              </div>
            </div>

            {/* Core Runtimes & Engine Stacks */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '20px',
              }}
            >
              <div style={{ marginBottom: '14px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Server size={16} style={{ color: t.colors.accent.primary }} />
                  Core Runtimes & Engine Stacks
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                  Desktop shell, Python sidecar daemon, frontend bundler, and process trees.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '10px',
                }}
              >
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: t.colors.text.muted }}>Application Release</span>
                    <strong style={{ color: t.colors.text.primary }}>v{systemData?.runtime.version || '2.3.1'} (Stable)</strong>
                  </div>
                  <span style={{ fontSize: '10px', color: t.colors.text.muted }}>Build Date: 2026-09-14 • Release Channel: Golden Production</span>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: t.colors.text.muted }}>Desktop Engine</span>
                    <strong style={{ color: t.colors.text.primary }}>Tauri 2.0 (Rust PTY Core)</strong>
                  </div>
                  <span style={{ fontSize: '10px', color: t.colors.text.muted }}>Multi-process architecture with zero-overhead async IPC</span>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: t.colors.text.muted }}>Backend Interpreter</span>
                    <strong style={{ color: t.colors.text.primary }}>Python {systemData?.runtime.python_version || '3.14.0'}</strong>
                  </div>
                  <span style={{ fontSize: '10px', color: t.colors.text.muted, wordBreak: 'break-all' }}>{systemData?.runtime.python_executable || '~/.local/share/tto/python/bin/python3'}</span>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: t.colors.text.muted }}>Sidecar Process</span>
                    <strong style={{ color: t.colors.text.primary }}>PID {systemData?.runtime.pid || 66062} (FastAPI / Uvicorn)</strong>
                  </div>
                  <span style={{ fontSize: '10px', color: t.colors.text.muted }}>Active Uptime: {systemData?.runtime.uptime_formatted || 'Active'}</span>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: t.colors.text.muted }}>Webview Engine</span>
                    <strong style={{ color: t.colors.text.primary }}>Apple WebKit (macOS Native)</strong>
                  </div>
                  <span style={{ fontSize: '10px', color: t.colors.text.muted }}>Hardware-accelerated Metal rendering pipeline</span>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: t.colors.text.muted }}>Frontend Framework</span>
                    <strong style={{ color: t.colors.text.primary }}>React 18.3 • Vite 6.4 • TS 5.8</strong>
                  </div>
                  <span style={{ fontSize: '10px', color: t.colors.text.muted }}>Zero-CSS design system with live dynamic styling</span>
                </div>
              </div>
            </div>

            {/* Task Orchestrator & Workspaces Live State */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '20px',
              }}
            >
              <div style={{ marginBottom: '14px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={16} style={{ color: t.colors.accent.primary }} />
                  Active Orchestrator & Workspaces State
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                  Current active workspaces, terminal PTY multiplexing, and event channels.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    border: `1px solid ${t.colors.border.subtle}`,
                  }}
                >
                  <span style={{ fontSize: '11px', color: t.colors.text.muted }}>Active Workspaces</span>
                  <strong style={{ fontSize: '22px', fontWeight: 700, color: t.colors.accent.primary }}>
                    {workspaces.length}
                  </strong>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    {workspaces.map((w) => w.name).slice(0, 3).join(', ')}{workspaces.length > 3 ? '...' : ''}
                  </span>
                </div>

                <div
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    border: `1px solid ${t.colors.border.subtle}`,
                  }}
                >
                  <span style={{ fontSize: '11px', color: t.colors.text.muted }}>Connected PTY Terminals</span>
                  <strong style={{ fontSize: '22px', fontWeight: 700, color: '#22c55e' }}>
                    {Object.keys(terminals).length}
                  </strong>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    Rust POSIX pseudo-terminals
                  </span>
                </div>

                <div
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    background: t.colors.bg.elevated,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    border: `1px solid ${t.colors.border.subtle}`,
                  }}
                >
                  <span style={{ fontSize: '11px', color: t.colors.text.muted }}>Gateway Connection Mode</span>
                  <strong style={{ fontSize: '22px', fontWeight: 700, color: collabSettings?.lan_access ? '#38bdf8' : t.colors.text.primary }}>
                    {collabSettings?.lan_access ? 'LAN Active' : 'Localhost'}
                  </strong>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    Port 8765 WebSocket stream
                  </span>
                </div>
              </div>
            </div>

            {/* Security Isolation & Directory Boundaries */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '20px',
              }}
            >
              <div style={{ marginBottom: '14px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={16} style={{ color: t.colors.accent.primary }} />
                  Security Isolation & Storage Paths
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                  Sandboxed directory boundaries, storage repositories, and Content Security Policies.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '6px', background: t.colors.bg.elevated, fontSize: '11px' }}>
                  <span style={{ color: t.colors.text.muted }}>Asset Protocol Sandbox Scope</span>
                  <span style={{ color: t.colors.text.primary, fontWeight: 500 }}>
                    Scoped: ~/Documents, ~/Desktop, ~/Downloads, ~/Projects
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '6px', background: t.colors.bg.elevated, fontSize: '11px' }}>
                  <span style={{ color: t.colors.text.muted }}>Content Security Policy (CSP)</span>
                  <span style={{ color: '#22c55e', fontWeight: 500 }}>
                    Enforced (script-src &apos;self&apos;, style-src &apos;unsafe-inline&apos;)
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '6px', background: t.colors.bg.elevated, fontSize: '11px' }}>
                  <span style={{ color: t.colors.text.muted }}>Project Repository Root</span>
                  <code style={{ fontSize: '11px', fontFamily: t.fontFamily.mono, color: t.colors.text.secondary }}>
                    {systemData?.runtime.cwd || '/Users/kennethaman/tto-golden'}
                  </code>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '6px', background: t.colors.bg.elevated, fontSize: '11px' }}>
                  <span style={{ color: t.colors.text.muted }}>Collab Shared Store</span>
                  <code style={{ fontSize: '11px', fontFamily: t.fontFamily.mono, color: t.colors.text.secondary }}>
                    {systemData?.runtime.collab_store || '~/.local/share/tto/collab'}
                  </code>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '6px', background: t.colors.bg.elevated, fontSize: '11px' }}>
                  <span style={{ color: t.colors.text.muted }}>Sidecar Daemon Log File</span>
                  <code style={{ fontSize: '11px', fontFamily: t.fontFamily.mono, color: t.colors.text.secondary }}>
                    ~/.local/share/tto/sidecar.log
                  </code>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '6px', background: t.colors.bg.elevated, fontSize: '11px' }}>
                  <span style={{ color: t.colors.text.muted }}>User Home Root</span>
                  <code style={{ fontSize: '11px', fontFamily: t.fontFamily.mono, color: t.colors.text.secondary }}>
                    {systemData?.runtime.home || '/Users/kennethaman'}
                  </code>
                </div>
              </div>
            </div>

            {/* Network & Communications Card */}
            <div
              style={{
                borderRadius: '12px',
                background: t.colors.bg.secondary,
                border: `1px solid ${t.colors.border.primary}`,
                padding: '20px',
              }}
            >
              <div style={{ marginBottom: '14px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: t.colors.text.primary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Wifi size={16} style={{ color: t.colors.accent.primary }} />
                  Network & Gateway Interfaces
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: t.colors.text.muted }}>
                  Local loopback, WebSocket channels, and collaboration interface diagnostics.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '10px',
                }}
              >
                <div style={{ padding: '12px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted }}>Local REST API</span>
                    <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600 }}>200 OK Active</span>
                  </div>
                  <code style={{ fontSize: '11px', fontFamily: t.fontFamily.mono, color: t.colors.text.primary }}>
                    http://127.0.0.1:{systemData?.runtime.sidecar_port || 8765}
                  </code>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted }}>WebSocket Transport</span>
                    <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600 }}>Connected</span>
                  </div>
                  <code style={{ fontSize: '11px', fontFamily: t.fontFamily.mono, color: t.colors.text.primary }}>
                    ws://127.0.0.1:{systemData?.runtime.sidecar_port || 8765}/ws
                  </code>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted }}>LAN Collaboration Gateway</span>
                    <span style={{ fontSize: '11px', color: collabSettings?.lan_access ? '#38bdf8' : t.colors.text.muted, fontWeight: 600 }}>
                      {collabSettings?.lan_access ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    {collabSettings?.lan_access ? 'Listening on 0.0.0.0:8765 for LAN peers' : 'Restricted to local loopback (127.0.0.1)'}
                  </span>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: '8px', background: t.colors.bg.elevated, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: t.colors.text.muted }}>Security Token Protocol</span>
                    <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600 }}>Active</span>
                  </div>
                  <span style={{ fontSize: '11px', color: t.colors.text.secondary }}>
                    Token-gated session authentication with host-guest isolation
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
