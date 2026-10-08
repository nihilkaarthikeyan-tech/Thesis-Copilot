/**
 * The citation card inside a table that scrolls sideways (ADR-0123). A gap analysis's claims table
 * scrolls inside its own box on a phone (`.tableWrapper`), and that box would cut an absolutely
 * placed card off at its edge. There the card is placed against the window, kept on screen, and
 * closed by a scroll; anywhere else it is placed as before.
 */

import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { thesisExtensions } from '../src/editor/extensions.js';

let editor: Editor | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
});

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Supporting: ' },
        {
          type: 'citation',
          attrs: {
            key: 'c_tbl',
            sourceId: 'src-1',
            chunkId: 'chunk-1',
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

async function hover(inScroller: boolean): Promise<HTMLElement> {
  host = document.createElement('div');
  if (inScroller) host.className = 'tableWrapper';
  document.body.appendChild(host);
  const element = document.createElement('div');
  host.appendChild(element);
  editor = new Editor({
    element,
    content: doc,
    extensions: thesisExtensions({
      ghostText: { chapterId: 'chapter-1', request: async function* () {} },
      citation: {
        hoverDelayMs: 0,
        resolvePassage: async () => ({
          text: 'Upfront cost limited adoption.',
          page: null,
          section: null,
          shortRef: 'Rao 2024',
          pdfUrl: null,
        }),
      },
      resizableTables: false,
    }),
  });
  const node = editor.view.dom.querySelector('span.citation') as HTMLElement;
  node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  await new Promise((r) => setTimeout(r, 5));
  await Promise.resolve();
  return node;
}

describe('the citation card in a scrolling table', () => {
  it('is placed against the window, on screen, and closes on a scroll', async () => {
    const node = await hover(true);
    const card = node.querySelector('.citation-popover') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.style.position).toBe('fixed');
    const left = Number.parseFloat(card.style.left);
    const width = Number.parseFloat(card.style.width);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + width).toBeLessThanOrEqual(window.innerWidth - 8);

    window.dispatchEvent(new Event('scroll'));
    expect(node.querySelector('.citation-popover')).toBeNull();
  });

  it('is placed beside the citation, as before, anywhere else', async () => {
    const node = await hover(false);
    const card = node.querySelector('.citation-popover') as HTMLElement;
    expect(card.style.position).toBe('absolute');
    window.dispatchEvent(new Event('scroll'));
    // A scroll moves the citation and its card together; nothing closes it.
    expect(node.querySelector('.citation-popover')).toBeTruthy();
  });
});
