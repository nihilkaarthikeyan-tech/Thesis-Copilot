/**
 * Highlights and notes in the paper reader — the pure parts (ADR-0130).
 *
 * A highlight is anchored in the reader's normalised text (`SearchIndex`: lower case, whitespace
 * collapsed) of one PDF page's text layer, or of one Text-view passage (or the whole Text view):
 * `start`/`end` offsets, the `exact` slice, and up to 32 characters either side. The offsets are
 * tried first; when they no longer hold the same words (a re-read paper, a merged duplicate, a
 * highlight made in the other view) the words are looked for, and the occurrence whose
 * surroundings agree best wins, the nearest to the old offset breaking a tie.
 */

import { READER_CONTEXT_CHARS, type ReaderHighlight } from '@tc/types';
import { findAll } from './reader';

export type Anchor = { start: number; end: number; exact: string; prefix: string; suffix: string };

/** The anchor for `start`..`end` of `text`, trimmed of the spaces at either end. */
export function anchorAt(text: string, start: number, end: number): Anchor | null {
  let from = Math.max(0, start);
  let to = Math.min(text.length, end);
  while (from < to && text[from] === ' ') from++;
  while (to > from && text[to - 1] === ' ') to--;
  if (to <= from) return null;
  return {
    start: from,
    end: to,
    exact: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - READER_CONTEXT_CHARS), from),
    suffix: text.slice(to, to + READER_CONTEXT_CHARS),
  };
}

/** How many characters `a` and `b` share at their ends (`fromEnd`) or starts. */
function shared(a: string, b: string, fromEnd: boolean): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n) {
    const x = fromEnd ? a[a.length - 1 - i] : a[i];
    const y = fromEnd ? b[b.length - 1 - i] : b[i];
    if (x !== y) break;
    i++;
  }
  return i;
}

/**
 * Where the anchored words are in `text` now, or null when they are not there at all.
 * `useOffsets` is false when the offsets were taken in another view and mean nothing here.
 */
export function locate(
  text: string,
  anchor: Pick<Anchor, 'start' | 'end' | 'exact' | 'prefix' | 'suffix'>,
  useOffsets = true,
): { start: number; end: number } | null {
  if (!anchor.exact) return null;
  if (useOffsets && text.slice(anchor.start, anchor.end) === anchor.exact) {
    return { start: anchor.start, end: anchor.end };
  }
  const found = findAll(text, anchor.exact);
  if (found.length === 0) return null;
  let best = found[0] as number;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const at of found) {
    const before = text.slice(Math.max(0, at - anchor.prefix.length), at);
    const after = text.slice(
      at + anchor.exact.length,
      at + anchor.exact.length + anchor.suffix.length,
    );
    const score = shared(before, anchor.prefix, true) + shared(after, anchor.suffix, false);
    const distance = useOffsets ? Math.abs(at - anchor.start) : 0;
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = at;
      bestScore = score;
      bestDistance = distance;
    }
  }
  return { start: best, end: best + anchor.exact.length };
}

/** Reading order: by page (none last), then by where on it, then by when made. */
export function sortHighlights<T extends Pick<ReaderHighlight, 'page' | 'start' | 'createdAt'>>(
  list: readonly T[],
): T[] {
  return [...list].sort((a, b) => {
    const pa = a.page ?? Number.POSITIVE_INFINITY;
    const pb = b.page ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    if (a.start !== b.start) return a.start - b.start;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * What "Put in chat" hands the chat: the passage, with its page, and the student's note when there
 * is one. The chat box is only filled; the student still sends it (or not).
 */
export function chatHandoffFor(h: Pick<ReaderHighlight, 'quote' | 'note' | 'page'>): {
  text: string;
  note?: string;
} {
  const where = h.page ? ` (p. ${h.page})` : '';
  const text = `${h.quote.replace(/\s+/g, ' ').trim()}${where}`;
  const note = h.note?.trim();
  return note ? { text, note } : { text };
}

/** The label a highlight carries in the list: "p. 4" or "Text". */
export function whereLabel(h: Pick<ReaderHighlight, 'page' | 'view'>): string {
  return h.page ? `p. ${h.page}` : 'Text';
}
