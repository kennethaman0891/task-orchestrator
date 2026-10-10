// ═══════════════════════════════════════════════════════════════════════════
// JARVIS ACTIVITY EVENT BUS (Phase 1)
// Central extensible event bus for terminal activity & agent events.
// ═══════════════════════════════════════════════════════════════════════════

import type { ActivityEvent, ActivityEventType } from './types';

type EventListener = (event: ActivityEvent) => void;

class TerminalActivityEventBus {
  private listeners: Map<ActivityEventType | '*', Set<EventListener>> = new Map();
  private history: ActivityEvent[] = [];
  private maxHistory = 300;

  subscribe(type: ActivityEventType | '*', listener: EventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);

    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  emit(type: ActivityEventType, terminalId: string, title: string, description?: string, metadata?: Record<string, unknown>): ActivityEvent {
    const event: ActivityEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      terminalId,
      timestamp: Date.now(),
      title,
      description,
      metadata,
    };

    this.history.unshift(event);
    if (this.history.length > this.maxHistory) {
      this.history.length = this.maxHistory;
    }

    // Notify type-specific listeners
    const specific = this.listeners.get(type);
    if (specific) {
      for (const fn of specific) {
        try { fn(event); } catch (e) { console.error('[EventBus] listener error:', e); }
      }
    }

    // Notify wildcard listeners
    const wildcards = this.listeners.get('*');
    if (wildcards) {
      for (const fn of wildcards) {
        try { fn(event); } catch (e) { console.error('[EventBus] wildcard listener error:', e); }
      }
    }

    return event;
  }

  getHistory(terminalId?: string, limit = 50): ActivityEvent[] {
    if (!terminalId) return this.history.slice(0, limit);
    return this.history.filter((e) => e.terminalId === terminalId).slice(0, limit);
  }

  clear(): void {
    this.history = [];
  }
}

export const eventBus = new TerminalActivityEventBus();
