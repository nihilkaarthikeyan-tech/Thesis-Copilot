/**
 * The passage of an abstract that matches a search — shown under each "Find papers" result
 * (2026-10-04, from the Jenni study, coverage-map row 23).
 *
 * Jenni shows, per result, the lines that match the student's query. We do the same with the one
 * thing every index actually returns, the abstract (OpenAlex's rebuilt from its inverted index,
 * PubMed's, arXiv's summary, Semantic Scholar's), and nothing else: no model, no embedding.
 *
 * The rule is lexical and deliberately plain. The query's content words (`keywordsOf`, the same
 * words the indexes were sent) are matched against each sentence, a word counting when it is the
 * term or the term with a common English ending ("barrier" ↔ "barriers", "adopt" ↔ "adoption").
 * The sentence matching the most distinct terms wins, the earlier on a tie; the sentence after
 * it (or, failing that, before it) joins when it matches a term too and the two stay short.
 *
 * Every passage is a verbatim slice of the abstract it came from — `abstract.slice(start, end)`
 * — so nothing is shown that was not in the fetched record. When nothing in the abstract matches,
 * there is no passage: showing the first sentence under "matches your search" would be a claim
 * the code has not observed.
 */

import { splitSentences } from '../text.js';
import { keywordsOf } from './keywords.js';

export type MatchedPassage = {
  /** Verbatim from the abstract. */
  text: string;
  /** Where the query's terms are in `text`, for emphasis. Ordered, never overlapping. */
  highlights: Array<{ start: number; end: number }>;
  /** The passage was cut out of a longer sentence: the UI shows an ellipsis on that side. */
  clippedStart: boolean;
  clippedEnd: boolean;
};

export const PASSAGE = {
  /** Two sentences together may not exceed this; a single one longer than it is clipped. */
  maxChars: 420,
  /** Query terms considered, as the search itself sends. */
  maxTerms: 8,
} as const;

/** Endings stripped before comparing two words. Longest first. */
const ENDINGS = ['ations', 'ation', 'ions', 'ion', 'ing', 'ies', 'es', 'ed', 's'];

/** "barriers" → "barrier", "adoption" → "adopt"; a short word is left as it is. */
export function stemOf(word: string): string {
  const lower = word.toLowerCase();
  for (const ending of ENDINGS) {
    if (lower.endsWith(ending) && lower.length - ending.length >= 4) {
      return lower.slice(0, -ending.length);
    }
  }
  return lower;
}

type Hit = { start: number; end: number; term: string };

/** Every word of `text` that matches one of `stems`, with its position. */
function hitsIn(text: string, stems: ReadonlyMap<string, string>): Hit[] {
  const hits: Hit[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu)) {
    const word = match[0];
    const term = stems.get(stemOf(word)) ?? stems.get(word.toLowerCase());
    if (term) hits.push({ start: match.index, end: match.index + word.length, term });
  }
  return hits;
}

/**
 * The one or two abstract sentences that best match `query`, or null when there is no abstract
 * or nothing in it matches.
 */
export function matchingPassage(
  abstract: string | null | undefined,
  query: string,
): MatchedPassage | null {
  if (!abstract?.trim()) return null;
  const terms = keywordsOf(query, PASSAGE.maxTerms);
  if (terms.length === 0) return null;
  const stems = new Map<string, string>();
  for (const term of terms) {
    stems.set(stemOf(term), term);
    stems.set(term, term);
  }

  const sentences = splitSentences(abstract).map((sentence) => {
    // Trimmed, but by position, so the slice stays verbatim.
    const lead = sentence.text.length - sentence.text.trimStart().length;
    const start = sentence.start + lead;
    const end = sentence.start + sentence.text.trimEnd().length;
    const hits = hitsIn(abstract.slice(start, end), stems).map((hit) => ({
      ...hit,
      start: hit.start + start,
      end: hit.end + start,
    }));
    return { start, end, hits, score: new Set(hits.map((h) => h.term)).size };
  });

  let best = -1;
  sentences.forEach((sentence, index) => {
    if (sentence.score > 0 && (best < 0 || sentence.score > (sentences[best]?.score ?? 0))) {
      best = index;
    }
  });
  const chosen = sentences[best];
  if (!chosen) return null;

  // A neighbour joins when it matches too and the pair stays short enough to read at a glance.
  let from = chosen;
  let to = chosen;
  for (const neighbour of [sentences[best + 1], sentences[best - 1]]) {
    if (!neighbour || neighbour.score === 0) continue;
    const start = Math.min(chosen.start, neighbour.start);
    const end = Math.max(chosen.end, neighbour.end);
    if (end - start <= PASSAGE.maxChars) {
      from = neighbour.start < chosen.start ? neighbour : chosen;
      to = neighbour.end > chosen.end ? neighbour : chosen;
      break;
    }
  }

  let start = from.start;
  let end = to.end;
  const hits = [...from.hits, ...(to === from ? [] : to.hits)];

  // One sentence longer than the limit (an abstract with no full stops is one "sentence"): a
  // window around its first match, cut at word boundaries.
  if (end - start > PASSAGE.maxChars) {
    const first = hits[0] as Hit;
    const lead = Math.floor(PASSAGE.maxChars / 4);
    let windowStart = Math.max(start, first.start - lead);
    let windowEnd = Math.min(end, windowStart + PASSAGE.maxChars);
    if (windowStart > start) {
      const space = abstract.indexOf(' ', windowStart);
      if (space >= 0 && space < first.start) windowStart = space + 1;
    }
    if (windowEnd < end) {
      const space = abstract.lastIndexOf(' ', windowEnd);
      if (space > first.end) windowEnd = space;
    }
    start = windowStart;
    end = windowEnd;
  }

  const text = abstract.slice(start, end);
  return {
    text,
    highlights: hits
      .filter((hit) => hit.start >= start && hit.end <= end)
      .map((hit) => ({ start: hit.start - start, end: hit.end - start })),
    clippedStart: start > from.start,
    clippedEnd: end < to.end,
  };
}
