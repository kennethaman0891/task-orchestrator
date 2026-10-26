// Developer City — ProjectBuilding: the reusable atom of the city.
// One component renders ANY project: archetype by type, colors by
// BuildingConfig (user → brand → theme cascade), logo/initials sign,
// status beacon. Externally it also hosts the plaza bots; internally it
// renders the active floor when entered. Never empty: defaults cascade.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Detailed, Html } from '@react-three/drei';
import { archetypeFor, useBuildingMaterials, windowGrid, type ArchetypeSpec } from './archetypes';
import { themeById } from '@/city/themes';
import { projectDisplayName, type AgentBot, type Project } from '@/city/types';
import { InteriorFloor } from './Interior';
import { useCityStore } from '@/city/store';
import { PlazaBots } from './Bots';
import { BuildingCustomModel } from './BuildingCustomModel';
import { imageBlobUrl } from '@/lib/api';
import { patchProject } from '@/city/api';
import { GRID_SIZE, GRID_SPACING, plotWorldPosition } from './CityGrid';

export interface ProjectBuildingProps {
  project: Project;
  /** World position of this plot's centre */
  position: [number, number, number];
  selected?: boolean;
  dimmed?: boolean;
  agentActive?: boolean;
  /** When entered (interior nav), the floor to show inside. null = exterior. */
  interiorFloor?: number | null;
  agents?: AgentBot[];
  /** True when this building is the user's current workspace (sidebar) */
  workspaceActive?: boolean;
  onPointerDown?: (e: any) => void;
  onDoubleClick?: (e: any) => void;
}

function healthColor(p: Project): string {
  if (p.status === 'archived') return '#6b7280';
  if (p.health === 'failed') return '#f43f5e';
  if (p.health === 'degraded') return '#f59e0b';
  if (p.status === 'paused') return '#94a3b8';
  return '#22c55e';
}

/** Screen pixels of movement required before a press becomes a plot drag. */
const DRAG_THRESHOLD_PX = 6;

type SubBuildingSpec = { name?: string; dx: number; dz: number };

/** Absent, undefined, or non-array → nothing. Bad entries are skipped. */
function readSubBuildings(building: Project['building']): SubBuildingSpec[] {
  const raw = (building as { subBuildings?: unknown }).subBuildings;
  if (!Array.isArray(raw)) return [];
  const out: SubBuildingSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { name?: unknown; dx?: unknown; dz?: unknown };
    const dx = typeof rec.dx === 'number' ? rec.dx : Number(rec.dx);
    const dz = typeof rec.dz === 'number' ? rec.dz : Number(rec.dz);
    out.push({
      name: typeof rec.name === 'string' ? rec.name : undefined,
      dx: Number.isFinite(dx) ? dx : 0,
      dz: Number.isFinite(dz) ? dz : 0,
    });
  }
  return out;
}

function nearestPlot(wx: number, wz: number): { x: number; y: number } {
  const half = ((GRID_SIZE - 1) * GRID_SPACING) / 2;
  const x = Math.round((wx + half) / GRID_SPACING);
  const y = Math.round((wz + half) / GRID_SPACING);
  return {
    x: Math.min(GRID_SIZE - 1, Math.max(0, x)),
    y: Math.min(GRID_SIZE - 1, Math.max(0, y)),
  };
}

function plotTakenByOther(
  projects: Record<string, Project>,
  selfId: string,
  cell: { x: number; y: number },
): boolean {
  for (const p of Object.values(projects)) {
    if (!p || p.id === selfId || !p.plot) continue;
    if (p.plot.x === cell.x && p.plot.y === cell.y) return true;
  }
  return false;
}

type OrbitLike = { enabled?: boolean };

/** Canvas texture: logo image if available, else brand-color initials. */
function useSignTexture(project: Project, themeId: string, signBg?: string | null): THREE.CanvasTexture {
  const b = project.building;
  const texture = useMemo(() => {
    const t = themeById(themeId);
    const bg = signBg || t.trim;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = t.accent;
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initials = (projectDisplayName(project).slice(0, 2).toUpperCase() || '??');
    ctx.fillText(initials, 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (b.logo) {
      const src = b.logo.startsWith('http') || b.logo.startsWith('blob:') || b.logo.startsWith('data:')
        ? b.logo
        : imageBlobUrl(b.logo);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          ctx.clearRect(0, 0, 128, 128);
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, 128, 128);
          const s = Math.min(112, Math.min(img.width, img.height));
          ctx.drawImage(img, 64 - s / 2, 64 - s / 2, s, s);
          ctx.fillStyle = t.accent;
          ctx.font = 'bold 18px sans-serif';
          ctx.fillText(initials, 64, 112);
          tex.needsUpdate = true;
        } catch { /* keep initials on tainted canvas */ }
      };
      img.src = src;
    }
    return tex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.logo, themeId, signBg]);
  return texture;
}

function WindowInstances({ spec, glass }: { spec: ArchetypeSpec; glass: THREE.MeshStandardMaterial }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const grid = useMemo(() => windowGrid(spec), [spec]);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    if (m.userData.initialized) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 0, 1);
    grid.positions.forEach((pos, i) => {
      q.setFromAxisAngle(up, grid.rotY[i]);
      mat.compose(pos, q, new THREE.Vector3(1, 1, 1));
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
    m.userData.initialized = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, grid.positions.length]}
      frustumCulled={false}
      userData={{ initialized: false }}
    >
      <boxGeometry args={[0.88, 0.68, 0.05]} />
      <primitive object={glass} attach="material" />
    </instancedMesh>
  );
}

function RoofFeature({ spec, accent, trim }: { spec: ArchetypeSpec; accent: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial }) {
  const top = spec.height;
  const strobeRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (strobeRef.current) {
      // Realistic sharp double-strobe aviation pulse
      const t = clock.elapsedTime * 2.5;
      const flash = Math.sin(t) > 0.82 || (Math.sin(t * 1.5) > 0.88 && Math.sin(t) > 0.5) ? 3.0 : 0.2;
      (strobeRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = flash;
    }
  });

  return (
    <group position={[0, top, 0]}>
      {/* ── Standard Mechanical Rooftop Penthouse & HVAC on all buildings ── */}
      <mesh position={[0, 0.6, 0]} material={trim} castShadow>
        <boxGeometry args={[spec.width * 0.44, 1.2, spec.depth * 0.44]} />
      </mesh>
      {/* HVAC circular chiller fans */}
      <mesh position={[-spec.width * 0.12, 1.22, 0]} material={accent}>
        <cylinderGeometry args={[0.35, 0.38, 0.2, 12]} />
      </mesh>
      <mesh position={[spec.width * 0.12, 1.22, 0]} material={accent}>
        <cylinderGeometry args={[0.35, 0.38, 0.2, 12]} />
      </mesh>

      {/* ── Signature Architectural Crown Features ───────────────────────── */}
      {spec.feature === 'clockTower' && (
        <group position={[0, 1.2, 0]}>
          <mesh position={[0, 1.2, 0]} material={accent}>
            <cylinderGeometry args={[0.9, 1.1, 2.4, 8]} />
          </mesh>
          <mesh position={[0, 3.0, 0]} material={trim}>
            <coneGeometry args={[1.2, 1.4, 8]} />
          </mesh>
          <mesh position={[0, 4.0, 0]} ref={strobeRef}>
            <sphereGeometry args={[0.18, 8, 8]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2.5} />
          </mesh>
        </group>
      )}

      {spec.feature === 'antenna' && (
        <group position={[0, 1.2, 0]}>
          <mesh position={[0, 1.8, 0]} material={trim}>
            <cylinderGeometry args={[0.06, 0.14, 3.6, 6]} />
          </mesh>
          <mesh position={[0, 3.7, 0]} ref={strobeRef}>
            <sphereGeometry args={[0.2, 8, 8]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2.5} />
          </mesh>
        </group>
      )}

      {spec.feature === 'beacon' && (
        <group position={[0, 1.2, 0]}>
          {/* Helipad ring on SaaS / Highrise roofs */}
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.4, 1.65, 24]} />
            <meshBasicMaterial color="#facc15" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 1.4, 0]} material={trim}>
            <cylinderGeometry args={[0.3, 0.45, 2.8, 8]} />
          </mesh>
          <mesh position={[0, 2.9, 0]} ref={strobeRef}>
            <sphereGeometry args={[0.28, 10, 10]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2.5} />
          </mesh>
        </group>
      )}

      {spec.feature === 'garden' && (
        <group position={[0, 0.05, 0]}>
          <mesh position={[0, 0.15, 0]} material={accent}>
            <boxGeometry args={[spec.width * 0.88, 0.3, spec.depth * 0.88]} />
          </mesh>
          <mesh position={[-spec.width * 0.22, 0.55, spec.depth * 0.18]} material={accent}>
            <sphereGeometry args={[0.55, 8, 8]} />
          </mesh>
          <mesh position={[spec.width * 0.22, 0.55, -spec.depth * 0.18]} material={accent}>
            <sphereGeometry args={[0.45, 8, 8]} />
          </mesh>
        </group>
      )}

      {spec.feature === 'awning' && (
        <mesh position={[0, 0.2, 0]} material={trim}>
          <boxGeometry args={[spec.width + 0.35, 0.4, spec.depth + 0.35]} />
        </mesh>
      )}

      {spec.feature === 'parapet' && (
        <mesh position={[0, 0.2, 0]} material={trim}>
          <boxGeometry args={[spec.width + 0.3, 0.4, spec.depth + 0.3]} />
        </mesh>
      )}
    </group>
  );
}

export function ProjectBuilding({
  project, position, selected, dimmed, agentActive,
  interiorFloor = null, agents = [],
  workspaceActive = false,
  onPointerDown, onDoubleClick,
}: ProjectBuildingProps) {
  const openContextMenu = useCityStore((s) => s.openContextMenu);
  const cityMood = useCityStore((s) => s.cityMood);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as OrbitLike | null;

  // Live override while dragging / until patchProject settles. null = plot prop.
  const [dragWorld, setDragWorld] = useState<[number, number, number] | null>(null);
  const dragWorldRef = useRef<[number, number, number] | null>(null);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const gesture = useRef({
    down: false,
    dragging: false,
    sx: 0,
    sy: 0,
    restoreControls: undefined as boolean | undefined,
  });
  const grabOffset = useRef({ x: 0, z: 0 });
  const moveToken = useRef(0);
  const detachListeners = useRef<(() => void) | null>(null);
  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hitPoint = useRef(new THREE.Vector3());

  const restoreOrbit = () => {
    const ctl = controlsRef.current;
    const prev = gesture.current.restoreControls;
    gesture.current.restoreControls = undefined;
    if (ctl && prev !== undefined) ctl.enabled = prev;
  };

  useEffect(() => () => {
    detachListeners.current?.();
    detachListeners.current = null;
    if (gesture.current.down) {
      gesture.current.down = false;
      gesture.current.dragging = false;
      restoreOrbit();
    }
  }, []);

  const handleContextMenu = (e: any) => {
    const ne = e.nativeEvent ?? e;
    ne.preventDefault?.();   // suppress WKWebView native menu
    e.stopPropagation();
    openContextMenu(project.id, ne.clientX, ne.clientY);
  };

  const groundHit = (clientX: number, clientY: number): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    ndc.current.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.current.setFromCamera(ndc.current, camera);
    return raycaster.current.ray.intersectPlane(groundPlane.current, hitPoint.current);
  };

  // Press stays a click until the pointer moves past 6px, so double-click
  // still enters. Past that, the building follows the ground-plane hit and
  // orbit is stopped so the camera doesn't steal the gesture.
  const handlePointerDown = (e: any) => {
    const button = e.button ?? e.nativeEvent?.button ?? 0;
    if (button !== 0) {
      onPointerDown?.(e);
      return;
    }
    // Synthetic only — native pointerdown must still bubble so double-click
    // can enter. Orbit is paused via controls.enabled for this press.
    e.stopPropagation?.();
    const native = e.nativeEvent as PointerEvent | undefined;
    const sx = native?.clientX ?? e.clientX ?? 0;
    const sy = native?.clientY ?? e.clientY ?? 0;
    const ctl = controlsRef.current;
    gesture.current.down = true;
    gesture.current.dragging = false;
    gesture.current.sx = sx;
    gesture.current.sy = sy;
    gesture.current.restoreControls = ctl?.enabled;
    if (ctl) ctl.enabled = false;
    grabOffset.current.x = 0;
    grabOffset.current.z = 0;

    const el = gl.domElement;
    const pointerId = native?.pointerId;
    if (pointerId !== undefined) {
      try { el.setPointerCapture(pointerId); } catch { /* canvas already released */ }
    }
    const stopIfDragging = (ev: PointerEvent) => {
      if (!gesture.current.dragging) return;
      ev.stopPropagation();
    };
    const onMove = (ev: PointerEvent) => {
      if (!gesture.current.down) return;
      if (ev.pointerId !== undefined && native?.pointerId !== undefined && ev.pointerId !== native.pointerId) return;
      const dist = Math.hypot(ev.clientX - gesture.current.sx, ev.clientY - gesture.current.sy);
      if (!gesture.current.dragging) {
        if (dist <= DRAG_THRESHOLD_PX) return;
        gesture.current.dragging = true;
        const origin = dragWorldRef.current ?? position;
        const hit0 = groundHit(ev.clientX, ev.clientY);
        if (hit0) {
          grabOffset.current.x = origin[0] - hit0.x;
          grabOffset.current.z = origin[2] - hit0.z;
        }
      }
      stopIfDragging(ev);
      const hit = groundHit(ev.clientX, ev.clientY);
      if (!hit) return;
      const next: [number, number, number] = [
        hit.x + grabOffset.current.x,
        0,
        hit.z + grabOffset.current.z,
      ];
      dragWorldRef.current = next;
      setDragWorld(next);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== undefined && native?.pointerId !== undefined && ev.pointerId !== native.pointerId) return;
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onCancel, true);
      detachListeners.current = null;
      if (!gesture.current.down) return;
      const wasDrag = gesture.current.dragging;
      gesture.current.down = false;
      gesture.current.dragging = false;
      restoreOrbit();
      if (pointerId !== undefined) {
        try { el.releasePointerCapture(pointerId); } catch { /* already released */ }
      }
      if (!wasDrag) {
        onPointerDown?.(e);
        return;
      }
      const live = dragWorldRef.current;
      if (!live) {
        setDragWorld(null);
        return;
      }
      const cell = nearestPlot(live[0], live[2]);
      const projects = useCityStore.getState().projects;
      const cur = projects[project.id]?.plot ?? project.plot;
      if (cur && cur.x === cell.x && cur.y === cell.y) {
        dragWorldRef.current = null;
        setDragWorld(null);
        return;
      }
      if (plotTakenByOther(projects, project.id, cell)) {
        dragWorldRef.current = null;
        setDragWorld(null);
        return;
      }
      const snapped = plotWorldPosition(cell);
      dragWorldRef.current = snapped;
      setDragWorld(snapped);
      const token = ++moveToken.current;
      const projectId = project.id;
      void patchProject(projectId, { plot: { x: cell.x, y: cell.y } })
        .then((updated) => {
          if (moveToken.current !== token) return;
          useCityStore.getState().upsertProject(updated);
          if (dragWorldRef.current === snapped) {
            dragWorldRef.current = null;
            setDragWorld(null);
          }
        })
        .catch(() => {
          if (moveToken.current !== token) return;
          if (dragWorldRef.current === snapped) {
            dragWorldRef.current = null;
            setDragWorld(null);
          }
        });
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== undefined && native?.pointerId !== undefined && ev.pointerId !== native.pointerId) return;
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onCancel, true);
      detachListeners.current = null;
      gesture.current.down = false;
      gesture.current.dragging = false;
      restoreOrbit();
      if (pointerId !== undefined) {
        try { el.releasePointerCapture(pointerId); } catch { /* already released */ }
      }
      dragWorldRef.current = null;
      setDragWorld(null);
    };
    detachListeners.current?.();
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onCancel, true);
    detachListeners.current = () => {
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onCancel, true);
    };
  };

  const b = project.building;
  const subBuildings = readSubBuildings(b);
  const theme = themeById(b.theme);
  // Palette: 8 user color slots (see BuildingConfig.palette), empty slot = inherit.
  const pal = (i: number): string => b.palette?.[i] || '';
  // Color cascade: explicit user colors → brand-extracted → palette → theme.
  const facade = b.primaryColor || (b.brandColors?.primary ?? null) || pal(0) || theme.facade;
  const facadeDark = pal(1) || theme.facadeDark;
  const glass = b.secondaryColor || pal(2) || theme.glass;
  const accent = b.accentColor || (b.brandColors?.accent ?? null) || pal(3) || theme.accent;

  const spec = useMemo(() => {
    const s = archetypeFor(b.buildingStyle || project.type, project.type);
    const k = Math.max(0.4, Math.min(2.2, b.scale || 1));
    return { ...s, width: s.width * k, height: s.height * k, depth: s.depth * k, floorH: s.floorH * k };
  }, [b.buildingStyle, b.scale, project.type]);

  const mats = useBuildingMaterials(facade, facadeDark, glass, accent, {
    glow: pal(4) || undefined,
    signBg: pal(6) || undefined,
    trim: pal(7) || undefined,
  });
  const beacon = healthColor(project);
  const sign = useSignTexture(project, b.theme, pal(6) || null);
  const rot = ((b.rotation || 0) * Math.PI) / 180;

  const beaconRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (agentActive && beaconRef.current) {
      beaconRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.35);
    } else if (beaconRef.current) {
      beaconRef.current.scale.setScalar(1);
    }
  });

  const activeBots = agents.filter((a) => a.status !== 'offline');
  const exterior = interiorFloor === null;

  const tower = exterior ? (
    <group rotation={[0, rot, 0]}>
      {/* ── Main Tower Structural Shaft ────────────────────────── */}
      <mesh
        position={[0, spec.height / 2, 0]}
        material={mats.wall}
        castShadow
        receiveShadow
        onPointerDown={handlePointerDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={handleContextMenu}
        frustumCulled={false}
      >
        <boxGeometry args={[spec.width, spec.height, spec.depth]} />
      </mesh>

      {/* ── Corner Structural Pilasters (Vertical Mullions) ───── */}
      {[
        [-spec.width / 2, -spec.depth / 2],
        [spec.width / 2, -spec.depth / 2],
        [-spec.width / 2, spec.depth / 2],
        [spec.width / 2, spec.depth / 2],
      ].map(([cx, cz], ci) => (
        <mesh key={`col-${ci}`} position={[cx, spec.height / 2, cz]} material={mats.trim} castShadow>
          <boxGeometry args={[0.26, spec.height, 0.26]} />
        </mesh>
      ))}

      {/* ── Horizontal Floor Slab Cornices ───────────────────── */}
      {Array.from({ length: Math.max(1, Math.floor(spec.height / spec.floorH) - 1) }, (_, fi) => (
        <mesh key={`slab-${fi}`} position={[0, (fi + 1) * spec.floorH, 0]} material={mats.wallDark}>
          <boxGeometry args={[spec.width + 0.14, 0.12, spec.depth + 0.14]} />
        </mesh>
      ))}

      {/* ── Heavy Beveled Ground Podium Foundation ─────────────── */}
      <mesh position={[0, 0.3, 0]} material={mats.wallDark} castShadow receiveShadow>
        <boxGeometry args={[spec.width + 0.85, 0.6, spec.depth + 0.85]} />
      </mesh>

      {/* ── Grand Entrance Lobby Portal & Cantilever Canopy ────── */}
      <group position={[0, 0, spec.depth / 2 + 0.04]}>
        <mesh position={[0, 1.35, 0.55]} material={mats.trim}>
          <boxGeometry args={[Math.min(3.2, spec.width * 0.6), 0.1, 1.1]} />
        </mesh>
        <mesh position={[0, 0.65, 0.01]} material={mats.glass}>
          <planeGeometry args={[Math.min(2.8, spec.width * 0.52), 1.25]} />
        </mesh>
      </group>

      <WindowInstances spec={spec} glass={mats.glass} />
      <RoofFeature spec={spec} accent={mats.accent} trim={mats.trim} />

      {b.customModel3d?.enabled && b.customModel3d?.imageUrl && (
        <BuildingCustomModel
          config={b.customModel3d}
          spec={spec}
          accentColor={accent}
          isNight={cityMood === 'night'}
        />
      )}

      {/* ── Illuminated Architectural Logo Sign with Beveled Frame ── */}
      {sign && (
        <group position={[0, spec.height * 0.55, spec.depth / 2 + 0.08]}>
          <mesh position={[0, 0, -0.02]} material={mats.trim}>
            <boxGeometry args={[Math.min(2.4, spec.width * 0.5) + 0.16, Math.min(2.4, spec.width * 0.5) + 0.16, 0.04]} />
          </mesh>
          <mesh frustumCulled={false}>
            <planeGeometry args={[Math.min(2.4, spec.width * 0.5), Math.min(2.4, spec.width * 0.5)]} />
            <meshStandardMaterial map={sign} transparent roughness={0.4} />
          </mesh>
        </group>
      )}
    </group>
  ) : (
    <group rotation={[0, rot, 0]}>
      {/* entered: roof + active floor interior */}
      <mesh position={[0, spec.height + 0.15, 0]} material={mats.trim} frustumCulled={false}>
        <boxGeometry args={[spec.width + 0.6, 0.3, spec.depth + 0.6]} />
      </mesh>
      <InteriorFloor
        project={project}
        floorIndex={interiorFloor}
        width={spec.width}
        depth={spec.depth}
        floorH={spec.floorH}
        agents={activeBots}
      />
      <RoofFeature spec={spec} accent={mats.accent} trim={mats.trim} />
    </group>
  );

  const detailed = (
    <>
      {tower}
      {/* status beacon on roof */}
      <mesh ref={beaconRef} position={[0, spec.height + (spec.feature === 'clockTower' ? 4.4 : spec.feature === 'antenna' ? 3.2 : 1.1), 0]}>
        <sphereGeometry args={[0.3, 10, 10]} />
        <meshStandardMaterial color={beacon} emissive={beacon} emissiveIntensity={agentActive ? 2.2 : 1.1} />
      </mesh>
      {/* user plaza ring (palette slot 5) */}
      {pal(5) && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(spec.width, spec.depth) * 0.55, Math.max(spec.width, spec.depth) * 0.8, 48]} />
          <meshBasicMaterial color={pal(5)} transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* selection ring */}
      {selected && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(spec.width, spec.depth) * 0.75, Math.max(spec.width, spec.depth) * 0.75 + 0.35, 40]} />
          <meshBasicMaterial color={accent} transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* plaza bots stand around the building */}
      {exterior && activeBots.length > 0 && <PlazaBots bots={activeBots} offset={selected ? 4 : 0} />}
      {subBuildings.map((sb, i) => (
        <group key={`${sb.name ?? 'sub'}-${i}`} position={[sb.dx, 0, sb.dz]}>
          <mesh
            position={[0, 1, 0]}
            material={mats.wall}
            castShadow
            receiveShadow
            frustumCulled={false}
            raycast={() => undefined}
          >
            <boxGeometry args={[1.4, 2, 1.4]} />
          </mesh>
          <Html position={[0, 2.45, 0]} center distanceFactor={40} pointerEvents="none" zIndexRange={[10, 0]}>
            <div
              style={{
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                fontSize: 10,
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                color: '#fff',
                textShadow: '0 1px 3px rgba(0,0,0,0.9)',
              }}
            >
              {sb.name ?? ''}
            </div>
          </Html>
        </group>
      ))}
    </>
  );

  return (
    <group position={dragWorld ?? position}>
        <Detailed distances={[0, 200]}>
          {detailed}
          {/* far LOD: single box, zero detail */}
          <group rotation={[0, rot, 0]}>
            <mesh position={[0, spec.height / 2, 0]} material={mats.wall} frustumCulled={false}
              onContextMenu={handleContextMenu}>
              <boxGeometry args={[spec.width, spec.height, spec.depth]} />
            </mesh>
          </group>
        </Detailed>
        {(selected || !dimmed) && (
          <Html position={[0, spec.height + 5.4, 0]} center distanceFactor={40} zIndexRange={[10, 0]}>
            <div
              style={{
                pointerEvents: 'none', whiteSpace: 'nowrap', textAlign: 'center',
                fontSize: 12, fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                opacity: dimmed ? 0.25 : 1, transition: 'opacity 0.3s',
              }}
            >
              <div style={{ fontWeight: 600, letterSpacing: 0.2 }}>{projectDisplayName(project)}</div>
              <div style={{ fontSize: 10, opacity: 0.75, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                {project.type}
              </div>
              {workspaceActive && (
                <div style={{
                  marginTop: 3, display: 'inline-block', padding: '1px 8px', borderRadius: 999,
                  background: 'rgba(34,197,94,0.22)', border: '1px solid rgba(34,197,94,0.65)',
                  color: '#86efac', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
                }}>
                  ● current workspace
                </div>
              )}
            </div>
          </Html>
        )}
    </group>
  );
}
