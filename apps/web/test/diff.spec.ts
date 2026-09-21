/**
 * The word diff shown on both review screens.
 *
 * It was two copies of the same function until the editor's review panel needed one too, and the
 * thing worth pinning is not the algorithm — it is the properties the rendering depends on: the
 * ops join back to the original strings, a key is stable within one render, and the "how much of
 * this changed" number is the one that decides between an inline diff and two sentences.
 */

import { describe, expect, it } from 'vitest';
import { changedRatio, diffKeys, diffWords, isUnchanged, REWRITE } from '../src/lib/diff';

const joinOf = (ops: ReturnType<typeof diffWords>, side: 'before' | 'after') =>
  ops
    .filter((op) => op.op === 'same' || op.op === (side === 'before' ? 'del' : 'add'))
    .map((op) => op.text)
    .join('');

describe('the ops reconstruct both strings', () => {
  const cases: Array<[string, string]> = [
    ['The pump is expensive.', 'The pump is costly.'],
    ['One two three four five.', 'One two three four five.'],
    ['Short.', 'A much longer replacement sentence entirely.'],
    ['A much longer original sentence entirely.', 'Short.'],
    ['', 'Something from nothing.'],
    ['Something into nothing.', ''],
  ];

  for (const [before, after] of cases) {
    it(`"${before.slice(0, 20)}" → "${after.slice(0, 20)}"`, () => {
      const ops = diffWords(before, after);
      expect(joinOf(ops, 'before')).toBe(before);
      expect(joinOf(ops, 'after')).toBe(after);
    });
  }
});

describe('a small change', () => {
  const ops = diffWords(
    'The leading barrier is the cost of the pump.',
    'The leading barrier is the price of the pump.',
  );

  it('marks only the word that moved', () => {
    expect(ops.filter((o) => o.op === 'del').map((o) => o.text)).toEqual(['cost']);
    expect(ops.filter((o) => o.op === 'add').map((o) => o.text)).toEqual(['price']);
  });

  it('reads as a small change, so the inline diff is shown', () => {
    expect(changedRatio(ops)).toBeLessThan(REWRITE);
  });
});

describe('a rewrite', () => {
  it('reads as a rewrite, so the panel shows the two sentences instead', () => {
    const ops = diffWords(
      'Uptake of drip irrigation is uneven across the two surveyed districts of Tamil Nadu.',
      'Drip irrigation uptake varies between the two surveyed Tamil Nadu districts.',
    );
    // This is the real pair that made the inline rendering unreadable in an 18rem column.
    expect(changedRatio(ops)).toBeGreaterThan(REWRITE);
  });
});

describe('isUnchanged', () => {
  it('is true when the revision only reflows whitespace', () => {
    expect(isUnchanged(diffWords('One two three.', 'One two three.'))).toBe(true);
  });

  it('is false for a single word', () => {
    expect(isUnchanged(diffWords('One two three.', 'One two four.'))).toBe(false);
  });
});

describe('diffKeys', () => {
  it('gives every op a distinct key even when the text repeats', () => {
    const keys = diffKeys(diffWords('the the the', 'the and the')).map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('changedRatio', () => {
  it('ignores whitespace, so spacing does not move the threshold', () => {
    expect(changedRatio(diffWords('one two', 'one   two'))).toBe(0);
  });

  it('is zero for an empty diff rather than dividing by nothing', () => {
    expect(changedRatio(diffWords('', ''))).toBe(0);
  });
});
