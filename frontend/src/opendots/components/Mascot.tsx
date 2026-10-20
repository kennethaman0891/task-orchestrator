import { useState } from 'react';

const characters = ['blue', 'mint', 'orange', 'purple'] as const;

const PALETTES = {
  blue: { body: '#38bdf8', dark: '#0284c7', glow: 'rgba(56, 189, 248, 0.4)', eyes: '#e0f2fe' },
  mint: { body: '#34d399', dark: '#059669', glow: 'rgba(52, 211, 153, 0.4)', eyes: '#ecfdf5' },
  orange: { body: '#fb923c', dark: '#d97706', glow: 'rgba(251, 146, 60, 0.4)', eyes: '#fff7ed' },
  purple: { body: '#c084fc', dark: '#7c3aed', glow: 'rgba(192, 132, 252, 0.4)', eyes: '#faf5ff' },
};

/** Stable identity keeps each specialist recognizable across views and reloads. */
function characterFor(identity?: string): typeof characters[number] {
  if (!identity) return characters[0];
  let hash = 0;
  for (const character of identity)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return characters[hash % characters.length];
}

export function Mascot({
  state = 'idle',
  small = false,
  identity,
  name = 'Jarvis',
  decorative = false,
}: {
  state?: string;
  small?: boolean;
  identity?: string;
  name?: string;
  decorative?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const char = characterFor(identity);
  const p = PALETTES[char];

  return (
    <span
      className={`mascot ${state} ${small ? 'small' : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: small ? 48 : 128,
        height: small ? 48 : 128,
        position: 'relative',
      }}
    >
      {!imgError ? (
        <img
          className="dot-body"
          src={`/dots/${char}.png`}
          alt={decorative ? '' : `${name} is ${state}`}
          width={small ? 48 : 128}
          height={small ? 48 : 128}
          draggable={false}
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <svg
          viewBox="0 0 100 100"
          width="100%"
          height="100%"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            filter: `drop-shadow(0 8px 16px ${p.glow})`,
            transition: 'transform 0.2s ease',
          }}
        >
          {/* Antenna */}
          <line x1="50" y1="20" x2="50" y2="9" stroke={p.dark} strokeWidth="4" strokeLinecap="round" />
          <circle
            cx="50"
            cy="7"
            r="5"
            fill={p.body}
            style={{
              filter: `drop-shadow(0 0 6px ${p.body})`,
              animation: state === 'speaking' || state === 'thinking' ? 'call-pulse 1s infinite' : 'none',
            }}
          />

          {/* Main Body */}
          <rect x="18" y="20" width="64" height="64" rx="24" fill={p.dark} />
          <rect x="20" y="22" width="60" height="60" rx="22" fill={p.body} />

          {/* Face Screen */}
          <rect x="28" y="32" width="44" height="34" rx="12" fill="#0f172a" />

          {/* Eyes */}
          <ellipse
            cx="40"
            cy="48"
            rx="5"
            ry={state === 'thinking' ? 2 : 6}
            fill={p.eyes}
            style={{
              transition: 'all 0.2s ease',
            }}
          />
          <ellipse
            cx="60"
            cy="48"
            rx="5"
            ry={state === 'thinking' ? 2 : 6}
            fill={p.eyes}
            style={{
              transition: 'all 0.2s ease',
            }}
          />

          {/* Smile / Voice Wave */}
          {state === 'speaking' ? (
            <path d="M42 56 Q50 63 58 56" stroke={p.eyes} strokeWidth="3" strokeLinecap="round" fill="none" />
          ) : (
            <path d="M44 57 Q50 60 56 57" stroke={p.eyes} strokeWidth="2.5" strokeLinecap="round" fill="none" />
          )}

          {/* Ears / Headset */}
          <rect x="13" y="42" width="7" height="18" rx="3" fill={p.dark} />
          <rect x="80" y="42" width="7" height="18" rx="3" fill={p.dark} />
        </svg>
      )}
    </span>
  );
}
