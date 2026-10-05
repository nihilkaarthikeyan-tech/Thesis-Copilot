/**
 * ADR-0071 — chunks that are not prose are not evidence.
 *
 * Found on production (2026-10-05): a draft for a section the system could only call "Chapter 1"
 * retrieved a paper's run of headings ("Abstract / Literature Review / Materials and Methods …")
 * and the model described them, with citations, as if they were findings.
 */

import { describe, expect, it } from 'vitest';
import { chunkText, isProseChunk } from '../src/chunker.js';

const sentence =
  'Households in the surveyed districts delayed installation because the subsidy reached them months after purchase.';

describe('isProseChunk', () => {
  it('keeps an ordinary paragraph', () => {
    expect(isProseChunk({ text: `${sentence} ${sentence}`, section: 'Results' })).toBe(true);
  });

  it('drops a run of headings, as a contents page reads', () => {
    const headings = [
      'Abstract',
      'Literature Review',
      'Comparative Analysis',
      'Materials and Methods',
      'Data collection',
      'Data Analysis and Findings',
      'Financial Models and Market Potential',
      'Policy And Regulatory Landscape',
      'References',
    ].join('\n');
    expect(isProseChunk({ text: headings, section: 'Contents overview' })).toBe(false);
  });

  it('drops a fragment too short to ground a sentence', () => {
    expect(isProseChunk({ text: 'Table 1. Sample composition (N = 70)', section: null })).toBe(
      false,
    );
  });

  it('drops everything in a references or acknowledgements section', () => {
    expect(isProseChunk({ text: `${sentence} ${sentence}`, section: 'References' })).toBe(false);
    expect(isProseChunk({ text: `${sentence} ${sentence}`, section: '7. Acknowledgements' })).toBe(
      false,
    );
  });

  it('drops a block of reference entries even outside a references heading', () => {
    const entries = Array.from(
      { length: 5 },
      (_, i) =>
        `Kumar, A., et al. (20${10 + i}). Solar adoption in villages. Energy Policy, 12, 1-9. https://doi.org/10.1/x${i}`,
    ).join('\n');
    expect(isProseChunk({ text: entries, section: 'Discussion' })).toBe(false);
  });
});

describe('chunkText drops non-prose chunks', () => {
  it('keeps the prose sections and drops the references', () => {
    const results = `${sentence} ${sentence} ${sentence}`;
    const refs =
      'Kumar, A., et al. (2019). Title one. Journal, 1. Rao, B., et al. (2020). Title two. Journal, 2. Das, C., et al. (2021). Title three. Journal, 3.';
    const text = `${results}\n${refs}`;
    const chunks = chunkText({
      text,
      sections: [
        { section: 'Results', start: 0, end: results.length },
        { section: 'References', start: results.length + 1, end: text.length },
      ],
    });
    expect(chunks.map((c) => c.section)).toEqual(['Results']);
    expect(chunks[0]?.ordinal).toBe(0);
  });

  it('never leaves a source with nothing: an all-fragment text keeps its chunks', () => {
    const chunks = chunkText({ text: 'Abstract only.' });
    expect(chunks).toHaveLength(1);
  });

  it('can keep everything when asked', () => {
    const text = `${sentence}\nReferences list entry (2019).`;
    const kept = chunkText(
      { text, sections: [{ section: 'References', start: 0, end: text.length }] },
      { keepNonProse: true },
    );
    expect(kept.length).toBeGreaterThan(0);
  });
});
