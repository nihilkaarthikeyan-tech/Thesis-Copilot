/**
 * ADR-0133, the pure half of "Search the literature" on an AI edit: which found papers are added,
 * the passages their abstracts become, and how those join the library's under fresh keys. What is
 * searched for and the measured rule are `packages/retrieval/test/edit-search.spec.ts`.
 */

import type { RetrievalResult, RetrievedPassage } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';
import {
  abstractPassages,
  EDIT_LITERATURE,
  literatureNote,
  papersToAdd,
  realChunkId,
  withFoundPassages,
} from '../src/modules/assist/edit-literature.js';
import type { WebResult } from '../src/modules/assist/web-scope.service.js';

function work(i: number, over: Partial<WebResult> = {}): WebResult {
  return {
    title: `Paper ${i}`,
    abstract: `An abstract long enough to be read, about rooftop solar adoption, number ${i}, and its costs.`,
    matchedPassage: null,
    year: 2020 + i,
    venue: 'Energy Policy',
    doi: `10.1/p${i}`,
    citationCount: 1,
    isPreprint: false,
    openAccess: false,
    inLibrary: false,
    via: 'openalex',
    reference: { raw: `Paper ${i}. Energy Policy. ${2020 + i}`, doi: `10.1/p${i}` },
    ...over,
  };
}

function passage(sourceId: string, chunkId: string, cosine: number): RetrievedPassage {
  return {
    id: 'S1#c1',
    shortRef: sourceId,
    page: null,
    text: `text of ${chunkId}`,
    sourceId,
    chunkId,
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

describe('papersToAdd', () => {
  it('keeps papers on topic, not in the library, with an abstract — best first, five at most', () => {
    const scored = [
      { result: work(1), cosine: 0.78 },
      { result: work(2), cosine: 0.5 },
      { result: work(3, { inLibrary: true }), cosine: 0.9 },
      { result: work(4, { abstract: 'short' }), cosine: 0.9 },
      { result: work(5), cosine: 0.8 },
      ...[6, 7, 8, 9, 10].map((i) => ({ result: work(i), cosine: 0.75 })),
    ];
    const kept = papersToAdd(scored);
    expect(kept.map((w) => w.title)).toEqual([
      'Paper 5',
      'Paper 1',
      'Paper 6',
      'Paper 7',
      'Paper 8',
    ]);
    expect(kept).toHaveLength(EDIT_LITERATURE.maxPapers);
  });

  it('measures "close to the best" among the papers it could add, not one already in the library', () => {
    const kept = papersToAdd([
      { result: work(1, { inLibrary: true }), cosine: 0.95 },
      { result: work(2), cosine: 0.75 },
    ]);
    expect(kept.map((w) => w.title)).toEqual(['Paper 2']);
  });

  it('adds a paper once when two indexes returned it', () => {
    const kept = papersToAdd([
      { result: work(1), cosine: 0.7 },
      { result: work(1, { via: 'pubmed' }), cosine: 0.69 },
    ]);
    expect(kept).toHaveLength(1);
  });

  it('adds nothing when the best is a weak match (the live run: 0.62 and below)', () => {
    expect(
      papersToAdd([
        { result: work(1), cosine: 0.62 },
        { result: work(2), cosine: 0.574 },
      ]),
    ).toEqual([]);
  });
});

describe('abstract passages', () => {
  it('are tied to the new library row and carry no chunk out of the server', () => {
    const [p] = abstractPassages([
      {
        sourceId: 'new-1',
        shortRef: 'Rao 2022',
        abstract: '  Credit   raised adoption. ',
        cosine: 0.8,
      },
    ]);
    expect(p).toMatchObject({
      sourceId: 'new-1',
      shortRef: 'Rao 2022',
      text: 'Credit raised adoption.',
    });
    expect(realChunkId(p?.chunkId ?? '')).toBeNull();
    expect(realChunkId('0189aaaa-0000-7000-8000-000000000001')).toBe(
      '0189aaaa-0000-7000-8000-000000000001',
    );
  });
});

describe('withFoundPassages', () => {
  it('puts the found abstracts first, then the library, re-keyed into one set', () => {
    const library = retrieval([
      passage('lib-a', 'c-a1', 0.8),
      passage('lib-a', 'c-a2', 0.7),
      passage('lib-b', 'c-b1', 0.6),
    ]);
    const found = abstractPassages([
      { sourceId: 'new-1', shortRef: 'N1', abstract: 'one', cosine: 0.75 },
      { sourceId: 'new-2', shortRef: 'N2', abstract: 'two', cosine: 0.7 },
    ]);
    const merged = withFoundPassages(library, found, 4);
    expect(merged.passages.map((p) => p.sourceId)).toEqual(['new-1', 'new-2', 'lib-a', 'lib-a']);
    expect(merged.passages.map((p) => p.id)).toEqual(['S1#c1', 'S2#c1', 'S3#c1', 'S3#c2']);
    for (const p of merged.passages) {
      expect(merged.byKey.get(p.id)).toEqual({
        sourceId: p.sourceId,
        chunkId: p.chunkId,
        shortRef: p.shortRef,
      });
    }
    expect(merged.byKey.size).toBe(4);
  });

  it('a paper there by its abstract is not sent again by an indexed chunk', () => {
    const found = abstractPassages([
      { sourceId: 'new-1', shortRef: 'N1', abstract: 'one', cosine: 0.75 },
    ]);
    const merged = withFoundPassages(retrieval([passage('new-1', 'c-n1', 0.9)]), found, 6);
    expect(merged.passages).toHaveLength(1);
    expect(realChunkId(merged.passages[0]?.chunkId ?? '')).toBeNull();
  });

  it('is the library alone when nothing was found', () => {
    const merged = withFoundPassages(retrieval([passage('lib-a', 'c-a1', 0.8)]), [], 6);
    expect(merged.passages.map((p) => p.sourceId)).toEqual(['lib-a']);
  });
});

describe('literatureNote', () => {
  it('says so in one line whenever the edit used the library alone', () => {
    expect(literatureNote('added')).toBeNull();
    for (const outcome of ['failed', 'none-relevant'] as const) {
      expect(literatureNote(outcome)).toMatch(/library alone/);
    }
  });
});
