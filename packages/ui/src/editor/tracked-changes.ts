/**
 * Tracked changes — a check's fixes drawn in the text (Jenni build plan R23, ADR-0110).
 *
 * Proofreading and the tone review listed their corrections in the side panel; Jenni shows the
 * same kind of fix where it applies, the old words struck through and the new ones beside them,
 * and walks through them with Y and N. This draws them. It changes nothing in the document: the
 * screen that owns the review applies an accepted change itself, through the same steps the
 * panel's own Accept takes, and then removes it here.
 *
 * A change is a range and, usually, the words to put there. One without words is a note — a
 * coherence flag on a sentence — drawn as a highlight, so a review can walk through the flags of a
 * chapter in the text as well.
 *
 * Decorations, as the supervisor highlights are (review.ts): derived from the live document, so
 * nothing is left behind in the saved chapter. The ranges are mapped through every edit; a change
 * whose words are edited or deleted under it is marked `gone` and no longer drawn, so it can never
 * be applied to the wrong words.
 */

import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type TrackedChange = {
  id: string;
  from: number;
  to: number;
  /** The words the change was made against, so an edit under it can be noticed. */
  original: string;
  /** The words to put in their place; null for a note (a flag), which changes nothing. */
  replacement: string | null;
};

export type TrackedChangeState = {
  changes: Array<TrackedChange & { gone: boolean }>;
  activeId: string | null;
};

export type TrackedChangesStorage = {
  /** A click on a change in the text; read at call time, so the screen can set it any time. */
  onPick: ((id: string) => void) | null;
};

export const trackedChangesKey = new PluginKey<TrackedChangeState>('trackedChanges');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    trackedChanges: {
      /** Replaces the whole set; the review owns the list and this draws it. */
      setTrackedChanges: (changes: TrackedChange[], activeId?: string | null) => ReturnType;
      setActiveTrackedChange: (id: string | null) => ReturnType;
      /** One change decided (accepted and applied, or rejected): no longer drawn. */
      removeTrackedChange: (id: string) => ReturnType;
      clearTrackedChanges: () => ReturnType;
    };
  }
}

const EMPTY: TrackedChangeState = { changes: [], activeId: null };

type Meta =
  | { set: TrackedChange[]; activeId: string | null }
  | { active: string | null }
  | { remove: string };

/** The words in a range as a change compares them: atoms (a citation) count as nothing. */
export function wordsAt(doc: PmNode, from: number, to: number): string {
  if (from < 0 || to > doc.content.size || to < from) return '';
  return doc.textBetween(from, to, ' ', '').replace(/\s+/g, ' ').trim();
}

function same(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

function mapChanges(tr: Transaction, value: TrackedChangeState): TrackedChangeState {
  if (!tr.docChanged || value.changes.length === 0) return value;
  const changes = value.changes.map((change) => {
    if (change.gone) return change;
    const from = tr.mapping.mapResult(change.from, 1);
    const to = tr.mapping.mapResult(change.to, -1);
    const moved = { ...change, from: from.pos, to: to.pos };
    // Deleted, collapsed, or edited inside: the change was made for words that are not there.
    const gone =
      from.deletedAfter ||
      to.deletedBefore ||
      moved.to < moved.from ||
      !same(wordsAt(tr.doc, moved.from, moved.to), change.original);
    return { ...moved, gone };
  });
  return { ...value, changes };
}

/** Where a change is now, or null if it has gone or was never there. */
export function trackedChangeRange(
  state: Parameters<typeof trackedChangesKey.getState>[0],
  id: string,
): (TrackedChange & { gone: boolean }) | null {
  return trackedChangesKey.getState(state)?.changes.find((c) => c.id === id) ?? null;
}

function insertion(text: string, id: string, active: boolean): () => HTMLElement {
  return () => {
    const span = document.createElement('span');
    span.className = active ? 'tc-change-ins is-active' : 'tc-change-ins';
    span.dataset.changeId = id;
    span.textContent = text;
    span.contentEditable = 'false';
    return span;
  };
}

function decorate(doc: PmNode, value: TrackedChangeState): DecorationSet {
  const decorations: Decoration[] = [];
  for (const change of value.changes) {
    if (change.gone) continue;
    const active = change.id === value.activeId;
    const kind = change.replacement === null ? 'tc-change-note' : 'tc-change-del';
    if (change.to > change.from) {
      decorations.push(
        Decoration.inline(change.from, change.to, {
          class: active ? `${kind} is-active` : kind,
          'data-change-id': change.id,
        }),
      );
    }
    if (change.replacement) {
      decorations.push(
        Decoration.widget(change.to, insertion(change.replacement, change.id, active), {
          side: 1,
          key: `ins-${change.id}-${active ? 1 : 0}`,
          ignoreSelection: true,
        }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

export const TrackedChanges = Extension.create<Record<string, never>, TrackedChangesStorage>({
  name: 'trackedChanges',

  addStorage() {
    return { onPick: null };
  },

  addCommands() {
    const meta =
      (value: Meta) =>
      ({
        tr,
        dispatch,
      }: {
        tr: Transaction;
        dispatch?: ((tr: Transaction) => void) | undefined;
      }) => {
        if (dispatch) dispatch(tr.setMeta(trackedChangesKey, value));
        return true;
      };
    return {
      setTrackedChanges:
        (changes, activeId = null) =>
        (props) =>
          meta({ set: changes, activeId })(props),
      setActiveTrackedChange: (id) => (props) => meta({ active: id })(props),
      removeTrackedChange: (id) => (props) => meta({ remove: id })(props),
      clearTrackedChanges: () => (props) => meta({ set: [], activeId: null })(props),
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin<TrackedChangeState>({
        key: trackedChangesKey,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const next = tr.getMeta(trackedChangesKey) as Meta | undefined;
            let out = mapChanges(tr, value);
            if (next && 'set' in next) {
              out = {
                changes: next.set.map((c) => ({
                  ...c,
                  gone: !same(wordsAt(tr.doc, c.from, c.to), c.original),
                })),
                activeId: next.activeId,
              };
            } else if (next && 'active' in next) {
              out = { ...out, activeId: next.active };
            } else if (next && 'remove' in next) {
              out = {
                changes: out.changes.filter((c) => c.id !== next.remove),
                activeId: out.activeId === next.remove ? null : out.activeId,
              };
            }
            return out;
          },
        },
        props: {
          decorations(state) {
            const value = trackedChangesKey.getState(state);
            if (!value || value.changes.length === 0) return DecorationSet.empty;
            return decorate(state.doc, value);
          },
          handleDOMEvents: {
            mousedown(_view, event) {
              const target = event.target;
              if (!(target instanceof Element)) return false;
              const id = target.closest<HTMLElement>('[data-change-id]')?.dataset.changeId;
              if (!id) return false;
              extension.storage.onPick?.(id);
              return false;
            },
          },
        },
      }),
    ];
  },
});
