/**
 * The card an in-page button opens (ADR-0125), as a pure state machine like the popup's
 * (`state.ts`). `inpage.ts` draws a `CardView` and turns presses and replies into `CardEvent`s;
 * every decision about what comes next is here, where it is tested without a browser.
 *
 *   loading ─▶ signed-out            (the site answered 401)
 *           ├▶ no-thesis             (signed in, no thesis yet)
 *           ├▶ unreachable ─▶ loading (retry)
 *           └▶ ready: lookup looking ─▶ found | not-found   (or skipped: nothing to look up)
 *                     phase idle ─▶ saving ─▶ done ─▶ saving (try again after a failure)
 *
 * Save waits for the lookup, so what the card shows is what goes in: the record the library
 * found for the page's identifier, or — when it found none, or the result names none — the
 * paper as the page describes it, matched by the library's own resolver.
 */

import type { Preview, Reply, SaveOneResult, Thesis } from './messages.js';
import type { PaperRef } from './refs.js';

export type Lookup =
  /** The result names no identifier: it is saved by its title and details. */
  | { state: 'skipped' }
  | { state: 'looking' }
  | { state: 'found'; ref: PaperRef; preview: Preview }
  /** No record for any of its identifiers: saved by its details, with the DOI if it has one. */
  | { state: 'not-found'; message: string };

export type CardPhase = 'idle' | 'saving' | 'done';

export type CardView =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'no-thesis' }
  | { kind: 'unreachable'; message: string }
  | {
      kind: 'ready';
      theses: Thesis[];
      lookup: Lookup;
      phase: CardPhase;
      result: SaveOneResult | null;
      /** A failure of the save as a whole (the add-on could not ask), as opposed to a refusal. */
      error: string | null;
    };

export type CardEvent =
  | { type: 'theses'; reply: Reply<Thesis[]>; hasRefs: boolean }
  | { type: 'retry' }
  | { type: 'lookup'; lookup: Exclude<Lookup, { state: 'looking' | 'skipped' }> }
  | { type: 'signed-out' }
  | { type: 'save-start' }
  | { type: 'save-done'; reply: Reply<SaveOneResult> };

export const cardInitial: CardView = { kind: 'loading' };

/** True when Save would send something now. */
export function canSave(view: CardView): boolean {
  if (view.kind !== 'ready' || view.lookup.state === 'looking' || view.phase === 'saving')
    return false;
  return view.phase === 'idle' || view.result?.status === 'failed' || view.error !== null;
}

/** The identifier the save goes in by: the one the lookup found a record for, else none. */
export function saveRef(view: CardView): PaperRef | null {
  return view.kind === 'ready' && view.lookup.state === 'found' ? view.lookup.ref : null;
}

export function reduceCard(view: CardView, event: CardEvent): CardView {
  switch (event.type) {
    case 'theses': {
      if (view.kind !== 'loading') return view;
      const { reply } = event;
      if (!reply.ok) {
        return reply.status === 401
          ? { kind: 'signed-out' }
          : { kind: 'unreachable', message: reply.message };
      }
      if (reply.value.length === 0) return { kind: 'no-thesis' };
      return {
        kind: 'ready',
        theses: reply.value,
        lookup: event.hasRefs ? { state: 'looking' } : { state: 'skipped' },
        phase: 'idle',
        result: null,
        error: null,
      };
    }

    case 'retry':
      return view.kind === 'unreachable' ? { kind: 'loading' } : view;

    case 'lookup':
      if (view.kind !== 'ready' || view.lookup.state !== 'looking') return view;
      return { ...view, lookup: event.lookup };

    case 'signed-out':
      return { kind: 'signed-out' };

    case 'save-start':
      if (!canSave(view) || view.kind !== 'ready') return view;
      return { ...view, phase: 'saving', result: null, error: null };

    case 'save-done': {
      if (view.kind !== 'ready' || view.phase !== 'saving') return view;
      const { reply } = event;
      if (!reply.ok) {
        if (reply.status === 401) return { kind: 'signed-out' };
        return { ...view, phase: 'done', error: reply.message };
      }
      if (reply.value.signedOut) return { kind: 'signed-out' };
      return { ...view, phase: 'done', result: reply.value };
    }
  }
}
