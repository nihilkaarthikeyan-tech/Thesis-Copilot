/**
 * Highlights and notes in the reader, the pure parts (ADR-0130): the anchor a selection is saved
 * as, finding it again when the text has moved, the list's order, and what "Put in chat" puts in
 * the chat box.
 */

import { describe, expect, it } from 'vitest';
import { normaliseQuery, parseHandoff } from '../src/lib/reader';
import {
  anchorAt,
  chatHandoffFor,
  locate,
  sortHighlights,
  whereLabel,
} from '../src/lib/reader-highlights';

const page = normaliseQuery(
  'In the decade after 2001, groundwater recharge fell by a third across the delta districts. ' +
    'Recharge fell again after 2011, and groundwater recharge fell by a third in the uplands too.',
);

describe('anchorAt', () => {
  it('keeps the words and up to 32 characters either side, without edge spaces', () => {
    const start = page.indexOf(' groundwater recharge');
    const end = page.indexOf(' across');
    const anchor = anchorAt(page, start, end + 1);
    expect(anchor?.exact).toBe('groundwater recharge fell by a third');
    expect(anchor?.prefix).toBe('in the decade after 2001, ');
    expect(anchor?.suffix.startsWith(' across the delta')).toBe(true);
    expect(anchor?.suffix.length).toBeLessThanOrEqual(32);
  });

  it('is nothing for a selection of spaces', () => {
    expect(anchorAt('a   b', 1, 2)).toBeNull();
  });
});

describe('locate', () => {
  const first = anchorAt(
    page,
    page.indexOf('groundwater'),
    page.indexOf('groundwater') + 'groundwater recharge fell by a third'.length,
  );
  const secondAt = page.lastIndexOf('groundwater');
  const second = anchorAt(page, secondAt, secondAt + 'groundwater recharge fell by a third'.length);

  it('uses the offsets when they still hold the same words', () => {
    expect(first && locate(page, first)).toEqual({ start: first?.start, end: first?.end });
  });

  it('finds the right one of two identical passages by its surroundings when the text moved', () => {
    if (!second || !first) throw new Error('anchors');
    const moved = `a new running head on this page. ${page}`;
    const shift = moved.length - page.length;
    expect(locate(moved, second)).toEqual({ start: second.start + shift, end: second.end + shift });
    expect(locate(moved, first)).toEqual({ start: first.start + shift, end: first.end + shift });
  });

  it('ignores offsets from the other view and still picks by context', () => {
    if (!second) throw new Error('anchor');
    const wrongOffsets = { ...second, start: 0, end: 5 };
    expect(locate(page, wrongOffsets, false)?.start).toBe(secondAt);
  });

  it('is null when the words are no longer there', () => {
    if (!first) throw new Error('anchor');
    expect(locate('a different paper altogether', first)).toBeNull();
  });
});

describe('the list', () => {
  it('runs in reading order: page, place on it, then when made; text-only last', () => {
    const rows = [
      { id: 'c', page: null, start: 0, createdAt: '2026-10-09T10:00:00Z' },
      { id: 'b', page: 3, start: 40, createdAt: '2026-10-09T09:00:00Z' },
      { id: 'a', page: 3, start: 10, createdAt: '2026-10-09T11:00:00Z' },
      { id: 'd', page: 1, start: 900, createdAt: '2026-10-09T12:00:00Z' },
    ];
    expect(sortHighlights(rows).map((r) => r.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('labels each by its page, or as from the Text view', () => {
    expect(whereLabel({ page: 4, view: 'PDF' })).toBe('p. 4');
    expect(whereLabel({ page: null, view: 'TEXT' })).toBe('Text');
  });
});

describe('Put in chat', () => {
  it('hands over the passage with its page, and the note only when there is one', () => {
    expect(chatHandoffFor({ quote: ' Recharge\n fell. ', note: null, page: 3 })).toEqual({
      text: 'Recharge fell. (p. 3)',
    });
    expect(
      chatHandoffFor({ quote: 'Recharge fell.', note: ' Compare Kumar. ', page: null }),
    ).toEqual({ text: 'Recharge fell.', note: 'Compare Kumar.' });
    expect(chatHandoffFor({ quote: 'Recharge fell.', note: '   ', page: null })).toEqual({
      text: 'Recharge fell.',
    });
  });
});

describe('Put note in chapter', () => {
  it('carries the note through the hand-off to the editor', () => {
    const raw = JSON.stringify({
      kind: 'cite',
      documentId: 'd1',
      sourceId: 's1',
      chunkId: null,
      page: 3,
      label: 'Kumar 2021',
      title: 'Aquifers',
      text: 'Recharge fell by a third.',
      at: 1_000,
    });
    const handoff = parseHandoff(raw, 'd1', 2_000);
    expect(handoff?.kind).toBe('cite');
    expect(handoff && 'text' in handoff ? handoff.text : null).toBe('Recharge fell by a third.');
  });
});
