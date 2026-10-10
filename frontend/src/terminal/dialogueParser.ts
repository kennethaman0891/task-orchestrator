// dialogueParser.ts — parses live terminal scrollback and buffer lines into
// structured conversation messages (user prompts, thoughts/reasoning, tool calls, assistant text).

export interface UnifiedToolCall {
  tool: string;
  callId?: string;
  status: 'running' | 'completed' | 'error';
  input?: string;
  output?: string;
  error?: string;
}

export interface UnifiedChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  time: number;
  model?: string;
  cost?: number;
  tokens?: { total: number; input: number; output: number; reasoning: number };
  textParts: string[];
  reasoningParts: string[];
  toolParts: UnifiedToolCall[];
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function createMessage(role: 'user' | 'assistant', index: number): UnifiedChatMessage {
  return {
    id: `dialogue-${role}-${index}-${Date.now()}`,
    role,
    time: Date.now(),
    textParts: [],
    reasoningParts: [],
    toolParts: [],
  };
}

/**
 * Parses raw terminal output lines into structured conversation turns.
 */
export function parseTerminalDialogue(
  rawLines: string[],
  _cliType: string = 'claude'
): UnifiedChatMessage[] {
  if (!rawLines || rawLines.length === 0) return [];

  const lines = rawLines.map((l) => stripAnsi(l).trimEnd());
  const messages: UnifiedChatMessage[] = [];

  let currentMsg: UnifiedChatMessage | null = null;
  let currentBlock: 'none' | 'user' | 'thought' | 'tool' | 'text' = 'none';
  let currentTool: UnifiedToolCall | null = null;
  let thoughtLines: string[] = [];
  let textLines: string[] = [];

  const flushThought = () => {
    if (thoughtLines.length > 0 && currentMsg) {
      const thoughtText = thoughtLines.join('\n').trim();
      if (thoughtText) {
        currentMsg.reasoningParts.push(thoughtText);
      }
      thoughtLines = [];
    }
  };

  const flushText = () => {
    if (textLines.length > 0 && currentMsg) {
      const text = textLines.join('\n').trim();
      if (text) {
        currentMsg.textParts.push(text);
      }
      textLines = [];
    }
  };

  const flushTool = () => {
    if (currentTool && currentMsg) {
      currentMsg.toolParts.push(currentTool);
      currentTool = null;
    }
  };

  const commitCurrentMessage = () => {
    flushThought();
    flushText();
    flushTool();

    if (
      currentMsg &&
      (currentMsg.textParts.length > 0 ||
        currentMsg.reasoningParts.length > 0 ||
        currentMsg.toolParts.length > 0)
    ) {
      messages.push(currentMsg);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;

    // ── Skip decorative banners, dividers, shortcuts ──
    if (/^[─━═┄┈┌┐└┘├┤┬┴┼╭╮╯╰│\|\s]+$/.test(line)) continue;
    if (/^[│|]\s*.*[│|]$/.test(line) && /claude\s+code|welcome|tips|version|opencode/i.test(line)) continue;
    if (/^\? for shortcuts|^shift\+tab to cycle|^\(ctrl\+o to expand\)/i.test(line)) continue;
    if (/^claude\s+code\s+v\d+|^opencode\s+v\d+/i.test(line)) continue;
    if (/^auto mode on|^compact mode|^shift\+tab to cycle/i.test(line)) continue;

    // ── Detect User Prompt ──
    const userPromptMatch = line.match(/^([>❯]{1,2})\s+(.+)/);
    const isUserPrompt =
      Boolean(userPromptMatch) &&
      !/^[>❯]\s*(thought|running|bash|read|edit|write|view|tool)/i.test(line);

    if (isUserPrompt && userPromptMatch) {
      const promptText = userPromptMatch[2].trim();
      if (promptText) {
        commitCurrentMessage();
        currentMsg = createMessage('user', messages.length + 1);
        currentMsg.textParts.push(promptText);
        currentBlock = 'user';
        continue;
      }
    }

    // Also support "User: <text>" or "You: <text>" prompts
    const userPrefixMatch = line.match(/^(?:User|You):\s*(.+)/i);
    if (userPrefixMatch) {
      const promptText = userPrefixMatch[1].trim();
      if (promptText) {
        commitCurrentMessage();
        currentMsg = createMessage('user', messages.length + 1);
        currentMsg.textParts.push(promptText);
        currentBlock = 'user';
        continue;
      }
    }

    // ── Detect Thought / Reasoning ──
    const isThoughtHeader = /^(?:▸\s*Thought|Thought:|Thinking\.\.\.|thought for\s+\d+|Reasoning:|Thinking Process:)/i.test(
      line
    );
    if (isThoughtHeader) {
      flushText();
      flushTool();
      if (!currentMsg || currentMsg.role !== 'assistant') {
        commitCurrentMessage();
        currentMsg = createMessage('assistant', messages.length + 1);
      }
      currentBlock = 'thought';
      thoughtLines.push(line);
      continue;
    }

    // ── Detect Tool Call ──
    const isClaudeTool = /^([●○])\s*([A-Za-z0-9_-]+)\((.*)\)/.test(line);
    const isBashCmd = /^\$\s*(bash|sh|zsh|git|npm|cargo|curl|cat|find|grep|python|node)\s+(.*)/i.test(line);
    const isOpenCodeTool = /^(?:Running tool|Tool call|Tool):\s*([A-Za-z0-9_-]+)/i.test(line);

    if (isClaudeTool || isBashCmd || isOpenCodeTool) {
      flushThought();
      flushText();
      flushTool();
      if (!currentMsg || currentMsg.role !== 'assistant') {
        commitCurrentMessage();
        currentMsg = createMessage('assistant', messages.length + 1);
      }
      currentBlock = 'tool';

      if (isClaudeTool) {
        const match = line.match(/^([●○])\s*([A-Za-z0-9_-]+)\((.*)\)/);
        if (match) {
          const isPending = match[1] === '○';
          const toolName = match[2];
          let args = match[3];
          args = args.replace(/\s*\(ctrl\+[a-z]\s+to\s+expand\)/i, '').trim();
          currentTool = {
            tool: toolName,
            status: isPending ? 'running' : 'completed',
            input: args,
            output: '',
          };
        }
      } else if (isBashCmd) {
        const cmdMatch = line.match(/^\$\s*(.*)/);
        currentTool = {
          tool: 'Bash',
          status: 'completed',
          input: cmdMatch ? cmdMatch[1].trim() : line,
          output: '',
        };
      } else if (isOpenCodeTool) {
        const match = line.match(/^(?:Running tool|Tool call|Tool):\s*([A-Za-z0-9_-]+)(?:\s*\((.*)\))?/i);
        currentTool = {
          tool: match ? match[1] : 'Tool',
          status: 'completed',
          input: match?.[2] || '',
          output: '',
        };
      }
      continue;
    }

    // ── Continuing Thought Block ──
    if (currentBlock === 'thought') {
      const isStillThought =
        /^\s{2,}/.test(rawLine) &&
        !line.startsWith('●') &&
        !line.startsWith('○') &&
        !line.startsWith('>') &&
        !line.startsWith('❯');
      if (isStillThought) {
        thoughtLines.push(line);
        continue;
      } else {
        flushThought();
        currentBlock = 'text';
      }
    }

    // ── Continuing Tool Output Block ──
    if (currentBlock === 'tool' && currentTool) {
      const isProse =
        /^(I have|I will|I've|We have|Here is|Note:|Please|The |This |Done|Completed|Created|Updated)/i.test(line) ||
        (/^[A-Z]/.test(line) && line.endsWith('.') && line.length > 25);

      if (isProse) {
        flushTool();
        currentBlock = 'text';
        textLines.push(line);
        continue;
      } else if (/^\s{2,}/.test(rawLine) || /^(output|result|exited with|stdout|stderr)/i.test(line)) {
        if (currentTool.output) currentTool.output += '\n';
        currentTool.output += line;
        continue;
      } else {
        flushTool();
        currentBlock = 'text';
      }
    }

    // ── Assistant Text ──
    if (line.length > 0) {
      if (!currentMsg || currentMsg.role !== 'assistant') {
        commitCurrentMessage();
        currentMsg = createMessage('assistant', messages.length + 1);
      }
      currentBlock = 'text';
      textLines.push(line);
    }
  }

  commitCurrentMessage();

  return messages;
}
