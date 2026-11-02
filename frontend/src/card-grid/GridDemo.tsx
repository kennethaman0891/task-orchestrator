import React, { useState, useId } from 'react';
import './grid.css';
import {
  type GridMode,
  GRID_GAP,
  computeResponsiveLayout,
  useElementSize,
} from './GridEngine';
import { CardGrid } from './CardGrid';
import type { CardData, CardStatus } from './GridCard';

// ── Initial Mock Data ────────────────────────────────────────────────────────

const createDefaultCards = (): CardData[] => [
  {
    id: 'card-1',
    title: 'dev-server.ts',
    type: 'active',
    status: 'running',
    cli: 'node',
    agent: 'ServerAgent',
    model: 'claude-3-5-sonnet',
    commandValue: 'vite dev --port 5173 --host',
  },
  {
    id: 'card-2',
    title: 'db-migration.sql',
    type: 'active',
    status: 'asking',
    cli: 'psql',
    agent: 'DBAdmin',
    model: 'gpt-4o',
    askingPrompt: 'DROP TABLE legacy_users CASCADE; -- Destructive schema change',
    commandValue: 'psql -d production_db -f migration_v2.sql',
  },
  {
    id: 'card-3',
    title: 'Empty Slot',
    type: 'empty',
  },
  {
    id: 'card-4',
    title: 'test-suite.py',
    type: 'active',
    status: 'stopped',
    cli: 'python',
    agent: 'PyTest',
    model: 'qwen-2.5-coder',
    commandValue: 'pytest tests/unit/ -v --cov=src',
  },
  {
    id: 'card-5',
    title: 'voice-synthesis.rs',
    type: 'active',
    status: 'running',
    cli: 'rust',
    agent: 'AudioSynth',
    model: 'gemini-1.5-pro',
    commandValue: 'cargo run --release --bin synth-stream',
  },
  {
    id: 'card-6',
    title: 'Spare Worker',
    type: 'empty',
  },
];

const DEFAULT_LOGS: Record<string, string[]> = {
  'card-1': [
    '[12:45:01] [vite] server started at http://localhost:5173/',
    '[12:45:02] [vite] page reload /src/App.tsx',
    '[12:45:05] [hmr] connected to websocket port 24678',
    '[12:45:10] [vite] 12 modules transformed in 48ms',
  ],
  'card-2': [
    '[12:44:20] CONNECT postgresql://admin@db-cluster:5432/production_db',
    '[12:44:21] BEGIN TRANSACTION isolation level serializable;',
    '[12:44:22] PRE-CHECK: Verified 142,391 user rows archived in S3.',
    '[12:44:25] ⚠️ WARNING: Statement requires operator authorization to proceed.',
  ],
  'card-4': [
    '[12:30:00] rootdir: /workspace, configfile: pytest.ini',
    '[12:30:01] collected 48 items',
    '[12:30:03] tests/unit/test_engine.py::test_packing PASSED [ 50% ]',
    '[12:30:04] tests/unit/test_layout.py::test_responsive PASSED [ 100% ]',
    '[12:30:04] ================== 48 passed in 3.12s ==================',
    '[12:30:04] Process exited with status code 0',
  ],
  'card-5': [
    '[12:40:12] Compiling audio-pipeline v0.4.1',
    '[12:40:15] Finished release [optimized] target(s) in 3.44s',
    '[12:40:16] Audio stream initialized at 48000Hz (PCM Float32, 2ch)',
    '[12:40:20] WebSocket relay client connected. Latency: 18ms',
  ],
};

// ── Component Implementation ────────────────────────────────────────────────

export const GridDemo: React.FC = () => {
  const instanceId = useId();
  const [cards, setCards] = useState<CardData[]>(createDefaultCards);
  const [cardLogs, setCardLogs] = useState<Record<string, string[]>>(DEFAULT_LOGS);
  const [mode, setMode] = useState<GridMode>('auto');
  const [templateCols, setTemplateCols] = useState<number>(4);
  const [selectedId, setSelectedId] = useState<string | null>('card-1');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Resize measurement for the container wrapping CardGrid
  const { ref: containerRef, size } = useElementSize<HTMLDivElement>();

  // Computed layout telemetry for HUD Pill
  const telemetryLayout = computeResponsiveLayout({
    count: cards.length,
    width: size.w,
    mode,
    gap: GRID_GAP,
    templateCols,
  });

  // ── Card Management Helpers ──

  const appendLog = (cardId: string, logLine: string) => {
    setCardLogs((prev) => ({
      ...prev,
      [cardId]: [...(prev[cardId] || []), logLine],
    }));
  };

  const handleAddCard = (type: 'empty' | 'running' | 'asking' | 'stopped') => {
    const newId = `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    let newCard: CardData;

    switch (type) {
      case 'empty':
        newCard = {
          id: newId,
          title: `Empty ${cards.length + 1}`,
          type: 'empty',
        };
        break;
      case 'running':
        newCard = {
          id: newId,
          title: `worker-proc-${cards.length + 1}.sh`,
          type: 'active',
          status: 'running',
          cli: 'sh',
          agent: 'Runner',
          model: 'claude-3-haiku',
          commandValue: `bash run-task-${cards.length + 1}.sh`,
        };
        appendLog(newId, `[${new Date().toLocaleTimeString()}] Process spawned (PID ${Math.floor(1000 + Math.random() * 9000)})`);
        appendLog(newId, `[${new Date().toLocaleTimeString()}] Listening on port ${8000 + cards.length}...`);
        break;
      case 'asking':
        newCard = {
          id: newId,
          title: `deploy-approval-${cards.length + 1}`,
          type: 'active',
          status: 'asking',
          cli: 'deploy',
          agent: 'Gatekeeper',
          model: 'gpt-4o',
          askingPrompt: `Promote release v1.${cards.length}.0 to PRODUCTION region us-east-1?`,
          commandValue: `terraform apply -auto-approve=false -target=module.prod`,
        };
        appendLog(newId, `[${new Date().toLocaleTimeString()}] Evaluating safety policies...`);
        appendLog(newId, `[${new Date().toLocaleTimeString()}] Approval requested for production push.`);
        break;
      case 'stopped':
        newCard = {
          id: newId,
          title: `batch-job-${cards.length + 1}`,
          type: 'active',
          status: 'stopped',
          cli: 'node',
          agent: 'BatchWorker',
          model: 'gpt-4o-mini',
          commandValue: `node scripts/etl.js --job=${cards.length + 1}`,
        };
        appendLog(newId, `[${new Date().toLocaleTimeString()}] Batch job completed in 1.82s.`);
        appendLog(newId, `[${new Date().toLocaleTimeString()}] Process terminated cleanly (code 0).`);
        break;
    }

    setCards((prev) => [...prev, newCard]);
    setSelectedId(newId);
  };

  const handleResetCards = () => {
    setCards(createDefaultCards());
    setCardLogs(DEFAULT_LOGS);
    setSelectedId('card-1');
    setExpandedId(null);
  };

  const handleCloseCard = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (expandedId === id) setExpandedId(null);
  };

  // ── Interactive Callbacks ──

  const handleAnswerPermission = (id: string, answer: 'yes' | 'no' | 'enter') => {
    const timeStr = new Date().toLocaleTimeString();
    if (answer === 'yes') {
      appendLog(id, `[${timeStr}] ✅ PERMISSION GRANTED by operator.`);
      appendLog(id, `[${timeStr}] Executing operation... Success (exit 0)`);
      setCards((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'running' as CardStatus } : c))
      );
    } else if (answer === 'no') {
      appendLog(id, `[${timeStr}] ❌ PERMISSION DENIED by operator.`);
      appendLog(id, `[${timeStr}] Operation aborted.`);
      setCards((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'stopped' as CardStatus } : c))
      );
    } else {
      appendLog(id, `[${timeStr}] ⏎ Standard input sent.`);
    }
  };

  const handleQuickLaunch = (
    id: string,
    opts: { projectPath: string; command: string; count: number }
  ) => {
    const timeStr = new Date().toLocaleTimeString();
    const cmd = opts.command || 'npm start';
    const proj = opts.projectPath || '/workspace';

    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              title: cmd,
              type: 'active',
              status: 'running',
              cli: 'sh',
              agent: 'QuickLaunch',
              model: 'auto',
              commandValue: cmd,
            }
          : c
      )
    );

    appendLog(id, `[${timeStr}] ⚡ Quick Launch started: ${cmd}`);
    appendLog(id, `[${timeStr}] Working directory: ${proj}`);
    appendLog(id, `[${timeStr}] Process spawned. Ready for input.`);
  };

  const handleSendCommand = (id: string, command: string) => {
    const timeStr = new Date().toLocaleTimeString();
    appendLog(id, `$ ${command}`);
    appendLog(id, `[${timeStr}] Output: executed "${command}" successfully.`);
  };

  const handleOpenNewCard = (id: string) => {
    const timeStr = new Date().toLocaleTimeString();
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              title: 'bash',
              type: 'active',
              status: 'running',
              cli: 'bash',
              commandValue: 'bash',
            }
          : c
      )
    );
    appendLog(id, `[${timeStr}] bash 5.2.15(1)-release interactive session opened`);
  };

  const handleAttachCard = (id: string, session: string) => {
    const timeStr = new Date().toLocaleTimeString();
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              title: session,
              type: 'active',
              status: 'running',
              cli: 'term',
              commandValue: `attach ${session}`,
            }
          : c
      )
    );
    appendLog(id, `[${timeStr}] Attached to existing terminal multiplexer: ${session}`);
  };

  // ── Render Card Body with Mock Log Stream ──

  const renderCardContent = (card: CardData) => {
    const logs = cardLogs[card.id] || [
      `$ ${card.commandValue || card.title || 'idle'}`,
      'Session attached and listening for IPC events...',
    ];

    return (
      <div
        style={{
          height: '100%',
          overflowY: 'auto',
          padding: '10px 12px',
          fontFamily: 'var(--mono)',
          fontSize: '11px',
          lineHeight: '1.5',
          color: 'var(--muted)',
          backgroundColor: '#0c0d0c',
          boxSizing: 'border-box',
          userSelect: 'text',
        }}
      >
        {logs.map((log, idx) => {
          let lineStyle: React.CSSProperties = { whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
          if (log.startsWith('$')) {
            lineStyle = { ...lineStyle, color: 'var(--accent)', fontWeight: 600 };
          } else if (log.includes('WARNING') || log.includes('⚠️')) {
            lineStyle = { ...lineStyle, color: 'var(--amber)' };
          } else if (log.includes('PASSED') || log.includes('✅') || log.includes('success')) {
            lineStyle = { ...lineStyle, color: 'var(--green)' };
          } else if (log.includes('DENIED') || log.includes('❌') || log.includes('error')) {
            lineStyle = { ...lineStyle, color: 'var(--red)' };
          }

          return (
            <div key={`${instanceId}-log-${idx}`} style={lineStyle}>
              {log}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Top Toolbar ────────────────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '8px 12px',
          backgroundColor: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        {/* Left Side: Density Mode Selection & Grid Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginRight: '4px' }}>
            Density:
          </span>
          {(['auto', 'compact', 'large', 'grid'] as GridMode[]).map((m) => {
            const isActive = mode === m;
            return (
              <button
                key={m}
                type="button"
                className={`btn small ${isActive ? 'primary' : ''}`}
                style={{
                  textTransform: 'capitalize',
                  fontWeight: isActive ? 600 : 400,
                  boxShadow: isActive ? '0 0 8px rgba(59, 156, 255, 0.4)' : 'none',
                }}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            );
          })}

          {/* Grid Mode Column Stepper */}
          {mode === 'grid' && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginLeft: '6px',
                padding: '2px 6px',
                background: '#161916',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontSize: '11px',
              }}
            >
              <span style={{ color: 'var(--muted)', marginRight: '2px' }}>Cols:</span>
              <button
                type="button"
                className="btn small"
                style={{ padding: '0 6px', height: '20px', minWidth: '20px' }}
                disabled={templateCols <= 1}
                onClick={() => setTemplateCols((prev) => Math.max(1, prev - 1))}
              >
                -
              </button>
              <strong style={{ minWidth: '16px', textAlign: 'center', color: 'var(--accent)' }}>
                {templateCols}
              </strong>
              <button
                type="button"
                className="btn small"
                style={{ padding: '0 6px', height: '20px', minWidth: '20px' }}
                disabled={templateCols >= 8}
                onClick={() => setTemplateCols((prev) => Math.min(8, prev + 1))}
              >
                +
              </button>
            </div>
          )}
        </div>

        {/* Center: Card Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn small"
            title="Add empty terminal placeholder"
            onClick={() => handleAddCard('empty')}
          >
            + Empty
          </button>
          <button
            type="button"
            className="btn small"
            title="Add running worker card"
            onClick={() => handleAddCard('running')}
          >
            + Running
          </button>
          <button
            type="button"
            className="btn small"
            style={{ color: 'var(--yellow)', borderColor: 'rgba(250, 204, 21, 0.3)' }}
            title="Add card with pending permission prompt"
            onClick={() => handleAddCard('asking')}
          >
            + Asking
          </button>
          <button
            type="button"
            className="btn small"
            title="Add stopped card"
            onClick={() => handleAddCard('stopped')}
          >
            + Stopped
          </button>
          <button
            type="button"
            className="btn small"
            style={{ color: 'var(--muted)' }}
            title="Reset cards to default initial state"
            onClick={handleResetCards}
          >
            ↺ Reset
          </button>
        </div>

        {/* Right Side: Real-time Telemetry HUD Pill */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            padding: '4px 10px',
            backgroundColor: '#141714',
            border: '1px solid #2e332e',
            borderRadius: '9999px',
            fontFamily: 'var(--mono)',
            fontSize: '11px',
            color: 'var(--muted)',
            boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.4)',
          }}
          title="Responsive Grid Telemetry"
        >
          <span>
            📏 <span style={{ color: 'var(--text)' }}>{Math.round(size.w)}×{Math.round(size.h)}</span>
          </span>
          <span style={{ color: '#3a403a' }}>|</span>
          <span>
            ▦ <span style={{ color: 'var(--accent)' }}>{telemetryLayout.cols}c × {telemetryLayout.rows}r</span>
          </span>
          <span style={{ color: '#3a403a' }}>|</span>
          <span>
            📦 <span style={{ color: 'var(--text)' }}>min {telemetryLayout.minW}×{telemetryLayout.minH}</span>
          </span>
          <span style={{ color: '#3a403a' }}>|</span>
          <span>
            📇 <span style={{ color: 'var(--green)' }}>{cards.length} cards</span>
          </span>
        </div>
      </header>

      {/* ── Main Responsive Grid Mount ────────────────────────────────────── */}
      <main
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <CardGrid
          cards={cards}
          mode={mode}
          templateCols={templateCols}
          selectedId={selectedId}
          expandedId={expandedId}
          onSelectCard={(id) => setSelectedId(id)}
          onExpandCard={(id) => setExpandedId(id)}
          onCloseCard={handleCloseCard}
          onAnswerPermission={handleAnswerPermission}
          onQuickLaunchCard={handleQuickLaunch}
          onSendCommand={handleSendCommand}
          onOpenNewCard={handleOpenNewCard}
          onAttachCard={handleAttachCard}
          renderCardContent={renderCardContent}
        />
      </main>
    </div>
  );
};

export default GridDemo;
