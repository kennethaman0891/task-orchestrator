// Procedural architectural facade textures (cached CanvasTextures).
// Turns flat untextured boxes into realistic masonry, curtain-wall glass/steel,
// precast architectural panels, and stone plinths.

import * as THREE from 'three';

export interface FacadeTextureSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  bumpScale: number;
  roughness: number;
  metalness: number;
}

const facadeCache = new Map<string, FacadeTextureSet>();
let plinthTextureCache: THREE.CanvasTexture | null = null;
let roofTextureCache: THREE.CanvasTexture | null = null;

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [120, 130, 145];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbStr(r: number, g: number, b: number, a = 1): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return a < 1
    ? `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${a})`
    : `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

/**
 * Blend an arbitrary user/workspace color toward realistic architectural cladding
 * tones (desaturates neon/toy saturation slightly while preserving hue identity).
 */
export function refineArchitecturalColor(hex: string, mixRatio = 0.24): [number, number, number] {
  const [r, g, b] = parseHex(hex);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // Pull extreme saturation softly toward neutral architectural mineral/slate
  const neutral = Math.max(58, Math.min(185, lum * 0.85 + 24));
  return [
    r * (1 - mixRatio) + neutral * mixRatio,
    g * (1 - mixRatio) + neutral * mixRatio,
    b * (1 - mixRatio) + neutral * mixRatio,
  ];
}

/** Derive a realistic stone/gunmetal structural trim color that harmonizes with facadeDark. */
export function deriveArchitecturalTrim(facadeDarkHex: string): string {
  const [r, g, b] = parseHex(facadeDarkHex);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // Blend heavily toward refined architectural dark slate / limestone
  const target = lum > 130 ? 155 : 54;
  const mr = r * 0.35 + target * 0.65;
  const mg = g * 0.35 + target * 0.65;
  const mb = b * 0.35 + (target + 6) * 0.65;
  return rgbStr(mr, mg, mb);
}

function seededNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function drawBrickFacade(
  ctx: CanvasRenderingContext2D,
  bumpCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: [number, number, number],
) {
  const [r, g, b] = base;
  // Mortar base
  ctx.fillStyle = rgbStr(r * 0.68 + 42, g * 0.68 + 40, b * 0.68 + 38);
  ctx.fillRect(0, 0, w, h);
  bumpCtx.fillStyle = '#383838';
  bumpCtx.fillRect(0, 0, w, h);

  const rows = 16;
  const cols = 8;
  const rowH = h / rows;
  const colW = w / cols;

  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : colW * 0.5;
    for (let col = -1; col <= cols; col++) {
      const n = seededNoise(col + 13, row + 7);
      const shade = (n - 0.5) * 26;
      ctx.fillStyle = rgbStr(r + shade, g + shade * 0.92, b + shade * 0.85);
      const bx = col * colW + offset + 1.5;
      const by = row * rowH + 1.5;
      ctx.fillRect(bx, by, colW - 3, rowH - 3);

      const bVal = 175 + Math.round((n - 0.5) * 45);
      bumpCtx.fillStyle = rgbStr(bVal, bVal, bVal);
      bumpCtx.fillRect(bx, by, colW - 3, rowH - 3);
    }
  }
}

function drawCurtainWallFacade(
  ctx: CanvasRenderingContext2D,
  bumpCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: [number, number, number],
) {
  const [r, g, b] = base;
  ctx.fillStyle = rgbStr(r, g, b);
  ctx.fillRect(0, 0, w, h);
  bumpCtx.fillStyle = '#c8c8c8';
  bumpCtx.fillRect(0, 0, w, h);

  // Subtle brushed aluminum spandrel panels & vertical mullions
  const cols = 8;
  const rows = 8;
  const cw = w / cols;
  const rh = h / rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const n = seededNoise(col * 3 + 1, row * 5 + 2);
      const delta = (n - 0.5) * 14;
      const grad = ctx.createLinearGradient(col * cw, row * rh, col * cw, (row + 1) * rh);
      grad.addColorStop(0, rgbStr(r + delta + 8, g + delta + 10, b + delta + 14));
      grad.addColorStop(1, rgbStr(r + delta - 10, g + delta - 8, b + delta - 4));
      ctx.fillStyle = grad;
      ctx.fillRect(col * cw + 2, row * rh + 2, cw - 4, rh - 4);

      bumpCtx.fillStyle = '#dcdcdc';
      bumpCtx.fillRect(col * cw + 2, row * rh + 2, cw - 4, rh - 4);
    }
  }

  // Crisp anodized panel seams
  ctx.fillStyle = rgbStr(r * 0.55, g * 0.55, b * 0.58);
  bumpCtx.fillStyle = '#404040';
  for (let col = 0; col < cols; col++) {
    ctx.fillRect(col * cw, 0, 2.5, h);
    bumpCtx.fillRect(col * cw, 0, 2.5, h);
  }
  for (let row = 0; row < rows; row++) {
    ctx.fillRect(0, row * rh, w, 2.5);
    bumpCtx.fillRect(0, row * rh, w, 2.5);
  }
}

function drawPrecastPanelFacade(
  ctx: CanvasRenderingContext2D,
  bumpCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: [number, number, number],
  concreteMode: boolean,
) {
  const [r, g, b] = base;
  ctx.fillStyle = rgbStr(r, g, b);
  ctx.fillRect(0, 0, w, h);
  bumpCtx.fillStyle = '#bcbcbc';
  bumpCtx.fillRect(0, 0, w, h);

  const cols = concreteMode ? 4 : 6;
  const rows = concreteMode ? 6 : 8;
  const cw = w / cols;
  const rh = h / rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const n = seededNoise(col + 19, row + 23);
      const delta = (n - 0.5) * 18;
      ctx.fillStyle = rgbStr(r + delta, g + delta, b + delta);
      ctx.fillRect(col * cw + 2, row * rh + 2, cw - 4, rh - 4);

      // Subtle top highlight + bottom shadow per architectural panel
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(col * cw + 2, row * rh + 2, cw - 4, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.09)';
      ctx.fillRect(col * cw + 2, (row + 1) * rh - 5, cw - 4, 3);

      bumpCtx.fillStyle = '#d4d4d4';
      bumpCtx.fillRect(col * cw + 2, row * rh + 2, cw - 4, rh - 4);

      if (concreteMode) {
        // Architectural form-tie dimples
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.beginPath();
        ctx.arc(col * cw + 12, row * rh + rh * 0.5, 2, 0, Math.PI * 2);
        ctx.arc((col + 1) * cw - 12, row * rh + rh * 0.5, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Subtle surface grain
  for (let i = 0; i < 650; i++) {
    const gx = seededNoise(i, 1) * w;
    const gy = seededNoise(i, 2) * h;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(gx, gy, 2, 2);
  }

  // Recessed joint seams
  ctx.fillStyle = rgbStr(r * 0.62, g * 0.62, b * 0.64);
  bumpCtx.fillStyle = '#484848';
  for (let col = 0; col < cols; col++) {
    ctx.fillRect(col * cw, 0, 2, h);
    bumpCtx.fillRect(col * cw, 0, 2, h);
  }
  for (let row = 0; row < rows; row++) {
    ctx.fillRect(0, row * rh, w, 2);
    bumpCtx.fillRect(0, row * rh, w, 2);
  }
}

export function getFacadeTextures(facadeHex: string, style: string): FacadeTextureSet | null {
  if (typeof document === 'undefined') return null;

  const normStyle = style || 'custom';
  const key = `${facadeHex.toLowerCase()}::${normStyle}`;
  const hit = facadeCache.get(key);
  if (hit) return hit;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext('2d');

  if (!ctx || !bumpCtx) return null;

  const base = refineArchitecturalColor(facadeHex, normStyle === 'college' ? 0.28 : 0.22);

  if (normStyle === 'college') {
    drawBrickFacade(ctx, bumpCtx, size, size, base);
  } else if (normStyle === 'saas' || normStyle === 'business') {
    drawCurtainWallFacade(ctx, bumpCtx, size, size, base);
  } else if (normStyle === 'portfolio') {
    drawPrecastPanelFacade(ctx, bumpCtx, size, size, base, true);
  } else {
    drawPrecastPanelFacade(ctx, bumpCtx, size, size, base, false);
  }

  // Subtle vertical gradient (slight ground-level weathering / ambient occlusion)
  const aoGrad = ctx.createLinearGradient(0, 0, 0, size);
  aoGrad.addColorStop(0, 'rgba(255,255,255,0.04)');
  aoGrad.addColorStop(0.75, 'rgba(0,0,0,0)');
  aoGrad.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = aoGrad;
  ctx.fillRect(0, 0, size, size);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 3);
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2, 3);

  const isMetalTower = normStyle === 'saas' || normStyle === 'business';
  const result: FacadeTextureSet = {
    map,
    bumpMap,
    bumpScale: normStyle === 'college' ? 0.045 : 0.03,
    roughness: isMetalTower ? 0.42 : normStyle === 'college' ? 0.78 : 0.64,
    metalness: isMetalTower ? 0.38 : normStyle === 'college' ? 0.06 : 0.14,
  };

  if (facadeCache.size > 64) {
    facadeCache.clear();
  }
  facadeCache.set(key, result);
  return result;
}

export function getPlinthStoneTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (plinthTextureCache) return plinthTextureCache;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#333b48';
  ctx.fillRect(0, 0, size, size);
  const cols = 4;
  const rows = 2;
  const cw = size / cols;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = seededNoise(c + 5, r + 9);
      const v = 54 + Math.round((n - 0.5) * 16);
      ctx.fillStyle = rgbStr(v, v + 5, v + 12);
      ctx.fillRect(c * cw + 1.5, r * rh + 1.5, cw - 3, rh - 3);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  plinthTextureCache = tex;
  return tex;
}

export function getRoofGravelTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (roofTextureCache) return roofTextureCache;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#2b313d';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 800; i++) {
    const x = seededNoise(i, 11) * size;
    const y = seededNoise(i, 17) * size;
    const v = 35 + Math.round(seededNoise(i, 23) * 32);
    ctx.fillStyle = rgbStr(v, v + 2, v + 6);
    ctx.fillRect(x, y, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  roofTextureCache = tex;
  return tex;
}
