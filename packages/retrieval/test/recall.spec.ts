/**
 * Retrieval recall — PRD Appendix C.4, the runner and its arithmetic.
 *
 * Two halves, like the C.5 golden set:
 *
 *  1. The scorer, tested against chunks and rankings made here. Runs everywhere, needs nothing.
 *  2. The real run over `fixtures/retrieval/qa.json`, which reports BLOCKED until the human writes
 *     it — §0.3 rule 2 forbids the agent inventing the questions it would then be marked against.
 *
 * The property worth the most care is in `scoreRecall`: a quote that matches no chunk stays in the
 * denominator. Dropping it would make the score rise every time the chunker lost a passage, which
 * is exactly the failure the measurement exists to catch.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOP_K } from '../src/rank.js';
import {
  C4_RECALL_THRESHOLD,
  formatRecallReport,
  type IndexedChunk,
  locateQuote,
  normaliseForQuote,
  type QaQuestion,
  QUESTIONS_PER_PAPER,
  readQaSet,
  scoreQuestion,
  scoreRecall,
} from '../src/recall.js';

const QA_PATH = fileURLToPath(new URL('../../../fixtures/retrieval/qa.json', import.meta.url));

const chunk = (chunkId: string, text: string, sourceId = 's1'): IndexedChunk => ({
  chunkId,
  sourceId,
  text,
});

const question = (over: Partial<QaQuestion> = {}): QaQuestion => ({
  paper: 'p01',
  question: 'What was the main barrier to adoption?',
  page: 7,
  quote: 'Upfront cost was reported by 78% of households as the main barrier.',
  ...over,
});

const CHUNKS = [
  chunk('c1', 'The study surveyed 312 households across four districts in Karnataka.'),
  chunk(
    'c2',
    'Upfront cost was reported by 78% of households as the main barrier. Awareness mattered less.',
  ),
  chunk('c3', 'Siting decisions were dominated by distance to the nearest grid connection.'),
];

describe('normaliseForQuote', () => {
  it('collapses the line breaks PDF extraction leaves behind', () => {
    expect(normaliseForQuote('Upfront   cost\nwas  reported')).toBe('Upfront cost was reported');
  });

  it('trims, and leaves everything else exactly as written', () => {
    // No case folding and no punctuation stripping: C.4 says exact substring, and a quote that
    // matched a differently-punctuated passage would label the wrong chunk.
    expect(normaliseForQuote('  Cost, mainly.  ')).toBe('Cost, mainly.');
    expect(normaliseForQuote('UPPER lower')).toBe('UPPER lower');
  });
});

describe('locateQuote', () => {
  it('finds the chunk containing the quote', () => {
    expect(locateQuote(question().quote, CHUNKS)?.chunkId).toBe('c2');
  });

  it('finds it across a line break in either the quote or the chunk', () => {
    const wrapped = [chunk('c9', 'Upfront cost was\nreported by 78% of\nhouseholds.')];
    expect(locateQuote('Upfront cost was reported by 78% of households.', wrapped)?.chunkId).toBe(
      'c9',
    );
    expect(locateQuote('Upfront cost was\n  reported', wrapped)?.chunkId).toBe('c9');
  });

  it('returns null when no chunk contains it — a chunker fault, not a miss', () => {
    expect(locateQuote('A sentence that is in no chunk whatsoever.', CHUNKS)).toBe(null);
  });

  it('does not match a passage that merely resembles the quote', () => {
    // The one thing this must never become is fuzzy. A near-match would label the wrong chunk and
    // the recall figure would be measuring something else entirely.
    expect(locateQuote('Upfront cost was reported by 87% of households.', CHUNKS)).toBe(null);
  });

  it('returns null for an empty quote rather than matching the first chunk', () => {
    expect(locateQuote('   ', CHUNKS)).toBe(null);
  });

  it('returns the first chunk when two contain the quote', () => {
    const twice = [chunk('a', 'shared sentence here and more'), chunk('b', 'shared sentence here')];
    expect(locateQuote('shared sentence here', twice)?.chunkId).toBe('a');
  });
});

describe('scoreQuestion', () => {
  it('is a hit when the labelled chunk is among the retrieved, and records its rank', () => {
    const outcome = scoreQuestion(question(), chunk('c2', ''), ['c5', 'c2', 'c7']);
    expect(outcome.hit).toBe(true);
    expect(outcome.rank).toBe(2);
  });

  it('is a miss when it is not, with no rank', () => {
    const outcome = scoreQuestion(question(), chunk('c2', ''), ['c5', 'c7']);
    expect(outcome.hit).toBe(false);
    expect(outcome.rank).toBe(null);
  });

  it('is a miss when the quote was never located', () => {
    const outcome = scoreQuestion(question(), null, ['c1', 'c2', 'c3']);
    expect(outcome.hit).toBe(false);
    expect(outcome.labelledChunkId).toBe(null);
  });
});

describe('scoreRecall', () => {
  const outcomes = (hits: number, total: number, paper = 'p01') =>
    Array.from({ length: total }, (_, i) =>
      scoreQuestion(
        question({ paper, question: `q${i}` }),
        chunk(`c${i}`, ''),
        i < hits ? [`c${i}`] : ['other'],
      ),
    );

  it('is hits over questions', () => {
    const score = scoreRecall(outcomes(8, 10));
    expect(score.hits).toBe(8);
    expect(score.questions).toBe(10);
    expect(score.recall).toBeCloseTo(0.8, 5);
  });

  it(`passes at exactly the ${C4_RECALL_THRESHOLD} threshold`, () => {
    expect(scoreRecall(outcomes(8, 10)).passes).toBe(true);
    expect(scoreRecall(outcomes(7, 10)).passes).toBe(false);
  });

  it('names the threshold it failed against', () => {
    const score = scoreRecall(outcomes(5, 10));
    expect(score.failures.join(' ')).toContain('recall@6 0.500');
    expect(score.failures.join(' ')).toContain(String(C4_RECALL_THRESHOLD));
  });

  it('keeps an unlocated quote in the denominator', () => {
    // Nine hits out of ten questions, one of which the chunker lost. Dropping it would report
    // 9/9 = 1.000 and hide the fault; the honest figure is 9/10.
    const rows = [
      ...outcomes(9, 9),
      scoreQuestion(question({ question: 'lost' }), null, ['a', 'b']),
    ];
    const score = scoreRecall(rows);
    expect(score.questions).toBe(10);
    expect(score.recall).toBeCloseTo(0.9, 5);
  });

  it('fails on an unlocated quote even when recall clears the bar', () => {
    const rows = [
      ...outcomes(9, 9),
      scoreQuestion(question({ question: 'lost' }), null, ['a', 'b']),
    ];
    const score = scoreRecall(rows);
    expect(score.recall).toBeGreaterThan(C4_RECALL_THRESHOLD);
    expect(score.passes).toBe(false);
    expect(score.failures.join(' ')).toContain('fix the chunker, not the fixture');
  });

  it('separates a chunking fault from a retrieval miss', () => {
    const rows = [
      scoreQuestion(question({ question: 'found but not retrieved' }), chunk('c1', ''), ['zz']),
      scoreQuestion(question({ question: 'never located' }), null, ['zz']),
    ];
    const score = scoreRecall(rows);
    // They call for different work, so they are counted apart.
    expect(score.missed.map((o) => o.question)).toEqual(['found but not retrieved']);
    expect(score.unlocated.map((o) => o.question)).toEqual(['never located']);
  });

  it('reports recall per paper, so one bad paper is not averaged away', () => {
    const score = scoreRecall([...outcomes(6, 6, 'p01'), ...outcomes(1, 6, 'p02')]);
    expect(score.byPaper).toEqual([
      { paper: 'p01', questions: 6, hits: 6, recall: 1 },
      { paper: 'p02', questions: 6, hits: 1, recall: 1 / 6 },
    ]);
    // The average clears nothing, but the per-paper split says where to look.
    expect(score.passes).toBe(false);
  });

  it('fails an empty set rather than reporting a perfect score of nothing', () => {
    const score = scoreRecall([]);
    expect(score.recall).toBe(0);
    expect(score.passes).toBe(false);
    expect(score.failures.join(' ')).toContain('no questions');
  });
});

describe('formatRecallReport', () => {
  it('gives a per-paper table, the total and the verdict', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      scoreQuestion(question({ question: `q${i}` }), chunk(`c${i}`, ''), [`c${i}`]),
    );
    const report = formatRecallReport(scoreRecall(rows));
    expect(report).toContain('| paper | questions | hits | recall |');
    expect(report).toContain('p01');
    expect(report).toContain('**all**');
    expect(report).toContain('PASS');
  });

  it('names the questions a failing run missed, and says which kind each is', () => {
    const report = formatRecallReport(
      scoreRecall([
        scoreQuestion(question({ question: 'not retrieved' }), chunk('c1', ''), ['zz']),
        scoreQuestion(question({ question: 'no chunk has it' }), null, ['zz']),
      ]),
    );
    expect(report).toContain('Not in the top six:');
    expect(report).toContain('not retrieved');
    expect(report).toContain('Quote in no chunk');
    expect(report).toContain('no chunk has it');
    expect(report).toContain('FAIL');
  });
});

describe('readQaSet', () => {
  it('accepts a well-formed set', () => {
    const set = readQaSet({ questions: [question()] });
    expect(set.questions).toHaveLength(1);
  });

  it('refuses a question with no page, so the human can find the passage again', () => {
    expect(() => readQaSet({ questions: [{ ...question(), page: undefined }] })).toThrow();
  });

  it('refuses a quote too short to be unique in a paper', () => {
    expect(() => readQaSet({ questions: [{ ...question(), quote: 'cost' }] })).toThrow();
  });

  it('refuses an empty set', () => {
    expect(() => readQaSet({ questions: [] })).toThrow();
  });
});

describe('the fixture itself (C.4)', () => {
  const present = existsSync(QA_PATH);

  it.skipIf(!present)('is well-formed and covers each paper six times', () => {
    const set = readQaSet(JSON.parse(readFileSync(QA_PATH, 'utf8')));
    const byPaper = new Map<string, number>();
    for (const q of set.questions) byPaper.set(q.paper, (byPaper.get(q.paper) ?? 0) + 1);
    for (const [paper, count] of byPaper) {
      expect(count, `${paper} has ${count} questions`).toBe(QUESTIONS_PER_PAPER);
    }
    expect(set.questions).toHaveLength(byPaper.size * QUESTIONS_PER_PAPER);
  });

  it.skipIf(present)('is not written yet', () => {
    // Not a failure: the questions are the human's judgement of what a paper answers, and §0.3
    // rule 2 forbids the agent inventing them. `docs/PENDING.md` carries the task.
    console.log(
      'BLOCKED: fixtures/retrieval/qa.json does not exist yet — see fixtures/retrieval/README.md',
    );
    expect(present).toBe(false);
  });
});

describe('C.4 measures the Assist path, not a number chosen for it', () => {
  it('recall@6 is the top-k Assist actually uses', () => {
    // If §10.4's Assist k ever changes, this measurement is measuring something the product no
    // longer does, and the fixture's name stops being true.
    expect(TOP_K.ASSIST).toBe(6);
  });
});
