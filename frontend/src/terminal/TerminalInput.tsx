import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TerminalManager } from '@/terminal/TerminalManager';
import { extractDropPaths, shellQuotePath } from '@/terminal/dropPaths';
import { VoiceRouter } from '@/jarvis/voice/VoiceRouter';

interface TerminalInputProps {
  sessionId: string;
}

export function TerminalInput({ sessionId }: TerminalInputProps) {
  const [val, setVal] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupVoice = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      cleanupVoice();
    };
  }, [cleanupVoice]);

  const toggleVoice = async () => {
    if (listening) {
      // Stop and transcribe
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          cleanupVoice();
        }
      } else {
        cleanupVoice();
      }
      return;
    }

    setVoiceError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
      );

      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mime || 'audio/webm',
        });
        cleanupVoice();

        if (audioBlob.size > 200) {
          setVoiceBusy(true);
          try {
            const transcribed = await VoiceRouter.transcribeAudio(audioBlob);
            if (transcribed && transcribed.trim()) {
              setVal((prev) => (prev ? `${prev} ${transcribed.trim()}` : transcribed.trim()));
              inputRef.current?.focus();
            } else {
              setVoiceError('No speech detected');
            }
          } catch {
            setVoiceError('Transcription error');
          } finally {
            setVoiceBusy(false);
          }
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setListening(true);
    } catch (err) {
      console.warn('[TerminalInput] Voice recording failed:', err);
      setVoiceError('Microphone not accessible');
      cleanupVoice();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!val) return;
    TerminalManager.write(sessionId, val + '\r');
    setVal('');
    inputRef.current?.focus();
  };

  const handleDrop = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const paths = extractDropPaths(e.dataTransfer);
    if (paths && paths.length > 0) {
      const quoted = paths.map(shellQuotePath).join(' ');
      setVal((prev) => (prev ? `${prev.trimEnd()} ${quoted}` : quoted));
      inputRef.current?.focus();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  return (
    <form
      className={`ws-input${listening ? ' listening' : ''}${isDragOver ? ' drag-over' : ''}`}
      onSubmit={handleSubmit}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <span className="ws-input-prompt">❯</span>
      <input
        ref={inputRef}
        type="text"
        className="ws-input-field"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={
          voiceBusy
            ? 'transcribing…'
            : listening
            ? 'listening… (click mic to stop)'
            : 'type a command… (or drop a file in)'
        }
        spellCheck={false}
        autoComplete="off"
      />
      {voiceError && (
        <span className="ws-input-voice-error" title={voiceError}>
          {voiceError}
        </span>
      )}
      <button
        type="button"
        className={`ws-input-voice${listening ? ' listening' : ''}${voiceBusy ? ' busy' : ''}`}
        onClick={toggleVoice}
        disabled={voiceBusy}
        title={
          voiceBusy
            ? 'Transcribing…'
            : listening
            ? 'Stop recording'
            : 'Speak a command instead of typing'
        }
        aria-label={listening ? 'Stop voice input' : 'Voice command input'}
      >
        {voiceBusy ? (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden="true"
            className="ws-mic-spin"
          >
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        ) : listening ? (
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="6" fill="currentColor" />
          </svg>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="2.5" width="6" height="11" rx="3" />
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" />
          </svg>
        )}
      </button>
    </form>
  );
}
