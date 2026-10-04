/**
 * Chat beyond the library — ADR-0060 (ADR-0059 rows 39–41).
 *
 * The pure half: which search results become passages, what they are called, and what the
 * student is told. No model, no database, no network — `ChatService` does the wiring.
 *
 * The rules that matter, each tested in `test/chat-beyond.spec.ts`:
 *
 * - **Only an abstract the index actually returned is a passage.** A record with no abstract, or
 *   one too short to say anything, is skipped; nothing is written in its place. The OpenAlex
 *   abstract is the one `@tc/retrieval` rebuilds from its inverted index, which is the index's own
 *   words in its own order.
 * - **Every passage is namespaced** (`Sweb<n>#cabstract`), so it can never be mistaken for a library
 *   chunk id, and it still matches the bare-id rescue in `normalizeBareCitations`.
 * - **Every cited paper says whether it is in the library**, so the panel can offer Add on the
 *   ones that are not.
 */

import type { ChatFilters, PromptPassage } from '@tc/ai';
import type { WebResult } from './web-scope.service.js';

export const BEYOND = {
  /** A.4's own top-K: the same eight passages a library question gets. */
  maxPapers: 8,
  /** Asked of the indexes, so eight with abstracts usually survive the filter. */
  candidates: 20,
  /**
   * An abstract is cut at a sentence end under this. Library chunks are ~350 tokens
   * (`DEFAULT_TARGET_TOKENS`); 1,800 characters is ~450, so eight abstracts fit inside the 4,000
   * input tokens `ACTION_PROFILES.CHAT` prices a question at (asserted in the spec).
   */
  maxAbstractChars: 1_800,
  /** Shorter than this is a placeholder ("Abstract not available."), not an abstract. */
  minAbstractChars: 80,
} as const;

/** The per-user setting (Settings → "Search beyond my library"). */
export type BeyondSetting = (typeof BEYOND_SETTINGS)[number];
export const BEYOND_SETTINGS = ['off', 'ask', 'on'] as const;

/** "Ask first" until the student chooses: a search they did not ask for is still a CHAT unit. */
export function beyondSettingOf(settings: unknown): BeyondSetting {
  const value = (settings as { searchBeyondLibrary?: unknown } | null)?.searchBeyondLibrary;
  return value === 'off' || value === 'on' || value === 'ask' ? value : 'ask';
}

/** One paper an answer read, with what the panel needs to show it and to add it. */
export type BeyondPaper = {
  title: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  inLibrary: boolean;
  /** Exactly what `POST /documents/:id/sources/resolve` takes. */
  reference: { raw: string; doi?: string };
};

export type BeyondPassages = {
  passages: PromptPassage[];
  /** Passage id → the paper it is the abstract of. */
  papers: Map<string, BeyondPaper>;
};

export function beyondPassageId(index: number): string {
  return `Sweb${index + 1}#cabstract`;
}

/**
 * A search result has no authors (`DiscoveredWork` carries none), so the label is the start of
 * the title and the year — enough to tell eight papers apart, and never an invented surname.
 */
export function shortRefOf(title: string, year: number | null): string {
  const words = title.trim().split(/\s+/);
  const head = words.slice(0, 5).join(' ');
  const short = words.length > 5 ? `${head}…` : head;
  return year ? `${short}, ${year}` : short;
}

/** Cut at the last sentence end that fits; at a word if there is none. */
export function trimAbstract(text: string, max: number = BEYOND.maxAbstractChars): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (lastStop > max / 2) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}

/**
 * The student's chat filters, as far as a search result can answer them. A result carries a
 * year, a citation count and a preprint flag; it carries no journal citedness, so that filter is
 * not applied here (and not sent to the prompt, which would otherwise claim it was).
 */
export function beyondFilters(filters: ChatFilters): ChatFilters {
  const { minJournalCitedness: _unmeasured, ...rest } = filters;
  return rest;
}

function passesFilters(result: WebResult, filters: ChatFilters): boolean {
  if (filters.yearFrom && (result.year ?? 0) < filters.yearFrom) return false;
  if (filters.yearTo && (result.year ?? 9_999) > filters.yearTo) return false;
  if (filters.minCitations && (result.citationCount ?? 0) < filters.minCitations) return false;
  if (filters.excludePreprints && result.isPreprint) return false;
  return true;
}

/** The search results that become passages, in the order the search ranked them. */
export function passagesFromWebResults(
  results: readonly WebResult[],
  filters: ChatFilters = {},
  max: number = BEYOND.maxPapers,
): BeyondPassages {
  const passages: PromptPassage[] = [];
  const papers = new Map<string, BeyondPaper>();
  for (const result of results) {
    if (passages.length >= max) break;
    const abstract = result.abstract?.replace(/\s+/g, ' ').trim() ?? '';
    if (abstract.length < BEYOND.minAbstractChars) continue;
    if (!result.title.trim()) continue;
    if (!passesFilters(result, filters)) continue;
    const id = beyondPassageId(passages.length);
    passages.push({
      id,
      shortRef: shortRefOf(result.title, result.year),
      page: null,
      text: trimAbstract(abstract),
    });
    papers.set(id, {
      title: result.title,
      year: result.year,
      venue: result.venue,
      doi: result.doi,
      inLibrary: result.inLibrary,
      reference: result.reference,
    });
  }
  return { passages, papers };
}

/** The display names of the indexes a search will ask, for the first step. */
export function searchingStep(indexes: readonly string[]): string {
  return `Searching ${indexes.join(', ')}…`;
}

export function readingStep(count: number): string {
  return `Reading ${count} abstract${count === 1 ? '' : 's'}`;
}

export const WRITING_STEP = 'Writing the answer';

/** The line under an answer from abstracts (ADR-0059 row 39). */
export function beyondNote(papers: number, outsideLibrary: number): string {
  const noun = `paper${papers === 1 ? '' : 's'}`;
  if (outsideLibrary === papers) {
    return `From the abstracts of ${papers} ${noun} not in your library — add the ones you use.`;
  }
  if (outsideLibrary === 0) {
    return `From the abstracts of ${papers} ${noun}, all already in your library.`;
  }
  return `From the abstracts of ${papers} ${noun}, ${outsideLibrary} not in your library — add the ones you use.`;
}

/** Nothing the search returned had an abstract to read. Written by the server; no model call. */
export const BEYOND_EMPTY_REPLY =
  'The search found no papers with an abstract to read on this, so there is nothing to answer ' +
  'from. Try naming the method, the material or the population rather than asking a question.';

/**
 * A.4's "not enough" reply names the library, which is wrong here: the passages were abstracts
 * the search found. The scripted reply is recognised and replaced, as the panel already treats it
 * as a state rather than as prose.
 */
export const BEYOND_NOT_ENOUGH_REPLY =
  'The abstracts the search found do not answer this. Try naming the method, the material or ' +
  'the population, or use Find papers to look through the results yourself.';
