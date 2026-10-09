/**
 * Review mode's hand-off (Jenni build plan R23, ADR-0110): a check panel — proofreading, the tone
 * review, the coherence flags — asks the editor to walk through its results in the text. The
 * panel keeps its own list and bookkeeping (`decide`); the review mode draws the changes, applies
 * the accepted ones and calls back for each decision.
 */

export const REVIEW_START = 'tc:review-start';

export type ReviewItem = {
  id: string;
  from: number;
  to: number;
  /** The words the item was found on. */
  original: string;
  /** The words to put there; null for a flag, which changes nothing in the text. */
  replacement: string | null;
  /** "Spelling", "Tone", "Source support". */
  label: string;
  /** Why, in a sentence. */
  why: string;
};

export type ReviewSession = {
  /** Which check, for the bar's heading: "Spelling and grammar". */
  title: string;
  items: ReviewItem[];
  /**
   * After each decision. For a change, the text has already been changed (accepted) or left as
   * it was (rejected); for a flag, accepting resolves it and rejecting ignores it.
   */
  decide: (id: string, accepted: boolean) => void | Promise<void>;
  /** Shown when everything is decided: run the same check again. */
  rerun?: { label: string; run: () => void };
  /** "Try next": the check a student would usually run after this one. */
  next?: { label: string; open: () => void };
};

export function startReview(session: ReviewSession): void {
  window.dispatchEvent(new CustomEvent<ReviewSession>(REVIEW_START, { detail: session }));
}

/** Changes that can all be applied in one step: last first, none overlapping the one after it. */
export function applicableInOrder<T extends { from: number; to: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => b.from - a.from);
  const out: T[] = [];
  let floor = Number.POSITIVE_INFINITY;
  for (const item of sorted) {
    if (item.to > floor) continue;
    out.push(item);
    floor = item.from;
  }
  return out;
}

/** The review bar at its widest (46rem). */
export const REVIEW_BAR_MAX = 736;

/**
 * Where the floating review bar goes: centred over the writing column, a gutter in from each of
 * its edges, never wider than `REVIEW_BAR_MAX` and never outside the window. QA 2026-10-09: it was
 * centred on the window, so at 1280 px it ran 16 px over the tool panel and covered the left edge
 * of the correction card the student was reading.
 */
export function reviewBarPlacement(
  column: { left: number; right: number },
  viewportWidth: number,
  gutter = 16,
): { left: number; width: number } {
  const left = Math.max(column.left, 0) + gutter;
  const right = Math.min(column.right, viewportWidth) - gutter;
  // A column narrower than the bar's least useful width (a phone with a drawer half open, say)
  // gets the window's width instead, as before.
  if (right - left < 280) {
    const width = Math.min(REVIEW_BAR_MAX, viewportWidth - 2 * gutter);
    return { left: (viewportWidth - width) / 2, width };
  }
  const width = Math.min(REVIEW_BAR_MAX, right - left);
  return { left: left + (right - left - width) / 2, width };
}

/** Scrolls the next check's panel into view and puts the keyboard on its run button. */
export function openCheck(testId: string): void {
  const button = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!button) return;
  button.scrollIntoView({ block: 'center', behavior: 'smooth' });
  button.focus({ preventScroll: true });
}
