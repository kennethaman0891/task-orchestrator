# OpenDots Integration Plan for Task Orchestrator Dashboard

## Executive Summary
Integrate **OpenDots** (CopilotKit's AI agent workspace template) into Task Orchestrator's Dashboard tab to provide a rich, visual terminal/agent workspace with:
- **ComputerPanel**: Live view of agent activity (browser, terminal, files)
- **Chat Interface**: AG-UI powered conversation with specialist agents
- **Space/Page System**: Document workspace for agent outputs
- **Slack/Voice Integration**: Multi-channel agent communication

**Target**: Replace/enhance the current DashboardView terminal grid with OpenDots components while preserving Task Orchestrator's existing terminal infrastructure (xterm.js, Tauri PTY, Jarvis agents).

---

## Architecture Overview

### Current Task Orchestrator Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│  Task Orchestrator App (React 19 + Tauri)                                     │
│  ├─ DashboardView: Terminal cards grid (xterm.js anchors)       │
│  ├─ WorkspaceView: Terminal tabs + chat panel                   │
│  ├─ TerminalManager: xterm.js pool + Tauri PTY write/resize     │
│  ├─ JarvisManager/JarvisAgent: Per-terminal AI agents           │
│  └─ Sidecar (Python): Terminal spawning, command relay, API     │
└─────────────────────────────────────────────────────────────────┘
```

### OpenDots Architecture (Components to Integrate)
```
┌─────────────────────────────────────────────────────────────────┐
│  OpenDots Client (React + AG-UI)                                │
│  ├─ ComputerPanel: Live agent computer view (browser/term/files)│
│  ├─ Chat: AG-UI streaming chat with tool cards                  │
│  ├─ Space/Page: Document workspace                              │
│  ├─ Dots: Specialist agent configs                              │
│  └─ AG-UI Client: Protocol for agent ↔ UI communication         │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼ AG-UI Protocol
┌─────────────────────────────────────────────────────────────────┐
│  OpenDots Server (Hono + TanStack AI + CopilotKit Runtime)      │
│  ├─ AG-UI Runtime: Streams messages, tool calls, state          │
│  ├─ Intelligence: Thread persistence                             │
│  ├─ Computer Service (OpenBot): Browser/terminal/files          │
│  └─ MCP Connections: External tools                             │
└─────────────────────────────────────────────────────────────────┘
```

### Integration Strategy: **Adapter Pattern**
We **do not** run OpenDots server. Instead, we:
1. **Use OpenDots React components directly** in Task Orchestrator's DashboardView
2. **Build an AG-UI adapter** that translates Task Orchestrator's terminal/Jarvis events → AG-UI events
3. **Keep Task Orchestrator's TerminalManager + Sidecar** as the terminal backend
4. **Map Jarvis agents → OpenDots "Dots"** for chat/computer visualization

---

## Phase 1: Foundation & Dependencies (Week 1)

### 1.1 Install Required Dependencies
```bash
cd /Users/kennethaman/tto-golden/frontend
npm install @ag-ui/client @ag-ui/core @copilotkit/react-core @copilotkit/runtime @copilotkit/core @tanstack/ai @tanstack/ai-openai rxjs zod lucide-react @tiptap/react @tiptap/starter-kit @tiptap/extension-table @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/markdown remark-gfm react-markdown
```

### 1.2 Copy OpenDots Components (Selective)
Copy only needed components to `frontend/src/opendots/`:
```
frontend/src/opendots/
├── components/
│   ├── ComputerPanel.tsx          # Main terminal/agent visualization
│   ├── ComputerToolCard.tsx       # Individual tool call cards
│   ├── Chat.tsx                   # AG-UI chat interface
│   ├── ChatTranscript.tsx         # Message rendering
│   ├── ResultPane.tsx             # Tool results display
│   ├── TaskPresentation.tsx       # Task status display
│   ├── TaskActions.tsx            # Task control buttons
│   ├── Mascot.tsx                 # Agent avatar/status
│   ├── ConnectionActionCard.tsx   # Tool approval cards
│   ├── ConnectionsSection.tsx     # Tool connections UI
│   ├── useVoice.ts                # Voice hook (optional)
│   └── theme.ts                   # Theme integration
├── types/
│   └── ag-ui.ts                   # AG-UI type definitions
├── adapters/
│   └── tto-agui-adapter.ts        # Task Orchestrator ↔ AG-UI bridge
└── styles/
    └── opendots.css               # Scoped styles
```

### 1.3 Create AG-UI Type Definitions
**File:** `frontend/src/opendots/types/ag-ui.ts`
```typescript
// Re-export AG-UI core types + add Task Orchestrator-specific extensions
export * from '@ag-ui/core';

// Task Orchestrator-specific event types
export interface Task OrchestratorTerminalEvent {
  type: 'terminal_output' | 'terminal_resize' | 'terminal_exit';
  terminalId: string;
  data: string;  // For output
  cols?: number;
  rows?: number;
}

export interface Task OrchestratorJarvisEvent {
  type: 'jarvis_status' | 'jarvis_task' | 'jarvis_action' | 'jarvis_approval';
  terminalId: string;
  agentStatus: 'UNASSIGNED' | 'OBSERVING' | 'WORKING' | 'WAITING' | 'ERROR' | 'NEEDS_APPROVAL';
  task?: string;
  action?: string;
  approvalId?: string;
}
```

---

## Phase 2: Task Orchestrator ↔ AG-UI Adapter (Week 1-2)

### 2.1 Build the Adapter
**File:** `frontend/src/opendots/adapters/tto-agui-adapter.ts`

```typescript
import { EventEmitter } from 'events';
import { TerminalManager } from '@/terminal/TerminalManager';
import { jarvisManager } from '@/jarvis/agent/JarvisManager';
import { sessionContextStore } from '@/jarvis/contextStore';
import type { 
  AGUIEvent, 
  ToolCall, 
  ToolCallResult, 
  Message,
  RunAgentInput 
} from '@ag-ui/core';
import type { Task OrchestratorTerminalEvent, Task OrchestratorJarvisEvent } from '../types/ag-ui';

export class Task OrchestratorAGUIAdapter extends EventEmitter {
  private terminalSubscriptions = new Map<string, () => void>();
  private jarvisSubscription: (() => void) | null = null;

  /**
   * Start bridging Task Orchestrator events to AG-UI events for a terminal
   */
  attachTerminal(terminalId: string): void {
    // 1. Subscribe to terminal output
    const unsubscribeTerm = sessionContextStore.subscribe((contexts) => {
      const ctx = contexts[terminalId];
      if (ctx?.lastOutput) {
        this.emit('agui-event', {
          type: 'TOOL_CALL_RESULT',
          toolCallId: `term-${terminalId}-${Date.now()}`,
          result: { output: ctx.lastOutput, type: 'terminal' }
        } as ToolCallResult);
      }
    });

    // 2. Subscribe to Jarvis agent updates
    const unsubscribeJarvis = jarvisManager.subscribe(() => {
      const agent = jarvisManager.getAgent(terminalId);
      this.emit('agui-event', {
        type: 'STATE_DELTA',
        delta: [{
          op: 'replace',
          path: '/agent/status',
          value: agent.status
        }, {
          op: 'replace',
          path: '/agent/task',
          value: agent.workingMemory.task
        }, {
          op: 'replace',
          path: '/agent/lastAction',
          value: agent.lastAction
        }]
      } as AGUIEvent);
    });

    this.terminalSubscriptions.set(terminalId, () => {
      unsubscribeTerm();
      unsubscribeJarvis();
    });
  }

  /**
   * Send user message to Jarvis agent
   */
  async sendMessage(terminalId: string, message: string): Promise<void> {
    const agent = jarvisManager.getAgent(terminalId);
    if (agent.status === 'UNASSIGNED') {
      agent.assign(['OBSERVE', 'READ', 'EXECUTE', 'CONTROL']);
    }
    await jarvisManager.assignTask(terminalId, message);
  }

  /**
   * Execute tool call from AG-UI (approval flow)
   */
  async executeToolCall(toolCall: ToolCall): Promise<void> {
    const terminalId = toolCall.args?.terminalId;
    if (!terminalId) return;

    const agent = jarvisManager.getAgent(terminalId);
    if (toolCall.name === 'execute_command') {
      await agent.executeCommand(toolCall.args.command);
    } else if (toolCall.name === 'send_input') {
      await agent.sendInput(toolCall.args.input);
    }
  }

  detachTerminal(terminalId: string): void {
    const unsub = this.terminalSubscriptions.get(terminalId);
    if (unsub) unsub();
    this.terminalSubscriptions.delete(terminalId);
  }

  detachAll(): void {
    for (const [id, unsub] of this.terminalSubscriptions) {
      unsub();
    }
    this.terminalSubscriptions.clear();
    if (this.jarvisSubscription) {
      this.jarvisSubscription();
      this.jarvisSubscription = null;
    }
  }
}

// Singleton
export const ttoAGUIAdapter = new Task OrchestratorAGUIAdapter();
```

### 2.2 AG-UI Event Hook for React Components
**File:** `frontend/src/opendots/hooks/useAGUI.ts`

```typescript
import { useEffect, useState, useCallback } from 'react';
import { ttoAGUIAdapter } from '../adapters/tto-agui-adapter';
import type { AGUIEvent, Message, ToolCall } from '@ag-ui/core';

export function useAGUI(terminalId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [agentState, setAgentState] = useState<any>({});
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!terminalId) return;
    
    ttoAGUIAdapter.attachTerminal(terminalId);
    setIsConnected(true);

    const handleEvent = (event: AGUIEvent) => {
      switch (event.type) {
        case 'MESSAGE_START':
        case 'MESSAGE_CHUNK':
        case 'MESSAGE_END':
          setMessages(prev => updateMessage(prev, event));
          break;
        case 'TOOL_CALL_START':
        case 'TOOL_CALL_CHUNK':
        case 'TOOL_CALL_END':
          setToolCalls(prev => updateToolCall(prev, event));
          break;
        case 'STATE_DELTA':
          setAgentState(prev => applyDelta(prev, event.delta));
          break;
      }
    };

    ttoAGUIAdapter.on('agui-event', handleEvent);
    return () => {
      ttoAGUIAdapter.detachTerminal(terminalId);
      ttoAGUIAdapter.off('agui-event', handleEvent);
      setIsConnected(false);
    };
  }, [terminalId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!terminalId) return;
    await ttoAGUIAdapter.sendMessage(terminalId, text);
  }, [terminalId]);

  const approveToolCall = useCallback(async (toolCallId: string, approved: boolean) => {
    // Handle approval flow
  }, []);

  return { messages, toolCalls, agentState, isConnected, sendMessage, approveToolCall };
}
```

---

## Phase 3: DashboardView Integration (Week 2)

### 3.1 Create OpenDots Dashboard Wrapper
**File:** `frontend/src/views/dashboard/OpenDotsDashboard.tsx`

```tsx
import { useState, useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { ComputerPanel } from '@/opendots/components/ComputerPanel';
import { Chat } from '@/opendots/components/Chat';
import { SpaceNav } from '@/opendots/components/SpaceNav';
import { useAGUI } from '@/opendots/hooks/useAGUI';
import { ttoAGUIAdapter } from '@/opendots/adapters/tto-agui-adapter';

interface Props {
  terminals: Record<string, UnifiedTerminal>;
  focusedTerminal: string | null;
  onSelectTerminal: (id: string | null) => void;
  workspaces: Workspace[];
  activeWorkspace?: Workspace;
}

export function OpenDotsDashboard({ terminals, focusedTerminal, onSelectTerminal, workspaces, activeWorkspace }: Props) {
  const { theme: t } = useTheme();
  
  // Terminal selection
  const [selectedTerminalId, setSelectedTerminalId] = useState(focusedTerminal);
  const [viewMode, setViewMode] = useState<'grid' | 'computer' | 'chat'>('computer');
  const [showChat, setShowChat] = useState(true);
  
  // AG-UI connection for selected terminal
  const agui = useAGUI(selectedTerminalId);

  // Sync with Task Orchestrator focus
  useEffect(() => {
    if (focusedTerminal && focusedTerminal !== selectedTerminalId) {
      setSelectedTerminalId(focusedTerminal);
    }
  }, [focusedTerminal]);

  // Terminal list for navigation
  const terminalList = useMemo(() => 
    Object.entries(terminals).map(([id, term]) => ({
      id,
      name: term.label || id,
      workspace: term.workspaceId,
      isActive: id === selectedTerminalId,
      hasAgent: !!jarvisManager.getAgent(id).status !== 'UNASSIGNED'
    })), [terminals]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.colors.bg.primary }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: `1px solid ${t.colors.border.subtle}`,
        background: t.colors.bg.secondary, gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {['grid', 'computer', 'chat'].map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{ 
                  ...buttonBase(t), ...buttonSize(t, 'sm'),
                  ...buttonVariant(t, viewMode === mode ? 'primary' : 'ghost'),
                  borderRadius: t.borderRadius.full, padding: '0 12px', height: 28
                }}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          
          {/* Terminal Selector */}
          <select
            value={selectedTerminalId || ''}
            onChange={(e) => { const id = e.target.value; setSelectedTerminalId(id); onSelectTerminal(id); }}
            style={{ ...inputBase(t), width: 280, height: 28, fontSize: 12 }}
          >
            <option value="">Select Terminal</option>
            {terminalList.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} {t.hasAgent ? '🤖' : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={showChat} onChange={e => setShowChat(e.target.checked)} />
            Chat Panel
          </label>
          <span style={{ color: agui.isConnected ? '#22c55e' : t.colors.text.muted, fontSize: 11 }}>
            {agui.isConnected ? '● Connected' : '○ Disconnected'}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Terminal/Computer View */}
        <div style={{ 
          flex: showChat ? 0.7 : 1, 
          display: 'flex', flexDirection: 'column',
          minWidth: 0, background: t.colors.bg.secondary
        }}>
          {viewMode === 'computer' && selectedTerminalId && (
            <ComputerPanel
              terminalId={selectedTerminalId}
              agentState={agui.agentState}
              toolCalls={agui.toolCalls}
              onToolCall={(call) => ttoAGUIAdapter.executeToolCall(call)}
              theme={t}
            />
          )}
          
          {viewMode === 'grid' && (
            <TerminalGridView terminals={terminals} onSelect={setSelectedTerminalId} />
          )}
          
          {viewMode === 'chat' && (
            <Chat 
              messages={agui.messages}
              onSend={agui.sendMessage}
              toolCalls={agui.toolCalls}
              onApprove={agui.approveToolCall}
              agentState={agui.agentState}
            />
          )}
        </div>

        {/* Right: Chat Panel */}
        {showChat && selectedTerminalId && (
          <div style={{ 
            width: '30%', minWidth: 320, maxWidth: 480,
            borderLeft: `1px solid ${t.colors.border.subtle}`,
            background: t.colors.bg.primary,
            display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ padding: 12, borderBottom: `1px solid ${t.colors.border.subtle}` }}>
              <Chat 
                messages={agui.messages}
                onSend={agui.sendMessage}
                toolCalls={agui.toolCalls}
                onApprove={agui.approveToolCall}
                agentState={agui.agentState}
                compact={true}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 3.2 Integrate into Existing DashboardView
**File:** `frontend/src/views/dashboard/DashboardView.tsx`

Add import and render option:
```tsx
import { OpenDotsDashboard } from './OpenDotsDashboard';

// Add view mode toggle in header
const [dashboardMode, setDashboardMode] = useState<'classic' | 'opendots'>('classic');

// In render:
{dashboardMode === 'opendots' ? (
  <OpenDotsDashboard 
    terminals={terminals} 
    focusedTerminal={focusedTerminal}
    onSelectTerminal={onSelectTerminal}
    workspaces={workspaces}
    activeWorkspace={activeWorkspace}
  />
) : (
  // Existing classic terminal grid...
)}
```

---

## Phase 4: ComputerPanel Adaptation (Week 2-3)

### 4.1 Adapt ComputerPanel for Task Orchestrator Terminals
The OpenDots `ComputerPanel` expects OpenBot computer events. We need to adapt it to show Task Orchestrator terminal output.

**Key modifications to `ComputerPanel.tsx`:**
1. Replace OpenBot event listeners with Task Orchestrator terminal events
2. Map `TerminalManager` output → `ComputerToolCard` with type 'terminal'
3. Add xterm.js embed option (iframe or canvas) for live terminal view
4. Show Jarvis agent status as "Dot" in header

```tsx
// In ComputerPanel.tsx - replace OpenBot subscription
useEffect(() => {
  if (!terminalId) return;
  
  // Subscribe to Task Orchestrator terminal output
  const unsub = sessionContextStore.subscribe((contexts) => {
    const ctx = contexts[terminalId];
    if (ctx) {
      // Convert to AG-UI tool call format for ComputerToolCard
      setToolCalls(prev => [...prev, {
        id: `term-${terminalId}-${Date.now()}`,
        name: 'terminal_output',
        args: { output: ctx.currentOutput },
        state: 'completed',
        result: { output: ctx.currentOutput }
      }]);
    }
  });
  
  return unsub;
}, [terminalId]);
```

### 4.2 Add Live xterm.js Embed
Add a "Live Terminal" tab in ComputerPanel that embeds the actual xterm.js instance:
```tsx
// Use TerminalManager to get the xterm instance and render in a tab
import { TerminalAnchor } from '@/terminal/TerminalAnchor';

<TabPanel key="live">
  <TerminalAnchor sessionId={terminalId} />
</TabPanel>
```

---

## Phase 5: Jarvis Agent → Dot Mapping (Week 3)

### 5.1 Create Dot Configurations from Jarvis Agents
**File:** `frontend/src/opendots/adapters/jarvis-to-dots.ts`

```typescript
import { jarvisManager } from '@/jarvis/agent/JarvisManager';
import { sessionContextStore } from '@/jarvis/contextStore';

export interface DotConfig {
  id: string;
  name: string;
  role: string;
  instructions: string;
  tools: string[];
  terminalId: string;
}

export function getDotsFromJarvis(): DotConfig[] {
  const agents = jarvisManager.getAssignedAgents();
  return agents.map(agent => {
    const ctx = sessionContextStore.get(agent.terminalId);
    return {
      id: `dot-${agent.terminalId}`,
      name: ctx?.terminalName || agent.terminalId,
      role: 'Developer',
      instructions: `You are Jarvis, an AI developer agent assigned to terminal ${ctx?.terminalName}. You have access to the terminal via execute_command and send_input tools. Current project: ${ctx?.cwd?.split('/').pop() || 'unknown'}. CLI: ${ctx?.detectedCli || 'shell'}.`,
      tools: ['execute_command', 'send_input', 'read_file', 'write_file', 'list_files'],
      terminalId: agent.terminalId
    };
  });
}
```

### 5.2 Integrate with OpenDots Chat
Pass dot configs to Chat component for specialist selection.

---

## Phase 6: Styling & Polish (Week 3-4)

### 6.1 Theme Integration
**File:** `frontend/src/opendots/styles/opendots.css`
```css
/* Scope OpenDots styles to avoid conflicts */
.opendots-container {
  --opendots-bg: var(--tto-bg-primary);
  --opendots-text: var(--tto-text-primary);
  --opendots-accent: var(--tto-accent-primary);
  --opendots-border: var(--tto-border-subtle);
  /* ... map all Task Orchestrator theme vars */
}

/* Override OpenDots component styles */
.opendots-container .computer-panel { /* ... */ }
.opendots-container .chat-message { /* ... */ }
.opendots-container .tool-card { /* ... */ }
```

### 6.2 Responsive Layout
- Desktop: Side-by-side ComputerPanel + Chat
- Tablet: Tabs for Computer/Chat
- Mobile: Full-screen tabs with bottom navigation

---

## Phase 7: Testing & Deployment (Week 4)

### 7.1 Test Scenarios
| Scenario | Expected Behavior |
|----------|-------------------|
| Select terminal in Dashboard | ComputerPanel shows live output, Chat connects to Jarvis |
| Type in Chat | Message sent to Jarvis agent → executes in terminal |
| Jarvis runs command | Tool card appears in ComputerPanel with output |
| Approval requested | ConnectionActionCard appears, user approves/declines |
| Switch terminals | AG-UI adapter detaches old, attaches new |
| Voice call (optional) | useVoice hook works with Task Orchestrator audio |

### 7.2 Performance Checklist
- [ ] Lazy load OpenDots components (`React.lazy`)
- [ ] Memoize AG-UI events with `useMemo`
- [ ] Cleanup subscriptions on unmount
- [ ] Limit tool call history (max 50)
- [ ] Virtualize terminal output in ComputerPanel

---

## File Structure Summary

```
frontend/
├── src/
│   ├── opendots/
│   │   ├── components/
│   │   │   ├── ComputerPanel.tsx         # Adapted from OpenDots
│   │   │   ├── ComputerToolCard.tsx      # Adapted
│   │   │   ├── Chat.tsx                  # Adapted
│   │   │   ├── ChatTranscript.tsx        # Adapted
│   │   │   ├── ResultPane.tsx            # Adapted
│   │   │   ├── TaskPresentation.tsx      # Adapted
│   │   │   ├── TaskActions.tsx           # Adapted
│   │   │   ├── Mascot.tsx                # Adapted
│   │   │   ├── ConnectionActionCard.tsx  # Adapted
│   │   │   ├── ConnectionsSection.tsx    # Adapted
│   │   │   └── index.ts                  # Barrel exports
│   │   ├── hooks/
│   │   │   └── useAGUI.ts                # NEW: Task Orchestrator AG-UI hook
│   │   ├── adapters/
│   │   │   ├── tto-agui-adapter.ts       # NEW: Bridge
│   │   │   └── jarvis-to-dots.ts         # NEW: Dot mapping
│   │   ├── types/
│   │   │   └── ag-ui.ts                  # NEW: Type extensions
│   │   ├── styles/
│   │   │   └── opendots.css              # NEW: Scoped styles
│   │   └── index.ts                      # Main exports
│   ├── views/dashboard/
│   │   ├── DashboardView.tsx             # MODIFIED: Add OpenDots mode
│   │   ├── OpenDotsDashboard.tsx         # NEW: OpenDots wrapper
│   │   └── TerminalGridView.tsx          # EXISTING: Extracted
│   └── lib/theme.ts                      # EXISTING: Ensure CSS vars
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| OpenDots components have hidden deps | Copy only needed components, stub missing deps |
| AG-UI protocol mismatch | Build adapter with explicit event mapping |
| Theme conflicts | CSS Modules or scoped CSS vars |
| Performance with many terminals | Virtualization, lazy loading, subscription cleanup |
| TypeScript strictness | Use `@ts-expect-error` temporarily, fix incrementally |
| OpenDots updates breaking copied code | Pin to specific commit, document modifications |

---

## Success Criteria

✅ Dashboard has "OpenDots" mode toggle
✅ Selecting terminal shows ComputerPanel with live output
✅ Chat panel sends messages to Jarvis agent
✅ Tool calls (commands) appear as cards with results
✅ Approval flow works for dangerous commands
✅ Theme matches Task Orchestrator (dark/light, accent colors)
✅ No regression in classic Dashboard mode
✅ Clean build, no TypeScript errors

---

## Timeline Estimate

| Phase | Duration | Effort |
|-------|----------|--------|
| 1. Dependencies & Component Copy | 2 days | Low |
| 2. AG-UI Adapter | 3 days | Medium |
| 3. Dashboard Integration | 2 days | Medium |
| 4. ComputerPanel Adaptation | 3 days | High |
| 5. Jarvis→Dot Mapping | 1 day | Low |
| 6. Styling & Polish | 2 days | Medium |
| 7. Testing | 2 days | Medium |
| **Total** | **~15 days** | **~3 weeks** |

---

## Next Steps

1. **Immediate**: Install dependencies, create `opendots/` folder structure
2. **Day 1-2**: Copy ComputerPanel, Chat, ComputerToolCard components
3. **Day 3-5**: Build Task Orchestrator-AGUI adapter and useAGUI hook
4. **Day 6-8**: Integrate OpenDotsDashboard into DashboardView
5. **Day 9-12**: Adapt ComputerPanel for Task Orchestrator terminals
6. **Day 13-15**: Styling, testing, bug fixes

**Ready to start Phase 1?**
