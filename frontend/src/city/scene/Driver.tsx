// Developer City — Driver: miniature person standing in a terminal car.
// Chest shows the agent name when it is set, otherwise the model name, plus that logo.
// No passengers and no click handler. Feet sit on local y=0; the figure faces +Z.

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import claudePng from '../../assets/cli-logos/claude.png';
import opencodeRaw from '../../assets/cli-logos/opencode.svg?raw';
import codexRaw from '../../assets/cli-logos/codex.svg?raw';
import cursorRaw from '../../assets/cli-logos/cursor.svg?raw';
import geminiRaw from '../../assets/cli-logos/googlegemini.svg?raw';
import antigravityRaw from '../../assets/cli-logos/antigravity.svg?raw';
import primeRaw from '../../assets/cli-logos/prime.svg?raw';

const BADGE = '#222839';
const INK = '#f4f7fb';
const MARK = '#f4f7fb';
const GEMINI = '#8ab4ff';

const BODY_RADIUS = 0.08;
const BODY_LENGTH = 0.18;
/** Capsule center so the feet rest on y=0. Total figure height is 0.45. */
const BODY_Y = BODY_LENGTH / 2 + BODY_RADIUS;
const HEAD_RADIUS = 0.065;
const HEAD_Y = 0.45 - HEAD_RADIUS;

const LOGO_W = 0.1;
const LOGO_Y = 0.24;
const NAME_W = 0.28;
const NAME_H = 0.07;
const NAME_Y = 0.145;

type LogoId = 'claude' | 'opencode' | 'codex' | 'cursor' | 'gemini' | 'antigravity' | 'prime';

/** Longer phrases first. Each word maps to one bundled mark. */
const ALIASES: readonly { word: string; id: LogoId }[] = [
  { word: 'claude-code', id: 'claude' },
  { word: 'antigravity', id: 'antigravity' },
  { word: 'gemini-cli', id: 'gemini' },
  { word: 'codex-cli', id: 'codex' },
  { word: 'anthropic', id: 'claude' },
  { word: 'opencode', id: 'opencode' },
  { word: 'claude', id: 'claude' },
  { word: 'cursor', id: 'cursor' },
  { word: 'gemini', id: 'gemini' },
  { word: 'codex', id: 'codex' },
  { word: 'prime', id: 'prime' },
  { word: 'agy', id: 'antigravity' },
];

function asText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Agent name when it is set, otherwise the model name. At most 14 characters. */
function chestLabel(modelName: string, agentName: string): string {
  return (asText(agentName) || asText(modelName) || 'agent').slice(0, 14);
}

function twoInitials(label: string): string {
  const parts = label.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const word = parts[0] ?? '';
  if (word.length >= 2) return word.slice(0, 2).toUpperCase();
  if (word.length === 1) return word.toUpperCase();
  return '??';
}

/** cli, then agent, then model. A known alias anywhere in the key selects the logo. */
function resolveLogoId(cli: string, agentName: string, modelName: string): LogoId | null {
  const key = (asText(cli) || asText(agentName) || asText(modelName)).toLowerCase();
  if (!key) return null;
  for (const alias of ALIASES) {
    if (key.includes(alias.word)) return alias.id;
  }
  return null;
}

function svgUrl(raw: string, color: string, evenOdd = false): string {
  let svg = raw.replace(/currentColor/g, color);
  if (evenOdd && !/fill-rule=/.test(svg)) {
    svg = svg.replace(/<path\b/, '<path fill-rule="evenodd"');
  }
  svg = svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
    let next = attrs;
    if (!/\bxmlns=/.test(next)) next += ' xmlns="http://www.w3.org/2000/svg"';
    if (!/\bwidth=/.test(next)) next += ' width="128" height="128"';
    if (!/\bfill=/.test(next)) next += ` fill="${color}"`;
    return `<svg${next}>`;
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const LOGO_SRC: Record<LogoId, string> = {
  claude: claudePng,
  opencode: svgUrl(opencodeRaw, MARK, true),
  codex: svgUrl(codexRaw, MARK),
  cursor: svgUrl(cursorRaw, MARK),
  gemini: svgUrl(geminiRaw, GEMINI),
  antigravity: svgUrl(antigravityRaw, MARK),
  prime: svgUrl(primeRaw, MARK),
};

const textureCache = new Map<string, THREE.Texture>();
const textureUsers = new Map<string, number>();

function finishTexture(tex: THREE.CanvasTexture): THREE.CanvasTexture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function canvas2d(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  return { canvas, ctx };
}

function paintInitials(ctx: CanvasRenderingContext2D, letters: string, size: number) {
  ctx.fillStyle = BADGE;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.floor(size * 0.42)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letters.slice(0, 2), size / 2, size / 2 + size * 0.02);
}

function makeInitialsTexture(letters: string): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = canvas2d(size, size);
  paintInitials(ctx, letters, size);
  return finishTexture(new THREE.CanvasTexture(canvas));
}

function makeLogoTexture(src: string, letters: string): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = canvas2d(size, size);
  paintInitials(ctx, letters, size);
  const tex = finishTexture(new THREE.CanvasTexture(canvas));
  const img = new Image();
  img.onload = () => {
    const iw = img.naturalWidth || size;
    const ih = img.naturalHeight || size;
    if (iw < 1 || ih < 1) return;
    ctx.fillStyle = BADGE;
    ctx.fillRect(0, 0, size, size);
    const pad = 14;
    const max = size - pad * 2;
    const scale = Math.min(max / iw, max / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    tex.needsUpdate = true;
  };
  img.src = src;
  return tex;
}

function makeNameTexture(label: string): THREE.CanvasTexture {
  const width = 512;
  const height = 128;
  const { canvas, ctx } = canvas2d(width, height);
  ctx.fillStyle = BADGE;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontSize = 76;
  for (; fontSize >= 34; fontSize -= 4) {
    ctx.font = `bold ${fontSize}px sans-serif`;
    if (ctx.measureText(label).width <= width - 28) break;
  }
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#121722';
  ctx.strokeText(label, width / 2, height / 2 + 2);
  ctx.fillText(label, width / 2, height / 2 + 2);
  return finishTexture(new THREE.CanvasTexture(canvas));
}

/**
 * Module-level cache so every driver with the same badge or name shares one texture.
 * The last unmount disposes it. A texture another driver still holds is left alone.
 */
function useSharedTexture(key: string, create: () => THREE.Texture): THREE.Texture {
  const texture = useMemo(() => {
    const cached = textureCache.get(key);
    if (cached) return cached;
    const created = create();
    textureCache.set(key, created);
    return created;
    // The key fully identifies the texture; recreate only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    textureUsers.set(key, (textureUsers.get(key) ?? 0) + 1);
    return () => {
      const next = (textureUsers.get(key) ?? 1) - 1;
      if (next > 0) {
        textureUsers.set(key, next);
        return;
      }
      textureUsers.delete(key);
      const owned = texture;
      // Wait past Strict Mode's synchronous effect remount before freeing a shared texture.
      queueMicrotask(() => {
        if ((textureUsers.get(key) ?? 0) > 0 && textureCache.get(key) === owned) return;
        if (textureCache.get(key) === owned) textureCache.delete(key);
        owned.dispose();
      });
    };
  }, [key, texture]);

  return texture;
}

export function Driver({
  agentName,
  modelName,
  cli,
}: {
  agentName: string;
  modelName: string;
  cli: string;
}) {
  const label = chestLabel(modelName, agentName);
  const letters = twoInitials(label);
  const logoId = resolveLogoId(cli, agentName, modelName);
  const badgeKey = logoId ? `logo:${logoId}` : `initials:${letters}`;
  const badge = useSharedTexture(badgeKey, () =>
    logoId ? makeLogoTexture(LOGO_SRC[logoId], letters) : makeInitialsTexture(letters),
  );
  const nameTex = useSharedTexture(`name:${label}`, () => makeNameTexture(label || letters));

  return (
    <group name="driver">
      <mesh position={[0, BODY_Y, 0]} castShadow>
        <capsuleGeometry args={[BODY_RADIUS, BODY_LENGTH, 4, 10]} />
        <meshStandardMaterial color="#3e4c63" roughness={0.78} metalness={0} />
      </mesh>
      <mesh position={[0, HEAD_Y, 0]} castShadow>
        <sphereGeometry args={[HEAD_RADIUS, 16, 14]} />
        <meshStandardMaterial color="#e7b899" roughness={0.62} metalness={0} />
      </mesh>
      <mesh position={[0, HEAD_Y + HEAD_RADIUS * 0.28, -HEAD_RADIUS * 0.12]} scale={[1, 0.62, 0.9]}>
        <sphereGeometry args={[HEAD_RADIUS * 0.92, 14, 10]} />
        <meshStandardMaterial color="#2a241f" roughness={0.85} metalness={0} />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[side * 0.02, HEAD_Y + 0.008, HEAD_RADIUS * 0.82]}>
          <sphereGeometry args={[0.009, 8, 8]} />
          <meshStandardMaterial color="#2b241f" roughness={0.45} metalness={0} />
        </mesh>
      ))}
      <mesh position={[0, LOGO_Y, BODY_RADIUS + 0.012]} renderOrder={2}>
        <planeGeometry args={[LOGO_W, LOGO_W]} />
        <meshBasicMaterial
          map={badge}
          toneMapped={false}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      <mesh position={[0, NAME_Y, BODY_RADIUS + 0.018]} renderOrder={2}>
        <planeGeometry args={[NAME_W, NAME_H]} />
        <meshBasicMaterial
          map={nameTex}
          toneMapped={false}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
    </group>
  );
}
