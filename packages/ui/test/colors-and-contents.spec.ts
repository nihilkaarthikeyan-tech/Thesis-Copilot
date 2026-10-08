/**
 * R28 (ADR-0119): text colour, highlight, the contents block and the horizontal rule in the
 * editor. What they become in each export is `packages/export/test/blocks-and-colors.spec.ts`.
 */

import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { filterSlashItems, SLASH_ITEMS } from '../src/editor/slash-menu.js';
import { setTableOfContentsLabels, tocEntries } from '../src/editor/table-of-contents.js';
import { createTestEditor, pressKey } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const marksOn = (word: string) => {
  let found: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text === word) {
      found = node.marks.map((m) => ({ type: m.type.name, attrs: { ...m.attrs } }));
    }
  });
  return found;
};

/** Selects the first occurrence of `word` in the document. */
function select(word: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText) {
      const i = (node.text ?? '').indexOf(word);
      if (i >= 0) at = pos + i;
    }
  });
  editor.commands.setTextSelection({ from: at, to: at + word.length });
}

describe('highlight', () => {
  it('stores a palette name and draws it as a <mark> with that name', () => {
    editor = createTestEditor('<p>Rainfall fell sharply.</p>');
    select('fell');
    editor.commands.setHighlight('green');
    expect(marksOn('fell')).toContainEqual({ type: 'highlight', attrs: { color: 'green' } });
    expect(editor.getHTML()).toContain('<mark data-color="green" class="tc-hl">fell</mark>');
    // Round trip through HTML keeps the colour.
    editor.commands.setContent(editor.getHTML());
    expect(marksOn('fell')).toContainEqual({ type: 'highlight', attrs: { color: 'green' } });
  });

  it('a plain or unknown <mark> from elsewhere is yellow; unset removes it', () => {
    editor = createTestEditor(
      '<p><mark>plain</mark> and <mark data-color="#ff0000">odd</mark> and <mark data-color="pink">pink</mark></p>',
    );
    expect(marksOn('plain')).toContainEqual({ type: 'highlight', attrs: { color: 'yellow' } });
    expect(marksOn('odd')).toContainEqual({ type: 'highlight', attrs: { color: 'yellow' } });
    expect(marksOn('pink')).toContainEqual({ type: 'highlight', attrs: { color: 'pink' } });
    select('pink');
    editor.commands.unsetHighlight();
    expect(marksOn('pink').some((m) => m.type === 'highlight')).toBe(false);
  });

  it('Ctrl+Shift+H highlights the selection in yellow, and again takes it off', () => {
    editor = createTestEditor('<p>Rainfall fell sharply.</p>');
    select('sharply');
    expect(pressKey(editor, 'h', { ctrl: true, shift: true })).toBe(true);
    expect(marksOn('sharply')).toContainEqual({ type: 'highlight', attrs: { color: 'yellow' } });
    pressKey(editor, 'h', { ctrl: true, shift: true });
    expect(marksOn('sharply').some((m) => m.type === 'highlight')).toBe(false);
  });

  it('one highlight replaces another on the same words', () => {
    editor = createTestEditor('<p>Rainfall fell sharply.</p>');
    select('fell');
    editor.commands.setHighlight('yellow');
    editor.commands.setHighlight('blue');
    const highlights = marksOn('fell').filter((m) => m.type === 'highlight');
    expect(highlights).toEqual([{ type: 'highlight', attrs: { color: 'blue' } }]);
  });
});

describe('text colour', () => {
  it('stores a palette name as data-text-color, never an inline style', () => {
    editor = createTestEditor('<p>Rainfall fell sharply.</p>');
    select('Rainfall');
    editor.commands.setTextColor('red');
    expect(marksOn('Rainfall')).toContainEqual({ type: 'textColor', attrs: { color: 'red' } });
    const html = editor.getHTML();
    expect(html).toContain('<span data-text-color="red" class="tc-ink">Rainfall</span>');
    expect(html).not.toContain('style=');
    editor.commands.unsetTextColor();
    expect(marksOn('Rainfall').some((m) => m.type === 'textColor')).toBe(false);
  });

  it('a pasted web page brings no colours: only our own names parse', () => {
    editor = createTestEditor(
      '<p><span style="color: #ff0000">styled</span> <span data-text-color="magenta">unknown</span> <span data-text-color="blue">ours</span></p>',
    );
    expect(marksOn('styled').some((m) => m.type === 'textColor')).toBe(false);
    expect(marksOn('unknown').some((m) => m.type === 'textColor')).toBe(false);
    expect(marksOn('ours')).toContainEqual({ type: 'textColor', attrs: { color: 'blue' } });
  });
});

describe('the contents block', () => {
  const chapter = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Methods' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Study area' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Climate' }] },
      {
        type: 'draftBlock',
        attrs: { draftId: 'd-1', status: 'pending' },
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Drafted' }] },
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sampling' }] },
    ],
  };

  it('lists the title and every heading, by level, leaving out a pending draft', () => {
    editor = createTestEditor(chapter);
    expect(tocEntries(editor.state.doc).map((e) => [e.level, e.text])).toEqual([
      [1, 'Methods'],
      [2, 'Study area'],
      [3, 'Climate'],
      [2, 'Sampling'],
    ]);
  });

  it('inserts at the caret with a line after it, and round-trips as JSON and HTML', () => {
    editor = createTestEditor(chapter);
    let intro = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Intro.') intro = pos + node.nodeSize;
    });
    editor.commands.setTextSelection(intro);
    editor.commands.insertTableOfContents();
    const types = (editor.getJSON().content ?? []).map((n) => n.type);
    expect(types.slice(0, 4)).toEqual(['heading', 'paragraph', 'tableOfContents', 'paragraph']);
    // The caret is in the line after it, ready to type.
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.selection.$from.before()).toBe(
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize + 1,
    );

    const json = editor.getJSON();
    editor.commands.setContent(json);
    expect(editor.getJSON()).toEqual(json);
    expect(editor.getHTML()).toContain('data-type="table-of-contents"');
    editor.commands.setContent(editor.getHTML());
    expect((editor.getJSON().content ?? []).some((n) => n.type === 'tableOfContents')).toBe(true);
  });

  it('draws the headings indented by level and follows edits to them', () => {
    editor = createTestEditor(chapter);
    editor.commands.setTextSelection(1);
    editor.commands.insertTableOfContents();
    const block = editor.view.dom.querySelector('[data-testid="toc-block"]');
    expect(block).not.toBeNull();
    const entries = () =>
      [...(block?.querySelectorAll('.tc-toc-entry') ?? [])].map((li) => [
        li.getAttribute('data-level'),
        li.textContent,
      ]);
    expect(entries()).toEqual([
      ['1', 'Methods'],
      ['2', 'Study area'],
      ['3', 'Climate'],
      ['2', 'Sampling'],
    ]);
    expect(block?.querySelector('.tc-toc-title')?.textContent).toBe('Contents');

    // A new heading at the end appears at once.
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Analysis' }],
    });
    expect(entries().at(-1)).toEqual(['2', 'Analysis']);

    // The words follow the interface language.
    setTableOfContentsLabels(editor, { title: 'विषय सूची', empty: '—', goTo: 'जाएँ' });
    expect(block?.querySelector('.tc-toc-title')?.textContent).toBe('विषय सूची');
  });

  it('a click on an entry puts the caret in that heading', () => {
    editor = createTestEditor(chapter);
    editor.commands.setTextSelection(1);
    editor.commands.insertTableOfContents();
    const button = editor.view.dom.querySelector<HTMLButtonElement>(
      '[data-testid="toc-block"] button[data-toc-index="3"]',
    );
    button?.click();
    expect(editor.state.selection.$from.parent.textContent).toBe('Sampling');
  });

  it('says so when the chapter has no headings yet', () => {
    editor = createTestEditor('<p>Only text.</p>');
    editor.commands.insertTableOfContents();
    const block = editor.view.dom.querySelector('[data-testid="toc-block"]');
    const empty = block?.querySelector<HTMLElement>('.tc-toc-empty');
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toMatch(/headings/i);
  });
});

describe('the horizontal rule', () => {
  it('inserts and round-trips', () => {
    editor = createTestEditor('<p>Before</p>');
    editor.commands.focus('end');
    editor.commands.setHorizontalRule();
    expect((editor.getJSON().content ?? []).map((n) => n.type)).toContain('horizontalRule');
    const json = editor.getJSON();
    editor.commands.setContent(json);
    expect(editor.getJSON()).toEqual(json);
  });
});

describe('the "/" menu offers both blocks', () => {
  it('finds them by their names and their keywords', () => {
    const ids = SLASH_ITEMS.map((i) => i.id);
    expect(ids).toContain('tableOfContents');
    expect(ids).toContain('horizontalRule');
    expect(filterSlashItems(SLASH_ITEMS, 'toc').map((i) => i.id)).toEqual(['tableOfContents']);
    expect(filterSlashItems(SLASH_ITEMS, 'divider').map((i) => i.id)).toEqual(['horizontalRule']);
    // "/tab" still offers the table first.
    expect(filterSlashItems(SLASH_ITEMS, 'tab').map((i) => i.id)).toEqual([
      'table',
      'tableOfContents',
    ]);
  });
});
