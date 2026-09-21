/**
 * The chat scopes — ADR-0016.
 *
 * Unit tests over the two pure pieces, because the interesting decisions are both shape
 * decisions: which chapters a question sees, and what a search result has to look like for the
 * existing resolver to accept it. The service wiring around them is exercised by the harness
 * tests that already cover `/chat`.
 *
 * The one thing worth stating twice: passages built from a student's own chapters carry an empty
 * `sourceId`, which is what makes them uncitable downstream. If that ever becomes a real id, the
 * bibliography gains an entry pointing at the thesis itself.
 */

import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_SCOPE,
  passagesFromChapters,
  rankChapters,
} from '../src/modules/assist/document-scope.js';
import { referenceLineOf } from '../src/modules/assist/web-scope.service.js';

/** A ProseMirror doc with one paragraph, which is all `docToText` needs. */
const chapterOf = (id: string, title: string, order: number, text: string) => ({
  id,
  title,
  order,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  },
});

const INTRO = chapterOf('c1', 'Introduction', 1, 'Rooftop solar adoption in Karnataka is low.');
const METHODS = chapterOf('c2', 'Methodology', 2, 'We interviewed installers using a survey.');
const RESULTS = chapterOf('c3', 'Results', 3, 'Households dropped out after the first quote.');

describe('which chapters a question sees', () => {
  it('puts the chapters that mention the question first', () => {
    const ranked = rankChapters([INTRO, METHODS, RESULTS], 'what survey did we use');
    expect(ranked[0]?.title).toBe('Methodology');
  });

  it('falls back to document order when nothing matches', () => {
    const ranked = rankChapters([RESULTS, INTRO, METHODS], 'zzzz nothing matches this');
    expect(ranked.map((c) => c.order)).toEqual([1, 2, 3]);
  });

  it('ignores short words, which match everything and rank nothing', () => {
    // "the", "did", "we" are in every chapter; only "installers" should decide.
    const ranked = rankChapters([INTRO, METHODS, RESULTS], 'did we the installers');
    expect(ranked[0]?.title).toBe('Methodology');
  });

  it('never sends more than the bound, however long the thesis', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      chapterOf(`c${i}`, `Chapter ${i}`, i, 'solar adoption barriers'),
    );
    expect(passagesFromChapters(many, 'solar').length).toBe(DOCUMENT_SCOPE.maxChapters);
  });
});

describe('what a chapter passage is', () => {
  it('carries no sourceId, which is what makes it uncitable', () => {
    const [passage] = passagesFromChapters([INTRO], 'solar');
    expect(passage?.sourceId).toBe('');
    expect(passage?.chunkId).toBe('');
  });

  it('is namespaced so it can never collide with a real passage id', () => {
    const [passage] = passagesFromChapters([INTRO], 'solar');
    // Library passages are `S<sourceId>#c<chunkId>`.
    expect(passage?.id.startsWith('D#')).toBe(true);
    expect(passage?.id.startsWith('S')).toBe(false);
  });

  it('names the chapter, so an answer can say where in the thesis it read', () => {
    const [passage] = passagesFromChapters([METHODS], 'survey');
    expect(passage?.shortRef).toBe('Methodology');
  });

  it('truncates a long chapter rather than sending the whole thesis', () => {
    const huge = chapterOf('c9', 'Long', 1, 'adoption '.repeat(5_000));
    const [passage] = passagesFromChapters([huge], 'adoption');
    expect(passage?.text.length).toBe(DOCUMENT_SCOPE.charsPerChapter);
  });

  it('drops an empty chapter instead of sending a blank passage', () => {
    const empty = { id: 'c0', title: 'Untouched', order: 1, content: { type: 'doc', content: [] } };
    expect(passagesFromChapters([empty], 'anything')).toEqual([]);
  });
});

describe('what a web result hands to the resolver', () => {
  const work = {
    openalexId: 'W1',
    doi: '10.1234/x',
    title: 'Rooftop solar uptake in South India',
    abstract: null,
    year: 2023,
    venue: 'Energy Policy',
    citationCount: 12,
    isPreprint: false,
    oaStatus: 'gold',
    via: 'openalex' as const,
  };

  it('builds a reference line the resolver can match on', () => {
    expect(referenceLineOf(work)).toBe('Rooftop solar uptake in South India. Energy Policy. 2023');
  });

  it('omits the parts that are missing rather than leaving gaps in the line', () => {
    expect(referenceLineOf({ ...work, venue: null, year: null })).toBe(
      'Rooftop solar uptake in South India',
    );
  });
});
