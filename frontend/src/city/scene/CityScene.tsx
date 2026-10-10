// Developer City — CityScene: everything INSIDE the R3F canvas.
// Reads visible projects + live agents from the store and places them.
// No project-specific logic lives here.

import { useMemo } from 'react';
import { useCityStore, visibleProjectIds } from '@/city/store';
import { moodById } from '@/city/themes';
import type { AgentBot, Project } from '@/city/types';
import { plotWorldPosition } from './CityGrid';
import { CityGrid } from './CityGrid';
import { CityRoads } from './CityRoads';
import { CityNature } from './CityNature';
import { CityVehicles } from './CityVehicles';
import { CityBirds } from './CityBirds';
import { CityAtmosphere } from './CityAtmosphere';
import { CitySky } from './CitySky';

import { ProjectBuilding } from './ProjectBuilding';
import { CameraRig, buildingFocusTarget, interiorTarget } from './CameraRig';
import { UserAvatar } from './UserAvatar';
import { archetypeFor } from './archetypes';

export function CityScene() {
  const projects = useCityStore((s) => s.projects);
  const order = useCityStore((s) => s.projectOrder);
  const filters = useCityStore((s) => s.filters);
  const agents = useCityStore((s) => s.agents);
  const nav = useCityStore((s) => s.nav);
  const activeWorkspacePath = useCityStore((s) => s.activeWorkspacePath);
  const cityMood = useCityStore((s) => s.cityMood);
  const mood = moodById(cityMood);
  const showTraffic = useCityStore((s) => s.showTraffic);
  const showNature = useCityStore((s) => s.showNature);
  const showBirds = useCityStore((s) => s.showBirds);
  const selectProject = useCityStore((s) => s.selectProject);
  const setCameraTarget = useCityStore((s) => s.setCameraTarget);
  const goInterior = useCityStore((s) => s.goInterior);

  // Projects with at least one live, non-idle agent → beacons pulse.
  const activePaths = useMemo(() => {
    const s = new Set<string>();
    for (const a of Object.values(agents)) {
      if (a.status === 'offline' || a.status === 'idle') continue;
      s.add(a.projectPath);
    }
    return s;
  }, [agents]);

  const visible = useMemo(() => {
    const list = visibleProjectIds(projects, order, filters).map((id) => projects[id]).filter(Boolean);
    if (!filters.agentActive) return list;
    return list.filter((p) => activePaths.has(p.path));
  }, [projects, order, filters, activePaths]);

  // Per-project live agent lists (grouped by project path).
  const agentsByPath = useMemo(() => {
    const m = new Map<string, AgentBot[]>();
    for (const a of Object.values(agents)) {
      const list = m.get(a.projectPath) || [];
      list.push(a);
      m.set(a.projectPath, list);
    }
    return m;
  }, [agents]);

  const interiorProjectId = nav.mode === 'interior' ? nav.projectId : null;
  const interiorFloorIndex = nav.mode === 'interior' ? nav.floorIndex : null;

  // Ground tone follows the city mood (day = light plaza, night = dark base).
  const groundColor = mood.ground;

  const focusBuilding = (pp: Project) => {
    selectProject(pp.id);
    setCameraTarget(buildingFocusTarget(pp.plot));
  };
  const enterBuilding = (pp: Project) => {
    const base = archetypeFor(pp.building.buildingStyle || pp.type, pp.type);
    const k = Math.max(0.4, Math.min(2.2, pp.building.scale || 1));
    goInterior(pp.id, 0, null);
    setCameraTarget(interiorTarget(pp.plot, 0, base.floorH * k, base.depth * k));
  };

  return (
    <>
      <color attach="background" args={[mood.sky]} />
      <fog attach="fog" args={[mood.fog, mood.fogNear, mood.fogFar]} />

      <hemisphereLight args={[mood.hemiSky, mood.hemiGround, mood.hemiIntensity]} />
      <ambientLight intensity={mood.ambient} />
      <CitySky />

      <CityGrid projects={visible} groundColor={groundColor} />
      <CityRoads />
      {showNature && <CityNature projects={visible} />}
      {showTraffic && <CityVehicles />}
      {showBirds && <CityBirds />}
      <CityAtmosphere />
      <UserAvatar />

      {visible.map((p) => (
        <ProjectBuilding
          key={p.id}
          project={p}
          position={plotWorldPosition(p.plot)}
          interiorFloor={interiorProjectId === p.id ? interiorFloorIndex : null}
          agents={agentsByPath.get(p.path) || []}
          agentActive={activePaths.has(p.path)}
          workspaceActive={!!activeWorkspacePath && activeWorkspacePath === p.path}
          onPointerDown={(e: any) => { e.stopPropagation(); focusBuilding(p); }}
          onDoubleClick={(e: any) => { e.stopPropagation(); enterBuilding(p); }}
        />
      ))}

      <CameraRig />
    </>
  );
}
