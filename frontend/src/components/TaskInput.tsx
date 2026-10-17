import { useEffect, useRef, useState } from 'react';

export interface TaskMention {
  tty: string;
  label: string;
  name: string;
}

interface TaskInputProps {
  placeholder: string;
  onEnter: (value: string) => void;
  buttonLabel?: string;
  className?: string;
  autoClear?: boolean;
  /** Optional terminal list — enables `@terminal` mentions with autocomplete. */
  mentions?: TaskMention[];
  /** Called when @mentions in the input change — emits the list of mentioned ttys. */
  onMentionsChange?: (mentionedTtys: string[]) => void;
}

/** Simple cursor-position-safe mention insertion: when the user types `@`,
 *  open a dropdown of terminals; picking one inserts `@name` at the caret. */
export function TaskInput({
  placeholder,
  onEnter,
  buttonLabel,
  className,
  autoClear = true,
  mentions = [],
  onMentionsChange,
}: TaskInputProps) {
  const [value, setValue] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = mentions.filter((m) =>
    (m.label + ' ' + m.name + ' ' + m.tty).toLowerCase().includes(mentionQuery.toLowerCase()),
  );

  const closeMention = () => {
    setMentionOpen(false);
    setMentionQuery('');
    setActiveIdx(0);
  };

  const pickMention = (m: TaskMention) => {
    const el = inputRef.current;
    const tag = `@${m.name || m.tty}`;
    if (el) {
      const pos = el.selectionStart ?? value.length;
      const before = value.slice(0, pos);
      const after = value.slice(pos);
      // remove the partial `@query` token the user was typing
      const cleanedBefore = before.replace(/@\w*$/, '');
      const next = (cleanedBefore + tag + ' ' + after).replace(/\s+/g, ' ');
      setValue(next);
      requestAnimationFrame(() => {
        el.focus();
        const caret = cleanedBefore.length + tag.length + 1;
        el.setSelectionRange(caret, caret);
      });
    } else {
      setValue((v) => (v.trim() ? v.trimEnd() + ' ' + tag : tag));
    }
    closeMention();
  };

  // Emit pending mentions whenever the value changes
  const emitMentions = (v: string) => {
    if (!onMentionsChange) return;
    const matches = v.match(/@(\w+)/g);
    if (!matches) {
      onMentionsChange([]);
      return;
    }
    const ttys = matches.map((m) => m.slice(1));
    onMentionsChange(ttys);
  };

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    closeMention();
    onEnter(v);
    if (autoClear) {
      setValue('');
      onMentionsChange?.([]);
    }
  };

  // Click outside closes the dropdown
  useEffect(() => {
    if (!mentionOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) closeMention();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionOpen]);

  return (
    <div className={`add-task ${className || ''}`}>
      <div className="tmi-wrap">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            emitMentions(e.target.value);
            const v = e.target.value;
            const caret = e.target.selectionStart ?? v.length;
            const m = v.slice(0, caret).match(/@(\w*)$/);
            if (m) {
              setMentionQuery(m[1]);
              setMentionOpen(true);
              setActiveIdx(0);
            } else if (v.includes('@')) {
              setMentionOpen(true);
            } else {
              closeMention();
            }
          }}
          onKeyDown={(e) => {
            if (mentionOpen && filtered.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => (i + 1) % filtered.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  pickMention(filtered[activeIdx]);
                  return;
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  pickMention(filtered[activeIdx]);
                  return;
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                closeMention();
                return;
              }
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          onBlur={() => {
            // keep dropdown open on click (handled by outside-click instead)
          }}
        />
        {mentionOpen && filtered.length > 0 && (
          <div className="tmi-dropdown" ref={listRef}>
            <div className="tmi-dropdown-label">TAG TERMINAL</div>
            {filtered.map((m, i) => (
              <button
                key={m.tty}
                type="button"
                className={`tmi-option ${i === activeIdx ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(m);
                }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className="tmi-tag">@{m.name || m.tty}</span>
                <span className="tmi-sub">{m.tty}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {buttonLabel && <button onClick={submit}>{buttonLabel}</button>}
    </div>
  );
}
