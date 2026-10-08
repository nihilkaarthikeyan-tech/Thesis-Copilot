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
