'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

interface IntroVideoProps {
  onComplete: () => void;
}

export function IntroVideo({ onComplete }: IntroVideoProps) {
  const { theme: t } = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener?.('change', handler);
    return () => mediaQuery.removeEventListener?.('change', handler);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      onComplete();
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => setIsLoading(false);
    const handleError = () => {
      setHasError(true);
      setIsLoading(false);
      // Auto-fallback so app never stalls if media fails
      setTimeout(onComplete, 1200);
    };
    const handleEnded = () => onComplete();

    if (video.readyState >= 2) {
      setIsLoading(false);
    }

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('playing', handleCanPlay);
    video.addEventListener('error', handleError);
    video.addEventListener('ended', handleEnded);

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay blocked — user must interact
        setIsLoading(false);
      });
    }

    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('playing', handleCanPlay);
      video.removeEventListener('error', handleError);
      video.removeEventListener('ended', handleEnded);
    };
  }, [onComplete, prefersReducedMotion]);

  const handleSkip = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
    }
    onComplete();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      handleSkip();
    }
  };

  if (prefersReducedMotion || hasError) {
    return (
      <div
        ref={containerRef}
        onClick={handleSkip}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label="Skip intro"
        style={{
          width: '100vw',
          height: '100vh',
          background: t.colors.bg.primary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: t.colors.text.secondary,
          fontFamily: t.fontFamily.sans,
          fontSize: 14,
        }}
      >
        Click or press any key to continue
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onClick={handleSkip}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label="Skip intro video"
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        background: t.colors.bg.primary,
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        src="/videos/promo.mp4"
        autoPlay
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: isLoading ? 0 : 1,
          transition: 'opacity 300ms ease-out',
        }}
        aria-hidden="true"
      />
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: t.colors.bg.primary,
            zIndex: 1,
            transition: 'opacity 300ms ease-out',
            opacity: isLoading ? 1 : 0,
            pointerEvents: 'none',
          }}
        >
          <style>
            {`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}
          </style>
          <div
            style={{
              width: 32,
              height: 32,
              border: `3px solid ${t.colors.border.subtle}`,
              borderTopColor: t.colors.accent.primary,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          color: 'rgba(255,255,255,0.6)',
          fontSize: 12,
          fontFamily: t.fontFamily.sans,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        Click or press any key to skip
      </div>
    </div>
  );
}