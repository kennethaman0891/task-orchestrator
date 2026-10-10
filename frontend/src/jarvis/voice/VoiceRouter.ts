// ═══════════════════════════════════════════════════════════════════════════
// JARVIS VOICE ROUTER (Phase 4)
// Dual-mode voice routing: Terminal-Specific (Mode 1) & Global Workstation (Mode 2)
// ═══════════════════════════════════════════════════════════════════════════

import { jarvisManager } from '../agent/JarvisManager';
import { sessionContextStore } from '../contextStore';
import { eventBus } from '../eventBus';

export interface VoiceRouteResult {
  success: boolean;
  message: string;
  targetTerminalId?: string;
  intent?: string;
  needsClarification?: boolean;
  candidateTerminals?: Array<{ id: string; name: string; cli: string }>;
}

export class VoiceRouter {
  /** Mode 1: Terminal-Specific Voice Command */
  static async routeTerminalVoice(terminalId: string, speechText: string): Promise<VoiceRouteResult> {
    const text = speechText.trim();
    if (!text) return { success: false, message: 'No speech detected' };

    const agent = jarvisManager.getAgent(terminalId);
    const ctx = sessionContextStore.get(terminalId);

    // Auto-assign Jarvis with full permissions if unassigned so voice instruction succeeds
    if (agent.status === 'UNASSIGNED') {
      agent.assign(['OBSERVE', 'READ', 'EXECUTE', 'CONTROL']);
    }

    eventBus.emit(
      'jarvis_voice_received',
      terminalId,
      'Voice Command Received',
      text,
      { mode: 'terminal_specific' },
    );

    // Intent resolution
    if (/continue|keep going|proceed|next/i.test(text)) {
      await agent.continueTask();
      return { success: true, message: `Continued task in ${ctx?.terminalName || terminalId}`, targetTerminalId: terminalId, intent: 'continue' };
    }

    if (/run\s+(the\s+)?tests?|test\s+suite/i.test(text)) {
      await agent.runTests(ctx?.cwd);
      return { success: true, message: `Running tests in ${ctx?.terminalName || terminalId}`, targetTerminalId: terminalId, intent: 'run_tests' };
    }

    if (/check\s+why|why\s+did\s+it\s+fail|investigate|debug|fix\s+error/i.test(text)) {
      const resp = await agent.investigateError();
      return { success: true, message: resp, targetTerminalId: terminalId, intent: 'check_errors' };
    }

    if (/stop|pause|halt|cancel/i.test(text)) {
      await agent.stop();
      return { success: true, message: `Interrupted process in ${ctx?.terminalName || terminalId}`, targetTerminalId: terminalId, intent: 'stop' };
    }

    // Default: assign task to Jarvis & route into PTY
    await agent.assignTask(text);
    return { success: true, message: `Assigned task to ${ctx?.terminalName || terminalId}: "${text}"`, targetTerminalId: terminalId, intent: 'custom' };
  }

  /** Mode 2: Global Workstation Voice Command */
  static async routeGlobalVoice(speechText: string): Promise<VoiceRouteResult> {
    const text = speechText.trim().toLowerCase();
    if (!text) return { success: false, message: 'No speech detected' };

    const contexts = sessionContextStore.getAll();
    const allTerminalIds = Object.keys(contexts);

    if (allTerminalIds.length === 0) {
      return { success: false, message: 'No active terminals available in workstation' };
    }

    // 1. Check for specific terminal or CLI mention in speech
    const matchedTerminals: string[] = [];

    for (const [id, ctx] of Object.entries(contexts)) {
      const cli = ctx.detectedCli.toLowerCase();
      const name = ctx.terminalName.toLowerCase();
      const ws = ctx.workspaceName.toLowerCase();

      if (
        text.includes(cli) ||
        text.includes(name) ||
        text.includes(ws) ||
        (text.includes('terminal') && text.includes(id.replace('terminal-', '')))
      ) {
        matchedTerminals.push(id);
      }
    }

    // Single clear match
    if (matchedTerminals.length === 1) {
      return this.routeTerminalVoice(matchedTerminals[0], speechText);
    }

    // Multiple matches -> Request clarification
    if (matchedTerminals.length > 1) {
      const candidates = matchedTerminals.map((id) => ({
        id,
        name: contexts[id]?.terminalName || id,
        cli: contexts[id]?.cliName || 'Shell',
      }));
      return {
        success: false,
        message: `Multiple matching terminals found for "${speechText}". Please specify which terminal.`,
        needsClarification: true,
        candidateTerminals: candidates,
      };
    }

    // Fallback: If only 1 terminal exists in the entire workstation, route to it
    if (allTerminalIds.length === 1) {
      return this.routeTerminalVoice(allTerminalIds[0], speechText);
    }

    // Fallback: Route to currently active/working terminal or ask for clarification
    const working = allTerminalIds.find((id) => contexts[id]?.state === 'running' || contexts[id]?.state === 'waiting_for_input');
    if (working) {
      return this.routeTerminalVoice(working, speechText);
    }

    return {
      success: false,
      message: 'Could not resolve target terminal. Please specify a terminal or CLI name.',
      needsClarification: true,
      candidateTerminals: allTerminalIds.map((id) => ({
        id,
        name: contexts[id]?.terminalName || id,
        cli: contexts[id]?.cliName || 'Shell',
      })),
    };
  }

  /** Transcribe audio blob via backend VoiceFlow/Whisper */
  static async transcribeAudio(blob: Blob): Promise<string> {
    try {
      const { apiBase } = await import('@/lib/api');
      const url = `${apiBase()}/api/voice/transcribe`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': blob.type || 'audio/webm',
        },
        body: blob,
      });
      if (res.ok) {
        const json = await res.json();
        return json.text || '';
      }
    } catch (e) {
      console.warn('[VoiceRouter] Backend STT transcription error:', e);
    }
    return '';
  }
}
