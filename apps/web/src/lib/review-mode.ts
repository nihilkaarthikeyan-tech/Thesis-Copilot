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

/** Scrolls the next check's panel into view and puts the keyboard on its run button. */
export function openCheck(testId: string): void {
  const button = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!button) return;
  button.scrollIntoView({ block: 'center', behavior: 'smooth' });
  button.focus({ preventScroll: true });
}
