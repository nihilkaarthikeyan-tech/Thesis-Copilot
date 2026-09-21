/**
 * Accidental paraphrase — "this sentence is very close to Kumar 2021" (2026-09-21).
 *
 * A student reads a paper, takes notes, writes a chapter weeks later, and reproduces a sentence
 * more closely than they realise. Nobody involved intended anything; a similarity report at
 * submission calls it plagiarism anyway. This finds it while it is still cheap to fix.
 *
 * ## This is the opposite of a detector-evasion feature
 *
 * PRD §12.3 bans "humanise" tooling outright, and that ban is not in tension with this. The only
 * advice this can ever give is **add attribution**: quote it, cite it, or write it in your own
 * words *and still cite it*. It never rewrites anything, never offers to, and never reports a
 * "similarity score" a student could optimise downwards. A feature that helped someone slip past
 * a checker would be the same feature with the advice inverted, and that is exactly what makes
 * the distinction worth stating in the code rather than only in a document.
 *
 * ## Why lexical overlap and not embeddings
 *
 * The obvious build is cosine similarity against the indexed chunks. It is the wrong instrument.
 * Cosine measures whether two passages are *about the same thing* — and in a literature review
 * every sentence is about the same thing as some chunk, so it would fire constantly on perfectly
 * original prose. Close paraphrase is a **lexical** event: the words are the same, in the same
 * order.
 *
 * Shingle overlap is what similarity checkers actually use, and it has three properties that
 * matter more here than sophistication would:
 *
 *   - **It is free.** No embedding call, so no cost, no cap, and nothing to meter — which also
 *     means it cannot be throttled by the Voyage rate limit.
 *   - **It is deterministic**, so it can be tested without fixture papers.
 *   - **It is explainable.** The finding can quote the overlapping words back, and a student can
 *     see for themselves whether it is fair. A cosine of 0.87 explains nothing.
 */

/** Words per shingle. Five is the plagiarism-detection convention: trigrams fire on idiom. */
export const SHINGLE = 5;

/**
 * Function words, which pad a run without making it distinctive.
 *
 * Used *only* to judge whether a shared run is meaningful — never to build the shingles, where
 * stopwords are the signal (see `words`). The distinction matters: "it has been shown that the
 * effect of the" is nine identical words and says nothing about copying, while "in districts
 * without a local service presence" is seven and is somebody's phrase.
 */
const FUNCTION_WORDS = new Set(
  (
    'a an the this that these those of in on at to for from by with within without into over under ' +
    'and or but nor so yet as if then than because is are was were be been being has have had do ' +
    'does did will would can could may might must shall should it its they them their there here ' +
    'we our us you your he she his her not no all any some each both more most other such only own ' +
    'same too very just about after before during while between among across through when where ' +
    'which who whom whose what how why'
  )
    .split(' ')
    .filter(Boolean),
);

export function contentWords(tokens: readonly string[]): string[] {
  return tokens.filter((token) => !FUNCTION_WORDS.has(token) && token.length > 2);
}

export const PARAPHRASE = {
  /**
   * How many *content* words a shared run must carry before it means anything.
   *
   * This, not raw length, is the real test — and it was found by a test rather than reasoned out
   * in advance. An eight-word bar on total length flagged "it has been shown that the effect of
   * the" (nine words, two of them content) and missed "in districts without a local service
   * presence" (seven words, four of them content). The second is somebody's phrasing; the first
   * is how academics write sentences.
   */
  minContentRun: 4,
  /** Total length at which a run with enough content is called verbatim rather than close. */
  minVerbatimRun: 8,
  /**
   * Sentences shorter than this are never flagged.
   *
   * A twelve-word sentence has eight shingles; below that, one shared clause is a third of the
   * sentence and the ratio stops meaning anything.
   */
  minWords: 12,
} as const;

export type ParaphraseMatch = {
  sentenceId: string;
  chapterId: string;
  /** Character range in the chapter, so the editor can select it. */
  from: number;
  to: number;
  sentence: string;
  sourceId: string;
  chunkId: string;
  shortRef: string;
  page: number | null;
  /** The passage it resembles, trimmed around the overlap. */
  passage: string;
  /** The longest run of identical words, as it appears in the student's sentence. */
  overlapText: string;
  overlapWords: number;
  /** Share of the sentence's shingles also present in the passage, 0–1. */
  overlap: number;
  /** `verbatim` is a long identical run; `close` is a reworded passage. */
  kind: 'verbatim' | 'close';
};

/**
 * Words, lowercased, punctuation dropped.
 *
 * Deliberately not stemmed and not stopword-filtered. Stopwords are exactly what distinguishes a
 * copied sentence from an independently written one on the same subject — two authors choosing
 * "of the" in the same nine places is the signal, not noise.
 */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function shingles(tokens: readonly string[], size = SHINGLE): string[] {
  if (tokens.length < size) return [];
  const out: string[] = [];
  for (let i = 0; i + size <= tokens.length; i += 1) out.push(tokens.slice(i, i + size).join(' '));
  return out;
}

/** The longest run of words appearing identically and consecutively in both, in order. */
export function longestCommonRun(
  a: readonly string[],
  b: readonly string[],
): {
  length: number;
  aStart: number;
} {
  if (a.length === 0 || b.length === 0) return { length: 0, aStart: 0 };
  // Rolling two rows rather than a full matrix: a chapter against a library is a lot of pairs,
  // and only the previous row is ever read.
  let previous = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  let bestEnd = 0;
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if ((current[j] ?? 0) > best) {
          best = current[j] ?? 0;
          bestEnd = i;
        }
      }
    }
    previous = current;
  }
  return { length: best, aStart: bestEnd - best };
}

export type ChunkForMatch = {
  chunkId: string;
  sourceId: string;
  shortRef: string;
  page: number | null;
  text: string;
};

export type SentenceForMatch = {
  id: string;
  chapterId: string;
  text: string;
  from: number;
  to: number;
  /** A sentence that already cites something is not an accident; it is a citation. */
  hasCitation: boolean;
};

/**
 * An inverted index from shingle to chunk, built once per run.
 *
 * Without it this is every sentence against every chunk, which for a real thesis is millions of
 * string comparisons. With it, only chunks that share an exact five-word sequence are ever
 * compared in full, which for original prose is almost none of them.
 */
export function buildIndex(chunks: readonly ChunkForMatch[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  chunks.forEach((chunk, position) => {
    for (const shingle of new Set(shingles(words(chunk.text)))) {
      const bucket = index.get(shingle);
      if (bucket) bucket.add(position);
      else index.set(shingle, new Set([position]));
    }
  });
  return index;
}

export function findParaphrases(
  sentences: readonly SentenceForMatch[],
  chunks: readonly ChunkForMatch[],
  options: { citedSourceIds?: ReadonlySet<string> } = {},
): ParaphraseMatch[] {
  const index = buildIndex(chunks);
  const chunkWords = chunks.map((chunk) => words(chunk.text));
  const out: ParaphraseMatch[] = [];

  for (const sentence of sentences) {
    // Already attributed: this is what the feature asks for, so finding it is success, not a
    // finding. Skipping it is also what keeps a correctly quoted passage from being nagged about
    // for ever.
    if (sentence.hasCitation) continue;

    const tokens = words(sentence.text);
    if (tokens.length < PARAPHRASE.minWords) continue;

    const sentenceShingles = shingles(tokens);
    if (sentenceShingles.length === 0) continue;

    // How many shingles each candidate chunk shares, from the index alone.
    const hits = new Map<number, number>();
    for (const shingle of new Set(sentenceShingles)) {
      for (const position of index.get(shingle) ?? []) {
        hits.set(position, (hits.get(position) ?? 0) + 1);
      }
    }
    if (hits.size === 0) continue;

    // Only the best candidate is reported. A sentence close to three chunks of the same paper is
    // one problem, and listing it three times is how a useful panel becomes one people close.
    let best: ParaphraseMatch | null = null;
    for (const [position, shared] of hits) {
      const chunk = chunks[position];
      const candidateWords = chunkWords[position];
      if (!chunk || !candidateWords) continue;

      const overlap = shared / sentenceShingles.length;
      const run = longestCommonRun(tokens, candidateWords);
      const runTokens = tokens.slice(run.aStart, run.aStart + run.length);
      const distinctive = contentWords(runTokens).length >= PARAPHRASE.minContentRun;

      // A shared run of distinctive words is the *only* trigger.
      //
      // Shingle overlap was one too, and a test killed it: two sentences of ordinary scaffolding
      // ("it has been shown that the effect of the … on the outcome of interest is …") overlap by
      // 0.65 while sharing two content words. High overlap on function words is how academics
      // write, not how copying looks. The ratio is still reported, because it is informative once
      // something has already qualified — it just cannot qualify anything on its own.
      //
      // What this deliberately does not catch is a *well* paraphrased passage that reuses no
      // phrasing. That is a citation question rather than a plagiarism one, and the coherence
      // engine's UNSUPPORTED_CLAIM is the tool pointed at it.
      if (!distinctive) continue;
      const verbatim = run.length >= PARAPHRASE.minVerbatimRun;

      const match: ParaphraseMatch = {
        sentenceId: sentence.id,
        chapterId: sentence.chapterId,
        from: sentence.from,
        to: sentence.to,
        sentence: sentence.text,
        sourceId: chunk.sourceId,
        chunkId: chunk.chunkId,
        shortRef: chunk.shortRef,
        page: chunk.page,
        passage: chunk.text.slice(0, 400),
        overlapText: runTokens.join(' '),
        overlapWords: run.length,
        overlap: Number(overlap.toFixed(3)),
        kind: verbatim ? 'verbatim' : 'close',
      };
      // Verbatim beats close; within a kind, the longer run wins.
      if (
        !best ||
        (match.kind === 'verbatim' && best.kind === 'close') ||
        (match.kind === best.kind && match.overlapWords > best.overlapWords)
      ) {
        best = match;
      }
    }

    if (best) out.push(best);
  }

  // Worst first: a verbatim run is a different conversation from a close paraphrase.
  return out.sort(
    (a, b) =>
      Number(b.kind === 'verbatim') - Number(a.kind === 'verbatim') ||
      b.overlapWords - a.overlapWords,
  );
}

/** The one sentence to show a student. Never suggests rewording to avoid detection (§12.3). */
export function adviceFor(match: ParaphraseMatch): string {
  return match.kind === 'verbatim'
    ? `${match.overlapWords} words here appear in ${match.shortRef}${match.page ? `, p. ${match.page}` : ''}. If those are their words, put them in quotation marks and cite the page.`
    : `This is close to ${match.shortRef}${match.page ? `, p. ${match.page}` : ''}. Cite it — and if the wording is still theirs, quote it.`;
}
