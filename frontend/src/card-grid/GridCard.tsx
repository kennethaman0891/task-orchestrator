import React, { useState } from 'react';
import './grid.css';

export type CardType = 'empty' | 'active';
export type CardStatus = 'running' | 'asking' | 'stopped' | 'closed';

export interface CardData {
  id: string;
  title: string;
  type: CardType;
  status?: CardStatus;
  cli?: string;
  agent?: string;
  model?: string;
  askingPrompt?: string;
  commandValue?: string;
  content?: React.ReactNode;
}

export interface GridCardProps {
  card: CardData;
  isSelected?: boolean;
  isExpanded?: boolean;
  onSelect?: (id: string) => void;
  onExpand?: (id: string) => void;
  onFocus?: (id: string) => void;
  onClose?: (id: string) => void;
  onAttach?: (id: string, session: string) => void;
  onOpenNew?: (id: string) => void;
  onQuickLaunch?: (id: string, opts: { projectPath: string; command: string; count: number }) => void;
  onAnswerPermission?: (id: string, answer: 'yes' | 'no' | 'enter') => void;
  onSendCommand?: (id: string, command: string) => void;
  children?: React.ReactNode;
}

export const GridCard: React.FC<GridCardProps> = ({
  card,
  isSelected = false,
  isExpanded = false,
  onSelect,
  onExpand,
  onFocus,
  onClose,
  onAttach,
  onOpenNew,
  onQuickLaunch,
  onAnswerPermission,
  onSendCommand,
  children,
}) => {
  // Empty State: Quick Launch form controls
  const [showQuickLaunch, setShowQuickLaunch] = useState(false);
  const [projectPath, setProjectPath] = useState('');
  const [command, setCommand] = useState('');
  const [count, setCount] = useState(1);

  // Active State: Bottom input bar
  const [inputCommand, setInputCommand] = useState(card.commandValue || '');

  const handleLaunch = (e: React.MouseEvent) => {
    e.stopPropagation();
    onQuickLaunch?.(card.id, {
      projectPath: projectPath.trim(),
      command: command.trim(),
      count: Math.max(1, count),
    });
    setShowQuickLaunch(false);
  };

  const handleSendCommand = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputCommand.trim();
    if (trimmed && onSendCommand) {
      onSendCommand(card.id, trimmed);
      setInputCommand('');
    }
  };

  const statusClass = card.status ? ` ws-pane-status-${card.status}` : '';
  const selectedClass = isSelected ? ' ws-pane-selected' : '';
  const expandedClass = isExpanded ? ' ws-pane-expanded' : '';

  if (card.type === 'empty') {
    return (
      <div
        className={`ws-pane ws-pane-empty${selectedClass}${expandedClass}`}
        data-card-id={card.id}
        data-card-type="empty"
        onClick={() => onSelect?.(card.id)}
      >
        {showQuickLaunch ? (
          <div className="ql-form" onClick={(e) => e.stopPropagation()}>
            <div className="ql-title">⚡ Quick Launch</div>
            <input
              type="text"
              className="ql-input"
              placeholder="Project Path (/path/to/project)"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              autoFocus
            />
            <input
              type="text"
              className="ql-input"
              placeholder="Command (e.g. npm test)"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <div className="ql-row">
              <span className="ql-label">Count:</span>
              <input
                type="number"
                min={1}
                max={16}
                className="ql-num"
                value={count}
                onChange={(e) => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
            <div className="ql-actions">
              <button
                type="button"
                className="btn small primary"
                onClick={handleLaunch}
              >
                Launch
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => setShowQuickLaunch(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <select
              className="ws-pane-assign"
              defaultValue=""
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                if (e.target.value) {
                  onAttach?.(card.id, e.target.value);
                  e.target.value = '';
                }
              }}
            >
              <option value="" disabled>
                Open / attach terminal...
              </option>
              <option value="session-1">Session 1 (bash)</option>
              <option value="session-2">Session 2 (claude)</option>
              <option value="session-3">Session 3 (node)</option>
              <option value="session-4">Session 4 (python)</option>
            </select>

            <button
              type="button"
              className="btn small"
              onClick={(e) => {
                e.stopPropagation();
                onOpenNew?.(card.id);
              }}
            >
              + Open new terminal
            </button>

            <button
              type="button"
              className="btn small ql-trigger"
              onClick={(e) => {
                e.stopPropagation();
                setShowQuickLaunch(true);
              }}
            >
              ⚡ Quick Launch
            </button>
          </>
        )}
      </div>
    );
  }

  // Active Card State
  const cliLabel = (card.cli || card.agent || 'SH').slice(0, 2).toUpperCase();

  return (
    <div
      className={`ws-pane ws-pane-term${selectedClass}${expandedClass}${statusClass}`}
      data-card-id={card.id}
      data-card-type="active"
      data-card-status={card.status || 'idle'}
      onClick={() => onSelect?.(card.id)}
    >
      {/* 1. Card Header */}
      <div className="ws-pane-head">
        {/* Status Dot */}
        <span
          className={`ws-pane-status-dot ${card.status || 'idle'}`}
          title={`Status: ${card.status || 'idle'}`}
        />

        {/* CLI / Agent Icon chip or letter badge */}
        <span
          className="ws-cli-logo ws-cli-badge"
          title={card.cli || card.agent || 'terminal'}
        >
          {cliLabel}
        </span>

        {/* Monospace Title with optional agent badge and model pill */}
        <span className="ws-pane-title">
          {card.agent && <span className="ws-pane-agent">{card.agent}</span>}
          {card.model && <span className="ws-pane-model">{card.model}</span>}
          <span className="ws-pane-id" title={card.title}>
            {card.title}
          </span>
        </span>

        {/* Uppercase Status Badge Pill */}
        {card.status && (
          <span className={`ws-pane-status-badge ${card.status}`}>
            {card.status}
          </span>
        )}

        {/* Action Buttons */}
        <button
          type="button"
          className="ws-pane-icon-btn"
          title={isExpanded ? 'Restore' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            onExpand?.(card.id);
          }}
        >
          {isExpanded ? '⤡' : '⤢'}
        </button>

        {onFocus && (
          <button
            type="button"
            className="ws-pane-icon-btn"
            title="Focus"
            onClick={(e) => {
              e.stopPropagation();
              onFocus(card.id);
            }}
          >
            ⛶
          </button>
        )}

        {onClose && (
          <button
            type="button"
            className="ws-close"
            title="Close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(card.id);
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* 2. Optional Asking/Permission Banner */}
      {card.status === 'asking' && (
        <div
          className="ws-pane-asking-banner"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="asking-banner-content">
            <span className="asking-banner-badge">⚠ PERMISSION</span>
            <span
              className="asking-banner-text"
              title={card.askingPrompt || 'Permission required to execute command'}
            >
              {card.askingPrompt || 'Permission required to execute command'}
            </span>
          </div>
          <div className="asking-banner-actions">
            <button
              type="button"
              className="btn-asking-allow"
              onClick={() => onAnswerPermission?.(card.id, 'yes')}
            >
              ✅ Yes
            </button>
            <button
              type="button"
              className="btn-asking-deny"
              onClick={() => onAnswerPermission?.(card.id, 'no')}
            >
              ❌ No
            </button>
            <button
              type="button"
              className="btn-asking-deny"
              onClick={() => onAnswerPermission?.(card.id, 'enter')}
            >
              ⏎ Enter
            </button>
          </div>
        </div>
      )}

      {/* 3. Card Body */}
      <div className="ws-pane-body">
        {children ?? card.content ?? (
          <div
            style={{
              padding: '12px',
              fontFamily: 'var(--mono)',
              fontSize: '11px',
              color: '#929791',
              lineHeight: '1.5',
            }}
          >
            <div style={{ color: '#4ade80' }}>
              $ {card.commandValue || card.title || 'session active'}
            </div>
            <div>Ready for commands...</div>
          </div>
        )}
      </div>

      {/* 4. Optional Bottom Input Bar */}
      {onSendCommand && (
        <div
          className="ws-pane-input-bar"
          onClick={(e) => e.stopPropagation()}
        >
          <form
            className="ws-input"
            onSubmit={handleSendCommand}
            style={{ margin: 0 }}
          >
            <input
              type="text"
              className="ws-input-field"
              placeholder="Send command to card..."
              value={inputCommand}
              onChange={(e) => setInputCommand(e.target.value)}
            />
            <button
              type="submit"
              className="ws-pane-icon-btn"
              title="Send Command"
            >
              ↵
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
