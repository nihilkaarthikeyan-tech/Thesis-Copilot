/**
 * A word-level diff, for showing a student what a suggested revision would change.
 *
 * Two screens show the same comparison — the review queue (§5.7) and the review panel inside the
 * editor — and a diff that disagrees with itself between two screens is a bug nobody reports,
 * because each one looks reasonable alone. So there is one of these.
 *
 * It is deliberately not a proper Myers diff. The two strings are one passage and its rewrite:
 * the same sentence with words changed, not two unrelated texts. A greedy scan with a short
 * lookahead reads correctly on that and costs nothing; the failure mode is a stretch marked as
 * "deleted then added" where a cleverer algorithm would have found a match, which is honest and
 * legible rather than wrong.
 */

export type DiffOp = { text: string; op: 'same' | 'add' | 'del' };

/** How far ahead to look for the old word before giving up and calling it a deletion. */
const LOOKAHEAD = 8;

export function diffWords(before: string, after: string): DiffOp[] {
  // Splitting on the separator keeps it, so joining the ops back gives the original strings.
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ text: a[i] as string, op: 'same' });
      i++;
      j++;
      continue;
    }
    // `a[i]` is undefined once the old text runs out, and there is then nothing to look for.
    const nextMatch = i < a.length ? b.indexOf(a[i] as string, j) : -1;
    if (nextMatch > -1 && nextMatch - j <= LOOKAHEAD) {
      for (let k = j; k < nextMatch; k++) out.push({ text: b[k] as string, op: 'add' });
      j = nextMatch;
      continue;
    }
    if (i < a.length) {
      out.push({ text: a[i] as string, op: 'del' });
      i++;
    } else if (j < b.length) {
      out.push({ text: b[j] as string, op: 'add' });
      j++;
    }
  }
  return out;
}

/**
 * A key per op from its running offset, so React never keys on the array index.
 *
 * The text repeats by nature in a diff — "the" appears fifteen times — so the text alone is not a
 * key, and the index moves when the diff is recomputed.
 */
export function diffKeys(diff: DiffOp[]): Array<{ op: DiffOp; key: string }> {
  let offset = 0;
  return diff.map((op) => {
    const key = `${op.op}-${offset}`;
    offset += op.text.length;
    return { op, key };
  });
}

/** Whether the revision changes anything at all, ignoring whitespace. */
export function isUnchanged(diff: DiffOp[]): boolean {
  return diff.every((op) => op.op === 'same' || op.text.trim().length === 0);
}

/**
 * How much of the passage the revision touches, 0–1, counting words and not spaces.
 *
 * An inline diff is the clearest thing to look at when a few words changed, and the worst when
 * most of them did: the deletions and the insertions interleave word by word and the result reads
 * as neither sentence. Above `REWRITE`, show the two sentences instead.
 */
export function changedRatio(diff: DiffOp[]): number {
  const words = diff.filter((op) => op.text.trim().length > 0);
  if (words.length === 0) return 0;
  return words.filter((op) => op.op !== 'same').length / words.length;
}

/** Past this, the interleaved diff stops being readable and the two sentences are shown instead. */
export const REWRITE = 0.4;
