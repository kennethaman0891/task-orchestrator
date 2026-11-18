// Developer City — InteriorFloor: Realistic, dynamic, live-updating 3D office interior
// tailored to the REAL project folder, live terminals, and active AI agents.
// Features camera-aware 360° cutaway walls, live-ticking telemetry & preview screens,
// dual-monitor code/terminal workstations, 42U server pods, and a zero-clipping strategy lounge.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { AgentBot, FloorSpec, Project, FloorPlanFloor, FloorPlanObject, TerminalCar } from '@/city/types';
import { AgentBots } from './Bots';
import { themeById } from '@/city/themes';
import { useBuildingMaterials } from './archetypes';
import { useProjectFloorPlan, generateFallbackFloorPlan } from '@/city/utils/projectScanner';
import { useCityStore } from '@/city/store';
import { plotWorldPosition } from './CityGrid';

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
    return floor.objects.map((o) => o.title);
  }
  return ['Workstations', 'Live Preview', 'Infrastructure', 'Lounge'];
}

/** High-DPI architectural flooring texture tailored to floorStyle */
function makeFloorTexture(
  style: 'oak' | 'tile' | 'steel' | 'obsidian' | 'slate' | 'walnut',
  accent: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  if (style === 'tile') {
    // Data Center Raised Antistatic Slate Tile
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 1024; x += 128) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1024); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(1024, x); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
    for (let x = 128; x < 1024; x += 256) {
      for (let y = 128; y < 1024; y += 256) {
        ctx.fillRect(x + 8, y + 8, 112, 112);
      }
    }
  } else if (style === 'steel') {
    // Brushed Architectural Gunmetal Steel Panels
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 1024; i += 128) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1024); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1024, i); ctx.stroke();
    }
  } else if (style === 'obsidian') {
    // Cyber Matte Obsidian with Subtle Neon Micro-Grid
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = accent || '#a855f7';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.24;
    for (let x = 0; x <= 1024; x += 128) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1024); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(1024, x); ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
  } else if (style === 'slate') {
    // Honed Architectural Slate Tiles
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#172033';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 0) {
          ctx.fillRect(c * 128 + 2, r * 128 + 2, 124, 124);
        }
      }
    }
  } else {
    // Warm Architectural Hardwood Plank Flooring (Oak or American Walnut)
    const tones =
      style === 'walnut'
        ? ['#4a3222', '#543927', '#3f2a1d', '#5c3f2b']
        : ['#9c7a54', '#a8855e', '#8f6e49', '#b08d66'];
    ctx.fillStyle = tones[0];
    ctx.fillRect(0, 0, 1024, 1024);

    const rows = 16;
    const plankH = 1024 / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * plankH;
      const offset = ((r * 211) % 340) + 80;
      const splits = [0, offset, offset + 380, 1024];
      for (let s = 0; s < splits.length - 1; s++) {
        const x0 = splits[s];
        const w = splits[s + 1] - x0;
        ctx.fillStyle = tones[(r + s) % tones.length];
        ctx.fillRect(x0 + 1, y + 1, w - 2, plankH - 2);

        // Subtle wood grain lines
        ctx.strokeStyle = 'rgba(30, 18, 8, 0.14)';
        ctx.lineWidth = 1;
        for (let g = 12; g < plankH - 8; g += 16) {
          ctx.beginPath();
          ctx.moveTo(x0 + 6, y + g);
          ctx.lineTo(x0 + w - 6, y + g + ((r % 2 === 0 ? 1 : -1) * 2));
          ctx.stroke();
        }

        // Plank bevel joint
        ctx.strokeStyle = 'rgba(24, 14, 6, 0.42)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 0.75, y + 0.75, w - 1.5, plankH - 1.5);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.needsUpdate = true;
  return tex;
}

/** Draws live syntax-colored code or live terminal feed onto a workstation monitor canvas */
function drawWorkstationMonitor(
  canvas: HTMLCanvasElement,
  opts: {
    accentColor: string;
    fileName: string;
    codeLines: string[];
    liveCar?: TerminalCar | null;
    liveAgent?: AgentBot | null;
    tick: number;
    monitorIndex: number;
  },
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  // Deep IDE background
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, W, H);

  // Top IDE Tab Bar
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, W, 38);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 38);
  ctx.lineTo(W, 38);
  ctx.stroke();

  // macOS traffic lights
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(20, 19, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(36, 19, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.arc(52, 19, 5, 0, Math.PI * 2); ctx.fill();

  // Active tab pill
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(74, 6, 260, 32);
  ctx.fillStyle = opts.accentColor || '#38bdf8';
  ctx.fillRect(74, 6, 260, 2.5);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  const shortFile = opts.fileName.split('/').pop() || 'App.tsx';
  ctx.fillText(shortFile, 90, 27);

  // Live indicator badge on right of tab bar
  const isLive = Boolean(opts.liveCar || opts.liveAgent);
  ctx.fillStyle = isLive ? 'rgba(16, 185, 129, 0.18)' : 'rgba(56, 189, 248, 0.15)';
  ctx.fillRect(W - 175, 8, 160, 22);
  ctx.fillStyle = isLive ? '#34d399' : '#38bdf8';
  ctx.beginPath();
  ctx.arc(W - 160, 19, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.fillText(isLive ? 'LIVE PTY CONNECTED' : 'VITE HMR ACTIVE', W - 148, 23);

  // Code lines area
  const lines =
    opts.codeLines && opts.codeLines.length > 0
      ? opts.codeLines
      : [
          '// Live Workspace Source Module',
          'export function WorkspaceModule() {',
          '  const state = useCityStore();',
          '  return <InteractiveViewport state={state} />;',
          '}',
        ];

  ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
  const maxLines = Math.min(9, lines.length);
  const activeCursorLine = opts.tick % Math.max(1, maxLines);

  for (let l = 0; l < maxLines; l++) {
    const y = 68 + l * 24;
    if (l === activeCursorLine) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.fillRect(0, y - 16, W, 22);
    }

    // Line number
    ctx.fillStyle = l === activeCursorLine ? '#38bdf8' : '#475569';
    ctx.fillText(String(l + 1).padStart(2, '0'), 16, y);

    const text = lines[l] || '';
    if (text.trim().startsWith('//') || text.trim().startsWith('#')) {
      ctx.fillStyle = '#64748b';
    } else if (/(import|export|from|return|async|await|def|fn|const|let|function)/.test(text)) {
      ctx.fillStyle = '#c084fc';
    } else if (text.includes('(') || text.includes('=') || text.includes('<')) {
      ctx.fillStyle = '#38bdf8';
    } else {
      ctx.fillStyle = '#e2e8f0';
    }
    const clipped = text.slice(0, 56);
    ctx.fillText(clipped, 54, y);

    // Blinking cursor on active line
    if (l === activeCursorLine && opts.tick % 2 === 0) {
      const cursorX = 54 + Math.min(clipped.length, 48) * 8.4;
      ctx.fillStyle = opts.accentColor || '#38bdf8';
      ctx.fillRect(cursorX, y - 13, 8, 16);
    }
  }

  // Bottom Live Terminal Dock inside the monitor
  const termY = H - 72;
  ctx.fillStyle = '#050811';
  ctx.fillRect(0, termY, W, 72);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.beginPath();
  ctx.moveTo(0, termY);
  ctx.lineTo(W, termY);
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 11px ui-monospace, monospace';
  const termHeader = opts.liveCar
    ? `TERMINAL · ${opts.liveCar.name.toUpperCase()} (${opts.liveCar.cli || 'zsh'})`
    : `TERMINAL · ${opts.fileName}`;
  ctx.fillText(termHeader.slice(0, 62), 16, termY + 20);

  ctx.fillStyle = '#22c55e';
  ctx.font = '12px ui-monospace, monospace';
  const taskLine =
    opts.liveCar?.currentTask?.description ||
    opts.liveAgent?.currentTask ||
    `$ watching ${shortFile} · 0 errors · synced`;
  ctx.fillText(`❯ ${taskLine.slice(0, 60)}`, 16, termY + 42);

  ctx.fillStyle = '#64748b';
  ctx.font = '11px ui-monospace, monospace';
  const timeStr = new Date().toLocaleTimeString();
  ctx.fillText(`UTF-8 · TypeScript React ·Synced ${timeStr}`, 16, termY + 62);
}

/** Draws the Back-Wall Live Command & Telemetry Center onto a 1024x512 canvas */
function drawLiveTelemetryWall(
  canvas: HTMLCanvasElement,
  opts: {
    projectName: string;
    branch: string;
    floorTitle: string;
    folder: string;
    accentColor: string;
    fps: number;
    waveHistory: number[];
    agentCount: number;
    terminalCount: number;
    fileCount: number;
    isBlueprint: boolean;
    docs: string[];
  },
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  // Deep command center background
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, W, H);

  // Subtle architectural grid
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Top Header Bar
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, 58);
  ctx.strokeStyle = opts.accentColor || '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 58);
  ctx.lineTo(W, 58);
  ctx.stroke();

  // Pulsing live dot
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.arc(28, 29, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px ui-monospace, SFMono-Regular, Menlo, monospace';
  const titleText = opts.isBlueprint
    ? `ARCHITECTURE BLUEPRINT · ${opts.projectName.toUpperCase()}`
    : `LIVE COMMAND TELEMETRY · ${opts.projectName.toUpperCase()}`;
  ctx.fillText(titleText.slice(0, 46), 48, 36);

  // Live Clock & Branch Pill on Right
  const nowStr = new Date().toLocaleTimeString();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.fillRect(W - 250, 12, 230, 34);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(W - 250, 12, 230, 34);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillText(`● LIVE ${nowStr} · ${opts.branch}`, W - 236, 34);

  // Left Panel: Real-Time Waveform & Floor Activity
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(24, 80, 520, 290);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(24, 80, 520, 290);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.fillText(`ACTIVE FLOOR: ${opts.floorTitle.toUpperCase()} (/${opts.folder})`, 44, 110);

  // Animated Live Waveform
  const wave = opts.waveHistory.length > 1 ? opts.waveHistory : [42, 58, 49, 72, 64, 81, 55, 76, 68, 84];
  const graphX = 44;
  const graphY = 135;
  const graphW = 480;
  const graphH = 165;

  ctx.strokeStyle = opts.accentColor || '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const stepX = graphW / Math.max(1, wave.length - 1);
  for (let i = 0; i < wave.length; i++) {
    const wx = graphX + i * stepX;
    const wy = graphY + graphH - (wave[i] / 100) * graphH;
    if (i === 0) ctx.moveTo(wx, wy);
    else ctx.lineTo(wx, wy);
  }
  ctx.stroke();

  // Gradient fill under waveform
  ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.lineTo(graphX + graphW, graphY + graphH);
  ctx.lineTo(graphX, graphY + graphH);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#64748b';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(
    opts.isBlueprint
      ? `SPECS: ${opts.docs.slice(0, 3).join(' · ') || 'ARCHITECTURE.md · README.md'}`
      : 'REAL-TIME ENGINE FRAME PROFILER & PTY STREAM throughput',
    44,
    342,
  );

  // Right Panel: 4 Live Metric Cards
  const cards = [
    { label: 'VIEWPORT FPS', val: `${opts.fps} FPS`, sub: 'WebGL2 Hardware', col: '#10b981' },
    { label: 'ACTIVE AGENTS', val: `${opts.agentCount}`, sub: 'Autonomous Bots', col: '#38bdf8' },
    { label: 'LIVE TERMINALS', val: `${opts.terminalCount}`, sub: 'PTY Sessions', col: '#a855f7' },
    { label: 'GIT BRANCH', val: opts.branch.slice(0, 10), sub: 'Working Tree Clean', col: '#22c55e' },
  ];

  cards.forEach((c, idx) => {
    const cx = 568 + (idx % 2) * 220;
    const cy = 80 + Math.floor(idx / 2) * 150;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(cx, cy, 208, 138);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.strokeRect(cx, cy, 208, 138);

    ctx.fillStyle = c.col;
    ctx.fillRect(cx, cy, 208, 4);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillText(c.label, cx + 16, cy + 32);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 30px ui-monospace, monospace';
    ctx.fillText(c.val, cx + 16, cy + 82);

    ctx.fillStyle = c.col;
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(`● ${c.sub}`, cx + 16, cy + 116);
  });

  // Bottom Status Footer
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(24, 392, W - 48, 92);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
  ctx.strokeRect(24, 392, W - 48, 92);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 15px ui-monospace, monospace';
  ctx.fillText(
    `WORKSPACE SYNC: ACTIVE  ·  FOLDER: /${opts.folder}  ·  CLICK SCREEN TO INSPECT DETAILS`,
    44,
    432,
  );
  ctx.fillStyle = '#38bdf8';
  ctx.font = '13px ui-monospace, monospace';
  ctx.fillText(
    `360° Hands-On Camera Control Active · Drag anywhere to orbit or use the 360° angle slider below`,
    44,
    462,
  );
}

/** Draws the Right-Side Live Application & Terminal Preview Display onto a 1024x560 canvas */
function drawLivePreviewBillboard(
  canvas: HTMLCanvasElement,
  opts: {
    projectName: string;
    projectPath: string;
    techStack: string[];
    floorName: string;
    folder: string;
    accentColor: string;
    cars: TerminalCar[];
    agents: AgentBot[];
    objects: FloorPlanObject[];
    fps: number;
  },
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  // Browser / Application Window Frame
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, W, H);

  // Top Browser Bar
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, W, 54);

  // Traffic dots
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(24, 27, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(44, 27, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.arc(64, 27, 6, 0, Math.PI * 2); ctx.fill();

  // URL Address Pill
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(92, 10, 620, 34);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.strokeRect(92, 10, 620, 34);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillText(`tto://live-preview/${opts.projectName}/${opts.folder}`, 110, 32);

  // Live FPS Badge
  ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
  ctx.fillRect(W - 280, 10, 256, 34);
  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillText(`● LIVE VIEWPORT · ${opts.fps} FPS`, W - 262, 32);

  // Left Column: Project & Floor Architecture Summary
  ctx.fillStyle = '#111827';
  ctx.fillRect(24, 76, 460, 396);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(24, 76, 460, 396);

  ctx.fillStyle = opts.accentColor || '#38bdf8';
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.fillText('ACTIVE PROJECT WORKSPACE', 44, 108);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
  ctx.fillText(opts.projectName.slice(0, 22), 44, 146);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(opts.floorName, 44, 174);

  // Tech Stack Chips
  const stack = opts.techStack.length > 0 ? opts.techStack.slice(0, 5) : ['React', 'TypeScript', 'Three.js', 'Rust'];
  let chipX = 44;
  stack.forEach((tech) => {
    const tw = tech.length * 9.5 + 20;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.fillRect(chipX, 194, tw, 28);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.strokeRect(chipX, 194, tw, 28);
    ctx.fillStyle = '#bae6fd';
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.fillText(tech, chipX + 10, 213);
    chipX += tw + 8;
  });

  // Floor Active Modules List
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.fillText('FLOOR MODULES & MAPPED FILES:', 44, 254);

  opts.objects.slice(0, 4).forEach((obj, idx) => {
    const ry = 270 + idx * 46;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.75)';
    ctx.fillRect(44, ry, 420, 38);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(44, ry, 4, 38);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(obj.title.slice(0, 32), 58, ry + 24);
    ctx.fillStyle = '#34d399';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('● READY', 392, ry + 24);
  });

  // Right Column: Live Terminals & Agent Activity Feed
  ctx.fillStyle = '#111827';
  ctx.fillRect(504, 76, 496, 396);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(504, 76, 496, 396);

  ctx.fillStyle = '#a855f7';
  ctx.font = 'bold 13px ui-monospace, monospace';
  ctx.fillText(
    `LIVE TERMINALS (${opts.cars.length}) & ACTIVE AGENTS (${opts.agents.length})`,
    524,
    108,
  );

  if (opts.cars.length > 0) {
    opts.cars.slice(0, 5).forEach((car, idx) => {
      const cy = 128 + idx * 64;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.fillRect(524, cy, 456, 54);
      ctx.strokeStyle = car.moving ? '#f59e0b' : 'rgba(255,255,255,0.08)';
      ctx.strokeRect(524, cy, 456, 54);

      ctx.fillStyle = car.color || '#38bdf8';
      ctx.fillRect(524, cy, 5, 54);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 14px ui-monospace, monospace';
      ctx.fillText(`${car.name} · ${car.cli || 'shell'}`, 540, cy + 22);

      ctx.fillStyle = car.moving ? '#fbbf24' : '#34d399';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillText(car.moving ? '● WORKING' : '● ONLINE', 890, cy + 22);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px ui-monospace, monospace';
      const taskDesc = car.currentTask?.description || car.cwd || opts.projectPath;
      ctx.fillText(taskDesc.slice(0, 50), 540, cy + 42);
    });
  } else {
    // Show real files & ready status when no PTY is currently open
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(524, 130, 456, 140);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.strokeRect(524, 130, 456, 140);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText('Workspace Connected & Ready', 544, 166);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(`Path: ${opts.projectPath.slice(-44)}`, 544, 196);
    ctx.fillText(`Active Floor Folder: /${opts.folder}`, 544, 222);
    ctx.fillStyle = '#34d399';
    ctx.fillText('● Click this screen to inspect or launch terminal', 544, 250);
  }

  // Bottom Interactive Action Bar
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(24, 488, W - 48, 52);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillText('⚡ CLICK DISPLAY TO OPEN LIVE INSPECTOR OR FOCUS WORKSPACE TERMINAL', 44, 520);
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
  const fallbackPlan = useMemo(() => generateFallbackFloorPlan(project), [project]);
  const activePlanFloor: FloorPlanFloor =
    floorPlan?.floors?.[floorIndex] ||
    fallbackPlan.floors[floorIndex] ||
    floorPlan?.floors?.[0] ||
    fallbackPlan.floors[0];

  const setActiveObjectInspection = useCityStore((s) => s.setActiveObjectInspection);
  const allAgents = useCityStore((s) => s.agents);
  const terminalCars = useCityStore((s) => s.terminalCars);
  const interiorViewMode = useCityStore((s) => s.interiorViewMode);
  const isWalkIn = interiorViewMode === 'walk-in';

  // Live project terminals and agents from store
  const liveProjectCars = useMemo(() => {
    return Object.values(terminalCars).filter(
      (c) =>
        c.projectId === project.id ||
        (project.path && c.projectPath === project.path),
    );
  }, [terminalCars, project.id, project.path]);

  const liveProjectAgents = useMemo(() => {
    if (agents.length > 0) return agents;
    const fromStore = Object.values(allAgents).filter(
      (a) =>
        a.status !== 'offline' &&
        project.path &&
        (a.projectPath === project.path ||
          a.projectPath.startsWith(project.path + '/') ||
          project.path.startsWith(a.projectPath)),
    );
    if (fromStore.length > 0) return fromStore;
    // Synthesize live bots from running terminal cars if no explicit agent CLI was matched
    return liveProjectCars.map((car, idx): AgentBot => ({
      id: `car-bot-${car.id}`,
      name: car.agentName || car.name || `Term ${idx + 1}`,
      model: car.modelName || car.cli || 'shell',
      sessionId: car.terminalId,
      terminalId: car.terminalId,
      projectPath: project.path,
      status: car.moving ? 'working' : 'idle',
      currentTask: car.currentTask?.description || 'Active terminal session',
      room: null,
      progress: car.moving ? 0.6 : 0,
      tools: [car.cli || 'zsh'],
      recentActions: [],
    }));
  }, [agents, allAgents, liveProjectCars, project.path]);

  const b = project.building;
  const theme = themeById(b.theme);
  const facade = b.primaryColor || theme.facade;
  const accent = activePlanFloor.accentColor || b.accentColor || theme.accent;
  const mats = useBuildingMaterials(facade, theme.facadeDark, theme.glass, accent);

  // Resolve objects for all 4 zones so EVERY floor has complete, working 3D stations
  const workstationObj: FloorPlanObject = useMemo(() => {
    const found = activePlanFloor.objects?.find(
      (o) => o.type === 'workstation' || o.type === 'agent_console' || o.type === 'pipeline_station',
    );
    if (found) return { ...found, type: 'workstation' };
    return {
      id: `floor_${floorIndex}_workstation`,
      type: 'workstation',
      title: `${activePlanFloor.name} Workstation`,
      position: [-width * 0.23, 0.16, depth * 0.08],
      file: `${activePlanFloor.folder || 'src'}/index.ts`,
      file2: `${activePlanFloor.folder || 'src'}/module.ts`,
      codeLines1: [
        `// ${project.name} — ${activePlanFloor.name}`,
        `export const floorRole = "${activePlanFloor.role}";`,
        `export function initFloor() { return true; }`,
      ],
      status: 'Live Sync Active · 0 Errors',
    };
  }, [activePlanFloor, floorIndex, width, depth, project.name]);

  const serverObj: FloorPlanObject = useMemo(() => {
    const found = activePlanFloor.objects?.find(
      (o) => o.type === 'server_pod' || o.type === 'database_pod' || o.type === 'component_gallery',
    );
    if (found) return { ...found, type: 'server_pod' };
    return {
      id: `floor_${floorIndex}_server_pod`,
      type: 'server_pod',
      title: '42U Infrastructure & Service Cluster',
      position: [width * 0.34, 0.18, -depth * 0.30],
      endpoints: ['/api/projects', '/api/terminals', '/api/files', '/ws'],
      details: `Dedicated service rack for ${activePlanFloor.name} (/${activePlanFloor.folder})`,
      status: 'Online · Port 8765 Healthy',
    };
  }, [activePlanFloor, floorIndex, width, depth]);

  const blueprintObj = useMemo(
    () => activePlanFloor.objects?.find((o) => o.type === 'blueprint_board') || null,
    [activePlanFloor],
  );

  const previewObj: FloorPlanObject = useMemo(() => {
    const found = activePlanFloor.objects?.find((o) => o.type === 'preview_billboard');
    if (found) return found;
    return {
      id: `floor_${floorIndex}_preview`,
      type: 'preview_billboard',
      title: `Live ${activePlanFloor.name} Viewport`,
      position: [width * 0.27, 0.16, -depth * 0.02],
      details: `Live workspace monitor for ${project.name} · ${activePlanFloor.role}`,
      status: `${liveProjectCars.length} Terminals · 60 FPS`,
    };
  }, [activePlanFloor, floorIndex, width, depth, project.name, liveProjectCars.length]);

  const loungeObj: FloorPlanObject = useMemo(() => {
    const found = activePlanFloor.objects?.find((o) => o.type === 'lounge');
    if (found) return found;
    return {
      id: `floor_${floorIndex}_strategy_hub`,
      type: 'lounge',
      title: 'Executive Strategy & Agent Standup Lounge',
      position: [width * 0.24, 0.16, depth * 0.25],
      status: `${liveProjectAgents.length} Agents Synced · Ready`,
      details: 'Autonomous Agent Standup, Sprint Retrospectives & Architecture Decisions',
    };
  }, [activePlanFloor, floorIndex, width, depth, liveProjectAgents.length]);

  const telemetryObj: FloorPlanObject = useMemo(
    () =>
      blueprintObj || {
        id: `floor_${floorIndex}_command_telemetry`,
        type: 'preview_billboard',
        title: `Live Command Telemetry · ${project.name}`,
        position: [0.15, floorH * 0.50, -depth / 2 + 0.12],
        status: `${liveProjectCars.length} Live Terminals · ${liveProjectAgents.length} Agents`,
        details: `Real-time profiler for ${project.path} (Branch: ${floorPlan?.project.gitBranch || 'main'})`,
      },
    [blueprintObj, floorIndex, project.name, project.path, floorH, depth, liveProjectCars.length, liveProjectAgents.length, floorPlan],
  );

  // Live Canvas Refs for real-time redrawing
  const codeCanvas1Ref = useRef<HTMLCanvasElement | null>(null);
  const codeCanvas2Ref = useRef<HTMLCanvasElement | null>(null);
  const telemetryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Refs for camera-aware smart wall cutaways
  const backWallGroupRef = useRef<THREE.Group>(null);
  const leftWallFullRef = useRef<THREE.Group>(null);
  const rightWallFullRef = useRef<THREE.Group>(null);

  // Blinking server LEDs
  const ledRef1 = useRef<THREE.Mesh>(null);
  const ledRef2 = useRef<THREE.Mesh>(null);
  const ledRef3 = useRef<THREE.Mesh>(null);

  // Live FPS & waveform tracking
  const frameCountRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const measuredFpsRef = useRef(60);
  const tickRef = useRef(0);
  const waveHistoryRef = useRef<number[]>([44, 58, 52, 68, 61, 79, 64, 72, 59, 82, 67, 74, 62, 85, 71, 66]);

  const materials = useMemo(() => {
    const floorMap = makeFloorTexture(activePlanFloor.floorStyle || 'oak', accent);

    const c1 = document.createElement('canvas');
    c1.width = 1024;
    c1.height = 512;
    codeCanvas1Ref.current = c1;

    const c2 = document.createElement('canvas');
    c2.width = 1024;
    c2.height = 512;
    codeCanvas2Ref.current = c2;

    const cTel = document.createElement('canvas');
    cTel.width = 1024;
    cTel.height = 512;
    telemetryCanvasRef.current = cTel;

    const cPrev = document.createElement('canvas');
    cPrev.width = 1024;
    cPrev.height = 560;
    previewCanvasRef.current = cPrev;

    const codeMap1 = new THREE.CanvasTexture(c1);
    codeMap1.colorSpace = THREE.SRGBColorSpace;
    const codeMap2 = new THREE.CanvasTexture(c2);
    codeMap2.colorSpace = THREE.SRGBColorSpace;
    const telemetryMap = new THREE.CanvasTexture(cTel);
    telemetryMap.colorSpace = THREE.SRGBColorSpace;
    const previewMap = new THREE.CanvasTexture(cPrev);
    previewMap.colorSpace = THREE.SRGBColorSpace;

    return {
      floorMap,
      codeMap1,
      codeMap2,
      telemetryMap,
      previewMap,
      floorMesh: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: floorMap,
        roughness: activePlanFloor.floorStyle === 'obsidian' ? 0.25 : 0.55,
        metalness: activePlanFloor.floorStyle === 'steel' ? 0.6 : 0.08,
      }),
      slabBase: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.4,
        metalness: 0.3,
      }),
      coveGlow: new THREE.MeshStandardMaterial({
        color: accent,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 1.4,
      }),
      wallStudio: new THREE.MeshStandardMaterial({
        color:
          activePlanFloor.wallStyle === 'dark_concrete'
            ? '#1e293b'
            : activePlanFloor.wallStyle === 'wood_panel'
              ? '#3b2618'
              : '#1e293b',
        roughness: 0.75,
        metalness: 0.08,
      }),
      wallWainscot: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.5,
        metalness: 0.25,
      }),
      interiorFrame: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.25,
        metalness: 0.82,
      }),
      interiorGlass: new THREE.MeshStandardMaterial({
        color: '#bae6fd',
        emissive: new THREE.Color('#38bdf8'),
        emissiveIntensity: 0.12,
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0.38,
      }),
      rugWork: new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 0.9,
      }),
      rugBorder: new THREE.MeshStandardMaterial({
        color: '#334155',
        roughness: 0.7,
      }),
      rugLounge: new THREE.MeshStandardMaterial({
        color: '#273549',
        roughness: 0.88,
      }),
      tileServer: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.35,
        metalness: 0.65,
      }),
      deskTop: new THREE.MeshStandardMaterial({
        color: '#7c4d2b', // Warm American Walnut desktop for high contrast
        roughness: 0.35,
        metalness: 0.08,
      }),
      deskLegs: new THREE.MeshStandardMaterial({
        color: '#cbd5e1',
        roughness: 0.22,
        metalness: 0.88,
      }),
      screenBezel: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.25,
        metalness: 0.85,
      }),
      codeDisplay1: new THREE.MeshStandardMaterial({
        map: codeMap1,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: codeMap1,
        emissiveIntensity: 0.92,
        roughness: 0.15,
      }),
      codeDisplay2: new THREE.MeshStandardMaterial({
        map: codeMap2,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: codeMap2,
        emissiveIntensity: 0.92,
        roughness: 0.15,
      }),
      previewDisplay: new THREE.MeshStandardMaterial({
        map: previewMap,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: previewMap,
        emissiveIntensity: 0.92,
        roughness: 0.15,
      }),
      telemetryDisplay: new THREE.MeshStandardMaterial({
        map: telemetryMap,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: telemetryMap,
        emissiveIntensity: 0.95,
        roughness: 0.14,
      }),
      chairMesh: new THREE.MeshStandardMaterial({
        color: '#334155', // Distinct charcoal-slate upholstery
        roughness: 0.65,
        metalness: 0.15,
      }),
      chairMetal: new THREE.MeshStandardMaterial({
        color: '#e2e8f0',
        roughness: 0.18,
        metalness: 0.92,
      }),
      serverChassis: new THREE.MeshStandardMaterial({
        color: '#0b1120',
        roughness: 0.35,
        metalness: 0.82,
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
      loungeLeather: new THREE.MeshStandardMaterial({
        color: '#b45309', // Rich saddle cognac leather
        roughness: 0.55,
        metalness: 0.06,
      }),
      loungePillow: new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        roughness: 0.7,
      }),
      loungeWood: new THREE.MeshStandardMaterial({
        color: '#5c3a21',
        roughness: 0.35,
        metalness: 0.1,
      }),
      marble: new THREE.MeshStandardMaterial({
        color: '#f8fafc',
        roughness: 0.14,
        metalness: 0.05,
      }),
      brass: new THREE.MeshStandardMaterial({
        color: '#eab308',
        roughness: 0.25,
        metalness: 0.85,
      }),
      plantLeaf: new THREE.MeshStandardMaterial({
        color: '#15803d',
        roughness: 0.45,
      }),
      plantLeafLight: new THREE.MeshStandardMaterial({
        color: '#22c55e',
        roughness: 0.45,
      }),
      plantPot: new THREE.MeshStandardMaterial({
        color: '#f1f5f9',
        roughness: 0.25,
      }),
      elevatorDoor: new THREE.MeshStandardMaterial({
        color: '#94a3b8',
        roughness: 0.22,
        metalness: 0.88,
      }),
    };
  }, [activePlanFloor.floorStyle, activePlanFloor.wallStyle, accent]);

  // Helper to redraw all 4 live canvases
  const refreshLiveScreens = () => {
    const tick = tickRef.current;
    if (codeCanvas1Ref.current) {
      drawWorkstationMonitor(codeCanvas1Ref.current, {
        accentColor: accent,
        fileName: workstationObj.file || 'frontend/src/city/CityView.tsx',
        codeLines: workstationObj.codeLines1 || [],
        liveCar: liveProjectCars[0] || null,
        liveAgent: liveProjectAgents[0] || null,
        tick,
        monitorIndex: 0,
      });
      materials.codeMap1.needsUpdate = true;
    }
    if (codeCanvas2Ref.current) {
      drawWorkstationMonitor(codeCanvas2Ref.current, {
        accentColor: '#38bdf8',
        fileName: workstationObj.file2 || 'frontend/src/city/scene/Interior.tsx',
        codeLines: workstationObj.codeLines2 || workstationObj.codeLines1 || [],
        liveCar: liveProjectCars[1] || liveProjectCars[0] || null,
        liveAgent: liveProjectAgents[1] || liveProjectAgents[0] || null,
        tick: tick + 1,
        monitorIndex: 1,
      });
      materials.codeMap2.needsUpdate = true;
    }
    if (telemetryCanvasRef.current) {
      drawLiveTelemetryWall(telemetryCanvasRef.current, {
        projectName: project.name || 'Workspace',
        branch: floorPlan?.project.gitBranch || 'main',
        floorTitle: activePlanFloor.name,
        folder: activePlanFloor.folder || 'src',
        accentColor: accent,
        fps: measuredFpsRef.current,
        waveHistory: waveHistoryRef.current,
        agentCount: liveProjectAgents.length,
        terminalCount: liveProjectCars.length,
        fileCount: activePlanFloor.objects?.length || 4,
        isBlueprint: Boolean(blueprintObj),
        docs: blueprintObj?.docs || ['ARCHITECTURE.md', 'README.md'],
      });
      materials.telemetryMap.needsUpdate = true;
    }
    if (previewCanvasRef.current) {
      drawLivePreviewBillboard(previewCanvasRef.current, {
        projectName: project.name || 'Workspace',
        projectPath: project.path || '/workspace',
        techStack: floorPlan?.project.techStack || ['React', 'TypeScript', 'Three.js', 'Rust'],
        floorName: activePlanFloor.name,
        folder: activePlanFloor.folder || 'src',
        accentColor: accent,
        cars: liveProjectCars,
        agents: liveProjectAgents,
        objects: activePlanFloor.objects || [],
        fps: measuredFpsRef.current,
      });
      materials.previewMap.needsUpdate = true;
    }
  };

  // Initial draw & whenever floor/project/live state changes
  useEffect(() => {
    refreshLiveScreens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlanFloor, workstationObj, blueprintObj, liveProjectCars, liveProjectAgents, accent, project.name]);

  useEffect(() => {
    const bag = materials;
    return () => {
      bag.floorMap.dispose();
      bag.codeMap1.dispose();
      bag.codeMap2.dispose();
      bag.previewMap.dispose();
      bag.telemetryMap.dispose();
      bag.floorMesh.dispose();
    };
  }, [materials]);

  const worldPlotPos = useMemo(() => plotWorldPosition(project.plot), [project.plot]);

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    frameCountRef.current += 1;

    // Blinking server LEDs
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

    // Smart Camera-Aware 360° Cutaway Walls:
    // Any wall between the camera and the room center automatically drops down in dollhouse/360° mode
    // so the user has an unobstructed view from ALL 360° angles!
    const camDx = camera.position.x - worldPlotPos[0];
    const camDz = camera.position.z - worldPlotPos[2];
    if (backWallGroupRef.current) {
      backWallGroupRef.current.visible = isWalkIn || camDz > -depth * 0.25;
    }
    if (leftWallFullRef.current) {
      leftWallFullRef.current.visible = isWalkIn || camDx > -width * 0.15;
    }
    if (rightWallFullRef.current) {
      rightWallFullRef.current.visible = isWalkIn || camDx < width * 0.15;
    }

    // Every 1.0s, update live FPS, waveform, blinking cursor, and live screen canvases
    if (t - lastUpdateRef.current >= 1.0) {
      const elapsed = Math.max(0.2, t - lastUpdateRef.current);
      measuredFpsRef.current = Math.min(120, Math.max(30, Math.round(frameCountRef.current / elapsed)));
      frameCountRef.current = 0;
      lastUpdateRef.current = t;
      tickRef.current += 1;

      const baseLoad = 42 + liveProjectCars.length * 8 + liveProjectAgents.length * 6;
      const nextSample = Math.min(96, Math.max(24, Math.round(baseLoad + Math.sin(t * 1.7) * 18)));
      waveHistoryRef.current = [...waveHistoryRef.current.slice(1), nextSample];

      refreshLiveScreens();
    }
  });

  const Y = floorIndex * floorH;
  const deskX1 = -width * 0.23;
  const deskZ = depth * 0.08;

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

  const devAgents = liveProjectAgents.slice(0, 2);
  const loungeAgents = liveProjectAgents.slice(2, 4);

  return (
    <group position={[0, Y, 0]}>
      {/* ── 1. Architectural Floor Slab & High-DPI Hardwood/Tile Surface ── */}
      <mesh position={[0, 0.02, 0]} receiveShadow material={materials.slabBase}>
        <boxGeometry args={[width + 0.08, 0.16, depth + 0.08]} />
      </mesh>

      <mesh position={[0, 0.11, 0]} receiveShadow material={materials.floorMesh}>
        <boxGeometry args={[width - 0.14, 0.04, depth - 0.14]} />
      </mesh>

      {/* Subtle Perimeter LED Accent Cove Strip */}
      {[
        [0, depth / 2 - 0.09, width - 0.2, 0.025],
        [0, -depth / 2 + 0.09, width - 0.2, 0.025],
      ].map(([x, z, w, d], i) => (
        <mesh key={`cove-z-${i}`} position={[x, 0.135, z]} material={materials.coveGlow}>
          <boxGeometry args={[w, 0.012, d]} />
        </mesh>
      ))}

      {/* ── 2. Front Low Glass Balustrade (Unobstructed Cutaway — No Top Bar or Corner Pillars!) ── */}
      <group position={[0, 0.14, depth / 2 - 0.06]}>
        <mesh position={[0, 0.04, 0]} material={materials.wallWainscot}>
          <boxGeometry args={[width - 0.12, 0.08, 0.08]} />
        </mesh>
        <mesh position={[0, 0.22, 0]} material={materials.interiorGlass}>
          <boxGeometry args={[width - 0.2, 0.28, 0.02]} />
        </mesh>
        <mesh position={[0, 0.37, 0]} material={mats.trim}>
          <boxGeometry args={[width - 0.16, 0.025, 0.045]} />
        </mesh>
      </group>

      {/* ── 3. Back Wall: Elevator Bay (Rear-Left) + Live Command & Telemetry Wall (Center) ── */}
      {/* Low base curb stays visible even when viewing from 180° behind */}
      <mesh position={[0, 0.24, -depth / 2 + 0.08]} material={materials.wallWainscot}>
        <boxGeometry args={[width, 0.22, 0.14]} />
      </mesh>

      <group ref={backWallGroupRef} position={[0, floorH / 2 + 0.14, -depth / 2 + 0.08]}>
        {/* Architectural Dark Studio Cladding Wall */}
        <mesh material={materials.wallStudio} receiveShadow>
          <boxGeometry args={[width, floorH, 0.14]} />
        </mesh>
        {/* Lower Wainscot Trim */}
        <mesh position={[0, -floorH * 0.32, 0.02]} material={materials.wallWainscot}>
          <boxGeometry args={[width - 0.08, floorH * 0.34, 0.15]} />
        </mesh>
        {/* Top Crown LED Strip */}
        <mesh position={[0, floorH / 2 - 0.08, 0.08]} material={materials.coveGlow}>
          <boxGeometry args={[width - 0.3, 0.03, 0.03]} />
        </mesh>

        {/* Rear-Left Architectural Elevator Bay (Separated cleanly from Center Command Screen!) */}
        <group position={[-width * 0.37, -floorH / 2 + 0.02, 0.09]}>
          <mesh position={[0, 0.82, 0]} material={materials.interiorFrame}>
            <boxGeometry args={[1.18, 1.64, 0.08]} />
          </mesh>
          <mesh position={[-0.25, 0.78, 0.03]} material={materials.elevatorDoor}>
            <boxGeometry args={[0.46, 1.48, 0.02]} />
          </mesh>
          <mesh position={[0.25, 0.78, 0.03]} material={materials.elevatorDoor}>
            <boxGeometry args={[0.46, 1.48, 0.02]} />
          </mesh>
          {/* Glowing Elevator Header Indicator */}
          <mesh position={[0, 1.56, 0.045]} material={materials.coveGlow}>
            <boxGeometry args={[0.42, 0.06, 0.02]} />
          </mesh>
        </group>

        {/* Center-Back Live Command & Telemetry Wall (Zero Overlap with Elevator!) */}
        <group
          position={[width * 0.05, 0.04, 0.1]}
          onPointerOver={(e) => {
            e.stopPropagation();
            handlePointerOver(telemetryObj.id);
          }}
          onPointerOut={handlePointerOut}
          onClick={(e) => {
            e.stopPropagation();
            setActiveObjectInspection(telemetryObj);
          }}
        >
          {/* Sleek Aluminum Bezel */}
          <mesh material={materials.screenBezel} castShadow>
            <boxGeometry args={[3.3, 1.62, 0.06]} />
          </mesh>
          {/* Glowing Accent Frame Rim */}
          <mesh position={[0, 0, -0.01]} material={hoveredObjectId === telemetryObj.id ? materials.ledGreen : materials.coveGlow}>
            <boxGeometry args={[3.36, 1.68, 0.03]} />
          </mesh>
          {/* Live High-DPI Telemetry & Blueprint Canvas */}
          <mesh position={[0, 0, 0.034]} material={materials.telemetryDisplay}>
            <planeGeometry args={[3.2, 1.54]} />
          </mesh>
          {hoveredObjectId === telemetryObj.id && (
            <Html position={[0, 0.98, 0.08]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
              <div
                style={{
                  background: 'rgba(9, 13, 22, 0.95)',
                  border: '1px solid #38bdf8',
                  borderRadius: 8,
                  padding: '4px 10px',
                  color: '#f8fafc',
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
                }}
              >
                Click to Inspect Live Command Telemetry
              </div>
            </Html>
          )}
        </group>
      </group>

      {/* ── 4. Side Walls: Camera-Aware Smart Cutaways for 360° Hands-On Control ── */}
      {([-1, 1] as const).map((side) => (
        <group key={`side-wall-${side}`} position={[side * (width / 2 - 0.07), 0.14, 0]}>
          {/* Low glass balustrade always present */}
          <mesh position={[0, 0.18, 0]} material={materials.wallWainscot} castShadow>
            <boxGeometry args={[0.12, 0.36, depth - 0.12]} />
          </mesh>
          <mesh position={[0, 0.38, 0]} material={mats.trim}>
            <boxGeometry args={[0.14, 0.03, depth - 0.1]} />
          </mesh>
          {/* Upper wall only visible when on the far side of the camera or in Walk-In mode */}
          <group ref={side === -1 ? leftWallFullRef : rightWallFullRef}>
            <mesh position={[0, floorH / 2, 0]} material={materials.wallStudio}>
              <boxGeometry args={[0.12, floorH, depth - 0.14]} />
            </mesh>
          </group>
        </group>
      ))}

      {/* ── ZONE 1: Interactive Dual-Monitor Developer Workstation (Left Side) ── */}
      <group
        position={[deskX1, 0.14, deskZ]}
        onPointerOver={(e) => {
          e.stopPropagation();
          handlePointerOver(workstationObj.id);
        }}
        onPointerOut={handlePointerOut}
        onClick={(e) => {
          e.stopPropagation();
          setActiveObjectInspection(workstationObj);
        }}
      >
        {/* Woven Slate Area Rug with Subtle Contrast Border */}
        <mesh position={[0, 0.004, 0.08]} receiveShadow material={materials.rugBorder}>
          <boxGeometry args={[width * 0.43, 0.008, depth * 0.48]} />
        </mesh>
        <mesh position={[0, 0.009, 0.08]} receiveShadow material={materials.rugWork}>
          <boxGeometry args={[width * 0.41, 0.008, depth * 0.46]} />
        </mesh>

        {/* Warm American Walnut Desk Top (High Contrast Against Slate Rug!) */}
        <mesh position={[0, 0.42, 0]} material={materials.deskTop} castShadow receiveShadow>
          <boxGeometry args={[Math.min(3.3, width * 0.39), 0.055, 1.12]} />
        </mesh>

        {/* Brushed Silver Trestle Legs & Modesty Crossbar */}
        {[-1.28, 1.28].map((lx) => (
          <group key={`desk-leg-${lx}`} position={[lx, 0.21, 0]}>
            <mesh material={materials.deskLegs} castShadow>
              <boxGeometry args={[0.06, 0.42, 0.92]} />
            </mesh>
          </group>
        ))}

        {/* Dual High-DPI Ultrawide Monitors with Rear Articulated Arms */}
        {[-0.68, 0.68].map((mx, mi) => (
          <group
            key={`monitor-${mi}`}
            position={[mx, 0.45, -0.22]}
            rotation={[0, mi === 0 ? 0.12 : -0.12, 0]}
          >
            {/* Rear Mounting Arm (Behind screen so nothing blocks display!) */}
            <mesh position={[0, 0.18, -0.12]} material={materials.deskLegs}>
              <cylinderGeometry args={[0.022, 0.028, 0.36, 12]} />
            </mesh>
            <mesh position={[0, 0.01, -0.12]} material={materials.deskLegs}>
              <boxGeometry args={[0.22, 0.02, 0.18]} />
            </mesh>
            {/* Monitor Bezel */}
            <mesh position={[0, 0.38, 0]} material={materials.screenBezel} castShadow>
              <boxGeometry args={[1.12, 0.62, 0.03]} />
            </mesh>
            {/* Live Code & Terminal Display */}
            <mesh
              position={[0, 0.38, 0.018]}
              material={mi === 0 ? materials.codeDisplay1 : materials.codeDisplay2}
            >
              <planeGeometry args={[1.06, 0.56]} />
            </mesh>
          </group>
        ))}

        {/* Keyboards, Mice & Desk Lamp */}
        {[-0.68, 0.68].map((kx, ki) => (
          <group key={`kb-${ki}`} position={[kx, 0.455, 0.18]}>
            {/* Desk Mat */}
            <mesh position={[0, -0.004, 0]} material={materials.wallWainscot}>
              <boxGeometry args={[0.62, 0.006, 0.26]} />
            </mesh>
            {/* Mechanical Keyboard */}
            <mesh position={[-0.05, 0.008, 0]} material={materials.screenBezel}>
              <boxGeometry args={[0.38, 0.016, 0.14]} />
            </mesh>
            {/* Glowing Keycap Strip */}
            <mesh position={[-0.05, 0.017, 0]} material={materials.coveGlow}>
              <boxGeometry args={[0.34, 0.004, 0.1]} />
            </mesh>
            {/* Wireless Mouse */}
            <mesh position={[0.21, 0.008, 0.02]} material={materials.chairMetal}>
              <boxGeometry args={[0.06, 0.016, 0.095]} />
            </mesh>
          </group>
        ))}

        {/* Ergonomic Studio Chairs with Lumbar Backrests, Armrests & Chrome Bases */}
        {[-0.68, 0.68].map((cx, ci) => (
          <group key={`chair-${ci}`} position={[cx, 0, 0.58]}>
            {/* Brushed Aluminum 5-Star Base Disc */}
            <mesh position={[0, 0.03, 0]} material={materials.chairMetal}>
              <cylinderGeometry args={[0.24, 0.24, 0.025, 16]} />
            </mesh>
            {/* Pneumatic Cylinder */}
            <mesh position={[0, 0.15, 0]} material={materials.chairMetal}>
              <cylinderGeometry args={[0.028, 0.028, 0.22, 12]} />
            </mesh>
            {/* Contoured Seat Cushion */}
            <mesh position={[0, 0.27, 0]} material={materials.chairMesh} castShadow>
              <boxGeometry args={[0.46, 0.065, 0.44]} />
            </mesh>
            {/* Armrests */}
            {[-0.24, 0.24].map((ax) => (
              <mesh key={`arm-${ax}`} position={[ax, 0.39, 0.02]} material={materials.chairMetal}>
                <boxGeometry args={[0.035, 0.18, 0.26]} />
              </mesh>
            ))}
            {/* Backrest & Headrest */}
            <mesh position={[0, 0.56, 0.20]} rotation={[-0.1, 0, 0]} material={materials.chairMesh} castShadow>
              <boxGeometry args={[0.44, 0.52, 0.045]} />
            </mesh>
            <mesh position={[0, 0.86, 0.23]} rotation={[-0.05, 0, 0]} material={materials.chairMesh}>
              <boxGeometry args={[0.28, 0.14, 0.04]} />
            </mesh>
          </group>
        ))}

        {/* Warm Task Light over Workstation */}
        <pointLight position={[0, 1.25, 0]} color="#e0f2fe" intensity={1.1} distance={3.5} />

        {/* Live Agent Bots Stationed at Workstations */}
        <group position={[0, 0.32, 0.58]}>
          <AgentBots bots={devAgents} small />
        </group>

        {hoveredObjectId === workstationObj.id && (
          <Html position={[0, 1.25, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                background: 'rgba(9, 13, 22, 0.95)',
                border: '1px solid #38bdf8',
                borderRadius: 8,
                padding: '4px 10px',
                color: '#f8fafc',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
              }}
            >
              {workstationObj.title} · Click to View Live Code
            </div>
          </Html>
        )}
      </group>

      {/* ── ZONE 2: 42U Server & Cloud Infrastructure Pod (Rear-Right) ── */}
      <group
        position={[width * 0.35, 0.15, -depth * 0.31]}
        rotation={[0, -0.28, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          handlePointerOver(serverObj.id);
        }}
        onPointerOut={handlePointerOut}
        onClick={(e) => {
          e.stopPropagation();
          setActiveObjectInspection(serverObj);
        }}
      >
        {/* Raised Data Center Plinth */}
        <mesh position={[0, 0.01, 0]} receiveShadow material={materials.tileServer}>
          <boxGeometry args={[1.18, 0.03, 1.12]} />
        </mesh>

        {/* 42U Server Rack Cabinet */}
        <mesh position={[0, 0.78, 0]} material={materials.serverChassis} castShadow receiveShadow>
          <boxGeometry args={[0.92, 1.52, 0.86]} />
        </mesh>
        {/* Smoked Glass Door */}
        <mesh position={[0, 0.78, 0.44]} material={materials.interiorGlass}>
          <planeGeometry args={[0.84, 1.44]} />
        </mesh>
        {/* Server Blades */}
        {Array.from({ length: 6 }, (_, si) => (
          <mesh key={`blade-${si}`} position={[0, 0.24 + si * 0.21, 0.22]} material={mats.trim}>
            <boxGeometry args={[0.8, 0.14, 0.42]} />
          </mesh>
        ))}
        {/* Pulsing Status Activity LEDs */}
        <mesh ref={ledRef1} position={[-0.28, 1.22, 0.45]} material={materials.ledGreen}>
          <sphereGeometry args={[0.022, 8, 8]} />
        </mesh>
        <mesh ref={ledRef2} position={[-0.22, 1.22, 0.45]} material={materials.ledAmber}>
          <sphereGeometry args={[0.022, 8, 8]} />
        </mesh>
        <mesh ref={ledRef3} position={[-0.16, 1.22, 0.45]} material={materials.ledBlue}>
          <sphereGeometry args={[0.022, 8, 8]} />
        </mesh>

        {hoveredObjectId === serverObj.id && (
          <Html position={[0, 1.72, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                background: 'rgba(9, 13, 22, 0.95)',
                border: '1px solid #10b981',
                borderRadius: 8,
                padding: '4px 10px',
                color: '#f8fafc',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {serverObj.title} · Click to Inspect Endpoints
            </div>
          </Html>
        )}
      </group>

      {/* ── ZONE 3: Live Application & Terminal Preview Display (Right Side — Zero Pole Obstruction!) ── */}
      <group
        position={[width * 0.26, 0.14, -depth * 0.04]}
        rotation={[0, -0.38, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          handlePointerOver(previewObj.id);
        }}
        onPointerOut={handlePointerOut}
        onClick={(e) => {
          e.stopPropagation();
          setActiveObjectInspection(previewObj);
        }}
      >
        {/* Heavy Architectural Floor Base Plate */}
        <mesh position={[0, 0.015, -0.06]} material={materials.interiorFrame} receiveShadow>
          <boxGeometry args={[1.3, 0.03, 0.46]} />
        </mesh>
        {/* Dual Rear Support Columns (Positioned BEHIND the display and stopping at bottom bezel!) */}
        {[-0.45, 0.45].map((px) => (
          <mesh key={`stand-col-${px}`} position={[px, 0.36, -0.08]} material={materials.deskLegs} castShadow>
            <cylinderGeometry args={[0.032, 0.038, 0.68, 12]} />
          </mesh>
        ))}

        {/* Ultra-Thin Metallic Display Frame */}
        <mesh position={[0, 1.24, 0]} material={materials.screenBezel} castShadow>
          <boxGeometry args={[2.32, 1.28, 0.05]} />
        </mesh>
        {/* Subtle Glowing Rim */}
        <mesh
          position={[0, 1.24, -0.01]}
          material={hoveredObjectId === previewObj.id ? materials.ledGreen : materials.coveGlow}
        >
          <boxGeometry args={[2.36, 1.32, 0.025]} />
        </mesh>
        {/* Live High-DPI Application & Terminal Viewport Display (Front Face completely clear!) */}
        <mesh position={[0, 1.24, 0.03]} material={materials.previewDisplay}>
          <planeGeometry args={[2.22, 1.18]} />
        </mesh>

        {hoveredObjectId === previewObj.id && (
          <Html position={[0, 2.02, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                background: 'rgba(9, 13, 22, 0.95)',
                border: '1px solid #38bdf8',
                borderRadius: 8,
                padding: '4px 10px',
                color: '#f8fafc',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {previewObj.title} · Click to Open Live Viewport
            </div>
          </Html>
        )}
      </group>

      {/* ── ZONE 4: Executive Strategy & Agent Collaboration Lounge (Front-Right — Zero Clipping!) ── */}
      <group
        position={[width * 0.24, 0.14, depth * 0.25]}
        onPointerOver={(e) => {
          e.stopPropagation();
          handlePointerOver(loungeObj.id);
        }}
        onPointerOut={handlePointerOut}
        onClick={(e) => {
          e.stopPropagation();
          setActiveObjectInspection(loungeObj);
        }}
      >
        {/* Soft Woven Lounge Rug */}
        <mesh position={[0, 0.005, 0.08]} receiveShadow material={materials.rugBorder}>
          <boxGeometry args={[width * 0.39, 0.008, depth * 0.40]} />
        </mesh>
        <mesh position={[0, 0.01, 0.08]} receiveShadow material={materials.rugLounge}>
          <boxGeometry args={[width * 0.37, 0.008, depth * 0.38]} />
        </mesh>

        {/* L-Shaped Cognac Leather Sectional Sofa (Positioned cleanly at z = -0.22) */}
        <group position={[-0.08, 0, -0.22]}>
          {/* Main Walnut Plinth */}
          <mesh position={[0, 0.045, 0]} material={materials.loungeWood} castShadow>
            <boxGeometry args={[1.54, 0.07, 0.64]} />
          </mesh>
          {/* Chaise Walnut Plinth */}
          <mesh position={[0.49, 0.045, 0.62]} material={materials.loungeWood} castShadow>
            <boxGeometry args={[0.56, 0.07, 0.62]} />
          </mesh>

          {/* Main Seat Cushion (z spans -0.30 to +0.30 in local group -> -0.52 to +0.08 in lounge group) */}
          <mesh position={[0, 0.16, 0]} material={materials.loungeLeather} castShadow receiveShadow>
            <boxGeometry args={[1.5, 0.16, 0.60]} />
          </mesh>
          {/* Chaise Return Cushion (x spans +0.21 to +0.77, z spans +0.30 to +0.92 in local group) */}
          <mesh position={[0.49, 0.16, 0.61]} material={materials.loungeLeather} castShadow receiveShadow>
            <boxGeometry args={[0.54, 0.16, 0.62]} />
          </mesh>

          {/* Main Backrest */}
          <mesh position={[0, 0.36, -0.24]} material={materials.loungeLeather} castShadow>
            <boxGeometry args={[1.5, 0.28, 0.14]} />
          </mesh>
          {/* Left & Right Armrests */}
          <mesh position={[-0.70, 0.28, 0]} material={materials.loungeLeather} castShadow>
            <boxGeometry args={[0.12, 0.24, 0.60]} />
          </mesh>
          <mesh position={[0.72, 0.28, 0.30]} material={materials.loungeLeather} castShadow>
            <boxGeometry args={[0.12, 0.24, 1.20]} />
          </mesh>

          {/* Accent Throw Pillows */}
          <mesh position={[-0.50, 0.30, -0.10]} rotation={[0, 0.25, 0]} material={materials.loungePillow}>
            <boxGeometry args={[0.24, 0.22, 0.08]} />
          </mesh>
          <mesh position={[0.46, 0.30, -0.10]} rotation={[0, -0.2, 0]} material={materials.screenBezel}>
            <boxGeometry args={[0.24, 0.22, 0.08]} />
          </mesh>
        </group>

        {/* Honed Carrara Marble Coffee Table — Placed cleanly in front of sofa at x = -0.38, z = 0.44 (ZERO CLIPPING!) */}
        <group position={[-0.38, 0, 0.44]}>
          <mesh position={[0, 0.22, 0]} material={materials.marble} castShadow receiveShadow>
            <cylinderGeometry args={[0.26, 0.26, 0.032, 32]} />
          </mesh>
          {/* Brushed Brass Legs */}
          {[
            [-0.14, -0.12],
            [0.14, -0.12],
            [0, 0.15],
          ].map(([lx, lz], li) => (
            <mesh key={`t-leg-${li}`} position={[lx, 0.11, lz]} material={materials.brass}>
              <cylinderGeometry args={[0.012, 0.008, 0.21, 10]} />
            </mesh>
          ))}
          {/* Interactive Live Strategy Tablet on Table */}
          <mesh position={[-0.04, 0.242, 0]} rotation={[0, 0.18, 0]} material={materials.telemetryDisplay}>
            <boxGeometry args={[0.22, 0.01, 0.15]} />
          </mesh>
          {/* Ceramic Espresso Cup */}
          <mesh position={[0.12, 0.255, 0.06]} material={materials.plantPot}>
            <cylinderGeometry args={[0.025, 0.02, 0.042, 12]} />
          </mesh>
        </group>

        {/* Architectural Multi-Stem Ficus Tree in Ribbed Ceramic Planter */}
        <group position={[0.78, 0, -0.36]}>
          {/* Ceramic Planter */}
          <mesh position={[0, 0.18, 0]} material={materials.plantPot} castShadow>
            <cylinderGeometry args={[0.16, 0.12, 0.34, 20]} />
          </mesh>
          {/* Soil Bed */}
          <mesh position={[0, 0.34, 0]} material={materials.loungeWood}>
            <cylinderGeometry args={[0.145, 0.145, 0.02, 16]} />
          </mesh>
          {/* Natural Woody Trunks */}
          <mesh position={[0, 0.50, 0]} rotation={[0.08, 0, -0.06]} material={materials.loungeWood} castShadow>
            <cylinderGeometry args={[0.022, 0.032, 0.38, 8]} />
          </mesh>
          <mesh position={[0.04, 0.54, 0.02]} rotation={[-0.1, 0, 0.14]} material={materials.loungeWood}>
            <cylinderGeometry args={[0.016, 0.024, 0.32, 8]} />
          </mesh>
          {/* Layered Polyhedral Foliage Canopy */}
          <mesh position={[-0.04, 0.72, 0]} material={materials.plantLeaf} castShadow>
            <dodecahedronGeometry args={[0.18, 1]} />
          </mesh>
          <mesh position={[0.08, 0.78, 0.05]} material={materials.plantLeafLight} castShadow>
            <dodecahedronGeometry args={[0.15, 1]} />
          </mesh>
          <mesh position={[0.0, 0.88, -0.03]} material={materials.plantLeaf} castShadow>
            <dodecahedronGeometry args={[0.14, 1]} />
          </mesh>
        </group>

        {/* Warm Ambient Lounge Point Light */}
        <pointLight position={[-0.15, 1.2, 0.2]} color="#fef3c7" intensity={1.3} distance={3.8} />

        {/* Live Bots in Lounge */}
        <group position={[-0.15, 0.24, -0.22]}>
          <AgentBots bots={loungeAgents} small />
        </group>

        {hoveredObjectId === loungeObj.id && (
          <Html position={[-0.1, 1.05, 0.1]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                background: 'rgba(9, 13, 22, 0.95)',
                border: '1px solid #f59e0b',
                borderRadius: 8,
                padding: '4px 10px',
                color: '#f8fafc',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {loungeObj.title} · Click to Open Standup
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}
