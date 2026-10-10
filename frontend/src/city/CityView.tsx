// Developer City — CityView: the composition root of the city layer.
// Renders the R3F canvas (or the 2D fallback when WebGL is missing) plus
// every DOM overlay. All data flows: sidecar → feed/store → scene.
// No project or agent is hard-coded; everything is derived from state.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Canvas } from '@react-three/fiber';
import { useProjectsFeed } from '@/city/feed';
import { useCityStore } from '@/city/store';
import { useAgentSync } from '@/city/sync/agentSync';
import { CityScene } from '@/city/scene/CityScene';
import { TopBar } from '@/city/ui/TopBar';
import { ProjectPanel } from '@/city/ui/ProjectPanel';
import { BuildingEditor } from '@/city/ui/BuildingEditor';
import { AgentPanel } from '@/city/ui/AgentPanel';
import { FloorNav } from '@/city/ui/FloorNav';
import { FallbackMap } from '@/city/ui/FallbackMap';
import { CreateProjectModal } from '@/city/ui/CreateProjectModal';
import { BuildingContextMenu } from '@/city/ui/BuildingContextMenu';
import { interiorTarget, buildingFocusTarget } from '@/city/scene/CameraRig';
import { archetypeFor } from '@/city/scene/archetypes';
import { useWorkspaceSync } from '@/city/sync/workspaceSync';
import { useTheme } from '@/contexts/ThemeContext';
import type { TerminalEntry } from '@/types';
import type { Workspace } from '@/lib/workspace';
import type { Project } from '@/city/types';

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
}

export function CityView({ terminals, onContinue, onNewSession, onOpenTerminal, onToggleSidebar, workspaces = [], activeWorkspaceId = null, onToast }: CityViewProps) {
  useProjectsFeed();
  useAgentSync(terminals);
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
  const ctxProject = contextMenu ? projectsById[contextMenu.projectId] : null;

  const { theme: t } = useTheme();

  const enterBuilding = (p: Project) => {
    const base = archetypeFor(p.building.buildingStyle || p.type, p.type);
    const k = Math.max(0.4, Math.min(2.2, p.building.scale || 1));
    goInterior(p.id, 0, null);
    setCameraTarget(interiorTarget(p.plot, 0, base.floorH * k, base.depth * k));
  };

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
            shadows
            dpr={[1, 1.75]}
            camera={{ position: [60, 46, 60], fov: 45, near: 0.5, far: 700 }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            <CityScene />
          </Canvas>
        </div>
      ) : (
        <FallbackMap onContinue={onContinue} onEditBuilding={(p) => setEditing(p)} />
      )}

      <TopBar onToast={onToast} onNewProject={() => setCreating(true)} onToggleSidebar={onToggleSidebar} />

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
          <AgentPanel terminals={terminals} onOpenTerminal={onOpenTerminal} />
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
