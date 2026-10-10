import { useEffect, useState, useCallback, useRef } from 'react';
import type { 
  Message, 
  ToolCall, 
  RunAgentInput,
  AGUIEvent,
  ToolCallResult
} from '@ag-ui/core';
import { ttoAGUIAdapter } from '../adapters/tto-agui-adapter';

interface UseAGUIReturn {
  messages: Message[];
  toolCalls: ToolCall[];
  agentState: Record<string, any>;
  isConnected: boolean;
  sendMessage: (text: string) => Promise<void>;
  approveToolCall: (toolCallId: string, approved: boolean) => Promise<void>;
  abort: () => void;
}

interface UseAGUIOptions {
  terminalId: string | null;
  config: {
    terminalManager: any;
    jarvisManager: any;
    sessionContextStore: any;
  };
}

/**
 * Hook to connect a terminal to AG-UI events via the TTO adapter
 * Automatically attaches/detaches on terminalId change
 */
export function useAGUI({ terminalId, config }: UseAGUIOptions): UseAGUIReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [agentState, setAgentState] = useState<Record<string, any>>({});
  const [isConnected, setIsConnected] = useState(false);
  
  const messagesRef = useRef(messages);
  const toolCallsRef = useRef(toolCalls);
  const agentStateRef = useRef(agentState);
  
  // Keep refs in sync
  messagesRef.current = messages;
  toolCallsRef.current = toolCalls;
  agentStateRef.current = agentState;

  // Handle incoming AG-UI events
  const handleEvent = useCallback((event: AGUIEvent) => {
    switch (event.type) {
      case 'MESSAGE_START': {
        const msgStart = event as MessageStart;
        setMessages(prev => {
          const exists = prev.find(m => m.id === msgStart.messageId);
          if (exists) return prev;
          return [...prev, {
            id: msgStart.messageId,
            role: msgStart.role || 'assistant',
            content: msgStart.content || '',
            createdAt: Date.now()
          } as Message];
        });
        break;
      }
      
      case 'MESSAGE_CHUNK': {
        const msgChunk = event as MessageChunk;
        setMessages(prev => prev.map(m => 
          m.id === msgChunk.messageId 
            ? { ...m, content: m.content + (msgChunk.content || '') }
            : m
        ));
        break;
      }
      
      case 'MESSAGE_END': {
        const msgEnd = event as MessageEnd;
        setMessages(prev => prev.map(m => 
          m.id === msgEnd.messageId 
            ? { ...m, content: msgEnd.content || m.content }
            : m
        ));
        break;
      }
      
      case 'TOOL_CALL_START': {
        const tcStart = event as ToolCallStart;
        setToolCalls(prev => {
          const exists = prev.find(tc => tc.id === tcStart.toolCallId);
          if (exists) return prev;
          return [...prev, {
            id: tcStart.toolCallId,
            name: tcStart.toolCall.name,
            args: tcStart.toolCall.args,
            state: 'running',
            createdAt: Date.now()
          } as ToolCall];
        });
        break;
      }
      
      case 'TOOL_CALL_CHUNK': {
        const tcChunk = event as ToolCallChunk;
        setToolCalls(prev => prev.map(tc => 
          tc.id === tcChunk.toolCallId 
            ? { ...tc, args: { ...tc.args, ...tcChunk.args } }
            : tc
        ));
        break;
      }
      
      case 'TOOL_CALL_END': {
        const tcEnd = event as ToolCallEnd;
        setToolCalls(prev => prev.map(tc => 
          tc.id === tcEnd.toolCallId 
            ? { 
                ...tc, 
                state: 'completed',
                result: tcEnd.result,
                error: tcEnd.error
              } 
            : tc
        ));
        break;
      }
      
      case 'STATE_DELTA': {
        const stateDelta = event as any; // StateDelta
        if (stateDelta.delta && Array.isArray(stateDelta.delta)) {
          setAgentState(prev => {
            const next = { ...prev };
            for (const delta of stateDelta.delta) {
              if (delta.op === 'replace' && delta.path) {
                const pathParts = delta.path.split('/').filter(Boolean);
                let obj: any = next;
                for (let i = 0; i < pathParts.length - 1; i++) {
                  const part = pathParts[i];
                  if (!obj[part]) obj[part] = {};
                  obj = obj[part];
                }
                obj[pathParts[pathParts.length - 1]] = delta.value;
              }
            }
            return next;
          });
        }
        break;
      }
    }
  }, []);

  // Attach/detach on terminalId change
  useEffect(() => {
    if (!terminalId) {
      setIsConnected(false);
      return;
    }

    // Attach to terminal
    ttoAGUIAdapter.attachTerminal(terminalId, config);
    setIsConnected(true);

    // Subscribe to adapter events
    ttoAGUIAdapter.on('agui-event', handleEvent);

    // Cleanup
    return () => {
      ttoAGUIAdapter.detachTerminal(terminalId);
      ttoAGUIAdapter.off('agui-event', handleEvent);
      setIsConnected(false);
    };
  }, [terminalId, config, handleEvent]);

  // Send message to agent
  const sendMessage = useCallback(async (text: string) => {
    if (!terminalId) return;
    
    // Add user message to local state immediately
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: Date.now()
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      await ttoAGUIAdapter.sendMessage(terminalId, text, {
        jarvisManager: config.jarvisManager
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Add error message
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        createdAt: Date.now()
      }]);
    }
  }, [terminalId, config.jarvisManager]);

  // Approve/reject tool call
  const approveToolCall = useCallback(async (toolCallId: string, approved: boolean) => {
    if (!terminalId) return;
    
    const toolCall = toolCallsRef.current.find(tc => tc.id === toolCallId);
    if (!toolCall) return;

    if (approved) {
      // Execute the tool call
      try {
        await ttoAGUIAdapter.executeToolCall(toolCall, {
          jarvisManager: config.jarvisManager
        });
      } catch (error) {
        console.error('Tool execution failed:', error);
      }
    } else {
      // Mark as cancelled
      setToolCalls(prev => prev.map(tc => 
        tc.id === toolCallId ? { ...tc, state: 'cancelled' } : tc
      ));
    }
  }, [terminalId, config.jarvisManager]);

  // Abort current operations
  const abort = useCallback(() => {
    if (!terminalId) return;
    // Could send abort signal to agent
  }, [terminalId]);

  return {
    messages,
    toolCalls,
    agentState,
    isConnected,
    sendMessage,
    approveToolCall,
    abort
  };
}
