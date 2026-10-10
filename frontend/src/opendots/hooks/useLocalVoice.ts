import { useCallback, useEffect, useRef, useState } from 'react';

interface UseLocalVoiceOptions {
  terminalId: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onResponse?: (text: string) => void;
  onError?: (error: Error) => void;
}

type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';

interface UseLocalVoiceReturn {
  status: VoiceStatus;
  start: () => Promise<void>;
  stop: () => void;
  error: string | null;
}

// Get sidecar URL - in Tauri app it's localhost, in browser it's the current host
function getSidecarUrl(): string {
  if (typeof window !== 'undefined') {
    // In browser context (Colab), use current host
    return window.location.origin;
  }
  // In Tauri, sidecar runs on localhost:8765
  return 'http://localhost:8765';
}

export function useLocalVoice({ 
  terminalId, 
  onTranscript, 
  onResponse, 
  onError 
}: UseLocalVoiceOptions): UseLocalVoiceReturn {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const isProcessingRef = useRef(false);
  
  const SIDECAR_URL = getSidecarUrl() + '/api/voice';
  
  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingRef.current = true;
    const audioContext = audioContextRef.current;
    if (!audioContext) {
      isPlayingRef.current = false;
      return;
    }
    
    while (audioQueueRef.current.length > 0) {
      const buffer = audioQueueRef.current.shift()!;
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);
      await new Promise(resolve => { source.onended = resolve; });
    }
    
    isPlayingRef.current = false;
  }, []);
  
  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      // TTS audio chunk
      if (audioContextRef.current) {
        audioContextRef.current.decodeAudioData(event.data).then(buffer => {
          audioQueueRef.current.push(buffer);
          playAudioQueue();
        }).catch(err => {
          console.error('Failed to decode audio:', err);
        });
      }
    } else if (typeof event.data === 'string') {
      // Control messages
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcript') {
          onTranscript?.(msg.text, msg.isFinal);
          if (msg.isFinal) {
            setStatus('processing');
          }
        } else if (msg.type === 'response') {
          onResponse?.(msg.text);
          setStatus('speaking');
        } else if (msg.type === 'error') {
          setError(msg.error);
          setStatus('error');
          onError?.(new Error(msg.error));
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [onTranscript, onResponse, onError, playAudioQueue]);
  
  const start = useCallback(async () => {
    if (status !== 'idle') return;
    
    try {
      setStatus('connecting');
      setError(null);
      
      // 1. Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      mediaStreamRef.current = stream;
      
      // 2. Create WebRTC peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;
      
      // Add local audio track
      const audioTrack = stream.getAudioTracks()[0];
      pc.addTrack(audioTrack, stream);
      
      // 3. Create data channel for TTS audio + control
      const dc = pc.createDataChannel('voice', { ordered: true });
      dcRef.current = dc;
      
      dc.onopen = () => {
        console.log('[Voice] Data channel opened');
        // Send terminal ID to sidecar
        dc.send(JSON.stringify({ type: 'terminal_id', terminalId }));
      };
      
      dc.onmessage = handleDataChannelMessage;
      
      dc.onclose = () => {
        console.log('[Voice] Data channel closed');
        dcRef.current = null;
      };
      
      dc.onerror = (err) => {
        console.error('[Voice] Data channel error:', err);
      };
      
      // 4. Create offer and send to sidecar
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      const response = await fetch(`${SIDECAR_URL}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: terminalId,
          sdp: offer.sdp,
          type: offer.type
        })
      });
      
      if (!response.ok) {
        throw new Error(`Offer failed: ${response.status}`);
      }
      
      const answer = await response.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      
      setStatus('listening');
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start voice';
      setError(msg);
      setStatus('error');
      onError?.(err instanceof Error ? err : new Error(msg));
      // Cleanup on error
      stop();
    }
  }, [terminalId, status, onTranscript, onResponse, onError, playAudioQueue, handleDataChannelMessage, SIDECAR_URL]);
  
  const stop = useCallback(() => {
    // Close data channel
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    
    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    
    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isProcessingRef.current = false;
    setStatus('idle');
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, [stop]);
  
  return { status, start, stop, error };
}
