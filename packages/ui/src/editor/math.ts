/**
 * Math nodes — PRD Appendix B.1: "KaTeX via mathInline / mathBlock nodes storing LaTeX source".
 * Deterministic render, exportable. The node stores only the source; KaTeX draws it in a NodeView.
 */

import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import katex from 'katex';
import { insertBlockWithCaretAfter } from './insert-block.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      insertMathInline: (latex: string) => ReturnType;
      insertMathBlock: (latex: string) => ReturnType;
      /** Changes the LaTeX of the equation at `pos` in place (ADR-0045: click to edit). */
      setMathLatex: (pos: number, latex: string) => ReturnType;
    };
  }
}

/** The DOM event the NodeView raises when an equation is clicked; the app opens its editor. */
export const MATH_EDIT_EVENT = 'tc-math-edit';

export type MathEditDetail = { pos: number; latex: string; display: boolean };

/**
 * KaTeX's own message for LaTeX it cannot draw, or null when it can. The toolbar shows it
 * before inserting; the NodeView puts it in the tooltip of the red fallback.
 */
export function latexError(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true });
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message.replace(/^KaTeX parse error:\s*/, '')
      : 'Cannot read this LaTeX';
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
  return ({
    node,
    getPos,
  }: {
    node: { attrs: { latex?: string } };
    getPos: () => number | undefined;
  }) => {
    const dom = document.createElement(displayMode ? 'div' : 'span');
    dom.className = displayMode ? 'math-block' : 'math-inline';
    dom.setAttribute('contenteditable', 'false');
    let latexNow = '';
    const draw = (latex: string) => {
      latexNow = latex;
      dom.innerHTML = renderKatex(latex, displayMode);
      dom.setAttribute('data-latex', latex);
      // Bad LaTeX used to be red text with no explanation unless the pointer hovered exactly on
      // it. The message goes in the tooltip, and the click below opens it for correction.
      const problem = latexError(latex);
      dom.title = problem
        ? `Cannot draw this equation: ${problem}. Click to edit.`
        : 'Click to edit';
      dom.classList.toggle('math--error', problem !== null);
    };
    draw(String(node.attrs.latex ?? ''));
    const onClick = (event: Event) => {
      const pos = getPos();
      if (pos === undefined) return;
      event.preventDefault();
      dom.dispatchEvent(
        new CustomEvent<MathEditDetail>(MATH_EDIT_EVENT, {
          bubbles: true,
          detail: { pos, latex: latexNow, display: displayMode },
        }),
      );
    };
    dom.addEventListener('click', onClick);
    return {
      dom,
      update(updated: { type: { name: string }; attrs: { latex?: string } }) {
        if (updated.type.name !== (displayMode ? 'mathBlock' : 'mathInline')) return false;
        draw(String(updated.attrs.latex ?? ''));
        return true;
      },
      ignoreMutation: () => true,
      destroy() {
        dom.removeEventListener('click', onClick);
      },
    };
  };
}

/**
 * What `doc.textBetween` and the prompt context show for an equation: its source between the
 * delimiters the model is told to use, so Assist and Chat read the student's equations and a
 * command rewrite can carry them through (ADR-0045).
 */
export const mathText = (latex: string, display: boolean): string =>
  display ? `$$${latex}$$` : `$${latex}$`;

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
  renderText: ({ node }) => mathText(String(node.attrs.latex ?? ''), false),
  // See `Citation.extendNodeSchema`: `textBetween` reads `leafText`, not `renderText`.
  extendNodeSchema: (extension) =>
    extension.name === 'mathInline'
      ? { leafText: (node: PmNode) => mathText(String(node.attrs.latex ?? ''), false) }
      : {},
  addNodeView: () => mathNodeView(false),
  addCommands() {
    return {
      insertMathInline:
        (latex) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
      setMathLatex:
        (pos, latex) =>
        ({ tr, state, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || (node.type.name !== 'mathInline' && node.type.name !== 'mathBlock')) {
            return false;
          }
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex });
          return true;
        },
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
  renderText: ({ node }) => mathText(String(node.attrs.latex ?? ''), true),
  extendNodeSchema: (extension) =>
    extension.name === 'mathBlock'
      ? { leafText: (node: PmNode) => mathText(String(node.attrs.latex ?? ''), true) }
      : {},
  addNodeView: () => mathNodeView(true),
  addCommands() {
    return {
      insertMathBlock:
        (latex) =>
        ({ tr, dispatch, editor }) => {
          const equation = editor.schema.nodes[this.name]?.create({ latex });
          const paragraph = editor.schema.nodes.paragraph?.create();
          if (!equation || !paragraph) return false;
          if (!dispatch) return true;
          // Not `insertContent`: a block atom inserted that way stays selected, and the next
          // thing the student inserts replaces it. See `insert-block.ts`.
          return insertBlockWithCaretAfter(tr, equation, paragraph);
        },
    };
  },
});
