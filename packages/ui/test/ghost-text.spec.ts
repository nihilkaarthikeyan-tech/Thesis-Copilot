/**
 * PHASES 1.3 — ghost-text plugin (Appendix B.3). B.9 tests 1–4.
 */

import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { getGhostState, jsonContainsText } from '../src/editor/ghost-text.js';
import { createTestEditor, fakeRequest, pressKey, provenanceRuns, tick } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const SUGGESTION =
  'Evidence from rural Karnataka shows cost was the main barrier {{cite:S4#c2}}. This section examines it.';

const streamOf = (text: string, paced = false) =>
  fakeRequest({
    paced,
    events: [
      { type: 'start', suggestionId: 'sug-42' },
      ...text.split(' ').map((w, i) => ({ type: 'token' as const, t: i === 0 ? w : ` ${w}` })),
      {
        type: 'done',
        citations: [
          { key: 'S4#c2', sourceId: 'src-4', chunkId: 'chunk-2', rendered: '(Rao, 2021)' },
        ],
      },
    ],
  });

describe('ghost text (Appendix B.3)', () => {
  it('B.9 #1: ghost text never appears in editor.getJSON() at any point during a stream', async () => {
    const fake = streamOf(SUGGESTION, true);
    editor = createTestEditor('<p>Intro. </p>', { request: fake.request });
    editor.commands.setTextSelection(8);
    expect(editor.commands.requestSuggestion()).toBe(true);

    for (let i = 0; i < 20; i++) {
      fake.release();
      await tick(2);
      const ghost = getGhostState(editor);
      expect(jsonContainsText(editor.getJSON(), 'Evidence')).toBe(false);
      if (ghost?.text) expect(jsonContainsText(editor.getJSON(), ghost.text)).toBe(false);
      if (ghost?.status === 'shown') break;
    }
    expect(getGhostState(editor)?.status).toBe('shown');
    expect(getGhostState(editor)?.text).toBe(SUGGESTION);
    // The widget is drawn, though.
    expect(editor.view.dom.querySelector('span.ghost')?.textContent).toBe(SUGGESTION);
    expect(editor.view.dom.querySelector('span.ghost')?.getAttribute('aria-live')).toBe('polite');
  });

  it('B.9 #2: Tab inserts the text with ASSIST provenance, converts {{cite}}, and moves the cursor to the end', async () => {
    const outcomes: Array<{ suggestionId: string; outcome: string; keptChars: number }> = [];
    const fake = streamOf(SUGGESTION);
    // JSON, not HTML: HTML parsing trims the trailing space, and the cursor must sit after it.
    editor = createTestEditor(
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Intro. ' }] }],
      },
      { request: fake.request },
      outcomes,
    );
    editor.commands.setTextSelection(8);
    editor.commands.requestSuggestion();
    await tick(40);
    expect(getGhostState(editor)?.status).toBe('shown');

    expect(pressKey(editor, 'Tab')).toBe(true);

    const runs = provenanceRuns(editor);
    expect(runs[0]).toEqual({ text: 'Intro. ', kind: 'HUMAN', actionId: null });
    expect(runs.slice(1).every((r) => r.kind === 'ASSIST' && r.actionId === 'sug-42')).toBe(true);
    expect(editor.state.doc.textContent).not.toContain('{{cite');
    const citations =
      editor.getJSON().content?.[0]?.content?.filter((n) => n.type === 'citation') ?? [];
    expect(citations).toHaveLength(1);
    expect(citations[0]?.attrs?.sourceId).toBe('src-4');
    expect(editor.state.selection.from).toBe(
      editor.state.doc.firstChild ? editor.state.doc.firstChild.nodeSize - 1 : 0,
    );
    expect(getGhostState(editor)?.status).toBe('idle');
    expect(editor.view.dom.querySelector('span.ghost')).toBeNull();
    expect(outcomes).toEqual([
      {
        suggestionId: 'sug-42',
        outcome: 'ACCEPTED',
        keptChars: SUGGESTION.length,
        shownChars: SUGGESTION.length,
      },
    ]);
  });

  it('B.9 #3: typing while a suggestion is shown clears it and aborts the request', async () => {
    const outcomes: Array<{ suggestionId: string; outcome: string; keptChars: number }> = [];
    const fake = streamOf('one two three', true);
    editor = createTestEditor('<p>x</p>', { request: fake.request }, outcomes);
    editor.commands.setTextSelection(2);
    editor.commands.requestSuggestion();
    fake.release();
    await tick(2); // start
    fake.release();
    await tick(2); // first token
    expect(getGhostState(editor)?.status).toBe('streaming');
    expect(getGhostState(editor)?.text).toBe('one');

    editor.commands.insertContent('y'); // the student keeps typing

    expect(getGhostState(editor)?.status).toBe('idle');
    expect(fake.aborted()).toBe(true);
    expect(outcomes).toEqual([
      { suggestionId: 'sug-42', outcome: 'REJECTED', keptChars: 0, shownChars: 3 },
    ]);
    expect(editor.state.doc.textContent).toBe('xy');
    expect(editor.view.dom.querySelector('span.ghost')).toBeNull();
  });

  it('B.9 #4: Tab without a suggestion still indents a list item', () => {
    editor = createTestEditor('<ul><li><p>first</p></li><li><p>second</p></li></ul>');
    // Cursor in the second item.
    editor.commands.setTextSelection(editor.state.doc.content.size - 4);
    expect(getGhostState(editor)?.status).toBe('idle');
    expect(pressKey(editor, 'Tab')).toBe(true);
    const json = editor.getJSON();
    const firstItem = json.content?.[0]?.content?.[0];
    // The second item is now nested inside the first.
    expect(firstItem?.content?.some((n) => n.type === 'bulletList')).toBe(true);
  });

  it('Escape dismisses with REJECTED and reports nothing kept', async () => {
    const outcomes: Array<{ suggestionId: string; outcome: string; keptChars: number }> = [];
    const fake = streamOf('alpha beta');
    editor = createTestEditor('<p>x</p>', { request: fake.request }, outcomes);
    editor.commands.setTextSelection(2);
    editor.commands.requestSuggestion();
    await tick(20);
    expect(pressKey(editor, 'Escape')).toBe(true);
    expect(getGhostState(editor)?.status).toBe('idle');
    expect(outcomes[0]?.outcome).toBe('REJECTED');
    expect(editor.state.doc.textContent).toBe('x');
  });

  it('Alt+→ accepts one word at a time and reports PARTIAL on dismiss', async () => {
    const outcomes: Array<{ suggestionId: string; outcome: string; keptChars: number }> = [];
    const fake = streamOf('alpha beta gamma');
    editor = createTestEditor('<p></p>', { request: fake.request }, outcomes);
    editor.commands.setTextSelection(1);
    editor.commands.requestSuggestion();
    await tick(20);
    expect(pressKey(editor, 'ArrowRight', { alt: true })).toBe(true);
    expect(editor.state.doc.textContent).toBe('alpha ');
    expect(getGhostState(editor)?.text).toBe('beta gamma');
    expect(getGhostState(editor)?.status).toBe('shown');
    pressKey(editor, 'Escape');
    expect(outcomes[0]).toMatchObject({ outcome: 'PARTIAL', keptChars: 6 });
    expect(provenanceRuns(editor)[0]?.kind).toBe('ASSIST');
  });

  it('only one in-flight request per editor; requests need an eligible cursor', async () => {
    const fake = streamOf('x y', true);
    editor = createTestEditor('<p>a</p><pre><code>code</code></pre>', { request: fake.request });
    editor.commands.setTextSelection(2);
    expect(editor.commands.requestSuggestion()).toBe(true);
    expect(editor.commands.requestSuggestion()).toBe(false);
    expect(fake.calls).toHaveLength(1);
    editor.commands.dismissSuggestion();
    // Inside a code block: refused.
    editor.commands.setTextSelection(6);
    expect(editor.commands.requestSuggestion()).toBe(false);
  });

  it('sends before/after context with citations rendered as {{cite:KEY}}', async () => {
    const fake = streamOf('z');
    editor = createTestEditor(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Earlier paragraph.' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Cited ' },
              {
                type: 'citation',
                attrs: {
                  key: 'c_1',
                  sourceId: 's',
                  chunkId: null,
                  role: 'parenthetical',
                  locator: null,
                  prefix: null,
                  suffix: null,
                },
              },
              { type: 'text', text: ' then cursor here and after.' },
            ],
          },
        ],
      },
      { request: fake.request },
    );
    const pos = editor.state.doc.firstChild
      ? editor.state.doc.firstChild.nodeSize + 1 + 'Cited '.length + 1 + ' then cursor'.length
      : 0;
    editor.commands.setTextSelection(pos);
    editor.commands.requestSuggestion();
    await tick(5);
    const payload = fake.calls[0]?.payload;
    expect(payload?.chapterId).toBe('chapter-1');
    expect(payload?.before).toBe('Earlier paragraph.\nCited {{cite:c_1}} then cursor');
    expect(payload?.after).toBe(' here and after.');
  });
});
