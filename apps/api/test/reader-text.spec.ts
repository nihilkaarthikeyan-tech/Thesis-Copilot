/**
 * The reader's Text view and its reading state (ADR-0068), without a database.
 */

import { describe, expect, it } from 'vitest';
import { readerPassages } from '../src/modules/sources/reader-text.js';
import { readingState } from '../src/modules/sources/sources.service.js';

const row = (
  ordinal: number,
  text: string,
  charStart: number | null,
  extra: Partial<{ page: number; section: string }> = {},
) => ({
  id: `c${ordinal}`,
  ordinal,
  page: extra.page ?? null,
  section: extra.section ?? null,
  text,
  charStart,
  charEnd: charStart === null ? null : charStart + text.length,
});

describe('readerPassages', () => {
  const full = 'One. Two. Three. Four.';

  it('cuts each chunk at the end of the one before it', () => {
    const passages = readerPassages([
      row(0, 'One. Two. Three.', 0),
      row(1, 'Three. Four.', full.indexOf('Three.')),
    ]);
    expect(passages.map((p) => p.text)).toEqual(['One. Two. Three.', 'Four.']);
  });

  it('orders by ordinal whatever order the rows arrive in', () => {
    const passages = readerPassages([row(1, 'Four.', 17), row(0, 'One. Two. Three.', 0)]);
    expect(passages.map((p) => p.id)).toEqual(['c0', 'c1']);
  });

  it('drops a chunk wholly inside what is already shown', () => {
    const passages = readerPassages([row(0, full, 0), row(1, 'Two.', 5)]);
    expect(passages).toHaveLength(1);
  });

  it('shows a chunk without offsets whole', () => {
    const passages = readerPassages([row(0, 'An abstract with no offsets.', null)]);
    expect(passages[0]?.text).toBe('An abstract with no offsets.');
  });

  it('keeps each passage’s page and section', () => {
    const [p] = readerPassages([row(0, 'Text.', 0, { page: 3, section: 'Methods' })]);
    expect(p).toMatchObject({ page: 3, section: 'Methods' });
  });
});

describe('readingState', () => {
  const base = { status: 'RESOLVED', groundingLevel: 'NONE', hasFile: false };

  it('is looking up while the reference resolves', () => {
    expect(readingState({ ...base, status: 'PENDING' }, false)).toBe('LOOKING_UP');
  });
  it('is reading while a job for the paper is unfinished', () => {
    expect(readingState({ ...base, hasFile: true }, true)).toBe('READING');
  });
  it('is unreadable when a PDF is attached and nothing came of it', () => {
    expect(readingState({ ...base, hasFile: true }, false)).toBe('UNREADABLE');
  });
  it('separates abstract-only from nothing at all', () => {
    expect(readingState({ ...base, groundingLevel: 'ABSTRACT' }, false)).toBe('ABSTRACT');
    expect(readingState(base, false)).toBe('NOTHING');
  });
  it('is full text once the whole paper is held, even while the record is looked up', () => {
    expect(
      readingState({ status: 'PENDING', groundingLevel: 'FULL_TEXT', hasFile: true }, false),
    ).toBe('FULL_TEXT');
    expect(readingState({ ...base, groundingLevel: 'FULL_TEXT', hasFile: true }, false)).toBe(
      'FULL_TEXT',
    );
  });
});
