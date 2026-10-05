/**
 * What the popup shows, as a pure state machine — ADR-0069. `popup.ts` draws a `View` and turns
 * clicks and replies into `Event`s; every decision about which state comes next is here, where
 * it is tested without a browser.
 *
 *   reading ─▶ not-paper                       (nothing on the page names a paper)
 *          └▶ loading ─▶ signed-out             (the site answered 401)
 *                     ├▶ no-thesis              (signed in, no thesis yet)
 *                     ├▶ load-failed ─▶ loading (retry)
 *                     └▶ ready ─▶ saving ─▶ done ─▶ saving (retry the failed ones)
 */

import { BULK_MAX, type ListItem, type Site } from './lists.js';
import type { ItemResult, Reply, SaveJob, SaveResult, Thesis } from './messages.js';
import type { Paper } from './paper.js';

export type Target =
  | {
      mode: 'single';
      key: string;
      paper: Paper;
      /** The tab's PDF, when the tab is one. */
      pdf: NonNullable<SaveJob['pdf']> | null;
      /** True when it came from a right-clicked link rather than the tab. */
      fromLink: boolean;
    }
  | { mode: 'list'; site: Site; items: ListItem[] };

export type Phase = 'idle' | 'saving' | 'done';

export type View =
  | { kind: 'reading' }
  | { kind: 'not-paper'; restricted: boolean }
  | { kind: 'loading'; target: Target }
  | { kind: 'signed-out'; target: Target }
  | { kind: 'no-thesis'; target: Target }
  | { kind: 'load-failed'; target: Target; message: string }
  | {
      kind: 'ready';
      target: Target;
      theses: Thesis[];
      /** Keys ticked on a results page; the one paper's key on an article page. */
      selected: string[];
      phase: Phase;
      /** The keys the current (or last) save sent, for its progress. */
      sending: string[];
      results: Record<string, ItemResult>;
      outcome: SaveResult | null;
      /** A failure of the save as a whole, as opposed to one paper's. */
      error: string | null;
    };

export type Event =
  | { type: 'read'; target: Target | null; restricted: boolean }
  | { type: 'theses'; reply: Reply<Thesis[]> }
  | { type: 'retry-load' }
  | { type: 'toggle'; key: string }
  | { type: 'toggle-all' }
  | { type: 'save-start' }
  | { type: 'progress'; results: ItemResult[] }
  | { type: 'save-done'; reply: Reply<SaveResult> };

export const initial: View = { kind: 'reading' };

const keysOf = (target: Target): string[] =>
  target.mode === 'single' ? [target.key] : target.items.map((item) => item.key);

/** True when this paper needs (another) save: never tried, or tried and failed. */
const open = (results: Record<string, ItemResult>, key: string): boolean =>
  !results[key] || results[key].status === 'failed';

/** The papers the Save button would send now, at most `BULK_MAX`. */
export function pendingKeys(view: View): string[] {
  if (view.kind !== 'ready') return [];
  return view.selected.filter((key) => open(view.results, key)).slice(0, BULK_MAX);
}

/** True when more are ticked than one save may send. */
export function overCap(view: View): boolean {
  return (
    view.kind === 'ready' &&
    view.selected.filter((key) => open(view.results, key)).length > BULK_MAX
  );
}

export function reduce(view: View, event: Event): View {
  switch (event.type) {
    case 'read':
      if (!event.target) return { kind: 'not-paper', restricted: event.restricted };
      return { kind: 'loading', target: event.target };

    case 'retry-load':
      return view.kind === 'load-failed' ? { kind: 'loading', target: view.target } : view;

    case 'theses': {
      if (view.kind !== 'loading') return view;
      const { reply } = event;
      if (!reply.ok) {
        return reply.status === 401
          ? { kind: 'signed-out', target: view.target }
          : { kind: 'load-failed', target: view.target, message: reply.message };
      }
      if (reply.value.length === 0) return { kind: 'no-thesis', target: view.target };
      return {
        kind: 'ready',
        target: view.target,
        theses: reply.value,
        // One paper is the one to save; on a results page the student ticks the ones they want.
        selected: view.target.mode === 'single' ? [view.target.key] : [],
        phase: 'idle',
        sending: [],
        results: {},
        outcome: null,
        error: null,
      };
    }

    case 'toggle': {
      if (view.kind !== 'ready' || view.phase === 'saving' || view.target.mode !== 'list')
        return view;
      if (!keysOf(view.target).includes(event.key)) return view;
      const selected = view.selected.includes(event.key)
        ? view.selected.filter((key) => key !== event.key)
        : [...view.selected, event.key];
      return { ...view, selected };
    }

    case 'toggle-all': {
      if (view.kind !== 'ready' || view.phase === 'saving' || view.target.mode !== 'list')
        return view;
      // "All" means every paper not yet saved, up to one save's worth; again clears the ticks.
      const candidates = keysOf(view.target).filter((key) => open(view.results, key));
      const all = candidates.slice(0, BULK_MAX);
      const everyTicked = all.length > 0 && all.every((key) => view.selected.includes(key));
      return { ...view, selected: everyTicked ? [] : all };
    }

    case 'save-start': {
      if (view.kind !== 'ready' || view.phase === 'saving') return view;
      const sending = pendingKeys(view);
      if (sending.length === 0) return view;
      const results = { ...view.results };
      for (const key of sending) delete results[key];
      return { ...view, phase: 'saving', sending, results, error: null };
    }

    case 'progress': {
      if (view.kind !== 'ready' || view.phase !== 'saving') return view;
      const results = { ...view.results };
      for (const result of event.results) results[result.key] = result;
      return { ...view, results };
    }

    case 'save-done': {
      if (view.kind !== 'ready' || view.phase !== 'saving') return view;
      const { reply } = event;
      if (!reply.ok) {
        if (reply.status === 401) return { kind: 'signed-out', target: view.target };
        return { ...view, phase: 'done', error: reply.message };
      }
      if (reply.value.signedOut) return { kind: 'signed-out', target: view.target };
      const results = { ...view.results };
      for (const result of reply.value.results) results[result.key] = result;
      // Saved papers drop out of the selection; failed ones stay ticked for "Retry".
      const selected = view.selected.filter((key) => open(results, key));
      return { ...view, phase: 'done', results, outcome: reply.value, selected };
    }
  }
}

/** The single paper's result once saved, for the article-page states. */
export function singleResult(view: View): ItemResult | null {
  if (view.kind !== 'ready' || view.target.mode !== 'single') return null;
  return view.results[view.target.key] ?? null;
}

/** Counts for the results page's summary line. */
export function tally(view: View): { saved: number; present: number; failed: number } {
  const counts = { saved: 0, present: 0, failed: 0 };
  if (view.kind !== 'ready') return counts;
  for (const result of Object.values(view.results)) {
    if (result.status === 'saved') counts.saved++;
    else if (result.status === 'present') counts.present++;
    else counts.failed++;
  }
  return counts;
}
