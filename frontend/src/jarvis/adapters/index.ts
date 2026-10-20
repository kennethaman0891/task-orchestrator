import type { ICLIAdapter, CLIAdapterResult, SessionContext } from '../types';
import { AntigravityAdapter } from './AntigravityAdapter';
import { CodexAdapter } from './CodexAdapter';
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter';
import { GeminiAdapter } from './GeminiAdapter';
import { OpenCodeAdapter } from './OpenCodeAdapter';
import { CursorAdapter } from './CursorAdapter';
import { QwenAdapter } from './QwenAdapter';
import { PrimeAgentAdapter } from './PrimeAgentAdapter';
import { GenericShellAdapter } from './GenericShellAdapter';

export const ADAPTERS: ICLIAdapter[] = [
  new AntigravityAdapter(),
  new CodexAdapter(),
  new ClaudeCodeAdapter(),
  new OpenCodeAdapter(),
  new GeminiAdapter(),
  new CursorAdapter(),
  new QwenAdapter(),
  new PrimeAgentAdapter(),
  new GenericShellAdapter(), // Fallback last
];

export function detectCLI(
  bufferLines: string[],
  processCli?: string,
  ttyAgent?: string,
  currentContext?: Partial<SessionContext>,
): CLIAdapterResult {
  const p = (processCli || '').toLowerCase().trim();
  const a = (ttyAgent || '').toLowerCase().trim();

  // Phase 0: Ground Truth OS Process Inspection
  // If the operating system or PTY explicitly reports that Antigravity is running,
  // believe the process ground truth immediately.
  if (p === 'antigravity' || p === 'agy' || p === 'jetski' || a === 'antigravity' || a === 'agy') {
    const antigravityAdapter = ADAPTERS.find((ad) => ad.id === 'antigravity');
    if (antigravityAdapter) {
      return antigravityAdapter.parse(bufferLines, currentContext);
    }
  }

  // Phase 1: High-fidelity buffer detection (active screen ground truth).
  // Check ALL adapters that implement detectBuffer, and pick the one with the
  // strongest evidence (highest match count). This prevents a single shared
  // pattern from hijacking detection away from the correct CLI.
  if (bufferLines && bufferLines.length > 0) {
    let bestAdapter: ICLIAdapter | null = null;
    let bestScore = 0;

    for (const adapter of ADAPTERS) {
      if (adapter.id === 'shell') continue;
      if (typeof (adapter as any).detectBuffer !== 'function') continue;

      if ((adapter as any).detectBuffer(bufferLines)) {
        // Count how many distinct signature patterns match to score confidence
        const score = scoreBufferMatch(adapter.id, bufferLines);
        if (score > bestScore) {
          bestScore = score;
          bestAdapter = adapter;
        }
      }
    }

    if (bestAdapter) {
      return bestAdapter.parse(bufferLines, currentContext);
    }
  }

  // Phase 2: Metadata / process / adapter detection fallback
  for (const adapter of ADAPTERS) {
    if (adapter.detect(bufferLines, processCli, ttyAgent)) {
      return adapter.parse(bufferLines, currentContext);
    }
  }
  return {
    detected: false,
    cli: 'unknown',
    cliName: 'Unknown Process',
    state: 'idle',
  };
}

/**
 * Score how strongly the buffer matches a specific CLI adapter.
 * Each independent regex is one point. The adapter with the most
 * matching signatures is the highest-confidence detection.
 */
function scoreBufferMatch(adapterId: string, bufferLines: string[]): number {
  const text = bufferLines.join('\n');
  let score = 0;

  if (adapterId === 'antigravity') {
    const patterns = [
      /\bantigravity\b/i,
      /\bagy\b/i,
      /antigravity-cli/i,
      /google\s+antigravity/i,
      /google\s+deepmind/i,
      /advanced agentic coding/i,
      /BypassSandbox/i,
      /Requesting permission for:/i,
      /\/goal\b/i,
      /\/boost\b/i,
      /\/grill-me\b/i,
      /\/teamwork\b/i,
      /thought for\s+\d+/i,
    ];
    for (const p of patterns) { if (p.test(text)) score++; }
  } else if (adapterId === 'codex') {
    const patterns = [
      /\bcodex\b/i,
      /openai-codex/i,
      /codex-cli/i,
      /openai\s+codex/i,
      /codex\s*>/i,
    ];
    for (const p of patterns) { if (p.test(text)) score++; }
  } else if (adapterId === 'cursor') {
    const patterns = [
      /cursor-agent/i,
      /cursor\s+ai\b/i,
      /\bcursor-cli\b/i,
    ];
    for (const p of patterns) { if (p.test(text)) score++; }
  } else if (adapterId === 'opencode') {
    const patterns = [
      /opencode/i,
      /ask anything\b/i,
      /tab agents\b/i,
      /ctrl\+p commands\b/i,
      /build\s*[·•]\s*\S+\s+\S+/i,
      /plan\s*[·•]\s*\S+\s+\S+/i,
      /\/connect\s+to\s+add/i,
      /\b\d+\s*mcp\s*\/status/i,
      /mcp\s*\/status\s*\d+\.\d+\.\d+/i,
    ];
    for (const p of patterns) { if (p.test(text)) score++; }
  } else if (adapterId === 'claude') {
    // If text contains Antigravity signatures, disqualify Claude completely
    if (/\bantigravity\b|\bagy\b|google\s+(antigravity|deepmind)|advanced agentic coding|BypassSandbox/i.test(text)) {
      return 0;
    }
    const patterns = [
      /claude\s+code\b/i,
      /anthropics?\/claude\b/i,
      /@anthropic-ai\/claude/i,
      /welcome to claude\b/i,
      /\bauto mode on\b/i,
      /shift\+tab to cycle\b/i,
      /api usage billing\b/i,
      /laguna-/i,
    ];
    for (const p of patterns) { if (p.test(text)) score++; }
  } else if (adapterId === 'gemini') {
    const patterns = [/gemini-cli/i, /google-genai/i, /gemini\s+model/i, /gemini\s+cli/i];
    for (const p of patterns) { if (p.test(text)) score++; }
  } else if (adapterId === 'qwen') {
    const patterns = [/qwen-cli/i, /qwen2\.5/i, /tongyi\s+qianwen/i];
    for (const p of patterns) { if (p.test(text)) score++; }
  } else if (adapterId === 'prime' || adapterId === 'prime-agent') {
    const patterns = [
      /\bprime-agent\b/i,
      /\bprimeagent\b/i,
      /prime\s+intellect/i,
      /\bprime\s+run\b/i,
      /\bprime\s+task\b/i,
      /\bprime\s+agent\b/i,
      /prime\s*>/i,
    ];
    for (const p of patterns) { if (p.test(text)) score++; }
  } else {
    score = 1; // Default: detectBuffer returned true, so at least 1
  }

  return score;
}


