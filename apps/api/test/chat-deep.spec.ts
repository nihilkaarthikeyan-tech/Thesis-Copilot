/**
 * Deep research in chat — ADR-0080, the pure half: how the parts' retrievals and searches merge
 * into one request, how a found abstract's relevance is scored, and the words the student sees.
 * No database, no network, no model.
 */

import { DEEP_RESEARCH } from '@tc/ai';
import type { RetrievalResult, RetrievedPassage } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';
import {
  bestCosines,
  DEEP_EMPTY_REPLY,
  deepNote,
  mergeCandidates,
  mergeRetrievals,
  PLANNING_STEP,
  partQuestions,
  partStep,
  plannedStep,
} from '../src/modules/assist/chat-deep.js';
import type { WebResult } from '../src/modules/assist/web-scope.service.js';

function passage(id: string, sourceId: string, cosine: number): RetrievedPassage {
  return {
    id,
    shortRef: `${sourceId} 2021`,
    page: 1,
    text: `Passage ${id}.`,
    sourceId,
    chunkId: `chunk-${id}`,
    score: cosine,
    cosine,
  };
}

function retrieval(passages: RetrievedPassage[]): RetrievalResult {
  return {
    passages,
    byKey: new Map(
      passages.map((p) => [
        p.id,
        { sourceId: p.sourceId, chunkId: p.chunkId, shortRef: p.shortRef },
      ]),
    ),
    pinned: 0,
    candidates: passages.length,
  };
}

function result(i: number, over: Partial<WebResult> = {}): WebResult {
  return {
    title: `Rural mobile banking study ${i}`,
    abstract: `Study ${i} surveyed rural women about mobile banking. Digital literacy and trust were the barriers most often reported, with phone ownership a close third.`,
    matchedPassage: null,
    year: 2020 + i,
    venue: 'Journal',
    doi: `10.1000/deep.${i}`,
    citationCount: 2,
    isPreprint: false,
    openAccess: true,
    inLibrary: false,
    via: 'openalex',
    reference: { raw: `Rural mobile banking study ${i}`, doi: `10.1000/deep.${i}` },
    ...over,
  };
}

describe('mergeRetrievals', () => {
  it('takes the best over every part, a passage once, no paper more than the cap while others wait', () => {
    const a = retrieval([
      ...Array.from({ length: 8 }, (_, i) => passage(`a${i}`, 'A', 0.9 - i / 100)),
    ]);
    const b = retrieval([
      passage('a0', 'A', 0.85), // the same passage from another part, lower: kept once, best cosine
      ...Array.from({ length: 6 }, (_, i) => passage(`b${i}`, 'B', 0.8 - i / 100)),
      ...Array.from({ length: 6 }, (_, i) => passage(`c${i}`, 'C', 0.7 - i / 100)),
    ]);
    const merged = mergeRetrievals([a, b]);
    expect(merged.passages).toHaveLength(DEEP_RESEARCH.libraryTopK);
    expect(merged.passages.filter((p) => p.id === 'a0')).toHaveLength(1);
    expect(merged.passages.find((p) => p.id === 'a0')?.cosine).toBe(0.9);
    // A's four best, then B's and C's in rank order, then A's held ones fill the rest.
    expect(merged.passages.slice(0, 4).map((p) => p.sourceId)).toEqual(['A', 'A', 'A', 'A']);
    const first12 = merged.passages.slice(0, 12).map((p) => p.sourceId);
    expect(first12.filter((s) => s === 'B')).toHaveLength(4);
    expect(first12.filter((s) => s === 'C')).toHaveLength(4);
    expect(merged.passages.slice(12).every((p) => p.sourceId === 'A')).toBe(true);
    // The key map only holds what is in the request.
    expect([...merged.byKey.keys()].sort()).toEqual(merged.passages.map((p) => p.id).sort());
    expect(merged.candidates).toBe(8 + 13);
  });

  it('a library of one paper still fills the request', () => {
    const only = retrieval(
      Array.from({ length: 20 }, (_, i) => passage(`a${i}`, 'A', 0.9 - i / 100)),
    );
    expect(mergeRetrievals([only]).passages).toHaveLength(DEEP_RESEARCH.libraryTopK);
  });

  it('is empty for an empty library', () => {
    expect(mergeRetrievals([retrieval([]), retrieval([])]).passages).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  it('a paper once by DOI or title, not in the library, with an abstract, at most the budget', () => {
    const merged = mergeCandidates([
      [result(1), result(2), result(3, { inLibrary: true })],
      [result(1), result(2, { doi: null }), result(4, { abstract: 'short' }), result(5)],
      [
        result(2, { doi: '10.1000/DEEP.2' }),
        result(6, { doi: null, title: 'Rural mobile banking study 1' }),
      ],
    ]);
    // Study 2 without its DOI and study 1 under another DOI are the same papers, by title.
    expect(merged.map((r) => r.doi)).toEqual([
      '10.1000/deep.1',
      '10.1000/deep.2',
      '10.1000/deep.5',
    ]);
  });

  it(`takes at most ${DEEP_RESEARCH.maxCandidates}`, () => {
    const many = Array.from({ length: 80 }, (_, i) => result(i));
    expect(mergeCandidates([many])).toHaveLength(DEEP_RESEARCH.maxCandidates);
  });
});

describe('bestCosines', () => {
  it('scores a candidate by its best match against the question or any part', () => {
    const q = [1, 0, 0];
    const p1 = [0, 1, 0];
    const p2 = [0, 0, 1];
    const c1 = [0, 1, 0]; // on part 1 only
    const c2 = [1, 0, 0]; // on the question
    const c3 = [0.7, 0.7, 0]; // between
    const dot = (a: readonly number[], b: readonly number[]) =>
      a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
    const scores = bestCosines([q, p1, p2, c1, c2, c3], 2, 3, dot);
    expect(scores[0]).toBeCloseTo(1);
    expect(scores[1]).toBeCloseTo(1);
    expect(scores[2]).toBeCloseTo(0.7);
  });
});

describe('the words', () => {
  const plan = [
    {
      title: 'Digital literacy',
      question: 'How does literacy limit use?',
      query: 'digital literacy rural women mobile banking',
    },
    {
      title: 'Trust',
      question: 'What role does trust play?',
      query: 'trust mobile banking rural women India',
    },
  ];

  it('plans, then one step per part, each carrying what the panel needs in another language', () => {
    expect(PLANNING_STEP.id).toBe('plan');
    expect(plannedStep(plan)).toEqual({
      id: 'planned',
      text: 'Planned 2 parts: Digital literacy · Trust',
      params: { parts: 2, titles: 'Digital literacy · Trust' },
    });
    expect(partStep(1, 2, plan[1] as (typeof plan)[number])).toEqual({
      id: 'part',
      text: 'Part 2 of 2, Trust: searching your library and the indexes for: trust mobile banking rural women India…',
      params: {
        index: 2,
        total: 2,
        title: 'Trust',
        query: 'trust mobile banking rural women India',
      },
    });
    expect(partQuestions(plan)).toEqual([
      'Digital literacy. How does literacy limit use?',
      'Trust. What role does trust play?',
    ]);
  });

  it('the line under the answer, and the reply when nothing was found', () => {
    expect(deepNote(3, 5)).toBe(
      'From 3 papers in your library and the abstracts of 5 found by the searches, not in your library — add the ones you use.',
    );
    expect(deepNote(1, 0)).toBe(
      'From 1 paper in your library; the searches found nothing closer to the question.',
    );
    expect(DEEP_EMPTY_REPLY).toMatch(/^Neither your library nor a search/);
  });
});
