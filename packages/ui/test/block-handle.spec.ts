import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blockHandleKey,
  blockTextAt,
  citeSlot,
  topLevelBlock,
} from '../src/editor/block-handle.js';
import { createTestEditor } from './helpers.js';

let editor: Editor;
afterEach(() => editor?.destroy());

/** Each top-level block as `type:text` (headings with their level). */
const blocks = () => {
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    const type = node.type.name === 'heading' ? `h${node.attrs.level}` : node.type.name;
    out.push(`${type}:${node.textContent}`);
  });
  return out;
};

/** The start position of the top-level block whose text starts with `text`. */
const blockAt = (text: string): number => {
  let at = -1;
  editor.state.doc.forEach((node, offset) => {
    if (at < 0 && node.textContent.startsWith(text)) at = offset;
  });
  if (at < 0) throw new Error(`no block starting "${text}"`);
  return at;
};

describe('the block handle (Jenni build plan R7)', () => {
  it('finds the top-level block around a position, inside lists too', () => {
    editor = createTestEditor('<p>Alpha</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    const list = blockAt('One');
    const block = topLevelBlock(editor.state.doc, list + 6);
    expect(block?.pos).toBe(list);
    expect(block?.node.type.name).toBe('bulletList');
    expect(blockTextAt(editor.state.doc, list + 6)).toBe('One\nTwo');
  });

  it('duplicates a block directly below it, and deletes one', () => {
    editor = createTestEditor('<h1>Chapter 1</h1><p>Alpha</p><p>Beta</p>');
    expect(editor.commands.duplicateBlock(blockAt('Alpha'))).toBe(true);
    expect(blocks()).toEqual([
      'h1:Chapter 1',
      'paragraph:Alpha',
      'paragraph:Alpha',
      'paragraph:Beta',
    ]);
    expect(editor.commands.deleteBlock(blockAt('Beta'))).toBe(true);
    expect(blocks()).toEqual(['h1:Chapter 1', 'paragraph:Alpha', 'paragraph:Alpha']);
  });

  it('never acts on the chapter title, and never leaves a bare title', () => {
    editor = createTestEditor('<h1>Chapter 1</h1><p>Alpha</p>');
    expect(editor.commands.deleteBlock(0)).toBe(false);
    expect(editor.commands.duplicateBlock(0)).toBe(false);
    expect(editor.commands.turnBlockInto(0, 'paragraph')).toBe(false);
    expect(editor.commands.deleteBlock(blockAt('Alpha'))).toBe(true);
    expect(blocks()).toEqual(['h1:Chapter 1', 'paragraph:']);
  });

  it('turns a paragraph into each kind and back', () => {
    editor = createTestEditor('<p>Alpha</p><p>Beta</p>');
    editor.commands.turnBlockInto(blockAt('Alpha'), 'heading');
    expect(blocks()[0]).toBe('h2:Alpha');
    editor.commands.turnBlockInto(blockAt('Alpha'), 'subheading');
    expect(blocks()[0]).toBe('h3:Alpha');
    editor.commands.turnBlockInto(blockAt('Alpha'), 'quote');
    expect(blocks()[0]).toBe('blockquote:Alpha');
    editor.commands.turnBlockInto(blockAt('Alpha'), 'bulletList');
    expect(blocks()[0]).toBe('bulletList:Alpha');
    editor.commands.turnBlockInto(blockAt('Alpha'), 'orderedList');
    expect(blocks()[0]).toBe('orderedList:Alpha');
    editor.commands.turnBlockInto(blockAt('Alpha'), 'code');
    expect(blocks()[0]).toBe('codeBlock:Alpha');
    editor.commands.turnBlockInto(blockAt('Alpha'), 'paragraph');
    expect(blocks()).toEqual(['paragraph:Alpha', 'paragraph:Beta']);
  });

  it('turns every item of a list into a paragraph', () => {
    editor = createTestEditor('<ul><li><p>One</p></li><li><p>Two</p></li></ul><p>After</p>');
    editor.commands.turnBlockInto(blockAt('One'), 'paragraph');
    expect(blocks()).toEqual(['paragraph:One', 'paragraph:Two', 'paragraph:After']);
  });

  it('highlights a whole block, and clears it', () => {
    editor = createTestEditor('<p>Alpha</p>');
    expect(editor.commands.setBlockHighlight(0, 'amber')).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.highlight).toBe('amber');
    expect(editor.getHTML()).toContain('data-highlight="amber"');
    editor.commands.setBlockHighlight(0, null);
    expect(editor.state.doc.firstChild?.attrs.highlight).toBeNull();
    // It survives a save and a reload (the stored JSON).
    editor.commands.setBlockHighlight(0, 'green');
    const json = editor.getJSON();
    editor.destroy();
    editor = createTestEditor(json);
    expect(editor.state.doc.firstChild?.attrs.highlight).toBe('green');
  });

  it('selects the whole block for the selection toolbar', () => {
    editor = createTestEditor('<p>Alpha beta gamma</p><p>Delta</p>');
    editor.commands.selectBlock(blockAt('Alpha'));
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('Alpha beta gamma');
  });

  it('puts a new empty line below a block with the caret in it', () => {
    editor = createTestEditor('<p>Alpha</p><p>Beta</p>');
    editor.commands.insertBlockBelow(blockAt('Alpha'));
    expect(blocks()).toEqual(['paragraph:Alpha', 'paragraph:', 'paragraph:Beta']);
    expect(editor.state.selection.$from.parent.textContent).toBe('');
    expect(editor.state.selection.$from.index(0)).toBe(1);
  });

  it('places a citation before the closing full stop', () => {
    editor = createTestEditor('<p>Costs fell.</p><p>No stop</p>');
    const first = blockAt('Costs');
    expect(citeSlot(editor.state.doc, first)).toBe(first + 1 + 'Costs fell'.length);
    const second = blockAt('No stop');
    expect(citeSlot(editor.state.doc, second)).toBe(second + 1 + 'No stop'.length);
  });

  it('marks the block the menu is open on, and follows it through edits', () => {
    editor = createTestEditor('<p>Alpha</p><p>Beta</p>');
    editor.commands.setActiveBlock(blockAt('Beta'));
    expect(blockHandleKey.getState(editor.state)?.active).toBe(blockAt('Beta'));
    editor.commands.insertContentAt(0, '<p>New</p>');
    expect(blockHandleKey.getState(editor.state)?.active).toBe(blockAt('Beta'));
    editor.commands.setActiveBlock(null);
    expect(blockHandleKey.getState(editor.state)?.active).toBeNull();
  });

  it('the grip asks the app for the menu, reading the handler when pressed', () => {
    editor = createTestEditor('<h1>Chapter 1</h1><p>Alpha</p>');
    const onMenu = vi.fn();
    // Set after the editor exists, as the app does.
    (editor.storage.blockHandle as { onMenu: unknown }).onMenu = onMenu;
    const handle = editor.view.dom.parentElement?.querySelector('[data-testid=block-handle]');
    expect(handle).not.toBeNull();
    // jsdom has no layout, so the handle is placed on a block directly, as a mouse move would.
    const paragraph = editor.view.nodeDOM(blockAt('Alpha')) as HTMLElement;
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({
      pos: blockAt('Alpha') + 1,
      inside: blockAt('Alpha'),
    });
    editor.view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    expect(paragraph).toBeTruthy();
    (handle as Element)
      .querySelector<HTMLButtonElement>('[data-testid=block-handle-grip]')
      ?.click();
    expect(onMenu).toHaveBeenCalledWith(expect.objectContaining({ pos: blockAt('Alpha') }));
  });
});
