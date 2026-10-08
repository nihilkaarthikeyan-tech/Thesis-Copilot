/**
 * Retrieval ranking — PRD §10.4 rerank and top_k, and the §10.6 citation whitelist.
 */

import { describe, expect, it } from 'vitest';
import { citedSourceCounts } from '../src/context.js';
import {
  buildQueryText,
  CANDIDATE_LIMIT,
  CANDIDATE_PER_SOURCE,
  type Candidate,
  FULL_TEXT_BOOST,
  isOffTopic,
  parsePassageId,
  passageId,
  RELEVANCE_FLOOR,
  rerank,
  SPREAD_FLOOR,
  SUB_THEME_BOOST,
  spreadCitations,
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

  it('ADR-0128: the candidate window is 48 chunks, at most 3 from one paper while others have any', () => {
    expect(CANDIDATE_LIMIT).toBe(48);
    expect(CANDIDATE_PER_SOURCE).toBe(3);
  });

  it('ADR-0128: a draft takes at most 2 passages from one paper while others have candidates', () => {
    // Paper A holds the 10 best passages; B and C follow.
    const mixed = rerank(
      [
        ...Array.from({ length: 10 }, (_, i) =>
          candidate({ chunkId: `a${i}`, sourceId: 'A', cosine: 0.9 - i / 100 }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          candidate({ chunkId: `b${i}`, sourceId: 'B', cosine: 0.7 - i / 100 }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          candidate({ chunkId: `c${i}`, sourceId: 'C', cosine: 0.6 - i / 100 }),
        ),
      ],
      null,
    );
    const taken = topK(mixed, 'DRAFT');
    expect(taken).toHaveLength(12);
    // Two per paper fill six places; the six left go back to the best of the rest (A's next).
    expect(taken.slice(0, 6).filter((c) => c.sourceId === 'A')).toHaveLength(2);
    expect(taken.slice(0, 2).map((c) => c.chunkId)).toEqual(['a0', 'a1']);
    expect(new Set(taken.slice(0, 6).map((c) => c.sourceId))).toEqual(new Set(['A', 'B', 'C']));
    // Assist and chat are unchanged.
    expect(topK(mixed, 'CHAT').every((c) => c.sourceId === 'A')).toBe(true);
  });

  it('ADR-0078: a library of one paper still fills the draft', () => {
    expect(topK(ranked, 'DRAFT')).toHaveLength(12);
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

describe('the relevance floor — what stops chat being a general chatbot', () => {
  // The cosines below are the ones actually measured: four library passages on one subject and
  // fifteen questions, against voyage-3 on 2026-09-14 (by hand) and against voyage-4 on
  // 2026-09-25 (`pnpm --filter @tc/ai floor`, ADR-0032). They are recorded here so a change to
  // the floor, or of the model, has to argue with the measurement.
  const MEASURED = {
    'voyage-3': {
      onTopic: [0.595, 0.499, 0.396, 0.36, 0.345],
      nearby: [0.427, 0.381, 0.302],
      offTopic: [0.254, 0.117, 0.091, 0.07, 0.061, 0.048, 0.003],
    },
    'voyage-4': {
      onTopic: [0.771, 0.665, 0.658, 0.615, 0.529],
      nearby: [0.473, 0.452, 0.384],
      offTopic: [0.232, 0.205, 0.166, 0.154, 0.152, 0.106, 0.099],
    },
  } as const;

  const at = (cosine: number) => [{ cosine }];

  for (const [model, measured] of Object.entries(MEASURED)) {
    it(`${model}: lets every question that was actually about the library through`, () => {
      for (const cosine of measured.onTopic) {
        expect(isOffTopic(at(cosine)), `on-topic ${cosine}`).toBe(false);
      }
    });

    it(`${model}: refuses every question that was not`, () => {
      for (const cosine of measured.offTopic) {
        expect(isOffTopic(at(cosine)), `off-topic ${cosine}`).toBe(true);
      }
    });

    it(`${model}: sits in the gap between the two, with room on both sides`, () => {
      const highestOffTopic = Math.max(...measured.offTopic);
      const lowestOnTopic = Math.min(...measured.onTopic);

      expect(highestOffTopic).toBeLessThan(RELEVANCE_FLOOR);
      expect(lowestOnTopic).toBeGreaterThan(RELEVANCE_FLOOR);
    });
  }

  it('lets a fair question the library cannot answer reach the model', () => {
    // The middle population. "How does net metering work in India?" is a real question about the
    // subject that these sources do not cover, and the useful reply is A.4's "try adding sources
    // on: …", which only the model can write because naming the missing topic is the point. The
    // floor is not a test of whether the answer is in there.
    for (const [model, measured] of Object.entries(MEASURED)) {
      for (const cosine of measured.nearby) {
        expect(isOffTopic(at(cosine)), `${model} nearby ${cosine}`).toBe(false);
      }
    }
  });

  it('needs only one relevant passage out of eight', () => {
    // A question answered by a single source is still a question about the library.
    const passages = [{ cosine: 0.02 }, { cosine: 0.05 }, { cosine: 0.51 }, { cosine: 0.01 }];
    expect(isOffTopic(passages)).toBe(false);
  });

  it('treats an empty retrieval as off topic', () => {
    // `every` on an empty array is true, which is the answer we want and worth pinning: an empty
    // library has nothing for the model to answer from either.
    expect(isOffTopic([])).toBe(true);
  });

  it('reads cosine, not the reranked score', () => {
    // §10.4's boosts are worth up to +0.25 — more than the whole gap between the populations. A
    // wholly irrelevant chunk from a full-text source with a matching sub-theme would clear a
    // floor applied to `score` on the boosts alone, which is how this guard would quietly stop
    // guarding anything.
    const irrelevantButBoosted = { cosine: 0.05, score: 0.05 + SUB_THEME_BOOST + FULL_TEXT_BOOST };
    expect(irrelevantButBoosted.score).toBeGreaterThan(RELEVANCE_FLOOR);
    expect(isOffTopic([irrelevantButBoosted])).toBe(true);
  });

  it('takes a caller-supplied floor, so the threshold can be tuned without a deploy', () => {
    expect(isOffTopic(at(0.4), 0.5)).toBe(true);
    expect(isOffTopic(at(0.4), 0.2)).toBe(false);
  });
});

describe('ADR-0087: suggestions draw on several papers', () => {
  const ranked = (rows: Array<[string, string, number]>) =>
    rerank(
      rows.map(([chunkId, sourceId, cosine]) => candidate({ chunkId, sourceId, cosine })),
      null,
    );

  it('a suggestion takes at most two passages from one paper while others have candidates', () => {
    const chosen = topK(
      ranked([
        ['a1', 'A', 0.9],
        ['a2', 'A', 0.89],
        ['a3', 'A', 0.88],
        ['a4', 'A', 0.87],
        ['b1', 'B', 0.6],
        ['c1', 'C', 0.55],
        ['d1', 'D', 0.5],
      ]),
      'ASSIST',
    );
    expect(chosen).toHaveLength(TOP_K.ASSIST);
    expect(chosen.filter((c) => c.sourceId === 'A')).toHaveLength(3);
    expect(new Set(chosen.slice(0, 5).map((c) => c.sourceId))).toEqual(
      new Set(['A', 'B', 'C', 'D']),
    );
  });

  it('a library of one paper still fills the suggestion', () => {
    const chosen = topK(
      ranked([
        ['a1', 'A', 0.9],
        ['a2', 'A', 0.8],
        ['a3', 'A', 0.7],
      ]),
      'ASSIST',
    );
    expect(chosen).toHaveLength(3);
  });

  it('a paper the chapter already cites steps back when another is close', () => {
    const before = ranked([
      ['a1', 'A', 0.62],
      ['b1', 'B', 0.6],
    ]);
    const after = spreadCitations(before, new Map([['A', 3]]));
    expect(after[0]?.sourceId).toBe('B');
  });

  it('but never lets a much weaker paper overtake an on-topic one', () => {
    const before = ranked([
      ['a1', 'A', 0.8],
      ['b1', 'B', 0.4],
    ]);
    const after = spreadCitations(before, new Map([['A', 40]]));
    expect(after[0]?.sourceId).toBe('A');
    expect((before[0]?.score ?? 0) - (after[0]?.score ?? 0)).toBeCloseTo(1 - SPREAD_FLOOR, 5);
  });

  it('counts the citations in a chapter by paper', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'One' },
            { type: 'citation', attrs: { sourceId: 'A' } },
            { type: 'citation', attrs: { sourceId: 'A' } },
            { type: 'citation', attrs: { sourceId: 'B' } },
          ],
        },
      ],
    };
    expect(citedSourceCounts(doc)).toEqual(
      new Map([
        ['A', 2],
        ['B', 1],
      ]),
    );
    expect(citedSourceCounts(null).size).toBe(0);
  });
});
