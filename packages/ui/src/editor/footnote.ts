/**
 * Footnotes (2026-09-25).
 *
 * An inline atom holding its own text. The editor shows a superscript number; the number is a
 * CSS counter in document order (`editor.css`), so inserting a note before another renumbers every
 * later one with no code at all. The exporters turn each into a real footnote: a Word footnote in
 * the `.docx` and PDF, `\footnote` in LaTeX, a numbered note in the web page.
 *
 * Plain text, deliberately. A footnote in a thesis is a sentence or two of aside; a citation
 * inside one would need the whole citation machinery inside an attribute, and a note-style
 * citation (the humanities' footnoted references) is a different thing, handled where citations
 * are rendered.
 */

import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** Inserts a footnote with `text` at the caret. */
      insertFootnote: (text: string) => ReturnType;
      /** Changes the text of the selected footnote. */
      setFootnoteText: (text: string) => ReturnType;
    };
  }
}

export const FOOTNOTE_MAX = 2_000;

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-footnote') ?? '',
        renderHTML: (attrs) => ({ 'data-footnote': String(attrs.text ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        class: 'footnote-ref',
        // The note itself on hover, and to a screen reader.
        title: String(node.attrs.text ?? ''),
        'aria-label': `Footnote: ${String(node.attrs.text ?? '')}`,
      }),
    ];
  },

  renderText({ node }) {
    // Copying a passage keeps the note, in brackets, rather than losing it.
    return ` [${String(node.attrs.text ?? '')}]`;
  },

  addCommands() {
    return {
      insertFootnote:
        (text) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { text: text.slice(0, FOOTNOTE_MAX) },
          }),
      setFootnoteText:
        (text) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { text: text.slice(0, FOOTNOTE_MAX) }),
    };
  },
});
