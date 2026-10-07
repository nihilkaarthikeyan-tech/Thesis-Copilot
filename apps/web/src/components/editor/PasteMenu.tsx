'use client';

/**
 * Paste with a choice (Jenni build plan R9, ADR-0096): after a paste of a few words or more, a
 * small menu beside it. Jenni offers Improve / Paraphrase / Proofread / Custom on anything pasted;
 * here what is offered depends on whether a citation came with it:
 *
 * - **Pasted with its citation** (the paper reader's "Copy with citation"): a quotation of a
 *   source. "Put it in my words, cited" rewrites it through the edit panel's own-instruction path,
 *   and the panel's checks warn if the citation does not survive. "Keep the quotation" closes.
 * - **Pasted without one**: "Edit with AI" (the panel on that text), "Find a source for it",
 *   "Cite it" (the free `@` picker at its end), "Keep as it is".
 *
 * An uncited paraphrase is never offered: rewording a source so that its origin disappears is the
 * §12.3 line. Nothing here calls a model itself; every rewrite goes through the panel and its
 * allowance, after the student presses something.
 */

import type { PasteInfo, PasteMenuStorage } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState } from 'react';
import { AI_EDIT_FOCUS, AI_EDIT_RUN, type AiEditRunDetail } from './CommandToolbar';

/** The fixed instruction behind "Put it in my words, cited" (the panel's `custom` path). */
export const IN_MY_WORDS =
  'Put this quotation in my own words: keep its meaning and its citation, remove the quotation marks, and add nothing.';

export function PasteMenu(props: { editor: Editor | null; onFindPapers: (text: string) => void }) {
  const { editor } = props;
  const [info, setInfo] = useState<PasteInfo | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // The plugin reads its handler when a paste happens (CLAUDE.md: never capture it at build).
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.pasteMenu as PasteMenuStorage | undefined;
    if (!storage) return;
    storage.onPaste = (pasted) => setInfo(pasted);
    // Typing, or any other change after the paste, means the student has moved on.
    const onTransaction = ({
      transaction,
    }: {
      transaction: { docChanged: boolean; getMeta: (k: string) => unknown };
    }) => {
      if (transaction.docChanged && transaction.getMeta('uiEvent') !== 'paste') setInfo(null);
    };
    editor.on('transaction', onTransaction);
    return () => {
      storage.onPaste = null;
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  useEffect(() => {
    if (!info) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setInfo(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInfo(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [info]);

  if (!editor || !info) return null;
  let coords: { left: number; bottom: number };
  try {
    coords = editor.view.coordsAtPos(Math.min(info.to, editor.state.doc.content.size));
  } catch {
    return null;
  }

  const close = () => setInfo(null);
  const selectPaste = () =>
    editor.chain().focus().setTextSelection({ from: info.from, to: info.to }).run();

  const inMyWords = () => {
    selectPaste();
    window.dispatchEvent(
      new CustomEvent<AiEditRunDetail>(AI_EDIT_RUN, {
        detail: { command: 'custom', instruction: IN_MY_WORDS },
      }),
    );
    close();
  };
  const editWithAi = () => {
    selectPaste();
    window.setTimeout(() => window.dispatchEvent(new Event(AI_EDIT_FOCUS)), 50);
    close();
  };
  const cite = () => {
    // Before a closing full stop, as the thesis styles place it; "@" opens the library picker.
    let at = info.to;
    if (editor.state.doc.textBetween(Math.max(0, at - 1), at) === '.') at -= 1;
    const before = editor.state.doc.textBetween(Math.max(0, at - 1), at);
    editor
      .chain()
      .focus()
      .insertContentAt(at, /\s$/.test(before) ? '@' : ' @')
      .run();
    close();
  };

  const item =
    'whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:bg-sunk';
  const top = Math.min(coords.bottom + 6, window.innerHeight - 60);
  const left = Math.min(Math.max(8, coords.left - 40), window.innerWidth - 420);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="What to do with what you pasted"
      data-testid="paste-menu"
      className="fixed z-40 flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface p-1 shadow-lg"
      style={{ top, left }}
    >
      {info.cited ? (
        <>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={inMyWords}
            data-testid="paste-in-my-words"
            title="Rewrites the quotation in your words through the edit panel, keeping the citation — one edit"
          >
            Put it in my words, cited
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={close}
            data-testid="paste-keep"
          >
            Keep the quotation
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={editWithAi}
            data-testid="paste-edit"
          >
            Edit with AI
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              props.onFindPapers(info.text);
              close();
            }}
            data-testid="paste-find-source"
          >
            Find a source for it
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={cite}
            data-testid="paste-cite"
          >
            Cite it
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={close}
            data-testid="paste-keep"
          >
            Keep as it is
          </button>
        </>
      )}
    </div>
  );
}
