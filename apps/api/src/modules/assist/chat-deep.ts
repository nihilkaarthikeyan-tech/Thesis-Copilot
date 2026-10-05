/**
 * Deep research in chat — ADR-0080. The pure half: how the parts' library retrievals and search
 * results are merged into one request, and the words the student sees while it works. No model,
 * no database, no network; `ChatService.askDeep` does the wiring, `@tc/ai` holds the two prompts.
 *
 * The rules, each tested in `test/chat-deep.spec.ts`:
 *
 * - **The library's passages are the best over every part, by raw cosine, no paper holding more
 *   than `perSourceCap` while another paper has candidates** (the draft's rule, ADR-0078): a
 *   question answered part by part should hear from more than one paper.
 * - **A found paper joins once**, however many parts' searches returned it; by DOI, else title.
 * - **Every step is shown**, with `params` so the panel can say it in another language.
 */

import type { DeepPart } from '@tc/ai';
import { DEEP_RESEARCH } from '@tc/ai';
import type { RetrievalResult, RetrievedPassage } from '@tc/retrieval';
import type { ResearchStep, ResearchSummary } from './chat-research.js';
import type { WebResult } from './web-scope.service.js';

/** A merged retrieval: the same shape `ContextService.retrieve` returns, over several queries. */
export function mergeRetrievals(
  results: readonly RetrievalResult[],
  topK: number = DEEP_RESEARCH.libraryTopK,
  perSourceCap: number = DEEP_RESEARCH.perSourceCap,
): RetrievalResult {
  const byId = new Map<string, RetrievedPassage>();
  const byKey: RetrievalResult['byKey'] = new Map();
  let pinned = 0;
  let candidates = 0;
  for (const result of results) {
    pinned = Math.max(pinned, result.pinned);
    candidates += result.candidates;
    for (const passage of result.passages) {
      const have = byId.get(passage.id);
      if (!have || passage.cosine > have.cosine) byId.set(passage.id, passage);
    }
    for (const [key, value] of result.byKey) byKey.set(key, value);
  }
  const ranked = [...byId.values()].sort((a, b) => b.cosine - a.cosine);
  const chosen: RetrievedPassage[] = [];
  const held: RetrievedPassage[] = [];
  const count = new Map<string, number>();
  for (const passage of ranked) {
    const n = count.get(passage.sourceId) ?? 0;
    if (n < perSourceCap) {
      chosen.push(passage);
      count.set(passage.sourceId, n + 1);
    } else held.push(passage);
  }
  const passages = [...chosen, ...held].slice(0, topK);
  const kept = new Set(passages.map((p) => p.id));
  for (const key of [...byKey.keys()]) if (!kept.has(key)) byKey.delete(key);
  return { passages, byKey, pinned, candidates };
}

/** The parts' search results as one list: a paper once, not in the library, with an abstract. */
export function mergeCandidates(
  lists: readonly (readonly WebResult[])[],
  max: number = DEEP_RESEARCH.maxCandidates,
): WebResult[] {
  const seen = new Set<string>();
  const out: WebResult[] = [];
  for (const list of lists) {
    for (const result of list) {
      if (out.length >= max) return out;
      if (result.inLibrary) continue;
      if ((result.abstract ?? '').trim().length < 80 || !result.title.trim()) continue;
      // One index gives the DOI and another does not: the same paper either way.
      const keys = [
        ...(result.doi?.trim() ? [`d:${result.doi.trim().toLowerCase()}`] : []),
        `t:${result.title.trim().toLowerCase()}`,
      ];
      if (keys.some((k) => seen.has(k))) continue;
      for (const k of keys) seen.add(k);
      out.push(result);
    }
  }
  return out;
}

/** The parts' questions, for the embedding that decides which found abstracts are kept. */
export function partQuestions(plan: readonly DeepPart[]): string[] {
  return plan.map((part) => `${part.title}. ${part.question}`.replace(/\s+/g, ' ').trim());
}

/**
 * A candidate's relevance: the best cosine against the whole question and against each part.
 * `vectors` is the embedding call's answer in the order it was asked: the question, the parts,
 * then the candidates.
 */
export function bestCosines(
  vectors: readonly number[][],
  partCount: number,
  candidateCount: number,
  cosine: (a: readonly number[], b: readonly number[]) => number,
): number[] {
  const asked = vectors.slice(0, 1 + partCount);
  const out: number[] = [];
  for (let i = 0; i < candidateCount; i++) {
    const vector = vectors[1 + partCount + i] ?? [];
    out.push(asked.reduce((best, a) => Math.max(best, cosine(a, vector)), 0));
  }
  return out;
}

export type DeepStep =
  | ResearchStep
  | { id: 'plan' | 'planned' | 'part'; text: string; params: Record<string, string | number> };

export const PLANNING_STEP: DeepStep = {
  id: 'plan',
  text: 'Planning the research…',
  params: {},
};

export function plannedStep(plan: readonly DeepPart[]): DeepStep {
  const titles = plan.map((p) => p.title).join(' · ');
  return {
    id: 'planned',
    text: `Planned ${plan.length} part${plan.length === 1 ? '' : 's'}: ${titles}`,
    params: { parts: plan.length, titles },
  };
}

export function partStep(index: number, total: number, part: DeepPart): DeepStep {
  return {
    id: 'part',
    text: `Part ${index + 1} of ${total}, ${part.title}: searching your library and the indexes for: ${part.query}…`,
    params: { index: index + 1, total, title: part.title, query: part.query },
  };
}

export const DEEP_WRITING_STEP = 'Writing the answer, part by part…';

/** What the student is told when neither the library nor the searches had anything. */
export const DEEP_EMPTY_REPLY =
  'Neither your library nor a search of the literature had anything on this. ' +
  'Try asking it in different words, or add sources on it first.';

/** The line under a deep answer. */
export function deepNote(libraryPapers: number, found: number): string {
  const lib = `${libraryPapers} paper${libraryPapers === 1 ? '' : 's'} in your library`;
  if (found === 0) return `From ${lib}; the searches found nothing closer to the question.`;
  const add = `${found} found by the searches, not in your library — add the ones you use`;
  return `From ${lib} and the abstracts of ${add}.`;
}

/** ADR-0080: a research summary that also carries the plan. */
export type DeepSummary = ResearchSummary & {
  deep: true;
  plan: Array<{ title: string; question: string }>;
  libraryPapers: number;
};
