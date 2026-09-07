/**
 * FR-5.6's editor half — PRD §5.5, ADR-0010.
 *
 * A citation is an atom: one document position wide, many characters long when serialised. Almost
 * every bug possible here is that arithmetic going wrong, and every one of them corrupts the
 * student's paragraph rather than merely failing — a range off by the length of `{{cite:S1#c1}}`
 * replaces the wrong words, or splits the node and leaves half of it behind.
 *
 * So the tests below check the two scales agree, in the cases where they most easily do not: a
 * citation at the end of a sentence, at the start, in the middle of a paragraph with siblings, and
 * with a second citation nearby that must not move.
 */

import type { Editor, JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCitationRole, sentenceAroundCitation } from '../src/editor/citation-role.js';
import { createTestEditor, provenanceRuns } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const cite = (key: string): JSONContent => ({
  type: 'citation',
  attrs: {
    key,
    sourceId: `src-${key}`,
    chunkId: `chunk-${key}`,
    role: 'parenthetical',
    locator: null,
    prefix: null,
    suffix: null,
  },
});

const text = (value: string): JSONContent => ({ type: 'text', text: value });

const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

describe('finding the sentence a citation sits in', () => {
  it('serialises the citation as {{cite:KEY}} and returns the whole sentence', () => {
    editor = createTestEditor(
      doc(paragraph(text('Upfront cost was the main barrier '), cite('a'), text('.'))),
    );
    const found = sentenceAroundCitation(editor, 'a');
    expect(found?.text).toBe('Upfront cost was the main barrier {{cite:a}}.');
    expect(found?.citations).toEqual([{ key: 'a', sourceId: 'src-a', chunkId: 'chunk-a' }]);
  });

  it('returns null for a key that is not in the document', () => {
    editor = createTestEditor(doc(paragraph(text('No citations here.'))));
    expect(sentenceAroundCitation(editor, 'a')).toBe(null);
  });

  it('takes only the sentence, not the whole paragraph', () => {
    editor = createTestEditor(
      doc(
        paragraph(
          text('An earlier sentence. Cost was the barrier '),
          cite('a'),
          text('. A later one.'),
        ),
      ),
    );
    const found = sentenceAroundCitation(editor, 'a');
    expect(found?.text).toBe('Cost was the barrier {{cite:a}}.');
  });

  it('does not reach into the paragraph before or after', () => {
    editor = createTestEditor(
      doc(
        paragraph(text('A paragraph with no full stop at the end')),
        paragraph(text('Cost mattered '), cite('a'), text('.')),
        paragraph(text('And another after it.')),
      ),
    );
    const found = sentenceAroundCitation(editor, 'a');
    expect(found?.text).toBe('Cost mattered {{cite:a}}.');
  });

  it('carries a second citation in the same sentence, so the rebuild can keep it', () => {
    editor = createTestEditor(
      doc(
        paragraph(
          text('Cost mattered '),
          cite('a'),
          text(', and so did siting '),
          cite('b'),
          text('.'),
        ),
      ),
    );
    const found = sentenceAroundCitation(editor, 'a');
    expect(found?.citations.map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('leaves out a citation that is in the paragraph but not in this sentence', () => {
    editor = createTestEditor(
      doc(paragraph(text('First '), cite('a'), text('. Second '), cite('b'), text('.'))),
    );
    expect(sentenceAroundCitation(editor, 'a')?.citations.map((c) => c.key)).toEqual(['a']);
    expect(sentenceAroundCitation(editor, 'b')?.citations.map((c) => c.key)).toEqual(['b']);
  });

  it('gives a range that covers exactly the sentence in the document', () => {
    // The arithmetic that matters: character offsets are not document positions.
    editor = createTestEditor(
      doc(
        paragraph(text('An earlier sentence. Cost was the barrier '), cite('a'), text('. Later.')),
      ),
    );
    const found = sentenceAroundCitation(editor, 'a');
    const slice = editor.state.doc.textBetween(found?.from ?? 0, found?.to ?? 0, '', '');
    // `textBetween` renders the atom as nothing, so what is left is the sentence's words.
    expect(slice).toBe('Cost was the barrier .');
  });
});

describe('applying the rewrite', () => {
  it('moves the citation to the front and keeps its source and chunk', () => {
    editor = createTestEditor(
      doc(paragraph(text('Cost was the main barrier '), cite('a'), text('.'))),
    );
    const found = sentenceAroundCitation(editor, 'a');
    expect(found).not.toBe(null);
    applyCitationRole(
      editor,
      found as NonNullable<typeof found>,
      '{{cite:a}} found that cost was the main barrier.',
      'a',
      'narrative',
      'action-1',
    );

    const json = editor.getJSON() as {
      content: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const nodes = json.content[0]?.content ?? [];
    expect(nodes[0]?.type).toBe('citation');
    expect((nodes[0]?.attrs as Record<string, unknown>).sourceId).toBe('src-a');
    expect((nodes[0]?.attrs as Record<string, unknown>).chunkId).toBe('chunk-a');
    expect(editor.getText()).toContain('found that cost was the main barrier');
  });

  it('sets the new role on the citation the student asked about', () => {
    editor = createTestEditor(doc(paragraph(text('Cost mattered '), cite('a'), text('.'))));
    const found = sentenceAroundCitation(editor, 'a');
    applyCitationRole(
      editor,
      found as NonNullable<typeof found>,
      '{{cite:a}} found that cost mattered.',
      'a',
      'narrative',
      'action-1',
    );
    const json = editor.getJSON() as {
      content: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const citation = (json.content[0]?.content ?? []).find((n) => n.type === 'citation');
    expect((citation?.attrs as Record<string, unknown>).role).toBe('narrative');
  });

  it('leaves a second citation in the sentence at its own role', () => {
    editor = createTestEditor(
      doc(
        paragraph(
          text('Cost mattered '),
          cite('a'),
          text(', and siting did '),
          cite('b'),
          text('.'),
        ),
      ),
    );
    const found = sentenceAroundCitation(editor, 'a');
    applyCitationRole(
      editor,
      found as NonNullable<typeof found>,
      '{{cite:a}} found that cost mattered, and siting did {{cite:b}}.',
      'a',
      'narrative',
      'action-1',
    );
    const json = editor.getJSON() as {
      content: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const citations = (json.content[0]?.content ?? []).filter((n) => n.type === 'citation');
    expect(citations).toHaveLength(2);
    expect((citations[0]?.attrs as Record<string, unknown>).role).toBe('narrative');
    // The one the student did not ask about is untouched.
    expect((citations[1]?.attrs as Record<string, unknown>).role).toBe('parenthetical');
  });

  it('marks the rewritten range COMMAND, not ASSIST', () => {
    // FR-4.11 asks what produced a range. This was a rewrite the student requested of their own
    // sentence, which is what COMMAND means; ASSIST would say they accepted a suggestion.
    editor = createTestEditor(doc(paragraph(text('Cost mattered '), cite('a'), text('.'))));
    const found = sentenceAroundCitation(editor, 'a');
    applyCitationRole(
      editor,
      found as NonNullable<typeof found>,
      '{{cite:a}} found that cost mattered.',
      'a',
      'narrative',
      'action-1',
    );
    expect(provenanceRuns(editor).map((run) => run.kind)).toContain('COMMAND');
  });

  it('leaves the sentences around it alone', () => {
    editor = createTestEditor(
      doc(paragraph(text('Before it. Cost mattered '), cite('a'), text('. After it.'))),
    );
    const found = sentenceAroundCitation(editor, 'a');
    applyCitationRole(
      editor,
      found as NonNullable<typeof found>,
      '{{cite:a}} found that cost mattered.',
      'a',
      'narrative',
      'action-1',
    );
    const out = editor.getText();
    expect(out).toContain('Before it.');
    expect(out).toContain('After it.');
    expect(out).toContain('found that cost mattered');
  });
});
