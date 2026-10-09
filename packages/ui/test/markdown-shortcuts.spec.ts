/**
 * R35 (ADR-0118): every Markdown shortcut the "Keyboard shortcuts" window lists, typed into a
 * real editor one character at a time, does what the window says — so the list cannot promise a
 * rule the editor does not have.
 */

import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { MARKDOWN_SHORTCUTS } from '../src/editor/shortcuts.js';
import { createTestEditor } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

/** Types as a keyboard does: each character through the input-rule hook, else inserted. */
function type(text: string): void {
  const view = editor.view;
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) =>
      f(view, from, to, char, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

const types = () => {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    out.push(node.type.name);
  });
  return out;
};

describe('the Markdown shortcuts the student is shown', () => {
  for (const shortcut of MARKDOWN_SHORTCUTS) {
    it(`${shortcut.typed} gives ${shortcut.gives.toLowerCase()}`, () => {
      editor = createTestEditor('<p></p>');
      editor.commands.focus('end');
      type(shortcut.sample);
      const expected = shortcut.expect;
      if ('node' in expected) {
        expect(types()).toContain(expected.node);
      } else if ('inline' in expected) {
        expect(types()).toContain(expected.inline);
        expect(editor.state.doc.textContent).not.toContain('$$');
      } else {
        let marked = '';
        editor.state.doc.descendants((node) => {
          if (node.isText && node.marks.some((m) => m.type.name === expected.mark)) {
            marked += node.text ?? '';
          }
        });
        expect(marked).toBe(expected.text);
        expect(editor.state.doc.textContent).toBe(expected.text);
      }
    });
  }
});

describe('equations from $$…$$', () => {
  it('a line of only $$…$$ becomes a displayed equation', () => {
    editor = createTestEditor('<p></p>');
    editor.commands.focus('end');
    type('$$E = mc^2$$');
    const block = editor.state.doc.firstChild;
    expect(block?.type.name).toBe('mathBlock');
    expect(block?.attrs.latex).toBe('E = mc^2');
  });

  it('LaTeX KaTeX cannot draw stays as the text typed', () => {
    editor = createTestEditor('<p></p>');
    editor.commands.focus('end');
    type('Bad $$\\frac{a$$');
    expect(types()).not.toContain('mathInline');
    expect(editor.state.doc.textContent).toBe('Bad $$\\frac{a$$');
  });

  it('a single dollar is money, not mathematics', () => {
    editor = createTestEditor('<p></p>');
    editor.commands.focus('end');
    type('It cost $5 and $10.');
    expect(types()).not.toContain('mathInline');
    expect(editor.state.doc.textContent).toBe('It cost $5 and $10.');
  });
});

/** Ctrl+Z as the keyboard sends it, through the editor's keymaps. */
function pressUndo(): boolean {
  const view = editor.view;
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
  return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false;
}

describe('Ctrl+Z straight after a shortcut (QA 2026-10-09, ADR-0118)', () => {
  for (const shortcut of MARKDOWN_SHORTCUTS) {
    it(`gives back "${shortcut.sample}" as typed`, () => {
      editor = createTestEditor('<p></p>');
      editor.commands.focus('end');
      type(shortcut.sample);
      expect(pressUndo()).toBe(true);
      expect(editor.state.doc.textContent).toBe(shortcut.sample);
      const kinds = types();
      for (const kind of [
        'heading',
        'bulletList',
        'orderedList',
        'blockquote',
        'codeBlock',
        'horizontalRule',
        'mathInline',
      ]) {
        expect(kinds).not.toContain(kind);
      }
      // Provenance marks who typed it; only formatting marks would mean the rule stuck.
      const formatting = new Set<string>();
      editor.state.doc.descendants((node) => {
        for (const mark of node.marks) {
          if (mark.type.name !== 'provenance') formatting.add(mark.type.name);
        }
      });
      expect([...formatting]).toEqual([]);
    });
  }

  it('is the ordinary undo once anything else has been typed', () => {
    editor = createTestEditor('<p></p>');
    editor.commands.focus('end');
    type('**bold**');
    type(' and more');
    pressUndo();
    expect(editor.state.doc.textContent).not.toContain('**');
  });
});
