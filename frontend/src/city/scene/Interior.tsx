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

  const Y = floorIndex * floorH;
  const rw = width / Math.max(1, rooms.length);

  return (
    <group position={[0, Y, 0]}>
      {/* floor slab */}
      <mesh position={[0, 0, 0]} receiveShadow material={mats.wallDark}>
        <boxGeometry args={[width, 0.3, depth]} />
      </mesh>
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

      {/* room zones: coloured floor patches + sign + desks */}
      {rooms.map((r, i) => {
        const cx = -width / 2 + rw * (i + 0.5);
        const roomAgents = agents.filter((a) => a.room?.toLowerCase() === r.toLowerCase() || (!a.room && i === 0));
        return (
          <group key={r} position={[cx, 0.16, 0]}>
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[rw * 0.85, depth * 0.8]} />
              <meshStandardMaterial color={accent} transparent opacity={0.12} roughness={1} />
            </mesh>
            {/* desk + screen */}
            <mesh position={[0, 0.35, -depth * 0.18]} material={mats.wall}>
              <boxGeometry args={[Math.min(2.2, rw * 0.6), 0.7, 0.7]} />
            </mesh>
            <mesh position={[0, 0.85, -depth * 0.18]}>
              <planeGeometry args={[Math.min(1.8, rw * 0.5), 0.9]} />
              <meshStandardMaterial color={theme.glass} emissive={theme.glass} emissiveIntensity={0.5} side={THREE.DoubleSide} />
            </mesh>
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
