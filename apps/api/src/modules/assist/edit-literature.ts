/**
 * "Search the literature" on an AI edit — ADR-0133 (amends ADR-0095's "Web switch: not built").
 *
 * The pure half: which found papers join the library, the passages they bring to this edit, how
 * those join the library's, and the one line the student reads when the search gave nothing. What
 * is searched for and the relevance rule are `@tc/retrieval`'s (`editSearchPlan`, `keepRelevant`).
 *
 * The rule that makes the switch safe: **a found paper is added to the library before anything
 * cites it**. Its abstract — already on the new `Source` row — is this edit's passage for it, tied
 * to that library row; nothing waits for the worker, which reads and embeds it in the background
 * as it does every added paper. So every citation the rewrite makes is to a library paper, and
 * `postProcessCommand` strips any other.
 */

import type { RetrievalResult, RetrievedPassage } from '@tc/retrieval';
import { CHAT_RESEARCH, EDIT_SEARCH, keepRelevant } from '@tc/retrieval';
import type { WebResult } from './web-scope.service.js';

export const EDIT_LITERATURE = {
  /** Found papers added to the library by one edit, at most (the owner's "few", ≤5). */
  maxPapers: EDIT_SEARCH.maxPapers,
  /** Candidates embedded, at most: chat's bound, so one edit's search embedding is chat's. */
  maxCandidates: CHAT_RESEARCH.maxCandidates,
  /** The whole search's wall clock; each index also has its own (ADR-0074's budget). */
  searchTimeoutMs: 20_000,
  /** The relevance embedding call's time limit. */
  embedTimeoutMs: 15_000,
  /** An abstract is cut here as a passage: about a chunk's length. */
  abstractChars: 2_000,
} as const;

/**
 * The chunk id an abstract passage carries until the worker has stored the paper's own chunks.
 * It never leaves the server: a citation of it is sent with no chunk (`realChunkId`), which the
 * editor already shows as "cited from the library, with no passage attached".
 */
const ABSTRACT_CHUNK = 'abstract:';

export function realChunkId(chunkId: string): string | null {
  return chunkId.startsWith(ABSTRACT_CHUNK) ? null : chunkId;
}

export type ScoredWork = { result: WebResult; cosine: number };

/**
 * The found papers worth adding: not already in the library, with an abstract to read, once per
 * DOI or title — then the measured rule (`keepRelevant`: a floor, and close to the best), a few.
 */
export function papersToAdd(
  scored: readonly ScoredWork[],
  rule: { floor: number; margin: number; max: number } = {
    floor: EDIT_SEARCH.floor,
    margin: EDIT_SEARCH.margin,
    max: EDIT_LITERATURE.maxPapers,
  },
): WebResult[] {
  const seen = new Set<string>();
  const eligible = [...scored]
    .filter(
      (s) =>
        !s.result.inLibrary &&
        (s.result.abstract ?? '').trim().length >= 80 &&
        s.result.title.trim().length > 0,
    )
    .sort((a, b) => b.cosine - a.cosine)
    .filter((s) => {
      const key = (s.result.doi ?? s.result.title).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return keepRelevant(eligible, rule).map((s) => s.result);
}

/** A paper just added, with the abstract that is this edit's passage for it. */
export type AddedWithAbstract = {
  sourceId: string;
  shortRef: string;
  abstract: string;
  cosine: number;
};

/** The added papers' abstracts as passages, tied to their library rows. */
export function abstractPassages(papers: readonly AddedWithAbstract[]): RetrievedPassage[] {
  return papers
    .filter((p) => p.abstract.trim().length > 0)
    .map((p) => ({
      id: '',
      shortRef: p.shortRef,
      page: null,
      text: p.abstract.replace(/\s+/g, ' ').trim().slice(0, EDIT_LITERATURE.abstractChars),
      sourceId: p.sourceId,
      chunkId: `${ABSTRACT_CHUNK}${p.sourceId}`,
      score: p.cosine,
      cosine: p.cosine,
    }));
}

/**
 * The request's passages: the found papers' abstracts first (the student asked for the
 * literature, so a paper just added is not crowded out), then the library's as retrieval ranked
 * them — without another passage of a paper already there by its abstract — `topK` in all. Keys
 * are given afresh and `byKey` rebuilt to match, so a citation resolves to the right library row.
 */
export function withFoundPassages(
  library: RetrievalResult | null,
  found: readonly RetrievedPassage[],
  topK: number,
): RetrievalResult {
  const chosen: RetrievedPassage[] = [];
  const chunks = new Set<string>();
  const foundSources = new Set<string>();
  for (const p of found) {
    if (foundSources.has(p.sourceId) || chunks.has(p.chunkId)) continue;
    foundSources.add(p.sourceId);
    chunks.add(p.chunkId);
    chosen.push(p);
  }
  for (const p of library?.passages ?? []) {
    if (chunks.has(p.chunkId) || foundSources.has(p.sourceId)) continue;
    chunks.add(p.chunkId);
    chosen.push(p);
  }
  const kept = chosen.slice(0, topK);

  const sourceNumber = new Map<string, number>();
  const chunkCounter = new Map<string, number>();
  const byKey: RetrievalResult['byKey'] = new Map();
  const passages = kept.map((p): RetrievedPassage => {
    if (!sourceNumber.has(p.sourceId)) sourceNumber.set(p.sourceId, sourceNumber.size + 1);
    const s = sourceNumber.get(p.sourceId) as number;
    const c = (chunkCounter.get(p.sourceId) ?? 0) + 1;
    chunkCounter.set(p.sourceId, c);
    const id = `S${s}#c${c}`;
    byKey.set(id, { sourceId: p.sourceId, chunkId: p.chunkId, shortRef: p.shortRef });
    return { ...p, id };
  });
  return {
    passages,
    byKey,
    pinned: library?.pinned ?? 0,
    candidates: (library?.candidates ?? 0) + found.length,
  };
}

/** What the search came to, for the line under the result. */
export type LiteratureOutcome = 'added' | 'none-relevant' | 'failed';

/** The one line the student reads when the edit used the library alone; null when it did not. */
export function literatureNote(outcome: LiteratureOutcome): string | null {
  switch (outcome) {
    case 'failed':
      return 'The literature search did not answer in time; this edit used your library alone.';
    case 'none-relevant':
      return 'The search found nothing close enough to this passage; this edit used your library alone.';
    default:
      return null;
  }
}
