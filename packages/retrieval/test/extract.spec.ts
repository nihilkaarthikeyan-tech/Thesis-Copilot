/**
 * PHASES 1-W2 task 2.2 — text extraction.
 *
 * The DoD ("extracts each fixture PDF and asserts the expected title appears within the first
 * 2,000 characters") needs the five papers the human supplies, and is marked BLOCKED in the build
 * log. These tests prove the mechanics the DoD depends on: page separation, two-column reading
 * order, section detection and the DOCX path, using PDFs generated with known coordinates.
 */

import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/chunker.js';
import {
  detectGutter,
  detectSections,
  extractDocument,
  extractPdf,
  joinPages,
  looksLikeHeading,
  pageText,
  type TextItem,
} from '../src/extract/index.js';
import { buildPdf, singleColumnPage, twoColumnPage } from './_pdf-fixture.js';

const item = (over: Partial<TextItem> & { str: string; x: number; y: number }): TextItem => ({
  width: over.str.length * 5,
  height: 11,
  fontSize: 11,
  hasEOL: false,
  ...over,
});

describe('detectGutter', () => {
  it('finds the gutter on a two-column page', () => {
    const items: TextItem[] = [];
    for (let row = 0; row < 10; row++) {
      items.push(item({ str: 'left column text here', x: 60, y: 700 - row * 16 }));
      items.push(item({ str: 'right column text here', x: 330, y: 700 - row * 16 }));
    }
    const gutter = detectGutter(items);
    expect(gutter).not.toBeNull();
    expect(gutter as number).toBeGreaterThan(160);
    expect(gutter as number).toBeLessThan(340);
  });

  it('reports no gutter on a single-column page', () => {
    const items = Array.from({ length: 20 }, (_, row) =>
      item({
        str: 'a full width line of body text that runs across the page',
        x: 72,
        y: 700 - row * 16,
      }),
    );
    expect(detectGutter(items)).toBeNull();
  });

  it('reports no gutter when there is too little text to judge', () => {
    expect(detectGutter([item({ str: 'title', x: 60, y: 700 })])).toBeNull();
  });

  it('does not split a page whose right side is nearly empty', () => {
    const items = Array.from({ length: 20 }, (_, row) =>
      item({ str: 'left side body text', x: 60, y: 700 - row * 16 }),
    );
    items.push(item({ str: '1', x: 400, y: 40 })); // a page number
    expect(detectGutter(items)).toBeNull();
  });
});

describe('pageText', () => {
  it('reads a two-column page down the left column, then the right', () => {
    const items: TextItem[] = [];
    ['L1', 'L2', 'L3'].forEach((s, i) => {
      items.push(item({ str: s, x: 60, y: 700 - i * 16, width: 200 }));
    });
    ['R1', 'R2', 'R3'].forEach((s, i) => {
      items.push(item({ str: s, x: 330, y: 700 - i * 16, width: 200 }));
    });
    // Enough items for the detector to engage.
    for (let i = 3; i < 10; i++) {
      items.push(item({ str: `L${i + 1}`, x: 60, y: 700 - i * 16, width: 200 }));
      items.push(item({ str: `R${i + 1}`, x: 330, y: 700 - i * 16, width: 200 }));
    }

    const { text, twoColumn } = pageText(items);
    expect(twoColumn).toBe(true);
    const lines = text.split('\n');
    // Every L before every R: the interleaved item order has been undone.
    const lastLeft = lines.findLastIndex((l) => l.startsWith('L'));
    const firstRight = lines.findIndex((l) => l.startsWith('R'));
    expect(firstRight).toBeGreaterThan(lastLeft);
  });

  it('keeps a heading that spans both columns above the left column', () => {
    const items: TextItem[] = [item({ str: '3. RESULTS', x: 60, y: 740, width: 460 })];
    for (let i = 0; i < 10; i++) {
      items.push(item({ str: `left ${i}`, x: 60, y: 700 - i * 16, width: 200 }));
      items.push(item({ str: `right ${i}`, x: 330, y: 700 - i * 16, width: 200 }));
    }
    const { text } = pageText(items);
    expect(text.split('\n')[0]).toBe('3. RESULTS');
  });

  it('reads a single-column page top to bottom', () => {
    const items = ['First line', 'Second line', 'Third line'].map((str, i) =>
      item({ str, x: 72, y: 700 - i * 16, width: 400 }),
    );
    const { text, twoColumn } = pageText(items);
    expect(twoColumn).toBe(false);
    expect(text).toBe('First line\nSecond line\nThird line');
  });

  it('inserts a space where the PDF encoded none', () => {
    const { text } = pageText([
      item({ str: 'Solar', x: 72, y: 700, width: 30 }),
      item({ str: 'adoption', x: 112, y: 700, width: 50 }),
    ]);
    expect(text).toBe('Solar adoption');
  });

  it('rejoins a word hyphenated across a line break', () => {
    const { text } = pageText([
      item({ str: 'adop-', x: 72, y: 700, width: 30 }),
      item({ str: 'tion rose', x: 72, y: 684, width: 60 }),
    ]);
    expect(text).toBe('adoption rose');
  });

  it('leaves a real compound word alone', () => {
    const { text } = pageText([
      item({ str: 'well-', x: 72, y: 700, width: 30 }),
      item({ str: 'Known effect', x: 72, y: 684, width: 60 }),
    ]);
    expect(text).toContain('well-\nKnown');
  });

  it('handles a page with no text', () => {
    expect(pageText([])).toEqual({ text: '', twoColumn: false });
  });
});

// The first case here loads pdf.js cold, which took longer than vitest's default 5 s on a busy CI
// runner (2026-09-25); the cases themselves are milliseconds once it is loaded.
describe('extractPdf against a real PDF', { timeout: 30_000 }, () => {
  it('extracts each page separately', async () => {
    const pdf = buildPdf([
      singleColumnPage(['Page one line A', 'Page one line B']),
      singleColumnPage(['Page two line A', 'Page two line B']),
    ]);

    const result = await extractPdf(pdf);
    expect(result.totalPages).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.usedFallback).toBe(false);
    expect(result.pages[0]?.text).toContain('Page one line A');
    expect(result.pages[0]?.text).not.toContain('Page two');
    expect(result.pages[1]?.text).toContain('Page two line A');
  });

  it('reads a PDF handed over as a Node Buffer, the way storage returns it', async () => {
    // pdf.js refuses a Buffer outright; until 2026-10-04 every uploaded PDF failed here.
    const pdf = Buffer.from(
      buildPdf([singleColumnPage(['Recharge wells raised the water table'])]),
    );
    const result = await extractPdf(pdf);
    expect(result.usedFallback).toBe(false);
    expect(result.pages[0]?.text).toContain('Recharge wells raised the water table');
    // And through the document-level entry point the worker calls.
    const doc = await extractDocument(pdf, 'pdf');
    expect(doc.text).toContain('Recharge wells');
  });

  it('reorders a two-column page and reports it', async () => {
    const pdf = buildPdf([
      twoColumnPage(
        Array.from({ length: 12 }, (_, i) => `Left sentence number ${i}`),
        Array.from({ length: 12 }, (_, i) => `Right sentence number ${i}`),
      ),
    ]);

    const result = await extractPdf(pdf);
    expect(result.twoColumnPages).toEqual([1]);
    const text = result.pages[0]?.text ?? '';
    expect(text.indexOf('Left sentence number 11')).toBeLessThan(
      text.indexOf('Right sentence number 0'),
    );
  });

  it('falls back to plain per-page text when positional extraction fails', async () => {
    const result = await extractPdf(new Uint8Array([1, 2, 3]), {
      extractTextItems: async () => {
        throw new Error('unreadable');
      },
      extractText: async () => ({ totalPages: 1, text: ['recovered text'] }),
    });
    expect(result.usedFallback).toBe(true);
    expect(result.pages[0]?.text).toBe('recovered text');
  });
});

describe('looksLikeHeading', () => {
  it.each([
    ['3. Methodology', true],
    ['METHODOLOGY', true],
    ['4.2 Data collection', true],
    ['Results', true],
    ['We surveyed 312 households across three districts of rural Karnataka.', false],
    ['[12] Kumar, A. (2021). Solar adoption.', false],
    ['Figure 3: study area', false],
    ['', false],
  ])('%s → %s', (line, expected) => {
    expect(looksLikeHeading(line)).toBe(expected);
  });
});

describe('detectSections', () => {
  it('covers the whole text with contiguous spans', () => {
    const text = [
      'Solar adoption in rural Karnataka',
      'Some abstract prose that runs on.',
      '1. Introduction',
      'Intro body text.',
      '2. Method',
      'Method body text.',
    ].join('\n');
    const spans = detectSections(text);

    // The title line is heading-shaped, so it opens its own span. That is right: the title block is
    // a section in its own right, and what the chunker needs is spans that are contiguous and
    // complete, not a particular label on the first one.
    expect(spans.map((s) => s.section)).toEqual([
      'Solar adoption in rural Karnataka',
      '1. Introduction',
      '2. Method',
    ]);
    expect(spans[0]?.start).toBe(0);
    expect(spans.at(-1)?.end).toBe(text.length);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]?.start).toBe(spans[i - 1]?.end);
    }
  });

  it('puts prose before the first heading in its own unlabelled span', () => {
    const text = [
      'Running prose that is plainly not a heading at all, because it ends in a full stop.',
      '1. Introduction',
      'Body.',
    ].join('\n');
    const spans = detectSections(text);
    expect(spans[0]?.section).toBe('');
    expect(spans[0]?.start).toBe(0);
    expect(spans[1]?.section).toBe('1. Introduction');
  });

  it('returns one unlabelled span when there are no headings', () => {
    const text = 'Just some prose with no headings at all in it.';
    expect(detectSections(text)).toEqual([{ section: '', start: 0, end: text.length }]);
  });
});

describe('joinPages', () => {
  it('records where each page starts and ends in the joined text', () => {
    const { text, spans } = joinPages([
      { page: 1, text: 'first page' },
      { page: 2, text: 'second page' },
    ]);
    expect(spans).toHaveLength(2);
    expect(text.slice(spans[0]?.start, spans[0]?.end)).toBe('first page');
    expect(text.slice(spans[1]?.start, spans[1]?.end)).toBe('second page');
  });
});

describe('extract → chunk round trip', () => {
  it('a chunk from a two-page PDF carries the page it started on', async () => {
    const sentence = (p: number, i: number) =>
      `Page ${p} sentence ${i} reports the measured adoption rate across the surveyed districts in detail.`;
    const pdf = buildPdf([
      singleColumnPage(Array.from({ length: 14 }, (_, i) => sentence(1, i))),
      singleColumnPage(Array.from({ length: 14 }, (_, i) => sentence(2, i))),
    ]);

    const document = await extractDocument(pdf, 'pdf');
    expect(document.pages).toHaveLength(2);

    const chunks = chunkText({
      text: document.text,
      pages: document.pages,
      sections: document.sections,
    });
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.page).not.toBeNull();
      // The chunk's own text says which page it came from, so the recorded page must agree.
      const claimed = /Page (\d) sentence/.exec(chunk.text)?.[1];
      if (claimed) expect(chunk.page).toBe(Number(claimed));
      expect(document.text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  });
});
