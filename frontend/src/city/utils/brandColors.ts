// Developer City — brand color extraction from a logo/screenshot.
// Fetches the image as a blob (the sidecar allows CORS for 127.0.0.1),
// samples it on a small canvas, and returns a 3-color palette:
//   primary   = most prominent saturated color
//   secondary = next most prominent
//   accent    = most vivid
// Pure data out — the caller stores it on the building config.

export interface BrandPalette {
  primary: string;
  secondary: string;
  accent: string;
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function saturation(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

export async function extractBrandColors(imageUrl: string): Promise<BrandPalette> {
  // Object URLs / same-origin: load directly. Otherwise fetch → blob URL.
  let src = imageUrl;
  if (!imageUrl.startsWith('data:') && !imageUrl.startsWith('blob:') && imageUrl.startsWith('http')) {
    const res = await fetch(imageUrl, { mode: 'cors' });
    if (!res.ok) throw new Error(`could not fetch image (HTTP ${res.status})`);
    const blob = await res.blob();
    src = URL.createObjectURL(blob);
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('image failed to decode'));
    el.src = src;
  });

  const SIZE = 48;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  if (src.startsWith('blob:')) URL.revokeObjectURL(src);

  // Bucket quantization: 4-bit per channel → at most 4096 buckets.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number; sat: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r + g + b < 40 || r + g + b > 760) continue; // skip near-black/white
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, sat: 0 };
    cur.r += r; cur.g += g; cur.b += b; cur.n += 1;
    cur.sat += saturation(r, g, b);
    buckets.set(key, cur);
  }

  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
  if (ranked.length === 0) {
    return { primary: '#4f8ff7', secondary: '#8ab4ff', accent: '#22c55e' };
  }

  const avg = (c: { r: number; g: number; b: number; n: number }) => [c.r / c.n, c.g / c.n, c.b / c.n] as const;
  const primary = avg(ranked[0]);
  const secondary = ranked.length > 1 ? avg(ranked[1]) : primary;
  const vivid = [...ranked].sort((a, b) => b.sat / b.n - a.sat / a.n)[0];
  const accent = avg(vivid);

  return {
    primary: toHex(...primary),
    secondary: toHex(...secondary),
    accent: toHex(...accent),
  };
}
