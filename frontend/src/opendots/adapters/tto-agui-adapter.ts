import { EventEmitter } from 'events';
import type { 
  AGUIEvent, 
  ToolCall, 
  ToolCallResult, 
  StateDelta,
  MessageStart,
  MessageChunk,
  MessageEnd,
  ToolCallStart,
  ToolCallChunk,
  ToolCallEnd
} from '@ag-ui/core';
import type { TTOTerminalEvent, TTOJarvisEvent } from '../types/ag-ui';

export class TTOAGUIAdapter extends EventEmitter {
  private terminalSubscriptions = new Map<string, () => void>();
  private jarvisSubscription: (() => void) | null = null;

  /**
   * Start bridging TTO events to AG-UI events for a terminal
   */
  attachTerminal(terminalId: string, config: { 
    terminalManager: any; 
    jarvisManager: any; 
    sessionContextStore: any;
  }): void {
    const { terminalManager, jarvisManager, sessionContextStore } = config;

    // 1. Subscribe to terminal output from sessionContextStore
    const unsubscribeTerm = sessionContextStore.subscribe((contexts) => {
      const ctx = contexts[terminalId];
      if (ctx?.lastOutput) {
        const toolCallId = `term-${terminalId}-${Date.now()}`;
        // Store this tool call so we can track it
        this.emit('agui-event', {
          type: 'TOOL_CALL_START',
          toolCallId,
          toolCall: {
            name: 'terminal_command',
            args: { 
              command: ctx.lastCommand || '',
              workspaceId: ctx.workspaceId,
              label: ctx.terminalName
            }
          }
        } as ToolCallStart);

        this.emit('agui-event', {
          type: 'TOOL_CALL_END',
          toolCallId,
          result: { 
            output: ctx.lastOutput,
            type: 'terminal',
            isTerminal: true
          }
        } as ToolCallEnd);
      }
    });

    // 2. Subscribe to Jarvis agent updates
    const unsubscribeJarvis = jarvisManager.subscribe(() => {
      const agent = jarvisManager.getAgent(terminalId);
      if (!agent) return;

      // Emit state deltas for Jarvis agent status
      const deltas: StateDelta[] = [];

      // Status change
      if (agent.status !== this._lastStatus?.[terminalId]) {
        deltas.push({
          op: 'replace',
          path: `/agent/${terminalId}/status`,
          value: agent.status
        });
        this._lastStatus = this._lastStatus || {};
        this._lastStatus[terminalId] = agent.status;
      }

      // Task change
      if (agent.workingMemory?.task !== this._lastTask?.[terminalId]) {
        deltas.push({
          op: 'replace',
          path: `/agent/${terminalId}/task`,
          value: agent.workingMemory.task || null
        });
        this._lastTask = this._lastTask || {};
        this._lastTask[terminalId] = agent.workingMemory.task || null;
      }

      // Last action
      if (agent.lastAction !== this._lastAction?.[terminalId]) {
        deltas.push({
          op: 'replace',
          path: `/agent/${terminalId}/lastAction`,
          value: agent.lastAction
        });
        this._lastAction = this._lastAction || {};
        this._lastAction[terminalId] = agent.lastAction;
      }

      if (deltas.length > 0) {
        this.emit('agui-event', {
          type: 'STATE_DELTA',
          delta: deltas
        } as StateDelta);
      }
    });

    this.terminalSubscriptions.set(terminalId, () => {
      unsubscribeTerm();
      unsubscribeJarvis();
    });
  }

  /**
   * Send user message to Jarvis agent via adapter
   */
  async sendMessage(terminalId: string, message: string, config: { 
    jarvisManager: any; 
  }): Promise<void> {
    const { jarvisManager } = config;
    const agent = jarvisManager.getAgent(terminalId);
    if (!agent) {
      throw new Error(`No agent found for terminal ${terminalId}`);
    }

    // If agent is UNASSIGNED, assign default capabilities
    if (agent.status === 'UNASSIGNED') {
      // Assign basic developer capabilities
      await jarvisManager.assignTask(terminalId, [
        'OBSERVE', 
        'READ', 
        'EXECUTE', 
        'CONTROL',
        'WRITE'
      ]);
    }

    // Send the message as a task to the agent
    await jarvisManager.assignTask(terminalId, message);
  }

  /**
   * Execute tool call from AG-UI (for approval flow)
   * This forwards to TTO's Jarvis agent to execute the command
   */
  async executeToolCall(toolCall: ToolCall, config: { 
    jarvisManager: any; 
  }): Promise<void> {
    const { jarvisManager } = config;
    const terminalId = toolCall.args?.terminalId || toolCall.args?.workspaceId;
    if (!terminalId) {
      console.warn('No terminalId in toolCall args:', toolCall);
      return;
    }

    const agent = jarvisManager.getAgent(terminalId);
    if (!agent) {
      throw new Error(`No agent found for terminal ${terminalId}`);
    }

    // Handle different tool types
    switch (toolCall.name) {
      case 'execute_command':
      case 'terminal_command':
        if (toolCall.args?.command) {
          await agent.executeCommand(toolCall.args.command);
        }
        break;

      case 'send_input':
        if (toolCall.args?.input) {
          await agent.sendInput(toolCall.args.input);
        }
        break;

      case 'read_file':
        if (toolCall.args?.path) {
          await agent.readFile(toolCall.args.path);
        }
        break;

      case 'write_file':
        if (toolCall.args?.path && toolCall.args?.contents !== undefined) {
          await agent.writeFile(toolCall.args.path, toolCall.args.contents);
        }
        break;

      case 'list_files':
        if (toolCall.args?.path) {
          await agent.listFiles(toolCall.args.path);
        }
        break;

      default:
        console.warn(`Unknown tool call: ${toolCall.name}`, toolCall);
    }
  }

  // Track last known values to avoid duplicate emissions
  private _lastStatus: Record<string, any> = {};
  private _lastTask: Record<string, string | null> = {};
  private _lastAction: Record<string, string> = {};

  /**
   * Detach from a terminal (cleanup subscriptions)
   */
  detachTerminal(terminalId: string): void {
    const unsub = this.terminalSubscriptions.get(terminalId);
    if (unsub) unsub();
    this.terminalSubscriptions.delete(terminalId);
    
    // Cleanup tracking
    delete this._lastStatus[terminalId];
    delete this._lastTask[terminalId];
    delete this._lastAction[terminalId];
  }

  /**
   * Detach from all terminals
   */
  detachAll(): void {
    for (const [id, unsub] of this.terminalSubscriptions) {
      unsub();
    }
    this.terminalSubscriptions.clear();
    
    this._lastStatus = {};
    this._lastTask = {};
    this._lastAction = {};
  }
}

// Singleton instance
export const ttoAGUIAdapter = new TTOAGUIAdapter();
