// Developer City — CityView: the composition root of the city layer.
// Renders the R3F canvas (or the 2D fallback when WebGL is missing) plus
// every DOM overlay. All data flows: sidecar → feed/store → scene.
// No project or agent is hard-coded; everything is derived from state.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useProjectsFeed } from '@/city/feed';
import { useCityStore } from '@/city/store';
import { useAgentSync } from '@/city/sync/agentSync';
import { useTerminalCarSync } from '@/city/sync/terminalCarSync';
import { usePlotDistrictSync } from '@/city/sync/plotDistrictSync';
import { CityScene } from '@/city/scene/CityScene';
import { TopBar } from '@/city/ui/TopBar';
import { ProjectPanel } from '@/city/ui/ProjectPanel';
import { BuildingEditor } from '@/city/ui/BuildingEditor';
import { AgentPanel } from '@/city/ui/AgentPanel';
import { FloorNav } from '@/city/ui/FloorNav';
import { TerminalCarPanel } from '@/city/ui/TerminalCarPanel';
import { CarNav } from '@/city/ui/CarNav';
import { RoadGraphPanel } from '@/city/ui/RoadGraphPanel';
import { FallbackMap } from '@/city/ui/FallbackMap';
import { CreateProjectModal } from '@/city/ui/CreateProjectModal';
import { BuildingContextMenu } from '@/city/ui/BuildingContextMenu';
import { interiorTarget, buildingFocusTarget, carCabinTarget } from '@/city/scene/CameraRig';
import { carLocalTransform } from '@/city/scene/TerminalCars';
import { FloatingCityTerminal } from '@/city/ui/FloatingCityTerminal';
import { fittedArchetype } from '@/city/scene/plotFit';
import { useWorkspaceSync } from '@/city/sync/workspaceSync';
import { useTheme } from '@/contexts/ThemeContext';
import type { TerminalEntry } from '@/types';
import type { Workspace } from '@/lib/workspace';
import type { Project, TerminalCar } from '@/city/types';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

export interface CityViewProps {
  /** Live terminal map from the sidecar (refreshes every broadcast) */
  terminals: Record<string, TerminalEntry>;
  onContinue: (p: Project) => void;
  onNewSession: (p: Project) => void;
  onOpenTerminal: (terminalId: string) => void;
  /** Re-open the app sidebar (city overlays stay confined to the main pane) */
  onToggleSidebar?: () => void;
  /** Sidebar workspace list — auto-provisions city buildings (1 per projectPath) */
  workspaces?: Workspace[];
  /** The workspace currently open in the sidebar */
  activeWorkspaceId?: string | null;
  onToast?: (msg: string, error?: boolean) => void;
  onRenameCar?: (carId: string, name: string) => void;
}

export function CityView({ terminals, onContinue, onNewSession, onOpenTerminal, onToggleSidebar, workspaces = [], activeWorkspaceId = null, onToast, onRenameCar }: CityViewProps) {
  useProjectsFeed();
  useAgentSync(terminals);
  useTerminalCarSync(workspaces, terminals);
  usePlotDistrictSync();
  useWorkspaceSync(workspaces, activeWorkspaceId, onToast);

  // When the current workspace changes (or its building appears after
  // auto-provisioning), select it and fly the camera there — once per path.
  const activePath = useCityStore((s) => s.activeWorkspacePath);
  const projects = useCityStore((s) => s.projects);
  const selectProject = useCityStore((s) => s.selectProject);
  const setCameraTarget = useCityStore((s) => s.setCameraTarget);
  const focusedWsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activePath) {
      focusedWsRef.current = null;
      return;
    }
    if (focusedWsRef.current === activePath) return;
    const rec = Object.values(projects).find((pr) => pr.path === activePath);
    if (rec) {
      focusedWsRef.current = activePath;
      selectProject(rec.id);
      setCameraTarget(buildingFocusTarget(rec.plot));
    }
  }, [activePath, projects, selectProject, setCameraTarget]);

  const goCar = useCityStore((s) => s.goCar);
  const nav = useCityStore((s) => s.nav);
  const terminalCars = useCityStore((s) => s.terminalCars);
  const [roadGraph, setRoadGraph] = useState<{ path: string; name: string } | null>(null);
  const [lightProjectId, setLightProjectId] = useState<string | null>(null);
  const carProjectRef = useRef<string | null>(null);
  const interiorProjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (nav.mode === 'car') {
      carProjectRef.current = nav.projectId;
      return;
    }
    const left = carProjectRef.current;
    if (!left) return;
    carProjectRef.current = null;
    const rec = projects[left];
    if (rec) setCameraTarget(buildingFocusTarget(rec.plot));
  }, [nav, projects, setCameraTarget]);

  useEffect(() => {
    if (nav.mode === 'interior') {
      interiorProjectRef.current = nav.projectId;
      return;
    }
    const left = interiorProjectRef.current;
    if (!left) return;
    interiorProjectRef.current = null;
    const rec = projects[left];
    if (rec) setCameraTarget(buildingFocusTarget(rec.plot));
  }, [nav, projects, setCameraTarget]);

  useEffect(() => {
    const onRoad = (ev: Event) => {
      const detail = (ev as CustomEvent<{ path?: string; name?: string }>).detail;
      if (!detail?.path) return;
      setRoadGraph({ path: detail.path, name: detail.name ?? '' });
    };
    const onLight = (ev: Event) => {
      const detail = (ev as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId) return;
      setLightProjectId(detail.projectId);
    };
    window.addEventListener('tto-road', onRoad);
    window.addEventListener('tto-light', onLight);
    return () => {
      window.removeEventListener('tto-road', onRoad);
      window.removeEventListener('tto-light', onLight);
    };
  }, []);

  const webgl = useMemo(hasWebGL, []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const loaded = useCityStore((s) => s.loaded);
  const loadError = useCityStore((s) => s.loadError);
  const goInterior = useCityStore((s) => s.goInterior);
  const exitOneLevel = useCityStore((s) => s.exitOneLevel);
  const contextMenu = useCityStore((s) => s.contextMenu);
  const closeContextMenu = useCityStore((s) => s.closeContextMenu);
  const projectsById = useCityStore((s) => s.projects);
  const plotDistricts = useCityStore((s) => s.plotDistricts);
  const ctxProject = contextMenu ? projectsById[contextMenu.projectId] : null;

  const [floatingTerminalId, setFloatingTerminalId] = useState<string | null>(null);

  const { theme: t } = useTheme();

  const enterBuilding = (p: Project) => {
    const fitted = fittedArchetype(p.building.buildingStyle || p.type, p.type, p.building.scale);
    goInterior(p.id, 0, null);
    setCameraTarget(interiorTarget(p.plot, 0, fitted.floorH, fitted.depth));
  };

  const enterCar = (carId: string) => {
    const car = terminalCars[carId];
    if (!car) return;
    goCar(car.projectId, car.id, car.terminalId);
    const project = projects[car.projectId];
    if (!project) return;
    const dirs = plotDistricts[car.projectId]?.dirs ?? [];
    const transform = carLocalTransform(car, project, dirs);
    setCameraTarget(carCabinTarget(project.plot, transform));
    setFloatingTerminalId(car.terminalId || car.id);
  };

  const renameCar = (carId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Grid label is applied when a parent passes a rename.
    if (onRenameCar) onRenameCar(carId, trimmed);
    else writeCarName(carId, trimmed);
    const cars = useCityStore.getState().terminalCars;
    const car = cars[carId];
    if (!car || car.name === trimmed) return;
    useCityStore.getState().setTerminalCars(Object.values({ ...cars, [carId]: { ...car, name: trimmed } }));
  };

  const lightCars = lightProjectId
    ? Object.values(terminalCars).filter((car) => car.projectId === lightProjectId)
    : [];
  const lightWords = statementWords(lightCars);
  const lightQueue = lightCars.reduce((sum, car) => sum + (Number.isFinite(car.queueCount) ? car.queueCount : 0), 0);

  const rootStyle: CSSProperties = { position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' };

  if (!loaded && !loadError) {
    return (
      <div style={{ ...rootStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.colors.text.muted, fontSize: 13 }}>
        Loading city…
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      {webgl ? (
        <div style={{ position: 'absolute', inset: 0 }} onContextMenu={(e) => e.preventDefault()}>
          <Canvas
            shadows="soft"
            dpr={[1, 2]}
            camera={{ position: [60, 46, 60], fov: 42, near: 0.5, far: 800 }}
            gl={{
              antialias: true,
              powerPreference: 'high-performance',
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 1.15,
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            <CityScene />
          </Canvas>
        </div>
      ) : (
        <FallbackMap onContinue={onContinue} onEditBuilding={(p) => setEditing(p)} />
      )}

      {nav.mode !== 'interior' && (
        <TopBar onToast={onToast} onNewProject={() => setCreating(true)} onToggleSidebar={onToggleSidebar} />
      )}

      {webgl && (
        <>
          <ProjectPanel
            onContinue={onContinue}
            onNewSession={onNewSession}
            onEnterBuilding={enterBuilding}
            onEditBuilding={(p) => setEditing(p)}
            onToast={onToast}
          />
          <FloorNav onExitToWorkspace={exitOneLevel} />
          {nav.mode !== 'interior' && (
            <>
              <AgentPanel terminals={terminals} onOpenTerminal={(tid) => setFloatingTerminalId(tid)} />
              <TerminalCarPanel
                onOpenTerminal={(tid) => setFloatingTerminalId(tid)}
                onEnter={enterCar}
                onRename={renameCar}
              />
              <CarNav
                onToggleTerminal={() => {
                  if (floatingTerminalId) {
                    setFloatingTerminalId(null);
                  } else if (nav.mode === 'car') {
                    const car = Object.values(terminalCars).find((c) => c.id === nav.paneId)
                      ?? Object.values(terminalCars).find((c) => c.terminalId === nav.terminalId || c.id === nav.terminalId);
                    if (car) setFloatingTerminalId(car.terminalId || car.id);
                  }
                }}
                hasTerminalOpen={Boolean(floatingTerminalId)}
              />
            </>
          )}
          {floatingTerminalId && (() => {
            const floatingCar = Object.values(terminalCars).find(
              (c) => c.terminalId === floatingTerminalId || c.id === floatingTerminalId,
            );
            const termEntry = terminals[floatingTerminalId];
            return (
              <FloatingCityTerminal
                sessionId={floatingTerminalId}
                title={floatingCar?.name || termEntry?.pane_title || termEntry?.session_name || 'Terminal'}
                agentName={floatingCar?.agentName || termEntry?.agent}
                modelName={floatingCar?.modelName || termEntry?.model}
                status={floatingCar?.moving ? 'BUSY' : 'RUNNING'}
                onClose={() => setFloatingTerminalId(null)}
                onOpenInWorkspace={() => onOpenTerminal(floatingTerminalId)}
              />
            );
          })()}
          {roadGraph && (
            <RoadGraphPanel
              folderPath={roadGraph.path}
              folderName={roadGraph.name}
              onClose={() => setRoadGraph(null)}
            />
          )}
          {lightProjectId && (
            <LightSoonCard words={lightWords} queueCount={lightQueue} onClose={() => setLightProjectId(null)} />
          )}
        </>
      )}

      {ctxProject && contextMenu && (
        <BuildingContextMenu
          project={ctxProject}
          onClose={closeContextMenu}
          onToast={onToast}
          onContinue={(proj) => { onContinue(proj); closeContextMenu(); }}
          onNewSession={(proj) => { onNewSession(proj); closeContextMenu(); }}
          onEditBuilding={(proj) => { setEditing(proj); closeContextMenu(); }}
          screenPos={{ x: contextMenu.x, y: contextMenu.y }}
        />
      )}
      {editing && (
        <BuildingEditor project={editing} onToast={onToast} onClose={() => setEditing(null)} />
      )}
      {creating && (
        <CreateProjectModal onClose={() => setCreating(false)} onToast={onToast} />
      )}

      {loadError && (
        <div style={{
          position: 'absolute', top: 64, left: 12, zIndex: 40,
          background: 'rgba(60,20,20,0.9)', color: '#fca5a5',
          border: '1px solid rgba(244,63,94,0.4)', borderRadius: 10,
          padding: '8px 12px', fontSize: 12, maxWidth: 420,
        }}>
          City data unavailable ({loadError}). Retrying…
        </div>
      )}
    </div>
  );
}

function statementWords(cars: TerminalCar[]): string[] {
  const lines: string[] = [];
  if (cars.some((c) => c.batchDispatched)) lines.push('Batch dispatched');
  if (cars.some((c) => c.moving)) lines.push('Task running');
  if (cars.some((c) => c.queueCount > 0 || c.nextTask)) lines.push('Waiting in queue');
  if (lines.length === 0) lines.push('Stopped');
  return lines;
}

function writeCarName(paneId: string, name: string) {
  try {
    const raw = localStorage.getItem('tto-city-car-names');
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const map: Record<string, string> = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, string>) }
      : {};
    map[paneId] = name;
    localStorage.setItem('tto-city-car-names', JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function LightSoonCard({ words, queueCount, onClose }: { words: string[]; queueCount: number; onClose: () => void }) {
  const { theme: t } = useTheme();
  return (
    <div style={{
      position: 'absolute', top: 72, right: 12, zIndex: 32, width: 240,
      background: 'rgba(10,12,20,0.94)', color: t.colors.text.primary,
      border: `1px solid ${t.colors.border.primary}`, borderRadius: 10,
      padding: '10px 12px', fontSize: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>Coming soon</span>
        <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>
      <ul style={{ margin: '8px 0', paddingLeft: 16 }}>
        {words.map((word) => <li key={word}>{word}</li>)}
      </ul>
      <div style={{ color: t.colors.text.secondary, marginBottom: 8 }}>Queue {queueCount}</div>
      <button
        type="button"
        disabled
        style={{
          width: '100%',
          background: t.colors.bg.tertiary,
          color: t.colors.text.muted,
          border: `1px solid ${t.colors.border.primary}`,
          borderRadius: 8,
          padding: '7px 0',
          fontSize: 12,
          cursor: 'not-allowed',
        }}
      >
        Send batch — Coming soon
      </button>
    </div>
  );
}
