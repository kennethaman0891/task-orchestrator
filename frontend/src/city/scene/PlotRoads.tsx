// Developer City — PlotRoads: the folder district on one plot.
// Miniature roads for the project root and its colonies. Not CityRoads.

import { useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { layoutDistrict, type RoadSegment } from './roadLayout';

const ASPHALT = '#2a2e39';
const CURB = '#707784';
const BOARD_W = 0.9;
const BOARD_H = 0.28;

function makeNameTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#141820';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#707784';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 496, 144);
  ctx.fillStyle = '#f4f7fb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 78;
  const maxW = 460;
  ctx.font = `600 ${size}px sans-serif`;
  while (size > 32 && ctx.measureText(name).width > maxW) {
    size -= 2;
    ctx.font = `600 ${size}px sans-serif`;
  }
  let label = name || '·';
  if (ctx.measureText(label).width > maxW) {
    while (label.length > 1 && ctx.measureText(`${label}…`).width > maxW) {
      label = label.slice(0, -1);
    }
    label = `${label}…`;
  }
  ctx.fillText(label, 256, 84);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function activeSegmentId(segments: RoadSegment[], activeRelative: string | null): string | null {
  const rel = activeRelative ?? '';
  if (!rel) return segments.find((s) => s.relativePath === '')?.id ?? null;
  let best: RoadSegment | null = null;
  for (const segment of segments) {
    const path = segment.relativePath;
    const hit = path === rel || (path !== '' && rel.startsWith(`${path}/`));
    if (!hit) continue;
    if (!best || path.length > best.relativePath.length) best = segment;
  }
  return best?.id ?? null;
}

function NameBoard({ name, onPointerDown }: {
  name: string;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const texture = useMemo(() => makeNameTexture(name), [name]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[0, 0.26, 0]} onPointerDown={onPointerDown}>
      <planeGeometry args={[BOARD_W, BOARD_H]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

export function PlotRoads({ projectId, position, rootName, childNames, activeRelative, onSelect }: {
  projectId: string;
  position: [number, number, number];
  rootName: string;
  childNames: string[];
  activeRelative: string | null;
  onSelect?: (segmentId: string, name: string, relativePath: string) => void;
}) {
  const segments = useMemo(
    () => layoutDistrict(projectId, rootName, childNames, activeRelative),
    [projectId, rootName, childNames, activeRelative],
  );
  const activeId = useMemo(
    () => activeSegmentId(segments, activeRelative),
    [segments, activeRelative],
  );

  const select = (segment: RoadSegment) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onSelect?.(segment.id, segment.name, segment.relativePath);
  };

  return (
    <group position={position}>
      {segments.map((segment) => {
        const active = segment.id === activeId;
        const pick = select(segment);
        return (
          <group key={segment.id} position={[segment.x, 0, segment.z]}>
            <group rotation={[0, segment.rotY, 0]}>
              <mesh position={[0, 0.03, 0]} onPointerDown={pick} receiveShadow>
                <boxGeometry args={[0.7, 0.04, segment.length]} />
                <meshStandardMaterial
                  color={ASPHALT}
                  emissive={active ? '#3d4c66' : '#000000'}
                  emissiveIntensity={active ? 0.4 : 0}
                  roughness={0.85}
                  metalness={0.1}
                />
              </mesh>
              {([-1, 1] as const).map((side) => (
                <mesh key={side} position={[side * 0.38, 0.03, 0]} receiveShadow>
                  <boxGeometry args={[0.06, 0.045, segment.length]} />
                  <meshStandardMaterial
                    color={active ? '#9aa6b8' : CURB}
                    roughness={0.8}
                  />
                </mesh>
              ))}
              <group position={[0.52, 0, 0]} rotation={[0, -segment.rotY, 0]}>
                <mesh position={[0, 0.1, 0]}>
                  <boxGeometry args={[0.03, 0.14, 0.03]} />
                  <meshStandardMaterial color={CURB} roughness={0.7} />
                </mesh>
                <NameBoard name={segment.name} onPointerDown={pick} />
              </group>
            </group>
          </group>
        );
      })}
    </group>
  );
}
