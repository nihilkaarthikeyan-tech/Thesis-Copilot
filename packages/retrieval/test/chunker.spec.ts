/**
 * PHASES 1-W2 task 2.7 — chunker.
 * DoD: "unit tests for the chunker (no mid-sentence splits; overlap size; page preserved)".
 */

import { describe, expect, it } from 'vitest';
import { batched, chunkText, DEFAULT_TARGET_TOKENS, type PageSpan } from '../src/chunker.js';
import { approxTokens } from '../src/text.js';

/** Builds prose of roughly `count` sentences, each about 100 characters. */
function prose(count: number, prefix = 'S'): string {
  return Array.from(
    { length: count },
    (_, i) =>
      `${prefix}${i} the measured adoption rate across the surveyed districts rose steadily in the reported period.`,
  ).join(' ');
}

describe('chunker (FR-2.4)', () => {
  const text = prose(60);
  const chunks = chunkText({ text });

  it('produces chunks near the 350-token target', () => {
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // A chunk may overshoot only when a single sentence is longer than the budget.
      expect(chunk.tokenCount, chunk.text.slice(0, 40)).toBeLessThanOrEqual(
        DEFAULT_TARGET_TOKENS * 1.3,
      );
    }
    const middle = chunks.slice(0, -1);
    for (const chunk of middle) {
      expect(chunk.tokenCount).toBeGreaterThan(DEFAULT_TARGET_TOKENS * 0.5);
    }
  });

  it('never splits mid-sentence', () => {
    for (const chunk of chunks) {
      const trimmed = chunk.text.trim();
      // Every chunk ends on a sentence terminator …
      expect(trimmed.endsWith('.'), trimmed.slice(-40)).toBe(true);
      // … and starts at the beginning of one (our fixture sentences all start "S<n> ").
      expect(/^S\d+\s/.test(trimmed), trimmed.slice(0, 40)).toBe(true);
    }
  });

  it('offsets index the original text, so a chunk can be found again', () => {
    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  });

  it('consecutive chunks overlap by roughly 15% of the target', () => {
    const target = DEFAULT_TARGET_TOKENS;
    for (let i = 1; i < chunks.length; i++) {
      const previous = chunks[i - 1];
      const current = chunks[i];
      if (!previous || !current) continue;
      const overlapChars = previous.charEnd - current.charStart;
      expect(overlapChars, `chunk ${i} does not overlap its predecessor`).toBeGreaterThan(0);
      const overlapTokens = approxTokens(text.slice(current.charStart, previous.charEnd));
      // Whole sentences only, so the overlap lands near the 15% budget rather than exactly on it.
      expect(overlapTokens).toBeLessThanOrEqual(target * 0.15 + 40);
    }
  });

  it('numbers chunks consecutively from zero', () => {
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it('keeps the page a chunk starts on', () => {
    const body = prose(40);
    const pages: PageSpan[] = [
      { page: 1, start: 0, end: Math.floor(body.length / 3) },
      { page: 2, start: Math.floor(body.length / 3), end: Math.floor((2 * body.length) / 3) },
      { page: 3, start: Math.floor((2 * body.length) / 3), end: body.length },
    ];
    const paged = chunkText({ text: body, pages });

    expect(paged.every((c) => c.page !== null)).toBe(true);
    // Pages never go backwards, and every page that has text is represented.
    const seen = paged.map((c) => c.page as number);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(new Set(seen).size).toBeGreaterThan(1);

    for (const chunk of paged) {
      const span = pages.find((p) => p.page === chunk.page);
      expect(chunk.charStart).toBeGreaterThanOrEqual(span?.start ?? 0);
      expect(chunk.charStart).toBeLessThan(span?.end ?? 0);
    }
  });

  it('page is null when the source has no pagination', () => {
    expect(chunkText({ text: prose(5) }).every((c) => c.page === null)).toBe(true);
  });

  it('never lets a chunk span two sections', () => {
    const intro = prose(20, 'I');
    const method = prose(20, 'M');
    const body = `${intro} ${method}`;
    const sectioned = chunkText({
      text: body,
      sections: [
        { section: 'Introduction', start: 0, end: intro.length },
        { section: 'Method', start: intro.length + 1, end: body.length },
      ],
    });

    expect(sectioned.some((c) => c.section === 'Introduction')).toBe(true);
    expect(sectioned.some((c) => c.section === 'Method')).toBe(true);
    for (const chunk of sectioned) {
      const inIntro = chunk.text.includes('I0 ') || /\bI\d+\s/.test(chunk.text);
      const inMethod = /\bM\d+\s/.test(chunk.text);
      expect(inIntro && inMethod, 'a chunk spans two sections').toBe(false);
    }
  });

  it('emits an over-long sentence whole rather than cutting it', () => {
    const long = `${'word '.repeat(600)}end.`;
    const [chunk, ...rest] = chunkText({ text: long });
    expect(rest).toHaveLength(0);
    expect(chunk?.text.trim()).toBe(long.trim());
    expect(chunk?.tokenCount).toBeGreaterThan(DEFAULT_TARGET_TOKENS);
  });

  it('handles empty and whitespace-only input', () => {
    expect(chunkText({ text: '' })).toEqual([]);
    expect(chunkText({ text: '   \n\n  ' })).toEqual([]);
  });

  it('folds a tiny trailing remainder into the previous chunk', () => {
    const body = `${prose(30)} Short.`;
    const result = chunkText({ text: body });
    expect(result.at(-1)?.text.trim().endsWith('Short.')).toBe(true);
    expect(result.at(-1)?.tokenCount).toBeGreaterThan(20);
  });

  it('terminates on pathological input rather than looping', () => {
    // Five sentences, each far larger than the budget. Each starts with a capital so the splitter
    // recognises the boundary; a lowercase continuation is deliberately NOT a new sentence.
    const huge = Array.from({ length: 5 }, (_, i) => `A${i} ${'x'.repeat(2000)}.`).join(' ');
    const result = chunkText({ text: huge });
    expect(result.length).toBe(5);
    expect(result.every((c) => c.tokenCount > DEFAULT_TARGET_TOKENS)).toBe(true);
  });

  it('does not treat a lowercase continuation as a new sentence', () => {
    // "1.5 mm" and similar must not create a boundary, or the chunker would split mid-sentence.
    const single = `${'x'.repeat(2000)}. ${'y'.repeat(2000)}.`;
    expect(chunkText({ text: single })).toHaveLength(1);
  });
});

describe('batched', () => {
  it('splits into batches of 64 by default (PHASES 2.7)', () => {
    const batches = batched(Array.from({ length: 150 }, (_, i) => i));
    expect(batches.map((b) => b.length)).toEqual([64, 64, 22]);
  });

  it('returns nothing for an empty list', () => {
    expect(batched([])).toEqual([]);
  });
});
