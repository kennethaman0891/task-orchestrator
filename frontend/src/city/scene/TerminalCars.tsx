// Developer City — one car per live terminal.
// Parked cars line the sidewalk. A moving terminal sits on the local road
// beside its building. Clicks stay in the city; double-click enters the car.

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCityStore } from '@/city/store';
import type { CarSpec, Project, TerminalCar } from '@/city/types';
import { relativeToProject } from '@/city/sync/plotDistrictSync';
import { CarBody } from './CarBody';
import { CarInterior } from './CarInterior';
import { plotWorldPosition } from './CityGrid';
import { layoutDistrict, segmentForCwd } from './roadLayout';

const PLOT_LIMIT = 5.8;

function clampPlot(n: number): number {
  if (n > PLOT_LIMIT) return PLOT_LIMIT;
  if (n < -PLOT_LIMIT) return -PLOT_LIMIT;
  return n;
}

function normPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Returns [dx, dy, dz, rotY] offset from the plot centre.
 * Parked: dedicated parking bays in the front plaza (Z = 5.2) or east wing (X = 5.2),
 * safely outside the building footprint.
 * Moving: the folder road segment for this terminal's cwd.
 */
function carLocalTransform(car: TerminalCar, project: Project, dirs: string[]): [number, number, number, number] {
  if (!car.moving) {
    const slot = Math.max(0, Math.trunc(Number(car.slotIndex)) || 0);
    if (slot < 4) {
      // 4 Front Parking Bays facing the road (Z = 5.2, X in [-2.7, -0.9, 0.9, 2.7])
      const x = ((slot % 4) - 1.5) * 1.8;
      const z = 5.2;
      return [clampPlot(x), 0, clampPlot(z), 0];
    }
    // East Wing Parking Bays (X = 5.2, Z in [-2.7, -0.9, 0.9, 2.7])
    const sideSlot = slot - 4;
    const x = 5.2;
    const z = ((sideSlot % 4) - 1.5) * 1.8;
    return [clampPlot(x), 0, clampPlot(z), Math.PI / 2];
  }

  const projectPath = project.path || car.projectPath;
  const rootName = normPath(projectPath).split('/').filter(Boolean).pop() || project.name || 'project';
  const relative = relativeToProject(projectPath, car.cwd || projectPath);
  const segments = layoutDistrict(project.id, rootName, dirs, relative);
  const seg = segmentForCwd(projectPath, normPath(car.cwd || projectPath), segments);
  if (!seg) return [0, 0, 5.0, 0];
  return [clampPlot(seg.x), 0, clampPlot(seg.z), seg.rotY];
}

function makeLabelTexture(label: string, width: number, height: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(2, Math.floor(height * 0.06));
    ctx.strokeRect(2, 2, width - 4, height - 4);
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = label.trim() ? label : ' ';
    let size = Math.floor(height * 0.58);
    ctx.font = `700 ${size}px sans-serif`;
    const maxWidth = width - 16;
    while (size > 8 && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = `700 ${size}px sans-serif`;
    }
    ctx.fillText(text, width / 2, height / 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Bumped when an effect claims a texture. StrictMode's extra cleanup runs
// before the re-subscribed effect, so disposal waits a microtask and only
// frees a texture that no newer effect still owns.
const labelEpoch = new WeakMap<THREE.CanvasTexture, number>();
let labelEpochClock = 0;

function useLabelTexture(label: string, width: number, height: number): THREE.CanvasTexture {
  const texture = useMemo(() => makeLabelTexture(label, width, height), [label, width, height]);

  useEffect(() => {
    const tex = texture;
    const token = ++labelEpochClock;
    labelEpoch.set(tex, token);
    return () => {
      queueMicrotask(() => {
        if (labelEpoch.get(tex) === token) {
          tex.dispose();
          labelEpoch.delete(tex);
        }
      });
    };
  }, [texture]);

  return texture;
}

function CarNameBoards({ name }: { name: string }) {
  const roofMap = useLabelTexture(name, 256, 64);
  const plateMap = useLabelTexture(name.trim().slice(0, 10), 160, 48);
  return (
    <>
      <mesh position={[0, 1.15, 0]} frustumCulled={false}>
        <boxGeometry args={[0.78, 0.16, 0.04]} />
        <meshBasicMaterial map={roofMap} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.35, -1.15]} frustumCulled={false}>
        <boxGeometry args={[0.48, 0.12, 0.028]} />
        <meshBasicMaterial map={plateMap} toneMapped={false} />
      </mesh>
    </>
  );
}

function TerminalCarNode({
  car,
  project,
  dirs,
  spec,
  selected,
  inside,
  onSelect,
  onEnter,
}: {
  car: TerminalCar;
  project: Project;
  dirs: string[];
  spec: CarSpec | null;
  selected: boolean;
  inside: boolean;
  onSelect: (id: string) => void;
  onEnter: (projectId: string, paneId: string, terminalId: string) => void;
}) {
  const world = plotWorldPosition(project.plot);
  const [dx, dy, dz, rotY] = carLocalTransform(car, project, dirs);
  const roll = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const group = roll.current;
    if (!group) return;
    group.position.z = car.moving ? Math.sin(clock.elapsedTime * 1.2 + car.slotIndex) * 0.45 : 0;
  });
  const select = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onSelect(car.id);
  };
  const enter = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onEnter(car.projectId, car.id, car.terminalId);
  };

  return (
    <group position={[world[0] + dx, dy, world[2] + dz]} rotation={[0, rotY, 0]}>
      <group ref={roll}>
      {inside ? <CarInterior car={car} /> : <CarBody color={car.color} spec={spec} moving={car.moving} />}
      <CarNameBoards name={car.name} />
      {selected && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.2, 1.42, 28]} />
          <meshBasicMaterial
            color={car.color}
            transparent
            opacity={0.9}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {!inside && (
        <mesh position={[0, 0.68, 0]} onPointerDown={select} onDoubleClick={enter}>
          <boxGeometry args={[1.7, 1.5, 2.9]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      </group>
    </group>
  );
}

export function TerminalCars() {
  const terminalCars = useCityStore((s) => s.terminalCars);
  const projects = useCityStore((s) => s.projects);
  const selectedTerminalCarId = useCityStore((s) => s.selectedTerminalCarId);
  const selectTerminalCar = useCityStore((s) => s.selectTerminalCar);
  const goCar = useCityStore((s) => s.goCar);
  const nav = useCityStore((s) => s.nav);
  const plotDistricts = useCityStore((s) => s.plotDistricts);
  const carSpecs = useCityStore((s) => s.carSpecs);

  const cars = Object.values(terminalCars).filter((car) => projects[car.projectId]);
  if (cars.length === 0) return null;

  return (
    <group>
      {cars.map((car) => {
        const project = projects[car.projectId];
        if (!project) return null;
        return (
          <TerminalCarNode
            key={car.id}
            car={car}
            project={project}
            dirs={plotDistricts[car.projectId]?.dirs ?? []}
            spec={carSpecs[car.id] ?? null}
            selected={car.id === selectedTerminalCarId}
            inside={nav.mode === 'car' && nav.paneId === car.id}
            onSelect={selectTerminalCar}
            onEnter={goCar}
          />
        );
      })}
    </group>
  );
}
