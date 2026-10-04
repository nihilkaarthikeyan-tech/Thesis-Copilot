import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachSlashMenu,
  filterSlashItems,
  getSlashMenuState,
  SLASH_ITEMS,
  slashTrigger,
} from '../src/editor/slash-menu.js';
import { createTestEditor, pressKey } from './helpers.js';

describe('slashTrigger', () => {
  it('opens on "/" at the start of a paragraph or after a space', () => {
    expect(slashTrigger('/')).toEqual({ query: '', length: 1 });
    expect(slashTrigger('/tab')).toEqual({ query: 'tab', length: 4 });
    expect(slashTrigger('Some text /eq')).toEqual({ query: 'eq', length: 3 });
  });

  it('stays shut for a slash that is part of the writing', () => {
    expect(slashTrigger('and/or')).toBeNull();
    expect(slashTrigger('1 / 2')).toBeNull();
    expect(slashTrigger('see http://')).toBeNull();
    expect(slashTrigger('/two words')).toBeNull();
    expect(slashTrigger(`/${'a'.repeat(33)}`)).toBeNull();
    // "/" typed in front of a word, and after an atom such as a citation.
    expect(slashTrigger('/', 'word')).toBeNull();
    expect(slashTrigger('￼/')).toBeNull();
    expect(slashTrigger('/', ' rest')).toEqual({ query: '', length: 1 });
  });
});

describe('filterSlashItems', () => {
  it('shows everything, in order, for an empty query', () => {
    expect(filterSlashItems(SLASH_ITEMS, '').map((i) => i.id)).toEqual(
      SLASH_ITEMS.map((i) => i.id),
    );
  });

  it('ranks a title match before a keyword match, case-insensitively', () => {
    const ids = filterSlashItems(SLASH_ITEMS, 'EQ').map((i) => i.id);
    expect(ids).toEqual(['mathInline', 'mathBlock']);
    expect(filterSlashItems(SLASH_ITEMS, 'h2').map((i) => i.id)).toEqual(['heading']);
    expect(filterSlashItems(SLASH_ITEMS, 'latex').map((i) => i.id)).toEqual([
      'mathInline',
      'mathBlock',
    ]);
    // A word inside the title: "list" finds both lists.
    expect(filterSlashItems(SLASH_ITEMS, 'list').map((i) => i.id)).toEqual([
      'bulletList',
      'orderedList',
    ]);
  });

  it('returns nothing for a query nothing matches', () => {
    expect(filterSlashItems(SLASH_ITEMS, 'zzz')).toEqual([]);
  });
});

describe('the menu in the editor', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  const type = (text: string) => {
    for (const ch of text) editor.commands.insertContent(ch);
  };

  it('is inert until an app attaches a handler', () => {
    editor = createTestEditor('<p></p>');
    editor.commands.focus('end');
    type('/');
    expect(getSlashMenuState(editor.state).active).toBe(false);
    expect(pressKey(editor, 'Escape')).toBe(false);
    expect(editor.getText()).toBe('/');
  });

  it('filters, moves, and on Enter removes "/query" and hands over the item', () => {
    editor = createTestEditor('<p></p>');
    const chosen: string[] = [];
    attachSlashMenu(editor, SLASH_ITEMS, (id) => chosen.push(id));
    editor.commands.focus('end');
    type('/');
    expect(getSlashMenuState(editor.state)).toMatchObject({ active: true, query: '', index: 0 });
    type('eq');
    const menu = getSlashMenuState(editor.state);
    expect(menu.active && menu.items.map((i) => i.id)).toEqual(['mathInline', 'mathBlock']);

    expect(pressKey(editor, 'ArrowDown')).toBe(true);
    expect(getSlashMenuState(editor.state)).toMatchObject({ index: 1 });
    pressKey(editor, 'ArrowDown');
    expect(getSlashMenuState(editor.state)).toMatchObject({ index: 0 }); // wraps
    pressKey(editor, 'ArrowUp');
    expect(getSlashMenuState(editor.state)).toMatchObject({ index: 1 });

    expect(pressKey(editor, 'Enter')).toBe(true);
    expect(chosen).toEqual(['mathBlock']);
    expect(editor.getText()).toBe('');
    expect(editor.getText()).not.toContain('/');
    expect(getSlashMenuState(editor.state).active).toBe(false);
  });

  it('leaves the text before the slash alone', () => {
    editor = createTestEditor('<p>Results</p>');
    const chosen: string[] = [];
    attachSlashMenu(editor, SLASH_ITEMS, (id) => chosen.push(id));
    editor.commands.focus('end');
    type(' /cit');
    pressKey(editor, 'Enter');
    expect(chosen).toEqual(['citationNeeded']);
    expect(editor.getText()).toBe('Results ');
  });

  it('Esc removes "/query" and inserts nothing', () => {
    editor = createTestEditor('<p></p>');
    const chosen: string[] = [];
    attachSlashMenu(editor, SLASH_ITEMS, (id) => chosen.push(id));
    editor.commands.focus('end');
    type('/tab');
    expect(pressKey(editor, 'Escape')).toBe(true);
    expect(chosen).toEqual([]);
    expect(editor.getText()).toBe('');
  });

  it('closes, and lets Enter through, once the query matches nothing', () => {
    editor = createTestEditor('<p></p>');
    attachSlashMenu(editor, SLASH_ITEMS, () => undefined);
    editor.commands.focus('end');
    type('/zzz');
    expect(getSlashMenuState(editor.state).active).toBe(false);
    pressKey(editor, 'Enter'); // an ordinary new paragraph
    expect(editor.getText()).toContain('/zzz');
    expect(editor.state.doc.childCount).toBe(2);
  });

  it('offers only the items the app passes, and stops after detaching', () => {
    editor = createTestEditor('<p></p>');
    const detach = attachSlashMenu(
      editor,
      SLASH_ITEMS.filter((i) => i.id !== 'figure'),
      () => undefined,
    );
    editor.commands.focus('end');
    type('/fig');
    expect(getSlashMenuState(editor.state).active).toBe(false);
    detach();
    type(' /');
    expect(getSlashMenuState(editor.state).active).toBe(false);
  });

  it('does not open inside a heading', () => {
    editor = createTestEditor('<h2>Method</h2>');
    attachSlashMenu(editor, SLASH_ITEMS, () => undefined);
    editor.commands.focus('end');
    type(' /');
    expect(getSlashMenuState(editor.state).active).toBe(false);
  });
});
