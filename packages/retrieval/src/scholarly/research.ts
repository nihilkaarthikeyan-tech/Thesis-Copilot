/**
 * Chat that researches when the library is thin — ADR-0074 (2026-10-05, side-by-side item C2).
 *
 * The pure half: when a library question has too little to stand on, and what to search for when
 * it does. No model, no network, no database. `ChatService` does the wiring.
 *
 * Asked the same question, Jenni searched the literature itself and answered in six headed
 * sections with ten citations; ours answered from the five papers in the library with two. The
 * difference was not the model but what it was given. This decides when a question needs more
 * than the library holds, and plans the searches without a model call: a query planner made of a
 * model would be a second metered call for every thin question, and the indexes' own behaviour
 * (OpenAlex ranks natural language, PubMed ANDs every term) is what the plan has to fit.
 */

import { keywordsOf } from './keywords.js';

export const CHAT_RESEARCH = {
  /**
   * A library passage at or above this cosine is "on the question". Measured 2026-10-05 on the dev
   * libraries with voyage-4 (`apps/api/scripts/chat-research-thresholds.ts`, docs/BUILD_LOG.md):
   * every in-subject question's top eight passages clear 0.55 when the library has anything on it
   * (best cosines 0.60–0.87); the net-metering question a ten-paper library barely covers had four
   * at 0.55 and none at 0.60; off-topic questions were all under 0.30.
   */
  onTopicCosine: 0.55,
  /** Fewer on-topic passages than this is thin. */
  minOnTopicPassages: 4,
  /**
   * On-topic passages from fewer distinct papers than this is thin: the answer could cite at most
   * that many. Measured: a five-paper library put three papers in the top eight for every question
   * (the side-by-side's library, whose answer cited two); the ten-paper library put five to seven.
   */
  minSources: 4,
  /**
   * A found abstract is kept at or above this cosine against the thesis title and the question
   * (`ResearchPlan.semantic`, the shape `find-sources` scores against). Measured on the real
   * indexes (PubMed and arXiv; OpenAlex answered 429 on the dev machine): the abstracts a reader
   * would call on the question scored 0.61–0.81 (rooftop-solar barriers, AlphaFold2, solar fish
   * dryers); the off-field ones — mortgage lending for a solar-credit question, rural-women health
   * studies for a solar-decision question, electric stoves — scored 0.53–0.58.
   */
  keepCosine: 0.6,
  /** Abstracts added to the library's passages, at most. */
  maxAbstracts: 6,
  /** Candidates embedded, at most: bounds the embedding spend of one question. */
  maxCandidates: 24,
  /** Each candidate is embedded as its title and the start of its abstract, cut here. */
  embedChars: 1_200,
  /**
   * The wall-clock bound of the search. A student is watching: the first-session search's budget
   * (ADR-0070), not the literature search's.
   */
  budget: { perCallMs: 8_000, perIndexMs: 12_000 },
} as const;

/** Words a student asks with that describe the asking, not the subject. */
const QUESTION_NOISE = new Set(
  (
    'according sources source main key major primary important mentioned mention discuss ' +
    'discussed describe explain list summarise summarize summary overview give tell regarding ' +
    'concerning based current currently'
  ).split(' '),
);

export type LibraryCoverage = {
  best: number;
  /** Passages at or above `onTopicCosine`. */
  onTopic: number;
  /** Distinct papers among them. */
  sources: number;
  thin: boolean;
  /** Which test made it thin, for the log and the step text. */
  reason: 'few-passages' | 'few-sources' | null;
};

/**
 * Whether the library holds enough on this question to answer it well on its own.
 *
 * Reads the raw cosine, never the boosted score, for the reason `isOffTopic` gives. A question
 * below the relevance floor is not "thin", it is off topic, and that refusal is decided before
 * this is asked.
 */
export function libraryCoverage(
  passages: readonly { cosine: number; sourceId: string }[],
  limits: Pick<
    typeof CHAT_RESEARCH,
    'onTopicCosine' | 'minOnTopicPassages' | 'minSources'
  > = CHAT_RESEARCH,
): LibraryCoverage {
  const best = passages.reduce((m, p) => Math.max(m, p.cosine), 0);
  const on = passages.filter((p) => p.cosine >= limits.onTopicCosine);
  const sources = new Set(on.map((p) => p.sourceId)).size;
  const reason =
    on.length < limits.minOnTopicPassages
      ? ('few-passages' as const)
      : sources < limits.minSources
        ? ('few-sources' as const)
        : null;
  return { best, onTopic: on.length, sources, thin: reason !== null, reason };
}

export type ResearchPlan = {
  /** For OpenAlex's semantic search, which ranks meaning: the thesis, then the question. */
  semantic: string;
  /** For every keyword index, most specific first; one or two, never the same twice. */
  keyword: string[];
};

/**
 * The searches for a thin question, without a model.
 *
 * - **Semantic** (OpenAlex only): the thesis title and the question as written. The title leads
 *   for the reason `find-sources` gives: without it a question about "electrode wear" finds
 *   batteries.
 * - **Keyword, full**: the question's content words, at most eight, in the student's order.
 * - **Keyword, short**: the first four of them, when there were more than four. PubMed ANDs every
 *   term and an index matches a long query against every word, so the long query can return
 *   almost nothing (one usable paper for an EDM thesis, 2026-09-30); the short one finds the
 *   subject, and every result is scored against the whole question afterwards anyway.
 */
export function planResearchQueries(question: string, thesisTitle: string): ResearchPlan {
  const words = keywordsOf(question, 8, QUESTION_NOISE);
  const full = words.join(' ');
  const short = words.length > 4 ? words.slice(0, 4).join(' ') : '';
  const keyword = [full, short].filter((q, i, all) => q.length > 0 && all.indexOf(q) === i);
  const title = thesisTitle.trim();
  const asked = question.trim().replace(/\s+/g, ' ');
  return {
    semantic: (title ? `${title}. ${asked}` : asked).slice(0, 2_000),
    keyword,
  };
}

/** What a candidate is embedded as: the title, then the start of the abstract. */
export function researchEmbedText(work: { title: string; abstract: string | null }): string {
  return `${work.title}. ${work.abstract ?? ''}`
    .replace(/\s+/g, ' ')
    .slice(0, CHAT_RESEARCH.embedChars);
}
