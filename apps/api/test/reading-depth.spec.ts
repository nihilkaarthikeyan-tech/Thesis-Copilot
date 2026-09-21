/**
 * The reading-depth warning.
 *
 * The logic is small; the *judgement* in it is the thing worth pinning. Two decisions carry the
 * whole feature and both are easy to break later without noticing:
 *
 *   1. A source cited once from its abstract is a passing reference and must not be flagged. A
 *      tool that warns about everything is a tool nobody reads.
 *   2. A source cited heavily from its abstract is the single thing worth saying out loud.
 */

import { describe, expect, it } from 'vitest';
import {
  HEAVY_CITE_THRESHOLD,
  readingDepth,
  type SourceDepth,
} from '../src/modules/chapters/reading-depth.js';

const source = (over: Partial<SourceDepth> & { sourceId: string }): SourceDepth => ({
  shortRef: 'Kumar 2021',
  title: 'A paper',
  groundingLevel: 'FULL_TEXT',
  citeCount: 1,
  ...over,
});

describe('what gets flagged', () => {
  it('says nothing about a passing reference read only as an abstract', () => {
    const result = readingDepth([source({ sourceId: 's1', groundingLevel: 'ABSTRACT' })]);
    expect(result.atRisk).toEqual([]);
    expect(result.headline).toContain('normal for a passing reference');
  });

  it('flags the same source once the thesis leans on it', () => {
    const result = readingDepth([
      source({ sourceId: 's1', groundingLevel: 'ABSTRACT', citeCount: HEAVY_CITE_THRESHOLD }),
    ]);
    expect(result.atRisk.map((s) => s.sourceId)).toEqual(['s1']);
    expect(result.headline).toContain('only read the abstract');
  });

  it('names the most-leaned-on source, which is the one an examiner picks', () => {
    const result = readingDepth([
      source({
        sourceId: 'light',
        shortRef: 'Light 2020',
        groundingLevel: 'ABSTRACT',
        citeCount: 3,
      }),
      source({
        sourceId: 'heavy',
        shortRef: 'Heavy 2019',
        groundingLevel: 'ABSTRACT',
        citeCount: 9,
      }),
    ]);
    expect(result.atRisk[0]?.sourceId).toBe('heavy');
    expect(result.headline).toContain('Heavy 2019');
    expect(result.headline).toContain('9 times');
  });

  it('treats a source with nothing fetched as worse than one read as an abstract', () => {
    const result = readingDepth([
      source({ sourceId: 'abs', groundingLevel: 'ABSTRACT', citeCount: 9 }),
      source({ sourceId: 'none', groundingLevel: 'NONE', citeCount: 1 }),
    ]);
    // The NONE case wins the headline even though it is cited far less: citing something with no
    // abstract at all is a different kind of problem.
    expect(result.unread.map((s) => s.sourceId)).toEqual(['none']);
    expect(result.headline).toContain('nothing');
  });

  it('ignores sources in the library that are not cited at all', () => {
    // An uncited source is the citation checker's business (UNUSED), not this one's.
    const result = readingDepth([
      source({ sourceId: 'unused', groundingLevel: 'NONE', citeCount: 0 }),
      source({ sourceId: 'used', groundingLevel: 'FULL_TEXT', citeCount: 2 }),
    ]);
    expect(result.totals.cited).toBe(1);
    expect(result.unread).toEqual([]);
    expect(result.atRisk).toEqual([]);
  });
});

describe('when there is nothing to warn about', () => {
  it('stays silent on a document with no citations at all', () => {
    expect(readingDepth([]).headline).toBeNull();
    expect(readingDepth([source({ sourceId: 's1', citeCount: 0 })]).headline).toBeNull();
  });

  it('says so plainly when everything cited has been read in full', () => {
    const result = readingDepth([
      source({ sourceId: 's1', citeCount: 4 }),
      source({ sourceId: 's2', citeCount: 1 }),
    ]);
    expect(result.atRisk).toEqual([]);
    expect(result.headline).toContain('read in full');
  });
});

describe('the totals', () => {
  it('counts each depth among the cited sources only', () => {
    const result = readingDepth([
      source({ sourceId: 'a', groundingLevel: 'FULL_TEXT', citeCount: 1 }),
      source({ sourceId: 'b', groundingLevel: 'ABSTRACT', citeCount: 1 }),
      source({ sourceId: 'c', groundingLevel: 'NONE', citeCount: 1 }),
      source({ sourceId: 'd', groundingLevel: 'FULL_TEXT', citeCount: 0 }),
    ]);
    expect(result.totals).toEqual({ sources: 4, cited: 3, fullText: 1, abstract: 1, none: 1 });
  });

  it('gets the singular right, because "1 sources" reads as a bug', () => {
    const one = readingDepth([source({ sourceId: 'n', groundingLevel: 'NONE', citeCount: 1 })]);
    expect(one.headline).toContain('1 source ');
    expect(one.headline).toContain('has nothing');
    expect(one.headline).not.toContain('1 sources');
  });
});
