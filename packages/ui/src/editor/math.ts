/**
 * Math nodes — PRD Appendix B.1: "KaTeX via mathInline / mathBlock nodes storing LaTeX source".
 * Deterministic render, exportable. The node stores only the source; KaTeX draws it in a NodeView.
 */

import { mergeAttributes, Node } from '@tiptap/core';
import katex from 'katex';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      insertMathInline: (latex: string) => ReturnType;
      insertMathBlock: (latex: string) => ReturnType;
    };
  }
}

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
    });
  } catch {
    return latex;
  }
}

function mathNodeView(displayMode: boolean) {
  return ({ node }: { node: { attrs: { latex?: string } } }) => {
    const dom = document.createElement(displayMode ? 'div' : 'span');
    dom.className = displayMode ? 'math-block' : 'math-inline';
    dom.setAttribute('contenteditable', 'false');
    const draw = (latex: string) => {
      dom.innerHTML = renderKatex(latex, displayMode);
      dom.setAttribute('data-latex', latex);
    };
    draw(String(node.attrs.latex ?? ''));
    return {
      dom,
      update(updated: { type: { name: string }; attrs: { latex?: string } }) {
        if (updated.type.name !== (displayMode ? 'mathBlock' : 'mathInline')) return false;
        draw(String(updated.attrs.latex ?? ''));
        return true;
      },
      ignoreMutation: () => true,
    };
  };
}

const latexAttribute = {
  latex: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
    renderHTML: (attrs: { latex?: string }) => ({ 'data-latex': attrs.latex ?? '' }),
  },
};

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => latexAttribute,
  parseHTML: () => [{ tag: 'span[data-math-inline]' }],
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-math-inline': '' }),
      String(node.attrs.latex),
    ];
  },
  addNodeView: () => mathNodeView(false),
  addCommands() {
    return {
      insertMathInline:
        (latex) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => latexAttribute,
  parseHTML: () => [{ tag: 'div[data-math-block]' }],
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-math-block': '' }),
      String(node.attrs.latex),
    ];
  },
  addNodeView: () => mathNodeView(true),
  addCommands() {
    return {
      insertMathBlock:
        (latex) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});
