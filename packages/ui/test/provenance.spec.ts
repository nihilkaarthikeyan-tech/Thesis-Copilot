/**
 * PHASES 1.2 — provenance mark + appendTransaction plugin (Appendix B.4).
 * B.9 test 5: typing at the end of an ASSIST range produces HUMAN text; editing inside it produces
 * HUMAN_EDITED. Plus paste behaviour and word counts.
 */

import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { wordCountByProvenance } from '../src/editor/provenance.js';
import { createTestEditor, provenanceRuns } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const withAssist = (text = 'assisted words') => {
  const ed = createTestEditor('<p></p>');
  ed.commands.setTextSelection(1);
  ed.commands.insertContent(text);
  // insertContent → HUMAN via the plugin; re-mark as ASSIST to simulate an accepted suggestion.
  ed.commands.setProvenance(1, 1 + text.length, { kind: 'ASSIST', actionId: 'sug-1' });
  return ed;
};

describe('provenance (Appendix B.4)', () => {
  it('typed text with no mark becomes HUMAN', () => {
    editor = createTestEditor('<p></p>');
    editor.commands.setTextSelection(1);
    editor.commands.insertContent('hello');
    expect(provenanceRuns(editor)).toEqual([{ text: 'hello', kind: 'HUMAN', actionId: null }]);
  });

  it('B.9 #5a: typing at the END of an ASSIST range produces HUMAN text', () => {
    editor = withAssist('assisted');
    editor.commands.setTextSelection(1 + 'assisted'.length);
    editor.commands.insertContent(' more');
    expect(provenanceRuns(editor)).toEqual([
      { text: 'assisted', kind: 'ASSIST', actionId: 'sug-1' },
      { text: ' more', kind: 'HUMAN', actionId: null },
    ]);
  });

  it('B.9 #5b: typing INSIDE an ASSIST range produces HUMAN_EDITED with the same actionId', () => {
    editor = withAssist('assisted');
    editor.commands.setTextSelection(1 + 4); // between "assi" and "sted"
    editor.commands.insertContent('X');
    const runs = provenanceRuns(editor);
    expect(runs.map((r) => [r.text, r.kind])).toEqual([
      ['assi', 'ASSIST'],
      ['X', 'HUMAN_EDITED'],
      ['sted', 'ASSIST'],
    ]);
    expect(runs[1]?.actionId).toBe('sug-1');
  });

  it('deleting inside an ASSIST range marks the touched text HUMAN_EDITED', () => {
    editor = withAssist('assisted');
    editor.commands.deleteRange({ from: 3, to: 5 }); // remove "si"
    const kinds = provenanceRuns(editor).map((r) => r.kind);
    expect(kinds).toContain('HUMAN_EDITED');
    expect(editor.state.doc.textContent).toBe('assted');
  });

  it('internal paste preserves provenance marks', () => {
    editor = withAssist('assisted');
    editor.commands.setTextSelection(1 + 'assisted'.length);
    editor.view.pasteHTML('<span data-provenance="DRAFT" data-action-id="d-7">pasted</span>');
    const last = provenanceRuns(editor).at(-1);
    expect(last).toEqual({ text: 'pasted', kind: 'DRAFT', actionId: 'd-7' });
  });

  it('external paste becomes HUMAN', () => {
    editor = withAssist('assisted');
    editor.commands.setTextSelection(1 + 'assisted'.length);
    editor.view.pasteText('from elsewhere');
    const last = provenanceRuns(editor).at(-1);
    expect(last).toEqual({ text: 'from elsewhere', kind: 'HUMAN', actionId: null });
  });

  it('counts words by provenance', () => {
    editor = createTestEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'one two three ',
              marks: [{ type: 'provenance', attrs: { kind: 'HUMAN', actionId: null } }],
            },
            {
              type: 'text',
              text: 'four five',
              marks: [{ type: 'provenance', attrs: { kind: 'ASSIST', actionId: 's' } }],
            },
            {
              type: 'text',
              text: ' six',
              marks: [{ type: 'provenance', attrs: { kind: 'HUMAN_EDITED', actionId: 's' } }],
            },
          ],
        },
      ],
    });
    expect(wordCountByProvenance(editor.state.doc)).toEqual({
      HUMAN: 3,
      ASSIST: 2,
      DRAFT: 0,
      COMMAND: 0,
      HUMAN_EDITED: 1,
    });
  });
});
