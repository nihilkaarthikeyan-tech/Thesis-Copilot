/**
 * ADR-0133, the pure half of "Search the literature" on an AI edit: what is searched for, which
 * found papers are added, and how their passages join the library's under fresh keys.
 */

import type { RetrievalResult, RetrievedPassage } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';
import {
  EDIT_LITERATURE,
  editSearchQuestion,
  literatureNote,
  papersToAdd,
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
  } as RetrievedPassage;
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

describe('editSearchQuestion', () => {
  it('asks with the instruction, then the selection without citation markers or maths', () => {
    expect(
      editSearchQuestion(
        'Upfront cost limits adoption {{cite:S1#c1}} by $x^2$ households.',
        'Add evidence',
      ),
    ).toBe('Add evidence. Upfront cost limits adoption by households.');
  });

  it('asks with the selection alone for a preset', () => {
    expect(editSearchQuestion('  Cost   limits adoption. ')).toBe('Cost limits adoption.');
  });
});

describe('papersToAdd', () => {
  it('keeps only papers on topic, not in the library, with an abstract — best first, five at most', () => {
    const scored = [
      { result: work(1), cosine: 0.7 },
      { result: work(2), cosine: 0.5 },
      { result: work(3, { inLibrary: true }), cosine: 0.9 },
      { result: work(4, { abstract: 'short' }), cosine: 0.9 },
      { result: work(5), cosine: 0.8 },
      ...[6, 7, 8, 9, 10].map((i) => ({ result: work(i), cosine: 0.65 })),
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

  it('adds a paper once when two indexes returned it', () => {
    const kept = papersToAdd([
      { result: work(1), cosine: 0.7 },
      { result: work(1, { via: 'pubmed' }), cosine: 0.69 },
    ]);
    expect(kept).toHaveLength(1);
  });

  it('adds nothing below the floor', () => {
    expect(papersToAdd([{ result: work(1), cosine: EDIT_LITERATURE.keepCosine - 0.01 }])).toEqual(
      [],
    );
  });
});

describe('withFoundPassages', () => {
  it('puts one passage per found paper first, then the library, re-keyed into one set', () => {
    const library = retrieval([
      passage('lib-a', 'c-a1', 0.8),
      passage('lib-a', 'c-a2', 0.7),
      passage('lib-b', 'c-b1', 0.6),
    ]);
    const found = retrieval([
      passage('new-1', 'c-n1', 0.75),
      passage('new-1', 'c-n1b', 0.74),
      passage('new-2', 'c-n2', 0.7),
    ]);
    const merged = withFoundPassages(library, found, 4);
    expect(merged.passages.map((p) => p.chunkId)).toEqual(['c-n1', 'c-n2', 'c-a1', 'c-a2']);
    expect(merged.passages.map((p) => p.id)).toEqual(['S1#c1', 'S2#c1', 'S3#c1', 'S3#c2']);
    // Every key resolves to its own row: no collision between the two retrievals' numbering.
    for (const p of merged.passages) {
      expect(merged.byKey.get(p.id)).toEqual({
        sourceId: p.sourceId,
        chunkId: p.chunkId,
        shortRef: p.shortRef,
      });
    }
    expect(merged.byKey.size).toBe(4);
  });

  it('never sends a chunk twice', () => {
    const shared = passage('new-1', 'c-n1', 0.75);
    const merged = withFoundPassages(retrieval([shared]), retrieval([shared]), 6);
    expect(merged.passages).toHaveLength(1);
  });

  it('is the library alone when nothing was found', () => {
    const merged = withFoundPassages(retrieval([passage('lib-a', 'c-a1', 0.8)]), null, 6);
    expect(merged.passages.map((p) => p.sourceId)).toEqual(['lib-a']);
  });
});

describe('literatureNote', () => {
  it('says so in one line whenever the edit used the library alone', () => {
    expect(literatureNote('added')).toBeNull();
    for (const outcome of ['failed', 'none-relevant', 'not-ready'] as const) {
      expect(literatureNote(outcome)).toMatch(/library alone/);
    }
  });
});
