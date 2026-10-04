import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor, pressKey } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

const blocks = () => {
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    out.push(node.textContent);
  });
  return out;
};
/** Puts the cursor inside the block whose text starts with `text`. */
const cursorIn = (text: string) => {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.startsWith(text)) at = pos + 1;
  });
  editor.commands.setTextSelection(at);
};

describe('moving a block (coverage-map row 20)', () => {
  it('moves the block under the cursor up and down, keeping the cursor in it', () => {
    editor = createTestEditor('<p>Alpha</p><p>Beta</p><p>Gamma</p>');
    cursorIn('Gamma');
    expect(editor.commands.moveBlock('up')).toBe(true);
    expect(blocks()).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(editor.state.selection.$from.parent.textContent).toBe('Gamma');
    expect(editor.commands.moveBlock('up')).toBe(true);
    expect(blocks()).toEqual(['Gamma', 'Alpha', 'Beta']);
    // Already first: nothing to do.
    expect(editor.commands.moveBlock('up')).toBe(false);
    expect(editor.commands.moveBlock('down')).toBe(true);
    expect(blocks()).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('moves every block a selection spans, together', () => {
    editor = createTestEditor('<p>Alpha</p><p>Beta</p><p>Gamma</p><p>Delta</p>');
    cursorIn('Alpha');
    const from = editor.state.selection.from;
    cursorIn('Beta');
    editor.commands.setTextSelection({ from, to: editor.state.selection.from + 2 });
    expect(editor.commands.moveBlock('down')).toBe(true);
    expect(blocks()).toEqual(['Gamma', 'Alpha', 'Beta', 'Delta']);
    // Nothing past the end.
    expect(editor.commands.moveBlock('down')).toBe(true);
    expect(editor.commands.moveBlock('down')).toBe(false);
    expect(blocks()).toEqual(['Gamma', 'Delta', 'Alpha', 'Beta']);
  });

  it('never moves the chapter title or past it', () => {
    editor = createTestEditor('<h1>Chapter 2</h1><p>Alpha</p><p>Beta</p>');
    cursorIn('Alpha');
    expect(editor.commands.moveBlock('up')).toBe(false);
    cursorIn('Chapter');
    expect(editor.commands.moveBlock('down')).toBe(false);
    expect(blocks()).toEqual(['Chapter 2', 'Alpha', 'Beta']);
  });

  it('answers Mod-Shift-↑ / ↓ and is undone in one step', () => {
    editor = createTestEditor('<p>Alpha</p><p>Beta</p>');
    cursorIn('Beta');
    expect(pressKey(editor, 'ArrowUp', { ctrl: true, shift: true })).toBe(true);
    expect(blocks()).toEqual(['Beta', 'Alpha']);
    editor.commands.undo();
    expect(blocks()).toEqual(['Alpha', 'Beta']);
  });
});
