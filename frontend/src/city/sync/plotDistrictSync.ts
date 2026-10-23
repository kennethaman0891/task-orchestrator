// Developer City — folder districts for plot roads and temp-file animals.
// Lists each project root, plus the folder a terminal car is actually in.

import { useEffect, useRef } from 'react';
import { listFiles } from '@/lib/api';
import { useCityStore } from '@/city/store';
import { SKIP_DIRS } from '@/city/scene/roadLayout';

const REFRESH_MS = 20000;

export interface PlotDistrict {
  dirs: string[];
  files: { name: string }[];
}

function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Path under the project, or null when cwd is outside it. '' is the root. */
export function relativeToProject(projectPath: string, cwd: string): string | null {
  const base = norm(projectPath);
  const here = norm(cwd);
  if (!base || !here) return null;
  if (here === base) return '';
  const prefix = `${base}/`;
  if (!here.startsWith(prefix)) return null;
  return here.slice(prefix.length);
}

function isTemp(name: string): boolean {
  return name === '.DS_Store'
    || name.endsWith('.bak')
    || name.endsWith('.tmp')
    || name.endsWith('.swp')
    || name.endsWith('~');
}

async function listDir(path: string): Promise<{ dirs: string[]; temps: { name: string }[] } | null> {
  try {
    const res = await listFiles(path);
    const files = Array.isArray(res.files) ? res.files : [];
    return {
      dirs: files
        .filter((file) => file.is_dir && file.name && !SKIP_DIRS.includes(file.name))
        .map((file) => file.name),
      temps: files
        .filter((file) => !file.is_dir && isTemp(file.name))
        .map((file) => ({ name: file.name })),
    };
  } catch {
    return null;
  }
}

export function usePlotDistrictSync(): void {
  const projectKey = useCityStore((s) => s.projectOrder.map((id) => {
    const project = s.projects[id];
    return project?.path ? `${id}\n${project.path}` : '';
  }).join('\n'));
  const cwdKey = useCityStore((s) => Object.values(s.terminalCars)
    .map((car) => `${car.projectId}\n${car.cwd}`)
    .sort()
    .join('\n'));
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const { projects, projectOrder, terminalCars, plotDistricts } = useCityStore.getState();
      const next: Record<string, PlotDistrict> = {};
      await Promise.all(projectOrder.map(async (id) => {
        const project = projects[id];
        if (!project?.path) return;
        const root = await listDir(project.path);
        if (!root) {
          if (plotDistricts[id]) next[id] = plotDistricts[id];
          return;
        }
        const temps = new Map<string, { name: string }>();
        for (const file of root.temps) temps.set(file.name, file);

        const extras = new Set<string>();
        for (const car of Object.values(terminalCars)) {
          if (car.projectId !== id) continue;
          const rel = relativeToProject(project.path, car.cwd || '');
          if (!rel) continue;
          const child = rel.split('/').filter(Boolean)[0];
          if (!child || SKIP_DIRS.includes(child)) continue;
          extras.add(`${norm(project.path)}/${child}`);
        }
        await Promise.all([...extras].slice(0, 8).map(async (dir) => {
          const sub = await listDir(dir);
          if (!sub) return;
          for (const file of sub.temps) temps.set(`${dir}/${file.name}`, file);
        }));

        next[id] = { dirs: root.dirs, files: [...temps.values()] };
      }));
      if (!alive) return;
      useCityStore.getState().setPlotDistricts(next);
    };

    void load();
    timer.current = setInterval(() => { void load(); }, REFRESH_MS);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [projectKey, cwdKey]);
}
