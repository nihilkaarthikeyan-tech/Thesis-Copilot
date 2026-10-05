/**
 * ADR-0074: when chat's library is thin for a question, and what it searches for. Pure.
 */

import { describe, expect, it } from 'vitest';
import {
  CHAT_RESEARCH,
  libraryCoverage,
  planResearchQueries,
  researchEmbedText,
} from '../src/index.js';

const passage = (cosine: number, sourceId: string) => ({ cosine, sourceId });

describe('libraryCoverage', () => {
  it('is not thin with enough on-topic passages from enough papers', () => {
    const c = libraryCoverage([
      passage(0.8, 'a'),
      passage(0.7, 'b'),
      passage(0.66, 'c'),
      passage(0.6, 'd'),
      passage(0.58, 'a'),
    ]);
    expect(c).toMatchObject({ onTopic: 5, sources: 4, thin: false, reason: null });
    expect(c.best).toBeCloseTo(0.8);
  });

  it('is thin when the on-topic passages come from too few papers (the side-by-side library)', () => {
    // A five-paper library put three papers in the top eight for every question (measured).
    const c = libraryCoverage([
      passage(0.8, 'a'),
      passage(0.79, 'a'),
      passage(0.77, 'b'),
      passage(0.75, 'b'),
      passage(0.74, 'c'),
      passage(0.72, 'a'),
      passage(0.7, 'c'),
      passage(0.69, 'b'),
    ]);
    expect(c).toMatchObject({ onTopic: 8, sources: 3, thin: true, reason: 'few-sources' });
  });

  it('is thin when few passages clear the on-topic line, however many papers there are', () => {
    const c = libraryCoverage([
      passage(0.59, 'a'),
      passage(0.57, 'b'),
      passage(0.56, 'c'),
      passage(0.5, 'd'),
      passage(0.45, 'e'),
    ]);
    expect(c).toMatchObject({ onTopic: 3, thin: true, reason: 'few-passages' });
  });

  it('reads the line from the measured constants', () => {
    expect(CHAT_RESEARCH.onTopicCosine).toBe(0.55);
    expect(CHAT_RESEARCH.minSources).toBe(4);
    expect(CHAT_RESEARCH.keepCosine).toBe(0.6);
    // A passage exactly on the line counts.
    const on = [0, 1, 2, 3].map((i) => passage(CHAT_RESEARCH.onTopicCosine, `s${i}`));
    expect(libraryCoverage(on).thin).toBe(false);
  });

  it('an empty set is thin, with nothing on topic', () => {
    expect(libraryCoverage([])).toMatchObject({ best: 0, onTopic: 0, sources: 0, thin: true });
  });
});

describe('planResearchQueries', () => {
  const C2 =
    'What are the main financial barriers to rooftop solar adoption for rural households in India, according to my sources?';

  it('plans the side-by-side question as a semantic search and two keyword searches', () => {
    const plan = planResearchQueries(C2, 'Barriers to rooftop solar adoption in Karnataka');
    expect(plan.semantic).toBe(`Barriers to rooftop solar adoption in Karnataka. ${C2}`);
    expect(plan.keyword).toEqual([
      'financial barriers rooftop solar adoption rural households india',
      'financial barriers rooftop solar',
    ]);
  });

  it('drops the words of asking: "main", "according", "sources"', () => {
    const [full] = planResearchQueries(C2, '').keyword;
    expect(full).not.toMatch(/\b(main|according|sources|what)\b/);
  });

  it('a short question gets one keyword search, never the same one twice', () => {
    const plan = planResearchQueries('Does EDM wear graphite electrodes?', 'EDM of Hastelloy');
    expect(plan.keyword).toEqual(['edm wear graphite electrodes']);
  });

  it('a question with no content words plans no keyword search, and the semantic one still runs', () => {
    const plan = planResearchQueries('What does it say?', 'Fish drying in Kerala');
    expect(plan.keyword).toEqual([]);
    expect(plan.semantic).toBe('Fish drying in Kerala. What does it say?');
  });

  it('without a title the semantic search is the question alone, cut to 2,000 characters', () => {
    expect(planResearchQueries('  How   does it work? ', '').semantic).toBe('How does it work?');
    expect(planResearchQueries('x'.repeat(3_000), '').semantic).toHaveLength(2_000);
  });
});

describe('researchEmbedText', () => {
  it('is the title then the abstract, cut to the embedding budget', () => {
    expect(researchEmbedText({ title: 'T', abstract: 'A  b\nc' })).toBe('T. A b c');
    expect(researchEmbedText({ title: 'T', abstract: 'x'.repeat(5_000) })).toHaveLength(
      CHAT_RESEARCH.embedChars,
    );
    expect(researchEmbedText({ title: 'T', abstract: null })).toBe('T. ');
  });
});
