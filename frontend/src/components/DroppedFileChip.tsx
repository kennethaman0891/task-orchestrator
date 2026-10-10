/**
 * DroppedFileChip — ChatGPT-style "attached file" chips that appear above the
 * terminal input after a file/folder is dropped from the sidebar onto a
 * terminal. Each chip shows the item's NAME (basename), a subtle arrow to the
 * terminal label, and a dismiss ✕. Chips stack per terminal session, cap at 8,
 * auto-remove after 90s, and persist until dismissed or cleared.
 */

/** A single chip — the full absolute path lives on `fullPath` (shown as a
 *  tooltip) and only `name` (the basename) is displayed on the pill. */
export interface DropChip {
  id: number;
  kind: 'file' | 'folder';
  name: string;
  fullPath: string;
  terminalId: string;
  terminalLabel: string;
}

interface DropChipStripProps {
  chips: DropChip[];
  onDismiss: (id: number) => void;
  onClearAll: () => void;
}

/** A chip pill. */
function DropChipPill({ chip, onDismiss }: { chip: DropChip; onDismiss: (id: number) => void }) {
  const icon = chip.kind === 'folder' ? '📁' : '📄';
  return (
    <span className="tto-chip" title={chip.fullPath}>
      <span className="tto-chip-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tto-chip-name">{chip.name}</span>
      {chip.terminalLabel && <span className="tto-chip-target">→ {chip.terminalLabel}</span>}
      <button
        className="tto-chip-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(chip.id);
        }}
        aria-label={`Remove ${chip.name}`}
        title="Remove"
      >
        ✕
      </button>
    </span>
  );
}

/** The horizontal strip of chip pills, rendered above the terminal input. */
export function DropChipStrip({ chips, onDismiss, onClearAll }: DropChipStripProps) {
  if (!chips || chips.length === 0) return null;
  return (
    <div className="tto-chip-strip" role="region" aria-label="Attached files">
      <span className="tto-chip-sublabel" aria-hidden="true">
        attached
      </span>
      {chips.map((chip) => (
        <DropChipPill key={chip.id} chip={chip} onDismiss={onDismiss} />
      ))}
      {chips.length > 1 && (
        <button
          className="tto-chip-clear"
          onClick={onClearAll}
          title="Clear all attached files"
          aria-label="Clear all attached files"
        >
          ✕ clear
        </button>
      )}
    </div>
  );
}
