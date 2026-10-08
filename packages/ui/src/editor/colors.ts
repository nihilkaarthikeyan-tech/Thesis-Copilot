/**
 * Text colour and highlight (Jenni build plan R28, ADR-0119): two marks from the toolbar.
 *
 * Both store a palette name from `@tc/types` (`TEXT_COLORS`, `HIGHLIGHT_COLORS`), never a CSS
 * colour. TipTap's own Color and Highlight extensions write the colour inline (`style="color:
 * #b42318"`), which cannot follow the theme — the red that reads on paper is too dark on the dark
 * ground — and which a pasted web page would fill with its own colours. Here the editor's CSS draws
 * each name in the theme's shade, and every export prints the name in one colour chosen for white
 * paper. Only our own names parse, so a paste from a web page brings no colours with it.
 *
 * The block menu's paragraph highlight (ADR-0094) is a different thing: a node attribute, a
 * reading aid on screen. This highlight is on words, and it prints.
 */

import { type HighlightColor, isHighlightColor, isTextColor, type TextColor } from '@tc/types';
import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      /** Highlights the selection (or what is typed next) in `color`. */
      setHighlight: (color: HighlightColor) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
    textColor: {
      setTextColor: (color: TextColor) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

export const Highlight = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      color: {
        default: 'yellow',
        // A plain <mark> from elsewhere is the classic yellow; a colour we do not offer is too.
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-color');
          return isHighlightColor(value) ? value : 'yellow';
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-color': isHighlightColor(attributes.color) ? attributes.color : 'yellow',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { class: 'tc-hl' }), 0];
  },

  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      // Word's own shortcut has no equivalent in a browser; this is TipTap's, on yellow.
      'Mod-Shift-h': () =>
        this.editor.isActive(this.name)
          ? this.editor.commands.unsetHighlight()
          : this.editor.commands.setHighlight('yellow'),
    };
  },
});

export const TextColorMark = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-text-color');
          return isTextColor(value) ? value : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          isTextColor(attributes.color) ? { 'data-text-color': attributes.color } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-text-color]',
        // Only a name we offer: anything else is not a colour this editor draws.
        getAttrs: (element) =>
          isTextColor((element as HTMLElement).getAttribute('data-text-color')) ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'tc-ink' }), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
