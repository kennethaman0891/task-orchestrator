'use client';

import { useState, useRef, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { isLightTheme } from '@/lib/theme';
import { mediaBlobUrl } from '@/lib/api';
import { baseName, getExtension, formatBytes, isAudioFile } from '@/lib/format';
import { tauri } from '@/lib/tauri';
import {
  Film,
  Music,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Download,
  Check,
  AlertCircle,
  ExternalLink,
  FolderOpen,
} from 'lucide-react';

interface Props {
  path: string;
  loading?: boolean;
  error?: string | null;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
  const total = Math.floor(sec);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const sStr = seconds < 10 ? `0${seconds}` : `${seconds}`;
  if (hours > 0) {
    const mStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
    return `${hours}:${mStr}:${sStr}`;
  }
  return `${minutes}:${sStr}`;
}

export function VideoViewer({ path, loading: parentLoading, error: parentError }: Props) {
  const { theme: t } = useTheme();
  const isLight = isLightTheme(t);
  const bg = isLight ? '#ffffff' : '#1e1e1e';
  const subBg = isLight ? '#f3f3f3' : '#181818';
  const border = isLight ? '#e5e5e5' : '#2d2d2d';
  const text = isLight ? '#000000' : '#d4d4d4';
  const muted = isLight ? '#6c6c6c' : '#858585';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fileName = baseName(path);
  const ext = getExtension(fileName).toUpperCase();
  const isAudio = isAudioFile(fileName);
  const mediaUrl = mediaBlobUrl(path);

  // Fetch file size from backend
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        if (res.ok) {
          const data = await res.json();
          if (active && data.files && data.files.length > 0) {
            setFileSize(data.files[0].size ?? null);
          }
        }
      } catch {
        // Non-critical, ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [path]);

  // Reset state when path changes
  useEffect(() => {
    setIsPlaying(false);
    setIsMuted(false);
    setDuration(null);
    setDimensions(null);
    setMediaLoaded(false);
    setMediaError(null);
    setActionNotice(null);
  }, [path]);

  const handleTogglePlay = () => {
    const el = isAudio ? audioRef.current : videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const handleToggleMute = () => {
    const el = isAudio ? audioRef.current : videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setIsMuted(el.muted);
  };

  const handleReplay = () => {
    const el = isAudio ? audioRef.current : videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {});
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = mediaUrl;
    a.download = fileName;
    a.click();
  };

  const handleRevealInFinder = async () => {
    setActionNotice(null);
    try {
      await tauri.revealInFinder(path);
      setActionNotice('Revealed in Finder');
      setTimeout(() => setActionNotice(null), 2500);
    } catch (err: any) {
      setActionNotice(`Could not reveal: ${err?.message || err}`);
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  const handleOpenInApp = async () => {
    setActionNotice(null);
    try {
      await tauri.openUrl(path);
      setActionNotice('Opened in external app');
      setTimeout(() => setActionNotice(null), 2500);
    } catch (err: any) {
      setActionNotice(`Could not open: ${err?.message || err}`);
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  const showError = mediaError || parentError;
  const isLoading = parentLoading || (!mediaLoaded && !showError);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        flex: 1,
        background: bg,
        position: 'relative',
      }}
    >
      {/* Sub-header (mirrors CodeEditor & ImageViewer 34px status bar) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: `1px solid ${border}`,
          background: subBg,
          flexShrink: 0,
          height: '34px',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
          {isAudio ? (
            <Music size={13} style={{ color: muted, flexShrink: 0 }} />
          ) : (
            <Film size={13} style={{ color: muted, flexShrink: 0 }} />
          )}

          <span
            style={{
              fontSize: t.fontSize.xs,
              fontWeight: t.fontWeight.medium,
              color: text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fileName}
          </span>

          <span
            style={{
              fontSize: '11px',
              color: muted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            ({path})
          </span>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '10px',
              fontWeight: 600,
              color: muted,
              border: `1px solid ${border}`,
              borderRadius: '10px',
              padding: '1px 7px',
              flexShrink: 0,
            }}
          >
            <Check size={10} />
            <span>Read-only</span>
          </span>

          {ext && (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: t.colors.accent.primary,
                border: `1px solid ${border}`,
                borderRadius: '10px',
                padding: '1px 7px',
                flexShrink: 0,
              }}
            >
              {ext}
            </span>
          )}

          {dimensions && (
            <span
              style={{
                fontSize: '10px',
                color: muted,
                border: `1px solid ${border}`,
                borderRadius: '10px',
                padding: '1px 7px',
                flexShrink: 0,
              }}
            >
              {dimensions.width}×{dimensions.height}
            </span>
          )}

          {duration !== null && (
            <span
              style={{
                fontSize: '10px',
                color: muted,
                border: `1px solid ${border}`,
                borderRadius: '10px',
                padding: '1px 7px',
                flexShrink: 0,
              }}
            >
              {formatDuration(duration)}
            </span>
          )}

          {fileSize !== null && (
            <span
              style={{
                fontSize: '10px',
                color: muted,
                border: `1px solid ${border}`,
                borderRadius: '10px',
                padding: '1px 7px',
                flexShrink: 0,
              }}
            >
              {formatBytes(fileSize)}
            </span>
          )}

          {actionNotice && (
            <span
              style={{
                fontSize: '10px',
                color: t.colors.accent.primary,
                fontWeight: 500,
                animation: 'fadeIn 0.2s ease-in-out',
              }}
            >
              {actionNotice}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {mediaLoaded && !showError && (
            <>
              <button
                type="button"
                onClick={handleTogglePlay}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  border: `1px solid ${border}`,
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: '2px 8px',
                  height: '24px',
                  background: subBg,
                  color: text,
                }}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={11} /> : <Play size={11} />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleMute}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  border: `1px solid ${border}`,
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  height: '24px',
                  background: subBg,
                  color: text,
                }}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>

              <button
                type="button"
                onClick={handleReplay}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  border: `1px solid ${border}`,
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  height: '24px',
                  background: subBg,
                  color: text,
                }}
                title="Replay from start"
              >
                <RotateCcw size={11} />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              border: `1px solid ${border}`,
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '2px 8px',
              height: '24px',
              background: subBg,
              color: text,
            }}
            title="Save / Download file"
          >
            <Download size={11} />
            <span>Save</span>
          </button>

          <button
            type="button"
            onClick={handleOpenInApp}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              border: `1px solid ${border}`,
              borderRadius: '4px',
              fontSize: '11px',
              cursor: 'pointer',
              padding: '2px 6px',
              height: '24px',
              background: subBg,
              color: text,
            }}
            title="Open in Default App"
          >
            <ExternalLink size={11} />
          </button>

          <button
            type="button"
            onClick={handleRevealInFinder}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              border: `1px solid ${border}`,
              borderRadius: '4px',
              fontSize: '11px',
              cursor: 'pointer',
              padding: '2px 6px',
              height: '24px',
              background: subBg,
              color: text,
            }}
            title="Reveal in Finder"
          >
            <FolderOpen size={11} />
          </button>
        </div>
      </div>

      {/* Media Player Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          background: isLight ? '#f5f5f5' : '#141414',
        }}
      >
        {isLoading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              color: muted,
              position: 'absolute',
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                border: `2px solid ${border}`,
                borderTopColor: t.colors.accent.primary,
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span style={{ fontSize: t.fontSize.xs }}>Loading {isAudio ? 'audio' : 'video'}...</span>
          </div>
        )}

        {showError ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              color: t.colors.danger.primary,
              padding: '24px',
              textAlign: 'center',
              maxWidth: '440px',
              backgroundColor: isLight ? '#ffffff' : '#1e1e1e',
              border: `1px solid ${border}`,
              borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            }}
          >
            <AlertCircle size={32} />
            <div style={{ fontSize: t.fontSize.sm, fontWeight: 600 }}>Unable to play {isAudio ? 'audio' : 'video'}</div>
            <div style={{ fontSize: t.fontSize.xs, color: muted, lineHeight: 1.5 }}>
              {showError}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={handleOpenInApp}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: t.colors.accent.primary,
                  color: '#ffffff',
                  border: 'none',
                }}
              >
                <ExternalLink size={12} />
                <span>Open in Default App</span>
              </button>
              <button
                type="button"
                onClick={handleRevealInFinder}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: 'transparent',
                  color: text,
                  border: `1px solid ${border}`,
                }}
              >
                <FolderOpen size={12} />
                <span>Reveal in Finder</span>
              </button>
            </div>
          </div>
        ) : isAudio ? (
          /* Audio Player Card */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '20px',
              padding: '36px 48px',
              borderRadius: '12px',
              backgroundColor: isLight ? '#ffffff' : '#1e1e1e',
              border: `1px solid ${border}`,
              boxShadow: isLight ? '0 4px 24px rgba(0,0,0,0.08)' : '0 8px 32px rgba(0,0,0,0.4)',
              maxWidth: '540px',
              width: '100%',
            }}
          >
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                backgroundColor: isLight ? '#f0f0f0' : '#2a2a2a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: t.colors.accent.primary,
              }}
            >
              <Music size={32} />
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: t.fontSize.md, fontWeight: 600, color: text }}>{fileName}</div>
              <div style={{ fontSize: t.fontSize.xs, color: muted, marginTop: '4px' }}>
                {ext} Audio {duration !== null && `• ${formatDuration(duration)}`} {fileSize !== null && `• ${formatBytes(fileSize)}`}
              </div>
            </div>

            <audio
              ref={audioRef}
              src={mediaUrl}
              controls
              preload="metadata"
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                setDuration(el.duration);
                setMediaLoaded(true);
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onError={() => {
                setMediaError('Audio codec or format not supported by the embedded webview.');
              }}
              style={{ width: '100%', outline: 'none' }}
            />
          </div>
        ) : (
          /* Video Player Viewport */
          <div
            style={{
              position: 'relative',
              maxWidth: '100%',
              maxHeight: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <video
              ref={videoRef}
              src={mediaUrl}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                setDuration(el.duration);
                setDimensions({ width: el.videoWidth, height: el.videoHeight });
                setMediaLoaded(true);
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onVolumeChange={(e) => setIsMuted(e.currentTarget.muted)}
              onError={(e) => {
                const target = e.currentTarget;
                const err = target.error;
                let message = 'Unable to decode or stream video.';
                if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                  message = 'Video codec or container format is not supported by the embedded webview.';
                } else if (err?.code === MediaError.MEDIA_ERR_NETWORK) {
                  message = 'Network error occurred while fetching video.';
                } else if (err?.code === MediaError.MEDIA_ERR_DECODE) {
                  message = 'Decoding error occurred while playing video.';
                }
                setMediaError(message);
              }}
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 180px)',
                width: 'auto',
                height: 'auto',
                borderRadius: '8px',
                boxShadow: isLight
                  ? '0 6px 24px rgba(0,0,0,0.12)'
                  : '0 12px 40px rgba(0,0,0,0.7)',
                border: `1px solid ${border}`,
                backgroundColor: '#000000',
                outline: 'none',
                display: mediaLoaded || !showError ? 'block' : 'none',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
