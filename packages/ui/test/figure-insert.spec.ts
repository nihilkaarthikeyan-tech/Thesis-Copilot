/**
 * Inserting a figure, and what survives doing something else next.
 *
 * Found by exporting a whole thesis in a browser: upload a figure, click "Insert table", and the
 * figure is gone from the document with no message and nothing to suggest it happened. A block
 * node inserted the obvious way stays *selected*, and the next insertion replaces the selection.
 *
 * The second test here is the reason the first one was ever able to regress: the app had its own
 * inline copy of this command, so the one in this package was a file nobody had run.
 */

import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { thesisExtensions } from '../src/editor/extensions.js';

const PNG = 'https://example.test/figures/a/b/plot.png?sig=1';

function editorWith(
  upload: (file: File) => Promise<{ key: string; url: string }>,
  onError?: (error: unknown) => void,
): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A.' }] }],
    },
    extensions: thesisExtensions({
      ghostText: { chapterId: 'c1', request: async function* () {} },
      resizableTables: false,
      imageUpload: upload,
      ...(onError ? { imageUploadError: onError } : {}),
    }),
  });
}

const file = () => new File([new Uint8Array([1, 2, 3])], 'plot.png', { type: 'image/png' });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const imagesIn = (editor: Editor) => {
  const found: Array<Record<string, unknown>> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') found.push(node.attrs);
  });
  return found;
};

let editor: Editor;
afterEach(() => editor?.destroy());

const countOf = (editor: Editor, type: string) => {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) n++;
  });
  return n;
};

describe('a display equation', () => {
  it('survives the next thing inserted', () => {
    // The same bug, in the other inserter: `insertContent` leaves a block atom selected, so
    // uploading a figure straight after typing an equation replaced the equation.
    editor = editorWith(async () => ({ key: 'figures/a/b/plot.png', url: PNG }));
    editor.commands.insertMathBlock('E = mc^2');
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    expect(countOf(editor, 'mathBlock')).toBe(1);
  });

  it('survives it with the caret mid-paragraph, which is where it is split', async () => {
    // The case that made two earlier fixes look right: with the caret at the end of a sentence,
    // `replaceSelectionWith` splits the paragraph, and every position computed from the selection
    // or the step map lands *inside the second half* rather than at document level.
    editor = editorWith(async () => ({ key: 'figures/a/b/plot.png', url: PNG }));
    editor.commands.setTextSelection(3);
    editor.commands.insertMathBlock('E = mc^2');

    editor.commands.uploadImage(file());
    await settle();

    expect(countOf(editor, 'mathBlock')).toBe(1);
    expect(countOf(editor, 'image')).toBe(1);
  });

  it('does not stack up empty paragraphs when the split already made one', () => {
    editor = editorWith(async () => ({ key: 'figures/a/b/plot.png', url: PNG }));
    const before = countOf(editor, 'paragraph');
    editor.commands.setTextSelection(3);
    editor.commands.insertMathBlock('E = mc^2');
    // The split produces the paragraph that holds the rest of the sentence; nothing more is added.
    expect(countOf(editor, 'paragraph')).toBe(before + 1);
  });
});

describe('uploadImage', () => {
  it('inserts the figure with its storage key in one go', async () => {
    editor = editorWith(async () => ({ key: 'figures/a/b/plot.png', url: PNG }));
    editor.commands.uploadImage(file());
    await settle();

    const images = imagesIn(editor);
    expect(images).toHaveLength(1);
    // The key is what the exporter looks a figure up by. Set as an attribute of the insertion,
    // not afterwards through `updateAttributes`, which writes to whatever the selection is on.
    expect(images[0]?.key).toBe('figures/a/b/plot.png');
    expect(images[0]?.src).toBe(PNG);
    expect(images[0]?.alt).toBe('plot.png');
  });

  it('leaves the caret after the figure, not on it', async () => {
    editor = editorWith(async () => ({ key: 'figures/a/b/plot.png', url: PNG }));
    editor.commands.uploadImage(file());
    await settle();
    // A NodeSelection here is the bug: the next thing inserted replaces what is selected.
    expect(editor.state.selection.constructor.name).not.toBe('NodeSelection');
  });

  it('survives the very next thing the student does', async () => {
    editor = editorWith(async () => ({ key: 'figures/a/b/plot.png', url: PNG }));
    editor.commands.uploadImage(file());
    await settle();

    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    expect(imagesIn(editor)).toHaveLength(1);
  });

  it('reports a failed upload instead of doing nothing visible', async () => {
    const seen: unknown[] = [];
    editor = editorWith(
      async () => {
        throw new Error('That file type cannot go in a .docx.');
      },
      (error) => seen.push(error),
    );
    editor.commands.uploadImage(file());
    await settle();

    expect(imagesIn(editor)).toHaveLength(0);
    expect((seen[0] as Error).message).toBe('That file type cannot go in a .docx.');
  });

  it('is false, and does nothing, with no uploader configured', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: thesisExtensions({
        ghostText: { chapterId: 'c1', request: async function* () {} },
        resizableTables: false,
      }),
    });
    expect(editor.commands.uploadImage(file())).toBe(false);
  });
});
