import { useLocalVoice } from '../hooks/useLocalVoice';
import { Mic, MicOff, Loader2, Volume2, AlertTriangle } from 'lucide-react';

interface VoiceButtonProps {
  terminalId: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onResponse?: (text: string) => void;
  className?: string;
}

export function VoiceButton({ 
  terminalId, 
  onTranscript, 
  onResponse,
  className = ''
}: VoiceButtonProps) {
  const { status, start, stop, error } = useLocalVoice({
    terminalId,
    onTranscript,
    onResponse
  });
  
  const isActive = status === 'listening' || status === 'processing' || status === 'speaking';
  const isConnecting = status === 'connecting';
  const hasError = status === 'error';
  
  const handleClick = () => {
    if (isActive) {
      stop();
    } else if (!isConnecting) {
      start();
    }
  };
  
  // Status colors
  const getButtonStyle = () => {
    const base = {
      width: 40,
      height: 40,
      borderRadius: '50%',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: isConnecting ? 'wait' : 'pointer',
      transition: 'all 0.2s ease',
      ...(className ? {} : {}) // Allow className override
    } as React.CSSProperties;
    
    if (hasError) {
      return { ...base, background: '#f59e0b', color: 'white', boxShadow: '0 0 10px #f59e0b' };
    }
    if (isActive) {
      return { ...base, background: '#ef4444', color: 'white', boxShadow: '0 0 20px #ef4444' };
    }
    // Idle state - use CSS variable for theme accent
    return { ...base, background: 'var(--accent-primary)', color: 'white' };
  };
  
  const getIcon = () => {
    if (isConnecting) return <Loader2 size={20} className="animate-spin" />;
    if (status === 'listening') return <Mic size={20} />;
    if (status === 'processing') return <Loader2 size={20} className="animate-spin" />;
    if (status === 'speaking') return <Volume2 size={20} />;
    if (hasError) return <AlertTriangle size={20} />;
    return <MicOff size={20} />;
  };
  
  const getTooltip = () => {
    switch (status) {
      case 'connecting': return 'Connecting to voice pipeline...';
      case 'listening': return 'Listening... Click to stop';
      case 'processing': return 'Processing...';
      case 'speaking': return 'Speaking response...';
      case 'error': return `Error: ${error}. Click to retry`;
      default: return 'Click to start voice input';
    }
  };
  
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isConnecting}
      style={getButtonStyle()}
      className={className}
      title={getTooltip()}
      aria-label={getTooltip()}
    >
      {getIcon()}
    </button>
  );
}
