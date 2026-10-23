// Developer City — BuildingEditor: customize any building without touching
// code. Every control edits the structured BuildingConfig; Save persists it
// to the project record (server-side), so it survives restarts.

import { useState, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Upload, Sparkles, Trash2 } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { patchProject } from '@/city/api';
import { GRID_SIZE } from '@/city/scene/CityGrid';
import { useCityStore } from '@/city/store';
import { CITY_THEMES } from '@/city/themes';
import { extractBrandColors } from '@/city/utils/brandColors';
import { projectDisplayName, PROJECT_TYPES, PROJECT_TYPE_LABELS, type Project } from '@/city/types';

const PRESET_IMAGES = [
  {
    name: 'Rocket',
    icon: '🚀',
    dataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%2338bdf8"/><stop offset="100%" stop-color="%236366f1"/></linearGradient></defs><path fill="url(%23g)" d="M50 10 C65 30 75 55 70 85 L50 75 L30 85 C25 55 35 30 50 10 Z"/><circle cx="50" cy="40" r="10" fill="%23ffffff"/><polygon points="50,75 42,95 58,95" fill="%23f59e0b"/></svg>`,
  },
  {
    name: 'Gem',
    icon: '💎',
    dataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="30,25 70,25 90,45 50,85 10,45" fill="%2306b6d4"/><polygon points="30,25 50,45 70,25" fill="%23a5f3fc"/><polygon points="50,45 50,85 90,45" fill="%230891b2"/><polygon points="50,45 50,85 10,45" fill="%230e7490"/></svg>`,
  },
  {
    name: 'Shield',
    icon: '🛡️',
    dataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="%238b5cf6" d="M50 15 L80 30 C80 65 50 85 50 85 C50 85 20 65 20 30 Z"/><path fill="%23c4b5fd" d="M50 22 L72 34 C72 60 50 77 50 77 Z"/></svg>`,
  },
  {
    name: 'Star',
    icon: '⭐',
    dataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,10 62,38 92,38 68,56 77,84 50,68 23,84 32,56 8,38 38,38" fill="%23fbbf24"/></svg>`,
  },
];

export function BuildingEditor({
  project,
  onToast,
  onClose,
}: {
  project: Project;
  onToast?: (msg: string, error?: boolean) => void;
  onClose: () => void;
}) {
  const { theme: t } = useTheme();
  const [b, setB] = useState(() => ({ ...project.building }));
  const [name, setName] = useState(() => projectDisplayName(project));
  const [subName, setSubName] = useState('');
  const [palette, setPalette] = useState<(string | null)[]>(() => {
    const cur = project.building.palette;
    if (cur && cur.length === 8) return [...cur];
    const filled = Array.isArray(cur) ? [...cur] : [];
    while (filled.length < 8) filled.push(null);
    return filled.slice(0, 8);
  });
  const [floors, setFloors] = useState<string[]>(
    project.floors.map((f) => (typeof f === 'string' ? f : f.name)),
  );
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof b>(k: K, v: (typeof b)[K]) =>
    setB((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await patchProject(project.id, {
        name: name.trim() || projectDisplayName(project),
        building: {
          ...b,
          palette,
          buildingStyle: b.buildingStyle || project.type,
          subBuildings: b.subBuildings ?? [],
        },
        floors,
      });
      onToast?.(`Building config saved for “${project.name}”`);
      onClose();
    } catch (err) {
      onToast?.(`Save failed: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const useLogo = async () => {
    const img = b.logo || project.logo;
    if (!img) {
      onToast?.('No logo attached to this project yet', true);
      return;
    }
    try {
      const palette = await extractBrandColors(img);
      setB((prev) => ({
        ...prev,
        brandColors: palette,
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        accentColor: palette.accent,
      }));
      onToast?.('Brand colors extracted from logo');
    } catch (err) {
      onToast?.(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const palette = await extractBrandColors(dataUrl);
        setB((prev) => ({
          ...prev,
          logo: dataUrl,
          brandColors: palette,
          primaryColor: palette.primary,
          accentColor: palette.accent,
          customModel3d: {
            enabled: true,
            imageUrl: dataUrl,
            depth: prev.customModel3d?.depth ?? 0.8,
            placement: prev.customModel3d?.placement ?? 'rooftop',
            spinSpeed: prev.customModel3d?.spinSpeed ?? 1,
            scale: prev.customModel3d?.scale ?? 1.0,
          },
        }));
        onToast?.('Image converted to 3D model & colors updated!');
      } catch {
        setB((prev) => ({
          ...prev,
          logo: dataUrl,
          customModel3d: {
            enabled: true,
            imageUrl: dataUrl,
            depth: prev.customModel3d?.depth ?? 0.8,
            placement: prev.customModel3d?.placement ?? 'rooftop',
            spinSpeed: prev.customModel3d?.spinSpeed ?? 1,
            scale: prev.customModel3d?.scale ?? 1.0,
          },
        }));
        onToast?.('Image converted to 3D model!');
      }
    };
    reader.readAsDataURL(file);
  };

  const applyPresetImage = async (preset: { name: string; dataUrl: string }) => {
    try {
      const palette = await extractBrandColors(preset.dataUrl);
      setB((prev) => ({
        ...prev,
        brandColors: palette,
        primaryColor: palette.primary,
        accentColor: palette.accent,
        customModel3d: {
          enabled: true,
          imageUrl: preset.dataUrl,
          depth: prev.customModel3d?.depth ?? 0.8,
          placement: prev.customModel3d?.placement ?? 'rooftop',
          spinSpeed: prev.customModel3d?.spinSpeed ?? 1,
          scale: prev.customModel3d?.scale ?? 1.0,
        },
      }));
      onToast?.(`Preset “${preset.name}” converted to 3D model!`);
    } catch {
      setB((prev) => ({
        ...prev,
        customModel3d: {
          enabled: true,
          imageUrl: preset.dataUrl,
          depth: prev.customModel3d?.depth ?? 0.8,
          placement: prev.customModel3d?.placement ?? 'rooftop',
          spinSpeed: prev.customModel3d?.spinSpeed ?? 1,
          scale: prev.customModel3d?.scale ?? 1.0,
        },
      }));
      onToast?.(`Preset “${preset.name}” applied as 3D model!`);
    }
  };

  const addFloor = () => setFloors((f) => [...f, `Floor ${f.length + 1}`]);
  const removeFloor = (i: number) => setFloors((f) => f.filter((_, j) => j !== i));

  const subBuildings = b.subBuildings ?? [];
  const addSubBuilding = () => {
    const label = subName.trim();
    if (!label || subBuildings.length >= 6) return;
    const id = Math.random().toString(36).slice(2, 8);
    setB((prev) => {
      const cur = prev.subBuildings ?? [];
      if (cur.length >= 6) return prev;
      const n = cur.length;
      return {
        ...prev,
        subBuildings: [...cur, { id, name: label, dx: (n % 3 - 1) * 2, dz: 2 }],
      };
    });
    setSubName('');
  };
  const removeSubBuilding = (id: string) =>
    setB((prev) => ({
      ...prev,
      subBuildings: (prev.subBuildings ?? []).filter((s) => s.id !== id),
    }));

  const panel: CSSProperties = {
    position: 'absolute',
    top: 64,
    right: 12,
    width: 290,
    maxHeight: 'calc(100% - 140px)',
    overflowY: 'auto',
    background: 'rgba(10,12,20,0.94)',
    border: `1px solid ${t.colors.border.primary}`,
    borderRadius: 12,
    backdropFilter: 'blur(10px)',
    color: t.colors.text.primary,
    zIndex: 30,
    padding: 14,
    fontSize: 12,
  };

  const row: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  };
  const label: CSSProperties = { color: t.colors.text.muted, fontSize: 11, letterSpacing: 0.5 };

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Building editor</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.colors.text.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>
      <div style={{ ...label, marginTop: 4 }}>“{project.name}”</div>

      <div style={{ ...label, marginTop: 12 }}>THEME (8 presets)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
        {CITY_THEMES.map((th) => (
          <button
            key={th.id}
            onClick={() => set('theme', th.id)}
            title={th.label}
            style={{
              width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
              background: `linear-gradient(135deg, ${th.facade} 55%, ${th.accent} 55%)`,
              border: b.theme === th.id ? `2px solid ${th.accent}` : '1px solid ' + t.colors.border.primary,
            }}
          />
        ))}
      </div>

      <div style={{ ...label, marginTop: 12 }}>BUILDING TYPE</div>
      <select
        value={b.buildingStyle || project.type}
        onChange={(e) => set('buildingStyle', e.target.value)}
        style={{
          width: '100%', marginTop: 4, background: t.colors.bg.tertiary,
          border: `1px solid ${t.colors.border.primary}`, borderRadius: 6,
          color: t.colors.text.primary, fontSize: 12, padding: '6px 8px',
        }}
      >
        {PROJECT_TYPES.map((type) => (
          <option key={type} value={type}>{PROJECT_TYPE_LABELS[type]}</option>
        ))}
      </select>

      <div style={{ ...label, marginTop: 12 }}>POSITION ON CITY GRID</div>
      <p style={{ ...label, opacity: 0.6, marginTop: 2, fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
        Click a free cell to move this building (saves immediately)
      </p>
      <PositionPicker project={project} onToast={onToast} />

      <div style={{ ...label, marginTop: 12 }}>COLORS</div>
      {(['primaryColor', 'secondaryColor', 'accentColor'] as const).map((k) => (
        <div key={k} style={row}>
          <span style={label}>{k.replace('Color', '')}</span>
          <input
            type="color"
            value={(b[k] as string) || '#4f8ff7'}
            onChange={(e) => set(k, e.target.value)}
            style={{ width: 34, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }}
          />
        </div>
      ))}
      <div style={row}>
        <span style={label}>from logo</span>
        <button onClick={useLogo} style={tinyBtn(t)}>Extract brand colors</button>
      </div>

      {/* ── 3D MODEL FROM CUSTOM IMAGE ──────────────────────────── */}
      <div style={{ ...label, marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, color: '#f8fafc' }}>CUSTOM 3D MODEL FROM IMAGE</span>
        {b.customModel3d?.enabled && (
          <span style={{ color: '#4ade80', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
            <Sparkles size={11} /> 3D ACTIVE
          </span>
        )}
      </div>
      <p style={{ ...label, opacity: 0.65, marginTop: 2, fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
        Upload any image (logo, icon, photo). It automatically converts into a true 3D volumetric model directly in the browser without API keys.
      </p>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            background: 'rgba(59, 130, 246, 0.15)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            color: '#93c5fd',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Upload size={12} /> Upload Custom Image
        </button>
      </div>

      {/* Quick Presets */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ ...label, fontSize: 10 }}>Presets:</span>
        {PRESET_IMAGES.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyPresetImage(preset)}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#e2e8f0',
              borderRadius: 6,
              padding: '2px 6px',
              fontSize: 10,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            title={`Use ${preset.name} as 3D model`}
          >
            <span>{preset.icon}</span>
            <span>{preset.name}</span>
          </button>
        ))}
      </div>

      {b.customModel3d?.imageUrl && (
        <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
          {/* Thumbnail preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={b.customModel3d.imageUrl}
              alt="Custom 3D Model Source"
              style={{ width: 36, height: 36, objectFit: 'contain', background: '#0f172a', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#f8fafc' }}>3D Model Active</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>
                Placement: {b.customModel3d.placement || 'rooftop'}
              </div>
            </div>
            <button
              onClick={() => setB((prev) => ({ ...prev, customModel3d: null }))}
              title="Remove 3D Model"
              style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: 4 }}
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Placement selector */}
          <div style={{ ...row, marginTop: 8 }}>
            <span style={label}>Placement</span>
            <select
              value={b.customModel3d.placement || 'rooftop'}
              onChange={(e) => setB((prev) => ({
                ...prev,
                customModel3d: { ...prev.customModel3d!, placement: e.target.value as any }
              }))}
              style={{
                background: t.colors.bg.tertiary,
                border: `1px solid ${t.colors.border.primary}`,
                color: t.colors.text.primary,
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 11,
              }}
            >
              <option value="rooftop">🏛️ Rooftop Monument</option>
              <option value="facade">🏢 Front Facade</option>
              <option value="plaza">⛲ Plaza Statue</option>
            </select>
          </div>

          {/* 3D Extrusion Depth slider */}
          <div style={row}>
            <span style={label}>3D Depth ({(b.customModel3d.depth ?? 0.8).toFixed(1)}x)</span>
            <input
              type="range"
              min={0.2}
              max={2.0}
              step={0.1}
              value={b.customModel3d.depth ?? 0.8}
              onChange={(e) => setB((prev) => ({
                ...prev,
                customModel3d: { ...prev.customModel3d!, depth: parseFloat(e.target.value) }
              }))}
              style={{ flex: 1 }}
            />
          </div>

          {/* Spin Speed slider */}
          <div style={row}>
            <span style={label}>Spin Speed ({b.customModel3d.spinSpeed ?? 1}x)</span>
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={b.customModel3d.spinSpeed ?? 1}
              onChange={(e) => setB((prev) => ({
                ...prev,
                customModel3d: { ...prev.customModel3d!, spinSpeed: parseInt(e.target.value) }
              }))}
              style={{ flex: 1 }}
            />
          </div>
        </div>
      )}

      <div style={{ ...label, marginTop: 12 }}>BUILDING NAME</div>
      <div style={{ ...row, marginTop: 4 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Building name"
          style={{
            flex: 1, minWidth: 0, background: t.colors.bg.tertiary,
            border: `1px solid ${t.colors.border.primary}`, borderRadius: 6,
            color: t.colors.text.primary, fontSize: 12, padding: '4px 6px',
          }}
        />
      </div>

      <div style={{ ...label, marginTop: 12 }}>
        8-COLOR PALETTES{' '}
        <span style={{ opacity: 0.6 }}>— fill any of the 8 slots; empty inherits the theme</span>
      </div>
      {PALETTE_SLOTS.map((slot, i) => (
        <div key={slot} style={row}>
          <span style={{ ...label, minWidth: 66 }}>{slot}</span>
          <input
            type="color"
            value={palette[i] || '#4f8ff7'}
            onChange={(e) =>
              setPalette((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
            }
            style={{
              width: 30, height: 20, border: 'none', background: 'transparent', cursor: 'pointer',
              opacity: palette[i] ? 1 : 0.35,
            }}
            title={palette[i] ? slot : `${slot} (unset — inherits theme)`}
          />
          {palette[i] ? (
            <button
              onClick={() => setPalette((prev) => prev.map((v, j) => (j === i ? null : v)))}
              title={`Clear ${slot}`}
              style={{ ...tinyBtn(t), flex: 'none', padding: '2px 6px' }}
            >
              clear
            </button>
          ) : (
            <span style={{ color: t.colors.text.muted, fontSize: 10, flex: 'none' }}>unset</span>
          )}
        </div>
      ))}

      <div style={{ ...label, marginTop: 12 }}>SHAPE</div>
      <div style={row}>
        <span style={label}>scale {b.scale?.toFixed(2)}</span>
        <input
          type="range" min={0.5} max={2} step={0.1}
          value={b.scale || 1}
          onChange={(e) => set('scale', parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
      </div>
      <div style={row}>
        <span style={label}>rotation {Math.round(b.rotation || 0)}°</span>
        <input
          type="range" min={0} max={355} step={5}
          value={b.rotation || 0}
          onChange={(e) => set('rotation', parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
      </div>

      <div style={{ ...label, marginTop: 12 }}>FLOORS / ROOMS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
        {floors.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={f}
              onChange={(e) => setFloors((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              style={{ flex: 1, background: t.colors.bg.tertiary, border: `1px solid ${t.colors.border.primary}`, borderRadius: 6, color: t.colors.text.primary, padding: '3px 6px', fontSize: 11 }}
            />
            <button onClick={() => removeFloor(i)} style={tinyBtn(t)}>✕</button>
          </div>
        ))}
        <button onClick={addFloor} style={tinyBtn(t)}>+ add floor</button>
      </div>

      <div style={{ ...label, marginTop: 12 }}>SUB-BUILDINGS</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          value={subName}
          onChange={(e) => setSubName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addSubBuilding(); }}
          placeholder={subBuildings.length >= 6 ? 'Limit reached' : 'Name'}
          disabled={subBuildings.length >= 6}
          style={{
            flex: 1, minWidth: 0, background: t.colors.bg.tertiary,
            border: `1px solid ${t.colors.border.primary}`, borderRadius: 6,
            color: t.colors.text.primary, fontSize: 11, padding: '3px 6px',
          }}
        />
        <button
          onClick={addSubBuilding}
          disabled={subBuildings.length >= 6 || !subName.trim()}
          style={{ ...tinyBtn(t), opacity: subBuildings.length >= 6 || !subName.trim() ? 0.45 : 1 }}
        >
          Add
        </button>
      </div>
      {subBuildings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {subBuildings.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </span>
              <button onClick={() => removeSubBuilding(s.id)} style={tinyBtn(t)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={save}
          disabled={busy}
          style={{
            flex: 1, background: t.colors.accent.primary, color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Saving…' : 'Save building config'}
        </button>
      </div>
    </div>
  );
}

const PALETTE_SLOTS = [
  'facade', 'plinth', 'glass', 'accent',
  'lit glow', 'plaza ring', 'sign bg', 'trim',
] as const;

function tinyBtn(t: any): CSSProperties {
  return {
    background: 'transparent',
    border: `1px solid ${t.colors.border.primary}`,
    color: t.colors.text.secondary,
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 11,
    cursor: 'pointer',
  };
}


function PositionPicker({
  project,
  onToast,
}: {
  project: Project;
  onToast?: (msg: string, error?: boolean) => void;
}) {
  const { theme: t } = useTheme();
  const projects = useCityStore((s) => s.projects);
  const [moving, setMoving] = useState(false);
  // Read the live plot from the store so the highlight follows a move
  // immediately (the `project` prop is a snapshot from when the editor opened).
  const cur = projects[project.id]?.plot ?? project.plot;

  const occupied = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of Object.values(projects)) {
      if (p.plot) m.set(`${p.plot.x},${p.plot.y}`, p.id);
    }
    return m;
  }, [projects]);

  const move = async (x: number, y: number) => {
    if (moving) return;
    if (cur?.x === x && cur?.y === y) return;
    setMoving(true);
    try {
      const updated = await patchProject(project.id, { plot: { x, y } });
      useCityStore.getState().upsertProject(updated);
      onToast?.(`Moved “${project.name}” to grid ${x},${y}`);
    } catch (err) {
      onToast?.(`Move failed: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setMoving(false);
    }
  };

  const cells = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const key = `${x},${y}`;
      const isHere = cur?.x === x && cur?.y === y;
      const occBy = occupied.get(key);
      const blocked = !!occBy && !isHere;
      cells.push(
        <button
          key={key}
          disabled={blocked || moving}
          onClick={() => move(x, y)}
          title={
            isHere
              ? `“${project.name}” is here (${x}, ${y})`
              : blocked
                ? `Occupied (${x}, ${y})`
                : `Move here (${x}, ${y})`
          }
          style={{
            aspectRatio: '1',
            borderRadius: 3,
            border: isHere
              ? `2px solid ${t.colors.accent?.primary || '#8ab4ff'}`
              : blocked
                ? `1px solid ${t.colors.border?.subtle || '#23262e'}`
                : '1px solid ' + (t.colors.border?.primary || '#2a2f3a'),
            background: isHere
              ? t.colors.accent.light
              : blocked
                ? 'transparent'
                : 'rgba(255,255,255,0.03)',
            cursor: blocked ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 8,
            color: isHere ? t.colors.text.primary : 'rgba(255,255,255,0.45)',
            opacity: blocked && !isHere ? 0.4 : 1,
            transition: 'all 0.1s ease',
          }}
        >
          {blocked ? '·' : isHere ? '◆' : ''}
        </button>,
      );
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
        gap: 3,
        marginTop: 6,
      }}
    >
      {cells}
    </div>
  );
}
