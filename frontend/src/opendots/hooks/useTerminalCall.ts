'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { jarvisManager } from '@/jarvis/agent/JarvisManager';
import { sessionContextStore } from '@/jarvis/contextStore';
import { apiBase } from '@/lib/api';
import type { DetectedTerminalPrompt } from '@/jarvis/terminalPromptDetector';

export interface UseTerminalCallOptions {
  terminalId: string;
  onSaved?: () => void;
}

export type CallStatus = 'idle' | 'connecting' | 'active' | 'ending';
export type CallPhase = 'listening' | 'thinking' | 'speaking';

export interface UseTerminalCallReturn {
  status: CallStatus;
  phase: CallPhase;
  startedAt: number;
  muted: boolean;
  speakerMuted: boolean;
  volume: number;
  setVolume: (v: number) => void;
  volumeUp: (step?: number) => void;
  volumeDown: (step?: number) => void;
  userCaption: string;
  caption: string;
  error: string | null;
  pendingPrompt?: DetectedTerminalPrompt | null;
  selectPromptOption?: (optionKey: string) => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  end: () => Promise<void>;
}

export function useTerminalCall({
  terminalId,
  onSaved,
}: UseTerminalCallOptions): UseTerminalCallReturn {
  const [status, setStatus] = useState<CallStatus>('connecting');
  const [phase, setPhase] = useState<CallPhase>('listening');
  const [startedAt, setStartedAt] = useState<number>(0);
  const [muted, setMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [volume, setVolumeState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('tto_call_volume');
      return saved ? Math.min(100, Math.max(0, parseInt(saved, 10))) : 80;
    } catch {
      return 80;
    }
  });
  const [userCaption, setUserCaption] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<DetectedTerminalPrompt | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);
  const activeRef = useRef(true);
  const isBotSpeakingRef = useRef(false);
  const mutedRef = useRef(false);
  const speakerMutedRef = useRef(false);
  const volumeRef = useRef(volume);
  const botSpeakTimerRef = useRef<any>(null);

  mutedRef.current = muted;
  speakerMutedRef.current = speakerMuted;
  volumeRef.current = volume;

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(v)));
    setVolumeState(clamped);
    volumeRef.current = clamped;
    try {
      localStorage.setItem('tto_call_volume', String(clamped));
    } catch {}
    if (clamped > 0 && speakerMutedRef.current) {
      setSpeakerMuted(false);
      speakerMutedRef.current = false;
    }
  }, []);

  const volumeUp = useCallback((step = 10) => {
    setVolume(volumeRef.current + step);
  }, [setVolume]);

  const volumeDown = useCallback((step = 10) => {
    setVolume(volumeRef.current - step);
  }, [setVolume]);

  // Immediately stop any bot speech output across backend & frontend
  const stopBotSpeech = useCallback(() => {
    isBotSpeakingRef.current = false;
    if (botSpeakTimerRef.current) {
      clearTimeout(botSpeakTimerRef.current);
      botSpeakTimerRef.current = null;
    }
    fetch(`${apiBase()}/api/voice/stop_speak`, { method: 'POST' }).catch(() => {});
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  }, []);

  // Speak agent response text using macOS native speech (Daniel voice) + WebSpeech fallback
  const speakResponse = useCallback((text: string) => {
    if (typeof window === 'undefined' || !activeRef.current) return;
    const cleanText = text.trim();
    if (speakerMutedRef.current || !cleanText) {
      setPhase('listening');
      return;
    }

    setPhase('speaking');
    isBotSpeakingRef.current = true;

    // Estimate speaking duration (approx 280ms per word + 1.2s padding)
    const wordCount = cleanText.split(/\s+/).length;
    const durationMs = Math.min(20000, Math.max(2200, wordCount * 280 + 1200));

    if (botSpeakTimerRef.current) clearTimeout(botSpeakTimerRef.current);
    botSpeakTimerRef.current = setTimeout(() => {
      isBotSpeakingRef.current = false;
      if (activeRef.current) {
        setPhase('listening');
      }
    }, durationMs);

    // 1. Primary: Native host TTS via backend sidecar (natural British Daniel / macOS voice with volume)
    fetch(`${apiBase()}/api/voice/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        voice: 'Daniel',
        volume: speakerMutedRef.current ? 0 : volumeRef.current,
      }),
    }).catch(() => {
      // 2. Fallback: Browser Web SpeechSynthesis
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.resume();
          const utterance = new SpeechSynthesisUtterance(cleanText);
          utterance.volume = speakerMutedRef.current ? 0 : volumeRef.current / 100;
          utterance.rate = 1.05;
          utterance.pitch = 1.0;
          utterance.onend = () => {
            isBotSpeakingRef.current = false;
            if (activeRef.current) setPhase('listening');
          };
          window.speechSynthesis.speak(utterance);
        } catch {}
      }
    });
  }, []);

  // Handle a conversational turn when speech is transcribed
  const handleTurn = useCallback(
    async (speechText: string) => {
      const text = speechText.trim();
      if (!text || !activeRef.current) return;

      // Stop any remaining speech
      stopBotSpeech();
      setPhase('thinking');
      setUserCaption(text);

      try {
        const agent = jarvisManager.getAgent(terminalId);
        const res = await agent.processVoiceTurn(text);

        if (activeRef.current) {
          setCaption(res.response);
          speakResponse(res.response);
          if (!agent.pendingPrompt) {
            setPendingPrompt(null);
          }
        }
      } catch (err: any) {
        if (activeRef.current) {
          const errText = `Could not process instruction: ${err?.message || err}`;
          setCaption(errText);
          speakResponse(errText);
        }
      }
    },
    [terminalId, speakResponse, stopBotSpeech]
  );

  // Directly select a choice option (either via click chip or voice helper)
  const selectPromptOption = useCallback(
    async (optionKey: string) => {
      const agent = jarvisManager.getAgent(terminalId);
      const res = await agent.processVoiceTurn(optionKey);
      setCaption(res.response);
      speakResponse(res.response);
      setPendingPrompt(null);
    },
    [terminalId, speakResponse]
  );

  // Initialize Call & Audio Processing
  useEffect(() => {
    activeRef.current = true;
    let cleanupVad: (() => void) | null = null;
    let cleanupRecognition: (() => void) | null = null;
    let cleanupObservation: (() => void) | null = null;

    async function initCall() {
      try {
        setStatus('connecting');
        setError(null);

        // 1. Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (!activeRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        mediaStreamRef.current = stream;
        setStatus('active');
        setStartedAt(Date.now());
        setPhase('listening');

        // Initial Greeting: Jarvis speaks aloud to confirm voice connection
        const ctx = sessionContextStore.get(terminalId);
        const cliName = ctx?.cliName || 'Antigravity';
        const greeting = `Connected to Jarvis for ${cliName}. How can I assist you?`;
        setCaption(greeting);
        speakResponse(greeting);

        // 2. AudioContext + AnalyserNode for Voice Activity Detection (VAD)
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          try {
            const audioCtx = new AudioCtx();
            audioContextRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            analyserRef.current = analyser;

            // Setup MediaRecorder for recording speech utterances
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : MediaRecorder.isTypeSupported('audio/mp4')
                ? 'audio/mp4'
                : '';

            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) {
                audioChunksRef.current.push(e.data);
              }
            };

            recorder.onstop = async () => {
              if (!activeRef.current || audioChunksRef.current.length === 0) return;
              const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
              audioChunksRef.current = [];

              if (blob.size < 3000) return; // Too small / silence

              try {
                setPhase('thinking');
                const res = await fetch(`${apiBase()}/api/voice/transcribe`, {
                  method: 'POST',
                  headers: { 'Content-Type': blob.type },
                  body: blob,
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.text && data.text.trim()) {
                    await handleTurn(data.text.trim());
                  } else {
                    if (activeRef.current) setPhase('listening');
                  }
                } else {
                  if (activeRef.current) setPhase('listening');
                }
              } catch (err) {
                console.warn('[useTerminalCall] Transcription error:', err);
                if (activeRef.current) setPhase('listening');
              }
            };

            // VAD Polling Loop: checks audio levels every 80ms
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let silenceStartTime: number | null = null;
            const SILENCE_THRESHOLD = 18; // Energy threshold
            const SILENCE_DURATION_MS = 500; // Trigger turn after 500ms silence for snappy agentic response

            const vadInterval = setInterval(() => {
              if (!activeRef.current || mutedRef.current) return;
              analyser.getByteFrequencyData(dataArray);

              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const average = sum / dataArray.length;

              if (average > SILENCE_THRESHOLD) {
                // User is actively speaking
                silenceStartTime = null;

                // Barge-in: if bot was speaking, stop it immediately
                if (isBotSpeakingRef.current) {
                  stopBotSpeech();
                  setPhase('listening');
                }

                if (!isRecordingRef.current) {
                  isRecordingRef.current = true;
                  audioChunksRef.current = [];
                  setUserCaption('(Listening to you...)');
                  try {
                    recorder.start();
                  } catch {}
                }
              } else if (isRecordingRef.current) {
                // User was speaking, now quiet
                if (silenceStartTime === null) {
                  silenceStartTime = Date.now();
                } else if (Date.now() - silenceStartTime > SILENCE_DURATION_MS) {
                  // User finished speaking utterance
                  isRecordingRef.current = false;
                  silenceStartTime = null;
                  try {
                    recorder.stop();
                  } catch {}
                }
              }
            }, 80);

            cleanupVad = () => {
              clearInterval(vadInterval);
              try {
                if (recorder.state === 'recording') recorder.stop();
              } catch {}
              try {
                audioCtx.close();
              } catch {}
            };
          } catch (e) {
            console.warn('[useTerminalCall] AudioContext VAD error:', e);
          }
        }

        // 3. Web Speech API (Fast-path in browsers where supported)
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRec) {
          try {
            const rec = new SpeechRec();
            recognitionRef.current = rec;
            rec.continuous = true;
            rec.interimResults = true;
            rec.lang = 'en-US';

            rec.onresult = (event: any) => {
              if (mutedRef.current) return;
              let final = '';
              let interim = '';

              for (let i = event.resultIndex; i < event.results.length; ++i) {
                const tr = event.results[i][0].transcript;
                if (event.results[i].isFinal) final += tr;
                else interim += tr;
              }

              const spoken = final || interim;
              if (spoken) {
                setUserCaption(spoken);
                if (isBotSpeakingRef.current) stopBotSpeech();
              }

              if (final.trim()) {
                handleTurn(final.trim());
              }
            };

            rec.onerror = () => {
              // Silently ignore in WKWebView: audio VAD handles capture
            };

            rec.onend = () => {
              if (activeRef.current && !mutedRef.current) {
                try {
                  rec.start();
                } catch {}
              }
            };

            try {
              rec.start();
            } catch {}

            cleanupRecognition = () => {
              try {
                rec.stop();
              } catch {}
            };
          } catch {}
        }

        // 4. Real-time Terminal Observation Loop (Permission Prompts & Task Completion)
        let lastObservedPromptId: string | null = null;
        const observationInterval = setInterval(() => {
          if (!activeRef.current) return;
          const agent = jarvisManager.getAgent(terminalId);
          const obs = agent.checkTerminalObservation();

          if (obs.prompt) {
            setPendingPrompt(obs.prompt);
            if (obs.prompt.id !== lastObservedPromptId) {
              lastObservedPromptId = obs.prompt.id;
              setCaption(obs.prompt.spokenPrompt);
              speakResponse(obs.prompt.spokenPrompt);
            }
          } else {
            setPendingPrompt((prev) => (prev ? null : prev));
          }

          if (obs.isCompleted) {
            const summary = obs.completedSummary || 'Task execution completed.';
            const completionMsg = `The task in ${cliName} has finished.`;
            setCaption(`✓ ${completionMsg} (${summary})`);
            speakResponse(completionMsg);
          }
        }, 600);

        cleanupObservation = () => {
          clearInterval(observationInterval);
        };
      } catch (err: any) {
        if (activeRef.current) {
          setStatus('idle');
          setError(`Microphone access error: ${err?.message || err}`);
        }
      }
    }

    initCall();

    return () => {
      activeRef.current = false;
      stopBotSpeech();
      cleanupVad?.();
      cleanupRecognition?.();
      cleanupObservation?.();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [terminalId, handleTurn, speakResponse, stopBotSpeech]);

  // Toggle Mute Microphone
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((t) => {
          t.enabled = !next;
        });
      }
      return next;
    });
  }, []);

  // Toggle Speaker Audio Output
  const toggleSpeaker = useCallback(() => {
    setSpeakerMuted((prev) => {
      const next = !prev;
      speakerMutedRef.current = next;
      if (next) {
        stopBotSpeech();
      }
      return next;
    });
  }, [stopBotSpeech]);

  // End Call
  const end = useCallback(async () => {
    setStatus('ending');
    activeRef.current = false;
    stopBotSpeech();

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    jarvisManager.endCall(terminalId);
    onSaved?.();
    setStatus('idle');
  }, [terminalId, onSaved, stopBotSpeech]);

  return {
    status,
    phase,
    startedAt,
    muted,
    speakerMuted,
    volume,
    setVolume,
    volumeUp,
    volumeDown,
    userCaption,
    caption,
    error,
    pendingPrompt,
    selectPromptOption,
    toggleMute,
    toggleSpeaker,
    end,
  };
}
