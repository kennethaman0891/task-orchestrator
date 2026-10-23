// Developer City — AgentStation: one depot for the whole city.
// Outer corner, off plot centres. The pickup control is a placeholder only.

import { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { cityRadius } from './CityGrid';

import claudeLogo from '@/assets/cli-logos/claude.png';
import codexLogo from '@/assets/cli-logos/codex.svg?raw';
import opencodeLogo from '@/assets/cli-logos/opencode.svg?raw';
import primeLogo from '@/assets/cli-logos/prime.svg?raw';
import antigravityLogo from '@/assets/cli-logos/antigravity.svg?raw';
import cursorLogo from '@/assets/cli-logos/cursor.svg?raw';
import geminiLogo from '@/assets/cli-logos/googlegemini.svg?raw';

const BUILDING: [number, number, number] = [8, 2.2, 4];
const BADGE_W = 256;
const BADGE_H = 320;
const MARK = '#e2e8f0';

interface DepotAgent {
  name: string;
  /** Shown on a dark plate when there is no logo, or if the mark fails to load. */
  initials: string;
  raster?: string;
  svg?: string;
}

const AGENTS: DepotAgent[] = [
  { name: 'Claude', initials: 'CL', raster: claudeLogo },
  { name: 'Codex', initials: 'CO', svg: codexLogo },
  { name: 'OpenCode', initials: 'OC', svg: opencodeLogo },
  { name: 'Prime', initials: 'PR', svg: primeLogo },
  { name: 'Antigravity', initials: 'AG', svg: antigravityLogo },
  { name: 'Cursor', initials: 'CU', svg: cursorLogo },
  { name: 'Gemini', initials: 'GE', svg: geminiLogo },
  { name: 'Full stack', initials: 'FS' },
  { name: 'Task', initials: 'TK' },
];

/** Plot centres reach ±49. Prefer the outer corner when the city is large enough. */
function depotPosition(): [number, number, number] {
  const along = cityRadius() >= 56 ? 56 : 49;
  return [along, 0, -along];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintPlate(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, BADGE_W, BADGE_H);
  roundRect(ctx, 6, 6, BADGE_W - 12, BADGE_H - 12, 28);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#334155';
  ctx.stroke();
}

function paintName(ctx: CanvasRenderingContext2D, name: string) {
  ctx.fillStyle = MARK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 28;
  const max = BADGE_W - 36;
  for (; size >= 15; size -= 1) {
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
    if (ctx.measureText(name).width <= max) break;
  }
  ctx.fillText(name, BADGE_W / 2, 278);
}

function paintInitials(ctx: CanvasRenderingContext2D, initials: string) {
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 92px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(initials, BADGE_W / 2, 124);
}

/** Mono SVG marks ship as currentColor (black as an image). Paint them light. */
function svgDataUrl(raw: string): string {
  const light = raw.replace(/currentColor/g, MARK);
  const patched = light.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    let next = attrs;
    if (!/\bwidth=/.test(next)) next += ' width="128"';
    if (!/\bheight=/.test(next)) next += ' height="128"';
    if (!/\bfill=/.test(next)) next += ` fill="${MARK}"`;
    return `<svg${next}>`;
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(patched)}`;
}

function createBadge(agent: DepotAgent): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = BADGE_W;
  canvas.height = BADGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  const drawInitials = () => {
    paintPlate(ctx);
    paintInitials(ctx, agent.initials);
    paintName(ctx, agent.name);
  };

  const src = agent.raster ?? (agent.svg ? svgDataUrl(agent.svg) : null);
  if (!src) drawInitials();
  else {
    paintPlate(ctx);
    paintName(ctx, agent.name);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  if (src) {
    const img = new Image();
    img.onload = () => {
      paintPlate(ctx);
      const iw = img.naturalWidth || 128;
      const ih = img.naturalHeight || 128;
      const max = 176;
      const s = Math.min(max / iw, max / ih);
      const w = iw * s;
      const h = ih * s;
      ctx.drawImage(img, (BADGE_W - w) / 2, 28 + (176 - h) / 2, w, h);
      paintName(ctx, agent.name);
      tex.needsUpdate = true;
    };
    img.onerror = () => {
      drawInitials();
      tex.needsUpdate = true;
    };
    img.src = src;
  }

  return tex;
}

function StationFigure({ texture, x }: { texture: THREE.Texture; x: number }) {
  return (
    <group position={[x, 0, 2.7]}>
      <mesh position={[0, 0.2, 0]}>
        <capsuleGeometry args={[0.09, 0.22, 4, 8]} />
        <meshStandardMaterial color="#475569" roughness={0.55} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.46, 0]}>
        <sphereGeometry args={[0.072, 12, 12]} />
        <meshStandardMaterial color="#64748b" roughness={0.45} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.98, 0]}>
        <planeGeometry args={[0.62, 0.775]} />
        <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function AgentStation() {
  const position = useMemo(depotPosition, []);
  const badges = useMemo(() => AGENTS.map((agent) => createBadge(agent)), []);

  return (
    <group position={position}>
      <mesh position={[0, BUILDING[1] / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={BUILDING} />
        <meshStandardMaterial color="#1e293b" roughness={0.72} metalness={0.12} />
      </mesh>

      <Html position={[0, 2.55, 0]} center distanceFactor={40} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.4,
            color: '#e2e8f0',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}
        >
          Sub-agents
        </div>
      </Html>

      {AGENTS.map((agent, i) => (
        <StationFigure
          key={agent.name}
          texture={badges[i]}
          x={(i - (AGENTS.length - 1) / 2) * 0.78}
        />
      ))}

      <Html position={[0, 0.48, 2.08]} center distanceFactor={40} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <button
          type="button"
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
          style={{
            pointerEvents: 'auto',
            cursor: 'default',
            whiteSpace: 'nowrap',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            color: '#e2e8f0',
            background: 'rgba(15, 23, 42, 0.94)',
            border: '1px solid rgba(148, 163, 184, 0.45)',
            borderRadius: 6,
            padding: '4px 10px',
          }}
        >
          Pick up — Coming soon
        </button>
      </Html>
    </group>
  );
}
