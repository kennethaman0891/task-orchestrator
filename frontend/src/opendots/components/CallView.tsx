import { useEffect, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronDown,
  Mic,
  MicOff,
  PhoneOff,
  Volume1,
  Volume2,
  VolumeX,
  Maximize2,
  Radio,
  Sparkles,
  Send,
  Terminal,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import { Mascot } from './Mascot';
import type { Dot } from '../types/types';
import type { useVoice } from './useVoice';

/**
 * Dynamic Audio Frequency Visualizer
 * Simulates high-precision acoustic equalizer waves tailored to speech phases.
 */
function VoiceVisualizer({
  phase,
  muted,
  minimized,
}: {
  phase: string;
  muted?: boolean;
  minimized?: boolean;
}) {
  // Center-weighted distribution multipliers for organic frequency spectrum curve
  const weights = minimized
    ? [0.35, 0.65, 0.95, 1.0, 0.95, 0.65, 0.35]
    : [0.2, 0.35, 0.55, 0.72, 0.88, 0.96, 1.0, 0.94, 0.86, 0.94, 1.0, 0.96, 0.88, 0.72, 0.55, 0.35, 0.2];

  return (
    <div
      className={`call-visualizer-container ${minimized ? 'minimized' : ''} phase-${phase} ${
        muted ? 'muted' : ''
      }`}
      aria-hidden="true"
    >
      <div className="call-visualizer-bars">
        {weights.map((weight, i) => {
          const delay = (i * 0.08 - 0.6).toFixed(2);
          const duration = (0.7 + (i % 5) * 0.12).toFixed(2);
          return (
            <span
              key={i}
              className="call-visualizer-bar"
              style={
                {
                  '--weight': weight,
                  '--delay': `${delay}s`,
                  '--duration': `${duration}s`,
                } as React.CSSProperties
              }
            />
          );
        })}
      </div>
      {!minimized && (
        <div className="call-visualizer-glow" />
      )}
    </div>
  );
}

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
  const [taskDraft, setTaskDraft] = useState('');
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

  const currentVolume = (voice as any).volume ?? 80;

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

  const phaseIcon =
    voice.muted ? (
      <MicOff size={13} />
    ) : voice.phase === 'speaking' ? (
      <Radio size={13} className="pulse-icon" />
    ) : voice.phase === 'thinking' ? (
      <Sparkles size={13} className="spin-icon" />
    ) : (
      <Mic size={13} />
    );

  return (
    <section
      className={`call-view ${minimized ? 'minimized' : ''} phase-${voice.phase} ${
        voice.muted ? 'call-muted' : ''
      }`}
      aria-label={`Voice call with ${dot.name}`}
    >
      {/* Ambient Animated Aurora Mesh Light Field */}
      <div className="call-aurora-mesh" aria-hidden="true">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      {/* Cybernetic Session Header */}
      <div className="call-heading" onPointerDown={onHeadingPointerDown}>
        <div className="call-heading-left">
          <div className="call-live-badge">
            <span className="call-live-dot" />
            <Radio size={11} className="call-badge-icon" />
            <span>LIVE SESSION</span>
          </div>
          {!minimized && <span className="call-quality-pill">HD Audio • 48 kHz</span>}
        </div>

        <div className="call-heading-right">
          <div className="call-timer-badge" aria-label="Call duration">
            <Activity size={12} className="call-timer-icon" />
            <span>{duration}</span>
          </div>

          <button
            className="call-minimize"
            aria-label={minimized ? 'Expand call view' : 'Minimize call view'}
            onClick={() => setMinimized(!minimized)}
            title={minimized ? 'Expand call' : 'Minimize call'}
          >
            {minimized ? <Maximize2 size={15} /> : <ChevronDown size={17} />}
          </button>
        </div>
      </div>

      {/* AI Persona & Dynamic Mascot Area */}
      <div className={`call-persona ${voice.phase} ${minimized ? 'minimized' : ''}`}>
        <div className="call-avatar-stage">
          {/* Radiant Ambient Aura Halo */}
          <div
            className={`call-persona-aura ${voice.phase} ${voice.muted ? 'muted' : ''}`}
            aria-hidden="true"
          >
            <div className="call-aura-ring ring-1" />
            <div className="call-aura-ring ring-2" />
            <div className="call-aura-pulse-core" />
          </div>

          <div className="call-mascot-wrap">
            <Mascot identity={dot.id} name={dot.name} state={voice.phase} small={minimized} />
          </div>
        </div>

        <div className="call-persona-info">
          <h2>{dot.name}</h2>
          <div
            className={`call-status-capsule ${voice.phase} ${voice.muted ? 'muted' : ''}`}
            role="status"
          >
            <span className="call-status-icon">{phaseIcon}</span>
            <span className="call-status-label">{label}</span>
          </div>

          {/* Fluid Real-Time Audio Frequency EQ Visualizer */}
          <VoiceVisualizer phase={voice.phase} muted={voice.muted} minimized={minimized} />
        </div>
      </div>

      {/* Action Required Terminal Permission Banner */}
      {!minimized && voice.pendingPrompt && (
        <div className="call-prompt-banner" role="dialog" aria-label="Terminal Permission Required">
          <div className="call-prompt-header">
            <div className="call-prompt-badge">
              <ShieldAlert size={12} />
              <span>Action Required</span>
            </div>
            <span className="call-prompt-title">{voice.pendingPrompt.question}</span>
          </div>

          {voice.pendingPrompt.command && (
            <div className="call-prompt-command">
              <span className="call-prompt-shell-prompt">❯</span>
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
            <Mic size={11} className="call-hint-icon" />
            <span>
              Speak <em>&quot;Yes&quot;</em>, <em>&quot;Always allow&quot;</em>, or <em>&quot;Cancel&quot;</em> — or tap an option
            </span>
          </div>
        </div>
      )}

      {/* Sleek Floating Glass Dialogue Capsules */}
      {!minimized && (
        <div className="call-caption-stream" aria-live="polite">
          {voice.userCaption && (
            <div className="call-dialogue-bubble user">
              <div className="dialogue-meta">
                <span className="dialogue-sender">You</span>
              </div>
              <p className="dialogue-text">{voice.userCaption}</p>
            </div>
          )}

          <div className="call-dialogue-bubble agent">
            <div className="dialogue-meta">
              <span className="dialogue-sender">{dot.name}</span>
              <span className="dialogue-tag">AI Agent</span>
              {voice.phase === 'speaking' && (
                <span className="dialogue-live-badge">
                  <Radio size={9} />
                  <span>Transmitting</span>
                </span>
              )}
            </div>
            <p className="dialogue-text">
              {voice.caption || 'Speak naturally. Your Dot is listening.'}
              {(voice.phase === 'speaking' || voice.phase === 'thinking') && (
                <span className="dialogue-cursor" />
              )}
            </p>
          </div>
        </div>
      )}

      {/* Warning/Error Toast */}
      {voice.error && (
        <p className="call-warning" role="alert">
          {voice.error}
        </p>
      )}

      {/* Ultra-Modern Glowing Neon Volume Control Strip */}
      {!minimized && (
        <div className="call-volume-strip">
          <button
            className="call-vol-btn"
            aria-label="Volume Down"
            title="Volume Down (-10%)"
            onClick={() => (voice as any).volumeDown?.(10)}
            disabled={voice.status !== 'active'}
          >
            <Volume1 size={14} />
          </button>
          <div
            className="call-vol-slider-wrap"
            style={{ '--vol-pct': `${voice.speakerMuted ? 0 : currentVolume}%` } as React.CSSProperties}
          >
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={voice.speakerMuted ? 0 : currentVolume}
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
            <Volume2 size={14} />
          </button>
          <span className="call-vol-val">
            {voice.speakerMuted ? 'Muted' : `${currentVolume}%`}
          </span>
        </div>
      )}

      {/* Futuristic Floating Sculpted Call Control Deck */}
      <div className="call-controls">
        <div className="call-controls-deck">
          <button
            className={`call-ctrl-btn speaker-btn ${voice.speakerMuted ? 'muted' : 'active'}`}
            aria-label={voice.speakerMuted ? 'Enable call audio' : 'Mute call audio'}
            aria-pressed={voice.speakerMuted}
            onClick={voice.toggleSpeaker}
            disabled={voice.status !== 'active'}
          >
            <span className="call-ctrl-icon-wrap">
              {voice.speakerMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </span>
            <small>{voice.speakerMuted ? 'Unmute' : 'Speaker'}</small>
          </button>

          <button
            className="call-ctrl-btn call-end"
            aria-label="End voice call"
            onClick={() => void voice.end()}
            disabled={voice.status === 'ending'}
          >
            <span className="call-ctrl-icon-wrap">
              <PhoneOff size={21} />
            </span>
            <small>End</small>
          </button>

          <button
            className={`call-ctrl-btn mic-btn ${voice.muted ? 'muted' : 'active'}`}
            aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={voice.muted}
            onClick={voice.toggleMute}
            disabled={voice.status !== 'active'}
          >
            <span className="call-ctrl-icon-wrap">
              {voice.muted ? <MicOff size={19} /> : <Mic size={19} />}
              {!voice.muted && <span className="mic-live-pulse" />}
            </span>
            <small>{voice.muted ? 'Unmute' : 'Mute'}</small>
          </button>
        </div>
      </div>

      {/* Cybernetic Command / Task Pill Input */}
      {!minimized && (
        <form
          className="call-task-row"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const task = taskDraft.trim();
            if (!task || voice.status !== 'active') return;
            setTaskDraft('');
            void voice.sendTask(task);
          }}
        >
          <div className="call-task-capsule">
            <Terminal size={14} className="call-task-icon" />
            <input
              className="call-task-input"
              value={taskDraft}
              placeholder="Send a prompt or command to this terminal…"
              aria-label="Send a prompt or command to this terminal"
              onChange={(event) => setTaskDraft(event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              disabled={voice.status !== 'active'}
            />
            <kbd className="call-task-kbd">↵</kbd>
          </div>
          <button
            type="submit"
            className="call-task-send"
            disabled={voice.status !== 'active' || !taskDraft.trim()}
            title="Send to terminal"
          >
            <Send size={13} />
            <span>Send</span>
          </button>
        </form>
      )}
    </section>
  );
}
