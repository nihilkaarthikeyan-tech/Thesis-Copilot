/**
 * A time budget for one index across a run's queries — ADR-0050.
 *
 * A search run asks every index in parallel and waits for all of them. arXiv allows one request
 * every three seconds for the whole site, and on production (2026-10-01) it answered 429 under
 * load: OpenAlex was done in seconds and the run sat on "Searching…" for minutes waiting for
 * arXiv. Every call now carries a time limit, and once an index has used its budget its remaining
 * queries are skipped — the run finishes with what the other indexes found.
 */

import type { DiscoveredWork } from './discover.js';

export const INDEX_BUDGET = {
  /** One request may take this long before it is abandoned. */
  perCallMs: 25_000,
  /** All of one index's queries in one run. */
  perIndexMs: 75_000,
} as const;

export type SearchFn = (query: string, signal: AbortSignal) => Promise<DiscoveredWork[]>;

/**
 * Runs `queries` through `search` one after another (the order the indexes' rate limits need),
 * each with its own time limit, stopping when the index's budget is spent. One list per query,
 * empty for a query that failed or was skipped, so callers can still pair lists with queries.
 */
export async function searchWithinBudget(
  queries: readonly string[],
  search: SearchFn,
  options: {
    perCallMs?: number;
    perIndexMs?: number;
    now?: () => number;
    onSkip?: (query: string, reason: string) => void;
  } = {},
): Promise<DiscoveredWork[][]> {
  const now = options.now ?? Date.now;
  const perCall = options.perCallMs ?? INDEX_BUDGET.perCallMs;
  const deadline = now() + (options.perIndexMs ?? INDEX_BUDGET.perIndexMs);
  const out: DiscoveredWork[][] = [];
  for (const query of queries) {
    const left = deadline - now();
    if (left <= 0) {
      options.onSkip?.(query, 'index budget spent');
      out.push([]);
      continue;
    }
    try {
      out.push(await search(query, AbortSignal.timeout(Math.min(perCall, left))));
    } catch (error) {
      options.onSkip?.(query, error instanceof Error ? error.message : String(error));
      out.push([]);
    }
  }
  return out;
}
