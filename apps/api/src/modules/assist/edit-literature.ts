/**
 * "Search the literature" on an AI edit — ADR-0133 (amends ADR-0095's "Web switch: not built").
 *
 * The pure half: what is searched for, which found papers join the library, how their passages
 * join the library's, and the one line the student reads when the search gave nothing. No model,
 * no network, no database; `EditLiteratureService` does the wiring.
 *
 * The rule that makes the switch safe: **a found paper is added to the library before anything
 * cites it**. The edit is sent passages from the library only — the ones it already had, and the
 * abstracts of the papers just added, read and embedded by the ordinary pipeline — so every
 * citation the rewrite makes is to a library paper, and `postProcessCommand` strips any other.
 */

import type { RetrievalResult, RetrievedPassage } from '@tc/retrieval';
import { CHAT_RESEARCH } from '@tc/retrieval';
import type { WebResult } from './web-scope.service.js';

export const EDIT_LITERATURE = {
  /** Found papers added to the library by one edit, at most (the owner's "few", ≤5). */
  maxPapers: 5,
  /**
   * A found abstract is added only at or above this against the thesis, the instruction and the
   * selection: chat's measured floor for a found abstract (ADR-0074), the same number
   * `find-sources` adds at (`AUTO_SOURCES.addCosine`).
   */
  keepCosine: CHAT_RESEARCH.keepCosine,
  /** Candidates embedded, at most: chat's bound, so one edit's search embedding is chat's. */
  maxCandidates: CHAT_RESEARCH.maxCandidates,
  /** The whole search's wall clock; each index also has its own (ADR-0074's budget). */
  searchTimeoutMs: 20_000,
  /** The relevance embedding call's time limit. */
  embedTimeoutMs: 15_000,
  /**
   * How long the edit waits for the added papers' abstracts to be read and embedded
   * (`resolve-reference` → `index-source`, abstract first since ADR-0070: a few seconds).
   */
  readyTimeoutMs: 25_000,
  readyPollMs: 1_000,
  /** Passages a found paper brings into the request, at most — one each, its abstract. */
  perFoundPaper: 1,
} as const;

/** The words the indexes are asked with: the instruction, then the selection without markers. */
export function editSearchQuestion(selection: string, instruction?: string): string {
  const text = selection
    .replace(/\{\{cite:[^}]+\}\}/g, ' ')
    .replace(/\$\$[^$]*\$\$|\$[^$\n]*\$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const asked = (instruction ?? '').replace(/\s+/g, ' ').trim();
  return [asked, text].filter(Boolean).join('. ').slice(0, 1_000);
}

export type ScoredWork = { result: WebResult; cosine: number };

/** The found papers worth adding: not already in the library, on topic, best first, a few. */
export function papersToAdd(
  scored: readonly ScoredWork[],
  keepCosine: number = EDIT_LITERATURE.keepCosine,
  max: number = EDIT_LITERATURE.maxPapers,
): WebResult[] {
  const seen = new Set<string>();
  return scored
    .filter(
      (s) =>
        !s.result.inLibrary &&
        s.cosine >= keepCosine &&
        (s.result.abstract ?? '').trim().length >= 80 &&
        s.result.title.trim().length > 0,
    )
    .sort((a, b) => b.cosine - a.cosine)
    .filter((s) => {
      const key = (s.result.doi ?? s.result.title).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max)
    .map((s) => s.result);
}

/**
 * The request's passages: the found papers' best passage each first (the student asked for the
 * literature, so a paper just added is not crowded out by the library's own), then the library's
 * as retrieval ranked them, without a chunk twice, `topK` in all. Keys are given afresh — two
 * retrievals both number from `S1#c1` — and `byKey` is rebuilt to match, so a citation the
 * rewrite makes resolves to the right library row.
 */
export function withFoundPassages(
  library: RetrievalResult | null,
  found: RetrievalResult | null,
  topK: number,
  perFoundPaper: number = EDIT_LITERATURE.perFoundPaper,
): RetrievalResult {
  const chosen: RetrievedPassage[] = [];
  const chunks = new Set<string>();
  const perPaper = new Map<string, number>();
  for (const p of found?.passages ?? []) {
    const n = perPaper.get(p.sourceId) ?? 0;
    if (n >= perFoundPaper || chunks.has(p.chunkId)) continue;
    perPaper.set(p.sourceId, n + 1);
    chunks.add(p.chunkId);
    chosen.push(p);
  }
  for (const p of library?.passages ?? []) {
    if (chunks.has(p.chunkId)) continue;
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
    pinned: Math.max(library?.pinned ?? 0, found?.pinned ?? 0),
    candidates: (library?.candidates ?? 0) + (found?.candidates ?? 0),
  };
}

/** What the search came to, for the line under the result. */
export type LiteratureOutcome = 'added' | 'none-relevant' | 'failed' | 'not-ready';

/** The one line the student reads when the edit used the library alone; null when it did not. */
export function literatureNote(outcome: LiteratureOutcome): string | null {
  switch (outcome) {
    case 'failed':
      return 'The literature search did not answer in time; this edit used your library alone.';
    case 'none-relevant':
      return 'The search found nothing close enough to this passage; this edit used your library alone.';
    case 'not-ready':
      return 'The papers found are in your library but still being read; this edit used your library alone. Try again in a minute to cite them.';
    default:
      return null;
  }
}
