// Eight building color themes — pure data. Adding a theme = appending here.
// Each theme: base facade material, glass tint, trim, and default palette.
export interface CityTheme {
  id: string;
  label: string;
  facade: string;     // main wall color
  facadeDark: string; // shade / lower floors
  glass: string;      // window tint
  trim: string;       // roof, signage, details
  accent: string;     // default accent (lights, beacons)
  ground: string;     // plaza tone
}

export const CITY_THEMES: CityTheme[] = [
  { id: 'midnight',  label: 'Midnight',  facade: '#232a3d', facadeDark: '#171c2b', glass: '#5b74a8', trim: '#3a4664', accent: '#8ab4ff', ground: '#10141f' },
  { id: 'neon',      label: 'Neon Tokyo', facade: '#1b1f2e', facadeDark: '#12141f', glass: '#37f2e5', trim: '#2dd4bf', accent: '#ff2fb3', ground: '#0d1020' },
  { id: 'sandstone', label: 'Sandstone',  facade: '#c9a878', facadeDark: '#a3824f', glass: '#8fb7c9', trim: '#7c5f3f', accent: '#e8c88f', ground: '#8d7a5c' },
  { id: 'glass',     label: 'Glass',      facade: '#aebfd0', facadeDark: '#8296ab', glass: '#cfe6ff', trim: '#5d7185', accent: '#67d6ff', ground: '#5c6d80' },
  { id: 'forest',    label: 'Forest',     facade: '#3f5c46', facadeDark: '#2c4231', glass: '#9fd6a8', trim: '#243b2a', accent: '#a8e063', ground: '#243527' },
  { id: 'mono',      label: 'Monochrome', facade: '#4a4d52', facadeDark: '#35383d', glass: '#b8bcc4', trim: '#26282c', accent: '#d9dde4', ground: '#2a2d33' },
  { id: 'sunset',    label: 'Sunset',     facade: '#8a4a5c', facadeDark: '#5f3140', glass: '#ffb48f', trim: '#3f1f2c', accent: '#ff8f5c', ground: '#4a2438' },
  { id: 'ice',       label: 'Ice',        facade: '#bcd6e4', facadeDark: '#8fb0c4', glass: '#e8f6ff', trim: '#5c84a0', accent: '#4fd8ff', ground: '#33506b' },
];

export function themeById(id: string | null | undefined): CityTheme {
  return CITY_THEMES.find((t) => t.id === id) ?? CITY_THEMES[0];
}


// ── City themes: DAY / NIGHT (sky, fog, lighting, ground) ───────────────
// Distinct from the 8 per-BUILDING color themes above. A city theme sets
// the whole scene mood: sky color, fog, sun strength, and ground tone.
export interface CityMood {
  id: 'day' | 'night';
  label: string;
  sky: string;          // scene background
  fog: string;         // fog color (matches sky for seamless horizon)
  fogNear: number;
  fogFar: number;
  hemiSky: string;     // hemisphere light sky
  hemiGround: string;  // hemisphere light ground
  hemiIntensity: number;
  sun: string;         // directional (sun/moon) color
  sunIntensity: number;
  sunPos: [number, number, number];
  ground: string;      // plaza / city base tone
  ambient: number;
}

export const CITY_MOODS: CityMood[] = [
  {
    id: 'day',
    label: 'Day',
    sky: '#8ec9ff',
    fog: '#bcdcf5',
    fogNear: 160,
    fogFar: 900,
    hemiSky: '#ffffff',
    hemiGround: '#8fb06a',
    hemiIntensity: 0.9,
    sun: '#fff6df',
    sunIntensity: 1.5,
    sunPos: [70, 120, 50],
    ground: '#aeb8a0',
    ambient: 0.35,
  },
  {
    id: 'night',
    label: 'Night',
    sky: '#0b0e16',
    fog: '#0b0e16',
    fogNear: 150,
    fogFar: 800,
    hemiSky: '#b8c4ff',
    hemiGround: '#1a1425',
    hemiIntensity: 0.75,
    sun: '#8ab4ff',
    sunIntensity: 1.15,
    sunPos: [60, 90, 40],
    ground: '#10141f',
    ambient: 0.2,
  },
];

export function moodById(id: string | null | undefined): CityMood {
  return CITY_MOODS.find((m) => m.id === id) ?? CITY_MOODS[1];
}
