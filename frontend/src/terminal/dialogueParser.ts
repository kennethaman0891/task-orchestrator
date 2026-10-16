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

export interface PromptOption {
  index: number;
  key: string; // "1", "2", "y", "n", "esc"
  label: string; // "Yes", "No", "Always allow"
  rawText: string; // "1. Yes"
  selected?: boolean; // true if cursor (❯ or >) is pointing at it
  value: string; // payload to send to PTY: "1\r", "2\r", "y\r", "\x1b"
}

export interface InteractivePrompt {
  id: string;
  type: 'permission' | 'question' | 'select' | 'confirm';
  question: string; // e.g. "Do you want to proceed?"
  title?: string; // e.g. "Bash command"
  command?: string; // e.g. "source venv/bin/activate && python manage.py migrate --plan"
  description?: string; // e.g. "'source' evaluates arguments as shell code..."
  options: PromptOption[];
  hints?: string; // e.g. "Esc to cancel · Tab to amend"
  resolved?: boolean;
  selectedKey?: string;
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
  interactivePrompt?: InteractivePrompt;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
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
  _cliType: string = 'claude',
): UnifiedChatMessage[] {
  if (!rawLines || rawLines.length === 0) return [];

  const lines = rawLines.map((l) => stripAnsi(l).trimEnd());
  const messages: UnifiedChatMessage[] = [];

  let currentMsg: UnifiedChatMessage | null = null;
  let currentBlock: 'none' | 'user' | 'thought' | 'tool' | 'text' = 'none';
  let currentTool: UnifiedToolCall | null = null;
  let thoughtLines: string[] = [];
  let textLines: string[] = [];

  // Interactive prompt tracking
  let promptOptions: PromptOption[] = [];
  let promptQuestion = '';
  let promptCommand = '';
  let promptTitle = '';
  let promptDesc: string[] = [];
  let promptHints = '';
  let inDivider = false;

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

    if (promptOptions.length > 0 && currentMsg && currentMsg.role === 'assistant') {
      const stablePromptId = `prompt-${messages.length}-${promptOptions.map((o) => o.key).join('')}-${(promptQuestion || promptTitle || '').slice(0, 16)}`;
      currentMsg.interactivePrompt = {
        id: stablePromptId,
        type:
          promptTitle?.toLowerCase().includes('permission') ||
          promptTitle?.toLowerCase().includes('bash') ||
          promptQuestion?.toLowerCase().includes('proceed')
            ? 'permission'
            : 'select',
        title: promptTitle || 'Action Required',
        command: promptCommand || '',
        question: promptQuestion || 'Please choose an option to continue',
        description: promptDesc.join(' ').trim(),
        options: [...promptOptions],
        hints: promptHints,
        resolved: false,
      };
      promptOptions = [];
      promptQuestion = '';
      promptCommand = '';
      promptTitle = '';
      promptDesc = [];
      promptHints = '';
      inDivider = false;
    }

    if (
      currentMsg &&
      (currentMsg.textParts.length > 0 ||
        currentMsg.reasoningParts.length > 0 ||
        currentMsg.toolParts.length > 0 ||
        currentMsg.interactivePrompt)
    ) {
      messages.push(currentMsg);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;

    // ── Check if this line is an interactive menu option or hint ──
    const hasPointer = /^([>❯*]\s*)(\d+)[.)]\s+(.+)$/.test(line);
    const hasNumberedOption = /^(\d+)[.)]\s+(.+)$/.test(line);
    const isHintLine = /^(?:Esc to cancel|Enter to confirm|Tab to amend|\? for shortcuts)/i.test(
      line,
    );

    // Numbered lines without pointer (1. ...) are ONLY interactive options if preceded by an active prompt header, question, or hint
    const isInteractiveOption =
      hasPointer ||
      (hasNumberedOption &&
        (Boolean(promptTitle) ||
          Boolean(promptQuestion) ||
          Boolean(promptHints) ||
          promptOptions.length > 0 ||
          /(?:select|choose|allow|permission|confirm|\?)/i.test(promptQuestion || '')));

    const optionMatch = isInteractiveOption ? line.match(/^([>❯*]\s*)?(\d+)[.)]\s+(.+)$/) : null;

    if (optionMatch) {
      const isSelected = Boolean(optionMatch[1]);
      const key = optionMatch[2];
      const label = optionMatch[3].trim();
      promptOptions.push({
        index: parseInt(key, 10),
        key,
        label,
        rawText: `${key}. ${label}`,
        selected: isSelected,
        value: `${key}\r`,
      });
      continue;
    }

    if (isHintLine) {
      promptHints = line;
      continue;
    }

    // ── Skip decorative banners, dividers, shortcuts, tip lines ──
    if (/^[─━═┄┈┌┐└┘├┤┬┴┼╭╮╯╰│|\s]+$/.test(line)) {
      if (promptTitle || currentTool) {
        inDivider = !inDivider;
      }
      continue;
    }

    if (inDivider) {
      promptCommand = promptCommand ? promptCommand + '\n' + line : line;
      continue;
    }

    if (/^[│|]\s*.*[│|]$/.test(line) && /claude\s+code|welcome|tips|version|opencode/i.test(line))
      continue;
    if (/^\? for shortcuts|^shift\+tab to cycle|^\(ctrl\+o to expand\)/i.test(line)) continue;
    if (/^claude\s+code\s+v\d+|^opencode\s+v\d+/i.test(line)) continue;
    if (
      /^(?:[▶►]+\s*)?(?:auto mode on|compact mode|shift\+tab to cycle|\? for shortcuts)/i.test(line)
    )
      continue;
    if (/image in clipboard|ctrl\+v to paste/i.test(line)) continue;
    if (/auto-coding\s*·\s*API Usage Billing/i.test(line)) continue;
    // Exclude Claude Code tip banners & suggestion lines from becoming fake user bubbles
    if (/^[>❯]\s*(?:Try\s+["']|Try\s+asking|\/help|esc to cancel|compact mode|auto mode|shift\+tab|\? for shortcuts)/i.test(line))
      continue;

    // ── Detect User Prompt ──
    // GUARD: Option lines (e.g. ❯ 1. Yes) MUST NOT be treated as user prompts
    const isOptionLine =
      Boolean(optionMatch) ||
      /^([>❯*]\s*)?\d+[.)]\s+/i.test(line) ||
      /^([>❯*]\s*)?(yes|no|always|never|allow|deny|cancel|proceed|skip|not now|don't show)\b/i.test(
        line,
      );

    let extractedUserPrompt: string | null = null;

    if (!isOptionLine) {
      // 1. Arrow prompts: > prompt or ❯ prompt (Claude Code, interactive arrows)
      const arrowMatch = line.match(/^([>❯]{1,2})\s+(.+)/);
      if (
        arrowMatch &&
        !/^[>❯]\s*(thought|running|bash|read|edit|write|view|tool|error|waiting)/i.test(line)
      ) {
        extractedUserPrompt = arrowMatch[2].trim();
      }

      // 2. Multi-turn prefixes: User: / You: / Human: / Q: / Question:
      if (!extractedUserPrompt) {
        const prefixMatch = line.match(/^(?:User|You|Human|Q|Question):\s*(.+)/i);
        if (prefixMatch) {
          extractedUserPrompt = prefixMatch[1].trim();
        }
      }

      // 3. Named CLI agent prompts: antigravity> / agy> / gemini> / codex> / opencode> / aider> / ollama>
      if (!extractedUserPrompt) {
        const agentPromptMatch = line.match(
          /^(?:antigravity|agy|gemini|codex|opencode|aider|ollama|agent|assistant)\s*>\s*(.+)/i,
        );
        if (agentPromptMatch) {
          extractedUserPrompt = agentPromptMatch[1].trim();
        }
      }

      // 4. Python / Node REPL prompts: >>> <command>
      if (!extractedUserPrompt) {
        const replMatch = line.match(/^(?:>>>|\.\.\.)\s+(.+)/);
        if (replMatch) {
          extractedUserPrompt = replMatch[1].trim();
        }
      }

      // 5. Standard shell prompts (bash, zsh, fish, venv):
      // Examples: user@host:dir$ cmd, ~/dir % cmd, ➜ dir git:(main) cmd, (venv) $ cmd, $ cmd
      if (!extractedUserPrompt) {
        const shellMatch = line.match(
          /^(?:(?:\([^)]+\)\s*)?(?:[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+[:\w/~.-]*|[~/\w.-]+)?\s*[$#%➜❯]\s+)(.+)/,
        );
        if (
          shellMatch &&
          !/^(?:bash|sh|zsh|git|npm|python|node|echo|cat|curl|source)\b.*: (?:command not found|No such file)/i.test(
            shellMatch[1],
          )
        ) {
          extractedUserPrompt = shellMatch[1].trim();
        }
      }
    }

    if (extractedUserPrompt) {
      commitCurrentMessage();
      currentMsg = createMessage('user', messages.length + 1);
      currentMsg.textParts.push(extractedUserPrompt);
      currentBlock = 'user';
      continue;
    }

    // ── Detect Thought / Reasoning ──
    const isThoughtHeader =
      /^(?:▸\s*Thought|Thought:|Thinking\.\.\.|thought for\s+\d+|Reasoning:|Thinking Process:)/i.test(
        line,
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
    const isBashCmd =
      /^\$\s*(bash|sh|zsh|git|npm|cargo|curl|cat|find|grep|python|node)\s+(.*)/i.test(line);
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
        const match = line.match(
          /^(?:Running tool|Tool call|Tool):\s*([A-Za-z0-9_-]+)(?:\s*\((.*)\))?/i,
        );
        currentTool = {
          tool: match ? match[1] : 'Tool',
          status: 'completed',
          input: match?.[2] || '',
          output: '',
        };
      }
      continue;
    }

    // ── Tool Output / Context ──
    if (currentBlock === 'tool' && currentTool) {
      if (/^(Error:|Waiting\.\.\.|\d+\s+__pycache__|\.\.\.\s+\+\d+\s+lines)/.test(line)) {
        if (currentTool.output) currentTool.output += '\n';
        currentTool.output += line;
        continue;
      }
    }

    // ── Detect Question / Permission Headers ──
    if (
      /^(?:Bash command|Tool call|Tool execution|Permission Request|Permission required|Confirmation Required|Authorize tool|Allow action)/i.test(
        line,
      )
    ) {
      promptTitle = line;
      continue;
    }

    if (
      /\?$/.test(line) ||
      /(?:do you want|allow this|allow tool|allow command|are you sure|select|choose|teach auto mode|proceed|confirm|continue|override|overwrite|press enter|which one|pick one|permission to|authorize)/i.test(
        line,
      ) ||
      /\[[yY]\/[nN]\]|\([yY]\/[nN]\)/i.test(line)
    ) {
      promptQuestion = line;
      continue;
    }

    // Context / description under permission prompt
    if (promptTitle && !promptQuestion) {
      if (
        !promptCommand &&
        (line.startsWith('$') ||
          line.includes('/') ||
          line.includes('\\') ||
          /^(?:python|python3|node|npm|npx|pnpm|cargo|go|git|bash|sh|zsh|cat|ls|rm|mv|cp|echo|curl|wget)\b/i.test(
            line,
          ))
      ) {
        promptCommand = line.replace(/^\$\s*/, '');
      } else {
        promptDesc.push(line);
      }
      continue;
    }
    if (promptQuestion && promptOptions.length === 0) {
      promptDesc.push(line);
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
        /^(I have|I will|I've|We have|Here is|Note:|Please|The |This |Done|Completed|Created|Updated)/i.test(
          line,
        ) ||
        (/^[A-Z]/.test(line) && line.endsWith('.') && line.length > 25);

      if (isProse) {
        flushTool();
        currentBlock = 'text';
        textLines.push(line);
        continue;
      } else if (
        /^\s{2,}/.test(rawLine) ||
        /^(output|result|exited with|stdout|stderr)/i.test(line)
      ) {
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

  // Synthesize binary y/n if question has [y/N] and no numbered options
  if (promptQuestion && promptOptions.length === 0) {
    if (/\([yY]\/[nN]\)|\[[yY]\/[nN]\]/i.test(promptQuestion)) {
      promptOptions.push({
        index: 1,
        key: 'y',
        label: 'Yes',
        rawText: 'Yes (y)',
        selected: true,
        value: 'y\r',
      });
      promptOptions.push({
        index: 2,
        key: 'n',
        label: 'No',
        rawText: 'No (n)',
        selected: false,
        value: 'n\r',
      });
    }
  }

  // If there are accumulated prompt options at the end, attach to active message
  if (promptOptions.length > 0) {
    if (!currentMsg || currentMsg.role !== 'assistant') {
      commitCurrentMessage();
      currentMsg = createMessage('assistant', messages.length + 1);
    }
    const stableTrailingId = `prompt-${messages.length}-${promptOptions.map((o) => o.key).join('')}-${(promptQuestion || promptTitle || '').slice(0, 16)}`;
    currentMsg.interactivePrompt = {
      id: stableTrailingId,
      type:
        promptTitle?.toLowerCase().includes('permission') ||
        promptTitle?.toLowerCase().includes('bash') ||
        promptTitle?.toLowerCase().includes('tool') ||
        promptTitle?.toLowerCase().includes('allow') ||
        promptTitle?.toLowerCase().includes('authorize') ||
        promptQuestion?.toLowerCase().includes('proceed') ||
        promptQuestion?.toLowerCase().includes('allow') ||
        promptQuestion?.toLowerCase().includes('permit') ||
        promptQuestion?.toLowerCase().includes('authorize') ||
        promptQuestion?.toLowerCase().includes('permission')
          ? 'permission'
          : 'select',
      title: promptTitle || 'Permission Request',
      command: promptCommand || (currentTool ? currentTool.input : ''),
      question: promptQuestion || 'Do you want to proceed?',
      description: promptDesc.join(' ').trim(),
      options: [...promptOptions],
      hints: promptHints,
      resolved: false,
    };
  }

  commitCurrentMessage();

  // Mark prior prompts resolved if followed by subsequent messages
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].interactivePrompt) {
      messages[i].interactivePrompt!.resolved = true;
    }
  }

  return messages;
}
