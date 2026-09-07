/**
 * Comment re-anchoring — PRD Appendix D.2.2, PHASES v2 B2.2.
 *
 *   "if a comment's `anchorKey` mark is absent from the chapter, search for `quotedText` (exact,
 *    then normalised whitespace, then 0.85 similarity over sentence windows); if found, re-apply
 *    the mark; else show the comment as 'unanchored' at the chapter level."
 *
 * A guide comments on a sentence; the student then rewrites the paragraph around it. The mark
 * usually survives — that is what marks are for — but a paste, an undo across a save, or an
 * import loses it, and a comment that silently points at the wrong sentence is worse than one
 * that admits it is adrift. Hence the three attempts, in that order, and an honest failure.
 */

/** Collapse whitespace and case; keep the words. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Dice coefficient over character bigrams: cheap, and stable for the sentence-length strings. */
export function similarity(a: string, b: string): number {
  const bigrams = (text: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i++) {
      const pair = text.slice(i, i + 2);
      out.set(pair, (out.get(pair) ?? 0) + 1);
    }
    return out;
  };
  const left = bigrams(normalise(a));
  const right = bigrams(normalise(b));
  if (left.size === 0 || right.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0);
  const total =
    [...left.values()].reduce((n, c) => n + c, 0) + [...right.values()].reduce((n, c) => n + c, 0);
  return (2 * shared) / total;
}

export type AnchorMatch = {
  from: number;
  to: number;
  /** Which of D.2.2's three attempts found it. Logged, not shown. */
  how: 'exact' | 'normalised' | 'similar';
  score: number;
};

export type AnchorSentence = { text: string; from: number; to: number };

/**
 * Finds `quotedText` in a chapter, by D.2.2's three attempts in order.
 *
 * The window search is over consecutive sentences rather than a sliding character window: a
 * guide quotes sentences, and a match that starts halfway through one gives a range the student
 * cannot read.
 */
export function findAnchor(
  quotedText: string,
  sentences: readonly AnchorSentence[],
  threshold = 0.85,
): AnchorMatch | null {
  const quote = quotedText.trim();
  if (!quote || sentences.length === 0) return null;

  // 1. Exact, as written.
  for (const sentence of sentences) {
    const index = sentence.text.indexOf(quote);
    if (index >= 0) {
      return {
        from: sentence.from + index,
        to: sentence.from + index + quote.length,
        how: 'exact',
        score: 1,
      };
    }
  }

  // 2. Normalised whitespace and case.
  const target = normalise(quote);
  for (const sentence of sentences) {
    if (normalise(sentence.text) === target) {
      return { from: sentence.from, to: sentence.to, how: 'normalised', score: 1 };
    }
  }

  // 3. The best window of consecutive sentences, if it clears the threshold.
  const maxWindow = Math.min(5, sentences.length);
  let best: AnchorMatch | null = null;
  for (let size = 1; size <= maxWindow; size++) {
    for (let i = 0; i + size <= sentences.length; i++) {
      const window = sentences.slice(i, i + size);
      const text = window.map((s) => s.text).join(' ');
      const score = similarity(text, quote);
      if (score >= threshold && (!best || score > best.score)) {
        const first = window[0] as AnchorSentence;
        const last = window[window.length - 1] as AnchorSentence;
        best = { from: first.from, to: last.to, how: 'similar', score };
      }
    }
  }
  return best;
}
