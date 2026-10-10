/**
 * R27 (ADR-0121): what the export preview draws of a chapter — its title, headings and paragraphs
 * in order, a rule, and nothing from an AI draft the student has not accepted.
 */

import { describe, expect, it } from 'vitest';
import { previewBlocks } from '../src/lib/export-preview';

const text = (value: string) => ({ type: 'text', text: value });

describe('previewBlocks', () => {
  it('reads the title, headings and paragraphs, and leaves out a pending draft', () => {
    const preview = previewBlocks({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Methods')] },
        { type: 'paragraph', content: [text('Rainfall  fell.')] },
        { type: 'heading', attrs: { level: 2 }, content: [text('Sampling')] },
        { type: 'horizontalRule' },
        { type: 'heading', attrs: { level: 3 }, content: [text('Districts')] },
        { type: 'paragraph', content: [] },
        { type: 'draftBlock', content: [{ type: 'paragraph', content: [text('Drafted')] }] },
      ],
    });
    expect(preview.title).toBe('Methods');
    expect(preview.blocks).toEqual([
      { kind: 'p', text: 'Rainfall fell.' },
      { kind: 'h2', text: 'Sampling' },
      { kind: 'rule', text: '' },
      { kind: 'h3', text: 'Districts' },
    ]);
  });

  // ADR-0150: the preview drew "…in these communities ." — the citation node has no text of
  // its own, so the paragraph lost its marker. It is drawn with the rendered label now.
  it('draws a citation with its rendered label, and names an unlabelled one', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            text('Uptake is low in these communities '),
            { type: 'citation', attrs: { key: 'k1', sourceId: 's1' } },
            text('.'),
          ],
        },
        {
          type: 'paragraph',
          content: [text('Costs dominate '), { type: 'citation', attrs: { key: 'k2' } }, text('.')],
        },
      ],
    };
    expect(previewBlocks(content, 14, { k1: '[1]' }).blocks).toEqual([
      { kind: 'p', text: 'Uptake is low in these communities [1].' },
      { kind: 'p', text: 'Costs dominate (Source).' },
    ]);
  });

  it('stops after a page’s worth, and copes with nothing at all', () => {
    const many = {
      type: 'doc',
      content: Array.from({ length: 40 }, (_, i) => ({
        type: 'paragraph',
        content: [text(`Paragraph ${i}`)],
      })),
    };
    expect(previewBlocks(many).blocks).toHaveLength(14);
    expect(previewBlocks(undefined)).toEqual({ title: null, blocks: [] });
  });
});
