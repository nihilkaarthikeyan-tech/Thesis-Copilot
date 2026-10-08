/**
 * R40 (ADR-0117): where a picked citation goes. Never after the full stop in an in-text style,
 * never in the sentence after the one it was suggested for, and beside a citation already there,
 * so the two read as one bracket.
 */

import type { Editor, JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  citationPointForSentence,
  needsSpaceBefore,
  spaceAfterCitation,
} from '../src/editor/cite-point.js';
import { createTestEditor } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const citation = (key: string) => ({
  type: 'citation',
  attrs: { key, sourceId: 's1', chunkId: null, role: 'parenthetical' },
});

const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content }],
});

describe('a citation suggested for the sentence just finished', () => {
  it('goes before the full stop, after a space', () => {
    editor = createTestEditor(paragraph({ type: 'text', text: 'Cost is the main barrier.' }));
    // 1 + 25 characters: the position just after the full stop.
    expect(citationPointForSentence(editor.state.doc, 26, false)).toEqual({ pos: 25, space: true });
  });

  it('goes beside a citation already before the full stop, with no space between', () => {
    editor = createTestEditor(
      paragraph({ type: 'text', text: 'Cost is the barrier ' }, citation('c1'), {
        type: 'text',
        text: '.',
      }),
    );
    // "Cost is the barrier " is 1–21, the citation 21, "." 22.
    expect(citationPointForSentence(editor.state.doc, 23, false)).toEqual({
      pos: 22,
      space: false,
    });
  });

  it('goes before a question mark, or an ellipsis and a closing quote', () => {
    editor = createTestEditor(paragraph({ type: 'text', text: 'Is cost the barrier?' }));
    expect(citationPointForSentence(editor.state.doc, 21, false).pos).toBe(20);
    editor.destroy();
    editor = createTestEditor(paragraph({ type: 'text', text: 'They said “it costs…”' }));
    // "They said “it costs" is 1–20: the citation goes after "costs", before "…”".
    expect(citationPointForSentence(editor.state.doc, 22, false).pos).toBe(20);
  });

  it('in a note style goes after the full stop, where a footnote mark belongs', () => {
    editor = createTestEditor(paragraph({ type: 'text', text: 'Cost is the main barrier.' }));
    expect(citationPointForSentence(editor.state.doc, 26, true)).toEqual({ pos: 26, space: false });
  });
});

describe('spacing', () => {
  it('a space after a word, none after a space, a bracket or another citation', () => {
    editor = createTestEditor(
      paragraph({ type: 'text', text: 'word (x ' }, citation('c1'), { type: 'text', text: 'y' }),
    );
    const doc = editor.state.doc;
    expect(needsSpaceBefore(doc, 5)).toBe(true); // after "word"
    expect(needsSpaceBefore(doc, 7)).toBe(false); // after "("
    expect(needsSpaceBefore(doc, 9)).toBe(false); // after "x "
    expect(needsSpaceBefore(doc, 10)).toBe(false); // after the citation
  });
});

describe('the @ picker after a citation', () => {
  it('finds the single space between a citation and the @, so the new one goes beside it', () => {
    editor = createTestEditor(
      paragraph({ type: 'text', text: 'Cost ' }, citation('c1'), { type: 'text', text: ' @rao' }),
    );
    // "Cost " 1–6, the citation 6, the space 7, "@" 8.
    expect(spaceAfterCitation(editor.state.doc, 8)).toBe(7);
  });

  it('leaves words alone: only a lone space after a citation counts', () => {
    editor = createTestEditor(paragraph(citation('c1'), { type: 'text', text: ' and @rao' }));
    // The citation 1, " and " 2–7, "@" 7.
    expect(spaceAfterCitation(editor.state.doc, 7)).toBeNull();
    editor.destroy();
    editor = createTestEditor(paragraph({ type: 'text', text: 'Cost @rao' }));
    expect(spaceAfterCitation(editor.state.doc, 6)).toBeNull();
  });
});
