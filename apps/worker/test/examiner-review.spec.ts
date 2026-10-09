/**
 * `examiner-review` — ADR-0056.
 *
 * Pinned here, each a way the review could quietly go wrong:
 *
 * - **Every call has a time limit**, and a section that fails or times out is reported while the
 *   others still land. Only a review that reviewed nothing gives its unit back.
 * - **The worker owns the terminal state.** The record ends DONE or FAILED, and the job never
 *   throws (a retry would pay for every section again).
 * - **The examiner reads what the citation points at**: the chunk it was made from, or the
 *   source's first chunks when it names none — and nothing outside the thesis's own library.
 * - **Flags land on the sentence**, with the examiner's severity, explanation and correction, and
 *   replace only the chapter's previous *open* examiner flags. An issue the student ignored is
 *   not raised again.
 */

import { type LlmProvider, type LlmRequest, mockExaminerFor, mockExaminerReviewFor } from '@tc/ai';
import type { ExaminerReviewJob, ExaminerReviewRecord } from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import { type ExaminerReviewDeps, runExaminerReview } from '../src/jobs/examiner-review.js';

const DOC = '00000000-0000-7000-8000-00000000000d';
const CHAPTER = '00000000-0000-7000-8000-0000000000c1';
const RUN = '00000000-0000-4000-8000-0000000000a1';

const text = (t: string) => ({ type: 'text', text: t });
const cite = (sourceId: string, chunkId: string | null) => ({
  type: 'citation',
  attrs: { key: sourceId, sourceId, chunkId },
});
const heading = (level: number, t: string) => ({
  type: 'heading',
  attrs: { level },
  content: [text(t)],
});
const para = (...content: unknown[]) => ({ type: 'paragraph', content });

const PITFALL_SENTENCE = 'Open drying loses an estimated fifth of the catch to spoilage.';

const content = {
  type: 'doc',
  content: [
    heading(1, 'Literature review'),
    para(
      text('Solar drying removes moisture using solar heat in an enclosed cabinet '),
      cite('src-1', 'chunk-1'),
      text(`. ${PITFALL_SENTENCE}`),
    ),
    heading(2, 'Drying kinetics'),
    para(
      text('Moisture ratio falls exponentially with drying time in thin layers '),
      cite('src-2', null),
      text('. A foreign citation should never be read by this review '),
      cite('src-elsewhere', 'chunk-x'),
      text('.'),
    ),
    {
      type: 'draftBlock',
      attrs: { draftId: 'd1', status: 'pending' },
      content: [para(text('An AI draft sentence the student has not accepted yet.'))],
    },
  ],
};

type World = {
  deps: ExaminerReviewDeps;
  meta: () => Record<string, unknown>;
  record: () => ExaminerReviewRecord | undefined;
  requests: LlmRequest[];
  created: Array<Record<string, unknown>>;
  deleted: Array<Record<string, unknown>>;
  refunds: string[];
  refundActions: string[];
  logged: Array<Record<string, unknown>>;
  chunkQueries: Array<Record<string, unknown>>;
};

function world(
  options: {
    record?: Partial<ExaminerReviewRecord> | null;
    answer?: (req: LlmRequest) => Promise<unknown> | unknown;
    ignored?: string[];
    chapterContent?: unknown;
  } = {},
): World {
  let meta: Record<string, unknown> = {
    thesisDetails: { degree: 'PhD' },
    ...(options.record === null
      ? {}
      : {
          examinerReviews: {
            [CHAPTER]: {
              runId: RUN,
              status: 'QUEUED',
              version: 4,
              attempt: 0,
              startedAt: '2026-10-04T10:00:00.000Z',
              ...(options.record ?? {}),
            },
          },
        }),
  };
  const requests: LlmRequest[] = [];
  const created: Array<Record<string, unknown>> = [];
  const deleted: Array<Record<string, unknown>> = [];
  const refunds: string[] = [];
  const refundActions: string[] = [];
  const logged: Array<Record<string, unknown>> = [];
  const chunkQueries: Array<Record<string, unknown>> = [];

  const prisma = {
    document: {
      findFirst: vi.fn(async () => ({
        id: DOC,
        title: 'Solar drying of fish',
        field: 'Food engineering',
        meta,
      })),
      findUnique: vi.fn(async () => ({ meta })),
      update: vi.fn(async ({ data }: { data: { meta: Record<string, unknown> } }) => {
        meta = data.meta;
        return {};
      }),
    },
    chapter: {
      findFirst: vi.fn(async () => ({
        id: CHAPTER,
        title: 'Chapter 2',
        scopeNote: 'What is known about drying fish.',
        content: options.chapterContent ?? content,
        version: 5,
      })),
    },
    pitfall: {
      findMany: vi.fn(async () => [
        {
          code: 'FOOD-001',
          wrongPattern: 'Open drying loses an estimated fifth',
          correctStatement: 'Losses depend on season and site; cite a measured figure.',
        },
      ]),
    },
    source: {
      // Only the thesis's own sources come back; `src-elsewhere` belongs to someone else.
      findMany: vi.fn(async () => [
        { id: 'src-1', cslJson: { abstract: 'Abstract one.' } },
        { id: 'src-2', cslJson: { abstract: 'Abstract two.' } },
      ]),
    },
    sourceChunk: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        chunkQueries.push(args.where);
        if ('id' in args.where) {
          return [{ id: 'chunk-1', sourceId: 'src-1', text: 'Cabinet dryers retain heat well.' }];
        }
        return [
          { sourceId: 'src-2', text: 'Thin-layer drying follows Page’s model.' },
          { sourceId: 'src-2', text: 'Moisture ratio decays with time.' },
        ];
      }),
    },
    coherenceFlag: {
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        deleted.push(args.where);
        return { count: 1 };
      }),
      findMany: vi.fn(async () => (options.ignored ?? []).map((fingerprint) => ({ fingerprint }))),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        created.push(...data);
        return { count: data.length };
      }),
    },
  };

  const llm: LlmProvider = {
    stream: () => {
      throw new Error('not used');
    },
    complete: (async (req: LlmRequest) => {
      requests.push(req);
      const value = await (options.answer ?? mockExaminerFor)(req);
      return {
        value,
        modelId: 'mock-strong',
        usage: { inputTokens: 1000, outputTokens: 100 },
      };
    }) as LlmProvider['complete'],
    modelIdFor: () => 'mock-strong',
  };

  const deps: ExaminerReviewDeps = {
    prisma: prisma as never,
    llm,
    logCall: async (call) => {
      logged.push(call as never);
      return 1000;
    },
    refund: async (userId, action) => {
      refunds.push(userId);
      refundActions.push(action);
    },
    now: () => new Date('2026-10-04T10:05:00.000Z'),
  };
  return {
    deps,
    meta: () => meta,
    record: () =>
      (meta.examinerReviews as Record<string, ExaminerReviewRecord> | undefined)?.[CHAPTER],
    requests,
    created,
    deleted,
    refunds,
    refundActions,
    logged,
    chunkQueries,
  };
}

const job: ExaminerReviewJob = {
  documentId: DOC,
  chapterId: CHAPTER,
  userId: 'user-1',
  runId: RUN,
  version: 4,
};

describe('examiner review', () => {
  it('sends each section with a time limit, metered as EXAMINER_REVIEW', async () => {
    const w = world();
    const result = await runExaminerReview(job, w.deps);
    expect(result.status).toBe('DONE');
    expect(w.requests).toHaveLength(2);
    expect(w.requests.every((r) => r.signal instanceof AbortSignal)).toBe(true);
    expect(w.requests.every((r) => r.action === 'EXAMINER_REVIEW' && r.tier === 'strong')).toBe(
      true,
    );
    const user = (r: LlmRequest) => r.messages[0]?.content ?? '';
    expect(user(w.requests[0] as LlmRequest)).toContain('title="Literature review"');
    expect(user(w.requests[1] as LlmRequest)).toContain('title="Drying kinetics"');
    // The pending draft is not the student's text (FR-4.10).
    expect(w.requests.some((r) => user(r).includes('AI draft'))).toBe(false);
    // The discipline's degree and the paradigm reach the request.
    expect(user(w.requests[0] as LlmRequest)).toContain('degree="PhD"');
  });

  it('gives the examiner the passage each citation points at, and nothing from elsewhere', async () => {
    const w = world();
    await runExaminerReview(job, w.deps);
    const first = w.requests[0]?.messages[0]?.content ?? '';
    expect(first).toContain('{{cite:P1}}');
    expect(first).toContain('<passage id="P1">Cabinet dryers retain heat well.</passage>');
    const second = w.requests[1]?.messages[0]?.content ?? '';
    // No chunk named: the source's first chunks.
    expect(second).toContain('Thin-layer drying follows Page’s model.');
    expect(second).toContain('Moisture ratio decays with time.');
    // A source outside the library is never read, and its marker is taken out.
    expect(second).not.toContain('chunk-x');
    expect(second).toContain('read by this review.</s>');
    expect(w.chunkQueries.some((q) => JSON.stringify(q).includes('chunk-x'))).toBe(false);
  });

  it('writes each issue as an EXAMINER flag on its sentence, replacing the open ones', async () => {
    const w = world();
    const result = await runExaminerReview(job, w.deps);
    expect(w.deleted).toEqual([
      { documentId: DOC, chapterId: CHAPTER, type: 'EXAMINER', status: 'OPEN' },
    ]);
    expect(w.created).toHaveLength(1);
    const flag = w.created[0] as Record<string, unknown>;
    expect(flag).toMatchObject({
      documentId: DOC,
      chapterId: CHAPTER,
      type: 'EXAMINER',
      severity: 'ERROR',
      description: 'Matches pitfall FOOD-001.',
      suggestion: 'Losses depend on season and site; cite a measured figure.',
      runId: RUN,
    });
    // The range is the sentence's own: "Literature review" is positions 0–19, the paragraph's
    // text starts at 20, and the pitfall sentence follows the first sentence, its citation and ". ".
    const firstText = 'Solar drying removes moisture using solar heat in an enclosed cabinet ';
    const from = 20 + firstText.length + 1 + 2;
    expect(flag.from).toBe(from);
    expect(flag.to).toBe(from + PITFALL_SENTENCE.length);
    expect(result).toMatchObject({ issues: 1, blocking: 1, sectionsReviewed: 2 });
    expect(w.record()).toMatchObject({
      status: 'DONE',
      version: 5,
      issues: 1,
      blocking: 1,
      sections: 2,
      sectionsReviewed: 2,
      failedSections: [],
      finishedAt: '2026-10-04T10:05:00.000Z',
    });
    expect(w.refunds).toEqual([]);
  });

  it('reviews only the sentences inside a selection, and replaces only the flags inside it (ADR-0067)', async () => {
    // "Literature review" is 0–19 and its paragraph 19–155; "Drying kinetics" starts at 155 and
    // its paragraph at 172. The range covers the second section only.
    const range = { from: 173, to: 400 };
    const w = world();
    await runExaminerReview({ ...job, range }, w.deps);
    expect(w.requests).toHaveLength(1);
    expect(w.requests[0]?.messages[0]?.content ?? '').toContain('title="Drying kinetics"');
    expect(w.deleted).toEqual([
      {
        documentId: DOC,
        chapterId: CHAPTER,
        type: 'EXAMINER',
        status: 'OPEN',
        from: { lt: range.to },
        to: { gt: range.from },
      },
    ]);
  });

  it('gives back a COMMAND unit, not an examiner review, when a selection could not be reviewed', async () => {
    const w = world({
      answer: () => {
        throw new Error('provider down');
      },
    });
    const result = await runExaminerReview({ ...job, range: { from: 173, to: 400 } }, w.deps);
    expect(result.status).toBe('FAILED');
    expect(w.refundActions).toEqual(['COMMAND']);
  });

  it('maps a warning to WARN and drops an issue on a sentence that was not sent', async () => {
    const w = world({
      answer: () => ({
        issues: [
          {
            sentenceId: 's1',
            issueType: 'tense',
            explanation: 'Past tense for an established fact.',
            correction: '',
            severity: 'warning',
            pitfallCode: '',
          },
          {
            sentenceId: 's99',
            issueType: 'inaccuracy',
            explanation: 'Invented.',
            correction: '',
            severity: 'blocking',
            pitfallCode: '',
          },
        ],
      }),
    });
    await runExaminerReview(job, w.deps);
    expect(w.created).toHaveLength(2);
    expect(w.created.every((f) => f.severity === 'WARN' && f.suggestion === null)).toBe(true);
    expect(w.created.some((f) => f.description === 'Invented.')).toBe(false);
  });

  it('does not raise again an issue the student ignored', async () => {
    const first = world();
    await runExaminerReview(job, first.deps);
    const fingerprint = String(first.created[0]?.fingerprint);
    const w = world({ ignored: [fingerprint] });
    const result = await runExaminerReview(job, w.deps);
    expect(w.created).toHaveLength(0);
    expect(result.issues).toBe(0);
  });

  it('survives a section that fails or times out, and says which', async () => {
    const w = world({
      answer: async (req) => {
        if (req.messages[0]?.content.includes('Drying kinetics')) {
          await new Promise((resolve, reject) => {
            req.signal?.addEventListener('abort', () => reject(req.signal?.reason));
            setTimeout(resolve, 5_000);
          });
        }
        return mockExaminerFor(req);
      },
    });
    w.deps.callTimeoutMs = 20;
    const result = await runExaminerReview(job, w.deps);
    expect(result.status).toBe('DONE');
    expect(result.failedSections).toEqual(['Drying kinetics']);
    expect(w.created).toHaveLength(1);
    expect(w.logged.filter((c) => c.ok === false)).toHaveLength(1);
    expect(w.record()).toMatchObject({ status: 'DONE', failedSections: ['Drying kinetics'] });
    expect(w.refunds).toEqual([]);
  });

  it('fails, keeps the old flags and gives the unit back when no section could be reviewed', async () => {
    const w = world({
      answer: () => {
        throw new Error('provider down');
      },
    });
    const result = await runExaminerReview(job, w.deps);
    expect(result.status).toBe('FAILED');
    expect(w.deleted).toEqual([]);
    expect(w.refunds).toEqual(['user-1']);
    expect(w.record()).toMatchObject({ status: 'FAILED' });
    expect(w.record()?.error).toMatch(/could not be reached/);
  });

  it('fails without a call, and refunds, when the platform budget is spent', async () => {
    const w = world();
    w.deps.assertBudget = async () => {
      throw new Error('The site-wide AI budget for this month has been reached.');
    };
    const result = await runExaminerReview(job, w.deps);
    expect(result.status).toBe('FAILED');
    expect(w.requests).toHaveLength(0);
    expect(w.refunds).toEqual(['user-1']);
  });

  it('does nothing for a run that is not the recorded one, or already finished', async () => {
    for (const record of [null, { runId: 'another-run' }, { status: 'DONE' as const }]) {
      const w = world({ record });
      const result = await runExaminerReview(job, w.deps);
      expect(result.status).toBe('SKIPPED');
      expect(w.requests).toHaveLength(0);
      expect(w.refunds).toEqual([]);
    }
  });

  it('refuses a chapter with too little of the student’s own text, for nothing', async () => {
    const w = world({
      chapterContent: { type: 'doc', content: [para(text('Only one sentence long enough here.'))] },
    });
    const result = await runExaminerReview(job, w.deps);
    expect(result.status).toBe('FAILED');
    expect(w.requests).toHaveLength(0);
    expect(w.refunds).toEqual(['user-1']);
  });
});

/**
 * ADR-0131: a whole chapter's review also asks each section for strengths and questions for the
 * author, and keeps only what the code can pin to the chapter.
 */
describe('strengths and questions for the author', () => {
  it('asks each section of a whole chapter, and stores what anchors, with positions', async () => {
    const w = world({ answer: mockExaminerReviewFor });
    const result = await runExaminerReview(job, w.deps);
    expect(result.status).toBe('DONE');
    const user = (r: LlmRequest) => r.messages[0]?.content ?? '';
    // Five strengths and six questions dealt over two sections, the larger first.
    expect(user(w.requests[0] as LlmRequest)).toContain('<ask strengths="3" questions="3"/>');
    expect(user(w.requests[1] as LlmRequest)).toContain('<ask strengths="2" questions="3"/>');
    expect(w.requests[0]?.system.cached).toContain('Questions for the author');

    const record = w.record();
    const strengths = record?.strengths ?? [];
    expect(strengths.length).toBeGreaterThanOrEqual(2);
    expect(strengths.length).toBeLessThanOrEqual(4);
    // The pitfall sentence has a blocking issue: no strength on it.
    expect(strengths.some((s) => PITFALL_SENTENCE.startsWith(s.quote))).toBe(false);
    // Positions are the sentence's: the first strength quotes the first sentence of the chapter.
    expect(strengths[0]).toMatchObject({
      quote: 'Solar drying removes moisture using solar heat in',
      section: 'Literature review',
      from: 20,
    });
    const questions = record?.questions ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(5);
    expect(questions.every((q) => q.question.endsWith('?'))).toBe(true);
  });

  it('drops a strength that quotes words not in the chapter, and a question with an outside study', async () => {
    const w = world({
      answer: (req: LlmRequest) => ({
        ...mockExaminerFor(req),
        strengths: [
          { sentenceId: 's1', quote: 'a novel hybrid dryer was validated', why: 'Invented.' },
        ],
        questions: [
          {
            sentenceId: 's1',
            question: 'How does Smith et al. change your view of cabinet drying?',
          },
        ],
      }),
    });
    await runExaminerReview(job, w.deps);
    expect(w.record()?.strengths).toEqual([]);
    expect(w.record()?.questions).toEqual([]);
  });

  it('asks only the two largest sections; a third keeps examiner.md (ADR-0131 round 3)', async () => {
    const w = world({
      answer: mockExaminerReviewFor,
      chapterContent: {
        type: 'doc',
        content: [
          ...content.content,
          heading(2, 'Spoilage'),
          para(text('Spoilage rises with humidity in open racks.')),
        ],
      },
    });
    await runExaminerReview(job, w.deps);
    const user = (r: LlmRequest) => r.messages[0]?.content ?? '';
    expect(w.requests).toHaveLength(3);
    const asked = w.requests.filter((r) => user(r).includes('<ask'));
    expect(asked).toHaveLength(2);
    const plain = w.requests.find((r) => !user(r).includes('<ask'));
    expect(user(plain as LlmRequest)).toContain('Spoilage rises with humidity');
    expect(plain?.system.cached).not.toContain('Questions for the author');
  });

  it('keeps the examiner as it was for a selection: no ask line, nothing stored', async () => {
    const w = world({ answer: mockExaminerReviewFor });
    await runExaminerReview({ ...job, range: { from: 173, to: 400 } }, w.deps);
    expect(w.requests[0]?.messages[0]?.content ?? '').not.toContain('<ask');
    expect(w.requests[0]?.system.cached).not.toContain('Questions for the author');
    expect(w.record()?.strengths).toBeUndefined();
  });
});
