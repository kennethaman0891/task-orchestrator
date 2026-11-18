// Developer City — FloorNav / InteriorHUD: Complete architectural HUD overlay for building interior.
// Provides top-level breadcrumb navigation with BETA VERSION badge, meaningful room zone switcher,
// multi-floor elevator stack, complete hands-on 360° camera control (manual scrub slider + tilt + step orbit,
// zero unrequested continuous spin), First-Person Walk-In navigation, and live agent/terminal dock.

import { useState, useEffect, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Monitor,
  Server,
  Coffee,
  Eye,
  Layers,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  LayoutGrid,
  Bot,
  X,
  Compass,
  History,
  Terminal,
  Activity,
  Sliders,
} from 'lucide-react';
import { useCityStore } from '@/city/store';
import { floorName } from '@/city/scene/Interior';
import { interiorTarget, buildingFocusTarget } from '@/city/scene/CameraRig';
import { fittedArchetype } from '@/city/scene/plotFit';
import type { AgentBot, Project, FloorPlanFloor, TerminalCar } from '@/city/types';
import { useProjectFloorPlan, generateFallbackFloorPlan } from '@/city/utils/projectScanner';

type CameraPreset = 'overview' | 'walkin' | 'desks' | 'servers' | 'blueprint' | 'preview' | 'lounge' | 'topdown';

export interface FloorNavProps {
  onExitToWorkspace?: () => void;
  onOpenTerminal?: (terminalId: string) => void;
  onOpenFloatingTerminal?: (terminalId: string) => void;
  onNewSession?: (project: Project) => void;
}

export function FloorNav({
  onExitToWorkspace,
  onOpenTerminal,
  onOpenFloatingTerminal,
  onNewSession,
}: FloorNavProps) {
  const nav = useCityStore((s) => s.nav);
  const projects = useCityStore((s) => s.projects);
  const agents = useCityStore((s) => s.agents);
  const terminalCars = useCityStore((s) => s.terminalCars);
  const goInterior = useCityStore((s) => s.goInterior);
  const exitOneLevel = useCityStore((s) => s.exitOneLevel);
  const setCameraTarget = useCityStore((s) => s.setCameraTarget);
  const interiorViewMode = useCityStore((s) => s.interiorViewMode);
  const setInteriorViewMode = useCityStore((s) => s.setInteriorViewMode);
  const setActiveObjectInspection = useCityStore((s) => s.setActiveObjectInspection);

  const [activePreset, setActivePreset] = useState<CameraPreset>('overview');
  const [showAgents, setShowAgents] = useState<boolean>(false);
  const [showFloorPicker, setShowFloorPicker] = useState<boolean>(false);
  const [showHandsOn360, setShowHandsOn360] = useState<boolean>(true);
  const [azimuthDeg, setAzimuthDeg] = useState<number>(22);
  const [polarDeg, setPolarDeg] = useState<number>(52);

  const memoryOpen = useCityStore((s) => s.memoryOpen);
  const memoryFloor = useCityStore((s) => s.memoryFloor);
  const openMemory = useCityStore((s) => s.openMemory);

  const isInterior = nav.mode === 'interior';
  const p = isInterior ? projects[nav.projectId] : null;
  const floorPlan = useProjectFloorPlan(p || null);
  const fallbackPlan = useMemo(() => (p ? generateFallbackFloorPlan(p) : null), [p]);

  const activePlanFloor: FloorPlanFloor =
    floorPlan?.floors?.[nav.mode === 'interior' ? nav.floorIndex : 0] ||
    fallbackPlan?.floors?.[nav.mode === 'interior' ? nav.floorIndex : 0] ||
    floorPlan?.floors?.[0] ||
    (fallbackPlan ? fallbackPlan.floors[0] : (null as any));

  // Sync live camera spherical angles when user drags in the 3D viewport
  useEffect(() => {
    if (!isInterior) return;
    const onAngleSync = (e: Event) => {
      const custom = e as CustomEvent<{ azimuthDeg: number; polarDeg: number }>;
      if (typeof custom.detail?.azimuthDeg === 'number') {
        setAzimuthDeg(custom.detail.azimuthDeg);
      }
      if (typeof custom.detail?.polarDeg === 'number') {
        setPolarDeg(custom.detail.polarDeg);
      }
    };
    window.addEventListener('tto-camera-angle-sync', onAngleSync);
    return () => window.removeEventListener('tto-camera-angle-sync', onAngleSync);
  }, [isInterior]);

  // Keyboard shortcut 'V' to toggle Walk-In vs Dollhouse Overview
  useEffect(() => {
    if (!isInterior) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'KeyV') {
        toggleWalkInMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInterior, interiorViewMode]);

  useEffect(() => {
    if (!memoryOpen || nav.mode !== 'interior') return;
    if (memoryFloor?.projectId === nav.projectId && memoryFloor.floorIndex === nav.floorIndex) return;
    openMemory(nav.projectId, nav.floorIndex);
  }, [memoryOpen, nav, memoryFloor, openMemory]);

  if (!isInterior || !p) return null;

  const fitted = fittedArchetype(p.building.buildingStyle || p.type, p.type, p.building.scale);
  const floorCount = Math.max(floorPlan?.floors?.length || p.floors?.length || 0, fitted.slabs || 6);

  // Live terminal cars & active agents inside this project
  const projectCars: TerminalCar[] = Object.values(terminalCars).filter(
    (c) => c.projectId === p.id || (p.path && c.projectPath === p.path),
  );

  const projectAgents: AgentBot[] = Object.values(agents).filter(
    (a) =>
      a.status !== 'offline' &&
      p.path &&
      (a.projectPath === p.path ||
        a.projectPath.startsWith(p.path + '/') ||
        p.path.startsWith(a.projectPath)),
  );

  const totalLiveUnits = Math.max(projectAgents.length, projectCars.length);

  const flyToFloor = (i: number, preset: CameraPreset = activePreset) => {
    goInterior(p.id, i, nav.room);
    setActivePreset(preset);
    setCameraTarget(
      interiorTarget(p.plot, i, fitted.floorH, fitted.depth, preset),
    );
  };

  const setViewPreset = (preset: CameraPreset) => {
    setActivePreset(preset);
    if (preset === 'walkin') {
      setInteriorViewMode('walk-in');
    } else {
      setInteriorViewMode('dollhouse');
    }
    setCameraTarget(
      interiorTarget(p.plot, nav.floorIndex, fitted.floorH, fitted.depth, preset),
    );
  };

  const toggleWalkInMode = () => {
    if (interiorViewMode === 'walk-in') {
      setInteriorViewMode('dollhouse');
      setViewPreset('overview');
    } else {
      setInteriorViewMode('walk-in');
      setViewPreset('walkin');
    }
  };

  // Interactive 3D step rotation around floor (manual hands-on control)
  const rotateCamera = (deltaRad: number) => {
    if (interiorViewMode === 'walk-in') setInteriorViewMode('dollhouse');
    window.dispatchEvent(new CustomEvent('tto-camera-rotate', { detail: { deltaRad } }));
  };

  // Direct hands-on 360° orbit angle scrubber (never auto-spins!)
  const scrubOrbitAngle = (nextAzimuthDeg: number, nextPolarDeg?: number) => {
    if (interiorViewMode === 'walk-in') setInteriorViewMode('dollhouse');
    setAzimuthDeg(nextAzimuthDeg);
    if (typeof nextPolarDeg === 'number') setPolarDeg(nextPolarDeg);
    window.dispatchEvent(
      new CustomEvent('tto-camera-set-orbit', {
        detail: {
          azimuthDeg: nextAzimuthDeg,
          polarDeg: typeof nextPolarDeg === 'number' ? nextPolarDeg : polarDeg,
        },
      }),
    );
  };

  // Interactive 3D step zoom
  const zoomCamera = (factorDelta: number) => {
    window.dispatchEvent(new CustomEvent('tto-camera-zoom', { detail: { factor: factorDelta } }));
  };

  const resetCamera = () => {
    setInteriorViewMode('dollhouse');
    setViewPreset('overview');
  };

  const handleExit = () => {
    setInteriorViewMode('dollhouse');
    if (onExitToWorkspace) {
      onExitToWorkspace();
    } else {
      exitOneLevel();
    }
    setCameraTarget(buildingFocusTarget(p.plot));
  };

  const currentFloorTitle = activePlanFloor?.name || floorName(p, nav.floorIndex);
  const floorCategory = activePlanFloor?.category || 'custom';
  const accentColor = activePlanFloor?.accentColor || '#38bdf8';

  const zoneButtons: Array<{ id: CameraPreset; label: string; icon: ReactNode }> = [
    { id: 'desks', label: 'Workstations', icon: <Monitor size={12} /> },
    { id: 'preview', label: 'Live Preview', icon: <Activity size={12} /> },
    { id: 'blueprint', label: 'Command Wall', icon: <Layers size={12} /> },
    { id: 'servers', label: 'Server Pod', icon: <Server size={12} /> },
    { id: 'lounge', label: 'Lounge', icon: <Coffee size={12} /> },
  ];

  return (
    <>
      {/* ── 1. Top Architectural HUD Header ────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          right: 14,
          zIndex: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          pointerEvents: 'none',
          flexWrap: 'wrap',
        }}
      >
        {/* Left: Exit button, BETA VERSION Badge & Real Project Identity */}
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(9, 13, 22, 0.94)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: 14,
            padding: '6px 14px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(20px)',
            color: '#e8edf5',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <button
            type="button"
            onClick={handleExit}
            title="Return to City exterior"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(59, 130, 246, 0.16)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              borderRadius: 8,
              padding: '6px 12px',
              color: '#93c5fd',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.18s ease',
            }}
          >
            <ArrowLeft size={14} />
            <span>Exit Building</span>
          </button>

          {/* BETA VERSION Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 9px',
              borderRadius: 7,
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.24) 0%, rgba(234, 88, 12, 0.24) 100%)',
              border: '1px solid rgba(251, 191, 36, 0.55)',
              color: '#fde047',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1.0,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
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

          <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.12)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: accentColor,
                boxShadow: `0 0 10px ${accentColor}`,
              }}
            />
            <span style={{ fontWeight: 700, color: '#f8fafc', letterSpacing: 0.2 }}>{p.name}</span>
            <span
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                background: 'rgba(255, 255, 255, 0.08)',
                color: accentColor,
                border: `1px solid ${accentColor}44`,
                padding: '2px 7px',
                borderRadius: 6,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              {floorCategory}
            </span>
            <span style={{ color: 'rgba(232, 237, 245, 0.4)' }}>/</span>
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>{currentFloorTitle}</span>
          </div>
        </div>

        {/* Center: Clean Functional Room Zones for this Floor */}
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'rgba(9, 13, 22, 0.94)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: 14,
            padding: '5px 8px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: 'rgba(232, 237, 245, 0.45)',
              padding: '0 6px',
              fontWeight: 700,
              letterSpacing: 0.8,
            }}
          >
            ZONES
          </span>
          {zoneButtons.map((zb) => {
            const isZoneActive = activePreset === zb.id;
            return (
              <button
                key={zb.id}
                type="button"
                onClick={() => {
                  goInterior(p.id, nav.floorIndex, zb.id);
                  setViewPreset(zb.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background: isZoneActive ? '#3b82f6' : 'rgba(255, 255, 255, 0.05)',
                  color: isZoneActive ? '#fff' : '#e2e8f0',
                  border: isZoneActive ? '1px solid #60a5fa' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 8,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: isZoneActive ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isZoneActive ? '0 0 12px rgba(59, 130, 246, 0.5)' : 'none',
                }}
              >
                {zb.icon}
                <span>{zb.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Live Terminal Quick-Open & Active Agents Pill */}
        <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {projectCars.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const firstTerm = projectCars[0]?.terminalId || projectCars[0]?.id;
                if (!firstTerm) return;
                if (onOpenFloatingTerminal) onOpenFloatingTerminal(firstTerm);
                else if (onOpenTerminal) onOpenTerminal(firstTerm);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(16, 185, 129, 0.16)',
                border: '1px solid rgba(16, 185, 129, 0.45)',
                borderRadius: 14,
                padding: '7px 12px',
                color: '#34d399',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.55)',
                backdropFilter: 'blur(16px)',
              }}
              title="Open Live Floating Terminal for this Building"
            >
              <Terminal size={14} />
              <span>Live Terminal ({projectCars.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowAgents(!showAgents)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: showAgents ? '#1e293b' : 'rgba(9, 13, 22, 0.94)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: 14,
              padding: '7px 14px',
              color: totalLiveUnits > 0 ? '#38bdf8' : '#94a3b8',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.55)',
              backdropFilter: 'blur(16px)',
              transition: 'all 0.18s ease',
            }}
          >
            <Bot size={15} />
            <span>Agents</span>
            <span
              style={{
                background: totalLiveUnits > 0 ? '#0284c7' : 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 10,
                fontWeight: 700,
              }}
            >
              {totalLiveUnits}
            </span>
          </button>
        </div>
      </div>

      {/* ── 2. Collapsible Live Agents & Terminals Dock (Right Side) ──────── */}
      {showAgents && (
        <div
          style={{
            position: 'absolute',
            top: 68,
            right: 14,
            width: 340,
            maxHeight: 'calc(100% - 170px)',
            zIndex: 26,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: 'rgba(9, 13, 22, 0.96)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: 16,
            padding: 16,
            boxShadow: '0 20px 48px rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(24px)',
            color: '#e8edf5',
            fontFamily: 'system-ui, sans-serif',
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: 'rgba(59, 130, 246, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#60a5fa',
                }}
              >
                <Layers size={14} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc' }}>
                  {p.name} · Live Sessions
                </div>
                <div style={{ fontSize: 11, color: 'rgba(232, 237, 245, 0.5)' }}>
                  {projectCars.length} terminals · {projectAgents.length} AI agents
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {onNewSession && (
                <button
                  type="button"
                  onClick={() => onNewSession(p)}
                  style={{
                    background: 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: '#93c5fd',
                    padding: '4px 9px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Session
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAgents(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {projectCars.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.7 }}>
                LIVE PTY TERMINALS
              </div>
              {projectCars.map((car) => (
                <div
                  key={car.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 10,
                    padding: '9px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: '#f8fafc' }}>{car.name}</span>
                    <span
                      style={{
                        fontSize: 10,
                        color: car.moving ? '#fbbf24' : '#34d399',
                        fontWeight: 700,
                      }}
                    >
                      ● {car.moving ? 'WORKING' : 'ONLINE'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {car.currentTask?.description || car.cli || car.cwd}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    {onOpenFloatingTerminal && (
                      <button
                        type="button"
                        onClick={() => onOpenFloatingTerminal(car.terminalId || car.id)}
                        style={{
                          background: 'rgba(56, 189, 248, 0.15)',
                          border: '1px solid rgba(56, 189, 248, 0.35)',
                          color: '#38bdf8',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 6,
                          padding: '3px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        Live Overlay
                      </button>
                    )}
                    {onOpenTerminal && (
                      <button
                        type="button"
                        onClick={() => onOpenTerminal(car.terminalId || car.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#60a5fa',
                          fontSize: 11,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        Open in Workspace →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {projectAgents.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.7 }}>
                ACTIVE AI AGENTS
              </div>
              {projectAgents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 10,
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: '#f8fafc' }}>{agent.name}</span>
                    <span style={{ fontSize: 10, color: '#38bdf8' }}>{agent.model || agent.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {agent.currentTask || 'Stationed at floor workstation'}
                  </div>
                  {agent.terminalId && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                      {onOpenFloatingTerminal && (
                        <button
                          type="button"
                          onClick={() => onOpenFloatingTerminal(agent.terminalId)}
                          style={{
                            background: 'rgba(56, 189, 248, 0.15)',
                            border: '1px solid rgba(56, 189, 248, 0.35)',
                            color: '#38bdf8',
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 6,
                            padding: '3px 8px',
                            cursor: 'pointer',
                          }}
                        >
                          Live Terminal
                        </button>
                      )}
                      {onOpenTerminal && (
                        <button
                          type="button"
                          onClick={() => onOpenTerminal(agent.terminalId)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#60a5fa',
                            fontSize: 11,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          Open in Workspace →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            projectCars.length === 0 && (
              <div style={{ padding: '14px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                No live agent PTYs running yet for this project.
                <br />
                Click <strong>+ Session</strong> above to spawn a live terminal.
              </div>
            )
          )}
        </div>
      )}

      {/* ── 3. Bottom Responsive Island Dock Architecture ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 28,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          width: 'calc(100% - 24px)',
          maxWidth: 1140,
          pointerEvents: 'none',
        }}
      >
        {/* Floating Hint for First-Person Walk-In Mode */}
        {interiorViewMode === 'walk-in' && (
          <div
            style={{
              pointerEvents: 'auto',
              background: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid #38bdf8',
              borderRadius: 20,
              padding: '6px 16px',
              fontSize: 11,
              fontWeight: 600,
              color: '#e0f2fe',
              boxShadow: '0 8px 24px rgba(56, 189, 248, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Compass size={14} color="#38bdf8" />
            <span>
              Walk-In Mode Active · Use WASD / Arrows to walk · Drag to look around 360° · [V] Toggle Overview
            </span>
          </div>
        )}

        {/* ── HANDS-ON 360° MANUAL ORBIT & TILT CONTROL BAR (Replaces Auto-Spin Turntable!) ── */}
        {showHandsOn360 && interiorViewMode !== 'walk-in' && (
          <div
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 12,
              background: 'rgba(9, 13, 22, 0.95)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: 14,
              padding: '7px 14px',
              boxShadow: '0 14px 34px rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(24px)',
              color: '#e8edf5',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#38bdf8' }}>
              <Sliders size={13} />
              <span>360° HANDS-ON CONTROL</span>
            </div>

            {/* Manual 360° Horizontal Orbit Scrubber */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Orbit</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={azimuthDeg}
                onChange={(e) => scrubOrbitAngle(Number(e.target.value))}
                style={{
                  width: 150,
                  accentColor: '#38bdf8',
                  cursor: 'grab',
                }}
                title="Drag to manually rotate 360° around the floor"
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#f8fafc',
                  fontFamily: 'monospace',
                  minWidth: 36,
                }}
              >
                {azimuthDeg}°
              </span>
            </div>

            <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.12)' }} />

            {/* Manual Vertical Tilt Scrubber */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Tilt</span>
              <input
                type="range"
                min={12}
                max={82}
                step={1}
                value={polarDeg}
                onChange={(e) => scrubOrbitAngle(azimuthDeg, Number(e.target.value))}
                style={{
                  width: 95,
                  accentColor: '#38bdf8',
                  cursor: 'grab',
                }}
                title="Drag to manually tilt camera from top-down to eye-level"
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#f8fafc',
                  fontFamily: 'monospace',
                  minWidth: 30,
                }}
              >
                {polarDeg}°
              </span>
            </div>

            <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.12)' }} />

            {/* Quick Cardinal Snap Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {[
                { label: 'Front 0°', deg: 0 },
                { label: 'Right 90°', deg: 90 },
                { label: 'Rear 180°', deg: 180 },
                { label: 'Left 270°', deg: 270 },
              ].map((snap) => {
                const isSnap = Math.abs(azimuthDeg - snap.deg) <= 8 || (snap.deg === 0 && azimuthDeg >= 352);
                return (
                  <button
                    key={snap.label}
                    type="button"
                    onClick={() => scrubOrbitAngle(snap.deg)}
                    style={{
                      background: isSnap ? 'rgba(56, 189, 248, 0.24)' : 'rgba(255, 255, 255, 0.05)',
                      border: isSnap ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                      color: isSnap ? '#38bdf8' : '#cbd5e1',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {snap.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Floating Floor Picker Shaft Popover */}
        {showFloorPicker && (
          <div
            style={{
              pointerEvents: 'auto',
              background: 'rgba(9, 13, 22, 0.96)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: 14,
              padding: '8px',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.85)',
              backdropFilter: 'blur(24px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minWidth: 250,
              marginBottom: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                fontSize: 10,
                fontWeight: 700,
                color: 'rgba(232, 237, 245, 0.45)',
                letterSpacing: 1,
              }}
            >
              <span>SELECT FLOOR SHAFT</span>
              <button
                type="button"
                onClick={() => setShowFloorPicker(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
              >
                <X size={12} />
              </button>
            </div>
            {Array.from({ length: floorCount }, (_, i) => {
              const isActive = nav.floorIndex === i;
              const fPlan = floorPlan?.floors?.[i] || fallbackPlan?.floors?.[i];
              const fName = fPlan?.name || floorName(p, i);
              const fCat = fPlan?.category || 'custom';
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    flyToFloor(i);
                    setShowFloorPicker(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: isActive ? '1px solid #60a5fa' : '1px solid transparent',
                    background: isActive ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    color: isActive ? '#93c5fd' : '#e2e8f0',
                    fontSize: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.12s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, minWidth: 16, color: isActive ? '#38bdf8' : '#94a3b8' }}>
                      {i + 1}
                    </span>
                    <span style={{ fontWeight: isActive ? 600 : 500 }}>{fName}</span>
                  </div>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: '#64748b' }}>{fCat}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 3 Autonomous Floating Islands */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
          }}
        >
          {/* ── ISLAND 1: Compact Elevator Stepper & Memory ── */}
          <div style={islandBaseStyle}>
            <button
              type="button"
              onClick={() => flyToFloor(Math.max(0, nav.floorIndex - 1))}
              disabled={nav.floorIndex === 0}
              title="Go down 1 floor"
              style={navIconBtn(nav.floorIndex === 0)}
            >
              <ChevronDown size={14} />
            </button>

            <button
              type="button"
              onClick={() => setShowFloorPicker(!showFloorPicker)}
              title="Click to jump to any floor"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 8,
                background: 'rgba(59, 130, 246, 0.18)',
                border: '1px solid rgba(59, 130, 246, 0.45)',
                color: '#93c5fd',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Layers size={13} color="#60a5fa" />
              <span>
                Floor {nav.floorIndex + 1} / {floorCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => flyToFloor(Math.min(floorCount - 1, nav.floorIndex + 1))}
              disabled={nav.floorIndex >= floorCount - 1}
              title="Go up 1 floor"
              style={navIconBtn(nav.floorIndex >= floorCount - 1)}
            >
              <ChevronUp size={14} />
            </button>

            <div style={{ width: 1, height: 18, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

            <button
              type="button"
              onClick={() => openMemory(p.id, nav.floorIndex)}
              title="Episodes from the last 30 days on this floor"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 28,
                padding: '0 8px',
                borderRadius: 8,
                border: memoryOpen ? '1px solid #60a5fa' : '1px solid rgba(255, 255, 255, 0.12)',
                background: memoryOpen ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                color: '#e8edf5',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <History size={13} />
              <span>Memory</span>
            </button>
          </div>

          {/* ── ISLAND 2: Viewport Mode & Zone Presets ── */}
          <div style={islandBaseStyle}>
            <button
              type="button"
              onClick={toggleWalkInMode}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: interiorViewMode === 'walk-in' ? '#0284c7' : 'rgba(56, 189, 248, 0.12)',
                border: interiorViewMode === 'walk-in' ? '1px solid #38bdf8' : '1px solid rgba(56, 189, 248, 0.35)',
                borderRadius: 8,
                padding: '5px 10px',
                color: interiorViewMode === 'walk-in' ? '#ffffff' : '#38bdf8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                boxShadow: interiorViewMode === 'walk-in' ? '0 0 14px rgba(56, 189, 248, 0.6)' : 'none',
              }}
              title="Toggle First-Person Room Mode [V]"
            >
              <Compass size={14} />
              <span>{interiorViewMode === 'walk-in' ? 'Walk (FPS)' : 'Walk In'}</span>
            </button>

            <div style={{ width: 1, height: 18, background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

            <button
              type="button"
              onClick={() => setViewPreset('overview')}
              style={presetBtn(activePreset === 'overview')}
              title="3D Dollhouse Overview"
            >
              <Eye size={13} />
              <span>Overview</span>
            </button>

            <button
              type="button"
              onClick={() => setViewPreset('desks')}
              style={presetBtn(activePreset === 'desks')}
              title="Workstations & Live Code Monitors"
            >
              <Monitor size={13} />
              <span>Workstations</span>
            </button>

            <button
              type="button"
              onClick={() => setViewPreset('preview')}
              style={presetBtn(activePreset === 'preview')}
              title="Live Application & Terminal Viewport"
            >
              <Activity size={13} />
              <span>Live Preview</span>
            </button>

            <button
              type="button"
              onClick={() => setViewPreset('servers')}
              style={presetBtn(activePreset === 'servers')}
              title="Server & Cloud Infrastructure Pod"
            >
              <Server size={13} />
              <span>Server Pod</span>
            </button>

            <button
              type="button"
              onClick={() => setViewPreset('lounge')}
              style={presetBtn(activePreset === 'lounge')}
              title="Breakout Strategy & Coffee Lounge"
            >
              <Coffee size={13} />
              <span>Lounge</span>
            </button>

            <button
              type="button"
              onClick={() => setViewPreset('topdown')}
              style={presetBtn(activePreset === 'topdown')}
              title="Top-Down Blueprint Floorplan"
            >
              <LayoutGrid size={13} />
              <span>Top-Down</span>
            </button>
          </div>

          {/* ── ISLAND 3: Hands-On 360° Camera Controls (Manual Only — Never Spins Automatically!) ── */}
          <div style={islandBaseStyle}>
            <button
              type="button"
              onClick={() => rotateCamera(-Math.PI / 4)}
              title="Step Rotate Left 45°"
              style={navIconBtn(false)}
            >
              <RotateCcw size={13} />
            </button>

            <button
              type="button"
              onClick={() => rotateCamera(Math.PI / 4)}
              title="Step Rotate Right 45°"
              style={navIconBtn(false)}
            >
              <RotateCw size={13} />
            </button>

            {/* Hands-On 360° Manual Control Toggle (Opens/Closes Manual Orbit & Tilt Scrubber) */}
            <button
              type="button"
              onClick={() => {
                setActiveObjectInspection(null);
                if (interiorViewMode === 'walk-in') {
                  setInteriorViewMode('dollhouse');
                }
                setShowHandsOn360((v) => !v);
              }}
              title="Toggle Hands-On 360° Manual Orbit & Tilt Scrubber"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 28,
                padding: '0 10px',
                borderRadius: 8,
                border: showHandsOn360 ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.12)',
                background: showHandsOn360 ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                color: showHandsOn360 ? '#38bdf8' : '#e8edf5',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Sliders size={12} color={showHandsOn360 ? '#38bdf8' : '#cbd5e1'} />
              <span>360° Hands-On ({azimuthDeg}°)</span>
            </button>

            <button
              type="button"
              onClick={() => zoomCamera(0.82)}
              title="Zoom In"
              style={navIconBtn(false)}
            >
              <ZoomIn size={13} />
            </button>

            <button
              type="button"
              onClick={() => zoomCamera(1.22)}
              title="Zoom Out"
              style={navIconBtn(false)}
            >
              <ZoomOut size={13} />
            </button>

            <button
              type="button"
              onClick={resetCamera}
              title="Reset 3D Camera"
              style={navIconBtn(false)}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function navIconBtn(disabled: boolean): CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.12)',
    background: 'rgba(255, 255, 255, 0.06)',
    color: disabled ? 'rgba(232, 237, 245, 0.25)' : '#e8edf5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s ease',
  };
}

function presetBtn(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: active ? 'rgba(59, 130, 246, 0.28)' : 'rgba(255, 255, 255, 0.05)',
    border: active ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    padding: '5px 9px',
    color: active ? '#93c5fd' : '#cbd5e1',
    fontSize: 11,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };
}

const islandBaseStyle: CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'rgba(9, 13, 22, 0.94)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  borderRadius: 14,
  padding: '6px 10px',
  boxShadow: '0 16px 36px rgba(0, 0, 0, 0.7)',
  backdropFilter: 'blur(24px)',
  color: '#e8edf5',
  fontFamily: 'system-ui, sans-serif',
};
