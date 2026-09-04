/**
 * Citation node — PRD Appendix B.5, FR-5.x.
 *
 * An inline atom whose attrs are the ONLY citation state in the document (B.2 rule). The label is
 * NOT stored: a NodeView reads `editor.storage.citations` (style + renderedMap) and re-renders when
 * a transaction carries `citationsRerender` meta, so switching APA → IEEE never touches the doc.
 *
 * Week 1 ships a placeholder renderer; `packages/citations` (citeproc) replaces it in Phase 2.
 */

import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { nanoid } from 'nanoid';

export type CitationAttrs = {
  key: string;
  sourceId: string | null;
  chunkId: string | null;
  role: 'parenthetical' | 'narrative';
  locator: string | null;
  prefix: string | null;
  suffix: string | null;
};

export type CitationStorage = {
  style: string;
  /** key → rendered label, e.g. "(Kumar et al., 2021)" or "[12]". */
  renderedMap: Record<string, string>;
  /** Sources no longer in the library: rendered red-dashed, never auto-deleted (B.5). */
  removedSourceIds: Set<string>;
  /** Placeholder metadata for the hover popover shell (title/year) until Phase 2. */
  meta: Record<string, { title?: string; year?: number }>;
};

export const CITATIONS_RERENDER = 'citationsRerender';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: Partial<CitationAttrs> & { sourceId: string | null }) => ReturnType;
      /** Swap style / labels and re-render every citation without touching the document. */
      setCitationStyle: (style: string, renderedMap: Record<string, string>) => ReturnType;
      markSourceRemoved: (sourceId: string) => ReturnType;
    };
  }
}

export function newCitationKey(): string {
  return `c_${nanoid(10)}`;
}

function labelFor(node: PmNode, storage: CitationStorage): string {
  const key = String(node.attrs.key);
  const rendered = storage.renderedMap[key];
  if (rendered) return rendered;
  // Placeholder until citeproc lands (Phase 2 week 10): APA-ish or numeric by style family.
  return storage.style === 'ieee' ? '[?]' : '(Source, n.d.)';
}

export const Citation = Node.create<Record<string, never>, CitationStorage>({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addStorage() {
    return { style: 'apa', renderedMap: {}, removedSourceIds: new Set<string>(), meta: {} };
  },

  addAttributes() {
    return {
      key: { default: null },
      sourceId: { default: null },
      chunkId: { default: null },
      role: { default: 'parenthetical' },
      locator: { default: null },
      prefix: { default: null },
      suffix: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-citation]',
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return {
            key: e.getAttribute('data-key'),
            sourceId: e.getAttribute('data-source-id'),
            chunkId: e.getAttribute('data-chunk-id'),
            role: e.getAttribute('data-role') ?? 'parenthetical',
            locator: e.getAttribute('data-locator'),
            prefix: e.getAttribute('data-prefix'),
            suffix: e.getAttribute('data-suffix'),
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as CitationAttrs;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-citation': '',
        'data-key': a.key,
        'data-source-id': a.sourceId,
        'data-chunk-id': a.chunkId,
        'data-role': a.role,
        'data-locator': a.locator,
        'data-prefix': a.prefix,
        'data-suffix': a.suffix,
      }),
      // Copy/paste within the app carries the attrs; the label is recomputed on paste.
      `{{cite:${a.key}}}`,
    ];
  },

  addNodeView() {
    const editor = this.editor;
    const storage = this.storage;

    return ({ node }) => {
      let current = node;
      const dom = document.createElement('span');
      dom.className = 'citation';
      dom.setAttribute('data-citation', '');
      dom.setAttribute('contenteditable', 'false');

      const render = () => {
        const a = current.attrs as CitationAttrs;
        dom.setAttribute('data-key', a.key);
        dom.textContent = labelFor(current, storage);
        const removed = a.sourceId === null || storage.removedSourceIds.has(a.sourceId);
        dom.classList.toggle('citation--removed', removed);
        const meta = a.sourceId ? storage.meta[a.sourceId] : undefined;
        dom.title = removed
          ? 'Source removed — click to fix or delete'
          : [meta?.title, meta?.year].filter(Boolean).join(', ') || 'Citation';
      };
      render();

      // B.5: re-render on `citationsRerender` meta; the document itself is untouched.
      const onTransaction = ({
        transaction,
      }: {
        transaction: { getMeta: (k: string) => unknown };
      }) => {
        if (transaction.getMeta(CITATIONS_RERENDER)) render();
      };
      editor.on('transaction', onTransaction);

      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'citation') return false;
          current = updated;
          render();
          return true;
        },
        selectNode() {
          dom.classList.add('citation--selected');
        },
        deselectNode() {
          dom.classList.remove('citation--selected');
        },
        ignoreMutation() {
          return true;
        },
        destroy() {
          editor.off('transaction', onTransaction);
        },
      };
    };
  },

  addCommands() {
    return {
      insertCitation:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              key: attrs.key ?? newCitationKey(),
              sourceId: attrs.sourceId,
              chunkId: attrs.chunkId ?? null,
              role: attrs.role ?? 'parenthetical',
              locator: attrs.locator ?? null,
              prefix: attrs.prefix ?? null,
              suffix: attrs.suffix ?? null,
            },
          }),

      setCitationStyle:
        (style, renderedMap) =>
        ({ tr, dispatch }) => {
          this.storage.style = style;
          this.storage.renderedMap = renderedMap;
          if (dispatch) tr.setMeta(CITATIONS_RERENDER, true);
          return true;
        },

      markSourceRemoved:
        (sourceId) =>
        ({ tr, dispatch }) => {
          this.storage.removedSourceIds.add(sourceId);
          if (dispatch) tr.setMeta(CITATIONS_RERENDER, true);
          return true;
        },
    };
  },
});

/** Keys of every citation in document order — the numeric-style ordering input (B.5). */
export function citationKeysInOrder(doc: PmNode): string[] {
  const keys: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'citation') keys.push(String(node.attrs.key));
  });
  return keys;
}
