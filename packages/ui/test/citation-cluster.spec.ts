/**
 * R40 (ADR-0117): citations side by side read as one citation in the editor.
 *
 * The browser run of 2026-10-07 showed "(Gadekar et al., 2026)(Raja et al., 2026)". The server
 * now renders such a run as one cluster; the first node shows its label and the others nothing,
 * while every node stays a node of its own — hoverable from the card, removable one at a time,
 * and back to its own label the moment an edit parts it from its neighbour.
 */

import type { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import type { CitationOptions, CitationPassage } from '../src/editor/citation.js';
import { createTestEditor } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const citation = (key: string, sourceId: string | null, chunkId: string | null = null) => ({
  type: 'citation',
  attrs: {
    key,
    sourceId,
    chunkId,
    role: 'parenthetical',
    locator: null,
    prefix: null,
    suffix: null,
  },
});

/** "Urban heat rose (Gadekar; Raja). Trees help (Raja)." */
const DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Urban heat rose ' },
        citation('c_g', 'src-g', 'chunk-g'),
        citation('c_r', 'src-r', 'chunk-r'),
        { type: 'text', text: '. Trees help ' },
        citation('c_t', 'src-r'),
        { type: 'text', text: '.' },
      ],
    },
  ],
};

const LABELS = {
  c_g: '(Gadekar et al., 2026)',
  c_r: '(Raja et al., 2026)',
  c_t: '(Raja et al., 2026)',
};
const CLUSTERS = [{ keys: ['c_g', 'c_r'], label: '(Gadekar et al., 2026; Raja et al., 2026)' }];

const PASSAGES: Record<string, CitationPassage> = {
  'chunk-g': {
    text: 'Rapid urbanization has transformed local temperatures.',
    page: 2,
    section: 'Introduction',
    shortRef: 'Gadekar et al., 2026',
    pdfUrl: 'https://minio.example/g.pdf',
  },
  'chunk-r': {
    text: 'Tree cover lowered surface temperature by 2 °C.',
    page: 7,
    section: 'Results',
    shortRef: 'Raja et al., 2026',
    pdfUrl: 'https://minio.example/r.pdf',
  },
};

function open(options: CitationOptions = {}, clusters = CLUSTERS): Editor {
  editor = createTestEditor(DOC, {}, [], {
    hoverDelayMs: 0,
    resolvePassage: async (_sourceId, chunkId) => (chunkId ? (PASSAGES[chunkId] ?? null) : null),
    ...options,
  });
  editor.commands.setCitationStyle('apa', { ...LABELS }, false, false, clusters);
  return editor;
}

const spans = () => [...editor.view.dom.querySelectorAll<HTMLElement>('span.citation')];
const shown = () => spans().map((span) => span.textContent);
const paragraphText = () =>
  (editor.view.dom.querySelector('p')?.textContent ?? '').replace(/\s+/g, ' ');

async function hover(span: HTMLElement): Promise<void> {
  span.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  await new Promise((r) => setTimeout(r, 5));
  await Promise.resolve();
}

describe('citations side by side in the editor', () => {
  it('read as one bracket, from the first node, and the document keeps both nodes', () => {
    open();
    const before = editor.getJSON();
    expect(shown()).toEqual([CLUSTERS[0]?.label, '', LABELS.c_t]);
    expect(paragraphText()).toBe(
      'Urban heat rose (Gadekar et al., 2026; Raja et al., 2026). Trees help (Raja et al., 2026).',
    );
    expect(paragraphText()).not.toContain(')(');
    const [head, member] = spans();
    expect(head?.classList.contains('citation--cluster')).toBe(true);
    expect(member?.classList.contains('citation--member')).toBe(true);
    expect(member?.getAttribute('aria-hidden')).toBe('true');
    expect(editor.getJSON()).toEqual(before);
  });

  it('show their own labels the moment an edit parts them, and join again when it is undone', () => {
    open();
    // Text typed between the two: no longer side by side.
    editor.commands.insertContentAt(18, ' and ');
    expect(shown()).toEqual([LABELS.c_g, LABELS.c_r, LABELS.c_t]);
    editor.commands.undo();
    expect(shown()).toEqual([CLUSTERS[0]?.label, '', LABELS.c_t]);
  });

  it('show the one left standing on its own label when the other is deleted', () => {
    open();
    // The second node of the cluster sits at 18 (1 + "Urban heat rose ".length + 1).
    editor.view.dispatch(editor.state.tr.delete(18, 19));
    expect(shown()).toEqual([LABELS.c_g, LABELS.c_t]);
  });

  it('do not draw a cluster over a source removed from the library', () => {
    open();
    editor.commands.markSourceRemoved('src-r');
    expect(shown()).toEqual([LABELS.c_g, LABELS.c_r, LABELS.c_t]);
    expect(spans()[1]?.classList.contains('citation--removed')).toBe(true);
  });

  it('are separate citations again when the next render brings no cluster', () => {
    open();
    editor.commands.setCitationStyle('apa', { ...LABELS });
    expect(shown()).toEqual([LABELS.c_g, LABELS.c_r, LABELS.c_t]);
  });

  it('in a note style take one footnote number, on the first node', () => {
    open();
    editor.commands.setCitationStyle('chicago-note', { ...LABELS }, true, false, CLUSTERS);
    const [head, member, alone] = spans();
    expect(head?.classList.contains('citation--note')).toBe(true);
    expect(head?.title).toBe(CLUSTERS[0]?.label);
    // The member is hidden and takes no counter (editor.css keys on `citation--member`).
    expect(member?.classList.contains('citation--member')).toBe(true);
    expect(alone?.classList.contains('citation--member')).toBe(false);
  });
});

describe('selecting and removing a cluster', () => {
  it('a click selects the whole bracket, so Delete takes what the student sees', () => {
    open();
    const view = editor.view;
    const node = view.state.doc.nodeAt(17);
    const handled = view.someProp('handleClickOn', (f) =>
      f(view, 17, node as never, 17, new MouseEvent('click'), true),
    );
    expect(handled).toBe(true);
    const selection = view.state.selection;
    expect(selection).toBeInstanceOf(TextSelection);
    expect([selection.from, selection.to]).toEqual([17, 19]);
    editor.commands.deleteSelection();
    expect(shown()).toEqual([LABELS.c_t]);
  });

  it('a hidden node selected from the keyboard shows on the bracket', () => {
    open();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 18)));
    expect(spans()[0]?.classList.contains('citation--cluster-selected')).toBe(true);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    expect(spans()[0]?.classList.contains('citation--cluster-selected')).toBe(false);
  });

  it('the hover card has a tab per source, each with its own passage and Read beside', async () => {
    const asked: unknown[] = [];
    open({ readBeside: (t) => asked.push(t), canReadBeside: () => true });
    const head = spans()[0] as HTMLElement;
    await hover(head);
    const card = head.querySelector('[data-testid="citation-cluster-card"]') as HTMLElement;
    expect(card).toBeTruthy();
    const tabs = [
      ...card.querySelectorAll<HTMLButtonElement>('[data-testid="citation-cluster-tab"]'),
    ];
    expect(tabs.map((t) => t.textContent)).toEqual(['Gadekar et al., 2026', 'Raja et al., 2026']);
    expect(card.textContent).toContain(PASSAGES['chunk-g']?.text);

    tabs[1]?.click();
    expect(card.textContent).toContain(PASSAGES['chunk-r']?.text);
    expect(card.textContent).not.toContain(PASSAGES['chunk-g']?.text);
    (card.querySelector('[data-testid="citation-read-beside"]') as HTMLButtonElement).click();
    expect(asked).toEqual([
      { sourceId: 'src-r', page: 7, label: 'Raja et al., 2026', quote: PASSAGES['chunk-r']?.text },
    ]);
  });

  it('Remove on the card takes out that one source and leaves the other', async () => {
    open();
    const head = spans()[0] as HTMLElement;
    await hover(head);
    const card = head.querySelector('[data-testid="citation-cluster-card"]') as HTMLElement;
    (card.querySelectorAll('[data-testid="citation-cluster-tab"]')[1] as HTMLElement).click();
    (card.querySelector('[data-testid="citation-cluster-remove"]') as HTMLButtonElement).click();
    const keys: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'citation') keys.push(String(node.attrs.key));
    });
    expect(keys).toEqual(['c_g', 'c_t']);
    expect(shown()).toEqual([LABELS.c_g, LABELS.c_t]);
  });

  it('a read-only chapter offers no Remove', async () => {
    open();
    editor.setEditable(false);
    const head = spans()[0] as HTMLElement;
    await hover(head);
    expect(head.querySelector('[data-testid="citation-cluster-card"]')).toBeTruthy();
    expect(head.querySelector('[data-testid="citation-cluster-remove"]')).toBeNull();
  });
});

describe('copying a cluster out of the editor', () => {
  it('reads as the one bracket in text and HTML, and keeps both nodes for a paste back', () => {
    open();
    const view = editor.view;
    const slice = new Slice(view.state.doc.content, 0, 0);
    const text = view.someProp('clipboardTextSerializer')?.(slice, view);
    expect(text).toBe(
      'Urban heat rose (Gadekar et al., 2026; Raja et al., 2026). Trees help (Raja et al., 2026).',
    );
    const div = document.createElement('div');
    const serializer = view.someProp('clipboardSerializer');
    div.appendChild(serializer?.serializeFragment(slice.content) as Node);
    expect(div.textContent).toBe(text);
    expect(div.innerHTML).toContain('data-key="c_g"');
    expect(div.innerHTML).toContain('data-key="c_r"');
  });

  it('reads a copy of only one of its nodes as that node’s own label', () => {
    open();
    const view = editor.view;
    const slice = view.state.doc.slice(18, 19);
    expect(view.someProp('clipboardTextSerializer')?.(slice, view)).toBe(LABELS.c_r);
  });
});
