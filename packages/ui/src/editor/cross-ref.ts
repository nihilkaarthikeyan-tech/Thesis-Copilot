/**
 * The `crossRef` node — a reference that renumbers itself (2026-09-21).
 *
 * "As Figure 3.2 shows" typed by hand is wrong the moment a figure is inserted above it, and a
 * thesis is full of them. This node stores **which** figure it points at and never the number;
 * the number is derived from document order on every render, by the same `numberTargets` the
 * `.docx` exporter uses (`@tc/types/cross-ref`), so the screen and the submitted file cannot
 * disagree.
 *
 * It is an atom: a reference is one indivisible thing. A student can delete it but not edit half
 * of it into "Figure 3.z", which is the state a plain-text reference is always one keystroke away
 * from.
 *
 * A reference whose target has been deleted renders as a visible gap, not a plausible number.
 * That is the whole argument for the feature — a wrong number is the one that survives to the
 * examiner, because nobody proofreads numbers that look fine.
 */

import { formatRef, numberingMap, type RefKind } from '@tc/types';
import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    crossRef: {
      /** Insert a reference to a figure or table already in this chapter. */
      insertCrossRef: (input: { refId: string; kind: RefKind }) => ReturnType;
    };
  }
}

export type CrossRefOptions = {
  /**
   * The chapter's own number, for the `3.2` half of "Figure 3.2".
   *
   * Supplied by the editor because a chapter does not know its position in the thesis; the
   * document does. Defaults to 1 so a standalone editor still renders something sensible.
   */
  chapterNumber: number;
};

export const CrossRef = Node.create<CrossRefOptions>({
  name: 'crossRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { chapterNumber: 1 };
  },

  addAttributes() {
    return {
      refId: { default: null },
      kind: { default: 'figure' as RefKind },
    };
  },

  parseHTML: () => [{ tag: 'span[data-cross-ref]' }],

  renderHTML({ HTMLAttributes, node }) {
    // Serialised form keeps the pointer, not the label: the label is a view of the document and
    // storing it would be storing something that goes stale.
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-cross-ref': '',
        'data-kind': String(node.attrs.kind ?? 'figure'),
      }),
      '',
    ];
  },

  addNodeView() {
    return ({ node, editor, HTMLAttributes }) => {
      const dom = document.createElement('span');
      dom.className = 'cross-ref';
      for (const [key, value] of Object.entries(
        mergeAttributes(HTMLAttributes, { 'data-cross-ref': '' }),
      )) {
        if (typeof value === 'string') dom.setAttribute(key, value);
      }

      const paint = () => {
        const kind = (node.attrs.kind as RefKind) ?? 'figure';
        const refId = typeof node.attrs.refId === 'string' ? node.attrs.refId : '';
        // Numbering is recomputed from the live document, so an insertion anywhere above this
        // reference is reflected the moment the transaction lands.
        const targets = numberingMap(editor.getJSON());
        const target = targets.get(refId);
        dom.textContent = formatRef(target, this.options.chapterNumber, kind);
        dom.classList.toggle('cross-ref--broken', !target);
        dom.title = target
          ? 'Numbered automatically — it follows the figure, not the text you typed.'
          : 'The figure or table this pointed at has been deleted.';
      };

      paint();
      // Any transaction can move a figure, so any transaction can change this number.
      const onUpdate = () => paint();
      editor.on('transaction', onUpdate);

      return {
        dom,
        // An atom has no editable interior; ignoring mutations stops ProseMirror trying to parse
        // the text this view writes back into document content.
        ignoreMutation: () => true,
        update: (updated) => updated.type.name === this.name,
        destroy: () => editor.off('transaction', onUpdate),
      };
    };
  },

  addCommands() {
    return {
      insertCrossRef:
        ({ refId, kind }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { refId, kind } }),
    };
  },
});
