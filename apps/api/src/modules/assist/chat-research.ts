/**
 * Chat that researches when the library is thin — ADR-0074. The pure half: which found papers
 * join the library's passages, and the words the student sees while it works. No model, no
 * database, no network; `ChatService` does the wiring, `@tc/retrieval` decides "thin" and plans
 * the searches.
 *
 * The rules, each tested in `test/chat-research.spec.ts`:
 *
 * - **A found paper joins only on its own abstract, only on topic, and only if it is not already
 *   in the library** (the library's own passages already speak for those). Ranked by cosine
 *   against the thesis and the question; at most `CHAT_RESEARCH.maxAbstracts`.
 * - **Every one is marked `origin: 'search'`** in the prompt, so the answer can say so, and its
 *   citation carries the paper with Add, as ADR-0060's do.
 */

import type { ChatFilters, PromptPassage } from '@tc/ai';
import { CHAT_RESEARCH, type LibraryCoverage } from '@tc/retrieval';
import { type BeyondPassages, passagesFromWebResults } from './beyond-library.js';
import type { WebResult } from './web-scope.service.js';

export type ScoredResult = { result: WebResult; cosine: number };

/** The found papers that join the answer's passages, best first. */
export function researchPassages(
  scored: readonly ScoredResult[],
  filters: ChatFilters,
  keepCosine: number = CHAT_RESEARCH.keepCosine,
  max: number = CHAT_RESEARCH.maxAbstracts,
): BeyondPassages {
  const kept = scored
    .filter((s) => !s.result.inLibrary && s.cosine >= keepCosine)
    .sort((a, b) => b.cosine - a.cosine)
    .map((s) => s.result);
  const built = passagesFromWebResults(kept, filters, max);
  return {
    passages: built.passages.map((p): PromptPassage => ({ ...p, origin: 'search' })),
    papers: built.papers,
  };
}

/** The candidates worth embedding: an abstract to read, not already in the library. */
export function researchCandidates(results: readonly WebResult[]): WebResult[] {
  return results
    .filter((r) => !r.inLibrary && (r.abstract ?? '').trim().length >= 80 && r.title.trim())
    .slice(0, CHAT_RESEARCH.maxCandidates);
}

/** A step's words, and what the panel needs to say them in another language. */
export type ResearchStep = {
  id: 'research' | 'query' | 'read' | 'kept';
  text: string;
  params: Record<string, string | number>;
};

export function thinStep(coverage: LibraryCoverage): ResearchStep {
  const papers = coverage.sources;
  return {
    id: 'research',
    text:
      papers === 0
        ? 'Your library has little on this, so I am searching the literature too…'
        : `Your library has ${papers} paper${papers === 1 ? '' : 's'} on this, so I am searching the literature too…`,
    params: { papers },
  };
}

export function queryStep(indexes: readonly string[], query: string): ResearchStep {
  const list =
    indexes.length <= 1
      ? (indexes[0] ?? '')
      : `${indexes.slice(0, -1).join(', ')} and ${indexes.at(-1)}`;
  return {
    id: 'query',
    text: `Searching ${list} for: ${query}…`,
    params: { indexes: list, query },
  };
}

export function readStep(count: number): ResearchStep {
  return {
    id: 'read',
    text: `Reading ${count} abstract${count === 1 ? '' : 's'}…`,
    params: { count },
  };
}

export function keptStep(kept: number, read: number): ResearchStep {
  return {
    id: 'kept',
    text:
      kept === 0
        ? 'None of them is close enough to your question; answering from your library'
        : `${kept} of ${read} ${read === 1 ? 'is' : 'are'} on your question`,
    params: { kept, read },
  };
}

export const RESEARCH_WRITING_STEP = 'Writing the answer…';

/** What an answer that researched read, for the line under it and the Add list. */
export type ResearchSummary = {
  /** Abstracts that were in the request. */
  papers: number;
  /** The keyword searches that were run, as the student saw them. */
  queries: string[];
  note: string;
};

export function researchNote(libraryPapers: number, found: number): string {
  const lib = `${libraryPapers} paper${libraryPapers === 1 ? '' : 's'} in your library`;
  const add = `${found} found by a search, not in your library — add the ones you use`;
  return `From ${lib} and the abstracts of ${add}.`;
}
