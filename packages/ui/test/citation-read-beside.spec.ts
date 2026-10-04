/**
 * "Read beside" on the citation hover card (2026-10-04): the card offers it next to "Open PDF"
 * only when the app wired it and the screen is wide enough, hands over the source and the cited
 * page, closes, and never touches the document.
 */

import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CitationOptions } from '../src/editor/citation.js';
import { createTestEditor } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const passage = {
  text: 'Recharge wells raised the water table by 1.2 m over three seasons.',
  page: 12,
  section: 'Results',
  shortRef: 'Iyer 2019',
  pdfUrl: 'https://minio.example/signed.pdf',
};

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Claim ' },
        {
          type: 'citation',
          attrs: {
            key: 'c_rb',
            sourceId: 'src-9',
            chunkId: 'chunk-3',
            role: 'parenthetical',
            locator: null,
            prefix: null,
            suffix: null,
          },
        },
      ],
    },
  ],
};

async function hover(options: CitationOptions, withPdf = true): Promise<HTMLElement> {
  editor = createTestEditor(doc, {}, [], {
    hoverDelayMs: 0,
    resolvePassage: async () => (withPdf ? passage : { ...passage, pdfUrl: null }),
    ...options,
  });
  const node = editor.view.dom.querySelector('span.citation') as HTMLElement;
  node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  await new Promise((r) => setTimeout(r, 5));
  await Promise.resolve();
  return node;
}

describe('Read beside on the citation card', () => {
  it('hands the source and the cited page to the app, then closes the card', async () => {
    const asked: unknown[] = [];
    const node = await hover({ readBeside: (t) => asked.push(t), canReadBeside: () => true });
    const before = editor.getJSON();
    const button = node.querySelector('[data-testid="citation-read-beside"]') as HTMLButtonElement;
    expect(button.textContent).toBe('Read beside');
    // "Open PDF" in a new tab is still there beside it.
    expect(node.querySelector('a.citation-popover__pdf')).toBeTruthy();

    button.click();
    expect(asked).toEqual([{ sourceId: 'src-9', page: 12, label: 'Iyer 2019' }]);
    expect(node.querySelector('.citation-popover')).toBeNull();
    expect(editor.getJSON()).toEqual(before);
  });

  it('is not offered on a narrow screen, without the app, or without a PDF', async () => {
    let node = await hover({ readBeside: () => undefined, canReadBeside: () => false });
    expect(node.querySelector('[data-testid="citation-read-beside"]')).toBeNull();
    expect(node.querySelector('a.citation-popover__pdf')).toBeTruthy();
    editor.destroy();

    node = await hover({});
    expect(node.querySelector('[data-testid="citation-read-beside"]')).toBeNull();
    editor.destroy();

    node = await hover({ readBeside: () => undefined }, false);
    expect(node.querySelector('.citation-popover')).toBeTruthy();
    expect(node.querySelector('[data-testid="citation-read-beside"]')).toBeNull();
  });
});
