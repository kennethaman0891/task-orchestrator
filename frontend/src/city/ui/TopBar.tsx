// Developer City — TopBar overlay: search, filters, camera presets,
// city environment toggles (traffic, nature, birds), vital stats, and breadcrumbs.

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  PanelLeft, Sun, Moon, Car, Trees, Bird,
  Plus, Search, X, Compass, Eye, Building2, Zap
} from 'lucide-react';
import { useCityStore } from '@/city/store';
import { PROJECT_TYPES, PROJECT_TYPE_LABELS, type Project } from '@/city/types';
import {
  cityOverviewTarget, streetViewTarget,
  droneTarget, isometricTarget
} from '@/city/scene/CameraRig';
import { useTheme } from '@/contexts/ThemeContext';

export function TopBar({
  onToast, onNewProject, onToggleSidebar,
}: {
  onToast?: (msg: string, error?: boolean) => void;
  onNewProject?: () => void;
  /** Re-open the app sidebar from inside the city view */
  onToggleSidebar?: () => void;
}) {
  void onToast;
  const { theme: t } = useTheme();

  const filters = useCityStore((s) => s.filters);
  const setFilters = useCityStore((s) => s.setFilters);
  const nav = useCityStore((s) => s.nav);
  const projects = useCityStore((s) => s.projects);
  const agents = useCityStore((s) => s.agents);
  const selected = useCityStore((s) => s.selectedProjectId);
  const setCameraTarget = useCityStore((s) => s.setCameraTarget);
  const exitOneLevel = useCityStore((s) => s.exitOneLevel);
  const exitToCity = useCityStore((s) => s.exitToCity);
  const cityMood = useCityStore((s) => s.cityMood);
  const setCityMood = useCityStore((s) => s.setCityMood);

  const showTraffic = useCityStore((s) => s.showTraffic);
  const setShowTraffic = useCityStore((s) => s.setShowTraffic);
  const showNature = useCityStore((s) => s.showNature);
  const setShowNature = useCityStore((s) => s.setShowNature);
  const showBirds = useCityStore((s) => s.showBirds);
  const setShowBirds = useCityStore((s) => s.setShowBirds);

  const [activeCamPreset, setActiveCamPreset] = useState<'overview' | 'drone' | 'street' | 'iso'>('overview');

  const selectedProject: Project | null = selected ? projects[selected] ?? null : null;

  // City Vital Statistics
  const totalProjects = Object.keys(projects).length;
  const activeAgentCount = useMemo(() => {
    return Object.values(agents).filter((a) => a.status !== 'offline' && a.status !== 'idle').length;
  }, [agents]);

  // Project count per type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of Object.values(projects)) {
      counts[p.type] = (counts[p.type] || 0) + 1;
    }
    return counts;
  }, [projects]);

  const toggleType = (pt: Project['type']) => {
    setFilters({
      types: filters.types.includes(pt)
        ? filters.types.filter((x) => x !== pt)
        : [...filters.types, pt],
    });
  };

  const crumbs = useMemo(() => {
    const c: string[] = ['CITY'];
    if (nav.mode !== 'city' && selectedProject) c.push(selectedProject.name);
    if (nav.mode === 'exterior') c.push('BUILDING');
    if (nav.mode === 'interior') {
      c[c.length - 1] = selectedProject?.name ?? '';
      c.push(selectedProject?.floors?.[nav.floorIndex]?.toString() ?? `Floor ${nav.floorIndex + 1}`);
      if (nav.room) c.push(nav.room);
    }
    return c;
  }, [nav, selectedProject]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        right: 10,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 20,
        pointerEvents: 'none',
        flexWrap: 'wrap',
      }}
    >
      {/* ── 1. Search & Filter Bar ──────────────────────────────── */}
      <div
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          background: 'rgba(11, 15, 25, 0.88)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 12,
          padding: '6px 12px',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        }}
      >
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title="Toggle workspace sidebar"
            aria-label="Toggle sidebar"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              cursor: 'pointer',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: t.colors.text.primary,
              transition: 'all 0.15s ease',
            }}
          >
            <PanelLeft size={15} />
          </button>
        )}

        {/* Prominent BETA VERSION Badge on Top of City Tab */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 8,
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.24) 0%, rgba(234, 88, 12, 0.24) 100%)',
            border: '1px solid rgba(251, 191, 36, 0.55)',
            color: '#fde047',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1.1,
            textTransform: 'uppercase',
            boxShadow: '0 0 14px rgba(245, 158, 11, 0.25)',
            whiteSpace: 'nowrap',
          }}
          title="Developer City 3D Workspace — Beta Version"
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#fbbf24',
              boxShadow: '0 0 8px #fbbf24',
            }}
          />
          <span>BETA VERSION</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '3px 8px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Search size={13} style={{ color: t.colors.text.muted }} />
          <input
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder="Search city buildings…"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: t.colors.text.primary,
              fontSize: 12,
              width: 140,
            }}
          />
          {filters.query && (
            <button
              onClick={() => setFilters({ query: '' })}
              style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer', padding: 0 }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {onNewProject && (
          <button
            onClick={onNewProject}
            title="Create new building in city"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 500,
              padding: '4px 9px',
              borderRadius: 8,
              cursor: 'pointer',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#93c5fd',
            }}
          >
            <Plus size={12} /> New Project
          </button>
        )}

        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 4 }}>
          {PROJECT_TYPES.map((pt) => {
            const count = typeCounts[pt] || 0;
            const isSelected = filters.types.includes(pt);
            return (
              <button
                key={pt}
                onClick={() => toggleType(pt)}
                style={{
                  fontSize: 10,
                  padding: '3px 7px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: `1px solid ${isSelected ? '#3b82f6' : 'rgba(255,255,255,0.08)'}`,
                  background: isSelected ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255,255,255,0.02)',
                  color: isSelected ? '#bfdbfe' : t.colors.text.secondary,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>{PROJECT_TYPE_LABELS[pt]}</span>
                {count > 0 && <span style={{ opacity: 0.7, fontSize: 9 }}>({count})</span>}
              </button>
            );
          })}

          <button
            onClick={() => setFilters({ agentActive: !filters.agentActive })}
            style={{
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              border: `1px solid ${filters.agentActive ? '#f59e0b' : 'rgba(255,255,255,0.08)'}`,
              background: filters.agentActive ? 'rgba(245,158,11,0.22)' : 'rgba(255,255,255,0.02)',
              color: filters.agentActive ? '#fbbf24' : t.colors.text.secondary,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Zap size={11} style={{ color: filters.agentActive ? '#fbbf24' : t.colors.text.muted }} />
            <span>Active Agents</span>
          </button>
        </div>
      </div>

      {/* ── 2. City Controls Island (Mood, Camera, Layers) ───────── */}
      <div
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          background: 'rgba(11, 15, 25, 0.88)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 12,
          padding: '6px 10px',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        }}
      >
        {/* Day / Night Mood Toggle */}
        <button
          style={{
            ...btnStyle(t),
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: cityMood === 'day' ? 'rgba(251, 191, 36, 0.15)' : 'rgba(99, 102, 241, 0.15)',
            borderColor: cityMood === 'day' ? 'rgba(251, 191, 36, 0.4)' : 'rgba(99, 102, 241, 0.4)',
            color: cityMood === 'day' ? '#fde047' : '#c7d2fe',
            fontWeight: 500,
          }}
          onClick={() => setCityMood(cityMood === 'day' ? 'night' : 'day')}
          title={cityMood === 'day' ? 'Switch to Night mood' : 'Switch to Day mood'}
        >
          {cityMood === 'day' ? <Sun size={13} /> : <Moon size={13} />}
          <span>{cityMood === 'day' ? 'Day' : 'Night'}</span>
        </button>

        <div style={{ width: 1, height: 18, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

        {/* Camera Preset Segmented Control */}
        <div style={{ display: 'flex', gap: 3, background: 'rgba(255, 255, 255, 0.04)', borderRadius: 8, padding: 2 }}>
          <button
            style={camBtnStyle(activeCamPreset === 'overview', t)}
            onClick={() => {
              setActiveCamPreset('overview');
              setCameraTarget(cityOverviewTarget());
            }}
            title="City Bird's-Eye Overview"
          >
            <Compass size={12} /> Overview
          </button>
          <button
            style={camBtnStyle(activeCamPreset === 'drone', t)}
            onClick={() => {
              setActiveCamPreset('drone');
              setCameraTarget(droneTarget(selectedProject));
            }}
            title="Cinematic Drone Flyby"
          >
            <Eye size={12} /> Drone
          </button>
          <button
            style={camBtnStyle(activeCamPreset === 'street', t)}
            onClick={() => {
              setActiveCamPreset('street');
              setCameraTarget(streetViewTarget(selectedProject));
            }}
            title="Street-Level Pedestrian View"
          >
            Street
          </button>
          <button
            style={camBtnStyle(activeCamPreset === 'iso', t)}
            onClick={() => {
              setActiveCamPreset('iso');
              setCameraTarget(isometricTarget());
            }}
            title="Isometric Orthogonal Angle"
          >
            Iso
          </button>
        </div>

        <div style={{ width: 1, height: 18, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

        {/* City Infrastructure / Environment Layer Toggles */}
        <button
          style={toggleBtnStyle(showTraffic, '#38bdf8')}
          onClick={() => setShowTraffic(!showTraffic)}
          title={`Traffic: ${showTraffic ? 'Enabled' : 'Disabled'}`}
        >
          <Car size={13} />
        </button>
        <button
          style={toggleBtnStyle(showNature, '#4ade80')}
          onClick={() => setShowNature(!showNature)}
          title={`Nature & Trees: ${showNature ? 'Enabled' : 'Disabled'}`}
        >
          <Trees size={13} />
        </button>
        <button
          style={toggleBtnStyle(showBirds, '#f472b6')}
          onClick={() => setShowBirds(!showBirds)}
          title={`Birds & Wildlife: ${showBirds ? 'Enabled' : 'Disabled'}`}
        >
          <Bird size={13} />
        </button>
      </div>

      {/* ── 3. City Vitals & Breadcrumbs ────────────────────────── */}
      <div
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          background: 'rgba(11, 15, 25, 0.88)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 12,
          padding: '6px 12px',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        }}
      >
        {/* City Stats Indicators */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingRight: 6, borderRight: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            <Building2 size={13} style={{ color: '#60a5fa' }} />
            <span style={{ fontWeight: 600, color: '#f8fafc' }}>{totalProjects}</span>
            <span>Plots</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            <Zap size={13} style={{ color: activeAgentCount > 0 ? '#34d399' : '#64748b' }} />
            <span style={{ fontWeight: 600, color: activeAgentCount > 0 ? '#34d399' : '#94a3b8' }}>{activeAgentCount}</span>
            <span>Agents</span>
          </div>
        </div>

        {/* Breadcrumb Trail */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {i > 0 && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>›</span>}
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: i === crumbs.length - 1 ? 'default' : 'pointer',
                  color: i === crumbs.length - 1 ? '#ffffff' : '#60a5fa',
                  fontSize: 12,
                  fontWeight: i === crumbs.length - 1 ? 600 : 400,
                  padding: 0,
                  transition: 'color 0.15s ease',
                }}
                onClick={() => {
                  if (i === 0) exitToCity();
                  else if (i === crumbs.length - 2 && nav.mode !== 'city') exitOneLevel();
                }}
              >
                {c}
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function btnStyle(t: any): CSSProperties {
  return {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: t.colors.text.secondary,
    fontSize: 11,
    borderRadius: 8,
    padding: '4px 10px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };
}

function camBtnStyle(active: boolean, t: any): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: active ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
    border: 'none',
    color: active ? '#93c5fd' : t.colors.text.secondary,
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    borderRadius: 6,
    padding: '4px 8px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };
}

function toggleBtnStyle(active: boolean, glowColor: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 8,
    cursor: 'pointer',
    background: active ? `${glowColor}25` : 'rgba(255, 255, 255, 0.04)',
    border: `1px solid ${active ? glowColor : 'rgba(255, 255, 255, 0.1)'}`,
    color: active ? glowColor : 'rgba(255, 255, 255, 0.4)',
    transition: 'all 0.15s ease',
  };
}
