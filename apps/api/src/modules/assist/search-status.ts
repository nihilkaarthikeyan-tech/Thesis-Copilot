/**
 * What a paper search can say about itself — ADR-0149 (2026-10-10).
 *
 * `web-scope.service.ts` used to turn a failed index into `[]` with a log warning, so a dead
 * OpenAlex looked exactly like "no papers on this": the automatic library filled with off-topic
 * papers from the two indexes still answering, and the student was told nothing. Every search
 * now reports each index's outcome, and the one line the UI shows is built here, in code, so a
 * test can read the same words a student does.
 */

import { ScholarlyError } from '@tc/retrieval';

export type IndexName = 'openalex' | 'semanticscholar' | 'pubmed' | 'arxiv';

export const INDEX_LABEL: Record<IndexName, string> = {
  openalex: 'OpenAlex',
  semanticscholar: 'Semantic Scholar',
  pubmed: 'PubMed',
  arxiv: 'arXiv',
};

/** Why an index gave nothing: it refused us, it ran out of time, or it broke. */
export type IndexFailure = 'refused' | 'timeout' | 'failed';

export type IndexOutcome = {
  name: IndexName;
  label: string;
  ok: boolean;
  count: number;
  reason?: IndexFailure;
  /** When a refusing index said it would answer again (ISO), if it said. */
  until?: string | null;
};

export type SearchStatus = {
  indexes: IndexOutcome[];
  /** The main index (OpenAlex) did not answer, so what came back is not the usual search. */
  degraded: boolean;
  /** The line to show the student, or null when every index answered. */
  notice: string | null;
};

/** The indexes whose silence makes a search "degraded": the ones that cover every field. */
export const MAIN_INDEXES: readonly IndexName[] = ['openalex'];

export function outcomeOfError(name: IndexName, error: unknown): IndexOutcome {
  const label = INDEX_LABEL[name];
  if (error instanceof ScholarlyError && error.refused) {
    return {
      name,
      label,
      ok: false,
      count: 0,
      reason: 'refused',
      until: error.until ? new Date(error.until).toISOString() : null,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  // `AbortSignal.timeout` rejects with a TimeoutError; the client's own check says "aborted".
  const timedOut =
    (error instanceof Error && error.name === 'TimeoutError') ||
    /aborted|timed? ?out|no request slot/i.test(message);
  return { name, label, ok: false, count: 0, reason: timedOut ? 'timeout' : 'failed' };
}

export function outcomeOfCount(name: IndexName, count: number): IndexOutcome {
  return { name, label: INDEX_LABEL[name], ok: true, count };
}

const list = (labels: readonly string[]): string =>
  labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;

/**
 * The status of one search from its indexes' outcomes. Wording, in order of what the student
 * needs to know: which index is not answering, where the results did come from, that trying
 * later is the remedy. Never "no papers" when the truth is "no answer".
 */
export function searchStatus(indexes: readonly IndexOutcome[]): SearchStatus {
  const failed = indexes.filter((i) => !i.ok);
  const answered = indexes.filter((i) => i.ok);
  const degraded = indexes.some((i) => !i.ok && MAIN_INDEXES.includes(i.name));
  if (failed.length === 0) return { indexes: [...indexes], degraded: false, notice: null };
  const refused = failed.filter((i) => i.reason === 'refused');
  const verb = refused.length === failed.length ? 'not answering right now' : 'not answering';
  const who = list(failed.map((i) => i.label));
  const is = failed.length === 1 ? 'is' : 'are';
  const notice =
    answered.length === 0
      ? `None of the paper indexes is answering right now (${who}) — try again later.`
      : `${who} ${is} ${verb}; results come from ${list(answered.map((i) => i.label))} only — try again later.`;
  return { indexes: [...indexes], degraded, notice };
}

/** A list of results that also carries how it was found. Mocks that return a plain array still fit. */
export type SearchedList<T> = T[] & { status?: SearchStatus };

export function withStatus<T>(items: T[], status: SearchStatus): SearchedList<T> {
  return Object.assign(items, { status });
}

export const statusOf = (list: unknown): SearchStatus | null =>
  (list as { status?: SearchStatus } | null | undefined)?.status ?? null;
