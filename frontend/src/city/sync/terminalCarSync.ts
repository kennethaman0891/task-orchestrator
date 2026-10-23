// Developer City — terminal cars. One car per filled workspace grid pane
// whose projectPath equals a registry project. idePanes are not cars.

import { useEffect, useRef } from 'react';
import type { Workspace } from '@/lib/workspace';
import type { TerminalEntry } from '@/types';
import type { Project, TerminalCar } from '@/city/types';
import { useCityStore } from '@/city/store';

export const PALETTE = [
  '#06b6d4',
  '#e11d48',
  '#f8fafc',
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#f97316',
  '#fbbf24',
] as const;

const CAR_COLORS_KEY = 'tto-city-car-colors';
const CAR_NAMES_KEY = 'tto-city-car-names';
const MAX_CARS_PER_WORKSPACE = 16;

/** pane.label, else session name, else pane title, else `Terminal N`. */
export function carDisplayName(
  pane: { label?: string },
  entry: { session_name?: string; pane_title?: string } | undefined,
  slotIndex: number,
): string {
  return pane.label || entry?.session_name || entry?.pane_title || `Terminal ${slotIndex + 1}`;
}

function readCarColors(): Record<string, string> {
  return readStringMap(CAR_COLORS_KEY);
}

function readStringMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist a pane's car color. The next sync reads `tto-city-car-colors`. */
export function saveCarColor(paneId: string, hex: string): void {
  const colors = readCarColors();
  colors[paneId] = hex;
  try {
    localStorage.setItem(CAR_COLORS_KEY, JSON.stringify(colors));
  } catch {
    /* quota or private mode */
  }
}

/** Prefer the project this workspace sync created when paths collide. */
function projectForWorkspace(workspace: Workspace, projects: Record<string, Project>): Project | null {
  const path = workspace.projectPath;
  if (!path) return null;
  let fallback: Project | null = null;
  for (const project of Object.values(projects)) {
    if (project.path !== path) continue;
    const deploy = project.deploy as Record<string, unknown> | null;
    if (deploy && deploy.workspace_id === workspace.id) return project;
    if (!fallback) fallback = project;
  }
  return fallback;
}

function mapCurrentTask(entry: TerminalEntry | undefined): TerminalCar['currentTask'] {
  const task = entry?.current_task;
  if (!task) return null;
  return {
    id: task.id,
    description: task.description,
    status: task.status,
    started_at: task.started_at ?? null,
  };
}

function mapHistory(entry: TerminalEntry | undefined): TerminalCar['history'] {
  return (entry?.history ?? []).slice(-8).map((task) => ({
    id: task.id,
    description: task.description,
    status: task.status,
    completed_at: task.completed_at ?? null,
  }));
}

function mapTerminalCars(
  workspaces: Workspace[],
  terminals: Record<string, TerminalEntry>,
  projects: Record<string, Project>,
): TerminalCar[] {
  const colors = readCarColors();
  const names = readStringMap(CAR_NAMES_KEY);
  const seen = new Set<string>();
  const cars: TerminalCar[] = [];

  for (const workspace of workspaces) {
    const project = projectForWorkspace(workspace, projects);
    if (!project) continue;

    const filled = (workspace.panes ?? [])
      .filter((pane) => !!pane.tty)
      .slice(0, MAX_CARS_PER_WORKSPACE);

    filled.forEach((pane, slotIndex) => {
      const tty = pane.tty;
      if (!tty || seen.has(pane.id)) return;
      seen.add(pane.id);
      const entry = terminals[tty];
      const paused = entry ? (entry as { paused?: boolean }).paused === true : false;
      cars.push({
        id: pane.id,
        terminalId: tty,
        workspaceId: workspace.id,
        projectId: project.id,
        projectPath: project.path,
        slotIndex,
        name: names[pane.id]?.trim() || carDisplayName(pane, entry, slotIndex),
        color: colors[pane.id] || PALETTE[slotIndex % PALETTE.length],
        live: entry?.is_live !== false,
        moving: !paused && (
          entry?.current_task?.status === 'running'
          || entry?.opencode_status?.state === 'working'
        ),
        agentName: entry?.agent?.trim() || '',
        modelName: entry?.opencode_model || entry?.model || entry?.tokens?.model || '',
        cli: (entry?.cli || entry?.agent || '').toLowerCase(),
        cwd: entry?.cwd || workspace.projectPath || project.path,
        currentTask: mapCurrentTask(entry),
        history: mapHistory(entry),
        queueCount: entry?.queue?.length || 0,
        nextTask: !!entry?.next_task,
        paused,
        // Orchestrator runs are not on TerminalEntry.
        batchDispatched: false,
        tokensInput: entry?.tokens?.tokens_input ?? 0,
        tokensOutput: entry?.tokens?.tokens_output ?? 0,
      });
    });
  }

  return cars;
}

export function useTerminalCarSync(
  workspaces: Workspace[],
  terminals: Record<string, TerminalEntry>,
): void {
  const projects = useCityStore((s) => s.projects);
  const prevKey = useRef('');

  useEffect(() => {
    const list = mapTerminalCars(workspaces, terminals, projects);
    const key = JSON.stringify(list);
    if (key === prevKey.current) return;
    prevKey.current = key;
    // setTerminalCars may be missing from the store type while it is wired up.
    (useCityStore.getState() as {
      setTerminalCars?: (list: TerminalCar[]) => void;
    }).setTerminalCars?.(list);
  }, [workspaces, terminals, projects]);
}
