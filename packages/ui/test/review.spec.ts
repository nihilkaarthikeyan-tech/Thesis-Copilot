/**
 * Finding a supervisor's passage in the live document.
 *
 * Everything the review highlights do rests on this one function, and every way it can be wrong
 * is a highlight drawn over the wrong sentence. The cases below are the ones a real chapter
 * produces: a citation sitting inside the quoted sentence, a quote that arrived through a `.docx`
 * import with its line breaks intact, a passage the student has since rewritten, and a sentence
 * that appears twice.
 */

import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { thesisExtensions } from '../src/editor/extensions.js';
import { collapse, findPassage, textIndexOf } from '../src/editor/review.js';

function editorWith(content: unknown): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    content: content as never,
    extensions: thesisExtensions({
      ghostText: { chapterId: 'c1', request: async function* () {} },
      resizableTables: false,
    }),
  });
}

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

let editor: Editor;
afterEach(() => editor?.destroy());

describe('the text index', () => {
  it('collapses whitespace and keeps a position for every character it keeps', () => {
    editor = editorWith({ type: 'doc', content: [paragraph('One   two')] });
    const index = textIndexOf(editor.state.doc);
    expect(index.text).toBe('One two');
    expect(index.pos).toHaveLength(index.text.length);
    // Positions climb; the collapsed run leaves a gap rather than a duplicate.
    expect(index.pos).toEqual([...index.pos].sort((a, b) => a - b));
  });

  it('puts a gap between blocks so two paragraphs do not read as one word', () => {
    editor = editorWith({ type: 'doc', content: [paragraph('First.'), paragraph('Second.')] });
    expect(textIndexOf(editor.state.doc).text).toBe('First. Second.');
  });

  it('never starts or ends on whitespace', () => {
    editor = editorWith({ type: 'doc', content: [paragraph('  padded  ')] });
    expect(textIndexOf(editor.state.doc).text).toBe('padded');
  });
});

describe('finding a passage', () => {
  beforeEach(() => {
    editor = editorWith({
      type: 'doc',
      content: [
        paragraph('Uptake is uneven across the surveyed districts.'),
        paragraph('The leading barrier is the cost of the pump, not the subsidy.'),
      ],
    });
  });

  it('finds an exact sentence and selects exactly it', () => {
    const found = findPassage(editor.state.doc, 'Uptake is uneven across the surveyed districts.');
    expect(found).not.toBeNull();
    expect(editor.state.doc.textBetween(found?.from ?? 0, found?.to ?? 0)).toBe(
      'Uptake is uneven across the surveyed districts.',
    );
  });

  it('finds a quote whose whitespace was mangled on the way in', () => {
    // A `.docx` import or a paste keeps the supervisor's line breaks.
    const found = findPassage(editor.state.doc, 'The leading barrier is\n  the cost of the pump,');
    expect(found).not.toBeNull();
    expect(editor.state.doc.textBetween(found?.from ?? 0, found?.to ?? 0)).toBe(
      'The leading barrier is the cost of the pump,',
    );
  });

  it('returns null for a passage that is no longer there', () => {
    expect(
      findPassage(editor.state.doc, 'A sentence nobody ever wrote in this chapter'),
    ).toBeNull();
  });

  it('returns null for an empty quote rather than matching position zero', () => {
    expect(findPassage(editor.state.doc, '   ')).toBeNull();
  });
});

describe('when the student has rewritten the end of the sentence', () => {
  it('falls back to the opening, which is where the comment still points', () => {
    editor = editorWith({
      type: 'doc',
      content: [
        paragraph(
          'Farmers in the two surveyed districts reported that the subsidy never reached them.',
        ),
      ],
    });
    const found = findPassage(
      editor.state.doc,
      'Farmers in the two surveyed districts reported that the paperwork defeated them.',
    );
    expect(found).not.toBeNull();
    // The 40-character prefix, not the whole stale quote.
    expect(editor.state.doc.textBetween(found?.from ?? 0, found?.to ?? 0)).toBe(
      'Farmers in the two surveyed districts re',
    );
  });

  it('does not guess when the quote is too short for its opening to mean anything', () => {
    editor = editorWith({ type: 'doc', content: [paragraph('The pump is expensive.')] });
    // Under the prefix length, so an inexact match is a guess and is refused.
    expect(findPassage(editor.state.doc, 'The pump is cheap.')).toBeNull();
  });
});

describe('a citation inside the quoted sentence', () => {
  it('is skipped, the way the server skips it when it records the quote', () => {
    editor = editorWith({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Uptake has risen since 2012 ' },
            { type: 'citation', attrs: { key: 'c1', sourceId: 's1' } },
            { type: 'text', text: ' across both districts.' },
          ],
        },
      ],
    });
    // The citation's label is rendered from storage and is not in the document, so the quote the
    // supervisor saw has the two halves separated by a single space.
    const found = findPassage(
      editor.state.doc,
      'Uptake has risen since 2012 across both districts.',
    );
    expect(found).not.toBeNull();
    // The range spans the citation node, because the sentence does.
    expect(found?.to ?? 0).toBeGreaterThan(found?.from ?? 0);
  });
});

describe('a sentence that appears twice', () => {
  const twice = {
    type: 'doc',
    content: [
      paragraph('The subsidy reaches only registered landholders.'),
      paragraph('Nothing in the survey contradicts that.'),
      paragraph('The subsidy reaches only registered landholders.'),
    ],
  };
  const quote = 'The subsidy reaches only registered landholders.';

  it('takes the first with nothing to go on', () => {
    editor = editorWith(twice);
    expect(findPassage(editor.state.doc, quote)?.from).toBe(1);
  });

  it('takes the one the server saw when it says roughly where', () => {
    editor = editorWith(twice);
    const first = findPassage(editor.state.doc, quote)?.from ?? 0;
    // The server's position is approximate, so the hint is deliberately a few characters off.
    const second = editor.state.doc.content.size - quote.length - 1;
    const found = findPassage(editor.state.doc, quote, second + 3);
    expect(found?.from).toBeGreaterThan(first);
    expect(editor.state.doc.textBetween(found?.from ?? 0, found?.to ?? 0)).toBe(quote);
  });
});

describe('collapse', () => {
  it('is the normalisation both sides of the search agree on', () => {
    expect(collapse('  two \n\t spaces  ')).toBe('two spaces');
    expect(collapse('')).toBe('');
  });
});
