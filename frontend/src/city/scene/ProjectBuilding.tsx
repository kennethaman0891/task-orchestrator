// Developer City — ProjectBuilding: the reusable atom of the city.
// One component renders ANY project: archetype by type, colors by
// BuildingConfig (user → brand → theme cascade), logo/initials sign,
// status beacon. Externally it also hosts the plaza bots; internally it
// renders the active floor when entered. Never empty: defaults cascade.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Detailed, Html } from '@react-three/drei';
import { useBuildingMaterials, windowGrid, windowPane, type ArchetypeSpec } from './archetypes';
import { fittedArchetype, PODIUM_OUTSET } from './plotFit';
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

function WindowInstances({
  spec,
  glass,
  glassDark,
  frame,
  sill,
  isNight,
}: {
  spec: ArchetypeSpec;
  glass: THREE.MeshStandardMaterial;
  glassDark: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  sill: THREE.MeshStandardMaterial;
  isNight: boolean;
}) {
  const frameRef = useRef<THREE.InstancedMesh>(null);
  const glassRef = useRef<THREE.InstancedMesh>(null);
  const glassDarkRef = useRef<THREE.InstancedMesh>(null);
  const mullionVRef = useRef<THREE.InstancedMesh>(null);
  const mullionHRef = useRef<THREE.InstancedMesh>(null);
  const sillRef = useRef<THREE.InstancedMesh>(null);
  const lintelRef = useRef<THREE.InstancedMesh>(null);
  const grid = useMemo(() => windowGrid(spec), [spec]);
  const pane = useMemo(() => windowPane(spec), [spec]);
  const count = Math.max(1, grid.positions.length);

  // Reset instance matrices & colors whenever geometry spec or Day/Night mood changes
  useEffect(() => {
    if (frameRef.current) {
      frameRef.current.userData.initialized = false;
    }
  }, [grid, pane, isNight]);

  useFrame(() => {
    const fm = frameRef.current;
    const gm = glassRef.current;
    const gdm = glassDarkRef.current;
    const mv = mullionVRef.current;
    const mh = mullionHRef.current;
    const sm = sillRef.current;
    const lm = lintelRef.current;
    if (!fm || !gm || !gdm || !mv || !mh || !sm || !lm) return;
    if (fm.userData.initialized) return;
    if (grid.positions.length === 0) {
      fm.userData.initialized = true;
      return;
    }

    const mat = new THREE.Matrix4();
    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(1, 1, 1);
    const outward = new THREE.Vector3();
    const placed = new THREE.Vector3();

    // Realistic sky-reflecting glass tints in daylight vs warm/cool office interiors at night
    const dayGlassColors = [
      new THREE.Color('#1d3b5c'),
      new THREE.Color('#23466b'),
      new THREE.Color('#2a527a'),
      new THREE.Color('#18324f'),
      new THREE.Color('#305a82'),
    ];
    const nightLitColors = [
      new THREE.Color('#fef3c7'),
      new THREE.Color('#fde68a'),
      new THREE.Color('#fed7aa'),
      new THREE.Color('#e0f2fe'),
      new THREE.Color('#fff7ed'),
    ];

    const place = (rot: number, pos: THREE.Vector3, push: number, yShift: number) => {
      q.setFromAxisAngle(up, rot);
      outward.set(Math.sin(rot), 0, Math.cos(rot));
      placed.copy(pos).addScaledVector(outward, push);
      placed.y += yShift;
      mat.compose(placed, q, scale);
    };

    grid.positions.forEach((pos, i) => {
      const rot = grid.rotY[i];
      const hash = Math.abs(Math.sin(pos.x * 12.9898 + pos.y * 78.233 + pos.z * 37.719));
      const isLitAtNight = hash > 0.34; // ~66% of rooms lit at night, ~34% dark

      place(rot, pos, 0, 0);
      fm.setMatrixAt(i, mat);

      place(rot, pos, 0.036, 0);
      if (isNight && !isLitAtNight) {
        gm.setMatrixAt(i, zeroMat);
        gdm.setMatrixAt(i, mat);
      } else {
        gm.setMatrixAt(i, mat);
        gdm.setMatrixAt(i, zeroMat);
      }

      place(rot, pos, 0.052, 0);
      mv.setMatrixAt(i, mat);
      mh.setMatrixAt(i, mat);

      // Architectural projecting sill below and subtle lintel above
      place(rot, pos, 0.038, -(pane.height / 2 + 0.04));
      sm.setMatrixAt(i, mat);
      place(rot, pos, 0.028, pane.height / 2 + 0.045);
      lm.setMatrixAt(i, mat);

      const palette = isNight ? nightLitColors : dayGlassColors;
      gm.setColorAt(i, palette[Math.floor(hash * 97) % palette.length]);
    });

    fm.instanceMatrix.needsUpdate = true;
    gm.instanceMatrix.needsUpdate = true;
    gdm.instanceMatrix.needsUpdate = true;
    mv.instanceMatrix.needsUpdate = true;
    mh.instanceMatrix.needsUpdate = true;
    sm.instanceMatrix.needsUpdate = true;
    lm.instanceMatrix.needsUpdate = true;
    if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
    fm.userData.initialized = true;
  });

  if (grid.positions.length === 0) return null;

  return (
    <group>
      {/* Dark anodized architectural window frame / shadow reveal */}
      <instancedMesh
        ref={frameRef}
        args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, count]}
        frustumCulled={false}
        userData={{ initialized: false }}
        castShadow
      >
        <boxGeometry args={[pane.width + 0.14, pane.height + 0.1, 0.045]} />
        <primitive object={frame} attach="material" />
      </instancedMesh>

      {/* Reflective (day) / illuminated (night) glass panes */}
      <instancedMesh
        ref={glassRef}
        args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, count]}
        frustumCulled={false}
      >
        <boxGeometry args={[pane.width, pane.height, 0.026]} />
        <primitive object={glass} attach="material" />
      </instancedMesh>

      {/* Unlit dark night panes (~34% of windows for authentic skyline variety) */}
      <instancedMesh
        ref={glassDarkRef}
        args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, count]}
        frustumCulled={false}
      >
        <boxGeometry args={[pane.width, pane.height, 0.026]} />
        <primitive object={glassDark} attach="material" />
      </instancedMesh>

      {/* Center vertical & horizontal anodized mullions */}
      <instancedMesh
        ref={mullionVRef}
        args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, count]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.036, pane.height, 0.018]} />
        <primitive object={frame} attach="material" />
      </instancedMesh>
      <instancedMesh
        ref={mullionHRef}
        args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, count]}
        frustumCulled={false}
      >
        <boxGeometry args={[pane.width, 0.032, 0.018]} />
        <primitive object={frame} attach="material" />
      </instancedMesh>

      {/* Stone / metal projecting sill & upper lintel */}
      <instancedMesh
        ref={sillRef}
        args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, count]}
        frustumCulled={false}
        castShadow
      >
        <boxGeometry args={[pane.width + 0.2, 0.055, 0.11]} />
        <primitive object={sill} attach="material" />
      </instancedMesh>
      <instancedMesh
        ref={lintelRef}
        args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, count]}
        frustumCulled={false}
      >
        <boxGeometry args={[pane.width + 0.16, 0.05, 0.085]} />
        <primitive object={sill} attach="material" />
      </instancedMesh>
    </group>
  );
}

function RoofFeature({
  spec,
  accent,
  trim,
  wallDark,
  roofDeck,
  frame,
  glass,
  signTex,
  hasCustomRooftop,
}: {
  spec: ArchetypeSpec;
  accent: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  wallDark: THREE.MeshStandardMaterial;
  roofDeck: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  signTex: THREE.CanvasTexture | null;
  hasCustomRooftop?: boolean;
}) {
  const top = spec.height;
  const strobeRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (strobeRef.current) {
      // Realistic sharp double-strobe aviation pulse
      const t = clock.elapsedTime * 2.5;
      const flash = Math.sin(t) > 0.82 || (Math.sin(t * 1.5) > 0.88 && Math.sin(t) > 0.5) ? 3.5 : 0.2;
      (strobeRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = flash;
    }
  });

  const phW = spec.width * 0.44;
  const phD = spec.depth * 0.44;
  const phH = 1.35;

  return (
    <group position={[0, top, 0]}>
      {/* ── Recessed Gravel/Bitumen Roof Deck ── */}
      <mesh position={[0, 0.02, 0]} material={roofDeck} receiveShadow>
        <boxGeometry args={[spec.width, 0.04, spec.depth]} />
      </mesh>

      {/* ── Perimeter Parapet Wall with Stone/Metal Coping ── */}
      {[-spec.depth / 2 + 0.1, spec.depth / 2 - 0.1].map((pz, i) => (
        <group key={`p-fb-${i}`} position={[0, 0.24, pz]}>
          <mesh material={wallDark} castShadow receiveShadow>
            <boxGeometry args={[spec.width, 0.48, 0.2]} />
          </mesh>
          <mesh position={[0, 0.26, 0]} material={trim}>
            <boxGeometry args={[spec.width + 0.08, 0.06, 0.26]} />
          </mesh>
        </group>
      ))}
      {[-spec.width / 2 + 0.1, spec.width / 2 - 0.1].map((px, i) => (
        <group key={`p-lr-${i}`} position={[px, 0.24, 0]}>
          <mesh material={wallDark} castShadow receiveShadow>
            <boxGeometry args={[0.2, 0.48, spec.depth - 0.4]} />
          </mesh>
          <mesh position={[0, 0.26, 0]} material={trim}>
            <boxGeometry args={[0.26, 0.06, spec.depth - 0.32]} />
          </mesh>
        </group>
      ))}

      {/* ── Architectural Mechanical Penthouse & Elevator Core ── */}
      <group position={[0, phH / 2, 0]}>
        <mesh material={wallDark} castShadow receiveShadow>
          <boxGeometry args={[phW, phH, phD]} />
        </mesh>
        {/* Penthouse cornice cap */}
        <mesh position={[0, phH / 2 + 0.04, 0]} material={trim}>
          <boxGeometry args={[phW + 0.14, 0.08, phD + 0.14]} />
        </mesh>
        {/* Side louver intake grilles */}
        {[-1, 1].map((side) => (
          <mesh key={`louver-${side}`} position={[side * (phW / 2 + 0.01), 0.05, 0]} rotation={[0, (side * Math.PI) / 2, 0]} material={frame}>
            <planeGeometry args={[phD * 0.56, 0.52]} />
          </mesh>
        ))}
        {/* Clean Penthouse Front Architectural Emblem (no window overlap!) */}
        {signTex && !hasCustomRooftop && (
          <group position={[0, 0.06, phD / 2 + 0.04]}>
            <mesh position={[0, 0, -0.015]} material={frame}>
              <boxGeometry args={[1.18, 1.18, 0.04]} />
            </mesh>
            <mesh position={[0, 0, -0.005]} material={accent}>
              <boxGeometry args={[1.22, 1.22, 0.018]} />
            </mesh>
            <mesh position={[0, 0, 0.015]} frustumCulled={false}>
              <planeGeometry args={[1.06, 1.06]} />
              <meshStandardMaterial map={signTex} transparent roughness={0.35} />
            </mesh>
          </group>
        )}
      </group>

      {/* ── Industrial HVAC Chillers with Dark Fan Shrouds ── */}
      {[-1, 1].map((side, idx) => (
        <group key={`hvac-${idx}`} position={[side * spec.width * 0.28, 0.32, spec.depth * 0.2]}>
          <mesh material={trim} castShadow receiveShadow>
            <boxGeometry args={[1.1, 0.64, 0.85]} />
          </mesh>
          <mesh position={[0, 0.34, 0]} material={frame}>
            <cylinderGeometry args={[0.32, 0.34, 0.08, 16]} />
          </mesh>
          <mesh position={[0, 0.385, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.26, 14]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.7} />
          </mesh>
        </group>
      ))}

      {/* ── Communications Dish on Back Corner ── */}
      <group position={[-spec.width * 0.28, 0.24, -spec.depth * 0.24]} rotation={[0.45, 0.65, 0]}>
        <mesh material={frame} castShadow>
          <cylinderGeometry args={[0.05, 0.07, 0.48, 8]} />
        </mesh>
        <mesh position={[0, 0.32, 0]} material={trim}>
          <sphereGeometry args={[0.36, 14, 14, 0, Math.PI * 2, 0, Math.PI / 2.2]} />
        </mesh>
      </group>

      {/* ── Signature Architectural Crown Features ───────────────────────── */}
      {spec.feature === 'clockTower' && (
        <group position={[0, phH, 0]}>
          {/* Brick/Stone Clock Turret */}
          <mesh position={[0, 1.05, 0]} material={trim} castShadow>
            <boxGeometry args={[1.7, 2.1, 1.7]} />
          </mesh>
          {/* 4-Sided Illuminated Clock Faces */}
          {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((ry, ci) => (
            <group key={`clk-${ci}`} position={[Math.sin(ry) * 0.87, 1.25, Math.cos(ry) * 0.87]} rotation={[0, ry, 0]}>
              <mesh material={frame}>
                <cylinderGeometry args={[0.46, 0.46, 0.05, 20]} />
              </mesh>
              <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.4, 20]} />
                <meshStandardMaterial color="#fefce8" emissive="#fef3c7" emissiveIntensity={0.35} roughness={0.4} />
              </mesh>
              {/* Clock hands */}
              <mesh position={[0, 0.09, 0.032]} material={frame}>
                <boxGeometry args={[0.035, 0.22, 0.015]} />
              </mesh>
              <mesh position={[0.08, 0, 0.032]} material={frame}>
                <boxGeometry args={[0.18, 0.035, 0.015]} />
              </mesh>
            </group>
          ))}
          {/* Steep Slate/Copper Cupola Spire */}
          <mesh position={[0, 2.85, 0]} rotation={[0, Math.PI / 4, 0]} material={frame} castShadow>
            <coneGeometry args={[1.45, 1.65, 4]} />
          </mesh>
          <mesh position={[0, 3.85, 0]} ref={strobeRef}>
            <sphereGeometry args={[0.16, 8, 8]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={3} />
          </mesh>
        </group>
      )}

      {spec.feature === 'antenna' && (
        <group position={[0, phH, 0]}>
          {/* Architectural Stepped Glass/Metal Crown */}
          <mesh position={[0, 0.45, 0]} material={glass} castShadow>
            <boxGeometry args={[phW * 0.65, 0.9, phD * 0.65]} />
          </mesh>
          <mesh position={[0, 0.92, 0]} material={frame}>
            <boxGeometry args={[phW * 0.7, 0.06, phD * 0.7]} />
          </mesh>
          {/* Tapered Communications Spire */}
          <mesh position={[0, 2.55, 0]} material={trim} castShadow>
            <cylinderGeometry args={[0.05, 0.16, 3.4, 8]} />
          </mesh>
          <mesh position={[0, 4.35, 0]} ref={strobeRef}>
            <sphereGeometry args={[0.18, 8, 8]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={3.5} />
          </mesh>
        </group>
      )}

      {spec.feature === 'beacon' && (
        <group position={[0, phH, 0]}>
          {/* Solid Helipad Deck atop Penthouse */}
          <mesh position={[0, 0.07, 0]} material={frame} castShadow receiveShadow>
            <cylinderGeometry args={[1.65, 1.75, 0.14, 24]} />
          </mesh>
          <mesh position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.15, 1.32, 32]} />
            <meshBasicMaterial color="#facc15" side={THREE.DoubleSide} />
          </mesh>
          {/* H marking */}
          <mesh position={[-0.28, 0.152, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.14, 0.85]} />
            <meshBasicMaterial color="#facc15" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0.28, 0.152, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.14, 0.85]} />
            <meshBasicMaterial color="#facc15" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.152, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6, 0.14]} />
            <meshBasicMaterial color="#facc15" side={THREE.DoubleSide} />
          </mesh>
          {/* Side Communications Mast */}
          <mesh position={[phW * 0.35, 1.25, -phD * 0.35]} material={trim}>
            <cylinderGeometry args={[0.05, 0.1, 2.5, 8]} />
          </mesh>
          <mesh position={[phW * 0.35, 2.55, -phD * 0.35]} ref={strobeRef}>
            <sphereGeometry args={[0.2, 10, 10]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={3.5} />
          </mesh>
        </group>
      )}

      {spec.feature === 'garden' && (
        <group position={[0, 0.06, 0]}>
          {/* Rooftop Pergola & Planter Terrace */}
          <mesh position={[-spec.width * 0.25, 0.18, -spec.depth * 0.22]} material={trim} castShadow>
            <boxGeometry args={[1.4, 0.32, 1.4]} />
          </mesh>
          <mesh position={[spec.width * 0.25, 0.18, -spec.depth * 0.22]} material={trim} castShadow>
            <boxGeometry args={[1.4, 0.32, 1.4]} />
          </mesh>
          {/* Realistic Greenery Planters */}
          <mesh position={[-spec.width * 0.25, 0.65, -spec.depth * 0.22]} castShadow>
            <dodecahedronGeometry args={[0.58, 1]} />
            <meshStandardMaterial color="#2e7d32" roughness={0.85} flatShading />
          </mesh>
          <mesh position={[spec.width * 0.25, 0.65, -spec.depth * 0.22]} castShadow>
            <dodecahedronGeometry args={[0.52, 1]} />
            <meshStandardMaterial color="#388e3c" roughness={0.85} flatShading />
          </mesh>
        </group>
      )}

      {spec.feature === 'awning' && (
        <group position={[0, phH, 0]}>
          {/* Commercial Glass Skylight Monitor */}
          <mesh position={[0, 0.22, 0]} material={glass} castShadow>
            <boxGeometry args={[phW * 0.72, 0.44, phD * 0.72]} />
          </mesh>
          <mesh position={[0, 0.46, 0]} material={frame}>
            <boxGeometry args={[phW * 0.76, 0.05, phD * 0.76]} />
          </mesh>
        </group>
      )}

      {spec.feature === 'parapet' && (
        <group position={[0, phH, 0]}>
          {/* Architectural Skylight Monitor */}
          <mesh position={[0, 0.18, 0]} material={glass}>
            <boxGeometry args={[phW * 0.62, 0.36, phD * 0.62]} />
          </mesh>
          <mesh position={[0, 0.38, 0]} material={frame}>
            <boxGeometry args={[phW * 0.66, 0.04, phD * 0.66]} />
          </mesh>
        </group>
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
  const lastPointerDownAt = useRef(0);
  const selectTimer = useRef<number | null>(null);
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
    if (selectTimer.current !== null) window.clearTimeout(selectTimer.current);
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
    const now = performance.now();
    const secondClick = now - lastPointerDownAt.current < 600;
    lastPointerDownAt.current = now;
    if (secondClick) {
      if (selectTimer.current !== null) {
        window.clearTimeout(selectTimer.current);
        selectTimer.current = null;
      }
      e.stopPropagation?.();
      onDoubleClick?.(e);
      return;
    }
    // Synthetic only — native pointerdown must still bubble so double-click
    // can enter. Orbit stays on until the pointer moves past the drag threshold.
    e.stopPropagation?.();
    const native = e.nativeEvent as PointerEvent | undefined;
    const sx = native?.clientX ?? e.clientX ?? 0;
    const sy = native?.clientY ?? e.clientY ?? 0;
    // A previous press can still be down if pointerup never reached the canvas.
    detachListeners.current?.();
    detachListeners.current = null;
    if (gesture.current.down) {
      gesture.current.down = false;
      gesture.current.dragging = false;
      restoreOrbit();
    }
    gesture.current.down = true;
    gesture.current.dragging = false;
    gesture.current.sx = sx;
    gesture.current.sy = sy;
    gesture.current.restoreControls = undefined;
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
        const ctlNow = controlsRef.current;
        gesture.current.restoreControls = ctlNow?.enabled;
        if (ctlNow) ctlNow.enabled = false;
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
      detachListeners.current?.();
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
        if (selectTimer.current !== null) window.clearTimeout(selectTimer.current);
        selectTimer.current = window.setTimeout(() => {
          selectTimer.current = null;
          onPointerDown?.(e);
        }, 520);
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
      detachListeners.current?.();
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
    const win = el.ownerDocument?.defaultView ?? window;
    win.addEventListener('pointerup', onUp, true);
    win.addEventListener('pointercancel', onCancel, true);
    el.addEventListener('pointermove', onMove, true);
    detachListeners.current = () => {
      el.removeEventListener('pointermove', onMove, true);
      win.removeEventListener('pointerup', onUp, true);
      win.removeEventListener('pointercancel', onCancel, true);
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

  const spec = useMemo(
    () => fittedArchetype(b.buildingStyle || project.type, project.type, b.scale),
    [b.buildingStyle, b.scale, project.type],
  );

  const styleKey = b.buildingStyle || project.type;
  const isNight = cityMood === 'night';
  const mats = useBuildingMaterials(facade, facadeDark, glass, accent, {
    glow: pal(4) || undefined,
    signBg: pal(6) || undefined,
    trim: pal(7) || undefined,
    style: styleKey,
    isNight,
  });
  const beacon = healthColor(project);
  const sign = useSignTexture(project, b.theme, pal(6) || null);
  const rot = ((b.rotation || 0) * Math.PI) / 180;
  const hasCustomRooftop = Boolean(
    b.customModel3d?.enabled &&
      b.customModel3d?.imageUrl &&
      (b.customModel3d.placement ?? 'rooftop') === 'rooftop',
  );

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
  const lobbyH = Math.max(0.95, spec.floorH * 0.74);
  const lobbyW = Math.min(2.4, spec.width * 0.38);

  const tower = exterior ? (
    <group
      rotation={[0, rot, 0]}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
    >
      {/* ── Main Tower Structural Shaft (Textured Architectural Cladding) ── */}
      <mesh
        position={[0, spec.height / 2, 0]}
        material={mats.wall}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[spec.width, spec.height, spec.depth]} />
      </mesh>

      {/* ── Corner Structural Pilasters (Slender Architectural Piers) ── */}
      {[
        [-spec.width / 2, -spec.depth / 2],
        [spec.width / 2, -spec.depth / 2],
        [-spec.width / 2, spec.depth / 2],
        [spec.width / 2, spec.depth / 2],
      ].map(([cx, cz], ci) => (
        <mesh key={`col-${ci}`} position={[cx, spec.height / 2, cz]} material={mats.trim} castShadow>
          <boxGeometry args={[0.22, spec.height, 0.22]} />
        </mesh>
      ))}

      {/* ── Intermediate Vertical Architectural Mullion Fins ────────────── */}
      {spec.width > 5.8 && (
        <>
          <mesh position={[-spec.width * 0.24, spec.height / 2, spec.depth / 2 + 0.015]} material={mats.trim} castShadow>
            <boxGeometry args={[0.1, spec.height, 0.07]} />
          </mesh>
          <mesh position={[spec.width * 0.24, spec.height / 2, spec.depth / 2 + 0.015]} material={mats.trim} castShadow>
            <boxGeometry args={[0.1, spec.height, 0.07]} />
          </mesh>
          <mesh position={[-spec.width * 0.24, spec.height / 2, -spec.depth / 2 - 0.015]} material={mats.trim} castShadow>
            <boxGeometry args={[0.1, spec.height, 0.07]} />
          </mesh>
          <mesh position={[spec.width * 0.24, spec.height / 2, -spec.depth / 2 - 0.015]} material={mats.trim} castShadow>
            <boxGeometry args={[0.1, spec.height, 0.07]} />
          </mesh>
        </>
      )}
      {spec.depth > 5.8 && (
        <>
          <mesh position={[spec.width / 2 + 0.015, spec.height / 2, -spec.depth * 0.24]} material={mats.trim} castShadow>
            <boxGeometry args={[0.07, spec.height, 0.1]} />
          </mesh>
          <mesh position={[spec.width / 2 + 0.015, spec.height / 2, spec.depth * 0.24]} material={mats.trim} castShadow>
            <boxGeometry args={[0.07, spec.height, 0.1]} />
          </mesh>
          <mesh position={[-spec.width / 2 - 0.015, spec.height / 2, -spec.depth * 0.24]} material={mats.trim} castShadow>
            <boxGeometry args={[0.07, spec.height, 0.1]} />
          </mesh>
          <mesh position={[-spec.width / 2 - 0.015, spec.height / 2, spec.depth * 0.24]} material={mats.trim} castShadow>
            <boxGeometry args={[0.07, spec.height, 0.1]} />
          </mesh>
        </>
      )}

      {/* Architectural stone/metal belt courses on floor lines */}
      {Array.from({ length: Math.max(1, Math.floor(spec.height / spec.floorH) - 1) }, (_, fi) => (
        <mesh key={`slab-${fi}`} position={[0, (fi + 1) * spec.floorH, 0]} material={mats.trim}>
          <boxGeometry args={[spec.width + 0.08, 0.055, spec.depth + 0.08]} />
        </mesh>
      ))}

      {/* Granite/stone ground plinth staying strictly within PODIUM_OUTSET */}
      <mesh position={[0, 0.18, 0]} material={mats.wallDark} castShadow receiveShadow>
        <boxGeometry args={[spec.width + PODIUM_OUTSET * 2, 0.36, spec.depth + PODIUM_OUTSET * 2]} />
      </mesh>
      <mesh position={[0, 0.38, 0]} material={mats.trim}>
        <boxGeometry args={[spec.width + PODIUM_OUTSET * 2 + 0.06, 0.05, spec.depth + PODIUM_OUTSET * 2 + 0.06]} />
      </mesh>

      {/* ── Upper Tower Architectural Crown Cornice ───────────────── */}
      <mesh position={[0, spec.height - 0.09, 0]} material={mats.trim} castShadow>
        <boxGeometry args={[spec.width + 0.26, 0.18, spec.depth + 0.26]} />
      </mesh>

      {/* ── Architectural Ground-Floor Lobby Portal & Storefront Bays ── */}
      {/* Entrance stays inside CANOPY_REACH (0.42) so it never covers the curb. */}
      <group position={[0, 0, spec.depth / 2 + 0.02]}>
        {/* Portal outer surround frame */}
        <mesh position={[0, 0.16 + lobbyH / 2, 0.02]} material={mats.windowFrame} castShadow>
          <boxGeometry args={[lobbyW + 0.24, lobbyH + 0.1, 0.08]} />
        </mesh>
        {/* Glazed double-door lobby interior */}
        <mesh position={[0, 0.16 + lobbyH / 2, 0.066]} material={mats.lobbyGlow}>
          <planeGeometry args={[lobbyW, lobbyH - 0.04]} />
        </mesh>
        {/* Center door mullion + transom bar */}
        <mesh position={[0, 0.16 + lobbyH / 2, 0.078]} material={mats.frame}>
          <boxGeometry args={[0.045, lobbyH - 0.04, 0.025]} />
        </mesh>
        <mesh position={[0, 0.16 + lobbyH * 0.72, 0.078]} material={mats.frame}>
          <boxGeometry args={[lobbyW, 0.04, 0.025]} />
        </mesh>
        {/* Cantilevered glass-and-steel entrance canopy */}
        <mesh position={[0, 0.18 + lobbyH, 0.18]} material={mats.trim} castShadow>
          <boxGeometry args={[lobbyW + 0.52, 0.06, 0.36]} />
        </mesh>
        {/* Subtle illuminated architectural canopy edge strip */}
        <mesh position={[0, 0.15 + lobbyH, 0.355]} material={mats.accent}>
          <boxGeometry args={[lobbyW + 0.48, 0.024, 0.02]} />
        </mesh>
        {/* Entrance steps */}
        <mesh position={[0, 0.04, 0.16]} material={mats.wallDark} receiveShadow>
          <boxGeometry args={[lobbyW + 0.48, 0.08, 0.32]} />
        </mesh>

        {/* Flanking street-level storefront display bays */}
        {spec.width >= 6.0 && (
          <>
            {[-1, 1].map((side) => {
              const bayX = side * spec.width * 0.34;
              const bayW = Math.min(1.45, spec.width * 0.2);
              const bayH = lobbyH * 0.72;
              return (
                <group key={`storefront-${side}`} position={[bayX, 0.24 + bayH / 2, 0.015]}>
                  <mesh material={mats.windowFrame}>
                    <boxGeometry args={[bayW + 0.12, bayH + 0.1, 0.05]} />
                  </mesh>
                  <mesh position={[0, 0, 0.032]} material={mats.lobbyGlow}>
                    <planeGeometry args={[bayW, bayH]} />
                  </mesh>
                  <mesh position={[0, 0, 0.042]} material={mats.frame}>
                    <boxGeometry args={[0.035, bayH, 0.02]} />
                  </mesh>
                  <mesh position={[0, -bayH / 2 - 0.04, 0.035]} material={mats.windowSill}>
                    <boxGeometry args={[bayW + 0.18, 0.05, 0.1]} />
                  </mesh>
                </group>
              );
            })}
          </>
        )}
      </group>

      <WindowInstances
        spec={spec}
        glass={mats.windowGlass}
        glassDark={mats.windowGlassDark}
        frame={mats.windowFrame}
        sill={mats.windowSill}
        isNight={isNight}
      />
      <RoofFeature
        spec={spec}
        accent={mats.accent}
        trim={mats.trim}
        wallDark={mats.wallDark}
        roofDeck={mats.roofDeck}
        frame={mats.frame}
        glass={mats.glass}
        signTex={sign}
        hasCustomRooftop={hasCustomRooftop}
      />

      {b.customModel3d?.enabled && b.customModel3d?.imageUrl && (
        <BuildingCustomModel
          config={b.customModel3d}
          spec={spec}
          accentColor={accent}
          isNight={isNight}
        />
      )}

      {/* ── Entrance Marquee Sign Badge (cleanly mounted above lobby canopy, never overlaps windows) ── */}
      {sign && (
        <group position={[0, 0.24 + lobbyH + 0.26, spec.depth / 2 + 0.09]}>
          <mesh position={[0, 0, -0.015]} material={mats.frame}>
            <boxGeometry args={[0.56, 0.56, 0.04]} />
          </mesh>
          <mesh position={[0, 0, 0.01]} frustumCulled={false}>
            <planeGeometry args={[0.48, 0.48]} />
            <meshStandardMaterial map={sign} transparent roughness={0.35} />
          </mesh>
        </group>
      )}
    </group>
  ) : (
    <group rotation={[0, rot, 0]}>
      {/* Lower floors podium (if active floor is above ground level) */}
      {interiorFloor > 0 && (
        <group position={[0, (interiorFloor * spec.floorH) / 2, 0]}>
          <mesh material={mats.wallDark} castShadow receiveShadow>
            <boxGeometry args={[spec.width + 0.2, interiorFloor * spec.floorH, spec.depth + 0.2]} />
          </mesh>
          <mesh position={[0, (interiorFloor * spec.floorH) / 2 - 0.05, 0]} material={mats.trim}>
            <boxGeometry args={[spec.width + 0.35, 0.1, spec.depth + 0.35]} />
          </mesh>
        </group>
      )}

      {/* Active Floor Interior */}
      <InteriorFloor
        project={project}
        floorIndex={interiorFloor}
        width={spec.width}
        depth={spec.depth}
        floorH={spec.floorH}
        agents={activeBots}
      />
    </group>
  );

  const detailed = (
    <>
      {tower}
      {/* status beacon on roof corner mast (never collides with clock tower / helipad) */}
      {exterior && (
        <group position={[spec.width * 0.34, spec.height, spec.depth * 0.34]}>
          <mesh position={[0, 0.35, 0]} material={mats.frame}>
            <cylinderGeometry args={[0.04, 0.06, 0.7, 8]} />
          </mesh>
          <mesh ref={beaconRef} position={[0, 0.76, 0]}>
            <sphereGeometry args={[0.2, 10, 10]} />
            <meshStandardMaterial color={beacon} emissive={beacon} emissiveIntensity={agentActive ? 2.2 : 1.1} />
          </mesh>
        </group>
      )}
      {/* user plaza ring (palette slot 5) */}
      {exterior && pal(5) && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(spec.width, spec.depth) * 0.55, Math.max(spec.width, spec.depth) * 0.8, 48]} />
          <meshBasicMaterial color={pal(5)} transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* selection ring */}
      {exterior && selected && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(spec.width, spec.depth) * 0.75, Math.max(spec.width, spec.depth) * 0.75 + 0.35, 40]} />
          <meshBasicMaterial color={accent} transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* plaza bots stand around the building */}
      {exterior && activeBots.length > 0 && <PlazaBots bots={activeBots} offset={selected ? 4 : 0} />}
      {exterior && subBuildings.map((sb, i) => (
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
          <Html position={[0, 2.45, 0]} center distanceFactor={40} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
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
        <Detailed distances={[0, 260]}>
          {detailed}
          {/* far LOD: single box, zero detail */}
          <group rotation={[0, rot, 0]}>
            <mesh position={[0, spec.height / 2, 0]} material={mats.wall} frustumCulled={false}
              onPointerDown={handlePointerDown}
              onContextMenu={handleContextMenu}>
              <boxGeometry args={[spec.width, spec.height, spec.depth]} />
            </mesh>
          </group>
        </Detailed>
        {exterior && (selected || !dimmed) && (
          <Html position={[0, spec.height + 5.4, 0]} center distanceFactor={40} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
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
