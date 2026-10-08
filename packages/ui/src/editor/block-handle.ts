/**
 * The block handle (Jenni build plan R7, inventory §13.3): beside the paragraph under the mouse,
 * a "+" that opens the "/" menu on a new line below it, and a grip that opens the block menu
 * (Turn into, Cite, Highlight, Ask in chat, Edit, Review, Duplicate, Delete) and drags the block
 * to another place.
 *
 * This file is the editor half: the handle's position, the drag, the block the menu is open on
 * (drawn with a faint background), and the commands the menu runs. What the menu *shows* and the
 * actions that call the API belong to the app, which sets `editor.storage.blockHandle.onMenu` —
 * read when the grip is pressed, never captured when the editor is built (a TipTap extension keeps
 * the options it was built with; see CLAUDE.md).
 *
 * The chapter title (a level-1 heading) has no handle: it is never moved, deleted or turned into
 * anything else, as with `move-block.ts`. Nothing here calls a model.
 */

import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  type Selection,
  TextSelection,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export const BLOCK_HIGHLIGHTS = ['amber', 'green', 'blue'] as const;
export type BlockHighlight = (typeof BLOCK_HIGHLIGHTS)[number];

export type TurnInto =
  | 'paragraph'
  | 'heading'
  | 'subheading'
  | 'bulletList'
  | 'orderedList'
  | 'quote'
  | 'code';

/** What the grip reports: the block's start position and where to draw the menu. */
export type BlockMenuRequest = { pos: number; rect: DOMRect };

export type BlockHandleStorage = {
  /** Set by the app; without it the grip does nothing but drag. */
  onMenu: ((request: BlockMenuRequest) => void) | null;
};

export const blockHandleKey = new PluginKey<{ active: number | null }>('blockHandle');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockHandle: {
      /** Marks the block at `pos` as the one the menu is open on (null: none). */
      setActiveBlock: (pos: number | null) => ReturnType;
      /** Selects the text of the block at `pos`, so the selection toolbar acts on it. */
      selectBlock: (pos: number) => ReturnType;
      duplicateBlock: (pos: number) => ReturnType;
      deleteBlock: (pos: number) => ReturnType;
      setBlockHighlight: (pos: number, color: BlockHighlight | null) => ReturnType;
      turnBlockInto: (pos: number, kind: TurnInto) => ReturnType;
      /** A new empty paragraph after the block at `pos`, with the caret in it. */
      insertBlockBelow: (pos: number) => ReturnType;
    };
  }
}

const isTitle = (node: PmNode | null | undefined): boolean =>
  node?.type.name === 'heading' && node.attrs.level === 1;

/** The top-level block at `pos` (its start position and node), or null. */
export function topLevelBlock(doc: PmNode, pos: number): { pos: number; node: PmNode } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  if ($pos.depth === 0) {
    const node = doc.nodeAt(pos);
    return node ? { pos, node } : null;
  }
  const start = $pos.before(1);
  const node = doc.nodeAt(start);
  return node ? { pos: start, node } : null;
}

/**
 * The whole top-level block at `pos`, start to end: the range a check of one paragraph reads
 * (R26). Positions are the saved chapter's too, so the API can take them as they are.
 */
export function blockRange(doc: PmNode, pos: number): { from: number; to: number } | null {
  const block = topLevelBlock(doc, pos);
  return block ? { from: block.pos, to: block.pos + block.node.nodeSize } : null;
}

/** The block's plain text, for "Ask in chat". */
export function blockTextAt(doc: PmNode, pos: number): string {
  const block = topLevelBlock(doc, pos);
  if (!block) return '';
  return doc.textBetween(block.pos, block.pos + block.node.nodeSize, '\n', ' ').trim();
}

/** A text selection over the whole block: every paragraph of a list or a quote, too. */
function wholeBlock(doc: PmNode, from: number, to: number): Selection {
  return TextSelection.between(doc.resolve(from + 1), doc.resolve(Math.max(from + 1, to - 1)));
}

/** Where a block's text ends: before a closing full stop, so "@" lands before it. */
export function citeSlot(doc: PmNode, pos: number): number | null {
  const block = topLevelBlock(doc, pos);
  if (!block?.node.isTextblock || block.node.content.size === 0) return null;
  const end = block.pos + block.node.nodeSize - 1;
  const text = block.node.textContent;
  return /[.!?]$/.test(text) && block.node.lastChild?.isText ? end - 1 : end;
}

/**
 * The commands a command receives see `state.selection` as it was until `state.tr` is read again
 * (TipTap's chainable state), so every selection change here goes through `state.tr`.
 */
function turnInto(
  state: EditorState,
  pos: number,
  kind: TurnInto,
  run: (name: string, attrs?: Record<string, unknown>) => boolean,
): boolean {
  const block = topLevelBlock(state.doc, pos);
  if (!block || isTitle(block.node)) return false;
  const name = block.node.type.name;
  const end = block.pos + block.node.nodeSize;
  state.tr.setSelection(wholeBlock(state.tr.doc, block.pos, end));
  void state.tr; // reading it again is what makes the toggles see the new selection
  // First back to plain paragraphs, then into the new kind: the toggles only ever see text.
  if (name === 'bulletList') run('toggleBulletList');
  else if (name === 'orderedList') run('toggleOrderedList');
  else if (name === 'blockquote') run('toggleBlockquote');
  else if (name !== 'paragraph') run('setParagraph');
  if (kind === 'paragraph') return true;
  const tr = state.tr;
  tr.setSelection(wholeBlock(tr.doc, block.pos, tr.mapping.map(end, -1)));
  void state.tr; // as above
  switch (kind) {
    case 'heading':
      return run('setHeading', { level: 2 });
    case 'subheading':
      return run('setHeading', { level: 3 });
    case 'bulletList':
      return run('toggleBulletList');
    case 'orderedList':
      return run('toggleOrderedList');
    case 'quote':
      return run('toggleBlockquote');
    case 'code':
      return run('setCodeBlock');
  }
}

class HandleView {
  private readonly root: HTMLDivElement;
  private readonly grip: HTMLButtonElement;
  private current: { pos: number; dom: HTMLElement } | null = null;
  private bound: HTMLElement | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly storage: () => BlockHandleStorage,
    private readonly onInsert: (pos: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'tc-block-handle';
    this.root.setAttribute('data-testid', 'block-handle');
    this.root.style.display = 'none';

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'tc-block-handle-plus';
    plus.textContent = '+';
    plus.title = 'Add a block below';
    plus.setAttribute('aria-label', 'Add a block below');
    plus.setAttribute('data-testid', 'block-handle-plus');
    plus.addEventListener('mousedown', (e) => e.preventDefault());
    plus.addEventListener('click', () => {
      if (this.current) this.onInsert(this.current.pos);
    });

    this.grip = document.createElement('button');
    this.grip.type = 'button';
    this.grip.className = 'tc-block-handle-grip';
    this.grip.textContent = '⋮⋮';
    this.grip.title = 'Drag to move, click for the block menu';
    this.grip.setAttribute('aria-label', 'Block menu');
    this.grip.setAttribute('data-testid', 'block-handle-grip');
    this.grip.draggable = true;
    this.grip.addEventListener('mousedown', (e) => e.stopPropagation());
    this.grip.addEventListener('click', () => {
      if (!this.current) return;
      this.storage().onMenu?.({ pos: this.current.pos, rect: this.grip.getBoundingClientRect() });
    });
    this.grip.addEventListener('dragstart', this.onDragStart);

    this.root.append(plus, this.grip);
    view.dom.parentElement?.appendChild(this.root);
    view.dom.addEventListener('mousemove', this.onMove);
  }

  /**
   * The element the handle is placed in. TipTap's React view moves the editor (and the handle with
   * it) into its own element after this plugin starts, so the container is checked on every show.
   */
  private container(): HTMLElement | null {
    const parent = this.view.dom.parentElement;
    if (!parent) return null;
    if (this.root.parentElement !== parent) parent.appendChild(this.root);
    if (this.bound !== parent) {
      this.bound?.removeEventListener('mouseleave', this.onLeave);
      parent.addEventListener('mouseleave', this.onLeave);
      this.bound = parent;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    }
    return parent;
  }

  private readonly onMove = (event: MouseEvent) => {
    // No mouse to bring it up on a phone: the "/" menu and the selection toolbar do the same there.
    if (!this.view.editable || window.matchMedia?.('(hover: none)').matches) return;
    const at = this.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!at) return;
    const block = topLevelBlock(this.view.state.doc, at.inside >= 0 ? at.inside : at.pos);
    if (!block || isTitle(block.node)) {
      this.hide();
      return;
    }
    const dom = this.view.nodeDOM(block.pos);
    if (!(dom instanceof HTMLElement)) return;
    this.show(block.pos, dom);
  };

  private readonly onLeave = (event: MouseEvent) => {
    if (event.relatedTarget instanceof Node && this.root.contains(event.relatedTarget)) return;
    this.hide();
  };

  private readonly onDragStart = (event: DragEvent) => {
    if (!this.current || !event.dataTransfer) return;
    const { state } = this.view;
    const selection = NodeSelection.create(state.doc, this.current.pos);
    this.view.dispatch(state.tr.setSelection(selection));
    const slice = selection.content();
    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/plain', blockTextAt(state.doc, this.current.pos));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(this.current.dom, 0, 0);
    // ProseMirror's own drop handling moves `slice` when `move` is set, as for a dragged selection.
    this.view.dragging = { slice, move: true };
  };

  private show(pos: number, dom: HTMLElement) {
    const parent = this.container();
    if (!parent) return;
    this.current = { pos, dom };
    const box = dom.getBoundingClientRect();
    const outer = parent.getBoundingClientRect();
    const line = Number.parseFloat(getComputedStyle(dom).lineHeight) || 24;
    this.root.style.display = 'flex';
    this.root.style.top = `${box.top - outer.top + Math.max(0, (line - 24) / 2)}px`;
    this.root.style.left = `${box.left - outer.left - 52}px`;
  }

  private hide() {
    this.current = null;
    this.root.style.display = 'none';
  }

  update(view: EditorView) {
    // A block that moved or went away: the next mouse move places the handle again.
    if (this.current && !view.dom.contains(this.current.dom)) this.hide();
  }

  destroy() {
    this.view.dom.removeEventListener('mousemove', this.onMove);
    this.bound?.removeEventListener('mouseleave', this.onLeave);
    this.grip.removeEventListener('dragstart', this.onDragStart);
    this.root.remove();
  }
}

export const BlockHandle = Extension.create<Record<string, never>, BlockHandleStorage>({
  name: 'blockHandle',

  addStorage() {
    return { onMenu: null };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList'],
        attributes: {
          highlight: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute('data-highlight');
              return (BLOCK_HIGHLIGHTS as readonly string[]).includes(value ?? '') ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.highlight ? { 'data-highlight': attributes.highlight } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setActiveBlock:
        (pos) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(blockHandleKey, { active: pos });
          return true;
        },
      selectBlock:
        (pos) =>
        ({ tr, dispatch }) => {
          const block = topLevelBlock(tr.doc, pos);
          if (!block) return false;
          if (dispatch)
            tr.setSelection(wholeBlock(tr.doc, block.pos, block.pos + block.node.nodeSize));
          return true;
        },
      duplicateBlock:
        (pos) =>
        ({ tr, dispatch }) => {
          const block = topLevelBlock(tr.doc, pos);
          if (!block || isTitle(block.node)) return false;
          if (dispatch)
            tr.insert(block.pos + block.node.nodeSize, block.node.copy(block.node.content));
          return true;
        },
      deleteBlock:
        (pos) =>
        ({ tr, dispatch, state }) => {
          const block = topLevelBlock(tr.doc, pos);
          if (!block || isTitle(block.node)) return false;
          if (dispatch) {
            tr.delete(block.pos, block.pos + block.node.nodeSize);
            // A chapter is never left as a bare title: a line to write on stays.
            if (tr.doc.childCount === 1 && isTitle(tr.doc.firstChild)) {
              const paragraph = state.schema.nodes.paragraph?.create();
              if (paragraph) tr.insert(tr.doc.content.size, paragraph);
            }
          }
          return true;
        },
      setBlockHighlight:
        (pos, color) =>
        ({ tr, dispatch }) => {
          const block = topLevelBlock(tr.doc, pos);
          if (!block || isTitle(block.node) || !('highlight' in block.node.attrs)) return false;
          if (dispatch)
            tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, highlight: color });
          return true;
        },
      turnBlockInto:
        (pos, kind) =>
        ({ state, dispatch, commands }) => {
          if (!dispatch) return topLevelBlock(state.doc, pos) !== null;
          return turnInto(state, pos, kind, (name, attrs) => {
            const command = (commands as unknown as Record<string, (a?: unknown) => boolean>)[name];
            return command ? command(attrs) : false;
          });
        },
      insertBlockBelow:
        (pos) =>
        ({ tr, state, dispatch }) => {
          const block = topLevelBlock(tr.doc, pos);
          const paragraph = state.schema.nodes.paragraph?.create();
          if (!block || !paragraph) return false;
          if (dispatch) {
            const at = block.pos + block.node.nodeSize;
            tr.insert(at, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, at + 1));
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<{ active: number | null }>({
        key: blockHandleKey,
        state: {
          init: () => ({ active: null }),
          apply(tr, value) {
            const meta = tr.getMeta(blockHandleKey) as { active: number | null } | undefined;
            if (meta) return { active: meta.active };
            if (value.active === null || !tr.docChanged) return value;
            const mapped = tr.mapping.mapResult(value.active, 1);
            return { active: mapped.deleted ? null : mapped.pos };
          },
        },
        props: {
          decorations(state) {
            const active = blockHandleKey.getState(state)?.active;
            if (active === null || active === undefined) return null;
            const node = state.doc.nodeAt(active);
            if (!node) return null;
            return DecorationSet.create(state.doc, [
              Decoration.node(active, active + node.nodeSize, { class: 'tc-block-active' }),
            ]);
          },
        },
        view: (view) =>
          new HandleView(
            view,
            () => editor.storage.blockHandle as BlockHandleStorage,
            (pos) => {
              // "+" is the "/" menu on a new line: the slash opens it, and the menu removes it.
              editor.chain().focus().insertBlockBelow(pos).insertContent('/').run();
            },
          ),
      }),
    ];
  },
});
