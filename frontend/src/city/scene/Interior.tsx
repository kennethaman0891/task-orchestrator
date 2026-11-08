// Developer City — InteriorFloor: Realistic, dynamic 3D office interior tailored to the REAL project folder.
// Each floor features differentiated architecture, real project files, active server clusters,
// interactive code workstations, master blueprint boards, and functional room objects.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { AgentBot, FloorSpec, Project, FloorPlanFloor, FloorPlanObject } from '@/city/types';
import { AgentBots } from './Bots';
import { themeById } from '@/city/themes';
import { useBuildingMaterials } from './archetypes';
import { useProjectFloorPlan, generateFallbackFloorPlan } from '@/city/utils/projectScanner';
import { useCityStore } from '@/city/store';

export function floorName(p: Project, index: number): string {
  const f = p.floors?.[index];
  if (typeof f === 'string') return f;
  if ((f as FloorSpec)?.name) return (f as FloorSpec).name;

  const plan = generateFallbackFloorPlan(p);
  if (plan.floors[index]) {
    return `Floor ${index + 1} · ${plan.floors[index].name}`;
  }
  return `Floor ${index + 1}`;
}

export function roomsOfFloor(p: Project, index: number): string[] {
  const f = p.floors?.[index];
  if (typeof f === 'string') return [f];
  if ((f as FloorSpec)?.rooms?.length) return (f as FloorSpec).rooms!;

  const plan = generateFallbackFloorPlan(p);
  const floor = plan.floors[index] || plan.floors[0];
  if (floor?.objects) {
    return floor.objects.map((o) => o.title.split(' ')[0] || 'Zone');
  }
  return ['Workstations', 'Infrastructure', 'Lounge'];
}

/** Generates realistic flooring texture tailored to floorStyle */
function makeFloorTexture(style: 'oak' | 'tile' | 'steel' | 'obsidian' | 'slate' | 'walnut', accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  if (style === 'tile') {
    // Data Center Raised Antistatic Tile
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 512; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(512, x); ctx.stroke();
    }
    // Perforated vent tile accents
    ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
    ctx.fillRect(128, 128, 128, 128);
    ctx.fillRect(320, 256, 128, 128);
  } else if (style === 'steel') {
    // Industrial Diamond Plate / Brushed Steel
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 512; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 32, 512); ctx.stroke();
    }
  } else if (style === 'obsidian') {
    // Cyber Glossy Obsidian with Glowing Neon Grid
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = accent || '#a855f7';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    for (let x = 0; x <= 512; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(512, x); ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
  } else if (style === 'slate') {
    // Textured Grey Slate with Hazard Perimeter
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#0f172a';
    for (let i = 0; i < 20; i++) {
      ctx.fillRect((i * 47) % 480, (i * 73) % 480, 48, 48);
    }
  } else {
    // Oak or Walnut Parquet Flooring
    const baseColor = style === 'walnut' ? '#5c4028' : '#bfa175';
    const altColor = style === 'walnut' ? '#4a3320' : '#cbaf84';
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 512, 512);

    const plankH = 64;
    for (let i = 0; i < 8; i++) {
      const y = i * plankH;
      ctx.fillStyle = i % 2 === 0 ? altColor : baseColor;
      ctx.fillRect(0, y + 1, 512, plankH - 2);

      ctx.strokeStyle = 'rgba(78, 52, 24, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0, y + 0.5, 512, plankH - 1);

      const offset = (i % 3) * 160 + 90;
      ctx.beginPath();
      ctx.moveTo(offset, y + 1);
      ctx.lineTo(offset, y + plankH - 1);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.needsUpdate = true;
  return tex;
}

/** Generates dynamic syntax-colored code editor texture displaying REAL project code */
function makeCodeTexture(accentColor: string, fileName: string, codeLines?: string[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  // Dark IDE editor background
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(0, 0, 512, 256);

  // Title bar
  ctx.fillStyle = '#141c2b';
  ctx.fillRect(0, 0, 512, 24);

  // Window dots
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(14, 12, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(26, 12, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.arc(38, 12, 3.5, 0, Math.PI * 2); ctx.fill();

  // Tab label
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(55, 4, 160, 20);
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(fileName.split('/').pop() || 'App.tsx', 68, 17);

  // Render real code lines or syntax highlighted tokens
  const lines = codeLines && codeLines.length > 0 ? codeLines : [
    '// Project Source File',
    'export function Component() {',
    '  const [state, setState] = useState(true);',
    '  return <div>Active Component</div>;',
    '}',
  ];

  ctx.font = '10px monospace';
  for (let l = 0; l < Math.min(10, lines.length); l++) {
    const y = 46 + l * 18;
    // Line number
    ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.fillText(String(l + 1).padStart(2, ' '), 12, y);

    // Text content
    const text = lines[l];
    if (text.startsWith('//') || text.startsWith('#')) {
      ctx.fillStyle = '#64748b';
    } else if (text.startsWith('import') || text.startsWith('export') || text.startsWith('from') || text.startsWith('def') || text.startsWith('fn')) {
      ctx.fillStyle = '#c084fc';
    } else if (text.includes('(') || text.includes('=')) {
      ctx.fillStyle = accentColor || '#38bdf8';
    } else {
      ctx.fillStyle = '#e2e8f0';
    }
    ctx.fillText(text.slice(0, 52), 40, y);
  }

  // Mini terminal footer
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 222, 512, 34);
  ctx.fillStyle = '#22c55e';
  ctx.font = '10px monospace';
  ctx.fillText('● Live Sync · 0 errors · Ready', 14, 242);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Generates master architecture blueprint texture */
function makeBlueprintTexture(title: string, docs: string[] = []): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  // Blueprint grid background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 24) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }

  // Title
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('ARCHITECTURE BLUEPRINT · ' + title.toUpperCase(), 18, 32);

  // Diagram boxes
  ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;

  // Box 1: Frontend
  ctx.fillRect(20, 56, 140, 68);
  ctx.strokeRect(20, 56, 140, 68);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('UI / Three.js', 32, 82);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText('React + Vite', 32, 102);

  // Connector arrow
  ctx.strokeStyle = '#a855f7';
  ctx.beginPath(); ctx.moveTo(160, 90); ctx.lineTo(200, 90); ctx.stroke();

  // Box 2: IPC & Backend
  ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
  ctx.strokeStyle = '#a855f7';
  ctx.fillRect(200, 56, 140, 68);
  ctx.strokeRect(200, 56, 140, 68);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('IPC & FastAPI', 212, 82);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText('Python Sidecar', 212, 102);

  // Connector arrow
  ctx.strokeStyle = '#10b981';
  ctx.beginPath(); ctx.moveTo(340, 90); ctx.lineTo(380, 90); ctx.stroke();

  // Box 3: Storage
  ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
  ctx.strokeStyle = '#10b981';
  ctx.fillRect(380, 56, 110, 68);
  ctx.strokeRect(380, 56, 110, 68);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('Data Sync', 392, 82);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText('JSON / SQLite', 392, 102);

  // Docs list at bottom
  ctx.fillStyle = '#f8fafc';
  ctx.font = '11px monospace';
  ctx.fillText('SPECS: ' + (docs.slice(0, 3).join('  ·  ') || 'ARCHITECTURE.md · SECURITY_AUDIT.md'), 20, 160);

  ctx.fillStyle = '#22c55e';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('● SYSTEM STATUS: VERIFIED & COMPLIANT', 20, 230);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Generates dynamic live system telemetry & build monitor texture */
function makeTelemetryTexture(projectName: string, accentColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  // Dark futuristic telemetry display background
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, 512, 256);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
  }
  for (let y = 0; y <= 256; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }

  // Header Bar
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(0, 0, 512, 34);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.beginPath(); ctx.moveTo(0, 34); ctx.lineTo(512, 34); ctx.stroke();

  // Status Indicator Dot
  ctx.fillStyle = '#10b981';
  ctx.beginPath(); ctx.arc(18, 17, 5, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = accentColor || '#38bdf8';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('SYSTEM TELEMETRY · ' + projectName.toUpperCase(), 32, 21);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText('LIVE DIAGNOSTICS', 390, 21);

  // Simulated activity waveform
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const wave = [40, 55, 38, 72, 60, 85, 45, 90, 65, 78, 52, 68, 82, 45, 58, 70, 88, 62, 50, 75, 60, 48];
  const stepX = 220 / (wave.length - 1);
  for (let i = 0; i < wave.length; i++) {
    const wx = 24 + i * stepX;
    const wy = 145 - wave[i] * 0.7;
    if (i === 0) ctx.moveTo(wx, wy);
    else ctx.lineTo(wx, wy);
  }
  ctx.stroke();

  // Waveform area fill
  ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.lineTo(24 + (wave.length - 1) * stepX, 155);
  ctx.lineTo(24, 155);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#64748b';
  ctx.font = '9px monospace';
  ctx.fillText('REAL-TIME WORKSPACE PROFILER', 24, 168);

  // Metrics Grid Cards on Right
  const metrics = [
    { label: 'MEMORY', val: '42.8 MB', col: '#38bdf8' },
    { label: 'VIEWPORT', val: '60 FPS', col: '#10b981' },
    { label: 'IPC RELAY', val: '12ms', col: '#a855f7' },
    { label: 'BUILD', val: 'PASSED', col: '#22c55e' },
  ];

  metrics.forEach((m, idx) => {
    const mx = 270 + (idx % 2) * 115;
    const my = 48 + Math.floor(idx / 2) * 58;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
    ctx.fillRect(mx, my, 105, 48);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeRect(mx, my, 105, 48);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText(m.label, mx + 8, my + 16);

    ctx.fillStyle = m.col;
    ctx.font = 'bold 14px monospace';
    ctx.fillText(m.val, mx + 8, my + 38);
  });

  // Footer status bar
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(16, 190, 480, 46);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
  ctx.strokeRect(16, 190, 480, 46);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px monospace';
  ctx.fillText('BRANCH: main · SYSTEM HEALTH: NOMINAL · ZERO WARNINGS', 28, 218);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Generates live preview billboard texture */
function makePreviewTexture(projectName: string, tech: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 512, 256);

  // App mockup header
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 512, 32);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('🌐 ' + projectName.toUpperCase() + ' · LIVE APPLICATION PREVIEW', 16, 21);

  // App content card mockup
  ctx.fillStyle = '#182338';
  ctx.roundRect ? ctx.roundRect(24, 52, 464, 180, 10) : ctx.fillRect(24, 52, 464, 180);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(projectName, 48, 96);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px sans-serif';
  ctx.fillText('Active Developer City Workspace · Interactive 3D Canvas', 48, 126);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '12px monospace';
  ctx.fillText('Tech: ' + tech, 48, 160);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('● 60 FPS Viewport Online', 48, 196);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
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
  const floorPlan = useProjectFloorPlan(project);
  const activePlanFloor: FloorPlanFloor =
    floorPlan?.floors?.[floorIndex] ||
    floorPlan?.floors?.[0] ||
    generateFallbackFloorPlan(project).floors[0];

  const setActiveObjectInspection = useCityStore((s) => s.setActiveObjectInspection);

  const b = project.building;
  const theme = themeById(b.theme);
  const facade = b.primaryColor || theme.facade;
  const accent = activePlanFloor.accentColor || b.accentColor || theme.accent;
  const mats = useBuildingMaterials(facade, theme.facadeDark, theme.glass, accent);

  // Blinking server LEDs
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

  // Dynamic textures based on real project floor plan
  const materials = useMemo(() => {
    const floorMap = makeFloorTexture(activePlanFloor.floorStyle || 'oak', accent);
    const codeObj = activePlanFloor.objects?.find((o) => o.type === 'workstation');
    const codeMap1 = makeCodeTexture(accent, codeObj?.file || 'App.tsx', codeObj?.codeLines1);
    const codeMap2 = makeCodeTexture('#38bdf8', codeObj?.file2 || 'CityView.tsx', codeObj?.codeLines2);
    const blueprintObj = activePlanFloor.objects?.find((o) => o.type === 'blueprint_board');
    const blueprintMap = makeBlueprintTexture(project.name || 'Project', blueprintObj?.docs);
    const previewMap = makePreviewTexture(project.name || 'Project', floorPlan?.project.techStack?.join(', ') || 'React, Python, Rust');
    const telemetryMap = makeTelemetryTexture(project.name || 'Project', accent);

    return {
      floorMap,
      codeMap1,
      codeMap2,
      blueprintMap,
      previewMap,
      telemetryMap,
      floorMesh: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: floorMap,
        roughness: activePlanFloor.floorStyle === 'obsidian' ? 0.2 : 0.65,
        metalness: activePlanFloor.floorStyle === 'steel' ? 0.7 : 0.1,
      }),
      floorInlay: new THREE.MeshStandardMaterial({
        color: activePlanFloor.floorStyle === 'obsidian' ? accent : '#654827',
        roughness: 0.45,
      }),
      plaster: new THREE.MeshStandardMaterial({
        color: activePlanFloor.wallStyle === 'dark_concrete' ? '#1e293b' : activePlanFloor.wallStyle === 'wood_panel' ? '#452b1b' : '#f8fafc',
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
      cutawayGlass: new THREE.MeshStandardMaterial({
        color: '#e0f2fe',
        transparent: true,
        opacity: 0.22,
        roughness: 0.08,
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
        emissiveIntensity: 0.9,
        roughness: 0.15,
      }),
      codeDisplay2: new THREE.MeshStandardMaterial({
        map: codeMap2,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: codeMap2,
        emissiveIntensity: 0.85,
        roughness: 0.15,
      }),
      blueprintDisplay: new THREE.MeshStandardMaterial({
        map: blueprintMap,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: blueprintMap,
        emissiveIntensity: 0.75,
        roughness: 0.25,
      }),
      previewDisplay: new THREE.MeshStandardMaterial({
        map: previewMap,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: previewMap,
        emissiveIntensity: 0.85,
        roughness: 0.15,
      }),
      telemetryDisplay: new THREE.MeshStandardMaterial({
        map: telemetryMap,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: telemetryMap,
        emissiveIntensity: 0.9,
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
      sofaFabric: new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 0.85,
      }),
      loungeLeather: new THREE.MeshStandardMaterial({
        color: '#c2410c', // Warm cognac / saddle leather
        roughness: 0.65,
        metalness: 0.05,
      }),
      loungeWood: new THREE.MeshStandardMaterial({
        color: '#5c4028', // American Walnut plinth
        roughness: 0.35,
        metalness: 0.1,
      }),
      marble: new THREE.MeshStandardMaterial({
        color: '#f8fafc', // Carrara Marble
        roughness: 0.15,
        metalness: 0.05,
      }),
      brass: new THREE.MeshStandardMaterial({
        color: '#eab308', // Brushed Brass
        roughness: 0.25,
        metalness: 0.85,
      }),
      plantLeaf: new THREE.MeshStandardMaterial({
        color: '#16a34a', // Lush Ficus green
        roughness: 0.35,
      }),
      plantPot: new THREE.MeshStandardMaterial({
        color: '#f1f5f9', // Matte Ceramic White
        roughness: 0.25,
      }),
      elevatorDoor: new THREE.MeshStandardMaterial({
        color: '#e2e8f0',
        roughness: 0.2,
        metalness: 0.9,
      }),
    };
  }, [activePlanFloor, accent, project.name, floorPlan]);

  useEffect(() => {
    const bag = materials;
    return () => {
      bag.floorMap.dispose();
      bag.codeMap1.dispose();
      bag.codeMap2.dispose();
      bag.blueprintMap.dispose();
      bag.previewMap.dispose();
      bag.telemetryMap.dispose();
      bag.floorMesh.dispose();
    };
  }, [materials]);

  const Y = floorIndex * floorH;
  const deskX1 = -width * 0.24;
  const deskZ = depth * 0.12;

  // Interactive hover state
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);

  const handlePointerOver = (objId: string) => {
    setHoveredObjectId(objId);
    document.body.style.cursor = 'pointer';
  };
  const handlePointerOut = () => {
    setHoveredObjectId(null);
    document.body.style.cursor = 'auto';
  };

  const devAgents = agents.slice(0, 2);
  const loungeAgents = agents.slice(2, 4);

  const interiorViewMode = useCityStore((s) => s.interiorViewMode);
  const isWalkIn = interiorViewMode === 'walk-in';

  // Find relevant objects from the scanned floor plan
  const workstationObj = activePlanFloor.objects?.find((o) => o.type === 'workstation');
  const serverObj = activePlanFloor.objects?.find((o) => o.type === 'server_pod');
  const blueprintObj = activePlanFloor.objects?.find((o) => o.type === 'blueprint_board');
  const previewObj = activePlanFloor.objects?.find((o) => o.type === 'preview_billboard');
  const loungeObj = activePlanFloor.objects?.find((o) => o.type === 'lounge') || {
    id: `${activePlanFloor.folder || 'floor'}_strategy_hub`,
    type: 'lounge' as const,
    title: 'Breakout Strategy & Agent Collaboration Hub',
    position: [width * 0.26, 0.16, depth * 0.24] as [number, number, number],
    status: 'Standup Active · 2 Agents Synced',
    details: 'Autonomous Agent Standup, Task Retrospectives & Strategic Decisions',
  };
  const telemetryObj: FloorPlanObject = {
    id: 'system_telemetry_screen',
    type: 'preview_billboard',
    title: 'Live System Telemetry & Workspace Profiler',
    position: [-width * 0.24, floorH * 0.50, -depth / 2 + 0.12] as [number, number, number],
    status: '60 FPS Viewport Online · Nominal',
    details: 'Real-Time CPU/Memory Profiler, 12ms IPC Relay, 0 Errors, Main Git Branch Healthy',
  };

  return (
    <group position={[0, Y, 0]}>
      {/* ── Floor Base Slab ── */}
      <mesh position={[0, 0.02, 0]} receiveShadow material={materials.baseboard}>
        <boxGeometry args={[width, 0.16, depth]} />
      </mesh>

      {/* ── Dynamic Architectural Flooring Material ── */}
      <mesh position={[0, 0.11, 0]} receiveShadow material={materials.floorMesh}>
        <boxGeometry args={[width - 0.16, 0.04, depth - 0.16]} />
      </mesh>

      {/* Decorative Floor Inlays */}
      {[
        [0, depth * 0.38, width - 0.9, 0.05],
        [0, -depth * 0.38, width - 0.9, 0.05],
      ].map(([x, z, w, d], i) => (
        <mesh key={`inlay-z-${i}`} position={[x, 0.136, z]} receiveShadow material={materials.floorInlay}>
          <boxGeometry args={[w, 0.012, d]} />
        </mesh>
      ))}

      {/* ── 4 Slender Corner Structural Columns ── */}
      {[-width / 2 + 0.1, width / 2 - 0.1].map((cx, cxi) =>
        [-depth / 2 + 0.1, depth / 2 - 0.1].map((cz, czi) => (
          <mesh
            key={`col-${cxi}-${czi}`}
            position={[cx, floorH / 2 + 0.14, cz]}
            material={materials.interiorFrame}
            castShadow
          >
            <boxGeometry args={[0.12, floorH, 0.12]} />
          </mesh>
        )),
      )}

      {/* ── Front Glass Balustrade (Dollhouse Cutaway) ── */}
      <group position={[0, 0.16, depth / 2 - 0.08]}>
        <mesh position={[0, 0.05, 0]} material={mats.trim}>
          <boxGeometry args={[width - 0.2, 0.1, 0.08]} />
        </mesh>
        <mesh position={[0, 0.32, 0]} material={materials.interiorGlass}>
          <boxGeometry args={[width - 0.32, 0.44, 0.02]} />
        </mesh>
        <mesh position={[0, 0.55, 0]} material={mats.trim}>
          <boxGeometry args={[width - 0.24, 0.03, 0.04]} />
        </mesh>
      </group>

      {/* ── Back Wall: Master Blueprint Board or Live Telemetry Monitor ── */}
      <group position={[0, floorH / 2 + 0.14, -depth / 2 + 0.08]}>
        <mesh material={materials.plaster}>
          <boxGeometry args={[width, floorH, 0.16]} />
        </mesh>

        {blueprintObj ? (
          <group
            position={[0, floorH * 0.18, 0.1]}
            onPointerOver={(e) => { e.stopPropagation(); handlePointerOver(blueprintObj.id); }}
            onPointerOut={handlePointerOut}
            onClick={(e) => { e.stopPropagation(); setActiveObjectInspection(blueprintObj); }}
          >
            <mesh material={materials.interiorFrame}>
              <boxGeometry args={[3.8, 1.8, 0.06]} />
            </mesh>
            <mesh position={[0, 0, 0.035]} material={materials.blueprintDisplay}>
              <planeGeometry args={[3.7, 1.7]} />
            </mesh>
            {hoveredObjectId === blueprintObj.id && (
              <mesh position={[0, 1.1, 0.1]} material={mats.accent}>
                <boxGeometry args={[2.0, 0.22, 0.02]} />
              </mesh>
            )}
          </group>
        ) : (
          /* Live System Telemetry & Workspace Profiler Display (Replaces dead grey box!) */
          <group
            position={[-width * 0.24, floorH * 0.16, 0.1]}
            onPointerOver={(e) => { e.stopPropagation(); handlePointerOver(telemetryObj.id); }}
            onPointerOut={handlePointerOut}
            onClick={(e) => { e.stopPropagation(); setActiveObjectInspection(telemetryObj); }}
          >
            <mesh material={materials.interiorFrame}>
              <boxGeometry args={[2.2, 1.15, 0.06]} />
            </mesh>
            <mesh position={[0, 0, 0.035]} material={materials.telemetryDisplay}>
              <planeGeometry args={[2.12, 1.07]} />
            </mesh>
            {hoveredObjectId === telemetryObj.id && (
              <mesh position={[0, 0.72, 0.08]} material={materials.ledGreen}>
                <boxGeometry args={[1.8, 0.18, 0.02]} />
              </mesh>
            )}
          </group>
        )}
      </group>

      {/* ── Side Walls: Adaptive Architectural Cutaways for Free 360° Inspection ── */}
      {([-1, 1] as const).map((side) => (
        <group key={`side-wall-${side}`} position={[side * (width / 2 - 0.08), 0.16, 0]}>
          {isWalkIn ? (
            /* Inside room in FPS mode: Full wall enclosure */
            <mesh position={[0, floorH / 2, 0]} material={materials.plaster}>
              <boxGeometry args={[0.16, floorH, depth - 0.16]} />
            </mesh>
          ) : (
            /* Dollhouse overview mode: Architectural half-wall with transparent glass for 360° visibility */
            <group>
              <mesh position={[0, 0.38, 0]} material={materials.plaster} castShadow>
                <boxGeometry args={[0.16, 0.76, depth - 0.16]} />
              </mesh>
              <mesh position={[0, 0.78, 0]} material={mats.trim}>
                <boxGeometry args={[0.20, 0.04, depth - 0.12]} />
              </mesh>
              <mesh position={[0, 0.78 + (floorH - 0.78) / 2, 0]} material={materials.cutawayGlass}>
                <boxGeometry args={[0.02, floorH - 0.78, depth - 0.2]} />
              </mesh>
            </group>
          )}
        </group>
      ))}

      {/* ── ZONE 1: Interactive Development Workstation (Displaying Real Project Code) ── */}
      {workstationObj && (
        <group
          position={[deskX1, 0.16, deskZ]}
          onPointerOver={(e) => { e.stopPropagation(); handlePointerOver(workstationObj.id); }}
          onPointerOut={handlePointerOut}
          onClick={(e) => { e.stopPropagation(); setActiveObjectInspection(workstationObj); }}
        >
          {/* Workstation Floor Rug */}
          <mesh position={[0, 0.005, 0]} receiveShadow material={materials.rugWork}>
            <boxGeometry args={[width * 0.44, 0.01, depth * 0.48]} />
          </mesh>

          {/* Solid Walnut Desk Top */}
          <mesh position={[0, 0.36, 0]} material={materials.deskTop} castShadow receiveShadow>
            <boxGeometry args={[Math.min(3.4, width * 0.4), 0.05, 1.1]} />
          </mesh>
          {/* Trestle Steel Legs */}
          {[-1.25, 1.25].map((lx) => (
            <mesh key={`desk-leg-${lx}`} position={[lx, 0.18, 0]} material={materials.deskLegs}>
              <boxGeometry args={[0.06, 0.36, 0.9]} />
            </mesh>
          ))}

          {/* Dual Curved Ultrawide Monitors with REAL project code */}
          {[-0.62, 0.62].map((mx, mi) => (
            <group key={`monitor-${mi}`} position={[mx, 0.4, -0.2]}>
              <mesh position={[0, 0.16, -0.12]} material={materials.deskLegs}>
                <cylinderGeometry args={[0.018, 0.024, 0.32, 12]} />
              </mesh>
              <mesh position={[0, 0.34, 0]} material={materials.screenBezel} castShadow>
                <boxGeometry args={[0.94, 0.52, 0.028]} />
              </mesh>
              {/* Displaying Real Code Texture */}
              <mesh position={[0, 0.34, 0.016]} material={mi === 0 ? materials.codeDisplay1 : materials.codeDisplay2}>
                <planeGeometry args={[0.9, 0.48]} />
              </mesh>
            </group>
          ))}

          {/* Ergonomic Office Chairs */}
          {[-0.62, 0.62].map((cx, ci) => (
            <group key={`chair-${ci}`} position={[cx, 0, 0.42]}>
              <mesh position={[0, 0.04, 0]} material={materials.chairMetal}>
                <cylinderGeometry args={[0.22, 0.22, 0.02, 10]} />
              </mesh>
              <mesh position={[0, 0.15, 0]} material={materials.chairMetal}>
                <cylinderGeometry args={[0.025, 0.025, 0.2, 10]} />
              </mesh>
              <mesh position={[0, 0.26, 0]} material={materials.chairMesh}>
                <boxGeometry args={[0.44, 0.06, 0.42]} />
              </mesh>
              <mesh position={[0, 0.54, 0.18]} rotation={[-0.12, 0, 0]} material={materials.chairMesh}>
                <boxGeometry args={[0.42, 0.5, 0.04]} />
              </mesh>
            </group>
          ))}

          {/* Keyboards & Precision Mouse Pads */}
          {[-0.62, 0.62].map((kx, ki) => (
            <group key={`kb-${ki}`} position={[kx, 0.39, 0.15]}>
              <mesh material={materials.screenBezel}>
                <boxGeometry args={[0.38, 0.015, 0.13]} />
              </mesh>
            </group>
          ))}

          {/* Live bots stationed at workstations */}
          <group position={[0, 0.3, 0.42]}>
            <AgentBots bots={devAgents} small />
          </group>

          {/* Interactive Object Hover Cue */}
          {hoveredObjectId === workstationObj.id && (
            <mesh position={[0, 1.15, 0]} material={mats.accent}>
              <boxGeometry args={[2.2, 0.2, 0.02]} />
            </mesh>
          )}
        </group>
      )}

      {/* ── ZONE 2: 42U Server Pod (Placed neatly in rear-right nook) ── */}
      {serverObj && (
        <group
          position={[width * 0.35, 0.18, -depth * 0.30]}
          rotation={[0, -0.25, 0]}
          onPointerOver={(e) => { e.stopPropagation(); handlePointerOver(serverObj.id); }}
          onPointerOut={handlePointerOut}
          onClick={(e) => { e.stopPropagation(); setActiveObjectInspection(serverObj); }}
        >
          {/* Raised Data Center Tile */}
          <mesh position={[0, -0.01, 0]} receiveShadow material={materials.tileServer}>
            <boxGeometry args={[1.2, 0.02, 1.2]} />
          </mesh>

          {/* 42U Server Rack Cabinet */}
          <mesh position={[0, 0.78, 0]} material={materials.serverChassis} castShadow receiveShadow>
            <boxGeometry args={[0.92, 1.56, 0.88]} />
          </mesh>
          {/* Glass Tinted Door */}
          <mesh position={[0, 0.78, 0.45]} material={materials.interiorGlass}>
            <planeGeometry args={[0.84, 1.48]} />
          </mesh>
          {/* Server Blades with Drive Bays */}
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

          {/* Interactive Hover Cue */}
          {hoveredObjectId === serverObj.id && (
            <mesh position={[0, 1.75, 0]} material={materials.ledGreen}>
              <boxGeometry args={[1.6, 0.18, 0.02]} />
            </mesh>
          )}
        </group>
      )}

      {/* ── ZONE 3: Live UI Preview Billboard (Prominently forward, 0 collision with server pod) ── */}
      {previewObj && (
        <group
          position={[width * 0.24, 0.16, depth * 0.02]}
          rotation={[0, -0.42, 0]}
          onPointerOver={(e) => { e.stopPropagation(); handlePointerOver(previewObj.id); }}
          onPointerOut={handlePointerOut}
          onClick={(e) => { e.stopPropagation(); setActiveObjectInspection(previewObj); }}
        >
          {/* Stand Pole */}
          <mesh position={[0, 0.6, 0]} material={materials.interiorFrame}>
            <cylinderGeometry args={[0.04, 0.05, 1.2, 12]} />
          </mesh>
          {/* Frame */}
          <mesh position={[0, 1.25, 0]} material={materials.screenBezel} castShadow>
            <boxGeometry args={[2.2, 1.2, 0.06]} />
          </mesh>
          {/* Display */}
          <mesh position={[0, 1.25, 0.035]} material={materials.previewDisplay}>
            <planeGeometry args={[2.1, 1.1]} />
          </mesh>
          {/* Interactive Hover Tag */}
          {hoveredObjectId === previewObj.id && (
            <mesh position={[0, 1.95, 0]} material={mats.accent}>
              <boxGeometry args={[1.8, 0.18, 0.02]} />
            </mesh>
          )}
        </group>
      )}

      {/* ── ZONE 4: Breakout Strategy & Agent Collaboration Hub (Warm Luxury Lounge) ── */}
      <group
        position={[width * 0.26, 0.16, depth * 0.24]}
        onPointerOver={(e) => { e.stopPropagation(); handlePointerOver(loungeObj.id); }}
        onPointerOut={handlePointerOut}
        onClick={(e) => { e.stopPropagation(); setActiveObjectInspection(loungeObj); }}
      >
        {/* Soft Lounge Rug */}
        <mesh position={[0, 0.005, 0]} receiveShadow material={materials.rugLounge}>
          <boxGeometry args={[width * 0.38, 0.01, depth * 0.40]} />
        </mesh>

        {/* Solid Walnut Plinth Base */}
        <mesh position={[-0.15, 0.05, 0]} material={materials.loungeWood} castShadow>
          <boxGeometry args={[1.72, 0.08, 0.82]} />
        </mesh>

        {/* Warm Cognac Leather Sectional Sofa */}
        <group position={[-0.15, 0, 0]}>
          {/* Main Seat Cushion */}
          <mesh position={[0, 0.18, 0]} material={materials.loungeLeather} castShadow>
            <boxGeometry args={[1.68, 0.18, 0.78]} />
          </mesh>
          {/* Chaise Return */}
          <mesh position={[0.52, 0.18, 0.44]} material={materials.loungeLeather} castShadow>
            <boxGeometry args={[0.68, 0.18, 0.74]} />
          </mesh>
          {/* Backrest Cushion */}
          <mesh position={[0, 0.40, -0.32]} material={materials.loungeLeather}>
            <boxGeometry args={[1.68, 0.32, 0.18]} />
          </mesh>
          {/* Decorative Pillow */}
          <mesh position={[-0.55, 0.32, -0.18]} rotation={[0, 0.2, 0]} material={materials.screenBezel}>
            <boxGeometry args={[0.32, 0.28, 0.10]} />
          </mesh>
        </group>

        {/* Honed Carrara Marble Coffee Table with Fluted Brass Legs */}
        <group position={[-0.15, 0, 0.46]}>
          <mesh position={[0, 0.22, 0]} material={materials.marble} castShadow>
            <cylinderGeometry args={[0.36, 0.36, 0.035, 32]} />
          </mesh>
          {/* Brass Hairpin Legs */}
          {[-0.2, 0.2].map((lx) => (
            <mesh key={`leg-${lx}`} position={[lx, 0.11, 0]} material={materials.brass}>
              <cylinderGeometry args={[0.012, 0.008, 0.22, 12]} />
            </mesh>
          ))}
          {/* Interactive Tablet on Coffee Table */}
          <mesh position={[0, 0.245, 0]} material={materials.telemetryDisplay}>
            <boxGeometry args={[0.20, 0.008, 0.14]} />
          </mesh>
          {/* Espresso Cup */}
          <mesh position={[0.12, 0.25, 0.06]} material={materials.plantPot}>
            <cylinderGeometry args={[0.026, 0.020, 0.042, 12]} />
          </mesh>
        </group>

        {/* Architectural Ficus Botanical Plant */}
        <group position={[width * 0.15, 0, -depth * 0.14]}>
          <mesh position={[0, 0.20, 0]} material={materials.plantPot} castShadow>
            <cylinderGeometry args={[0.18, 0.13, 0.38, 20]} />
          </mesh>
          {/* Lush Greenery Canopy */}
          <mesh position={[0, 0.48, 0]} material={materials.plantLeaf} castShadow>
            <sphereGeometry args={[0.26, 12, 12]} />
          </mesh>
          <mesh position={[0.06, 0.65, 0.04]} material={materials.plantLeaf}>
            <sphereGeometry args={[0.18, 10, 10]} />
          </mesh>
        </group>

        {/* Warm Ambient Lounge Point Light */}
        <pointLight position={[-0.15, 1.2, 0.4]} color="#fef3c7" intensity={1.4} distance={3.8} />

        {/* Live Bots seated in lounge */}
        <group position={[-0.15, 0.26, 0]}>
          <AgentBots bots={loungeAgents} small />
        </group>

        {/* Interactive Hover Cue for Lounge */}
        {hoveredObjectId === loungeObj.id && (
          <mesh position={[-0.15, 1.1, 0.2]} material={materials.ledAmber}>
            <boxGeometry args={[2.2, 0.2, 0.02]} />
          </mesh>
        )}
      </group>

      {/* ── ZONE 5: Elevator Core ── */}
      <group position={[0, 0.16, -depth / 2 + 0.2]}>
        <mesh position={[0, 0.78, 0]} material={materials.interiorFrame} castShadow>
          <boxGeometry args={[1.36, 1.56, 0.1]} />
        </mesh>
        <mesh position={[-0.28, 0.76, 0.02]} material={materials.elevatorDoor}>
          <boxGeometry args={[0.5, 1.44, 0.02]} />
        </mesh>
        <mesh position={[0.28, 0.76, 0.02]} material={materials.elevatorDoor}>
          <boxGeometry args={[0.5, 1.44, 0.02]} />
        </mesh>
        {/* Floor Indicator Badge */}
        <mesh position={[0, 1.42, 0.06]} material={materials.codeDisplay2}>
          <planeGeometry args={[0.34, 0.1]} />
        </mesh>
      </group>
    </group>
  );
}
