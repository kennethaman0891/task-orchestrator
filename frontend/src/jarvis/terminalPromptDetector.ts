// ═══════════════════════════════════════════════════════════════════════════
// JARVIS TERMINAL PROMPT & COMPLETION DETECTOR
// Inspects live terminal buffer for interactive permission requests, questions,
// and task completion across Antigravity CLI, Claude Code, Codex, and shells.
// ═══════════════════════════════════════════════════════════════════════════

export interface PromptOption {
  key: string;       // "1", "2", "y", "n", "esc"
  label: string;     // "Yes, run command", "Always allow", "Cancel"
  value: string;     // "1", "2", "y", "n", "escape"
  selected?: boolean;
}

export interface DetectedTerminalPrompt {
  id: string;        // Unique hash to prevent repeating the same prompt
  type: 'permission' | 'question' | 'select' | 'confirm';
  command?: string;
  question: string;
  options: PromptOption[];
  spokenPrompt: string; // Crisp 1-2 sentence spoken phrase for Jarvis
  detectedAt: number;
}

export interface TerminalObservationResult {
  hasPrompt: boolean;
  prompt?: DetectedTerminalPrompt;
  isAsking: boolean;
  isWorking: boolean;
  isCompleted: boolean;
  completedSummary?: string;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Parses the live terminal buffer to detect if the CLI is currently waiting
 * for user permission or answering a question.
 */
export function detectTerminalPrompt(rawLines: string[], cliName: string = 'Antigravity'): DetectedTerminalPrompt | null {
  if (!rawLines || rawLines.length === 0) return null;

  const lines = rawLines.map((l) => stripAnsi(l).trimEnd());
  const nonBlank = lines.map((l) => l.trim()).filter(Boolean);
  if (nonBlank.length === 0) return null;

  const tail = nonBlank.slice(-25);
  const tailText = tail.join('\n');

  // 1. Detect Permission Request with Numbered Options (Antigravity & Claude Code)
  const isPermissionHeader =
    /requesting permission for:|bash command|run this command\?|allow this command\?|allow tool execution|do you want to proceed\?|authorize tool/i.test(
      tailText
    );

  // Check for numbered choices in the tail: e.g. "1. Yes", "2. Always", "4. No, cancel"
  const optionLines: Array<{ line: string; index: number }> = [];
  for (let i = 0; i < tail.length; i++) {
    const l = tail[i];
    if (/^([>❯*]\s*)?\d+[.)]\s+.+/i.test(l)) {
      optionLines.push({ line: l, index: i });
    }
  }

  // Extract command being requested
  let targetCommand = '';
  for (let i = 0; i < tail.length; i++) {
    const l = tail[i];
    const permMatch = l.match(/requesting permission for:\s*(.*)/i);
    if (permMatch) {
      if (permMatch[1] && permMatch[1].trim()) {
        targetCommand = permMatch[1].trim();
      } else if (tail[i + 1] && !tail[i + 1].includes('Run this command')) {
        targetCommand = tail[i + 1].trim();
      }
      break;
    }
    if (/^bash command\b/i.test(l) && tail[i + 1]) {
      targetCommand = tail[i + 1].trim();
      break;
    }
  }

  // Extract question
  let question = '';
  for (let i = tail.length - 1; i >= 0; i--) {
    const l = tail[i];
    if (/\?\s*$/i.test(l) && !/shortcuts|hints|press/i.test(l)) {
      question = l;
      break;
    }
  }
  if (!question && isPermissionHeader) {
    question = 'Run this command?';
  }

  // Case A: Numbered menu found
  if (optionLines.length >= 2 && (isPermissionHeader || question)) {
    const options: PromptOption[] = [];
    for (const item of optionLines) {
      const match = item.line.match(/^([>❯*]\s*)?(\d+)[.)]\s+(.+)$/);
      if (match) {
        const isSelected = Boolean(match[1]);
        const key = match[2];
        const label = match[3].trim();
        options.push({
          key,
          label,
          value: key,
          selected: isSelected,
        });
      }
    }

    const commandBrief = targetCommand ? targetCommand.slice(0, 80) : '';
    let spoken = '';
    if (commandBrief) {
      spoken = `${cliName} is requesting permission to run: ${commandBrief}. Say 'yes' or '1' to allow, or 'no' to cancel.`;
    } else {
      spoken = `${cliName} has a question: ${question}. Options are: ${options.map((o) => `${o.key}: ${o.label}`).slice(0, 3).join(', ')}. What would you like to do?`;
    }

    const promptId = `prompt-${targetCommand.slice(0, 32)}-${options.map((o) => o.key).join('')}-${question.slice(0, 24)}`;

    return {
      id: promptId,
      type: isPermissionHeader ? 'permission' : 'select',
      command: targetCommand,
      question,
      options,
      spokenPrompt: spoken,
      detectedAt: Date.now(),
    };
  }

  // Case B: Binary confirmation prompt [y/N], (y/n), (yes/no)
  const lastLine = tail[tail.length - 1] || '';
  const secondLast = tail[tail.length - 2] || '';
  const binaryMatch =
    lastLine.match(/(.+?)\s*(?:\[([yYnN/]+)\]|\(([yYnN/]+)\)|\(yes\/no\))\s*[:?]?\s*$/i) ||
    secondLast.match(/(.+?)\s*(?:\[([yYnN/]+)\]|\(([yYnN/]+)\)|\(yes\/no\))\s*[:?]?\s*$/i);

  if (binaryMatch) {
    const qText = binaryMatch[1].trim();
    const options: PromptOption[] = [
      { key: '1', label: 'Yes', value: 'y', selected: true },
      { key: '2', label: 'No', value: 'n' },
    ];
    const spoken = `${cliName} is asking: ${qText}. Say 'yes' to proceed, or 'no' to cancel.`;
    return {
      id: `binary-${qText.slice(0, 40)}`,
      type: 'confirm',
      question: qText,
      options,
      spokenPrompt: spoken,
      detectedAt: Date.now(),
    };
  }

  return null;
}

/**
 * Checks whether the terminal has completed a running task and returned to idle.
 */
export function detectTaskCompletion(
  rawLines: string[],
  wasWorking: boolean,
  taskStartTime: number = 0,
): { isCompleted: boolean; summary?: string } {
  if (!wasWorking || !rawLines || rawLines.length === 0) {
    return { isCompleted: false };
  }

  // Guard: minimum 1.5 seconds since task started before concluding completion
  if (Date.now() - taskStartTime < 1500) {
    return { isCompleted: false };
  }

  const lines = rawLines.map((l) => stripAnsi(l).trimEnd());
  const nonBlank = lines.map((l) => l.trim()).filter(Boolean);
  if (nonBlank.length === 0) return { isCompleted: false };

  const lastLine = nonBlank[nonBlank.length - 1] || '';
  const secondLast = nonBlank[nonBlank.length - 2] || '';
  const recentTail = nonBlank.slice(-10).join('\n');

  // 1. If actively asking a question or running tools, it is NOT completed
  if (/requesting permission|run this command\?|do you want to proceed|thinking\.\.\.|\bexecuting\b|\brunning\b/i.test(recentTail)) {
    return { isCompleted: false };
  }

  // 2. Check for universal prompt indicators (idle waiting for next instruction)
  const isAtIdlePrompt =
    /^[❯>$#%]\s*$/.test(lastLine) ||
    /^[>❯]\s*(?:\[\s*\]|Try\s+["']|type\s+a\s+message|ask\s+anything)/i.test(lastLine) ||
    (/^[❯>$#%]\s*$/.test(secondLast) && /\?\s*for\s*shortcuts|press\s*\?/i.test(lastLine));

  // 3. Completion markers in recent lines
  const completionMatch = recentTail.match(
    /(?:thought for\s+[\d.]+s|✔\s+applied|✓\s+done|completed\b|finished\b|tests?\s+passed|success(?:fully)?\b)/i
  );

  if (isAtIdlePrompt) {
    let summary = 'Task execution completed.';
    for (let i = nonBlank.length - 1; i >= Math.max(0, nonBlank.length - 12); i--) {
      const line = nonBlank[i];
      if (/thought for\s+[\d.]+s/i.test(line)) {
        summary = line;
        break;
      }
      if (/✔|✓|completed|finished|passed|done/i.test(line) && !/shortcuts|hints/i.test(line)) {
        summary = line;
        break;
      }
    }
    return { isCompleted: true, summary };
  }

  if (completionMatch && isAtIdlePrompt) {
    return { isCompleted: true, summary: completionMatch[0] };
  }

  return { isCompleted: false };
}
