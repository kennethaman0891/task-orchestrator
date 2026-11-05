// Developer City — CarInterior: high-tech cyberpunk luxury cockpit.
// Features authentic sports bucket seats (cushion, thigh bolsters, reclined backrest,
// shoulder wings, twin chrome posts, adjustable headrests with contrast stitching),
// sculpted dashboard with air vents, center console with armrest & rotary selector,
// cyber sport steering wheel with controls & pedals, and 4 luminous digital displays:
// 1. Driver Virtual Cockpit (speedometer, tachometer, gear, battery, lane radar)
// 2. Large Central Mission Touchscreen (task description, progress bar, telemetry, GPS map)
// 3. Passenger Auxiliary HUD (model name, audio waveform, climate)
// 4. Digital Rearview Mirror (rear camera feed simulation)

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { TerminalCar } from '@/city/types';
import { Driver } from './Driver';

const SEAT_X = 0.28;
const SEAT_Z = -0.18;
const SEAT_BASE_Y = 0.34;
const SEAT_TOP_Y = 0.42;

function epochMs(n: number): number {
  return n < 1e12 ? n * 1000 : n;
}

function formatLocalTime(n: number): string {
  return new Date(epochMs(n)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

function finiteNumber(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas Textures for Cockpit Displays
// ─────────────────────────────────────────────────────────────────────────────

function drawVirtualCockpit(canvas: HTMLCanvasElement, car: TerminalCar, moving: boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  // Background
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, w, h);

  // Outer bezel border
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(6,182,212,0.12)';
  ctx.lineWidth = 1;
  for (let y = 30; y < h; y += 24) {
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.lineTo(w - 10, y);
    ctx.stroke();
  }

  // --- Top Status Line ---
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('VIRTUAL COCKPIT', 20, 26);
  ctx.textAlign = 'right';
  ctx.fillStyle = car.moving ? '#4ade80' : '#94a3b8';
  ctx.fillText(car.moving ? '● CRUISE ON' : '○ PARKED', w - 20, 26);

  // --- Left: Speedometer ---
  const speed = moving ? '82' : '0';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillText(speed, 120, 115);
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('KM / H', 120, 140);

  // Tachometer / Power Arc
  ctx.beginPath();
  ctx.arc(120, 105, 76, Math.PI * 0.75, Math.PI * (moving ? 1.85 : 1.15));
  ctx.strokeStyle = moving ? '#06b6d4' : '#334155';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Gear Selector
  const gears = ['P', 'R', 'N', 'D'];
  const activeGear = moving ? 'D' : 'P';
  gears.forEach((g, idx) => {
    const gx = 60 + idx * 40;
    const gy = 190;
    const isCur = g === activeGear;
    ctx.fillStyle = isCur ? '#06b6d4' : '#475569';
    ctx.font = isCur ? 'bold 20px monospace' : '16px monospace';
    ctx.fillText(isCur ? `[${g}]` : g, gx, gy);
  });

  // --- Center: Forward Lane Radar Visual ---
  ctx.save();
  ctx.translate(w / 2, 85);
  // Perspective road lines
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-15, 0);
  ctx.lineTo(-65, 95);
  ctx.moveTo(15, 0);
  ctx.lineTo(65, 95);
  ctx.stroke();

  // Dashed centerline
  ctx.strokeStyle = 'rgba(6,182,212,0.6)';
  ctx.setLineDash([8, 10]);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 95);
  ctx.stroke();
  ctx.setLineDash([]);

  // Vehicle glyph
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(-16, 55, 32, 28);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-14, 80, 28, 4);
  ctx.restore();

  // --- Right: Battery & Agent Diagnostics ---
  ctx.textAlign = 'left';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px monospace';
  ctx.fillText('BATTERY', w - 170, 70);
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 24px monospace';
  ctx.fillText('96%', w - 170, 96);

  // Battery bar
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(w - 170, 106, 140, 10);
  ctx.fillStyle = '#4ade80';
  ctx.fillRect(w - 170, 106, 140 * 0.96, 10);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('AGENT CORE', w - 170, 140);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 13px system-ui, sans-serif';
  const agName = (car.agentName || car.modelName || 'Active Agent').slice(0, 14);
  ctx.fillText(agName, w - 170, 158);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '12px monospace';
  ctx.fillText('NET PING: 24ms', w - 170, 185);

  // Bottom border line
  ctx.fillStyle = '#06b6d4';
  ctx.fillRect(10, h - 8, w - 20, 2);
}

function drawCenterTouchscreen(canvas: HTMLCanvasElement, car: TerminalCar, now: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  // Deep tech background
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, w, h);

  // Sleek cyber grid pattern in background
  ctx.strokeStyle = 'rgba(14,165,233,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // --- Top Status Bar ---
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, w, 56);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 56);
  ctx.lineTo(w, 56);
  ctx.stroke();

  // Vehicle title
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(car.name || 'TERMINAL CAR', 24, 36);

  // Status badge
  const isRunning = car.currentTask?.status === 'running' || car.moving;
  ctx.fillStyle = isRunning ? 'rgba(34,197,94,0.2)' : 'rgba(6,182,212,0.2)';
  ctx.strokeStyle = isRunning ? '#22c55e' : '#06b6d4';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(w / 2 - 90, 12, 180, 32, 16);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = isRunning ? '#4ade80' : '#67e8f9';
  ctx.font = 'bold 14px monospace';
  ctx.fillText(isRunning ? '● MISSION ACTIVE' : '○ SYSTEM STANDBY', w / 2, 33);

  // Current clock
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px monospace';
  ctx.fillText(new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), w - 24, 36);

  // --- Left Column: Active Task & Mission Information ---
  const leftX = 24;
  const leftW = w * 0.58;

  ctx.fillStyle = '#111827';
  ctx.strokeStyle = 'rgba(56,189,248,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(leftX, 76, leftW, h - 146, 12);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('MISSION DIRECTIVE & WORKSPACE TASK', leftX + 20, 108);

  const task = car.currentTask;
  if (task && task.description) {
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 20px system-ui, sans-serif';
    // Word wrap task description
    const words = task.description.split(' ');
    let line = '';
    let y = 148;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > leftW - 40 && line) {
        ctx.fillText(line, leftX + 20, y);
        line = word;
        y += 28;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, leftX + 20, y);

    // Task details
    const started = finiteNumber(task.started_at) ? epochMs(task.started_at) : null;
    const elapsed = started ? formatElapsed(now - started) : '00:00';

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText(`STATUS: ${(task.status || 'running').toUpperCase()}`, leftX + 20, y + 42);
    ctx.fillText(`ELAPSED: ${elapsed}`, leftX + 220, y + 42);

    // Progress bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(leftX + 20, y + 56, leftW - 40, 12);
    ctx.fillStyle = '#06b6d4';
    ctx.fillRect(leftX + 20, y + 56, (leftW - 40) * (isRunning ? 0.68 : 1.0), 12);
  } else {
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText('Ready for Developer Commands', leftX + 20, 155);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('No active task running in this terminal session.', leftX + 20, 185);
    ctx.fillText('Click "Open Terminal" or press enter to dispatch instructions.', leftX + 20, 212);
  }

  // Recent task history
  const history = (car.history ?? []).slice(-2);
  if (history.length > 0) {
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('RECENT COMPLETED LOGS:', leftX + 20, h - 110);
    ctx.font = '13px system-ui, sans-serif';
    history.forEach((hRow, i) => {
      ctx.fillStyle = '#cbd5e1';
      const timeStr = finiteNumber(hRow.completed_at) ? `[${formatLocalTime(hRow.completed_at)}] ` : '';
      const text = `${timeStr}${hRow.description}`.slice(0, 48);
      ctx.fillText(text, leftX + 20, h - 86 + i * 20);
    });
  }

  // --- Right Column: Telemetry & Navigation Mini-Map ---
  const rightX = leftX + leftW + 20;
  const rightW = w - rightX - 24;

  ctx.fillStyle = '#111827';
  ctx.strokeStyle = 'rgba(56,189,248,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(rightX, 76, rightW, h - 146, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('SYSTEM TELEMETRY', rightX + 20, 108);

  // Telemetry items
  const stats = [
    { label: 'CPU LOAD', val: '24%', bar: 0.24, col: '#38bdf8' },
    { label: 'MEM USAGE', val: '412 MB', bar: 0.38, col: '#4ade80' },
    { label: 'CLI ENGINE', val: car.cli || 'antigravity', bar: 0.85, col: '#a855f7' },
  ];

  stats.forEach((s, idx) => {
    const sy = 138 + idx * 46;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText(s.label, rightX + 20, sy);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(s.val, rightX + rightW - 20, sy);
    ctx.textAlign = 'left';

    // Bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(rightX + 20, sy + 6, rightW - 40, 6);
    ctx.fillStyle = s.col;
    ctx.fillRect(rightX + 20, sy + 6, (rightW - 40) * s.bar, 6);
  });

  // Vector City GPS Map
  const mapY = 280;
  const mapH = h - 146 - 215;
  ctx.fillStyle = '#0a0f1d';
  ctx.fillRect(rightX + 20, mapY, rightW - 40, mapH);
  ctx.strokeStyle = 'rgba(56,189,248,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rightX + 20, mapY, rightW - 40, mapH);

  // Map road grid lines
  ctx.strokeStyle = 'rgba(6,182,212,0.25)';
  for (let gx = rightX + 45; gx < rightX + rightW - 20; gx += 35) {
    ctx.beginPath();
    ctx.moveTo(gx, mapY);
    ctx.lineTo(gx, mapY + mapH);
    ctx.stroke();
  }
  for (let gy = mapY + 20; gy < mapY + mapH; gy += 25) {
    ctx.beginPath();
    ctx.moveTo(rightX + 20, gy);
    ctx.lineTo(rightX + rightW - 20, gy);
    ctx.stroke();
  }

  // Glowing pulsing blip for vehicle position
  const blipX = rightX + rightW * 0.45;
  const blipY = mapY + mapH * 0.55;
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(blipX, blipY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(blipX, blipY, 12, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('GPS: CITY GRID ACTIVE', rightX + 26, mapY + mapH - 10);

  // --- Bottom Control Bar ---
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, h - 56, w, 56);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, h - 56);
  ctx.lineTo(w, h - 56);
  ctx.stroke();

  const buttons = ['[ 🗺️ NAVI ]', '[ ⌨️ TERMINAL ]', '[ ❄️ 21.5°C ]', '[ 🔊 AUDIO ]', '[ ⚙️ SYSTEM ]'];
  buttons.forEach((btn, idx) => {
    const bx = 40 + idx * ((w - 80) / buttons.length);
    ctx.fillStyle = idx === 1 ? '#38bdf8' : '#94a3b8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(btn, bx, h - 22);
  });
}

function drawPassengerHUD(canvas: HTMLCanvasElement, car: TerminalCar, tick: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#060a12';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  // Left: AI Model Name
  ctx.textAlign = 'left';
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('AI ASSISTANT ENGINE', 14, 26);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px system-ui, sans-serif';
  const modelStr = (car.modelName || car.agentName || 'GLM-5.3-FLASH').toUpperCase();
  ctx.fillText(modelStr.slice(0, 18), 14, 56);

  ctx.fillStyle = '#4ade80';
  ctx.font = '12px monospace';
  ctx.fillText('● OPTIMAL PERFORMANCE', 14, 82);

  // Right: Audio / Equalizer Visualizer Bars
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('CABIN AUDIO & WAVEFORM', w - 14, 26);

  const numBars = 18;
  const barW = 8;
  const gap = 4;
  const startX = w - 14 - numBars * (barW + gap);
  for (let i = 0; i < numBars; i++) {
    const wave = Math.sin((tick * 0.08) + i * 0.45) * 0.5 + 0.5;
    const barH = 10 + wave * 48;
    ctx.fillStyle = i > 12 ? '#ef4444' : i > 7 ? '#06b6d4' : '#3b82f6';
    ctx.fillRect(startX + i * (barW + gap), 100 - barH, barW, barH);
  }
}

function drawRearviewMirror(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  // Sky & Horizon
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
  skyGrad.addColorStop(0, '#090d16');
  skyGrad.addColorStop(0.5, '#1e293b');
  skyGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h);

  // Horizon road perspective
  ctx.strokeStyle = 'rgba(6,182,212,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.35);
  ctx.lineTo(w * 0.15, h);
  ctx.moveTo(w / 2, h * 0.35);
  ctx.lineTo(w * 0.85, h);
  ctx.stroke();

  // Distant following headlights
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(w / 2 - 25, h * 0.6, 3, 0, Math.PI * 2);
  ctx.arc(w / 2 + 25, h * 0.6, 3, 0, Math.PI * 2);
  ctx.fill();

  // Frame border
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('CAM · REAR', 8, 14);
}

// ─────────────────────────────────────────────────────────────────────────────
// Luxury Ergonomic Sports Bucket Seat Component
// ─────────────────────────────────────────────────────────────────────────────

function SportsSeat({
  x,
  z = SEAT_Z,
  accentColor = '#06b6d4',
}: {
  x: number;
  z?: number;
  accentColor?: string;
}) {
  const seatMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#161a23', roughness: 0.65, metalness: 0.12 }),
    []
  );
  const bolsterMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0f131a', roughness: 0.55, metalness: 0.15 }),
    []
  );
  const accentMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4, metalness: 0.3 }),
    [accentColor]
  );
  const railMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.3, metalness: 0.85 }),
    []
  );

  return (
    <group position={[x, 0, z]}>
      {/* 1. Floor Mounting Slider Rails */}
      <mesh position={[-0.14, 0.28, 0]} material={railMat} castShadow>
        <boxGeometry args={[0.024, 0.02, 0.46]} />
      </mesh>
      <mesh position={[0.14, 0.28, 0]} material={railMat} castShadow>
        <boxGeometry args={[0.024, 0.02, 0.46]} />
      </mesh>

      {/* 2. Seat Base Pedestal */}
      <mesh position={[0, 0.31, 0]} material={bolsterMat}>
        <boxGeometry args={[0.34, 0.04, 0.42]} />
      </mesh>

      {/* 3. Ergonomic Bottom Cushion */}
      <mesh position={[0, SEAT_BASE_Y + 0.02, 0]} material={seatMat} castShadow receiveShadow>
        <boxGeometry args={[0.36, 0.10, 0.44]} />
      </mesh>

      {/* Raised Lateral Thigh Bolsters (Left & Right) */}
      <mesh position={[-0.17, SEAT_BASE_Y + 0.05, 0]} rotation={[0, 0, 0.14]} material={bolsterMat}>
        <boxGeometry args={[0.06, 0.08, 0.44]} />
      </mesh>
      <mesh position={[0.17, SEAT_BASE_Y + 0.05, 0]} rotation={[0, 0, -0.14]} material={bolsterMat}>
        <boxGeometry args={[0.06, 0.08, 0.44]} />
      </mesh>

      {/* Center Racing Stripe down cushion */}
      <mesh position={[0, SEAT_BASE_Y + 0.075, 0]} material={accentMat}>
        <boxGeometry args={[0.035, 0.005, 0.42]} />
      </mesh>

      {/* 4. Ergonomically Reclined Backrest */}
      <group position={[0, SEAT_TOP_Y + 0.22, -0.18]} rotation={[-0.18, 0, 0]}>
        {/* Main contoured backrest */}
        <mesh material={seatMat} castShadow receiveShadow>
          <boxGeometry args={[0.36, 0.44, 0.09]} />
        </mesh>

        {/* Lateral Torso / Shoulder Wings */}
        <mesh position={[-0.17, 0, 0.02]} rotation={[0, 0.18, 0]} material={bolsterMat}>
          <boxGeometry args={[0.06, 0.42, 0.10]} />
        </mesh>
        <mesh position={[0.17, 0, 0.02]} rotation={[0, -0.18, 0]} material={bolsterMat}>
          <boxGeometry args={[0.06, 0.42, 0.10]} />
        </mesh>

        {/* Contrast center accent line */}
        <mesh position={[0, 0, 0.048]} material={accentMat}>
          <boxGeometry args={[0.035, 0.40, 0.005]} />
        </mesh>

        {/* Twin Chrome Headrest Support Posts */}
        <mesh position={[-0.06, 0.26, -0.01]} material={railMat}>
          <cylinderGeometry args={[0.006, 0.006, 0.08, 8]} />
        </mesh>
        <mesh position={[0.06, 0.26, -0.01]} material={railMat}>
          <cylinderGeometry args={[0.006, 0.006, 0.08, 8]} />
        </mesh>

        {/* Sculpted Headrest */}
        <mesh position={[0, 0.32, -0.01]} material={seatMat} castShadow>
          <boxGeometry args={[0.22, 0.14, 0.08]} />
        </mesh>
        {/* Headrest accent stripe */}
        <mesh position={[0, 0.32, 0.035]} material={accentMat}>
          <boxGeometry args={[0.035, 0.12, 0.005]} />
        </mesh>
      </group>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main CarInterior Component
// ─────────────────────────────────────────────────────────────────────────────

export function CarInterior({ car, color }: { car: TerminalCar; color?: string }) {
  const accentColor = color || car.color || '#06b6d4';
  const isMoving = Boolean(car.moving);
  const [clockTick, setClockTick] = useState(() => Date.now());

  // 1-second dynamic clock loop for active elapsed timers & animations
  useEffect(() => {
    const id = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // --- Display 1: Driver Virtual Cockpit Canvas Texture ---
  const clusterTex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 240;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex };
  }, []);

  useEffect(() => {
    drawVirtualCockpit(clusterTex.canvas, car, isMoving);
    clusterTex.tex.needsUpdate = true;
  }, [clusterTex, car, isMoving, clockTick]);

  // --- Display 2: Large Center Touchscreen Canvas Texture ---
  const centerTex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex };
  }, []);

  useEffect(() => {
    drawCenterTouchscreen(centerTex.canvas, car, clockTick);
    centerTex.tex.needsUpdate = true;
  }, [centerTex, car, clockTick]);

  // --- Display 3: Passenger HUD Texture ---
  const passengerTex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex };
  }, []);

  useEffect(() => {
    drawPassengerHUD(passengerTex.canvas, car, clockTick);
    passengerTex.tex.needsUpdate = true;
  }, [passengerTex, car, clockTick]);

  // --- Display 4: Digital Rearview Mirror Texture ---
  const mirrorTex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    drawRearviewMirror(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Common shared cockpit materials
  const dashMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#131822', roughness: 0.5, metalness: 0.15 }),
    []
  );
  const consoleMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0d1118', roughness: 0.45, metalness: 0.2 }),
    []
  );
  const chromeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.15, metalness: 0.95 }),
    []
  );
  const wheelLeatherMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#1a1f29', roughness: 0.6, metalness: 0.1 }),
    []
  );
  const glassMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e0f2fe',
        roughness: 0.08,
        metalness: 0.9,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      }),
    []
  );
  const neonMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: accentColor,
        emissive: accentColor,
        emissiveIntensity: 1.8,
      }),
    [accentColor]
  );

  return (
    <group>
      {/* ── 1. Interior Cabin Floor & Tub ─────────────────────────── */}
      <mesh position={[0, 0.27, -0.05]} receiveShadow>
        <boxGeometry args={[1.04, 0.03, 1.48]} />
        <meshStandardMaterial color="#0f131a" roughness={0.88} metalness={0.05} />
      </mesh>

      {/* Driver & Passenger Floor Mats */}
      <mesh position={[-SEAT_X, 0.286, 0.15]} receiveShadow>
        <boxGeometry args={[0.40, 0.005, 0.55]} />
        <meshStandardMaterial color="#1a202c" roughness={0.95} />
      </mesh>
      <mesh position={[SEAT_X, 0.286, 0.15]} receiveShadow>
        <boxGeometry args={[0.40, 0.005, 0.55]} />
        <meshStandardMaterial color="#1a202c" roughness={0.95} />
      </mesh>

      {/* ── 2. Luxury Sports Bucket Seats (Driver & Passenger) ───── */}
      <SportsSeat x={-SEAT_X} accentColor={accentColor} />
      <SportsSeat x={SEAT_X} accentColor={accentColor} />

      {/* ── 3. Sculpted Cyber Dashboard & Binnacle ───────────────── */}
      {/* Main horizontal dashboard wing */}
      <mesh position={[0, 0.66, 0.62]} material={dashMat} castShadow>
        <boxGeometry args={[1.06, 0.14, 0.32]} />
      </mesh>

      {/* Slanted lower dashboard knee bolster */}
      <mesh position={[0, 0.54, 0.56]} rotation={[0.42, 0, 0]} material={consoleMat}>
        <boxGeometry args={[1.04, 0.14, 0.16]} />
      </mesh>

      {/* Driver Instrument Binnacle (hood over cluster) */}
      <mesh position={[-SEAT_X, 0.74, 0.56]} rotation={[-0.14, 0, 0]} material={dashMat}>
        <boxGeometry args={[0.34, 0.05, 0.22]} />
      </mesh>

      {/* Continuous Ambient Neon LED Light Strip along Dashboard */}
      <mesh position={[0, 0.60, 0.52]} material={neonMat}>
        <boxGeometry args={[1.04, 0.015, 0.015]} />
      </mesh>

      {/* Dual Turbine Air Vents with Chrome Bezels */}
      {([-0.46, 0.46] as const).map((vx) => (
        <group key={`vent-${vx}`} position={[vx, 0.66, 0.47]}>
          <mesh material={chromeMat} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.02, 16]} />
          </mesh>
          <mesh material={consoleMat} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.034, 0.034, 0.022, 12]} />
          </mesh>
        </group>
      ))}

      {/* ── 4. Center Console & Armrest Bridge ─────────────────────── */}
      {/* Center tunnel sloping down between seats */}
      <mesh position={[0, 0.44, 0.02]} rotation={[0.18, 0, 0]} material={consoleMat}>
        <boxGeometry args={[0.22, 0.12, 0.88]} />
      </mesh>

      {/* Padded Center Armrest */}
      <mesh position={[0, 0.49, -0.26]} material={wheelLeatherMat} castShadow>
        <boxGeometry args={[0.18, 0.08, 0.30]} />
      </mesh>

      {/* Rotary Drive Mode Selector Dial */}
      <mesh position={[0, 0.49, 0.12]} material={chromeMat}>
        <cylinderGeometry args={[0.038, 0.038, 0.025, 20]} />
      </mesh>
      {/* Rotary Selector Glowing Ring */}
      <mesh position={[0, 0.505, 0.12]} rotation={[-Math.PI / 2, 0, 0]} material={neonMat}>
        <ringGeometry args={[0.026, 0.034, 20]} />
      </mesh>

      {/* Twin Illuminated Cupholders */}
      {([0.24, 0.33] as const).map((cz, i) => (
        <group key={`cupholder-${i}`} position={[0, 0.485, cz]}>
          <mesh material={consoleMat}>
            <cylinderGeometry args={[0.032, 0.03, 0.03, 16]} />
          </mesh>
          <mesh material={neonMat} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.026, 0.032, 16]} />
          </mesh>
        </group>
      ))}

      {/* ── 5. Driver Steering System & Aluminum Pedals ───────────── */}
      {/* Heavy-duty steering column extending from dash */}
      <mesh position={[-SEAT_X, 0.59, 0.48]} rotation={[0.42, 0, 0]} material={consoleMat}>
        <cylinderGeometry args={[0.036, 0.042, 0.22, 16]} />
      </mesh>

      {/* Turn signal & wiper control stalks */}
      <mesh position={[-SEAT_X - 0.07, 0.63, 0.44]} rotation={[0, 0, 0.4]} material={chromeMat}>
        <cylinderGeometry args={[0.006, 0.006, 0.09, 8]} />
      </mesh>
      <mesh position={[-SEAT_X + 0.07, 0.63, 0.44]} rotation={[0, 0, -0.4]} material={chromeMat}>
        <cylinderGeometry args={[0.006, 0.006, 0.09, 8]} />
      </mesh>

      {/* Cyber Flat-Bottom Sport Steering Wheel */}
      <group position={[-SEAT_X, 0.66, 0.38]} rotation={[0.42, 0, 0]}>
        {/* Outer racing rim */}
        <mesh material={wheelLeatherMat} castShadow>
          <torusGeometry args={[0.12, 0.016, 12, 24]} />
        </mesh>
        {/* Flat-bottom race trim insert */}
        <mesh position={[0, -0.118, 0]} material={chromeMat}>
          <boxGeometry args={[0.11, 0.018, 0.02]} />
        </mesh>

        {/* 3-Spoke Brushed Aluminum Center Hub */}
        <mesh material={chromeMat}>
          <boxGeometry args={[0.18, 0.028, 0.016]} />
        </mesh>
        <mesh position={[0, -0.05, 0]} material={chromeMat}>
          <boxGeometry args={[0.028, 0.11, 0.016]} />
        </mesh>

        {/* Central Horn Pad with Glowing Cyber Emblem */}
        <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]} material={consoleMat}>
          <cylinderGeometry args={[0.042, 0.042, 0.014, 20]} />
        </mesh>
        <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]} material={neonMat}>
          <cylinderGeometry args={[0.018, 0.018, 0.005, 16]} />
        </mesh>
      </group>

      {/* Aluminum Accelerator & Brake Pedals in Driver Footwell */}
      <mesh position={[-SEAT_X + 0.05, 0.32, 0.64]} rotation={[-0.45, 0, 0]} material={chromeMat}>
        <boxGeometry args={[0.032, 0.075, 0.01]} />
      </mesh>
      <mesh position={[-SEAT_X - 0.05, 0.34, 0.64]} rotation={[-0.45, 0, 0]} material={chromeMat}>
        <boxGeometry args={[0.065, 0.06, 0.01]} />
      </mesh>

      {/* ── 6. FOUR HIGH-TECH DIGITAL DISPLAYS ─────────────────────── */}

      {/* Display 1: Driver Virtual Cockpit Display */}
      <group position={[-SEAT_X, 0.66, 0.55]} rotation={[-0.14, 0, 0]}>
        {/* Bezel */}
        <mesh material={consoleMat}>
          <boxGeometry args={[0.29, 0.14, 0.012]} />
        </mesh>
        {/* Luminous Cluster Screen */}
        <mesh position={[0, 0, 0.008]}>
          <planeGeometry args={[0.27, 0.125]} />
          <meshBasicMaterial map={clusterTex.tex} toneMapped={false} />
        </mesh>
      </group>

      {/* Display 2: Ultra-Wide Central Mission Touchscreen */}
      <group position={[0, 0.62, 0.46]} rotation={[-0.20, -0.06, 0]}>
        {/* Premium slim tablet housing */}
        <mesh material={consoleMat} castShadow>
          <boxGeometry args={[0.44, 0.23, 0.016]} />
        </mesh>
        {/* Metallic Bezel Rim */}
        <mesh position={[0, 0, -0.005]} material={chromeMat}>
          <boxGeometry args={[0.446, 0.236, 0.008]} />
        </mesh>
        {/* Glowing Touchscreen Glass Face */}
        <mesh position={[0, 0, 0.009]}>
          <planeGeometry args={[0.425, 0.215]} />
          <meshBasicMaterial map={centerTex.tex} toneMapped={false} />
        </mesh>
      </group>

      {/* Display 3: Passenger Auxiliary HUD Strip */}
      <group position={[SEAT_X, 0.66, 0.56]} rotation={[-0.14, 0, 0]}>
        <mesh material={consoleMat}>
          <boxGeometry args={[0.29, 0.08, 0.012]} />
        </mesh>
        <mesh position={[0, 0, 0.008]}>
          <planeGeometry args={[0.27, 0.068]} />
          <meshBasicMaterial map={passengerTex.tex} toneMapped={false} />
        </mesh>
      </group>

      {/* Display 4: Frameless Digital Rearview Mirror */}
      <group position={[0, 0.98, 0.42]}>
        {/* Overhead mirror mount swivel */}
        <mesh position={[0, 0.035, 0.01]} material={chromeMat}>
          <cylinderGeometry args={[0.006, 0.006, 0.06, 8]} />
        </mesh>
        {/* Mirror housing */}
        <mesh material={consoleMat}>
          <boxGeometry args={[0.20, 0.06, 0.012]} />
        </mesh>
        {/* Mirror display screen */}
        <mesh position={[0, 0, -0.007]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.188, 0.05]} />
          <meshBasicMaterial map={mirrorTex} toneMapped={false} />
        </mesh>
      </group>

      {/* ── 7. Windshield Glass & Structural A-Pillars ─────────────── */}
      {/* Slanted Panoramic Windshield Automotive Glass */}
      <mesh position={[0, 0.78, 0.50]} rotation={[-0.50, 0, 0]} material={glassMat}>
        <boxGeometry args={[0.96, 0.58, 0.014]} />
      </mesh>

      {/* Left A-Pillar */}
      <mesh position={[-0.51, 0.78, 0.50]} rotation={[-0.50, 0, 0.12]} material={dashMat}>
        <boxGeometry args={[0.045, 0.62, 0.045]} />
      </mesh>
      {/* Right A-Pillar */}
      <mesh position={[0.51, 0.78, 0.50]} rotation={[-0.50, 0, -0.12]} material={dashMat}>
        <boxGeometry args={[0.045, 0.62, 0.045]} />
      </mesh>

      {/* Top Windshield Header Beam */}
      <mesh position={[0, 1.02, 0.24]} material={dashMat}>
        <boxGeometry args={[0.98, 0.04, 0.06]} />
      </mesh>

      {/* Left and Right Interior Door Panels */}
      {([-0.54, 0.54] as const).map((dx) => (
        <group key={`door-${dx}`} position={[dx, 0.46, -0.05]}>
          <mesh material={dashMat}>
            <boxGeometry args={[0.035, 0.28, 0.96]} />
          </mesh>
          {/* Door Armrest */}
          <mesh position={[dx > 0 ? -0.025 : 0.025, 0.02, 0]} material={wheelLeatherMat}>
            <boxGeometry args={[0.04, 0.05, 0.38]} />
          </mesh>
          {/* Metallic Door Pull Handle */}
          <mesh position={[dx > 0 ? -0.025 : 0.025, 0.08, 0.14]} material={chromeMat}>
            <boxGeometry args={[0.02, 0.024, 0.08]} />
          </mesh>
        </group>
      ))}

      {/* ── 8. Seated Driver Avatar ───────────────────────────────── */}
      <group position={[-SEAT_X, SEAT_TOP_Y, SEAT_Z]}>
        <Driver agentName={car.agentName} modelName={car.modelName} cli={car.cli} />
      </group>
    </group>
  );
}
