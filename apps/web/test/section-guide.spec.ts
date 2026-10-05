/**
 * The Sections panel's working parts (ADR-0072) on a bare ProseMirror document: where a heading
 * goes, which heading is a section's, and where a section ends. None of them may split or move
 * the student's text.
 */

import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import {
  findSectionHeading,
  headingSlot,
  scopeBullets,
  sectionEnd,
} from '../src/lib/section-guide';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    heading: { group: 'block', content: 'text*', attrs: { level: { default: 1 } } },
    text: {},
  },
});

const h = (level: number, text: string) =>
  schema.node('heading', { level }, text ? [schema.text(text)] : []);
const p = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const doc = (...blocks: ReturnType<typeof p>[]) => schema.node('doc', null, blocks);

/** The position just inside the n-th top-level block. */
function inside(d: ReturnType<typeof doc>, n: number): number {
  let pos = 0;
  for (let i = 0; i < n; i++) pos += d.child(i).nodeSize;
  return pos + 1;
}

describe('scopeBullets', () => {
  it('turns a scope note into its first three sentences', () => {
    expect(
      scopeBullets(
        'Establish the cost barrier. Compare it with subsidy uptake! Do not discuss policy? A fourth.',
      ),
    ).toEqual([
      'Establish the cost barrier.',
      'Compare it with subsidy uptake!',
      'Do not discuss policy?',
    ]);
  });

  it('is empty for no note', () => {
    expect(scopeBullets('')).toEqual([]);
    expect(scopeBullets(null)).toEqual([]);
  });
});

describe('findSectionHeading', () => {
  const d = doc(h(1, 'Introduction'), p('Some text.'), h(2, '1.2 Cost barriers.'), p('More.'));

  it('finds a level-2 heading by its words, ignoring numbering and punctuation', () => {
    expect(findSectionHeading(d, 'Cost barriers')).toBe(inside(d, 2) - 1);
  });

  it('never takes the chapter title (level 1) as a section', () => {
    expect(findSectionHeading(d, 'Introduction')).toBeNull();
  });

  it('is null when the section has no heading yet', () => {
    expect(findSectionHeading(d, 'Subsidy schemes')).toBeNull();
  });
});

describe('sectionEnd', () => {
  it('ends a section at the next heading of its level', () => {
    const d = doc(h(2, 'A'), p('a1'), h(3, 'A.1'), p('a2'), h(2, 'B'), p('b'));
    const a = findSectionHeading(d, 'A') ?? -1;
    expect(sectionEnd(d, a)).toBe(inside(d, 4) - 1);
  });

  it('runs to the end of the chapter for the last section', () => {
    const d = doc(h(2, 'A'), p('a1'), h(2, 'B'), p('b'));
    const b = findSectionHeading(d, 'B') ?? -1;
    expect(sectionEnd(d, b)).toBe(d.content.size);
  });
});

describe('headingSlot', () => {
  it('goes after the paragraph the cursor is in, never inside it', () => {
    const d = doc(h(1, 'Introduction'), p('A sentence the student wrote.'), p('Another.'));
    const mid = inside(d, 1) + 5;
    const end = inside(d, 2) - 1;
    expect(headingSlot(d, mid)).toEqual({ from: end, to: end });
  });

  it('takes the place of an empty paragraph', () => {
    const d = doc(h(1, 'Introduction'), p(''));
    const start = inside(d, 1) - 1;
    expect(headingSlot(d, inside(d, 1))).toEqual({ from: start, to: d.content.size });
  });

  it('goes after the chapter title when the cursor is in it', () => {
    const d = doc(h(1, 'Introduction'), p('Text.'));
    const afterTitle = inside(d, 1) - 1;
    expect(headingSlot(d, 1)).toEqual({ from: afterTitle, to: afterTitle });
  });
});
