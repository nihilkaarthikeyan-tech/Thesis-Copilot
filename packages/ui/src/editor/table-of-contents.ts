/**
 * The contents block (Jenni build plan R28, ADR-0119): "/" → Table of contents.
 *
 * A block that lists the chapter's title and every heading under it, indented by level, and keeps
 * itself up to date as the student writes. It stores nothing but its own presence — the list is
 * read from the document on every change, so it can never disagree with the headings. A click on
 * an entry goes to that heading.
 *
 * In an export it becomes a real contents list, not a copy of what the screen showed: Word's TOC
 * field in the chapter `.docx` (filled with the headings, and with page numbers once Word or the
 * PDF conversion updates it), and in the whole thesis the contents page at the front, where the
 * template puts it (`packages/export`).
 *
 * A heading inside an AI draft the student has not accepted is not listed: the draft is not part
 * of the thesis until it is accepted (flag, don't fix), and the export leaves it out too.
 */

import { type Editor, Node } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { insertBlockWithCaretAfter } from './insert-block.js';

export type TocEntry = {
  /** 1 is the chapter title. */
  level: number;
  text: string;
  /** The heading's position, for going to it. */
  pos: number;
};

/** The headings a contents block lists, in document order, outside any pending draft. */
export function tocEntries(doc: PmNode): TocEntry[] {
  const out: TocEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'draftBlock') return false;
    if (node.type.name !== 'heading') return true;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (text) out.push({ level: Number(node.attrs.level) || 2, text, pos });
    return false;
  });
  return out;
}

export type TocLabels = { title: string; empty: string; goTo: string };

export type TableOfContentsStorage = {
  /** The block's words, in the interface language: set with `setTableOfContentsLabels`. */
  labels: TocLabels;
};

const LABELS_CHANGED = 'tableOfContentsLabels';

/** Gives every contents block its words in the interface language, and redraws them. */
export function setTableOfContentsLabels(editor: Editor, labels: TocLabels): void {
  const storage = (editor.storage as Record<string, TableOfContentsStorage | undefined>)
    .tableOfContents;
  if (!storage || editor.isDestroyed) return;
  storage.labels = labels;
  editor.view.dispatch(editor.state.tr.setMeta(LABELS_CHANGED, true));
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** A contents block at the caret, with a line to write on after it. */
      insertTableOfContents: () => ReturnType;
    };
  }
}

export const TableOfContents = Node.create<Record<string, never>, TableOfContentsStorage>({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addStorage() {
    return {
      labels: {
        title: 'Contents',
        empty: 'The headings of this chapter appear here as you add them.',
        goTo: 'Go to',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML() {
    return ['div', { 'data-type': 'table-of-contents', class: 'tc-toc' }];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ tr, state, dispatch }) => {
          const node = state.schema.nodes.tableOfContents?.create();
          const paragraph = state.schema.nodes.paragraph?.create();
          if (!node || !paragraph) return false;
          if (dispatch) insertBlockWithCaretAfter(tr, node, paragraph);
          return true;
        },
    };
  },

  addNodeView() {
    return ({ editor }) => {
      const storage = () => editor.storage.tableOfContents as TableOfContentsStorage;
      const dom = document.createElement('div');
      dom.className = 'tc-toc';
      dom.setAttribute('data-type', 'table-of-contents');
      dom.setAttribute('data-testid', 'toc-block');
      dom.contentEditable = 'false';

      const title = document.createElement('p');
      title.className = 'tc-toc-title';
      const list = document.createElement('ol');
      list.className = 'tc-toc-list';
      const empty = document.createElement('p');
      empty.className = 'tc-toc-empty';
      dom.append(title, list, empty);

      let drawn = '';
      const draw = () => {
        const labels = storage().labels;
        const entries = tocEntries(editor.state.doc);
        const key = JSON.stringify([labels, entries.map((e) => [e.level, e.text])]);
        if (key === drawn) return;
        drawn = key;
        title.textContent = labels.title;
        empty.textContent = labels.empty;
        empty.hidden = entries.length > 0;
        list.replaceChildren(
          ...entries.map((entry, index) => {
            const item = document.createElement('li');
            item.className = 'tc-toc-entry';
            item.setAttribute('data-level', String(Math.min(Math.max(entry.level, 1), 3)));
            const go = document.createElement('button');
            go.type = 'button';
            go.textContent = entry.text;
            go.title = `${labels.goTo}: ${entry.text}`;
            go.setAttribute('data-toc-index', String(index));
            item.append(go);
            return item;
          }),
        );
      };

      // Positions move as the student types, so the entry is looked up again when it is pressed.
      const onClick = (event: MouseEvent) => {
        const target = (event.target as HTMLElement | null)?.closest('button[data-toc-index]');
        if (!target) return;
        event.preventDefault();
        const entry = tocEntries(editor.state.doc)[Number(target.getAttribute('data-toc-index'))];
        if (!entry) return;
        editor
          .chain()
          .focus()
          .setTextSelection(entry.pos + 1)
          .scrollIntoView()
          .run();
      };
      dom.addEventListener('click', onClick);

      const onTransaction = ({ transaction }: { transaction: Transaction }) => {
        if (transaction.docChanged || transaction.getMeta(LABELS_CHANGED)) draw();
      };
      editor.on('transaction', onTransaction);
      draw();

      return {
        dom,
        // The list is ours: ProseMirror must neither read it back nor select the block on a click.
        ignoreMutation: () => true,
        stopEvent: (event: Event) =>
          event.target instanceof HTMLElement && Boolean(event.target.closest('button')),
        update: (node: PmNode) => {
          if (node.type.name !== 'tableOfContents') return false;
          draw();
          return true;
        },
        destroy: () => {
          editor.off('transaction', onTransaction);
          dom.removeEventListener('click', onClick);
        },
      };
    };
  },
});
