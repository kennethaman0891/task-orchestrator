import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronDown,
  Mic,
  MicOff,
  PhoneOff,
  Volume1,
  Volume2,
  VolumeX,
  Maximize2,
} from 'lucide-react';
import { Mascot } from './Mascot';
import type { Dot } from '../types/types';
import type { useVoice } from './useVoice';

export function CallView({
  dot,
  voice,
  onHeadingPointerDown,
}: {
  dot: Dot;
  voice: ReturnType<typeof useVoice>;
  onHeadingPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (voice.status !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [voice.status]);
  if (voice.status === 'idle') return null;
  const seconds = voice.startedAt
    ? Math.max(0, Math.floor((now - voice.startedAt) / 1000))
    : 0;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const label =
    voice.status === 'connecting'
      ? 'Connecting…'
      : voice.status === 'ending'
        ? 'Saving call…'
        : voice.muted
          ? 'Microphone muted'
          : voice.phase === 'speaking'
            ? `${dot.name} is speaking`
            : voice.phase === 'thinking'
              ? 'Working on it…'
              : 'Listening';
  return (
    <section
      className={`call-view ${minimized ? 'minimized' : ''}`}
      aria-label={`Voice call with ${dot.name}`}
    >
      <div className="call-heading" onPointerDown={onHeadingPointerDown}>
        <span>
          <span className="call-live-dot" /> Voice call
        </span>
        <button
          className="call-minimize"
          aria-label={minimized ? 'Expand call view' : 'Minimize call view'}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? <Maximize2 size={18} /> : <ChevronDown size={20} />}
        </button>
      </div>
      <div className={`call-persona ${voice.phase}`}>
        <Mascot identity={dot.id} name={dot.name} />
        <h2>{dot.name}</h2>
        <span className="call-timer" aria-label="Call duration">
          {duration}
        </span>
        <p role="status">{label}</p>
      </div>
      {!minimized && voice.pendingPrompt && (
        <div className="call-prompt-banner" role="dialog" aria-label="Terminal Permission Required">
          <div className="call-prompt-header">
            <span className="call-prompt-badge">Action Required</span>
            <span className="call-prompt-title">{voice.pendingPrompt.question}</span>
          </div>
          {voice.pendingPrompt.command && (
            <div className="call-prompt-command">
              <code>{voice.pendingPrompt.command}</code>
            </div>
          )}
          <div className="call-prompt-options">
            {voice.pendingPrompt.options.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`call-option-chip ${opt.selected ? 'selected' : ''}`}
                onClick={() => voice.selectPromptOption?.(opt.key)}
              >
                <span className="call-option-num">{opt.key}</span>
                <span className="call-option-label">{opt.label}</span>
              </button>
            ))}
          </div>
          <div className="call-prompt-voice-hint">
            🎙️ Speak <em>&quot;Yes&quot;</em>, <em>&quot;Always allow&quot;</em>, or <em>&quot;Cancel&quot;</em> — or tap an option
          </div>
        </div>
      )}
      {!minimized && (
        <div className="call-caption" aria-live="polite">
          {voice.userCaption && (
            <p className="call-user-caption">
              <small>You</small>
              {voice.userCaption}
            </p>
          )}
          <p>
            <small>{dot.name}</small>
            {voice.caption || 'Speak naturally. Your Dot is here with you.'}
          </p>
        </div>
      )}
      {voice.error && (
        <p className="call-warning" role="alert">
          {voice.error}
        </p>
      )}

      {/* Volume Control Strip */}
      {!minimized && (
        <div className="call-volume-strip">
          <button
            className="call-vol-btn"
            aria-label="Volume Down"
            title="Volume Down (-10%)"
            onClick={() => (voice as any).volumeDown?.(10)}
            disabled={voice.status !== 'active'}
          >
            <Volume1 size={15} />
          </button>
          <div className="call-vol-slider-wrap">
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={voice.speakerMuted ? 0 : ((voice as any).volume ?? 80)}
              onChange={(e) => (voice as any).setVolume?.(parseInt(e.target.value, 10))}
              aria-label="Call Volume"
              className="call-vol-slider"
            />
          </div>
          <button
            className="call-vol-btn"
            aria-label="Volume Up"
            title="Volume Up (+10%)"
            onClick={() => (voice as any).volumeUp?.(10)}
            disabled={voice.status !== 'active'}
          >
            <Volume2 size={15} />
          </button>
          <span className="call-vol-val">
            {voice.speakerMuted ? 'Muted' : `${(voice as any).volume ?? 80}%`}
          </span>
        </div>
      )}

      <div className="call-controls">
        <button
          aria-label={
            voice.speakerMuted ? 'Enable call audio' : 'Mute call audio'
          }
          aria-pressed={voice.speakerMuted}
          onClick={voice.toggleSpeaker}
          disabled={voice.status !== 'active'}
        >
          <span>{voice.speakerMuted ? <VolumeX /> : <Volume2 />}</span>
          <small>Speaker</small>
        </button>
        <button
          className="call-end"
          aria-label="End voice call"
          onClick={() => void voice.end()}
          disabled={voice.status === 'ending'}
        >
          <span>
            <PhoneOff />
          </span>
          <small>End</small>
        </button>
        <button
          aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={voice.muted}
          onClick={voice.toggleMute}
          disabled={voice.status !== 'active'}
        >
          <span>{voice.muted ? <MicOff /> : <Mic />}</span>
          <small>{voice.muted ? 'Unmute' : 'Mute'}</small>
        </button>
      </div>
      {!minimized && (
        <p className="call-footer">Text and voice share this conversation</p>
      )}
    </section>
  );
}
