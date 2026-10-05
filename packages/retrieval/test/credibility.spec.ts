/**
 * ADR-0076 — source standing as a small, bounded tie-breaker in retrieval.
 */

import { describe, expect, it } from 'vitest';
import { type Candidate, credibility, rerank, SUB_THEME_BOOST } from '../src/rank.js';

const now = new Date('2026-10-05T00:00:00Z');

const candidate = (over: Partial<Candidate>): Candidate => ({
  chunkId: 'c',
  sourceId: 's',
  cosine: 0.6,
  subTheme: null,
  groundingLevel: 'ABSTRACT',
  text: 't',
  page: null,
  ...over,
});

describe('credibility', () => {
  it('is zero when nothing is known', () => {
    expect(credibility({}, now)).toBe(0);
  });

  it('does not punish new work for having no citations yet', () => {
    expect(credibility({ citationCount: 0, year: 2026 }, now)).toBe(0);
    expect(credibility({ citationCount: 0, year: 2025 }, now)).toBe(0);
  });

  it('marks down a preprint, old uncited work and a weak venue, within the bound', () => {
    expect(credibility({ isPreprint: true }, now)).toBeLessThan(0);
    expect(credibility({ citationCount: 0, year: 2020 }, now)).toBeLessThan(0);
    const worst = credibility(
      { isPreprint: true, citationCount: 0, year: 2015, venueCitedness: 0.1 },
      now,
    );
    expect(worst).toBe(-0.08);
  });

  it('marks up well-cited work in a strong venue, within the bound', () => {
    expect(credibility({ citationCount: 120, venueCitedness: 4.2 }, now)).toBe(0.05);
  });

  it('never outweighs the sub-theme boost', () => {
    expect(0.05 - -0.08).toBeLessThan(SUB_THEME_BOOST);
  });
});

describe('rerank with credibility', () => {
  it('prefers the better-standing paper when two passages are equally relevant', () => {
    const weak = candidate({ chunkId: 'a', citationCount: 0, year: 2019, venueCitedness: 0.2 });
    const strong = candidate({ chunkId: 'b', citationCount: 80, venueCitedness: 3 });
    expect(rerank([weak, strong], null).map((c) => c.chunkId)).toEqual(['b', 'a']);
  });

  it('never lets standing beat a clearly more relevant passage', () => {
    const relevantWeak = candidate({
      chunkId: 'a',
      cosine: 0.75,
      citationCount: 0,
      year: 2019,
      venueCitedness: 0.2,
      isPreprint: true,
    });
    const offTopicStrong = candidate({
      chunkId: 'b',
      cosine: 0.5,
      citationCount: 500,
      venueCitedness: 6,
    });
    expect(rerank([offTopicStrong, relevantWeak], null)[0]?.chunkId).toBe('a');
  });
});
