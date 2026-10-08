/**
 * Where a citation the student picks goes — R40, ADR-0117.
 *
 * Two of the faults the Jenni study found in Jenni's citations were ours too, in the
 * end-of-sentence suggestion: the citation went in at the caret, which right after the student
 * typed the full stop is *after* it ("…the main barrier.(Rao, 2021)"), and which, if they had
 * typed on while the suggestion loaded, is in the next sentence — a citation moved to another
 * claim. These helpers put it where a reader expects it, beside a citation already there so that
 * the two read as one bracket.
 */

import type { Node as PmNode } from '@tiptap/pm/model';

/** One character per inline leaf, so an offset into the text is an offset in positions. */
const LEAF = '￼';

export type CitationPoint = {
  /** The position to insert the citation at. */
  pos: number;
  /** Put a space before it: the text before is a word, not a space or another citation. */
  space: boolean;
};

/**
 * The place for a citation of the sentence that ends at `end` (the position just after its
 * full stop, mapped through anything typed since).
 *
 * In an in-text style the citation goes before the sentence's closing punctuation — "…barrier
 * (Rao, 2021)." — and, when a citation is already there, right beside it, so the two render as
 * one citation. A note style's footnote mark goes after the full stop, as Chicago and OSCOLA put
 * it, so `end` itself is the place.
 */
export function citationPointForSentence(
  doc: PmNode,
  end: number,
  noteStyle: boolean,
): CitationPoint {
  const at = Math.max(0, Math.min(end, doc.content.size));
  const $end = doc.resolve(at);
  if (!$end.parent.inlineContent) return { pos: at, space: false };
  const start = $end.start();
  const before = doc.textBetween(start, at, '\n', LEAF);
  if (noteStyle) return { pos: at, space: false };
  const stop = /[.!?…]+["'”’)\]]*$/.exec(before);
  const pos = stop ? start + stop.index : at;
  return { pos, space: needsSpaceBefore(doc, pos) };
}

/** Whether a citation inserted at `pos` needs a space before it to stand apart from a word. */
export function needsSpaceBefore(doc: PmNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  const previous = $pos.nodeBefore;
  if (!previous) return false;
  if (previous.type.name === 'citation') return false;
  if (!previous.isText) return true;
  const text = previous.text ?? '';
  return text.length > 0 && !/[\s([]$/.test(text);
}

/**
 * The single space between a citation and the `@` the student typed after it ("(Kumar, 2021)
 * @rao"), when there is one: the picked citation then goes beside the first, and the two read as
 * one bracket. Returns the position of that space, or null.
 */
export function spaceAfterCitation(doc: PmNode, pos: number): number | null {
  if (pos < 1) return null;
  // `nodeBefore` inside a text node is the part of it before `pos`: the space must be all of
  // the text between the citation and the `@`.
  const previous = doc.resolve(pos).nodeBefore;
  if (!previous?.isText || previous.text !== ' ') return null;
  return doc.resolve(pos - 1).nodeBefore?.type.name === 'citation' ? pos - 1 : null;
}
