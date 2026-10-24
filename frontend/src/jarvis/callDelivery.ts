// One rule for a Jarvis call: a task is typed once, a question is never typed.

const QUESTION = /^(what|why|how|when|where|who|which|whose|explain|describe|status|tell me|show me)\b/i;
const IMPERATIVE = /\b(fix|implement|build|write|edit|refactor|create|add|remove|delete|update|change|make|rename|install|deploy|commit|continue|debug)\b/i;
const LEAD = /^(please|tell|instruct|have|ask|run|execute|do|send|type)\b/i;

export function isQuestionUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (QUESTION.test(t)) return true;
  if (/\?\s*$/.test(t) && !IMPERATIVE.test(t) && !LEAD.test(t)) return true;
  return false;
}

export function isInstructionUtterance(text: string): boolean {
  const t = text.trim();
  if (!t || isQuestionUtterance(t)) return false;
  return IMPERATIVE.test(t) || LEAD.test(t);
}

export interface CallDeliveryInput {
  utterance: string;
  intent: string;
  shouldExecute: boolean;
  actionCommand: string;
  spoken: string;
  modelOk: boolean;
}

export interface CallDelivery {
  deliver: boolean;
  command: string;
  speak: string;
}

const RUN_INTENTS = new Set(['orchestrate_cli', 'orchestrate', 'execute_shell', 'execute']);

/** Decide the single outcome of one call turn. Never both speaks a question and types it. */
export function decideCallDelivery(input: CallDeliveryInput): CallDelivery {
  const utterance = input.utterance.trim();
  const command = input.actionCommand.trim();
  const spoken = input.spoken.trim();
  const modelSpoke = input.modelOk && spoken ? spoken : 'I could not read a model reply.';

  if (!utterance || isQuestionUtterance(utterance)) {
    return { deliver: false, command: '', speak: modelSpoke };
  }

  const modelWantsRun = input.modelOk && input.shouldExecute && RUN_INTENTS.has(input.intent);
  if (modelWantsRun) {
    const line = command || utterance;
    return {
      deliver: line.length > 0,
      command: line,
      speak: spoken || 'Sending that to the terminal.',
    };
  }

  if (isInstructionUtterance(utterance)) {
    const line = input.modelOk && command ? command : utterance;
    return {
      deliver: true,
      command: line,
      speak: 'Sending that to the terminal.',
    };
  }

  return { deliver: false, command: '', speak: modelSpoke };
}
