// Developer City — InteriorFloor: the INSIDE of a building for one floor.
// Rendered instead of the solid tower when the camera has entered that
// floor. Rooms come from project data (never one fixed interior):
//   project.floors: string[] | FloorSpec[]
// Every project's interior is generated from its own configuration.

import { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { AgentBot, FloorSpec, Project } from '@/city/types';
import { AgentBots } from './Bots';
import { themeById } from '@/city/themes';
import { useBuildingMaterials } from './archetypes';

export function floorName(p: Project, index: number): string {
  const f = p.floors?.[index];
  return typeof f === 'string' ? f : (f as FloorSpec)?.name ?? `Floor ${index + 1}`;
}

export function roomsOfFloor(p: Project, index: number): string[] {
  const f = p.floors?.[index];
  if (!f) return [floorName(p, index)];
  if (typeof f === 'string') return [f];
  return (f as FloorSpec).rooms?.length ? (f as FloorSpec).rooms : [f.name];
}

interface InteriorFloorProps {
  project: Project;
  floorIndex: number;
  width: number;
  depth: number;
  floorH: number;
  agents: AgentBot[];
}

export function InteriorFloor({ project, floorIndex, width, depth, floorH, agents }: InteriorFloorProps) {
  const b = project.building;
  const theme = themeById(b.theme);
  const facade = b.primaryColor || theme.facade;
  const accent = b.accentColor || theme.accent;
  const mats = useBuildingMaterials(facade, theme.facadeDark, theme.glass, accent);
  const rooms = useMemo(() => roomsOfFloor(project, floorIndex), [project, floorIndex]);

  const furn = useMemo(
    () => ({
      tile: new THREE.MeshStandardMaterial({ color: '#d7c7ae', roughness: 0.96, metalness: 0 }),
      tileAlt: new THREE.MeshStandardMaterial({ color: '#b7a488', roughness: 0.96, metalness: 0 }),
      patch: new THREE.MeshStandardMaterial({
        color: accent,
        transparent: true,
        opacity: 0.12,
        roughness: 1,
      }),
      screen: new THREE.MeshStandardMaterial({
        color: theme.glass,
        emissive: theme.glass,
        emissiveIntensity: 0.5,
        side: THREE.DoubleSide,
      }),
      clockFace: new THREE.MeshStandardMaterial({
        color: '#f4f0e6',
        roughness: 0.42,
        metalness: 0.04,
      }),
      bookA: new THREE.MeshStandardMaterial({ color: '#8d3b3a', roughness: 0.72 }),
      bookB: new THREE.MeshStandardMaterial({ color: '#2c4a6e', roughness: 0.68 }),
      pen: new THREE.MeshStandardMaterial({ color: '#1a1614', roughness: 0.32, metalness: 0.25 }),
    }),
    [accent, theme.glass],
  );

  const floorTiles = useMemo(() => {
    const gap = 0.05;
    const inset = 0.32;
    const cols = Math.min(10, Math.max(3, Math.round((width - inset * 2) / 0.8)));
    const rows = Math.min(10, Math.max(3, Math.round((depth - inset * 2) / 0.8)));
    const tw = Math.max(0.12, (width - inset * 2 - gap * (cols - 1)) / cols);
    const td = Math.max(0.12, (depth - inset * 2 - gap * (rows - 1)) / rows);
    const x0 = -width / 2 + inset;
    const z0 = -depth / 2 + inset;
    const cells: { key: string; x: number; z: number; alt: boolean }[] = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        cells.push({
          key: `${c}-${r}`,
          x: x0 + tw / 2 + c * (tw + gap),
          z: z0 + td / 2 + r * (td + gap),
          alt: (c + r) % 2 === 1,
        });
      }
    }
    return { cells, tw, td };
  }, [width, depth]);

  const Y = floorIndex * floorH;
  const rw = width / Math.max(1, rooms.length);
  const baseH = 0.13;
  const baseT = 0.07;
  const baseY = 0.15 + baseH / 2;
  const frontLen = Math.max(0.16, width / 4 - 0.14);
  const frontX = width * 0.375 - 0.03;

  return (
    <group position={[0, Y, 0]}>
      {/* floor slab */}
      <mesh position={[0, 0, 0]} receiveShadow material={mats.wallDark}>
        <boxGeometry args={[width, 0.3, depth]} />
      </mesh>
      {/* floor tiles */}
      {floorTiles.cells.map((t) => (
        <mesh
          key={t.key}
          position={[t.x, 0.16, t.z]}
          receiveShadow
          material={t.alt ? furn.tileAlt : furn.tile}
        >
          <boxGeometry args={[floorTiles.tw, 0.02, floorTiles.td]} />
        </mesh>
      ))}
      {/* front + back + side walls with a doorway gap at the front centre */}
      <mesh position={[0, floorH / 2, -depth / 2]} material={mats.wall}>
        <boxGeometry args={[width, floorH, 0.15]} />
      </mesh>
      <mesh position={[-width / 2, floorH / 2, 0]} material={mats.wall}>
        <boxGeometry args={[0.15, floorH, depth]} />
      </mesh>
      <mesh position={[width / 2, floorH / 2, 0]} material={mats.wall}>
        <boxGeometry args={[0.15, floorH, depth]} />
      </mesh>
      <mesh position={[-width / 4 - width * 0.25, floorH / 2, depth / 2]} material={mats.wall}>
        <boxGeometry args={[width / 2, floorH, 0.15]} />
      </mesh>
      <mesh position={[width / 4 + width * 0.25, floorH / 2, depth / 2]} material={mats.wall}>
        <boxGeometry args={[width / 2, floorH, 0.15]} />
      </mesh>
      {/* baseboard frames — front pair stops at the doorway */}
      <mesh position={[0, baseY, -depth / 2 + 0.075 + baseT / 2]} material={mats.trim}>
        <boxGeometry args={[width - 0.28, baseH, baseT]} />
      </mesh>
      <mesh position={[-width / 2 + 0.075 + baseT / 2, baseY, 0]} material={mats.trim}>
        <boxGeometry args={[baseT, baseH, depth - 0.28]} />
      </mesh>
      <mesh position={[width / 2 - 0.075 - baseT / 2, baseY, 0]} material={mats.trim}>
        <boxGeometry args={[baseT, baseH, depth - 0.28]} />
      </mesh>
      <mesh position={[-frontX, baseY, depth / 2 - 0.075 - baseT / 2]} material={mats.trim}>
        <boxGeometry args={[frontLen, baseH, baseT]} />
      </mesh>
      <mesh position={[frontX, baseY, depth / 2 - 0.075 - baseT / 2]} material={mats.trim}>
        <boxGeometry args={[frontLen, baseH, baseT]} />
      </mesh>

      {/* room zones: coloured floor patches + sign + desks */}
      {rooms.map((r, i) => {
        const cx = -width / 2 + rw * (i + 0.5);
        const roomAgents = agents.filter((a) => a.room?.toLowerCase() === r.toLowerCase() || (!a.room && i === 0));
        const deskW = Math.min(2.2, rw * 0.6);
        const screenW = Math.min(1.8, rw * 0.5);
        const clockR = Math.min(0.18, Math.max(0.09, Math.min(floorH * 0.11, rw * 0.14)));
        const clockY = Math.min(floorH * 0.62, Math.max(clockR + 0.35, floorH - clockR - 0.22));
        const clockXMax = rw / 2 - clockR - 0.16;
        const clockX = Math.min(clockXMax, Math.max(screenW / 2 + clockR + 0.18, -clockXMax));
        const sideGap = rw / 2 - deskW / 2;
        const shelfW = Math.min(0.95, Math.max(0.42, sideGap - 0.18));
        const shelfX = -rw / 2 + 0.16 + shelfW / 2;
        const penL = Math.min(0.46, deskW * 0.34);
        return (
          <group key={r} position={[cx, 0.16, 0]}>
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={furn.patch}>
              <planeGeometry args={[rw * 0.85, depth * 0.8]} />
            </mesh>
            {/* desk + screen */}
            <mesh position={[0, 0.35, -depth * 0.18]} material={mats.wall}>
              <boxGeometry args={[deskW, 0.7, 0.7]} />
            </mesh>
            <mesh position={[0, 0.85, -depth * 0.18]} material={furn.screen}>
              <planeGeometry args={[screenW, 0.9]} />
            </mesh>
            {/* pen */}
            <group
              position={[deskW * 0.22, 0.73, -depth * 0.18 + 0.2]}
              rotation={[0, 0.45, Math.PI / 2]}
            >
              <mesh material={furn.pen}>
                <cylinderGeometry args={[0.022, 0.02, penL, 6]} />
              </mesh>
              <mesh position={[0, penL / 2 - 0.03, 0]} material={mats.accent}>
                <cylinderGeometry args={[0.03, 0.03, 0.08, 6]} />
              </mesh>
            </group>
            {/* low shelf + two books */}
            <group position={[shelfX, 0, -depth * 0.02]}>
              <mesh position={[0, 0.04, 0]} material={mats.trim}>
                <boxGeometry args={[shelfW, 0.08, 0.28]} />
              </mesh>
              <mesh position={[-0.1, 0.206, 0]} material={furn.bookA}>
                <boxGeometry args={[0.1, 0.26, 0.16]} />
              </mesh>
              <mesh position={[0.08, 0.176, 0]} material={furn.bookB}>
                <boxGeometry args={[0.12, 0.2, 0.15]} />
              </mesh>
            </group>
            {/* wall clock: face + two hands */}
            <group position={[clockX, clockY, -depth / 2 + 0.14]}>
              <mesh material={mats.trim} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[clockR + 0.028, clockR + 0.028, 0.028, 14]} />
              </mesh>
              <mesh
                position={[0, 0, 0.02]}
                material={furn.clockFace}
                rotation={[Math.PI / 2, 0, 0]}
              >
                <cylinderGeometry args={[clockR, clockR, 0.03, 14]} />
              </mesh>
              <group position={[0, 0, 0.05]} rotation={[0, 0, 0.45]}>
                <mesh position={[clockR * 0.2, 0, 0]} material={mats.wallDark}>
                  <boxGeometry args={[clockR * 0.46, clockR * 0.09, 0.016]} />
                </mesh>
                <mesh position={[0, clockR * 0.26, 0.008]} material={mats.accent}>
                  <boxGeometry args={[clockR * 0.07, clockR * 0.55, 0.016]} />
                </mesh>
              </group>
            </group>
            <Html position={[0, floorH * 0.55, 0]} center distanceFactor={16} zIndexRange={[10, 0]}>
              <div style={{
                pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: 10, letterSpacing: 1.5,
                color: accent, textTransform: 'uppercase', fontWeight: 600,
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
              }}>
                {r}
              </div>
            </Html>
            {/* bots live in their room */}
            <group position={[0, 0.3, depth * 0.15]}>
              <AgentBots bots={roomAgents} small />
            </group>
          </group>
        );
      })}

      {/* stairs / elevator marker */}
      <group position={[width / 2 - 0.8, 0.16, depth / 2 - 0.8]}>
        <mesh position={[0, 0.5, 0]} material={mats.accent}>
          <boxGeometry args={[0.9, 1.0, 0.9]} />
        </mesh>
        <Html position={[0, 1.5, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
          <div style={{
            pointerEvents: 'none', fontSize: 9, color: accent, fontWeight: 700,
            textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          }}>
            ⇅
          </div>
        </Html>
      </group>

      {/* floor title plate at the entrance */}
      <Html position={[0, floorH + 0.8, depth / 2 + 0.4]} center distanceFactor={20} zIndexRange={[10, 0]}>
        <div style={{
          pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600, color: '#fff',
          background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: 6,
        }}>
          {project.name} · {floorName(project, floorIndex)}
        </div>
      </Html>
    </group>
  );
}
