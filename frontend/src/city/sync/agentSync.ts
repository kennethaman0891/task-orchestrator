// Developer City — agent sync: map REAL terminal/agent state into the
// AgentBot records the 3D scene renders. Source of truth:
//   sidecar TerminalEntry (process-scan: which CLI is live, opencode_status,
//   current task, model) × project registry (which cwd belongs to which
//   building). Nothing here is invented.

import { useEffect, useMemo } from 'react';
import type { TerminalEntry } from '@/types';
import type { AgentBot, Project } from '@/city/types';
import { useCityStore } from '@/city/store';

const AGENT_CLIS = ['claude', 'opencode', 'codex', 'cursor', 'gemini', 'qwen', 'antigravity', 'agy', 'prime'];

/** Guess which interior room this task belongs to, from task/file text. */
function guessRoom(text: string, floors?: (string | { name: string; rooms?: string[] })[] | null): string | null {
  if (!text || !Array.isArray(floors)) return null;
  const t = text.toLowerCase();
  const patterns: Array<[RegExp, string]> = [
    [/react|vue|html|css|tsx|jsx|frontend|component|ui|vite|next|svelte/i, 'Frontend'],
    [/api|server|route|endpoint|backend|express|django|flask|fastapi|controller/i, 'Backend'],
    [/cms|wordpress|content|page editor|shopify/i, 'CMS'],
    [/database|sql|postgres|prisma|schema|migration|drizzle|sqlite/i, 'Database'],
    [/seo|search console|sitemap|meta tag/i, 'SEO'],
    [/deploy|netlify|vercel|docker|gh-pages|release|publish/i, 'Deployment'],
    [/test|spec|pytest|vitest|jest|coverage/i, 'Testing'],
    [/k8s|kubernetes|terraform|cloud|infra|serverless|cron|monitor/i, 'Infrastructure'],
    [/ai |agent|llm|prompt|model|opencode|claude/i, 'AI Agents'],
    [/product|catalog|inventory/i, 'Products'],
    [/order|cart|checkout/i, 'Orders'],
    [/payment|stripe|invoice/i, 'Payments'],
    [/shop|storefront|store front/i, 'Storefront'],
    [/maintenance|fix|bug|hotfix|patch/i, 'Maintenance'],
    [/about|bio|portfolio/i, 'About'],
    [/work|case stud/i, 'Work'],
  ];
  const floorList = Array.isArray(floors) ? floors : [];
  const floorNames: string[] = floorList.map((f) => (typeof f === 'string' ? f : f?.name || ''));
  const roomNames = floorList.flatMap((f) => (typeof f === 'string' ? [f] : [...(f?.rooms ?? []), f?.name || '']));
  const candidates: string[] = [];
  for (const [re, label] of patterns) {
    if (re.test(t)) candidates.push(label);
  }
  for (const c of candidates) {
    if (roomNames.includes(c) || floorNames.includes(c)) return c;
  }
  return candidates[0] ?? null;
}

export function botStatusFor(entry: TerminalEntry, agentCli: boolean): AgentBot['status'] {
  if (!entry.is_live) {
    // not running: only keep offline bots for a session that still has tasks
    return entry.current_task?.status === 'done' ? 'completed' : 'offline';
  }
  const oc = entry.opencode_status;
  if (oc) {
    if (oc.state === 'working') return entry.current_task ? 'thinking' : 'working';
    if (oc.state === 'waiting') return 'waiting';
    // opencode off but terminal live: fall through
  }
  if (entry.current_task) {
    if (entry.current_task.status === 'running') return 'working';
    if (entry.current_task.status === 'done') return 'completed';
    if (entry.current_task.status === 'blocked') return 'waiting';
  }
  return agentCli ? 'idle' : 'offline';
}

export function mapTerminalsToBots(
  terminals: Record<string, TerminalEntry>,
  projects: Project[],
): AgentBot[] {
  const bots: AgentBot[] = [];
  for (const [key, entry] of Object.entries(terminals)) {
    const cli = (entry.cli || entry.agent || '').toLowerCase();
    const isAgent = AGENT_CLIS.some((a) => cli.includes(a));
    const status = botStatusFor(entry, isAgent);
    if (status === 'offline') continue; // offline sessions don't get bots

    // Which building? Match cwd against registry paths.
    const cwd = entry.cwd || '';
    const project = projects.find((p) => {
      if (!p.path) return false;
      return cwd === p.path || cwd.startsWith(p.path + '/') || p.path.startsWith(cwd);
    });
    if (!project) continue; // session not tied to a registered project

    const taskText = [
      entry.current_task?.description ?? '',
      entry.current_task?.context ?? '',
      entry.session_context ?? '',
    ].join(' ');
    const room = guessRoom(taskText, project.floors);

    bots.push({
      id: `bot-${key}`,
      name: entry.agent || entry.cli || 'agent',
      model: entry.opencode_model || entry.model || entry.tokens?.model || '',
      sessionId: key,
      terminalId: key,
      projectPath: project.path,
      status,
      currentTask: entry.current_task?.description || entry.suggested_task || '',
      room,
      progress: entry.current_task?.status === 'done' ? 1 : entry.current_task ? 0.5 : 0,
      tools: [entry.cli || ''].filter(Boolean),
      recentActions: (entry.history || [])
        .slice(-3)
        .map((h) => h.description || h.summary)
        .filter(Boolean),
    });
  }
  return bots;
}

/**
 * Subscribe the city's agent store to live terminal data.
 * `terminals` refreshes every sidecar broadcast (≈3 s) — bots follow.
 */
export function useAgentSync(terminals: Record<string, TerminalEntry>) {
  const projects = useCityStore((s) => s.projects);
  const projectOrder = useCityStore((s) => s.projectOrder);
  const setAgents = useCityStore((s) => s.setAgents);

  const bots = useMemo(
    () => mapTerminalsToBots(terminals, projectOrder.map((id) => projects[id]).filter(Boolean)),
    [terminals, projects, projectOrder],
  );

  useEffect(() => {
    setAgents(bots);
  }, [bots, setAgents]);

  return bots;
}
