// Developer City — workspace sync: keep the city in lockstep with the
// sidebar's workspace list.
//
//   • Every workspace with a projectPath gets a building (created once,
//     deduped by path). The workspace NAME becomes the building name and
//     the workspace COLOR becomes the building's primary/accent — the
//     logo sign shows the workspace name's initials on that color.
//   • The ACTIVE sidebar workspace is tracked in the city store so the
//     scene can badge + focus its building ("you are here").
// No hard-coded projects: everything derives from the workspace list.

import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '@/lib/workspace';
import { useCityStore } from '@/city/store';
import { createProject, patchProject } from '@/city/api';
import type { Project, ProjectType } from '@/city/types';

/** Guards against creating two buildings for the same path in one session. */
const creatingPaths = new Set<string>();
/** Guards against concurrent rename patches for the same project. */
const renamingIds = new Set<string>();
/** Paths whose create POST failed — retried every 6s until the sidecar answers. */
const failedPaths = new Set<string>();

/**
 * Generated logo: the workspace NAME on its color — this is the "city logo"
 * for a building that was auto-created from the sidebar. 256×256 PNG data
 * URL (persists fine in the JSON registry; the sign texture accepts data:).
 */
export function makeWorkspaceLogo(name: string, color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const bg = color || '#4f8ff7';
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, shade(bg, -36));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 236, 236);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = (name || 'Untitled').trim();
  // Single line, or split into two at a space near the middle when long.
  let lines: string[] = [label];
  ctx.font = 'bold 52px ui-sans-serif, system-ui, sans-serif';
  if (ctx.measureText(label).width > 208) {
    const mid = Math.ceil(label.length / 2);
    const cut = label.indexOf(' ', mid - 4);
    const at = cut > 0 ? cut : mid;
    lines = [label.slice(0, at).trim(), label.slice(at).trim()].filter(Boolean);
  }
  const widest = lines.reduce((a, b) => (b.length >= a.length ? b : a), lines[0] || label);
  let size = 52;
  ctx.font = `bold ${size}px ui-sans-serif, system-ui, sans-serif`;
  while (size > 20 && ctx.measureText(widest).width > 216) {
    size -= 4;
    ctx.font = `bold ${size}px ui-sans-serif, system-ui, sans-serif`;
  }
  const lh = lines.length > 1 ? size + 8 : 0;
  lines.forEach((line, i) => {
    ctx.fillText(line, 128, 128 - lh / 2 + i * lh, 224);
  });
  return canvas.toDataURL('image/png');
}

/** Lighten (-) / darken (+) a #rrggbb color by amt (0..~120). */
function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '');
  if (m.length < 6) return hex;
  const n = parseInt(m, 16);
  const f = (v: number, a: number) =>
    Math.max(0, Math.min(255, v + a)).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255, amt)}${f((n >> 8) & 255, amt)}${f(n & 255, amt)}`;
}

function syncMarker(rec: Project): string | null {
  const d = rec.deploy as Record<string, unknown> | null;
  return d && d.source === 'workspace-sync' && typeof d.workspace_id === 'string' ? d.workspace_id : null;
}

/** Guess a project type from the workspace/directory name (keyword rules). */
export function guessProjectType(name: string): ProjectType {
  const n = (name || '').toLowerCase();
  if (/(college|school|univ|learn|course|classroom|edu)/.test(n)) return 'college';
  if (/(shop|store|cart|checkout|ecom|commerce|product|catalog|market)/.test(n)) return 'ecommerce';
  if (/(portfolio|personal|resume|showcase|site)/.test(n)) return 'portfolio';
  if (/(saas|startup|api|platform|service|engine)/.test(n)) return 'saas';
  if (/(business|corp|office|admin|crm|erp|billing|invoice)/.test(n)) return 'business';
  return 'custom';
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() || '';
}

/**
 * Auto-provision buildings for the workspace list and track which one is
 * current. Runs in CityView; safe to run repeatedly (deduped by path).
 */
export function useWorkspaceSync(
  workspaces: Workspace[],
  activeWsId: string | null,
  onToast?: (msg: string, error?: boolean) => void,
) {
  const retryTick = useWorkspaceRetryTick();
  const loaded = useCityStore((s) => s.loaded);
  const projects = useCityStore((s) => s.projects);
  const upsertProject = useCityStore((s) => s.upsertProject);
  const setActiveWorkspacePath = useCityStore((s) => s.setActiveWorkspacePath);
  const [createdPaths, setCreatedPaths] = useState<string[]>([]);
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  // 1) Track the current workspace's path (badge + camera focus target).
  //    If the persisted active id is stale (workspace deleted), fall back to
  //    the first workspace — same convention the rest of the app uses
  //    (`activeWorkspace || workspaces[0]`).
  useEffect(() => {
    const active = workspaces.find((w) => w.id === activeWsId) || workspaces[0] || null;
    setActiveWorkspacePath(active?.projectPath?.trim() || null);
  }, [workspaces, activeWsId, setActiveWorkspacePath]);

  // 2) If a sidebar workspace is renamed, keep its building name + logo in
  //    sync (only for buildings this sync created — marked in deploy).
  useEffect(() => {
    if (!loaded) return;
    for (const ws of workspaces) {
      const nm = ws.name?.trim();
      if (!nm) continue;
      const rec = Object.values(projects).find(
        (pr) => syncMarker(pr) === ws.id && pr.name !== nm,
      );
      if (!rec || renamingIds.has(rec.id)) continue;
      renamingIds.add(rec.id);
      patchProject(rec.id, {
        name: nm,
        building: { logo: ws.logo || makeWorkspaceLogo(nm, ws.color) },
      })
        .then((updated) => upsertProject(updated))
        .catch(() => { /* sidecar down; next run retries */ })
        .finally(() => renamingIds.delete(rec.id));
    }
  }, [loaded, workspaces, projects, upsertProject]);

  // 3) Auto-create a building for every workspace that has a projectPath
  //    but no registry record yet (deduped by path — also across reloads).
  //    Failed creates are retried: if the sidecar comes up later, the city
  //    catches up automatically.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const known = new Set<string>();
    for (const p of Object.values(projects)) if (p.path) known.add(p.path);
    for (const c of createdPaths) known.add(c);

    for (const ws of workspaces) {
      const path = (ws.projectPath || '').trim();
      if (!path || known.has(path) || creatingPaths.has(path)) continue;
      const retry = failedPaths.has(path); // silent afterwards; first failure toasts
      creatingPaths.add(path);
      const name = ws.name?.trim() || baseName(path) || 'Untitled';
      createProject({
        name,
        path,
        type: guessProjectType(name),
        status: 'active',
        deploy: { source: 'workspace-sync', workspace_id: ws.id },
        building: {
          primaryColor: ws.color || null,
          accentColor: ws.color || null,
          logo: ws.logo || makeWorkspaceLogo(name, ws.color),
        },
      })
        .then((rec) => {
          if (cancelled) return;
          failedPaths.delete(path);
          upsertProject(rec);
          setCreatedPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
        })
        .catch((err) => {
          console.warn('[city] workspace building create failed for', path, err);
          failedPaths.add(path);
          if (!retry) toastRef.current?.(
            `Could not create a building for “${name}” (sidecar unavailable?) — retrying automatically`,
            true,
          );
          scheduleRetry();
        })
        .finally(() => {
          creatingPaths.delete(path);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [loaded, workspaces, projects, createdPaths, upsertProject, retryTick]);

  // 3.5) Logo sync: when the user uploads a favicon/logo to a sidebar
  //    workspace, mirror it onto that workspace's building (and fall back
  //    to the generated monogram when it is cleared). Idempotent: only
  //    patches when the stored logo actually differs.
  const logoSynced = useRef(new Map<string, string>()); // wsId -> last pushed logo key
  useEffect(() => {
    if (!loaded) return;
    for (const ws of workspaces) {
      const key = ws.logo ? 'img' : 'generated:' + (ws.name || '');
      if (logoSynced.current.get(ws.id) === key) continue;
      const rec = Object.values(projects).find((pr) => syncMarker(pr) === ws.id);
      if (!rec) continue; // not a sync building (or not created yet)
      const target = ws.logo || makeWorkspaceLogo(
        ws.name?.trim() || baseName(ws.projectPath || '') || 'Untitled', ws.color,
      );
      if (rec.building?.logo === target) {
        logoSynced.current.set(ws.id, key);
        continue;
      }
      logoSynced.current.set(ws.id, key);
      patchProject(rec.id, { building: { logo: target } })
        .then((updated) => upsertProject(updated))
        .catch(() => { logoSynced.current.delete(ws.id); });
    }
  }, [loaded, workspaces, projects, upsertProject]);

  // 4) Backfill: link buildings that exist WITHOUT the workspace-sync marker
  //    (created by an older app version, or made by hand via the modal).
  //    Applies the workspace's logo + colors + deploy marker so the rename
  //    sync and the "current workspace" badge work for pre-existing plots.
  //    The building NAME is left alone — it may be a deliberate user edit.
  const backfilledIds = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    for (const ws of workspaces) {
      const path = (ws.projectPath || '').trim();
      if (!path) continue;
      const rec = Object.values(projects).find((p) => p.path === path);
      if (!rec) continue;
      if (rec.deploy?.source === 'workspace-sync') continue;
      if (backfilledIds.current.has(rec.id)) continue;
      backfilledIds.current.add(rec.id);
      const name = ws.name?.trim() || baseName(path) || 'Untitled';
      patchProject(
        rec.id,
        {
          deploy: { source: 'workspace-sync', workspace_id: ws.id },
          building: {
            primaryColor: ws.color || null,
            accentColor: ws.color || null,
            logo: ws.logo || makeWorkspaceLogo(name, ws.color),
          },
        },
      )
        .then((next) => {
          if (!cancelled) upsertProject(next);
        })
        .catch(() => {
          backfilledIds.current.delete(rec.id);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [loaded, workspaces, projects, upsertProject]);

  return createdPaths;
}

/**
 * Bump a nonce when a create fails so the create-effect re-runs every 6s
 * until all failed paths succeed (sidecar may start later in the app's life).
 * Implemented as a tiny module timer that notifies subscribers.
 */
const retrySubs = new Set<() => void>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (failedPaths.size === 0) return;
    for (const fn of retrySubs) fn();
  }, 6000);
}

/** Re-render subscriber so the create-effect re-runs when a retry is due. */
export function useWorkspaceRetryTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    retrySubs.add(fn);
    return () => {
      retrySubs.delete(fn);
    };
  }, []);
  return tick;
}
