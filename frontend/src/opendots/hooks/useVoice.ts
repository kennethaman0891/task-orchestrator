import { useTerminalCall, type UseTerminalCallReturn } from './useTerminalCall';

export { useTerminalCall, type UseTerminalCallReturn };

/**
 * OpenDots useVoice compatibility adapter that routes voice calls directly to
 * the terminal's JarvisAgent and JarvisManager.
 */
export function useVoice(
  terminalOrThreadId: string,
  onSaved?: () => void,
  _lastMessageId?: string
): UseTerminalCallReturn {
  const terminalId = terminalOrThreadId.replace(/^thread-/, '').replace(/^chat-/, '');
  return useTerminalCall({ terminalId, onSaved });
}
