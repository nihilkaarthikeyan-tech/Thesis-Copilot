/**
 * Reading a saved version before restoring it.
 *
 * The preview is the whole basis of the decision, so what it must not do is quietly drop the
 * things someone goes looking for. "The version before I deleted the table" has to show a table.
 */

import { describe, expect, it } from 'vitest';
import { dayLabel, previewBlocks, reasonLabel, wordsIn } from '../src/lib/version-preview';

const text = (value: string) => ({ type: 'text', text: value });
const para = (value: string) => ({ type: 'paragraph', content: [text(value)] });

describe('previewBlocks', () => {
  it('keeps headings with their level, and paragraphs in order', () => {
    const blocks = previewBlocks({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Chapter 1')] },
        para('First.'),
        { type: 'heading', attrs: { level: 2 }, content: [text('Method')] },
        para('Second.'),
      ],
    });
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Chapter 1' },
      { kind: 'paragraph', text: 'First.' },
      { kind: 'heading', level: 2, text: 'Method' },
      { kind: 'paragraph', text: 'Second.' },
    ]);
  });

  it('names a figure, a table and an equation rather than dropping them', () => {
    const blocks = previewBlocks({
      type: 'doc',
      content: [
        { type: 'image', attrs: { alt: 'plot.png', key: 'k' } },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [] },
            { type: 'tableRow', content: [] },
          ],
        },
        { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
      ],
    });
    expect(blocks.map((b) => b.kind)).toEqual(['object', 'object', 'object']);
    expect(blocks[0]?.text).toContain('plot.png');
    expect(blocks[1]?.text).toContain('2 rows');
    expect(blocks[2]?.text).toContain('E = mc^2');
  });

  it('marks a citation rather than inventing its label', () => {
    // The label is rendered from storage by citeproc; the stored document only has the key.
    const blocks = previewBlocks({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [text('Uptake rose '), { type: 'citation', attrs: { key: 'c1' } }, text('.')],
        },
      ],
    });
    expect(blocks[0]?.text).toBe('Uptake rose [cite].');
  });

  it('flattens a list into one line per item', () => {
    const blocks = previewBlocks({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [para('One')] },
            { type: 'listItem', content: [para('Two')] },
          ],
        },
      ],
    });
    expect(blocks).toEqual([
      { kind: 'item', text: 'One' },
      { kind: 'item', text: 'Two' },
    ]);
  });

  it('skips empty paragraphs, which every new chapter has', () => {
    expect(
      previewBlocks({ type: 'doc', content: [{ type: 'paragraph' }, para('x')] }),
    ).toHaveLength(1);
  });

  it('is empty, not an error, for something that is not a document', () => {
    expect(previewBlocks(null)).toEqual([]);
    expect(previewBlocks({})).toEqual([]);
  });
});

describe('wordsIn', () => {
  it('counts prose and ignores the object placeholders', () => {
    const blocks = previewBlocks({
      type: 'doc',
      content: [para('three short words'), { type: 'image', attrs: { alt: 'a b c d e' } }],
    });
    expect(wordsIn(blocks)).toBe(3);
  });
});

describe('reasonLabel', () => {
  it('says what caused each kind of version', () => {
    expect(reasonLabel('AUTOSAVE')).toBe('Autosaved');
    expect(reasonLabel('PRE_RESTORE')).toBe('Before restoring an older version');
  });

  it('shows an unknown reason as it is rather than hiding it', () => {
    expect(reasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('dayLabel', () => {
  const now = new Date(2026, 8, 24, 15, 0);

  it('says Today and Yesterday', () => {
    expect(dayLabel(new Date(2026, 8, 24, 9, 0).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 8, 23, 23, 59).toISOString(), now)).toBe('Yesterday');
  });

  it('falls back to a date for anything older', () => {
    expect(dayLabel(new Date(2026, 8, 20, 12, 0).toISOString(), now)).not.toMatch(
      /Today|Yesterday/,
    );
  });
});
