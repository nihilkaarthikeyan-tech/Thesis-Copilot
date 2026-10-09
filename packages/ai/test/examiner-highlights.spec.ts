/**
 * Strengths and questions for the author — ADR-0131. The model's lists are checked in code: a
 * strength must quote the section it read, a question must be about the section and assert
 * nothing outside it, and the chapter keeps at most four and five.
 */

import { disciplineProfile } from '@tc/config';
import { describe, expect, it } from 'vitest';
import {
  askPlan,
  buildExaminerReviewHighlightsRequest,
  cleanWhy,
  EXAMINER_HIGHLIGHTS,
  examinerReviewSchema,
  type HighlightsInput,
  mockExaminerReviewFor,
  pickHighlights,
  postProcessHighlights,
  questionFault,
  sameQuestion,
} from '../src/index.js';

const input: HighlightsInput = {
  title: 'Drying kinetics',
  sentences: [
    {
      id: 's1',
      text: 'Solar drying removes moisture using solar heat in an enclosed cabinet {{cite:P1}}.',
    },
    { id: 's2', text: 'Moisture ratio falls exponentially with drying time in thin layers.' },
    { id: 's3', text: 'Open sun drying loses an estimated fifth of the catch to spoilage.' },
  ],
  passages: [{ id: 'P1', text: 'Kumar et al. (2019) measured cabinet dryers for anchovy.' }],
  blockingIds: new Set(['s3']),
};

describe('strengths', () => {
  it('keeps a strength whose quote is in its sentence, without the citation marker', () => {
    const out = postProcessHighlights(
      {
        strengths: [
          {
            sentenceId: 's1',
            quote: 'using solar heat in an enclosed cabinet',
            why: 'Defines the process before using it.',
          },
        ],
        questions: [],
      },
      input,
    );
    expect(out.strengths).toEqual([
      {
        sentenceId: 's1',
        quote: 'using solar heat in an enclosed cabinet',
        why: 'Defines the process before using it.',
      },
    ]);
  });

  it('re-pins a quote found in another sentence, ignoring case and curly quotes', () => {
    const out = postProcessHighlights(
      {
        strengths: [{ sentenceId: 's1', quote: '“Moisture RATIO falls exponentially”', why: 'x' }],
        questions: [],
      },
      input,
    );
    expect(out.strengths[0]?.sentenceId).toBe('s2');
  });

  it('drops a quote that is not in the section, one on a blocking sentence, and a second on one sentence', () => {
    const out = postProcessHighlights(
      {
        strengths: [
          { sentenceId: 's2', quote: 'drying follows the Page model closely', why: 'x' },
          { sentenceId: 's3', quote: 'loses an estimated fifth of the catch', why: 'x' },
          { sentenceId: 's2', quote: 'falls exponentially with drying time', why: 'x' },
          { sentenceId: 's2', quote: 'with drying time in thin layers', why: 'y' },
          { sentenceId: 's1', quote: 'solar', why: 'too short to pin' },
        ],
        questions: [],
      },
      input,
    );
    expect(out.strengths.map((s) => s.quote)).toEqual(['falls exponentially with drying time']);
    expect(out.dropped.strengths).toBe(4);
  });
});

describe('a strength’s reason (round 2)', () => {
  it('loses the request’s passage ids and citation markers', () => {
    expect(cleanWhy('Cites the empirical Udupi study (P5) that tests these constructs.')).toBe(
      'Cites the empirical Udupi study that tests these constructs.',
    );
    expect(cleanWhy('Directly supported by the cited problem statement. {{cite:P1}}')).toBe(
      'Directly supported by the cited problem statement.',
    );
    expect(cleanWhy('Links it to empirical studies (P1 and P2).')).toBe(
      'Links it to empirical studies.',
    );
    expect(cleanWhy('Links the sentence to P4’s pilot study methods.')).toBe(
      'Links the sentence to the cited source’s pilot study methods.',
    );
  });
});

describe('questions', () => {
  it('keeps a question about the section', () => {
    expect(
      questionFault('Why did you choose a thin-layer model for the moisture ratio?', input),
    ).toBeNull();
  });

  it('drops a question that would fit any thesis', () => {
    expect(questionFault('How does this chapter support the aims of your thesis?', input)).toBe(
      'not about the section',
    );
  });

  it('drops a question naming a year or an author the request does not have', () => {
    expect(questionFault('Does Smith et al. contradict your moisture ratio claim?', input)).toBe(
      'outside author',
    );
    expect(questionFault('Has the moisture ratio work since 2023 changed this?', input)).toBe(
      'outside year',
    );
    // In the passages: allowed.
    expect(
      questionFault('Do Kumar et al. (2019) measure the moisture ratio in your range?', input),
    ).toBeNull();
  });

  it('drops passage ids, statements and duplicates', () => {
    const out = postProcessHighlights(
      {
        strengths: [],
        questions: [
          { sentenceId: 's1', question: 'Does P1 support the cabinet claim?' },
          { sentenceId: 's1', question: 'The cabinet design is unusual.' },
          { sentenceId: 's2', question: 'Why a thin-layer moisture ratio model?' },
          { sentenceId: 'zz', question: 'Why a thin-layer moisture ratio model ?' },
        ],
      },
      input,
    );
    expect(out.questions).toEqual([
      { sentenceId: 's2', question: 'Why a thin-layer moisture ratio model?' },
    ]);
    expect(out.dropped.questions).toBe(3);
  });
});

describe('the chapter', () => {
  it('deals four strengths and five questions, plus a spare of each, larger sections first', () => {
    expect(askPlan([10])).toEqual([{ strengths: 5, questions: 6 }]);
    expect(askPlan([3, 9])).toEqual([
      { strengths: 2, questions: 3 },
      { strengths: 3, questions: 3 },
    ]);
    const eight = askPlan([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(eight.reduce((n, s) => n + s.strengths, 0)).toBe(5);
    expect(eight.reduce((n, s) => n + s.questions, 0)).toBe(6);
    expect(askPlan([])).toEqual([]);
  });

  it('keeps at most four strengths and five questions, taken from the sections in turn', () => {
    const picked = pickHighlights([
      { strengths: ['a1', 'a2', 'a3'], questions: ['q1', 'q2', 'q3', 'q4'] },
      { strengths: ['b1', 'b2'], questions: ['r1', 'r2', 'r3'] },
    ]);
    expect(picked.strengths).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(picked.questions).toEqual(['q1', 'r1', 'q2', 'r2', 'q3']);
    expect(EXAMINER_HIGHLIGHTS.strengths).toBe(4);
  });

  it('skips a question on the same point as one already taken (round 1 asked one twice)', () => {
    const a = {
      question:
        "Which specific 'financial inclusion indicators' will the study measure, and why are those indicators appropriate for rural women in Virudhunagar?",
    };
    const b = {
      question:
        "Which precise financial inclusion indicators will you use to operationalize 'access' and 'meaningful engagement' with mobile banking?",
    };
    const c = {
      question:
        'Which specific datasets, spatial resolution and downscaling method will you use to translate ERA5 outputs to city-level hazard estimates?',
    };
    expect(sameQuestion(a.question, b.question)).toBe(true);
    expect(sameQuestion(a.question, c.question)).toBe(false);
    expect(
      pickHighlights([
        { strengths: [], questions: [a, c] },
        { strengths: [], questions: [b] },
      ]).questions,
    ).toEqual([a, b].slice(0, 1).concat([c]));
  });
});

describe('the request', () => {
  const request = buildExaminerReviewHighlightsRequest(
    {
      discipline: disciplineProfile(null),
      paradigm: 'experimental',
      degree: 'PhD',
      section: { id: 'sec1', title: 'Drying kinetics', purpose: '', isSummary: false },
      sentences: input.sentences.map(({ id, text }) => ({ id, text })),
      entities: [],
      passages: input.passages,
      terminology: [],
      pitfalls: [],
      userId: 'u',
      documentId: 'd',
    },
    { strengths: 2, questions: 3 },
  );

  it('uses examiner_review.md, carries the ask line inside <review>, and is metered as a review', () => {
    expect(request.system.cached).toContain('Questions for the author');
    expect(request.system.cached).not.toContain('do not praise');
    const user = request.messages[0]?.content ?? '';
    expect(user).toMatch(/<ask strengths="2" questions="3"\/>\n<\/review>$/);
    expect(request.action).toBe('EXAMINER_REVIEW');
    expect(request.maxTokens).toBe(2_600);
    expect(request.tier).toBe('strong');
  });

  it("the mock answers within the ask and passes the code's own checks", () => {
    const answer = examinerReviewSchema.parse(
      mockExaminerReviewFor({ ...request, schema: examinerReviewSchema }),
    );
    expect(answer.strengths.length).toBeLessThanOrEqual(2);
    expect(answer.questions.length).toBeLessThanOrEqual(3);
    const out = postProcessHighlights(answer, { ...input, blockingIds: new Set() });
    expect(out.strengths.length).toBe(2);
    expect(out.questions.length).toBe(3);
  });
});
