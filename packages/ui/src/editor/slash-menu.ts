/**
 * The "/" insert menu (2026-10-04, JENNI-STUDENT-JOURNEY step 6).
 *
 * Typing "/" at the start of a paragraph, or after a space, opens a short list of blocks to
 * insert; the letters typed after it filter the list. This file is the half that lives in the
 * editor: it notices the trigger, keeps the filtered list and the highlighted row in plugin state,
 * and takes the keys (↑ ↓ Enter Tab Esc) while the menu is open. What each item *does* belongs to
 * the app — a figure needs the file picker, an equation the toolbar's field — so the app attaches
 * a handler with `attachSlashMenu` and draws the list itself, the same split as ghost text and its
 * SuggestionBar.
 *
 * The typed "/query" is always removed, whether the student chooses an item or presses Esc. A
 * competitor's menu left the "/" behind in the text after inserting; a stray slash in a submitted
 * thesis is exactly the kind of small fault an examiner notices.
 *
 * Inert until an app attaches: an editor with no menu on screen (the co-author view, a test) must
 * not swallow Enter for a list nobody can see.
 */

import { type Editor, Extension } from '@tiptap/core';
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state';

export type SlashItem = {
  id: string;
  title: string;
  /** One line under the title. */
  hint?: string;
  /** Other words a student might type for it ("h2", "bullet", "latex"). */
  keywords?: readonly string[];
};

/** Everything the menu can offer. The app drops what this chapter cannot take (a figure, say). */
export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: 'heading',
    title: 'Heading',
    hint: 'A section heading',
    keywords: ['h2', 'title', 'section'],
  },
  {
    id: 'subheading',
    title: 'Subheading',
    hint: 'A heading inside a section',
    keywords: ['h3', 'subsection'],
  },
  { id: 'bulletList', title: 'Bulleted list', keywords: ['bullet', 'unordered', 'ul', 'points'] },
  { id: 'orderedList', title: 'Numbered list', keywords: ['ordered', 'ol', 'numbers', '1.'] },
  { id: 'quote', title: 'Quote', hint: 'An indented quotation', keywords: ['blockquote'] },
  {
    id: 'horizontalRule',
    title: 'Horizontal rule',
    hint: 'A line across the page',
    keywords: ['hr', 'divider', 'separator', 'line', '---'],
  },
  { id: 'table', title: 'Table', hint: 'Three by three, with a header row', keywords: ['grid'] },
  {
    id: 'tableOfContents',
    title: 'Table of contents',
    hint: 'This chapter’s headings, kept up to date',
    keywords: ['toc', 'contents', 'outline', 'index'],
  },
  {
    id: 'mathInline',
    title: 'Equation',
    hint: 'In the line of text',
    keywords: ['math', 'latex', 'formula', 'inline'],
  },
  {
    id: 'mathBlock',
    title: 'Display equation',
    hint: 'On a line of its own',
    keywords: ['math', 'latex', 'formula', 'block'],
  },
  { id: 'footnote', title: 'Footnote', keywords: ['note'] },
  {
    id: 'figure',
    title: 'Figure',
    hint: 'A picture from your computer',
    keywords: ['image', 'picture', 'photo', 'upload'],
  },
  {
    id: 'chart',
    title: 'Chart',
    hint: 'Drawn from your numbers',
    keywords: ['graph', 'plot', 'bar'],
  },
  {
    id: 'diagram',
    title: 'Diagram',
    hint: 'Boxes and arrows from your steps',
    keywords: ['flowchart', 'flow', 'framework'],
  },
  {
    id: 'aiDeclaration',
    title: 'AI declaration',
    hint: 'A statement of how AI was used, to edit',
    keywords: ['declaration', 'disclosure', 'statement', 'ai'],
  },
  {
    id: 'citationNeeded',
    title: 'Citation needed',
    hint: 'A marker to come back to',
    keywords: ['placeholder', 'cite', 'todo', 'source'],
  },
];

/** The longest query the menu waits through before deciding the "/" was just a slash. */
const MAX_QUERY = 32;

/**
 * Whether the text around the caret opens the menu, and with what query.
 *
 * Opens on "/" at the start of the paragraph or after whitespace, followed by up to 32 characters
 * that are neither whitespace nor another "/" — so "and/or", "1 / 2" and "http://" never open it.
 * The caret must be at the end of the paragraph or before a space: "/" typed in front of a word
 * is the start of "/word", not a command.
 */
export function slashTrigger(
  textBefore: string,
  textAfter = '',
): { query: string; length: number } | null {
  if (textAfter !== '' && !/^\s/.test(textAfter)) return null;
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore);
  if (!match) return null;
  const query = match[1] ?? '';
  if (query.length > MAX_QUERY) return null;
  return { query, length: query.length + 1 };
}

/**
 * The items a query matches, best first: the title starts with it, then a word of the title, then
 * a keyword, then anywhere in the title. Ties keep the menu's own order, so an empty query shows
 * the list as written.
 */
export function filterSlashItems<T extends SlashItem>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const rank = (item: T): number => {
    const title = item.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.split(/\s+/).some((word) => word.startsWith(q))) return 1;
    const keywords = (item.keywords ?? []).map((k) => k.toLowerCase());
    if (keywords.some((k) => k.startsWith(q))) return 2;
    if (title.includes(q) || keywords.some((k) => k.includes(q))) return 3;
    return -1;
  };
  return items
    .map((item, order) => ({ item, order, rank: rank(item) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.item);
}

export type SlashMenuState =
  | { active: false }
  | {
      active: true;
      query: string;
      /** The "/query" text, which choosing or closing deletes. */
      from: number;
      to: number;
      items: SlashItem[];
      /** The highlighted row. */
      index: number;
    };

export type SlashMenuStorage = {
  items: readonly SlashItem[];
  /** Set by the app that draws the menu; null leaves the menu off. */
  onChoose: ((id: string) => void) | null;
};

type SlashMeta = { move: number } | { refresh: true };

export const slashMenuKey = new PluginKey<SlashMenuState>('slashMenu');

const CLOSED: SlashMenuState = { active: false };

function compute(
  state: EditorState,
  storage: SlashMenuStorage,
  previous: SlashMenuState,
): SlashMenuState {
  if (!storage.onChoose) return CLOSED;
  const { selection } = state;
  if (!selection.empty) return CLOSED;
  const { $from } = selection;
  if ($from.parent.type.name !== 'paragraph') return CLOSED;
  // Atoms (a citation, an equation) read as U+FFFC: not whitespace, so "/" right after one does
  // not open the menu, and nothing an atom shows as text can be mistaken for a query.
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const textAfter = $from.parent.textBetween(
    $from.parentOffset,
    $from.parent.content.size,
    undefined,
    '￼',
  );
  const trigger = slashTrigger(textBefore, textAfter);
  if (!trigger) return CLOSED;
  const items = filterSlashItems(storage.items, trigger.query);
  if (items.length === 0) return CLOSED;
  const from = $from.pos - trigger.length;
  const same = previous.active && previous.from === from && previous.query === trigger.query;
  return {
    active: true,
    query: trigger.query,
    from,
    to: $from.pos,
    items,
    index: same ? Math.min(previous.index, items.length - 1) : 0,
  };
}

/** The menu's state in `state`, closed when the extension is not installed. */
export function getSlashMenuState(state: EditorState): SlashMenuState {
  return slashMenuKey.getState(state) ?? CLOSED;
}

function storageOf(editor: Editor): SlashMenuStorage | null {
  return (editor.storage as Record<string, SlashMenuStorage | undefined>).slashMenu ?? null;
}

/**
 * Connects the app's handler, and the items it offers here. Returns the detach. The handler runs
 * after the "/query" has been deleted, with the caret where it was.
 */
export function attachSlashMenu(
  editor: Editor,
  items: readonly SlashItem[],
  onChoose: (id: string) => void,
): () => void {
  const storage = storageOf(editor);
  if (!storage) return () => undefined;
  storage.items = items;
  storage.onChoose = onChoose;
  const refresh = () => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(slashMenuKey, { refresh: true } as SlashMeta));
  };
  refresh();
  return () => {
    if (storage.onChoose === onChoose) storage.onChoose = null;
    refresh();
  };
}

/** Moves the highlight by `delta` rows, wrapping at either end. */
export function moveSlashSelection(editor: Editor, delta: number): boolean {
  if (!getSlashMenuState(editor.state).active) return false;
  editor.view.dispatch(editor.state.tr.setMeta(slashMenuKey, { move: delta } as SlashMeta));
  return true;
}

/** Deletes the typed "/query" and closes the menu, inserting nothing. */
export function closeSlashMenu(editor: Editor): boolean {
  const menu = getSlashMenuState(editor.state);
  if (!menu.active) return false;
  editor.chain().focus().deleteRange({ from: menu.from, to: menu.to }).run();
  return true;
}

/**
 * Deletes the typed "/query", then hands the chosen item (by id, or the highlighted one) to the
 * app. False when the menu is closed or the id is not on it.
 */
export function chooseSlashItem(editor: Editor, id?: string): boolean {
  const menu = getSlashMenuState(editor.state);
  if (!menu.active) return false;
  const item = id ? menu.items.find((i) => i.id === id) : menu.items[menu.index];
  const onChoose = storageOf(editor)?.onChoose;
  if (!item || !onChoose) return false;
  editor.chain().focus().deleteRange({ from: menu.from, to: menu.to }).run();
  onChoose(item.id);
  return true;
}

export type SlashMenuOptions = { items: readonly SlashItem[] };

export const SlashMenu = Extension.create<SlashMenuOptions, SlashMenuStorage>({
  name: 'slashMenu',
  // Above ghost text (1000): while the menu is open, Tab and Esc are the menu's, and Enter must
  // not reach the list or paragraph keymaps.
  priority: 1100,

  addOptions() {
    return { items: SLASH_ITEMS };
  },

  addStorage() {
    return { items: this.options.items, onChoose: null };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    const editor = this.editor;
    return [
      new Plugin<SlashMenuState>({
        key: slashMenuKey,
        state: {
          init: (_config, state) => compute(state, storage, CLOSED),
          apply(tr, previous, _old, state) {
            const meta = tr.getMeta(slashMenuKey) as SlashMeta | undefined;
            const next = compute(state, storage, previous);
            if (meta && 'move' in meta && next.active) {
              const n = next.items.length;
              return { ...next, index: (((next.index + meta.move) % n) + n) % n };
            }
            return next;
          },
        },
        props: {
          handleKeyDown(view, event) {
            const menu = slashMenuKey.getState(view.state);
            if (!menu?.active || !editor.isEditable) return false;
            if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false;
            switch (event.key) {
              case 'ArrowDown':
                return moveSlashSelection(editor, 1);
              case 'ArrowUp':
                return moveSlashSelection(editor, -1);
              case 'Enter':
              case 'Tab':
                if (event.shiftKey) return false;
                return chooseSlashItem(editor);
              case 'Escape':
                return closeSlashMenu(editor);
              default:
                return false;
            }
          },
        },
      }),
    ];
  },
});
