// Developer City — CityScene: everything INSIDE the R3F canvas.
// Reads visible projects + live agents from the store and places them.
// No project-specific logic lives here.

import { useMemo } from 'react';
import { useCityStore, visibleProjectIds } from '@/city/store';
import { relativeToProject } from '@/city/sync/plotDistrictSync';
import { moodById } from '@/city/themes';
import type { Project } from '@/city/types';
import { plotWorldPosition } from './CityGrid';
import { CityGrid } from './CityGrid';
import { CityRoads } from './CityRoads';
import { CityNature } from './CityNature';
import { CityAtmosphere } from './CityAtmosphere';
import { CitySky } from './CitySky';

import { ProjectBuilding } from './ProjectBuilding';
import { CameraRig, buildingFocusTarget, interiorTarget } from './CameraRig';
import { UserAvatar } from './UserAvatar';
import { fittedArchetype } from './plotFit';
import { TerminalCars } from './TerminalCars';
import { PlotRoads } from './PlotRoads';
import { RoadObstacles } from './RoadObstacles';
import { TrafficLights } from './TrafficLights';
import { CityVehicles } from './CityVehicles';
import { CityBirds } from './CityBirds';
import { TokenTrees } from './TokenTrees';
import { AgentStation } from './AgentStation';
import { ParkingLots } from './ParkingLots';

export function CityScene() {
  const projects = useCityStore((s) => s.projects);
  const order = useCityStore((s) => s.projectOrder);
  const filters = useCityStore((s) => s.filters);
  const agents = useCityStore((s) => s.agents);
  const nav = useCityStore((s) => s.nav);
  const activeWorkspacePath = useCityStore((s) => s.activeWorkspacePath);
  const cityMood = useCityStore((s) => s.cityMood);
  const mood = moodById(cityMood);
  const showNature = useCityStore((s) => s.showNature);
  const showTraffic = useCityStore((s) => s.showTraffic);
  const showBirds = useCityStore((s) => s.showBirds);
  const selectedProjectId = useCityStore((s) => s.selectedProjectId);
  const selectProject = useCityStore((s) => s.selectProject);
  const setCameraTarget = useCityStore((s) => s.setCameraTarget);
  const goInterior = useCityStore((s) => s.goInterior);
  const plotDistricts = useCityStore((s) => s.plotDistricts);
  const terminalCars = useCityStore((s) => s.terminalCars);

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

  const interiorProjectId = nav.mode === 'interior' ? nav.projectId : null;
  const interiorFloorIndex = nav.mode === 'interior' ? nav.floorIndex : null;

  // Ground tone follows the city mood (day = light plaza, night = dark base).
  const groundColor = mood.ground;

  const focusBuilding = (pp: Project) => {
    selectProject(pp.id);
    setCameraTarget(buildingFocusTarget(pp.plot));
  };
  const enterBuilding = (pp: Project) => {
    const fitted = fittedArchetype(pp.building.buildingStyle || pp.type, pp.type, pp.building.scale);
    goInterior(pp.id, 0, null);
    setCameraTarget(interiorTarget(pp.plot, 0, fitted.floorH, fitted.depth));
  };

  const isInterior = Boolean(interiorProjectId);

  return (
    <>
      {isInterior ? (
        <>
          <color attach="background" args={['#090d16']} />
          <ambientLight intensity={1.6} />
          {(() => {
            const activeProj = interiorProjectId ? projects[interiorProjectId] : null;
            if (!activeProj) return null;
            const pos = plotWorldPosition(activeProj.plot);
            const fitted = fittedArchetype(
              activeProj.building.buildingStyle || activeProj.type,
              activeProj.type,
              activeProj.building.scale,
            );
            const fy = (interiorFloorIndex ?? 0) * fitted.floorH;
            return (
              <group position={[pos[0], fy, pos[2]]}>
                <directionalLight
                  position={[4, 10, 6]}
                  intensity={1.8}
                  castShadow
                  shadow-mapSize-width={1024}
                  shadow-mapSize-height={1024}
                />
                <pointLight position={[-4, 5, -3]} intensity={0.9} color="#e0f2fe" />
                <pointLight position={[3, 4, 3]} intensity={0.6} color="#fef08a" />
              </group>
            );
          })()}
        </>
      ) : (
        <>
          <color attach="background" args={[mood.sky]} />
          <fog attach="fog" args={[mood.fog, mood.fogNear, mood.fogFar]} />
          <hemisphereLight args={[mood.hemiSky, mood.hemiGround, mood.hemiIntensity]} />
          <ambientLight intensity={mood.ambient} />
          <CitySky />

          <CityGrid projects={visible} groundColor={groundColor} />
          <CityRoads />
          {showTraffic && <CityVehicles />}
          {showBirds && <CityBirds />}
          {showNature && <CityNature projects={visible} />}
          <CityAtmosphere />
          <UserAvatar />

          {visible.map((p) => {
            const rootName = p.path.split('/').filter(Boolean).pop() || p.name || 'project';
            const position = plotWorldPosition(p.plot);
            const district = plotDistricts[p.id];
            const activeCar = Object.values(terminalCars).find((car) => car.projectId === p.id && car.moving)
              ?? Object.values(terminalCars).find((car) => car.projectId === p.id);
            const activeRelative = activeCar ? relativeToProject(p.path, activeCar.cwd || p.path) : null;
            return (
              <group key={`district-${p.id}`}>
                <PlotRoads
                  projectId={p.id}
                  position={position}
                  rootName={rootName}
                  childNames={district?.dirs ?? []}
                  activeRelative={activeRelative}
                  onSelect={(segmentId, name, relative) => {
                    void segmentId;
                    const path = p.path + (relative ? `/${relative}` : '');
                    window.dispatchEvent(new CustomEvent('tto-road', { detail: { path, name } }));
                  }}
                />
                <RoadObstacles position={position} files={district?.files ?? []} />
              </group>
            );
          })}
        </>
      )}

      {visible
        .filter((p) => (!isInterior ? true : p.id === interiorProjectId))
        .map((p) => (
          <ProjectBuilding
            key={p.id}
            project={p}
            position={plotWorldPosition(p.plot)}
            interiorFloor={interiorProjectId === p.id ? interiorFloorIndex : null}
            agents={[]}
            agentActive={activePaths.has(p.path)}
            workspaceActive={!!activeWorkspacePath && activeWorkspacePath === p.path}
            selected={selectedProjectId === p.id}
            dimmed={selectedProjectId !== null && selectedProjectId !== p.id}
            onPointerDown={(e: any) => { e.stopPropagation(); focusBuilding(p); }}
            onDoubleClick={(e: any) => { e.stopPropagation(); enterBuilding(p); }}
          />
        ))}

      {!isInterior && (
        <>
          <ParkingLots />
          <TerminalCars />
          <TokenTrees />
          <AgentStation />
          <TrafficLights
            onOpen={(projectId) => {
              window.dispatchEvent(new CustomEvent('tto-light', { detail: { projectId } }));
            }}
          />
        </>
      )}

      <CameraRig />
    </>
  );
}
