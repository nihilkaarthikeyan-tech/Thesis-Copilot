import type { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const citation = (key: string) => ({
  type: 'citation',
  attrs: {
    key,
    sourceId: 'src-1',
    chunkId: null,
    role: 'parenthetical',
    locator: null,
    prefix: null,
    suffix: null,
  },
});

function copied(): { text: string; html: string } {
  const view = editor.view;
  const slice = new Slice(view.state.doc.content, 0, 0);
  const textSerializer = view.someProp('clipboardTextSerializer');
  const htmlSerializer = view.someProp('clipboardSerializer');
  if (!textSerializer || !htmlSerializer) throw new Error('no clipboard serializers');
  const div = document.createElement('div');
  div.appendChild(htmlSerializer.serializeFragment(slice.content));
  return { text: textSerializer(slice, view), html: div.innerHTML };
}

describe('copying out of the editor (2026-10-04)', () => {
  it('a copy reads the citation as its label, and still carries its key for the editor', () => {
    editor = createTestEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Cost was the main barrier ' },
            citation('c_9'),
            { type: 'text', text: '.' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
      ],
    });
    editor.commands.setCitationStyle('apa', { c_9: '(Rao, 2021)' });

    const { text, html } = copied();
    expect(text).toBe('Cost was the main barrier (Rao, 2021).\n\nSecond paragraph.');
    expect(text).not.toContain('{{cite:');
    expect(html).toContain('(Rao, 2021)');
    expect(html).toContain('data-key="c_9"');
    expect(html).not.toContain('{{cite:');
  });

  it('a note-style citation is copied as its note text in brackets', () => {
    editor = createTestEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Claim' }, citation('c_1')] }],
    });
    editor.commands.setCitationStyle('chicago-note', { c_1: 'Rao, Water Policy, 12.' }, true);
    expect(copied().text).toBe('Claim [Rao, Water Policy, 12.]');
  });
});
