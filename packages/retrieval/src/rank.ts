/**
 * Retrieval ranking — PRD §10.4, verbatim:
 *
 *   query      = embed(lastSentence(before) + " " + chapter.scopeNote)
 *   candidates = SourceChunk WHERE source.documentId = :doc
 *                AND (pins empty OR source.id IN pins)
 *                ORDER BY embedding <=> :query LIMIT 24
 *   rerank     = cosine + 0.15 * (source.subTheme == chapter.subTheme)
 *                       + 0.1  * (groundingLevel == FULL_TEXT)
 *   top_k      = first 6 (Assist) / 12 (Draft) / 8 (Chat)
 *
 * The pgvector query lives in `pgvector.ts`; the parts that are pure arithmetic live here so they
 * can be tested without a database.
 */

import { splitSentences } from './text.js';

export const CANDIDATE_LIMIT = 24;

/** §10.4 top_k per action. */
export const TOP_K = { ASSIST: 6, DRAFT: 12, CHAT: 8 } as const;
export type RetrievalAction = keyof typeof TOP_K;

export const SUB_THEME_BOOST = 0.15;
export const FULL_TEXT_BOOST = 0.1;

export type Candidate = {
  chunkId: string;
  sourceId: string;
  /** Cosine similarity in [0, 1] (1 − cosine distance from pgvector). */
  cosine: number;
  subTheme: string | null;
  groundingLevel: 'NONE' | 'ABSTRACT' | 'FULL_TEXT';
  text: string;
  page: number | null;
  /** Short reference for the passage tag, e.g. "Kumar 2021". */
  shortRef?: string;
  /** ADR-0076: what the source's standing is, for `credibility`. Absent means unknown. */
  citationCount?: number | null;
  isPreprint?: boolean;
  venueCitedness?: number | null;
  year?: number | null;
};

/**
 * ADR-0076: a small, bounded adjustment for how much a source has been taken up by its field.
 *
 * Found in the side-by-side study (2026-10-05): both tools' top result for a Karnataka rooftop-
 * solar thesis was a month-old paper with no citations, by a school student, in a journal with a
 * citedness of 0.2 — and our autocomplete leaned on it as its main evidence.
 *
 * Relevance still decides: the whole range (−0.08 to +0.05) is smaller than the sub-theme boost
 * and far smaller than the gap between an on-topic and an off-topic passage. It reorders passages
 * that are about equally relevant; it never brings in one that is not. New work is not punished
 * for being new: the "uncited" penalty applies only after two years without a citation.
 */
export function credibility(
  source: {
    citationCount?: number | null;
    isPreprint?: boolean;
    venueCitedness?: number | null;
    year?: number | null;
  },
  now: Date = new Date(),
): number {
  let adjustment = 0;
  if (source.isPreprint) adjustment -= CREDIBILITY.preprint;
  const age = source.year ? now.getUTCFullYear() - source.year : null;
  if (source.citationCount === 0 && age !== null && age >= 2) adjustment -= CREDIBILITY.uncited;
  if ((source.citationCount ?? 0) >= 20) adjustment += CREDIBILITY.wellCited;
  const venue = source.venueCitedness;
  if (typeof venue === 'number') {
    if (venue < 0.5) adjustment -= CREDIBILITY.weakVenue;
    else if (venue >= 2) adjustment += CREDIBILITY.strongVenue;
  }
  return Math.max(-0.08, Math.min(0.05, adjustment));
}

export const CREDIBILITY = {
  preprint: 0.05,
  uncited: 0.03,
  weakVenue: 0.03,
  wellCited: 0.03,
  strongVenue: 0.02,
} as const;

export type RankedCandidate = Candidate & { score: number };

/** The query text §10.4 embeds: the last sentence before the cursor plus the chapter scope note. */
export function buildQueryText(before: string, scopeNote: string | null | undefined): string {
  const sentences = splitSentences(before);
  const last = sentences.at(-1)?.text.trim() ?? before.trim();
  return [last, scopeNote?.trim()].filter(Boolean).join(' ').trim();
}

/** §10.4 rerank, applied to the 24 candidates the vector query returned. */
export function rerank(
  candidates: readonly Candidate[],
  chapterSubTheme: string | null | undefined,
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      let score = candidate.cosine;
      if (chapterSubTheme && candidate.subTheme && candidate.subTheme === chapterSubTheme) {
        score += SUB_THEME_BOOST;
      }
      if (candidate.groundingLevel === 'FULL_TEXT') score += FULL_TEXT_BOOST;
      score += credibility(candidate);
      return { ...candidate, score };
    })
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
}

export function topK(
  ranked: readonly RankedCandidate[],
  action: RetrievalAction,
): RankedCandidate[] {
  const k = TOP_K[action];
  const cap = PER_SOURCE_CAP[action];
  if (cap === undefined) return ranked.slice(0, k);
  // ADR-0078: a section draft synthesises across papers. In rank order, each paper keeps at most
  // `cap` places while another paper's passages wait; slots no other paper can fill go back to
  // the best of the rest, so a library of one paper still fills the request.
  const chosen: RankedCandidate[] = [];
  const held: RankedCandidate[] = [];
  const count = new Map<string, number>();
  for (const candidate of ranked) {
    const n = count.get(candidate.sourceId) ?? 0;
    if (n < cap) {
      chosen.push(candidate);
      count.set(candidate.sourceId, n + 1);
    } else held.push(candidate);
  }
  return [...chosen, ...held].slice(0, k);
}

/**
 * ADR-0078: the most passages one paper may hold in a draft's request while other papers have
 * candidates. The real-model run of 2026-10-05 drafted "Barriers to adoption" with 12 of 14
 * citations to one paper from a library of four full-text papers.
 */
export const PER_SOURCE_CAP: Partial<Record<RetrievalAction, number>> = { DRAFT: 4 };

/**
 * The cosine below which a question is not about the student's library at all.
 *
 * This is what stops the chat box being a general-purpose chatbot. A.4 already tells the model to
 * answer only from the passages it is given, and `postProcessChat` strips any citation the model
 * was not shown — but both of those are downstream of a provider call that has already been made
 * and charged. Nothing refused an off-topic question before it cost the student a metered unit,
 * and nothing but the model's own obedience stopped it answering from general knowledge.
 *
 * **Measured, not chosen.** Four library passages on one subject, fifteen questions, `voyage-3`,
 * 2026-09-14:
 *
 * | | best cosine against the library |
 * |---|---|
 * | On topic, must be answered | 0.345 – 0.595 |
 * | In the subject area, but the library has nothing on it | 0.302 – 0.427 |
 * | Off topic, must be refused | 0.003 – 0.254 |
 *
 * 0.30 sits in the gap: above every off-topic question, below every on-topic one. "What's the
 * weather in Chennai today?" was the closest thing to a false negative at 0.254, and a poem about
 * the sea scored 0.003.
 *
 * The middle row is why this is a floor on relevance and not an answer to "is it in the library".
 * A question about net metering is a perfectly good question that this library cannot answer, and
 * the right reply is A.4's "Your library does not contain enough on this. Try adding sources on:
 * …" — which needs the model, because naming the missing topic is the useful half. Those are meant
 * to pass the floor and be refused by the prompt. Only questions that are nowhere near the subject
 * are stopped here.
 *
 * **The evidence is thin and should be widened.** Fifteen questions on one subject area is enough
 * to place a threshold in an obvious gap, and not enough to know the gap is there for every
 * discipline. `docs/PENDING.md` carries this; the five fixture papers are what would settle it.
 * Erring low is deliberate: a false refusal is a student told their library is off-topic when it
 * is not, which is worse than a wasted call.
 */
export const RELEVANCE_FLOOR = 0.3;

/**
 * Whether a retrieved set says anything about the question.
 *
 * Reads `cosine` rather than `score` on purpose: §10.4's sub-theme and full-text boosts add up to
 * 0.25, which is most of the distance between the two populations above. A wholly irrelevant
 * passage from a full-text source with a matching sub-theme would clear a floor applied to `score`
 * on the boosts alone.
 */
export function isOffTopic(
  passages: readonly { cosine: number }[],
  floor: number = RELEVANCE_FLOOR,
): boolean {
  return passages.every((passage) => passage.cosine < floor);
}

/**
 * The id the model sees on a passage — §10.4: "Chunks are passed to the model with an id:
 * `[S3#c12] <text>`". The same id must come back in `{{cite:...}}` or it is stripped as a
 * hallucination (§10.6), so this and the whitelist must agree.
 */
export function passageId(sourceId: string, chunkId: string): string {
  return `S${sourceId}#c${chunkId}`;
}

/** Parses a passage id back into its parts; null if it is not one we issued. */
export function parsePassageId(id: string): { sourceId: string; chunkId: string } | null {
  const match = /^S(.+)#c(.+)$/.exec(id);
  if (!match?.[1] || !match[2]) return null;
  return { sourceId: match[1], chunkId: match[2] };
}

/**
 * §10.6 citation whitelist: any `{{cite:ID}}` whose id is not in the retrieved set is stripped and
 * counted as `HALLUCINATED_CITE`. Returns the cleaned text and the ids that were removed.
 */
export function stripUnknownCitations(
  text: string,
  allowedIds: ReadonlySet<string>,
): { text: string; hallucinated: string[] } {
  const hallucinated: string[] = [];
  const cleaned = text.replace(/\{\{cite:([^}]+)\}\}/g, (whole, id: string) => {
    if (allowedIds.has(id)) return whole;
    hallucinated.push(id);
    return '';
  });
  return { text: cleaned, hallucinated };
}
