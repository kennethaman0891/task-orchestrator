// Developer City — FloorNav / InteriorHUD: Complete architectural HUD overlay for building interior.
// Provides top-level breadcrumb navigation, room zone switcher, multi-floor elevator stack,
// interactive 3D camera controls (orbit presets, 45° step rotation, zoom, reset),
// full-featured inside-the-room First-Person Walk-In navigation, and a collapsible agent dock.

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
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
} from 'lucide-react';
import { useCityStore } from '@/city/store';
import { floorName } from '@/city/scene/Interior';
import { interiorTarget, buildingFocusTarget } from '@/city/scene/CameraRig';
import { fittedArchetype } from '@/city/scene/plotFit';
import { plotWorldPosition } from '@/city/scene/CityGrid';
import type { AgentBot, Project, FloorPlanFloor } from '@/city/types';
import { useProjectFloorPlan, generateFallbackFloorPlan } from '@/city/utils/projectScanner';

export interface FloorNavProps {
  onExitToWorkspace?: () => void;
  onOpenTerminal?: (terminalId: string) => void;
  onNewSession?: (project: Project) => void;
}

export function FloorNav({ onExitToWorkspace, onOpenTerminal, onNewSession }: FloorNavProps) {
  const nav = useCityStore((s) => s.nav);
  const projects = useCityStore((s) => s.projects);
  const agents = useCityStore((s) => s.agents);
  const goInterior = useCityStore((s) => s.goInterior);
  const exitOneLevel = useCityStore((s) => s.exitOneLevel);
  const setCameraTarget = useCityStore((s) => s.setCameraTarget);
  const interiorViewMode = useCityStore((s) => s.interiorViewMode);
  const setInteriorViewMode = useCityStore((s) => s.setInteriorViewMode);

  const [activePreset, setActivePreset] = useState<'overview' | 'walkin' | 'desks' | 'servers' | 'blueprint' | 'lounge' | 'topdown'>('overview');
  const [yaw, setYaw] = useState<number>(0);
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
  const [showAgents, setShowAgents] = useState<boolean>(false);

  const isInterior = nav.mode === 'interior';
  const p = isInterior ? projects[nav.projectId] : null;
  const floorPlan = useProjectFloorPlan(p || null);

  const activePlanFloor: FloorPlanFloor =
    floorPlan?.floors?.[nav.mode === 'interior' ? nav.floorIndex : 0] ||
    floorPlan?.floors?.[0] ||
    (p ? generateFallbackFloorPlan(p).floors[0] : null as any);

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
  }, [isInterior, interiorViewMode]);

  if (!isInterior || !p) return null;

  const fitted = fittedArchetype(p.building.buildingStyle || p.type, p.type, p.building.scale);
  const floorCount = Math.max(floorPlan?.floors?.length || p.floors?.length || 0, fitted.slabs || 6);

  // Active agents inside this project
  const projectAgents: AgentBot[] = Object.values(agents).filter(
    (a) => a.projectPath === p.path && a.status !== 'offline',
  );

  const flyToFloor = (i: number, preset: 'overview' | 'walkin' | 'desks' | 'servers' | 'blueprint' | 'lounge' | 'topdown' = activePreset) => {
    goInterior(p.id, i, nav.room);
    setActivePreset(preset);
    setYaw(0);
    setZoomFactor(1.0);
    setCameraTarget(
      interiorTarget(p.plot, i, fitted.floorH, fitted.depth, preset),
    );
  };

  const setViewPreset = (preset: 'overview' | 'walkin' | 'desks' | 'servers' | 'blueprint' | 'lounge' | 'topdown') => {
    setActivePreset(preset);
    setYaw(0);
    setZoomFactor(1.0);
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

  // Interactive 3D step rotation around floor
  const rotateCamera = (deltaRad: number) => {
    const nextYaw = yaw + deltaRad;
    setYaw(nextYaw);

    const c = plotWorldPosition(p.plot);
    const fy = nav.floorIndex * fitted.floorH + 0.3;
    const baseDist = (activePreset === 'overview' ? 6.4 : 4.6) * zoomFactor;
    const height = (activePreset === 'overview' ? 4.4 : 2.2) * zoomFactor;

    const x = c[0] + Math.sin(nextYaw) * baseDist;
    const z = c[2] + Math.cos(nextYaw) * baseDist;
    const y = fy + height;

    setCameraTarget({
      x,
      y,
      z,
      lookX: c[0],
      lookY: fy + 0.8,
      lookZ: c[2],
    });
  };

  // Interactive 3D step zoom
  const zoomCamera = (factorDelta: number) => {
    const nextZoom = Math.min(1.8, Math.max(0.6, zoomFactor * factorDelta));
    setZoomFactor(nextZoom);

    const c = plotWorldPosition(p.plot);
    const fy = nav.floorIndex * fitted.floorH + 0.3;
    const baseDist = (activePreset === 'overview' ? 6.4 : 4.6) * nextZoom;
    const height = (activePreset === 'overview' ? 4.4 : 2.2) * nextZoom;

    const x = c[0] + Math.sin(yaw) * baseDist;
    const z = c[2] + Math.cos(yaw) * baseDist;
    const y = fy + height;

    setCameraTarget({
      x,
      y,
      z,
      lookX: c[0],
      lookY: fy + 0.8,
      lookZ: c[2],
    });
  };

  const resetCamera = () => {
    setYaw(0);
    setZoomFactor(1.0);
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
          gap: 12,
          pointerEvents: 'none',
        }}
      >
        {/* Left: Exit button & Real Project Identity */}
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

        {/* Center: Real Scanned Zones for this Floor */}
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
          <span style={{ fontSize: 11, color: 'rgba(232, 237, 245, 0.45)', padding: '0 6px', fontWeight: 700, letterSpacing: 0.8 }}>
            ZONES
          </span>
          {(activePlanFloor?.objects || []).slice(0, 4).map((obj) => {
            const isObjActive = nav.room === obj.id;
            return (
              <button
                key={obj.id}
                type="button"
                onClick={() => {
                  goInterior(p.id, nav.floorIndex, isObjActive ? null : obj.id);
                  if (obj.type === 'server_pod') setViewPreset('servers');
                  else if (obj.type === 'blueprint_board') setViewPreset('blueprint');
                  else if (obj.type === 'lounge') setViewPreset('lounge');
                  else setViewPreset('desks');
                }}
                style={{
                  background: isObjActive ? '#3b82f6' : 'rgba(255, 255, 255, 0.05)',
                  color: isObjActive ? '#fff' : '#e2e8f0',
                  border: isObjActive ? '1px solid #60a5fa' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 8,
                  padding: '5px 11px',
                  fontSize: 12,
                  fontWeight: isObjActive ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isObjActive ? '0 0 12px rgba(59, 130, 246, 0.5)' : 'none',
                }}
              >
                {obj.title.split(' ')[0]}
              </button>
            );
          })}
        </div>

        {/* Right: Active Agents Pill */}
        <div style={{ pointerEvents: 'auto' }}>
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
              color: projectAgents.length > 0 ? '#38bdf8' : '#94a3b8',
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
                background: projectAgents.length > 0 ? '#0284c7' : 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 10,
                fontWeight: 700,
              }}
            >
              {projectAgents.length}
            </span>
          </button>
        </div>
      </div>

      {/* ── 2. Collapsible Agent Dock (Right Side) ──────── */}
      {showAgents && (
        <div
          style={{
            position: 'absolute',
            top: 68,
            right: 14,
            width: 320,
            maxHeight: 'calc(100% - 150px)',
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
                  width: 24,
                  height: 24,
                  borderRadius: 6,
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
                  Floor {nav.floorIndex + 1} Agents
                </div>
                <div style={{ fontSize: 11, color: 'rgba(232, 237, 245, 0.5)' }}>
                  {projectAgents.length} active agents
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
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 11,
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

          {projectAgents.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
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
                    <span style={{ fontSize: 10, color: '#38bdf8' }}>{agent.model}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{agent.currentTask || 'Idle at workstation'}</div>
                  {onOpenTerminal && agent.terminalId && (
                    <button
                      type="button"
                      onClick={() => onOpenTerminal(agent.terminalId)}
                      style={{
                        marginTop: 4,
                        alignSelf: 'flex-start',
                        background: 'transparent',
                        border: 'none',
                        color: '#60a5fa',
                        fontSize: 11,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Open Terminal →
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '16px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
              Automated systems active.
              <br />
              No live agents stationed on this floor.
            </div>
          )}
        </div>
      )}

      {/* ── 3. Bottom Multi-Floor Elevator & Real 3D Inside-the-Room Controls ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 28,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          maxWidth: 'min(980px, calc(100% - 32px))',
        }}
      >
        {/* Floating Hint for First-Person Walk-In Mode */}
        {interiorViewMode === 'walk-in' && (
          <div
            style={{
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
              animation: 'pulse 2s infinite',
            }}
          >
            <Compass size={14} color="#38bdf8" />
            <span>Walk-In Mode Active · Use WASD / Arrows to walk · Drag to look around 360° · [V] Toggle Overview</span>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: 'rgba(9, 13, 22, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: 16,
            padding: '8px 16px',
            boxShadow: '0 20px 48px rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(24px)',
            color: '#e8edf5',
            fontFamily: 'system-ui, sans-serif',
            overflowX: 'auto',
          }}
        >
          {/* Elevator Floor Stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(232, 237, 245, 0.45)', letterSpacing: 1 }}>
              ELEVATOR
            </span>

            <button
              type="button"
              onClick={() => flyToFloor(Math.max(0, nav.floorIndex - 1))}
              disabled={nav.floorIndex === 0}
              title="Go down 1 floor"
              style={navIconBtn(nav.floorIndex === 0)}
            >
              <ChevronDown size={14} />
            </button>

            {Array.from({ length: floorCount }, (_, i) => {
              const isActive = nav.floorIndex === i;
              const fName = floorPlan?.floors?.[i]?.name || floorName(p, i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => flyToFloor(i)}
                  title={fName}
                  style={{
                    minWidth: 28,
                    height: 28,
                    borderRadius: 8,
                    border: isActive ? '1px solid #60a5fa' : '1px solid rgba(255, 255, 255, 0.1)',
                    background: isActive ? '#3b82f6' : 'rgba(255, 255, 255, 0.05)',
                    color: isActive ? '#fff' : '#cbd5e1',
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: isActive ? '0 0 12px rgba(59, 130, 246, 0.55)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {i + 1}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => flyToFloor(Math.min(floorCount - 1, nav.floorIndex + 1))}
              disabled={nav.floorIndex >= floorCount - 1}
              title="Go up 1 floor"
              style={navIconBtn(nav.floorIndex >= floorCount - 1)}
            >
              <ChevronUp size={14} />
            </button>
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255, 255, 255, 0.12)' }} />

          {/* 3D View Mode: Overview vs Walk Inside */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                padding: '5px 12px',
                color: interiorViewMode === 'walk-in' ? '#ffffff' : '#38bdf8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                boxShadow: interiorViewMode === 'walk-in' ? '0 0 14px rgba(56, 189, 248, 0.6)' : 'none',
              }}
              title="Step INSIDE the room in 3D first-person mode (WASD + Mouse)"
            >
              <Compass size={14} />
              <span>{interiorViewMode === 'walk-in' ? 'Inside Room (FPS)' : 'Walk Inside'}</span>
            </button>
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255, 255, 255, 0.12)' }} />

          {/* 3D Camera Waypoint Presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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
              title="Workstations & Monitors"
            >
              <Monitor size={13} />
              <span>Workstations</span>
            </button>

            {/* Dynamic Preset Button based on floor category */}
            {activePlanFloor?.category === 'docs' ? (
              <button
                type="button"
                onClick={() => setViewPreset('blueprint')}
                style={presetBtn(activePreset === 'blueprint')}
                title="Master Architecture Blueprint Wall"
              >
                <Layers size={13} />
                <span>Blueprint Wall</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setViewPreset('servers')}
                style={presetBtn(activePreset === 'servers')}
                title="Server & Cloud Pod"
              >
                <Server size={13} />
                <span>Server Pod</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setViewPreset('lounge')}
              style={presetBtn(activePreset === 'lounge')}
              title="Breakout Lounge & Coffee Bar"
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

          <div style={{ width: 1, height: 22, background: 'rgba(255, 255, 255, 0.12)' }} />

          {/* 3D Interactive Controls: Rotate Left/Right, Zoom In/Out, Reset */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              onClick={() => rotateCamera(-Math.PI / 4)}
              title="Rotate Left 45°"
              style={navIconBtn(false)}
            >
              <RotateCcw size={13} />
            </button>

            <button
              type="button"
              onClick={() => rotateCamera(Math.PI / 4)}
              title="Rotate Right 45°"
              style={navIconBtn(false)}
            >
              <RotateCw size={13} />
            </button>

            <button
              type="button"
              onClick={() => zoomCamera(0.85)}
              title="Zoom In"
              style={navIconBtn(false)}
            >
              <ZoomIn size={13} />
            </button>

            <button
              type="button"
              onClick={() => zoomCamera(1.2)}
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
    gap: 6,
    background: active ? 'rgba(59, 130, 246, 0.28)' : 'rgba(255, 255, 255, 0.05)',
    border: active ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    padding: '5px 10px',
    color: active ? '#93c5fd' : '#cbd5e1',
    fontSize: 11,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };
}
