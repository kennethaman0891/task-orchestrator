// notificationSound.ts — Web Audio synth for ambient workspace terminal alerts

const STORAGE_KEY = 'tto_notification_sound';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContextClass();
    } catch {
      return null;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export type NotificationSoundType = 'asking' | 'stopped' | 'info' | 'over' | string;

export function isNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return true;
  return window.localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(STORAGE_KEY, String(enabled));
}

/**
 * Play a low-latency Web Audio chime for terminal status events (e.g. asking for input or stopped).
 */
export function playNotificationSound(type: NotificationSoundType = 'asking'): void {
  if (!isNotificationSoundEnabled()) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'asking') {
      // Ascending chime: E5 (659.25Hz) -> B5 (987.77Hz)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.setValueAtTime(987.77, now + 0.1);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'stopped') {
      // Bell notes: A4 (440.0Hz) -> F#4 (369.99Hz)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440.0, now);
      osc.frequency.setValueAtTime(369.99, now + 0.12);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      osc.start(now);
      osc.stop(now + 0.32);
    } else if (type === 'info') {
      // Info note: G5 (784.0Hz)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(784.0, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.start(now);
      osc.stop(now + 0.25);
    } else {
      // Generic ping
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (err) {
    // Graceful degradation when audio context is blocked
    console.debug('[notificationSound] audio notification skipped:', err);
  }
}
