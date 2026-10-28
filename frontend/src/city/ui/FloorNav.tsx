// Developer City — FloorNav / InteriorHUD: Complete architectural HUD overlay for building interior.
// Provides top-level breadcrumb navigation, room zone switcher, multi-floor elevator stack,
// interactive 3D camera controls (orbit presets, 45° step rotation, zoom, reset), and a collapsible agent dock.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Terminal,
  Monitor,
  Server,
  Coffee,
  Eye,
  Layers,
  ExternalLink,
  Plus,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  LayoutGrid,
  Bot,
  X,
} from 'lucide-react';
import { useCityStore } from '@/city/store';
import { floorName, roomsOfFloor } from '@/city/scene/Interior';
import { interiorTarget, buildingFocusTarget } from '@/city/scene/CameraRig';
import { fittedArchetype } from '@/city/scene/plotFit';
import { plotWorldPosition } from '@/city/scene/CityGrid';
import type { AgentBot, Project } from '@/city/types';

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

  const [activePreset, setActivePreset] = useState<'overview' | 'desks' | 'servers' | 'lounge' | 'topdown'>('overview');
  const [yaw, setYaw] = useState<number>(0);
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
  const [showAgents, setShowAgents] = useState<boolean>(false);

  if (nav.mode !== 'interior') return null;
  const p = projects[nav.projectId];
  if (!p) return null;

  const fitted = fittedArchetype(p.building.buildingStyle || p.type, p.type, p.building.scale);
  const floorCount = Math.max(p.floors?.length || 0, fitted.slabs || 6);
  const rooms = roomsOfFloor(p, nav.floorIndex);

  // Active agents inside this project
  const projectAgents: AgentBot[] = Object.values(agents).filter(
    (a) => a.projectPath === p.path && a.status !== 'offline',
  );

  const flyToFloor = (i: number, preset: 'overview' | 'desks' | 'servers' | 'lounge' | 'topdown' = activePreset) => {
    goInterior(p.id, i, nav.room);
    setActivePreset(preset);
    setYaw(0);
    setZoomFactor(1.0);
    setCameraTarget(
      interiorTarget(p.plot, i, fitted.floorH, fitted.depth, preset),
    );
  };

  const setViewPreset = (preset: 'overview' | 'desks' | 'servers' | 'lounge' | 'topdown') => {
    setActivePreset(preset);
    setYaw(0);
    setZoomFactor(1.0);
    setCameraTarget(
      interiorTarget(p.plot, nav.floorIndex, fitted.floorH, fitted.depth, preset),
    );
  };

  // Interactive 3D step rotation around the floor center
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
    setViewPreset('overview');
  };

  const handleExit = () => {
    exitOneLevel();
    setCameraTarget(buildingFocusTarget(p.plot));
  };

  const currentFloorTitle = floorName(p, nav.floorIndex);

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
        {/* Left: Exit button & Project Identity */}
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
                background: '#3b82f6',
                boxShadow: '0 0 8px #3b82f6',
              }}
            />
            <span style={{ fontWeight: 700, color: '#f8fafc', letterSpacing: 0.2 }}>{p.name}</span>
            <span
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                padding: '2px 7px',
                borderRadius: 6,
                fontWeight: 600,
                letterSpacing: 0.5,
              }}
            >
              {p.type}
            </span>
            <span style={{ color: 'rgba(232, 237, 245, 0.4)' }}>/</span>
            <span style={{ color: '#93c5fd', fontWeight: 600 }}>{currentFloorTitle}</span>
          </div>
        </div>

        {/* Center: Segmented Room / Zone Switcher */}
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
          {rooms.map((r) => {
            const isMatch = nav.room === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => {
                  goInterior(p.id, nav.floorIndex, isMatch ? null : r);
                  if (r.toLowerCase().includes('server') || r.toLowerCase().includes('data') || r.toLowerCase().includes('cloud')) {
                    setViewPreset('servers');
                  } else if (r.toLowerCase().includes('lounge') || r.toLowerCase().includes('coffee') || r.toLowerCase().includes('visitor')) {
                    setViewPreset('lounge');
                  } else {
                    setViewPreset('desks');
                  }
                }}
                style={{
                  background: isMatch ? '#3b82f6' : 'rgba(255, 255, 255, 0.05)',
                  color: isMatch ? '#fff' : '#e2e8f0',
                  border: isMatch ? '1px solid #60a5fa' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 8,
                  padding: '5px 11px',
                  fontSize: 12,
                  fontWeight: isMatch ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isMatch ? '0 0 12px rgba(59, 130, 246, 0.5)' : 'none',
                }}
              >
                {r}
              </button>
            );
          })}
        </div>

        {/* Right: Collapsible Agent Drawer Toggle */}
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
                background: projectAgents.length > 0 ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 10,
                fontWeight: 700,
              }}
            >
              {projectAgents.length}
            </span>
          </button>
        </div>
      </div>

      {/* ── 2. Collapsible Agent & Terminal Dock (Right Side) ──────── */}
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
                  {projectAgents.length} live {projectAgents.length === 1 ? 'agent' : 'agents'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {onNewSession && (
                <button
                  type="button"
                  onClick={() => onNewSession(p)}
                  title="Spawn new agent session on this floor"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.35)',
                    borderRadius: 6,
                    padding: '4px 8px',
                    color: '#93c5fd',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={12} />
                  <span>Session</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowAgents(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(232, 237, 245, 0.5)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 2,
                }}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Agent Cards */}
          {projectAgents.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {projectAgents.map((agent) => {
                const statusColor =
                  agent.status === 'working'
                    ? '#22c55e'
                    : agent.status === 'thinking'
                    ? '#3b82f6'
                    : '#94a3b8';
                return (
                  <div
                    key={agent.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: statusColor,
                            boxShadow: `0 0 6px ${statusColor}`,
                          }}
                        />
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 12,
                            color: '#f1f5f9',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {agent.name}
                        </span>
                      </div>

                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: statusColor,
                          textTransform: 'uppercase',
                        }}
                      >
                        {agent.status}
                      </span>
                    </div>

                    {agent.currentTask && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'rgba(232, 237, 245, 0.75)',
                          lineHeight: 1.4,
                          wordBreak: 'break-word',
                        }}
                      >
                        {agent.currentTask}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      {agent.terminalId && onOpenTerminal && (
                        <button
                          type="button"
                          onClick={() => onOpenTerminal(agent.terminalId!)}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            background: '#3b82f6',
                            border: 'none',
                            borderRadius: 6,
                            padding: '5px 8px',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <Terminal size={12} />
                          <span>Terminal</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setViewPreset('desks')}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          background: 'transparent',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: 6,
                          padding: '5px 8px',
                          color: '#93c5fd',
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        <Eye size={12} />
                        <span>Focus Desk</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                padding: '16px 12px',
                textAlign: 'center',
                color: 'rgba(232, 237, 245, 0.5)',
                fontSize: 12,
                lineHeight: 1.5,
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: 10,
                border: '1px dashed rgba(255, 255, 255, 0.1)',
              }}
            >
              All systems running automated.
              <br />
              No agent bots stationed on this floor.
            </div>
          )}

          {onExitToWorkspace && (
            <button
              type="button"
              onClick={onExitToWorkspace}
              style={{
                marginTop: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#e8edf5',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <ExternalLink size={13} />
              <span>Open in Workspace</span>
            </button>
          )}
        </div>
      )}

      {/* ── 3. Bottom Multi-Floor Elevator & 3D Camera Dock ─────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 28,
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
          maxWidth: 'min(980px, calc(100% - 32px))',
          overflowX: 'auto',
        }}
      >
        {/* Elevator Floor Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'rgba(232, 237, 245, 0.45)',
              letterSpacing: 1,
              paddingRight: 2,
            }}
          >
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
            return (
              <button
                key={i}
                type="button"
                onClick={() => flyToFloor(i)}
                title={floorName(p, i)}
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

        {/* 3D Camera Angle Presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'rgba(232, 237, 245, 0.45)',
              letterSpacing: 1,
              paddingRight: 2,
            }}
          >
            CAMERA
          </span>

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

          <button
            type="button"
            onClick={() => setViewPreset('servers')}
            style={presetBtn(activePreset === 'servers')}
            title="Server & Cloud Pod"
          >
            <Server size={13} />
            <span>Server Pod</span>
          </button>

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
