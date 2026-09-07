/**
 * Retrieval recall scoring — PRD Appendix C.4, verbatim:
 *
 *   "For each fixture paper the **human** writes 6 questions that the paper answers, each with the
 *    page number and a short quote of the answering passage. The agent maps each quote to a
 *    `SourceChunk` id after indexing (exact substring match; if no chunk contains the quote, the
 *    chunker is wrong — fix the chunker, do not edit the fixture). Metric: recall@6 of the
 *    labelled chunk ≥ 0.80 across the 30 questions, using the retrieval pipeline in §10.4 with no
 *    pins."
 *
 * This is the one measurement that says whether retrieval actually finds the passage a question is
 * about. Everything downstream of it — Assist's grounding, citation suggestion, chat — is only as
 * good as the six chunks that reach the prompt, and a suggestion built on the wrong six is wrong
 * in a way no test of the prompt itself can catch.
 *
 * ## The rule that keeps the number honest
 *
 * A quote that matches no chunk is **not** dropped from the denominator. It is counted as a
 * failure and reported by name, because C.4 says so and because the alternative is a recall figure
 * that improves every time the chunker loses a passage. `unlocated` is fatal on its own: the
 * fixture is the human's, and the code is what gets fixed.
 *
 * The agent never writes `fixtures/retrieval/qa.json` (§0.3 rule 2); this only reads it.
 */

import { z } from 'zod';

/** The threshold C.4 sets. */
export const C4_RECALL_THRESHOLD = 0.8;

/** C.4: six questions per paper, five papers, thirty questions. */
export const QUESTIONS_PER_PAPER = 6;

export const qaQuestionSchema = z.object({
  /** The fixture paper this question is about: `p01` … `p05`. */
  paper: z.string().trim().min(1),
  question: z.string().trim().min(1),
  /** The page the answering passage is on, as printed in the paper. */
  page: z.number().int().positive(),
  /**
   * A short quote of the answering passage — long enough to be unique in the paper, short enough
   * to survive the chunker's boundaries. One or two sentences.
   */
  quote: z.string().trim().min(20),
});
export type QaQuestion = z.infer<typeof qaQuestionSchema>;

export const qaSetSchema = z.object({
  questions: z.array(qaQuestionSchema).min(1),
});
export type QaSet = z.infer<typeof qaSetSchema>;

/** Parses `qa.json`; throws with Zod's own message, because a malformed fixture is the human's. */
export function readQaSet(value: unknown): QaSet {
  return qaSetSchema.parse(value);
}

export type IndexedChunk = {
  chunkId: string;
  sourceId: string;
  text: string;
};

/**
 * Collapses whitespace so a quote survives the line breaks PDF extraction leaves behind.
 *
 * This is not fuzzy matching. C.4 says "exact substring match" and means it — there is no
 * similarity threshold here and there must never be one, or a quote would match a passage that
 * merely resembles it and the labelled chunk would be wrong. All this does is agree with the
 * extractor about what counts as one space.
 */
export function normaliseForQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The chunk containing `quote`, or null when no chunk does.
 *
 * Null is a finding, not an absence: C.4 says a quote that matches nothing means the chunker split
 * the passage, and the chunker is what gets fixed.
 */
export function locateQuote(quote: string, chunks: readonly IndexedChunk[]): IndexedChunk | null {
  const needle = normaliseForQuote(quote);
  if (!needle) return null;
  return chunks.find((chunk) => normaliseForQuote(chunk.text).includes(needle)) ?? null;
}

export type QuestionOutcome = {
  paper: string;
  question: string;
  /** The chunk the quote was found in, or null when the chunker lost it. */
  labelledChunkId: string | null;
  /** The chunk ids the pipeline returned, in rank order. */
  retrievedChunkIds: string[];
  /** 1-based position of the labelled chunk, or null when it was not retrieved. */
  rank: number | null;
  hit: boolean;
};

/**
 * Scores one question: was the labelled chunk among the ones retrieval returned?
 *
 * `retrievedChunkIds` is expected to be the top six, which is what `TOP_K.ASSIST` gives — C.4's
 * recall@6 is the Assist path's own `k`, not a number chosen for the measurement.
 */
export function scoreQuestion(
  question: QaQuestion,
  labelled: IndexedChunk | null,
  retrievedChunkIds: readonly string[],
): QuestionOutcome {
  const index = labelled ? retrievedChunkIds.indexOf(labelled.chunkId) : -1;
  return {
    paper: question.paper,
    question: question.question,
    labelledChunkId: labelled?.chunkId ?? null,
    retrievedChunkIds: [...retrievedChunkIds],
    rank: index >= 0 ? index + 1 : null,
    hit: index >= 0,
  };
}

export type RecallScore = {
  questions: number;
  hits: number;
  /** Questions whose quote is in no chunk at all — a chunker fault, and fatal on its own. */
  unlocated: QuestionOutcome[];
  /** Questions whose chunk was found but did not reach the top six — the recall failures. */
  missed: QuestionOutcome[];
  recall: number;
  threshold: number;
  passes: boolean;
  failures: string[];
  /** Recall per paper, so a single bad paper is visible rather than averaged away. */
  byPaper: Array<{ paper: string; questions: number; hits: number; recall: number }>;
};

export function scoreRecall(outcomes: readonly QuestionOutcome[]): RecallScore {
  const questions = outcomes.length;
  const hits = outcomes.filter((o) => o.hit).length;
  const unlocated = outcomes.filter((o) => o.labelledChunkId === null);
  const missed = outcomes.filter((o) => o.labelledChunkId !== null && !o.hit);
  // Unlocated questions stay in the denominator. Dropping them would raise the score every time
  // the chunker lost a passage, which is precisely backwards.
  const recall = questions === 0 ? 0 : hits / questions;

  const papers = [...new Set(outcomes.map((o) => o.paper))].sort();
  const byPaper = papers.map((paper) => {
    const rows = outcomes.filter((o) => o.paper === paper);
    const paperHits = rows.filter((o) => o.hit).length;
    return {
      paper,
      questions: rows.length,
      hits: paperHits,
      recall: rows.length === 0 ? 0 : paperHits / rows.length,
    };
  });

  const failures: string[] = [];
  if (questions === 0) failures.push('no questions were scored');
  if (recall < C4_RECALL_THRESHOLD) {
    failures.push(`recall@6 ${recall.toFixed(3)} < ${C4_RECALL_THRESHOLD}`);
  }
  for (const row of unlocated) {
    failures.push(
      `${row.paper}: no chunk contains the quote for “${row.question.slice(0, 60)}” — fix the chunker, not the fixture`,
    );
  }

  return {
    questions,
    hits,
    unlocated,
    missed,
    recall,
    threshold: C4_RECALL_THRESHOLD,
    passes: failures.length === 0,
    failures,
    byPaper,
  };
}

/** The table C.4's result goes into the build log as. */
export function formatRecallReport(score: RecallScore): string {
  const header = '| paper | questions | hits | recall |';
  const rule = `|${'-'.repeat(7)}|${'-'.repeat(11)}|${'-'.repeat(6)}|${'-'.repeat(8)}|`;
  const rows = score.byPaper.map((row) =>
    [
      '',
      row.paper.padEnd(5),
      String(row.questions).padStart(9),
      String(row.hits).padStart(4),
      row.recall.toFixed(3).padStart(6),
      '',
    ].join(' | '),
  );
  const total = [
    '',
    '**all**'.padEnd(5),
    String(score.questions).padStart(9),
    String(score.hits).padStart(4),
    score.recall.toFixed(3).padStart(6),
    '',
  ].join(' | ');

  const lines = [
    header,
    rule,
    ...rows,
    total,
    '',
    `recall@6 ${score.recall.toFixed(3)} vs threshold ${score.threshold} — ${
      score.passes ? 'PASS' : 'FAIL'
    }`,
  ];

  // A failing run has to name the questions, or the next person only knows the number moved.
  // The two kinds are kept apart because they call for different work: one is a retrieval
  // problem, the other is a chunking problem.
  if (score.missed.length > 0) {
    lines.push(
      '',
      'Not in the top six:',
      ...score.missed.map((o) => `  ${o.paper}: ${o.question.slice(0, 70)}`),
    );
  }
  if (score.unlocated.length > 0) {
    lines.push(
      '',
      'Quote in no chunk — fix the chunker, not the fixture:',
      ...score.unlocated.map((o) => `  ${o.paper}: ${o.question.slice(0, 70)}`),
    );
  }
  if (score.failures.length > 0)
    lines.push('', 'Failures:', ...score.failures.map((f) => `  ${f}`));
  return lines.join('\n');
}
