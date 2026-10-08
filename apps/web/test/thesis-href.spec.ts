import { describe, expect, it } from 'vitest';
import { newThesisHref, readNewStart, thesisWriteHref } from '../src/lib/thesis-href';

/** R32 (ADR-0127): where the switcher and the list open a thesis, and New ▾'s three starts. */
describe('thesisWriteHref', () => {
  const last = {
    documentId: 'doc-a',
    chapterId: 'ch-3',
    documentTitle: 'A',
    chapterTitle: 'Three',
    at: '2026-10-08T00:00:00.000Z',
  };

  it('goes back to the chapter last open here for that thesis', () => {
    expect(thesisWriteHref({ id: 'doc-a', firstChapterId: 'ch-1' }, last)).toBe(
      '/app/d/doc-a/write/ch-3',
    );
  });

  it('otherwise opens the first chapter', () => {
    expect(thesisWriteHref({ id: 'doc-b', firstChapterId: 'ch-9' }, last)).toBe(
      '/app/d/doc-b/write/ch-9',
    );
    expect(thesisWriteHref({ id: 'doc-b', firstChapterId: 'ch-9' }, null)).toBe(
      '/app/d/doc-b/write/ch-9',
    );
  });

  it('keeps the list’s old answer for a thesis with no chapter', () => {
    expect(thesisWriteHref({ id: 'doc-c', firstChapterId: null }, null)).toBe(
      '/app/d/doc-c/write/none',
    );
  });
});

describe('the New menu’s starts', () => {
  it('round-trips each start through the address', () => {
    for (const start of ['topic', 'paper', 'word'] as const) {
      const href = newThesisHref(start);
      expect(href.startsWith('/app/new?')).toBe(true);
      expect(readNewStart(href.slice(href.indexOf('?')))).toBe(start);
    }
  });

  it('ignores anything else', () => {
    expect(readNewStart('')).toBeNull();
    expect(readNewStart('?start=chat')).toBeNull();
    expect(readNewStart('?new=1')).toBeNull();
  });
});
