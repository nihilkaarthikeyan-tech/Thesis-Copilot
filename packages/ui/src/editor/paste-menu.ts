/**
 * Paste with a choice (Jenni build plan R9, inventory §13.2–13.3). After a paste of a few words or
 * more, the app shows a small menu beside it. This file is the editor half: it notices a paste,
 * works out the range it filled and whether a citation came with it, and tells the app through
 * `editor.storage.pasteMenu.onPaste` — read when the paste happens, never captured when the editor
 * is built (CLAUDE.md). What the menu offers is the app's.
 *
 * A paste that brought a citation (the paper reader's "Copy with citation") is a quotation of a
 * source; one without is the student's own words or an uncited copy. The app offers different
 * things for each — an uncited paraphrase of a source is the §12.3 line, and is never offered.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/** Fewer words than this is a fix, not a passage: no menu. */
export const PASTE_MENU_MIN_WORDS = 4;

export type PasteInfo = {
  from: number;
  to: number;
  text: string;
  /** Whether a citation node arrived with the paste. */
  cited: boolean;
};

export type PasteMenuStorage = {
  onPaste: ((info: PasteInfo) => void) | null;
};

type PasteState = { last: PasteInfo | null; seq: number };

export const pasteMenuKey = new PluginKey<PasteState>('pasteMenu');

export const PasteMenu = Extension.create<Record<string, never>, PasteMenuStorage>({
  name: 'pasteMenu',

  addStorage() {
    return { onPaste: null };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<PasteState>({
        key: pasteMenuKey,
        state: {
          init: () => ({ last: null, seq: 0 }),
          apply(tr, value, oldState, newState) {
            if (tr.getMeta('uiEvent') === 'paste' && tr.docChanged) {
              const from = tr.mapping.map(oldState.selection.from, -1);
              const to = newState.selection.to;
              if (to <= from) return value;
              const text = newState.doc.textBetween(from, to, '\n', ' ').trim();
              const words = text.split(/\s+/).filter(Boolean).length;
              if (words < PASTE_MENU_MIN_WORDS) return { last: null, seq: value.seq };
              let cited = false;
              newState.doc.nodesBetween(from, to, (node) => {
                if (node.type.name === 'citation') cited = true;
                return !cited;
              });
              return { last: { from, to, text, cited }, seq: value.seq + 1 };
            }
            if (!value.last || !tr.docChanged) return value;
            const from = tr.mapping.map(value.last.from, 1);
            const to = tr.mapping.map(value.last.to, -1);
            return to > from
              ? { ...value, last: { ...value.last, from, to } }
              : { ...value, last: null };
          },
        },
        view: () => {
          let seen = 0;
          return {
            update(view) {
              const state = pasteMenuKey.getState(view.state);
              if (!state || state.seq === seen) return;
              seen = state.seq;
              const storage = editor.storage.pasteMenu as PasteMenuStorage | undefined;
              if (state.last) storage?.onPaste?.(state.last);
            },
          };
        },
      }),
    ];
  },
});

/** The range the last paste filled, mapped through any edits since, or null. */
export function lastPaste(state: Parameters<typeof pasteMenuKey.getState>[0]): PasteInfo | null {
  return pasteMenuKey.getState(state)?.last ?? null;
}
