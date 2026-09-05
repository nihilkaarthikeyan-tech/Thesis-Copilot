/**
 * Retrieval ranking — PRD §10.4 rerank and top_k, and the §10.6 citation whitelist.
 */

import { describe, expect, it } from 'vitest';
import {
  buildQueryText,
  CANDIDATE_LIMIT,
  type Candidate,
  FULL_TEXT_BOOST,
  parsePassageId,
  passageId,
  rerank,
  SUB_THEME_BOOST,
  stripUnknownCitations,
  TOP_K,
  topK,
} from '../src/rank.js';

const candidate = (over: Partial<Candidate> & { chunkId: string }): Candidate => ({
  sourceId: 's1',
  cosine: 0.5,
  subTheme: null,
  groundingLevel: 'ABSTRACT',
  text: 'passage',
  page: 1,
  ...over,
});

describe('buildQueryText (§10.4)', () => {
  it('is the last sentence before the cursor plus the scope note', () => {
    const before =
      'An earlier sentence about policy. The households reported upfront cost as the barrier';
    expect(buildQueryText(before, 'Barriers to solar adoption')).toBe(
      'The households reported upfront cost as the barrier Barriers to solar adoption',
    );
  });

  it('works with no scope note and with no sentence terminator', () => {
    expect(buildQueryText('just a fragment', null)).toBe('just a fragment');
    expect(buildQueryText('', 'scope only')).toBe('scope only');
  });
});

describe('rerank (§10.4)', () => {
  it('adds 0.15 for a matching sub-theme and 0.1 for full text', () => {
    const [plain, themed, full, both] = rerank(
      [
        candidate({ chunkId: 'c1' }),
        candidate({ chunkId: 'c2', subTheme: 'cost' }),
        candidate({ chunkId: 'c3', groundingLevel: 'FULL_TEXT' }),
        candidate({ chunkId: 'c4', subTheme: 'cost', groundingLevel: 'FULL_TEXT' }),
      ],
      'cost',
    ).sort((a, b) => a.chunkId.localeCompare(b.chunkId));

    expect(plain?.score).toBeCloseTo(0.5, 10);
    expect(themed?.score).toBeCloseTo(0.5 + SUB_THEME_BOOST, 10);
    expect(full?.score).toBeCloseTo(0.5 + FULL_TEXT_BOOST, 10);
    expect(both?.score).toBeCloseTo(0.5 + SUB_THEME_BOOST + FULL_TEXT_BOOST, 10);
  });

  it('does not boost a sub-theme the chapter does not have', () => {
    const [only] = rerank([candidate({ chunkId: 'c1', subTheme: 'cost' })], null);
    expect(only?.score).toBeCloseTo(0.5, 10);
  });

  it('orders by score, highest first, and breaks ties deterministically', () => {
    const ranked = rerank(
      [
        candidate({ chunkId: 'c2', cosine: 0.4 }),
        candidate({ chunkId: 'c1', cosine: 0.4 }),
        candidate({ chunkId: 'c3', cosine: 0.9 }),
      ],
      null,
    );
    expect(ranked.map((c) => c.chunkId)).toEqual(['c3', 'c1', 'c2']);
  });

  it('a full-text abstract-level tie is won by full text', () => {
    const ranked = rerank(
      [
        candidate({ chunkId: 'a', cosine: 0.55, groundingLevel: 'ABSTRACT' }),
        candidate({ chunkId: 'b', cosine: 0.5, groundingLevel: 'FULL_TEXT' }),
      ],
      null,
    );
    expect(ranked[0]?.chunkId).toBe('b');
  });
});

describe('topK (§10.4)', () => {
  const ranked = rerank(
    Array.from({ length: 24 }, (_, i) => candidate({ chunkId: `c${i}`, cosine: 1 - i / 100 })),
    null,
  );

  it('takes 6 for Assist, 12 for Draft, 8 for Chat', () => {
    expect(TOP_K).toEqual({ ASSIST: 6, DRAFT: 12, CHAT: 8 });
    expect(topK(ranked, 'ASSIST')).toHaveLength(6);
    expect(topK(ranked, 'DRAFT')).toHaveLength(12);
    expect(topK(ranked, 'CHAT')).toHaveLength(8);
  });

  it('the candidate limit is 24', () => {
    expect(CANDIDATE_LIMIT).toBe(24);
  });
});

describe('passage ids (§10.4, §10.6)', () => {
  it('round-trips', () => {
    const id = passageId('3', '12');
    expect(id).toBe('S3#c12');
    expect(parsePassageId(id)).toEqual({ sourceId: '3', chunkId: '12' });
  });

  it('round-trips a uuid pair', () => {
    const id = passageId(
      '01a06d6e-e1d6-7a4a-8d16-670fdcb29a91',
      '01a06d6e-e1da-74c2-ae32-7809fba4f339',
    );
    expect(parsePassageId(id)).toEqual({
      sourceId: '01a06d6e-e1d6-7a4a-8d16-670fdcb29a91',
      chunkId: '01a06d6e-e1da-74c2-ae32-7809fba4f339',
    });
  });

  it('rejects an id we did not issue', () => {
    expect(parsePassageId('Sharma et al. 2019')).toBeNull();
    expect(parsePassageId('')).toBeNull();
  });
});

describe('stripUnknownCitations (§10.6)', () => {
  it('keeps ids that were in the retrieved set', () => {
    const allowed = new Set(['S1#c1', 'S2#c7']);
    const { text, hallucinated } = stripUnknownCitations(
      'Cost was the barrier {{cite:S1#c1}}. Awareness was not {{cite:S2#c7}}.',
      allowed,
    );
    expect(text).toContain('{{cite:S1#c1}}');
    expect(text).toContain('{{cite:S2#c7}}');
    expect(hallucinated).toEqual([]);
  });

  it('strips an invented id and reports it', () => {
    const { text, hallucinated } = stripUnknownCitations(
      'A claim {{cite:S9#c9}} and a real one {{cite:S1#c1}}.',
      new Set(['S1#c1']),
    );
    expect(text).toBe('A claim  and a real one {{cite:S1#c1}}.');
    expect(hallucinated).toEqual(['S9#c9']);
  });

  it('strips every citation when nothing was retrieved', () => {
    const { text, hallucinated } = stripUnknownCitations('Claim {{cite:S1#c1}}.', new Set());
    expect(text).toBe('Claim .');
    expect(hallucinated).toEqual(['S1#c1']);
  });

  it('leaves text with no citations alone', () => {
    const { text, hallucinated } = stripUnknownCitations('No citations here.', new Set(['S1#c1']));
    expect(text).toBe('No citations here.');
    expect(hallucinated).toEqual([]);
  });
});
