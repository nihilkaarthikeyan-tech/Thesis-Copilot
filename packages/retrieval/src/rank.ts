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
};

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
      return { ...candidate, score };
    })
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
}

export function topK(
  ranked: readonly RankedCandidate[],
  action: RetrievalAction,
): RankedCandidate[] {
  return ranked.slice(0, TOP_K[action]);
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
