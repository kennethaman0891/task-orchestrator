// Developer City — InteriorFloor: High-end architectural 3D developer office interior.
// A dollhouse cutaway model featuring realistic developer workstations, dual curved monitors,
// glass-walled conference room, server pod with blinking LEDs, executive lounge, and elevator core.

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { AgentBot, FloorSpec, Project } from '@/city/types';
import { AgentBots } from './Bots';
import { themeById } from '@/city/themes';
import { useBuildingMaterials } from './archetypes';

const DEFAULT_FLOOR_THEMES = [
  { name: 'Lobby & Welcome Center', rooms: ['Reception', 'Visitor Lounge', 'Espresso Bar'] },
  { name: 'Developer Pod & AI Lab', rooms: ['Workstations', 'DevOps Cluster', 'Sprint Lounge'] },
  { name: 'Cloud Infrastructure & Data', rooms: ['Server Pod', 'Network NOC', 'Meeting Room'] },
  { name: 'Engineering & Architecture', rooms: ['Architecture Studio', 'Code Review Lab', 'Coffee Bar'] },
  { name: 'Product & Design Loft', rooms: ['UX Lab', 'Prototype Studio', 'Collaboration Hub'] },
  { name: 'Executive Suite & Boardroom', rooms: ['Boardroom', 'Skyline Terrace', 'Strategy Lounge'] },
];

export function floorName(p: Project, index: number): string {
  const f = p.floors?.[index];
  if (typeof f === 'string') return f;
  if ((f as FloorSpec)?.name) return (f as FloorSpec).name;
  const def = DEFAULT_FLOOR_THEMES[index % DEFAULT_FLOOR_THEMES.length];
  return `Floor ${index + 1} · ${def.name}`;
}

export function roomsOfFloor(p: Project, index: number): string[] {
  const f = p.floors?.[index];
  if (typeof f === 'string') return [f];
  if ((f as FloorSpec)?.rooms?.length) return (f as FloorSpec).rooms!;
  const def = DEFAULT_FLOOR_THEMES[index % DEFAULT_FLOOR_THEMES.length];
  return def.rooms;
}

/** Generates realistic architectural wide-plank oak flooring texture */
function makePlankTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  ctx.fillStyle = '#bfa175';
  ctx.fillRect(0, 0, 512, 512);

  const plankH = 64;
  for (let i = 0; i < 8; i++) {
    const y = i * plankH;
    ctx.fillStyle = i % 2 === 0 ? '#cbaf84' : '#b5976b';
    ctx.fillRect(0, y + 1, 512, plankH - 2);

    ctx.strokeStyle = 'rgba(78, 52, 24, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, y + 0.5, 512, plankH - 1);

    // Staggered vertical seams
    const offset = (i % 3) * 160 + 90;
    ctx.beginPath();
    ctx.moveTo(offset, y + 1);
    ctx.lineTo(offset, y + plankH - 1);
    ctx.stroke();

    // Subtle natural wood grain streaks
    ctx.fillStyle = 'rgba(255, 242, 225, 0.15)';
    ctx.fillRect(24, y + 12, 90, 2);
    ctx.fillRect(160, y + 36, 120, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.needsUpdate = true;
  return tex;
}

/** Generates a code editor texture for monitors */
function makeCodeTexture(accentColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  // Dark IDE editor background
  ctx.fillStyle = '#0f141c';
  ctx.fillRect(0, 0, 512, 256);

  // Window titlebar with macOS-style window controls
  ctx.fillStyle = '#181f2a';
  ctx.fillRect(0, 0, 512, 24);

  ctx.fillStyle = '#ef4444';
  ctx.beginPath(); ctx.arc(14, 12, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath(); ctx.arc(26, 12, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#10b981';
  ctx.beginPath(); ctx.arc(38, 12, 4, 0, Math.PI * 2); ctx.fill();

  // Active tab
  ctx.fillStyle = '#0f141c';
  ctx.fillRect(60, 4, 110, 20);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText('App.tsx', 75, 17);

  // Line numbers & syntax colored code lines
  const colors = [accentColor, '#38bdf8', '#a855f7', '#34d399', '#f472b6', '#fbbf24', '#e2e8f0'];
  for (let l = 0; l < 11; l++) {
    const y = 46 + l * 18;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.font = '11px monospace';
    ctx.fillText(String(l + 1).padStart(2, ' '), 12, y);

    // Indented code tokens
    let x = 40;
    const tokenCount = (l % 4) + 2;
    for (let t = 0; t < tokenCount; t++) {
      const len = 24 + ((l * 17 + t * 31) % 64);
      ctx.fillStyle = colors[(l + t) % colors.length];
      ctx.fillRect(x, y - 8, len, 9);
      x += len + 8;
    }
  }

  // Mini terminal footer
  ctx.fillStyle = '#090d14';
  ctx.fillRect(0, 220, 512, 36);
  ctx.fillStyle = '#22c55e';
  ctx.font = '10px monospace';
  ctx.fillText('● Ready · 0 errors · Vite 5.4.1 live sync', 14, 240);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Generates modern Calacatta marble texture for coffee tables */
function makeMarbleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(10, 40);
  ctx.bezierCurveTo(90, 80, 140, 160, 240, 220);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(217, 119, 6, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(100, 20);
  ctx.bezierCurveTo(130, 90, 70, 170, 180, 240);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function bayCenters(span: number): number[] {
  const count = Math.max(2, Math.min(4, Math.floor(span / 1.8)));
  const centers: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    centers.push(t * (span - 1.7));
  }
  return centers;
}

interface InteriorFloorProps {
  project: Project;
  floorIndex: number;
  width: number;
  depth: number;
  floorH: number;
  agents: AgentBot[];
  onSelectAgent?: (agentId: string) => void;
  onOpenTerminal?: (terminalId: string) => void;
}

export function InteriorFloor({
  project,
  floorIndex,
  width,
  depth,
  floorH,
  agents,
}: InteriorFloorProps) {
  const b = project.building;
  const theme = themeById(b.theme);
  const facade = b.primaryColor || theme.facade;
  const accent = b.accentColor || theme.accent;
  const mats = useBuildingMaterials(facade, theme.facadeDark, theme.glass, accent);

  // Blinking server rack LED references
  const ledRef1 = useRef<THREE.Mesh>(null);
  const ledRef2 = useRef<THREE.Mesh>(null);
  const ledRef3 = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ledRef1.current) {
      (ledRef1.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        Math.sin(t * 8) > 0.1 ? 2.5 : 0.3;
    }
    if (ledRef2.current) {
      (ledRef2.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        Math.cos(t * 6 + 1.2) > 0.2 ? 2.2 : 0.2;
    }
    if (ledRef3.current) {
      (ledRef3.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        Math.sin(t * 11 + 2.5) > 0.3 ? 2.8 : 0.4;
    }
  });

  const materials = useMemo(() => {
    const floorMap = makePlankTexture();
    const codeMap1 = makeCodeTexture(accent);
    const codeMap2 = makeCodeTexture('#38bdf8');
    const marbleMap = makeMarbleTexture();

    return {
      floorMap,
      codeMap1,
      codeMap2,
      marbleMap,
      woodFloor: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: floorMap,
        roughness: 0.65,
        metalness: 0.05,
      }),
      floorInlay: new THREE.MeshStandardMaterial({
        color: '#654827',
        roughness: 0.45,
      }),
      plaster: new THREE.MeshStandardMaterial({
        color: '#f8fafc',
        roughness: 0.88,
        metalness: 0.01,
      }),
      baseboard: new THREE.MeshStandardMaterial({
        color: '#e2e8f0',
        roughness: 0.35,
        metalness: 0.12,
      }),
      interiorFrame: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.25,
        metalness: 0.8,
      }),
      interiorGlass: new THREE.MeshStandardMaterial({
        color: '#e0f2fe',
        emissive: new THREE.Color('#e0f2fe'),
        emissiveIntensity: 0.15,
        roughness: 0.06,
        metalness: 0.1,
        transparent: true,
        opacity: 0.75,
      }),
      rugWork: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.95,
      }),
      rugLounge: new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 0.92,
      }),
      tileServer: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.4,
        metalness: 0.6,
      }),
      deskTop: new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 0.3,
        metalness: 0.2,
      }),
      deskLegs: new THREE.MeshStandardMaterial({
        color: '#94a3b8',
        roughness: 0.2,
        metalness: 0.9,
      }),
      screenBezel: new THREE.MeshStandardMaterial({
        color: '#090d16',
        roughness: 0.3,
        metalness: 0.85,
      }),
      codeDisplay1: new THREE.MeshStandardMaterial({
        map: codeMap1,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: codeMap1,
        emissiveIntensity: 0.85,
        roughness: 0.15,
      }),
      codeDisplay2: new THREE.MeshStandardMaterial({
        map: codeMap2,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: codeMap2,
        emissiveIntensity: 0.8,
        roughness: 0.15,
      }),
      chairMesh: new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 0.75,
        metalness: 0.2,
      }),
      chairMetal: new THREE.MeshStandardMaterial({
        color: '#cbd5e1',
        roughness: 0.18,
        metalness: 0.92,
      }),
      pcCase: new THREE.MeshStandardMaterial({
        color: '#090d16',
        roughness: 0.25,
        metalness: 0.75,
      }),
      pcRgb: new THREE.MeshStandardMaterial({
        color: accent,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 1.8,
      }),
      sofaFabric: new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 0.85,
      }),
      marbleTop: new THREE.MeshStandardMaterial({
        map: marbleMap,
        roughness: 0.18,
        metalness: 0.1,
      }),
      plantPot: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.25,
        metalness: 0.05,
      }),
      plantLeaves: new THREE.MeshStandardMaterial({
        color: '#15803d',
        roughness: 0.35,
        metalness: 0.05,
      }),
      glassBalustrade: new THREE.MeshStandardMaterial({
        color: '#93c5fd',
        transparent: true,
        opacity: 0.3,
        roughness: 0.05,
        metalness: 0.9,
      }),
      glassWall: new THREE.MeshStandardMaterial({
        color: '#bae6fd',
        transparent: true,
        opacity: 0.22,
        roughness: 0.04,
        metalness: 0.85,
      }),
      serverChassis: new THREE.MeshStandardMaterial({
        color: '#0a0e17',
        roughness: 0.4,
        metalness: 0.8,
      }),
      ledGreen: new THREE.MeshStandardMaterial({
        color: '#22c55e',
        emissive: new THREE.Color('#22c55e'),
        emissiveIntensity: 2.2,
      }),
      ledAmber: new THREE.MeshStandardMaterial({
        color: '#f59e0b',
        emissive: new THREE.Color('#f59e0b'),
        emissiveIntensity: 2.2,
      }),
      ledBlue: new THREE.MeshStandardMaterial({
        color: '#06b6d4',
        emissive: new THREE.Color('#06b6d4'),
        emissiveIntensity: 2.2,
      }),
      elevatorDoor: new THREE.MeshStandardMaterial({
        color: '#e2e8f0',
        roughness: 0.2,
        metalness: 0.9,
      }),
      ceilingTrack: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.4,
        metalness: 0.7,
      }),
      spotLightCone: new THREE.MeshStandardMaterial({
        color: '#fef08a',
        emissive: new THREE.Color('#fef08a'),
        emissiveIntensity: 1.5,
      }),
    };
  }, [accent]);

  useEffect(() => {
    const bag = materials;
    return () => {
      bag.floorMap.dispose();
      bag.codeMap1.dispose();
      bag.codeMap2.dispose();
      bag.marbleMap.dispose();
      bag.woodFloor.dispose();
    };
  }, [materials]);

  const Y = floorIndex * floorH;
  const deskX1 = -width * 0.24;
  const deskZ = depth * 0.12;

  const devAgents = agents.slice(0, 2);
  const loungeAgents = agents.slice(2, 4);

  return (
    <group position={[0, Y, 0]}>
      {/* ── Floor Structural Base Slab ── */}
      <mesh position={[0, 0.02, 0]} receiveShadow material={materials.baseboard}>
        <boxGeometry args={[width, 0.16, depth]} />
      </mesh>

      {/* ── Architectural Plank Floor with Inlay Border ── */}
      <mesh position={[0, 0.11, 0]} receiveShadow material={materials.woodFloor}>
        <boxGeometry args={[width - 0.16, 0.04, depth - 0.16]} />
      </mesh>
      {[
        [0, depth * 0.38, width - 0.9, 0.05],
        [0, -depth * 0.38, width - 0.9, 0.05],
      ].map(([x, z, w, d], i) => (
        <mesh key={`inlay-z-${i}`} position={[x, 0.136, z]} receiveShadow material={materials.floorInlay}>
          <boxGeometry args={[w, 0.012, d]} />
        </mesh>
      ))}

      {/* ── Zone Floor Rugs ── */}
      {/* Workstation Rug */}
      <mesh position={[deskX1, 0.165, deskZ]} receiveShadow material={materials.rugWork}>
        <boxGeometry args={[width * 0.44, 0.01, depth * 0.48]} />
      </mesh>
      {/* Lounge Rug */}
      <mesh position={[width * 0.26, 0.165, depth * 0.15]} receiveShadow material={materials.rugLounge}>
        <boxGeometry args={[width * 0.38, 0.01, depth * 0.45]} />
      </mesh>
      {/* Server Pod Raised Tile */}
      <mesh position={[width * 0.28, 0.17, -depth * 0.24]} receiveShadow material={materials.tileServer}>
        <boxGeometry args={[width * 0.34, 0.02, depth * 0.32]} />
      </mesh>

      {/* ── Open Dollhouse Front Cutaway (Ultra-Clear Balustrade) ── */}
      <group position={[0, 0.16, depth / 2 - 0.08]}>
        {/* Subtle low curb */}
        <mesh position={[0, 0.05, 0]} material={mats.trim}>
          <boxGeometry args={[width - 0.2, 0.1, 0.08]} />
        </mesh>
        {/* Low-profile crystal glass rail */}
        <mesh position={[0, 0.32, 0]} material={materials.glassBalustrade}>
          <boxGeometry args={[width - 0.32, 0.44, 0.02]} />
        </mesh>
        {/* Sleek handrail */}
        <mesh position={[0, 0.55, 0]} material={mats.trim}>
          <boxGeometry args={[width - 0.24, 0.03, 0.04]} />
        </mesh>
      </group>

      {/* ── Back Wall: Architectural Punched Windows ── */}
      <group position={[0, floorH / 2 + 0.14, -depth / 2 + 0.08]}>
        <mesh material={materials.plaster}>
          <boxGeometry args={[width, floorH, 0.16]} />
        </mesh>
        <mesh position={[0, -floorH / 2 + 0.1, 0.02]} material={materials.baseboard}>
          <boxGeometry args={[width - 0.08, 0.14, 0.18]} />
        </mesh>
        {bayCenters(width).map((bx, i) => {
          const winH = Math.min(0.58, floorH * 0.34);
          return (
            <group key={`back-win-${i}`} position={[bx, floorH * 0.16, 0.1]}>
              <mesh material={materials.interiorFrame}>
                <boxGeometry args={[0.92, winH + 0.1, 0.05]} />
              </mesh>
              <mesh position={[0, 0, 0.03]} material={materials.interiorGlass}>
                <boxGeometry args={[0.74, winH, 0.03]} />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* ── Side Walls ── */}
      {([-1, 1] as const).map((side) => (
        <group key={`side-wall-${side}`} position={[side * (width / 2 - 0.08), floorH / 2 + 0.14, 0]}>
          <mesh material={materials.plaster}>
            <boxGeometry args={[0.16, floorH, depth - 0.16]} />
          </mesh>
          <mesh position={[0, -floorH / 2 + 0.1, 0]} material={materials.baseboard}>
            <boxGeometry args={[0.2, 0.14, depth - 0.24]} />
          </mesh>
          {bayCenters(depth).map((bz, i) => {
            const winH = Math.min(0.58, floorH * 0.34);
            return (
              <group key={`side-win-${side}-${i}`} position={[side * -0.1, floorH * 0.16, bz]} rotation={[0, Math.PI / 2, 0]}>
                <mesh material={materials.interiorFrame}>
                  <boxGeometry args={[0.86, winH + 0.1, 0.05]} />
                </mesh>
                <mesh position={[0, 0, 0.03]} material={materials.interiorGlass}>
                  <boxGeometry args={[0.68, winH, 0.03]} />
                </mesh>
              </group>
            );
          })}
        </group>
      ))}

      {/* ── ZONE 1: Modern Developer Workstations ── */}
      <group position={[deskX1, 0.16, deskZ]}>
        {/* Solid Walnut Desk Top with Chamfered Edges */}
        <mesh position={[0, 0.36, 0]} material={materials.deskTop} castShadow receiveShadow>
          <boxGeometry args={[Math.min(3.4, width * 0.4), 0.05, 1.1]} />
        </mesh>
        {/* Chamfered Steel Trestle Legs */}
        {[-1.25, 1.25].map((lx) => (
          <group key={`desk-leg-${lx}`} position={[lx, 0.18, 0]}>
            <mesh material={materials.deskLegs} castShadow>
              <boxGeometry args={[0.06, 0.36, 0.9]} />
            </mesh>
          </group>
        ))}

        {/* Dual Curved Ultrawide Monitors with Articulated Mounting Arms */}
        {[-0.62, 0.62].map((mx, mi) => (
          <group key={`monitor-${mi}`} position={[mx, 0.4, -0.2]}>
            {/* Monitor Arm */}
            <mesh position={[0, 0.16, -0.12]} material={materials.deskLegs}>
              <cylinderGeometry args={[0.018, 0.024, 0.32, 12]} />
            </mesh>
            {/* Curved Monitor Frame */}
            <mesh position={[0, 0.34, 0]} material={materials.screenBezel} castShadow>
              <boxGeometry args={[0.94, 0.52, 0.028]} />
            </mesh>
            {/* Glowing Syntax-Highlighted IDE Code Display */}
            <mesh position={[0, 0.34, 0.016]} material={mi === 0 ? materials.codeDisplay1 : materials.codeDisplay2}>
              <planeGeometry args={[0.9, 0.48]} />
            </mesh>
          </group>
        ))}

        {/* Ergonomic 5-Star Mesh Office Chairs */}
        {[-0.62, 0.62].map((cx, ci) => (
          <group key={`chair-${ci}`} position={[cx, 0, 0.42]}>
            {/* 5-star chrome caster base */}
            <mesh position={[0, 0.04, 0]} material={materials.chairMetal}>
              <cylinderGeometry args={[0.22, 0.22, 0.02, 10]} />
            </mesh>
            {/* Caster wheels */}
            {Array.from({ length: 5 }, (_, wi) => {
              const ang = (wi / 5) * Math.PI * 2;
              return (
                <mesh key={`caster-${wi}`} position={[Math.cos(ang) * 0.2, 0.02, Math.sin(ang) * 0.2]} material={materials.screenBezel}>
                  <sphereGeometry args={[0.025, 8, 8]} />
                </mesh>
              );
            })}
            {/* Chrome hydraulic cylinder */}
            <mesh position={[0, 0.15, 0]} material={materials.chairMetal}>
              <cylinderGeometry args={[0.025, 0.025, 0.2, 10]} />
            </mesh>
            {/* Waterfall contoured seat cushion */}
            <mesh position={[0, 0.26, 0]} material={materials.chairMesh} castShadow>
              <boxGeometry args={[0.44, 0.06, 0.42]} />
            </mesh>
            {/* Ergonomic breathable curved mesh backrest */}
            <mesh position={[0, 0.54, 0.18]} rotation={[-0.12, 0, 0]} material={materials.chairMesh}>
              <boxGeometry args={[0.42, 0.5, 0.04]} />
            </mesh>
            {/* Lumbar support brace */}
            <mesh position={[0, 0.42, 0.2]} material={materials.chairMetal}>
              <boxGeometry args={[0.3, 0.08, 0.02]} />
            </mesh>
            {/* 3D adjustable armrests */}
            {[-0.23, 0.23].map((ax, ai) => (
              <group key={`arm-${ai}`} position={[ax, 0.38, 0.02]}>
                <mesh material={materials.chairMetal}>
                  <boxGeometry args={[0.03, 0.2, 0.03]} />
                </mesh>
                <mesh position={[0, 0.1, 0]} material={materials.chairMesh}>
                  <boxGeometry args={[0.06, 0.02, 0.22]} />
                </mesh>
              </group>
            ))}
          </group>
        ))}

        {/* Workstation PC Tower with RGB Internal Lighting */}
        <group position={[1.4, 0.22, -0.2]}>
          <mesh material={materials.pcCase} castShadow>
            <boxGeometry args={[0.22, 0.44, 0.46]} />
          </mesh>
          <mesh position={[-0.115, 0.02, 0]} material={materials.pcRgb}>
            <planeGeometry args={[0.38, 0.34]} />
          </mesh>
        </group>

        {/* Keyboards & Precision Mouse Pads */}
        {[-0.62, 0.62].map((kx, ki) => (
          <group key={`kb-${ki}`} position={[kx, 0.39, 0.15]}>
            <mesh material={materials.screenBezel}>
              <boxGeometry args={[0.38, 0.015, 0.13]} />
            </mesh>
            <mesh position={[0.26, 0, 0]} material={materials.screenBezel}>
              <boxGeometry args={[0.07, 0.015, 0.1]} />
            </mesh>
          </group>
        ))}

        {/* Live bots stationed at workstations */}
        <group position={[0, 0.3, 0.42]}>
          <AgentBots bots={devAgents} small />
        </group>
      </group>

      {/* ── ZONE 2: Data Center 42U Server Pod ── */}
      <group position={[width * 0.28, 0.18, -depth * 0.24]}>
        {/* 42U Server Rack Cabinet */}
        <mesh position={[0, 0.78, 0]} material={materials.serverChassis} castShadow receiveShadow>
          <boxGeometry args={[0.92, 1.56, 0.88]} />
        </mesh>
        {/* Glass Front Door with Tinted Reflection */}
        <mesh position={[0, 0.78, 0.45]} material={materials.glassBalustrade}>
          <planeGeometry args={[0.84, 1.48]} />
        </mesh>
        {/* 6 Server Blade Units with Drive Bays */}
        {Array.from({ length: 6 }, (_, si) => (
          <mesh key={`blade-${si}`} position={[0, 0.25 + si * 0.21, 0.22]} material={mats.trim}>
            <boxGeometry args={[0.82, 0.15, 0.42]} />
          </mesh>
        ))}
        {/* Pulsing Status Activity LEDs */}
        <mesh ref={ledRef1} position={[-0.28, 1.15, 0.44]} material={materials.ledGreen}>
          <sphereGeometry args={[0.02, 8, 8]} />
        </mesh>
        <mesh ref={ledRef2} position={[-0.23, 1.15, 0.44]} material={materials.ledAmber}>
          <sphereGeometry args={[0.02, 8, 8]} />
        </mesh>
        <mesh ref={ledRef3} position={[-0.18, 1.15, 0.44]} material={materials.ledBlue}>
          <sphereGeometry args={[0.02, 8, 8]} />
        </mesh>
        {/* Overhead Yellow/Black Cable Ladder Conduit */}
        <mesh position={[0, 1.62, 0]} material={materials.ceilingTrack}>
          <boxGeometry args={[0.2, 0.12, 0.5]} />
        </mesh>
      </group>

      {/* ── ZONE 3: Collaboration Lounge & Breakout Coffee Bar ── */}
      <group position={[width * 0.26, 0.16, depth * 0.15]}>
        {/* Modular L-Sectional Sofa with Plush Cushions */}
        <group position={[-0.2, 0, 0]}>
          {/* Main seating cushion */}
          <mesh position={[0, 0.2, 0]} material={materials.sofaFabric} castShadow>
            <boxGeometry args={[1.5, 0.24, 0.7]} />
          </mesh>
          {/* Chaise extension */}
          <mesh position={[0.55, 0.2, 0.55]} material={materials.sofaFabric} castShadow>
            <boxGeometry args={[0.6, 0.24, 0.7]} />
          </mesh>
          {/* Backrest */}
          <mesh position={[0, 0.44, -0.28]} material={materials.sofaFabric}>
            <boxGeometry args={[1.5, 0.32, 0.16]} />
          </mesh>
          {/* Accent throw pillows */}
          <mesh position={[-0.4, 0.36, -0.16]} rotation={[0.2, 0.2, 0]} material={mats.accent}>
            <boxGeometry args={[0.24, 0.24, 0.08]} />
          </mesh>
          <mesh position={[0.25, 0.36, -0.16]} rotation={[0.1, -0.15, 0]} material={materials.deskTop}>
            <boxGeometry args={[0.22, 0.22, 0.07]} />
          </mesh>
        </group>

        {/* Round Calacatta Marble Coffee Table on Hairpin Legs */}
        <group position={[-0.2, 0, 0.55]}>
          <mesh position={[0, 0.2, 0]} material={materials.marbleTop} castShadow>
            <cylinderGeometry args={[0.38, 0.38, 0.035, 32]} />
          </mesh>
          {/* 3 Hairpin bronze legs */}
          {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((ang, li) => (
            <mesh
              key={`hairpin-${li}`}
              position={[Math.cos(ang) * 0.26, 0.1, Math.sin(ang) * 0.26]}
              material={materials.chairMetal}
            >
              <cylinderGeometry args={[0.015, 0.015, 0.2, 8]} />
            </mesh>
          ))}
          {/* Modern slim laptop on coffee table */}
          <group position={[0, 0.22, 0]}>
            <mesh material={materials.screenBezel}>
              <boxGeometry args={[0.24, 0.01, 0.16]} />
            </mesh>
            <mesh position={[0, 0.08, -0.07]} rotation={[0.3, 0, 0]} material={materials.codeDisplay1}>
              <boxGeometry args={[0.24, 0.14, 0.01]} />
            </mesh>
          </group>
        </group>

        {/* Realistic Botanical Monstera / Ficus Plant */}
        <group position={[width * 0.14, 0, depth * 0.12]}>
          {/* Fluted modern ceramic pot */}
          <mesh position={[0, 0.22, 0]} material={materials.plantPot} castShadow>
            <cylinderGeometry args={[0.2, 0.15, 0.44, 24]} />
          </mesh>
          {/* Dark soil bed */}
          <mesh position={[0, 0.43, 0]} material={materials.deskTop}>
            <cylinderGeometry args={[0.18, 0.18, 0.02, 16]} />
          </mesh>
          {/* Botanical layered foliage blades */}
          {[
            [0, 0.6, 0, 0.28, 0.2, 0.3],
            [0.1, 0.72, -0.08, 0.26, -0.2, 0.4],
            [-0.1, 0.68, 0.08, 0.24, 0.4, -0.2],
            [0.08, 0.82, 0.05, 0.22, -0.1, 0.1],
          ].map(([lx, ly, lz, rad, rx, rz], pi) => (
            <mesh
              key={`leaf-${pi}`}
              position={[lx as number, ly as number, lz as number]}
              rotation={[rx as number, 0, rz as number]}
              material={materials.plantLeaves}
              castShadow
            >
              <sphereGeometry args={[rad as number, 12, 12]} />
            </mesh>
          ))}
        </group>

        {/* Live bots relaxing in the lounge */}
        <group position={[-0.2, 0.26, 0]}>
          <AgentBots bots={loungeAgents} small />
        </group>
      </group>

      {/* ── ZONE 4: Glass Conference Suite ── */}
      <group position={[-width * 0.22, 0.16, -depth * 0.24]}>
        {/* Glass Partition Wall with Black Frame */}
        <mesh position={[0, floorH * 0.42, 0]} material={materials.glassWall}>
          <boxGeometry args={[Math.min(3.4, width * 0.42), floorH * 0.84, 0.025]} />
        </mesh>
        <mesh position={[0, floorH * 0.84, 0]} material={materials.interiorFrame}>
          <boxGeometry args={[Math.min(3.4, width * 0.42) + 0.04, 0.05, 0.05]} />
        </mesh>

        {/* Conference Table */}
        <mesh position={[0, 0.36, -0.6]} material={materials.deskTop} castShadow receiveShadow>
          <boxGeometry args={[1.7, 0.05, 0.84]} />
        </mesh>
        {/* Conference Chairs */}
        {[-0.52, 0.52].map((cx, ci) => (
          <group key={`conf-chair-${ci}`}>
            <mesh position={[cx, 0.24, -0.25]} material={materials.chairMesh}>
              <boxGeometry args={[0.34, 0.04, 0.34]} />
            </mesh>
            <mesh position={[cx, 0.24, -0.95]} material={materials.chairMesh}>
              <boxGeometry args={[0.34, 0.04, 0.34]} />
            </mesh>
          </group>
        ))}
      </group>

      {/* ── ZONE 5: Brushed Stainless Steel Elevator & Core ── */}
      <group position={[0, 0.16, -depth / 2 + 0.2]}>
        {/* Frame */}
        <mesh position={[0, 0.78, 0]} material={materials.interiorFrame} castShadow>
          <boxGeometry args={[1.36, 1.56, 0.1]} />
        </mesh>
        {/* Brushed Stainless Steel Doors */}
        <mesh position={[-0.28, 0.76, 0.02]} material={materials.elevatorDoor}>
          <boxGeometry args={[0.5, 1.44, 0.02]} />
        </mesh>
        <mesh position={[0.28, 0.76, 0.02]} material={materials.elevatorDoor}>
          <boxGeometry args={[0.5, 1.44, 0.02]} />
        </mesh>
        {/* Digital Floor Call Indicator (▲ 1) */}
        <mesh position={[0, 1.42, 0.06]} material={materials.codeDisplay2}>
          <planeGeometry args={[0.34, 0.1]} />
        </mesh>
      </group>

      {/* ── Ceiling Lighting Tracks & Spotlights ── */}
      <group position={[0, floorH - 0.06, 0]}>
        {[-width * 0.22, width * 0.22].map((tx, ti) => (
          <group key={`track-${ti}`} position={[tx, 0, 0]}>
            <mesh material={materials.ceilingTrack}>
              <boxGeometry args={[0.04, 0.04, depth * 0.75]} />
            </mesh>
            {[-depth * 0.22, 0, depth * 0.22].map((sz, si) => (
              <group key={`spot-${si}`} position={[0, -0.06, sz]}>
                <mesh material={materials.ceilingTrack}>
                  <cylinderGeometry args={[0.035, 0.045, 0.08, 10]} />
                </mesh>
                <mesh position={[0, -0.042, 0]} material={materials.spotLightCone}>
                  <circleGeometry args={[0.032, 10]} />
                </mesh>
              </group>
            ))}
          </group>
        ))}
      </group>
    </group>
  );
}
