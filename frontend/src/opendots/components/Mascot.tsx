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
            filter: `drop-shadow(0 10px 20px ${p.glow})`,
            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <defs>
            <linearGradient id={`chassisGrad-${char}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={p.body} />
              <stop offset="100%" stopColor={p.dark} />
            </linearGradient>
            <linearGradient id={`visorGloss-${char}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.28)" />
              <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
            </linearGradient>
            <filter id={`eyeGlow-${char}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Antenna */}
          <line x1="50" y1="18" x2="50" y2="7" stroke={p.dark} strokeWidth="3.5" strokeLinecap="round" />
          <circle
            cx="50"
            cy="6"
            r="4.5"
            fill={p.body}
            style={{
              filter: `drop-shadow(0 0 8px ${p.body})`,
              animation: state === 'speaking' || state === 'thinking' || state === 'listening' ? 'call-pulse 1.2s infinite' : 'none',
            }}
          />
          {(state === 'speaking' || state === 'listening') && (
            <path
              d="M41 4 A11 11 0 0 1 59 4"
              stroke={p.body}
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
              opacity="0.75"
              className="mascot-antenna-wave"
            />
          )}

          {/* Headset / Ears */}
          <rect x="12" y="38" width="7" height="24" rx="3.5" fill={p.dark} />
          <rect x="14" y="42" width="3" height="16" rx="1.5" fill={p.body} opacity="0.9" />
          <rect x="81" y="38" width="7" height="24" rx="3.5" fill={p.dark} />
          <rect x="83" y="42" width="3" height="16" rx="1.5" fill={p.body} opacity="0.9" />

          {/* Main Body Chassis */}
          <rect x="18" y="18" width="64" height="64" rx="22" fill={p.dark} />
          <rect x="19" y="19" width="62" height="62" rx="21" fill={`url(#chassisGrad-${char})`} />
          <rect x="22" y="21" width="56" height="24" rx="14" fill="#ffffff" opacity="0.12" />

          {/* Face Screen Visor */}
          <rect
            x="26"
            y="30"
            width="48"
            height="38"
            rx="14"
            fill="#090d16"
            stroke="rgba(255, 255, 255, 0.12)"
            strokeWidth="1.2"
          />
          {/* Visor Gloss Reflection */}
          <path
            d="M28 32 C38 30, 62 30, 72 32 C70 41, 30 41, 28 32 Z"
            fill={`url(#visorGloss-${char})`}
          />

          {/* Eyes */}
          {state === 'thinking' ? (
            <>
              <line
                x1="34"
                y1="46"
                x2="46"
                y2="46"
                stroke={p.eyes}
                strokeWidth="3.5"
                strokeLinecap="round"
                filter={`url(#eyeGlow-${char})`}
                className="mascot-thinking-bar"
              />
              <line
                x1="54"
                y1="46"
                x2="66"
                y2="46"
                stroke={p.eyes}
                strokeWidth="3.5"
                strokeLinecap="round"
                filter={`url(#eyeGlow-${char})`}
                className="mascot-thinking-bar"
              />
            </>
          ) : state === 'speaking' ? (
            <>
              <ellipse
                cx="39"
                cy="44"
                rx="5.5"
                ry="5.5"
                fill={p.eyes}
                filter={`url(#eyeGlow-${char})`}
              />
              <circle cx="39.5" cy="43.5" r="2" fill="#090d16" />
              <ellipse
                cx="61"
                cy="44"
                rx="5.5"
                ry="5.5"
                fill={p.eyes}
                filter={`url(#eyeGlow-${char})`}
              />
              <circle cx="61.5" cy="43.5" r="2" fill="#090d16" />
            </>
          ) : state === 'listening' ? (
            <>
              <ellipse
                cx="39"
                cy="45"
                rx="5"
                ry="6"
                fill={p.eyes}
                filter={`url(#eyeGlow-${char})`}
              />
              <circle cx="39" cy="45" r="2.2" fill={p.dark} />
              <ellipse
                cx="61"
                cy="45"
                rx="5"
                ry="6"
                fill={p.eyes}
                filter={`url(#eyeGlow-${char})`}
              />
              <circle cx="61" cy="45" r="2.2" fill={p.dark} />
            </>
          ) : (
            <>
              <ellipse
                cx="39"
                cy="46"
                rx="4.5"
                ry="5.5"
                fill={p.eyes}
              />
              <ellipse
                cx="61"
                cy="46"
                rx="4.5"
                ry="5.5"
                fill={p.eyes}
              />
            </>
          )}

          {/* Mouth / Dynamic Audio Reactivity */}
          {state === 'speaking' ? (
            <g className="mascot-speaking-eq">
              <line x1="42" y1="57" x2="42" y2="53" stroke={p.eyes} strokeWidth="2.5" strokeLinecap="round" className="meq-1" />
              <line x1="46" y1="58" x2="46" y2="50" stroke={p.eyes} strokeWidth="2.5" strokeLinecap="round" className="meq-2" />
              <line x1="50" y1="59" x2="50" y2="48" stroke={p.eyes} strokeWidth="2.5" strokeLinecap="round" className="meq-3" />
              <line x1="54" y1="58" x2="54" y2="50" stroke={p.eyes} strokeWidth="2.5" strokeLinecap="round" className="meq-4" />
              <line x1="58" y1="57" x2="58" y2="53" stroke={p.eyes} strokeWidth="2.5" strokeLinecap="round" className="meq-5" />
            </g>
          ) : state === 'thinking' ? (
            <g className="mascot-thinking-dots">
              <circle cx="44" cy="56" r="1.8" fill={p.eyes} opacity="0.5" className="mdot-1" />
              <circle cx="50" cy="56" r="2.2" fill={p.eyes} opacity="0.9" className="mdot-2" />
              <circle cx="56" cy="56" r="1.8" fill={p.eyes} opacity="0.5" className="mdot-3" />
            </g>
          ) : state === 'listening' ? (
            <path
              d="M43 54 Q50 61 57 54"
              stroke={p.eyes}
              strokeWidth="2.5"
              strokeLinecap="round"
              fill="none"
            />
          ) : (
            <path
              d="M44 55 Q50 59 56 55"
              stroke={p.eyes}
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </svg>
      )}
    </span>
  );
}
