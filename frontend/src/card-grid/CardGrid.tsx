import React from 'react';
import './grid.css';
import {
  type GridMode,
  GRID_GAP,
  computeResponsiveLayout,
  useElementSize,
} from './GridEngine';
import { GridCard, type CardData } from './GridCard';

export interface CardGridProps {
  cards: CardData[];
  mode?: GridMode;
  maxColumns?: number;
  templateCols?: number;
  selectedId?: string | null;
  expandedId?: string | null;
  onSelectCard?: (id: string) => void;
  onExpandCard?: (id: string | null) => void;
  onCloseCard?: (id: string) => void;
  onAttachCard?: (id: string, session: string) => void;
  onOpenNewCard?: (id: string) => void;
  onQuickLaunchCard?: (id: string, opts: { projectPath: string; command: string; count: number }) => void;
  onAnswerPermission?: (id: string, answer: 'yes' | 'no' | 'enter') => void;
  onSendCommand?: (id: string, command: string) => void;
  renderCardContent?: (card: CardData) => React.ReactNode;
}

export const CardGrid: React.FC<CardGridProps> = ({
  cards,
  mode = 'auto',
  maxColumns,
  templateCols,
  selectedId = null,
  expandedId = null,
  onSelectCard,
  onExpandCard,
  onCloseCard,
  onAttachCard,
  onOpenNewCard,
  onQuickLaunchCard,
  onAnswerPermission,
  onSendCommand,
  renderCardContent,
}) => {
  const { ref, size } = useElementSize<HTMLDivElement>();

  const layout = computeResponsiveLayout({
    count: cards.length,
    width: size.w,
    mode,
    gap: GRID_GAP,
    maxColumns,
    templateCols,
  });

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gap: `${GRID_GAP}px`,
    gridTemplateColumns: Array.from(
      { length: layout.cols },
      () => `minmax(${layout.minW}px, 1fr)`
    ).join(' '),
    gridTemplateRows: Array.from(
      { length: layout.rows },
      () => `minmax(${layout.minH}px, 1fr)`
    ).join(' '),
    alignContent: 'stretch',
  };

  const handleToggleExpand = (id: string) => {
    if (onExpandCard) {
      onExpandCard(expandedId === id ? null : id);
    }
  };

  const gridClass = `ws-grid${expandedId != null ? ' has-expanded' : ''}`;

  return (
    <div className="container" ref={ref}>
      <div
        className={gridClass}
        data-grid-mode={mode}
        style={gridStyle}
      >
        {cards.map((card) => {
          const isSelected = selectedId === card.id;
          const isExpanded = expandedId === card.id;

          return (
            <GridCard
              key={card.id}
              card={card}
              isSelected={isSelected}
              isExpanded={isExpanded}
              onSelect={onSelectCard}
              onExpand={handleToggleExpand}
              onFocus={handleToggleExpand}
              onClose={onCloseCard}
              onAttach={onAttachCard}
              onOpenNew={onOpenNewCard}
              onQuickLaunch={onQuickLaunchCard}
              onAnswerPermission={onAnswerPermission}
              onSendCommand={onSendCommand}
            >
              {renderCardContent ? renderCardContent(card) : undefined}
            </GridCard>
          );
        })}
      </div>
    </div>
  );
};
