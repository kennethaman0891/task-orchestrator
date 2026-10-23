// ═══════════════════════════════════════════════════════════════════════════
// JARVIS MANAGER (Phase 2 & Phase 4)
// Coordinates per-terminal Jarvis agent instances across the workstation.
// ═══════════════════════════════════════════════════════════════════════════

import { JarvisAgent } from './JarvisAgent';
import type { JarvisPermission, JarvisStatus } from '../types';
import { sessionContextStore } from '../contextStore';

type AgentUpdateListener = () => void;

const STORAGE_KEY = 'tto_jarvis_assignments_v1';

class JarvisManager {
  private agents: Map<string, JarvisAgent> = new Map();
  private listeners: Set<AgentUpdateListener> = new Set();
  private initialized = false;
  private activeCallTerminalIds: Set<string> = new Set();
  private focusedCallTerminalId: string | null = null;

  constructor() {
    // Listen to session context updates and sync active agents
    sessionContextStore.subscribe((contexts) => {
      if (!this.initialized) {
        this.loadFromStorage();
        this.initialized = true;
      }
      for (const [id, agent] of this.agents.entries()) {
        const ctx = contexts[id];
        if (ctx) agent.syncContext(ctx);
      }
      this.notify();
    });
  }

  subscribe(listener: AgentUpdateListener): () => void {
    this.listeners.add(listener);
    // Immediately emit current state
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  }

  getAgent(terminalId: string): JarvisAgent {
    if (!this.agents.has(terminalId)) {
      const ctx = sessionContextStore.get(terminalId);
      const agent = new JarvisAgent(terminalId, ctx);
      agent.onChange = () => {
        this.saveToStorage();
        this.notify();
      };
      this.agents.set(terminalId, agent);
    }
    return this.agents.get(terminalId)!;
  }

  assignAgent(terminalId: string, permissions?: JarvisPermission[]): JarvisAgent {
    const agent = this.getAgent(terminalId);
    const ctx = sessionContextStore.get(terminalId);
    agent.assign(permissions, ctx);
    this.saveToStorage();
    this.notify();
    return agent;
  }

  unassignAgent(terminalId: string): void {
    const agent = this.agents.get(terminalId);
    if (agent) {
      if (this.activeCallTerminalIds.has(terminalId)) {
        this.endCall(terminalId);
      }
      agent.unassign();
      this.saveToStorage();
      this.notify();
    }
  }

  /** Voice Call: Start an interactive call with a terminal's Jarvis agent without killing other active calls */
  startCall(terminalId: string): JarvisAgent {
    const agent = this.getAgent(terminalId);
    if (agent.status === 'UNASSIGNED') {
      const ctx = sessionContextStore.get(terminalId);
      agent.assign(['OBSERVE', 'READ'], ctx);
    }
    this.activeCallTerminalIds.add(terminalId);
    this.focusedCallTerminalId = terminalId;
    agent.startCall();
    this.saveToStorage();
    this.notify();
    return agent;
  }

  /** Voice Call: End a specific call or the currently focused call */
  endCall(terminalId?: string): void {
    const targetId = terminalId || this.focusedCallTerminalId;
    if (!targetId) return;

    const agent = this.agents.get(targetId);
    if (agent) {
      agent.endCall();
    }
    this.activeCallTerminalIds.delete(targetId);

    if (this.focusedCallTerminalId === targetId) {
      // Switch focus to another active call if one exists
      const remaining = Array.from(this.activeCallTerminalIds);
      this.focusedCallTerminalId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }

    this.saveToStorage();
    this.notify();
  }

  /** Voice Call: End all active voice calls */
  endAllCalls(): void {
    for (const tId of this.activeCallTerminalIds) {
      const agent = this.agents.get(tId);
      if (agent) {
        agent.endCall();
      }
    }
    this.activeCallTerminalIds.clear();
    this.focusedCallTerminalId = null;
    this.saveToStorage();
    this.notify();
  }

  /** Switch focused call to another terminal that is currently in an active call */
  switchCall(terminalId: string): void {
    if (this.activeCallTerminalIds.has(terminalId)) {
      this.focusedCallTerminalId = terminalId;
      this.notify();
    }
  }

  isCallActive(terminalId: string): boolean {
    return this.activeCallTerminalIds.has(terminalId);
  }

  getActiveCallTerminalIds(): string[] {
    return Array.from(this.activeCallTerminalIds);
  }

  getFocusedCallTerminalId(): string | null {
    return this.focusedCallTerminalId;
  }

  /** Backwards compatibility getter */
  getActiveCallTerminalId(): string | null {
    return this.focusedCallTerminalId;
  }

  getActiveCallAgent(): JarvisAgent | null {
    return this.focusedCallTerminalId ? this.getAgent(this.focusedCallTerminalId) : null;
  }

  async assignTask(terminalId: string, taskDescription: string): Promise<boolean> {
    const agent = this.getAgent(terminalId);
    const res = await agent.assignTask(taskDescription);
    this.saveToStorage();
    this.notify();
    return res;
  }

  getAllAgents(): JarvisAgent[] {
    return Array.from(this.agents.values());
  }

  getAssignedAgents(): JarvisAgent[] {
    return Array.from(this.agents.values()).filter((a) => a.status !== 'UNASSIGNED');
  }

  saveToStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const data: Record<string, { status: JarvisStatus; permissions: JarvisPermission[]; task?: string }> = {};
      for (const [id, agent] of this.agents.entries()) {
        if (agent.status !== 'UNASSIGNED') {
          data[id] = {
            status: agent.status,
            permissions: Array.from(agent.permissions),
            task: agent.workingMemory.task,
          };
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  loadFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      for (const id in data) {
        const item = data[id];
        const agent = this.getAgent(id);
        agent.status = item.status || 'UNASSIGNED';
        agent.permissions = new Set(item.permissions || ['OBSERVE', 'READ', 'EXECUTE', 'CONTROL']);
        if (item.task) agent.workingMemory.task = item.task;
      }
    } catch {}
  }

  private notify(): void {
    for (const l of this.listeners) {
      try { l(); } catch (e) { console.error('[JarvisManager] notify error:', e); }
    }
  }
}

export const jarvisManager = new JarvisManager();
