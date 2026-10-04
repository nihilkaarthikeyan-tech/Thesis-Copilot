/**
 * The matching passage under each "Find papers" result (coverage-map row 23).
 *
 * The abstracts are the recorded, unedited responses in `test/fixtures/scholarly/` (arXiv search
 * and PubMed efetch, recorded 2026-09-24 for ADR-0020), read through the same parsers the clients
 * use. The one invariant that matters is checked on every case: the passage is a verbatim slice
 * of the abstract.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseArxivFeed } from '../src/scholarly/arxiv.js';
import { matchingPassage, PASSAGE, stemOf } from '../src/scholarly/passage.js';
import { parsePubmedArticles } from '../src/scholarly/pubmed.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/scholarly/${name}`, import.meta.url), 'utf8');

const arxiv = parseArxivFeed(fixture('arxiv-search.xml'));
const pubmed = parsePubmedArticles(fixture('pubmed-efetch.xml'));

function verbatim(abstract: string, query: string) {
  const passage = matchingPassage(abstract, query);
  if (passage) {
    expect(abstract).toContain(passage.text);
    for (const h of passage.highlights) {
      expect(h.start).toBeGreaterThanOrEqual(0);
      expect(h.end).toBeLessThanOrEqual(passage.text.length);
    }
  }
  return passage;
}

describe('the passage chosen', () => {
  it('is the sentence of an arXiv abstract with the most query terms', () => {
    const abstract = arxiv[1]?.abstract ?? '';
    const passage = verbatim(abstract, 'barriers to rooftop solar adoption');
    expect(
      passage?.text.startsWith('Residential rooftop solar adoption is considered crucial'),
    ).toBe(true);
    const marked = passage?.highlights.map((h) => passage.text.slice(h.start, h.end));
    expect(marked).toEqual(expect.arrayContaining(['rooftop', 'solar', 'adoption']));
  });

  it('matches a word with a common ending ("loss" finds "losses")', () => {
    expect(stemOf('barriers')).toBe(stemOf('barrier'));
    expect(stemOf('adoption')).toBe(stemOf('adopt'));
    const abstract = arxiv[0]?.abstract ?? '';
    const passage = verbatim(abstract, 'shading loss');
    expect(passage?.text).toBe(
      'We demonstrate a fully automated layout design pipeline that attempts to solve a more general formulation with greater geometric flexibility that accounts for shading losses.',
    );
    expect(passage?.highlights.map((h) => passage.text.slice(h.start, h.end))).toEqual([
      'shading',
      'losses',
    ]);
  });

  it('keeps the passage short: at most two sentences, within the limit', () => {
    for (const work of [...arxiv, ...pubmed]) {
      if (!work.abstract) continue;
      const passage = verbatim(work.abstract, 'rooftop solar adoption barriers');
      if (passage) expect(passage.text.length).toBeLessThanOrEqual(PASSAGE.maxChars);
    }
  });

  it('works on a PubMed abstract', () => {
    const withAbstract = pubmed.find((p) => p.abstract);
    if (!withAbstract?.abstract) throw new Error('the fixture has an abstract');
    const passage = verbatim(withAbstract.abstract, 'rooftop solar adoption');
    expect(passage).not.toBeNull();
    expect(passage?.highlights.length).toBeGreaterThan(0);
  });
});

describe('when there is no passage', () => {
  it('is null without an abstract', () => {
    expect(matchingPassage(null, 'solar')).toBeNull();
    expect(matchingPassage('   ', 'solar')).toBeNull();
  });

  it('is null when nothing in the abstract matches, rather than showing an unrelated line', () => {
    expect(matchingPassage(arxiv[0]?.abstract, 'mangrove carbon sequestration')).toBeNull();
  });

  it('is null for a query of only question words', () => {
    expect(matchingPassage(arxiv[0]?.abstract, 'what does the literature say?')).toBeNull();
  });
});

describe('a long sentence', () => {
  it('is clipped around its first match, still verbatim, and says it was clipped', () => {
    const words = Array.from({ length: 150 }, (_, i) => `word${i}`);
    words[100] = 'drought';
    const abstract = words.join(' ');
    const passage = verbatim(abstract, 'drought');
    expect(passage?.text.length).toBeLessThanOrEqual(PASSAGE.maxChars);
    expect(passage?.clippedStart).toBe(true);
    expect(passage?.text).toContain('drought');
  });
});
