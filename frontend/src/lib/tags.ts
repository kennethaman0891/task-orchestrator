/**
 * Terminal mention (@-tag) parsing for task text.
 *
 * Terminals are addressed by their NAME (e.g. `terminal-7`) or tty
 * (`ttys011`) — the same labels shown in the Task Center sidebar. Typing
 * `@terminal-7` (or `@ttys011`) in a task box routes that task to the
 * tagged terminal, letting you LINK terminals together: from terminal-1's
 * box you can assign work to terminal-2 and the task carries provenance.
 */

export interface MentionTarget {
  tty: string;
  label: string;
  /** The exact mention text as typed, e.g. `@terminal-7`. */
  mention: string;
}

export interface MentionTerminal {
  tty: string;
  name: string;
}

/** Build the mention aliases for a terminal: name + tty (+ full label). */
export function mentionAliases(t: MentionTerminal): string[] {
  const aliases = [t.name, t.tty];
  if (t.name && t.tty) aliases.push(`${t.name} · ${t.tty}`);
  return aliases;
}

/**
 * Parse `@alias` mentions out of task text. Returns the unique matched
 * terminals and the cleaned text (tags removed, whitespace collapsed).
 * Case-insensitive; matches longest alias first so `@terminal-7 · ttys011`
 * doesn't partially match `terminal-7`.
 */
export function parseMentions(
  text: string,
  terminals: MentionTerminal[],
): { targets: MentionTarget[]; clean: string } {
  if (!text.includes('@')) return { targets: [], clean: text };

  const aliasIndex: { alias: string; t: MentionTerminal }[] = [];
  for (const t of terminals) {
    for (const a of mentionAliases(t)) {
      aliasIndex.push({ alias: a.toLowerCase(), t });
    }
  }
  aliasIndex.sort((x, y) => y.alias.length - x.alias.length);

  let remaining = text;
  const targets: MentionTarget[] = [];
  for (const { alias, t } of aliasIndex) {
    const re = new RegExp(`@${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
    if (re.test(remaining)) {
      remaining = remaining.replace(re, ' ');
      if (!targets.some((x) => x.tty === t.tty)) {
        targets.push({ tty: t.tty, label: t.name || t.tty, mention: `@${alias}` });
      }
    }
  }
  const clean = remaining.replace(/\s+/g, ' ').trim();
  return { targets, clean };
}
