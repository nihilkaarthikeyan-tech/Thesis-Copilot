/**
 * "Select several" in the in-page card — ADR-0154. The card lists every result (or reference)
 * the page's buttons were put on, each with a checkbox, and "Save selected (n)" saves the ticked
 * ones into the chosen thesis and collection in one request (`save-many`: one resolve call with
 * every reference, duplicates by DOI found first, ADR-0139). Each row then says what became of
 * it: saved, already in the library, or not saved and why.
 *
 * Rows are named by their index in the card's list. Pure, so it is tested without a browser.
 */

import { BULK_MAX } from './lists.js';
import type { ItemResult, Reply, SaveResult } from './messages.js';

export type BulkPhase = 'idle' | 'saving' | 'done';

export type BulkState = {
  /** Ticked rows, in list order. */
  selected: number[];
  phase: BulkPhase;
  /** What became of each row sent, by row. */
  outcomes: Record<number, ItemResult>;
  /** The save as a whole could not be made (as opposed to one row refused). */
  error: string | null;
  /** The site answered 401 part-way: the card goes to "Sign in". */
  signedOut: boolean;
};

/** Opening the list: the result whose button was pressed is ticked, unless it was saved. */
export function bulkStart(pressed: number | null, alreadySaved: ReadonlySet<number>): BulkState {
  return {
    selected: pressed !== null && !alreadySaved.has(pressed) ? [pressed] : [],
    phase: 'idle',
    outcomes: {},
    error: null,
    signedOut: false,
  };
}

const sorted = (rows: Iterable<number>): number[] => [...new Set(rows)].sort((a, b) => a - b);

/** Ticks or unticks one row; never more than `BULK_MAX` ticked. */
export function toggleRow(state: BulkState, row: number, on: boolean): BulkState {
  if (state.phase === 'saving') return state;
  const rest = state.selected.filter((r) => r !== row);
  if (!on) return { ...state, selected: rest };
  if (rest.length >= BULK_MAX) return state;
  return { ...state, selected: sorted([...rest, row]) };
}

/**
 * "Select all": every row not already saved or in the library — from this browser's memory or
 * from this list's last save — up to `BULK_MAX`.
 */
export function selectAll(
  state: BulkState,
  rows: number,
  alreadySaved: ReadonlySet<number>,
): BulkState {
  if (state.phase === 'saving') return state;
  const done = (row: number) =>
    alreadySaved.has(row) || (state.outcomes[row] && state.outcomes[row].status !== 'failed');
  const all = Array.from({ length: rows }, (_, i) => i).filter((row) => !done(row));
  return { ...state, selected: all.slice(0, BULK_MAX) };
}

export const clearAll = (state: BulkState): BulkState =>
  state.phase === 'saving' ? state : { ...state, selected: [] };

export const canSaveBulk = (state: BulkState): boolean =>
  state.phase !== 'saving' && state.selected.length > 0;

export function bulkSaving(state: BulkState): BulkState {
  return canSaveBulk(state) ? { ...state, phase: 'saving', error: null } : state;
}

/**
 * The answer for `sent` (the rows sent, in order; the service worker keys them `r0`, `r1`…).
 * The failed rows stay ticked, so pressing Save again tries just those.
 */
export function bulkDone(
  state: BulkState,
  sent: readonly number[],
  reply: Reply<SaveResult>,
): BulkState {
  if (state.phase !== 'saving') return state;
  if (!reply.ok) {
    return { ...state, phase: 'done', error: reply.message, signedOut: reply.status === 401 };
  }
  const outcomes = { ...state.outcomes };
  for (const result of reply.value.results) {
    const at = /^r(\d+)$/.exec(result.key)?.[1];
    const row = at === undefined ? undefined : sent[Number(at)];
    if (row !== undefined) outcomes[row] = result;
  }
  // A row with no answer at all is said as failed, never left looking saved.
  for (const row of sent) {
    outcomes[row] ??= {
      key: '',
      status: 'failed',
      sourceId: null,
      message: 'Thesis Copilot did not answer for this one.',
    };
  }
  return {
    ...state,
    phase: 'done',
    outcomes,
    selected: sent.filter((row) => outcomes[row]?.status === 'failed'),
    signedOut: reply.value.signedOut,
  };
}

/** One row's outcome, in words: "Saved", "Already in your library", "Not saved: <reason>". */
export function outcomeText(result: ItemResult | undefined): string | null {
  if (!result) return null;
  if (result.status === 'saved') return 'Saved';
  if (result.status === 'present') return 'Already in your library';
  return `Not saved: ${result.message ?? 'Thesis Copilot did not take this one.'}`;
}

/** "3 saved · 1 already in your library · 1 not saved", for the rows of the last save. */
export function bulkSummary(state: BulkState, sent: readonly number[]): string {
  const count = (status: ItemResult['status']) =>
    sent.filter((row) => state.outcomes[row]?.status === status).length;
  const parts = [
    [count('saved'), 'saved'],
    [count('present'), 'already in your library'],
    [count('failed'), 'not saved'],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, words]) => `${n} ${words}`)
    .join(' · ');
}
