/**
 * The text side of chat's `@` mention, kept apart from the component so it can be tested without
 * a DOM. See `components/editor/ChatMentions.tsx` for the feature.
 */

/** The `@query` being typed at the end of the text, if any; `''` right after a bare `@`. */
export function mentionQuery(text: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
  return match ? (match[1] ?? '') : null;
}

/** The text with the trailing `@query` removed: it was only a way to choose a paper. */
export function dropMentionQuery(text: string): string {
  return text.replace(/(^|\s)@[^\s@]*$/, '$1');
}

/** "LeCun 2015" — a source the way a student would say it. */
export function mentionLabel(source: {
  title: string | null;
  authors: unknown;
  year: number | null;
}): string {
  const first = Array.isArray(source.authors)
    ? (source.authors[0] as { family?: string; literal?: string } | string | undefined)
    : undefined;
  const name =
    typeof first === 'string'
      ? first.split(',')[0]?.trim()
      : (first?.family ?? first?.literal?.split(/\s+/).pop());
  const who = name || source.title?.split(/\s+/).slice(0, 3).join(' ') || 'Source';
  return source.year ? `${who} ${source.year}` : who;
}
