import { useEffect, useRef, useState, useCallback } from 'react';

export interface WireConnection {
  from: string; // pane id
  to: string;
  label?: string;
  color?: string;
}

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Optional separate ref for the scrollable child — positions use containerRef, scroll uses scrollRef. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  connections: WireConnection[];
  itemRefs: Map<string, HTMLButtonElement>;
  /** Currently selected source pane for wire drawing (in "connecting" mode). */
  wireSource: string | null;
  /** Callback when user clicks a terminal endpoint. */
  onEndpointClick: (paneId: string) => void;
}

/**
 * Interactive SVG wire overlay.
 * - Shows animated flowing wires between connected terminals
 * - Click endpoint dots to start/end a wire connection
 * - Purple animated wires for pending connections, blue for linked
 */
// Colorful wire palette — each connection gets a different color
const WIRE_COLORS = [
  '#4a9eff',
  '#c084fc',
  '#4ade80',
  '#fb923c',
  '#f472b6',
  '#22d3ee',
  '#facc15',
  '#f87171',
];
function wireColor(index: number, preset?: string): string {
  if (preset && preset !== '#4a9eff') return preset;
  return WIRE_COLORS[index % WIRE_COLORS.length];
}

export function WireOverlay({
  containerRef,
  scrollRef,
  connections,
  itemRefs,
  wireSource,
  onEndpointClick,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<
    Array<{
      key: string;
      d: string;
      color: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      label?: string;
    }>
  >([]);

  // Endpoint positions for each terminal
  const [endpoints, setEndpoints] = useState<
    Array<{
      paneId: string;
      x: number;
      y: number;
      isConnected: boolean;
      isSource: boolean;
      color: string;
    }>
  >([]);

  const recalc = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const scroller = scrollRef?.current || container;
    const scrollY = scroller.scrollTop;
    const newEndpoints: typeof endpoints = [];
    const newPaths: typeof paths = [];

    for (const [paneId, el] of itemRefs.entries()) {
      const rect = el.getBoundingClientRect();
      const x = rect.right - containerRect.left + 8;
      const y = rect.top - containerRect.top + rect.height / 2 + scrollY;
      const connIdx = connections.findIndex((c) => c.from === paneId || c.to === paneId);
      const isConnected = connIdx >= 0;
      const isSource = wireSource === paneId;
      const color = connIdx >= 0 ? wireColor(connIdx, connections[connIdx]?.color) : '#555';
      newEndpoints.push({ paneId, x, y, isConnected, isSource, color });
    }

    connections.forEach((conn, idx) => {
      const fromEp = newEndpoints.find((e) => e.paneId === conn.from);
      const toEp = newEndpoints.find((e) => e.paneId === conn.to);
      if (!fromEp || !toEp) return;

      const color = wireColor(idx, conn.color);
      const midX = Math.max(fromEp.x, toEp.x) + 60;
      const d = `M ${fromEp.x} ${fromEp.y} C ${midX} ${fromEp.y}, ${midX} ${toEp.y}, ${toEp.x} ${toEp.y}`;

      newPaths.push({
        key: `${conn.from}-${conn.to}`,
        d,
        color,
        fromX: fromEp.x,
        fromY: fromEp.y,
        toX: toEp.x,
        toY: toEp.y,
        label: conn.label,
      });
    });

    setEndpoints(newEndpoints);
    setPaths(newPaths);
  }, [connections, itemRefs, containerRef, scrollRef, wireSource]);

  useEffect(() => {
    recalc();
    const scroller = scrollRef?.current || containerRef.current;
    if (!scroller) return;

    const onScroll = () => recalc();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', recalc);
    const interval = setInterval(recalc, 300);

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', recalc);
      clearInterval(interval);
    };
  }, [recalc, containerRef, scrollRef]);

  return (
    <svg
      ref={svgRef}
      className="wire-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
    >
      <defs>
        {paths.map((p) => (
          <linearGradient
            key={`grad-${p.key}`}
            id={`wire-grad-${p.key}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor={p.color} stopOpacity={1} />
            <stop offset="100%" stopColor={p.color} stopOpacity={0.6} />
          </linearGradient>
        ))}
        <filter id="wire-glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="ep-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Wire paths — each gets its own vibrant color */}
      {paths.map((p) => (
        <g key={p.key}>
          {/* Glow underlay */}
          <path
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={6}
            strokeOpacity={0.12}
            filter="url(#wire-glow)"
          />
          {/* Main gradient wire */}
          <path
            d={p.d}
            fill="none"
            stroke={`url(#wire-grad-${p.key})`}
            strokeWidth={2.5}
            strokeLinecap="round"
            className="wire-path"
          />
          {/* Animated flowing particles */}
          <path
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={2.5}
            strokeDasharray="4 14"
            strokeLinecap="round"
            className="wire-flow"
            strokeOpacity={0.8}
          />
          {/* Label */}
          {p.label && (
            <text
              x={(p.fromX + p.toX) / 2 + 20}
              y={(p.fromY + p.toY) / 2 - 10}
              fill={p.color}
              fontSize={10}
              fontFamily="Menlo, Monaco, SF Mono, monospace"
              textAnchor="middle"
              className="wire-label"
            >
              {p.label}
            </text>
          )}
        </g>
      ))}

      {/* Endpoint dots — interactive, colorful */}
      {endpoints.map((ep) => (
        <g key={ep.paneId} style={{ pointerEvents: 'all', cursor: 'crosshair' }}>
          {/* Outer glow ring */}
          <circle
            cx={ep.x}
            cy={ep.y}
            r={ep.isSource ? 13 : 10}
            fill={ep.isSource ? '#c084fc' : ep.color}
            fillOpacity={ep.isSource ? 0.25 : 0.15}
            className={ep.isSource ? 'wire-ep-ring-active' : 'wire-ep-ring'}
          />
          {/* Main dot */}
          <circle
            cx={ep.x}
            cy={ep.y}
            r={ep.isSource ? 6 : 5}
            fill={ep.isSource ? '#c084fc' : ep.color}
            stroke={ep.isSource ? '#c084fc' : ep.color}
            strokeWidth={2}
            className="wire-ep-dot"
            filter={ep.isSource || ep.isConnected ? 'url(#ep-glow)' : undefined}
          />
          {/* Click target (invisible, larger) */}
          <circle
            cx={ep.x}
            cy={ep.y}
            r={18}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onEndpointClick(ep.paneId);
            }}
          />
        </g>
      ))}
    </svg>
  );
}
