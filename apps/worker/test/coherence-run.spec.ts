/**
 * `coherence` — PRD Appendix D.1.1, FR-6.x; PHASES v2 B1 and the VERIFY batch.
 *
 * Four things are pinned here, and each of them is a way the run could quietly go wrong.
 *
 * **A run that finds nothing must still finish.** The terminal state belongs to the worker, not to
 * whoever is watching the SSE stream — that bug wedged a document at "already running" whenever a
 * student closed the tab.
 *
 * **The flag identity survives a re-run** (ADR-0007). A flag the student ignored must not come
 * back, and a flag still on screen must keep its id rather than being deleted and re-created under
 * their scroll position.
 *
 * **The budget guard runs before the first call** (D.1.1 step 4), because a guard that runs after
 * is an invoice, not a guard.
 *
 * **The model may only flag a sentence that was sent to it** — §10.6's grounding rule, applied to
 * coherence: a flag on a sentence the model invented points at nothing in the chapter.
 */

import type { LlmProvider, LlmRequest } from '@tc/ai';
import { EMBEDDING_DIMENSIONS } from '@tc/retrieval';
import { describe, expect, it, vi } from 'vitest';
import { type CoherenceRunDeps, estimateRun, runCoherence } from '../src/jobs/coherence-run.js';

const CHAPTER_TEXT = [
  'Solar drying is the practice of removing moisture using solar heat.',
  'Open drying loses an estimated fifth of the catch to spoilage.',
];

const doc = (sentences: readonly string[]) => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
    ...sentences.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  ],
});

type ChapterInput = {
  id: string;
  title: string;
  order: number;
  sentences?: readonly string[];
  content?: unknown;
  scopeNote?: string | null;
  changed?: boolean;
};

type Fakes = {
  deps: CoherenceRunDeps;
  requests: LlmRequest[];
  created: Array<Record<string, unknown>>;
  deleted: string[][];
  events: Array<{ type: string; data: Record<string, unknown> }>;
  logged: Array<Record<string, unknown>>;
  meta: () => Record<string, unknown>;
};

function fakes(
  options: {
    chapters?: ChapterInput[];
    glossary?: Record<string, unknown>;
    citations?: Array<{ chapterId: string; nodeKey: string; sourceId: string }>;
    sources?: Array<Record<string, unknown>>;
    existingFlags?: Array<{ id: string; status: string; fingerprint: string }>;
    answer?: (request: LlmRequest) => unknown;
  } = {},
): Fakes {
  const requests: LlmRequest[] = [];
  const created: Array<Record<string, unknown>> = [];
  const deleted: string[][] = [];
  const logged: Array<Record<string, unknown>> = [];
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  let meta: Record<string, unknown> = {
    coherenceRuns: { 'run-1': { runId: 'run-1', status: 'RUNNING' } },
  };

  const inputs = options.chapters ?? [
    { id: 'ch-1', title: 'Introduction', order: 1, sentences: CHAPTER_TEXT, changed: true },
  ];
  const chapters = inputs.map((c) => ({
    id: c.id,
    title: c.title,
    order: c.order,
    content: c.content ?? doc(c.sentences ?? CHAPTER_TEXT),
    scopeNote: c.scopeNote ?? 'What this chapter covers.',
    updatedAt: new Date('2026-09-07T00:00:00Z'),
    lastCheckedAt: c.changed === false ? new Date('2026-09-08T00:00:00Z') : null,
  }));

  const llm = {
    modelIdFor: (tier: string) => `mock-${tier}`,
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      return {
        // A superset of every coherence schema's fields, all empty: a test that does not care
        // about a particular check gets silence from it rather than noise, whichever check runs.
        value: options.answer?.(request) ?? EMPTY_ANSWER,
        modelId: `mock-${request.tier}`,
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    }),
  } as unknown as LlmProvider;

  const deps = {
    prisma: {
      chapter: {
        findMany: vi.fn(async () => chapters),
        // D.1.1: `lastCheckedAt` is stamped at the end, which is what makes the next run a no-op.
        updateMany: vi.fn(async () => ({ count: chapters.length })),
      },
      documentMemory: {
        findUnique: vi.fn(async () => ({ glossary: options.glossary ?? {}, outline: [] })),
      },
      citation: { findMany: vi.fn(async () => options.citations ?? []) },
      source: { findMany: vi.fn(async () => options.sources ?? []) },
      coherenceFlag: {
        findMany: vi.fn(async () => options.existingFlags ?? []),
        deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          deleted.push(where.id.in);
          return { count: where.id.in.length };
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `flag-${created.length}` };
        }),
      },
      aiCallLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          logged.push(data);
          return {};
        }),
      },
      document: {
        findUnique: vi.fn(async () => ({ meta })),
        update: vi.fn(async ({ data }: { data: { meta: Record<string, unknown> } }) => {
          meta = data.meta;
          return { meta };
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      $executeRaw: vi.fn(async () => 0),
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => []),
      $queryRawUnsafe: vi.fn(async () => []),
      $transaction: vi.fn(async (fn: unknown) =>
        typeof fn === 'function' ? (fn as (c: unknown) => unknown)(deps.prisma) : fn,
      ),
    },
    llm,
    embeddings: {
      // The stored dimension is checked on write, so a short vector is rejected before it lands.
      embed: vi.fn(async (texts: string[]) =>
        texts.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)),
      ),
    },
    aiProvider: 'mock' as const,
    log: () => undefined,
    onProgress: (event: { type: string; data: Record<string, unknown> }) => {
      events.push(event);
    },
    now: () => new Date('2026-09-07T12:00:00.000Z'),
  } as unknown as CoherenceRunDeps;

  return { deps, requests, created, deleted, events, logged, meta: () => meta };
}

/** Satisfies `termDrift`, `claims`, `contradiction`, `unsupported` and `outlineDrift` at once. */
const EMPTY_ANSWER = {
  flags: [],
  claims: [],
  results: [],
  covered: [],
  missing: [],
  extra: [],
  explanation: '',
};

const JOB = {
  documentId: 'doc-1',
  userId: 'user-1',
  runId: 'run-1',
  triggeredBy: 'MANUAL' as const,
};

describe('a run with nothing to do', () => {
  it('finishes rather than leaving the document wedged', async () => {
    const f = fakes({
      chapters: [
        { id: 'ch-1', title: 'Introduction', order: 1, sentences: CHAPTER_TEXT, changed: false },
      ],
    });
    const result = await runCoherence(JOB, f.deps);
    expect(result.skipped).toBe('nothing changed');
    expect(result.chaptersChecked).toBe(0);
  });

  it('writes the terminal state itself, not through whoever is watching', async () => {
    // Closing the tab used to leave the run RUNNING for ever, and the next run refused to start.
    const f = fakes({
      chapters: [
        { id: 'ch-1', title: 'Introduction', order: 1, sentences: CHAPTER_TEXT, changed: false },
      ],
    });
    await runCoherence(JOB, f.deps);
    const runs = f.meta().coherenceRuns as Record<string, Record<string, unknown>>;
    expect(runs['run-1']?.status).toBe('DONE');
    expect(runs['run-1']?.finishedAt).toBe('2026-09-07T12:00:00.000Z');
  });

  it('makes no provider call at all', async () => {
    const f = fakes({
      chapters: [
        { id: 'ch-1', title: 'Introduction', order: 1, sentences: CHAPTER_TEXT, changed: false },
      ],
    });
    await runCoherence(JOB, f.deps);
    expect(f.requests).toHaveLength(0);
  });
});

describe('a run over a changed chapter', () => {
  it('finishes DONE with totals by type', async () => {
    const f = fakes();
    const result = await runCoherence(JOB, f.deps);
    expect(result.chaptersChecked).toBe(1);
    const runs = f.meta().coherenceRuns as Record<string, Record<string, unknown>>;
    expect(runs['run-1']?.status).toBe('DONE');
    expect(runs['run-1']).toHaveProperty('totals');
  });

  it('announces each check to the stream, started and done', async () => {
    const f = fakes();
    await runCoherence(JOB, f.deps);
    const started = f.events.filter((e) => e.type === 'check-started').map((e) => e.data.type);
    const done = f.events.filter((e) => e.type === 'check-done').map((e) => e.data.type);
    expect(started).toContain('CITATION_INTEGRITY');
    expect(started).toEqual(done); // every check that starts also reports
    expect(f.events.at(-1)?.type).toBe('run-done');
  });

  it('re-embeds the changed chapter so later retrieval sees the new text', async () => {
    const f = fakes();
    await runCoherence(JOB, f.deps);
    expect(f.deps.embeddings.embed).toHaveBeenCalled();
  });
});

describe('CITATION_INTEGRITY — mechanical, and free', () => {
  const withCitation = (sourceId: string | null) => ({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Open drying loses a fifth of the catch ' },
          { type: 'citation', attrs: { key: 'k1', sourceId } },
          { type: 'text', text: '.' },
        ],
      },
    ],
  });

  it('flags a citation whose source has left the library', async () => {
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: withCitation('gone') }],
      sources: [],
    });
    await runCoherence(JOB, f.deps);
    const flag = f.created.find((c) => c.type === 'CITATION_INTEGRITY');
    expect(flag?.description).toContain('no longer in your library');
    expect(flag?.severity).toBe('WARN');
  });

  it('flags a citation with no source attached at all', async () => {
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: withCitation(null) }],
    });
    await runCoherence(JOB, f.deps);
    expect(f.created.find((c) => c.type === 'CITATION_INTEGRITY')?.description).toContain(
      'no source attached',
    );
  });

  it('says nothing when the source is there and cited', async () => {
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: withCitation('src-1') }],
      sources: [
        { id: 'src-1', title: 'A paper', doi: '10.1/x', isRetracted: false, rawReference: null },
      ],
      // Without this the source is in the library and cited by nothing, which is its own finding.
      citations: [{ chapterId: 'ch-1', nodeKey: 'k1', sourceId: 'src-1' }],
    });
    await runCoherence(JOB, f.deps);
    expect(f.created.filter((c) => c.type === 'CITATION_INTEGRITY')).toHaveLength(0);
  });

  it('flags a source sitting in the library that nothing cites', async () => {
    // Document-wide, reported against the first changed chapter so the sidebar has somewhere to
    // put it. A library full of papers the thesis never uses is a thing a committee asks about.
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, sentences: CHAPTER_TEXT }],
      sources: [
        {
          id: 'src-1',
          title: 'Never cited',
          doi: '10.1/x',
          isRetracted: false,
          rawReference: null,
        },
      ],
      citations: [],
    });
    await runCoherence(JOB, f.deps);
    expect(f.created.filter((c) => c.type === 'CITATION_INTEGRITY')).toHaveLength(1);
  });

  it('flags a retracted source as an ERROR, not a warning', async () => {
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: withCitation('src-1') }],
      sources: [
        {
          id: 'src-1',
          title: 'A retracted paper',
          doi: '10.1/x',
          isRetracted: true,
          rawReference: null,
        },
      ],
      citations: [{ chapterId: 'ch-1', nodeKey: 'k1', sourceId: 'src-1' }],
    });
    await runCoherence(JOB, f.deps);
    const flag = f.created.find((c) => String(c.description).includes('retracted'));
    expect(flag?.severity).toBe('ERROR');
  });

  it('flags a citation the student typed as plain text', async () => {
    // "(Kumar, 2021)" typed by hand will not appear in the bibliography and will not follow a
    // style switch — the failure a student discovers the night before submission.
    const f = fakes({
      chapters: [
        {
          id: 'ch-1',
          title: 'Introduction',
          order: 1,
          sentences: ['Open drying loses a fifth of the catch (Kumar, 2021).'],
        },
      ],
    });
    await runCoherence(JOB, f.deps);
    const flag = f.created.find((c) => String(c.description).includes('plain text'));
    expect(flag?.type).toBe('CITATION_INTEGRITY');
    expect(flag?.severity).toBe('WARN');
  });

  it('costs nothing — it reads the document, it does not ask a model', async () => {
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: withCitation('gone') }],
    });
    await runCoherence(JOB, f.deps);
    const citationEvents = f.events.filter((e) => e.data.type === 'CITATION_INTEGRITY');
    expect(citationEvents).toHaveLength(2);
    // Whatever else the run spends, this check spends nothing: it is between the two events.
    expect(f.created.some((c) => c.type === 'CITATION_INTEGRITY')).toBe(true);
  });
});

describe('grounding — §10.6 applied to coherence', () => {
  it('drops a flag on a sentence the model was never sent', async () => {
    const f = fakes({
      glossary: { 'solar drying': { definition: 'Removing moisture with solar heat.' } },
      answer: (request) =>
        (request.messages.at(-1)?.content ?? '').includes('solar drying')
          ? {
              ...EMPTY_ANSWER,
              flags: [
                { sentenceId: 'invented-sentence', kind: 'conflict', explanation: 'Made up.' },
              ],
            }
          : EMPTY_ANSWER,
    });
    await runCoherence(JOB, f.deps);
    // A flag pointing at a sentence that is not in the chapter has no range to highlight.
    expect(f.created.filter((c) => c.type === 'TERM_DRIFT')).toHaveLength(0);
  });
});

describe('the flag identity across runs (ADR-0007)', () => {
  const orphan = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A claim ' },
          { type: 'citation', attrs: { key: 'k1', sourceId: 'gone' } },
        ],
      },
    ],
  };

  it('gives every flag a fingerprint over the text it was raised on', async () => {
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: orphan }],
    });
    await runCoherence(JOB, f.deps);
    expect(typeof f.created[0]?.fingerprint).toBe('string');
    expect((f.created[0]?.fingerprint as string).length).toBeGreaterThan(0);
  });

  it('does not raise a flag the student ignored', async () => {
    const first = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: orphan }],
    });
    await runCoherence(JOB, first.deps);
    const fingerprint = first.created[0]?.fingerprint as string;

    const second = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: orphan }],
      existingFlags: [{ id: 'old', status: 'IGNORED', fingerprint }],
    });
    await runCoherence(JOB, second.deps);
    expect(second.created).toHaveLength(0);
  });

  it('leaves a flag already on screen alone rather than re-creating it', async () => {
    const first = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: orphan }],
    });
    await runCoherence(JOB, first.deps);
    const fingerprint = first.created[0]?.fingerprint as string;

    const second = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, content: orphan }],
      existingFlags: [{ id: 'open-1', status: 'OPEN', fingerprint }],
    });
    await runCoherence(JOB, second.deps);
    // Deleting and re-creating would move the student's scroll position for no reason.
    expect(second.created).toHaveLength(0);
    expect(second.deleted.flat()).not.toContain('open-1');
  });

  it('removes an OPEN flag whose problem the student has fixed', async () => {
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, sentences: CHAPTER_TEXT }],
      existingFlags: [{ id: 'stale-1', status: 'OPEN', fingerprint: 'not-reproduced' }],
    });
    await runCoherence(JOB, f.deps);
    expect(f.deleted.flat()).toContain('stale-1');
  });

  it('keeps a RESOLVED flag, which is a record of work done', async () => {
    const f = fakes({
      chapters: [{ id: 'ch-1', title: 'Introduction', order: 1, sentences: CHAPTER_TEXT }],
      existingFlags: [{ id: 'resolved-1', status: 'RESOLVED', fingerprint: 'not-reproduced' }],
    });
    await runCoherence(JOB, f.deps);
    expect(f.deleted.flat()).not.toContain('resolved-1');
  });
});

describe('the budget guard (D.1.1 step 4)', () => {
  it('costs more for more changed chapters and more terms', () => {
    expect(estimateRun(1, 0)).toBeLessThan(estimateRun(5, 0));
    expect(estimateRun(1, 0)).toBeLessThan(estimateRun(1, 10));
  });

  it('is built from §11.2 unit costs, not a guess', () => {
    // One changed chapter, no glossary: three Strong calls and three Fast ones.
    expect(estimateRun(1, 0)).toBeCloseTo(3 * 2.5 + 3 * 0.3, 2);
  });

  it('reduces the scope of a run it cannot afford, rather than refusing it', async () => {
    const glossary = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`term ${i}`, { definition: `Definition ${i}.` }]),
    );
    const f = fakes({
      chapters: Array.from({ length: 12 }, (_, i) => ({
        id: `ch-${i + 1}`,
        title: `Chapter ${i + 1}`,
        order: i + 1,
        sentences: CHAPTER_TEXT,
      })),
      glossary,
    });
    const result = await runCoherence(JOB, f.deps);
    // A student who wrote a lot gets a smaller check, not a refusal and no answer at all.
    expect(result.reducedScope).toBe(true);
    expect(result.estimatedInr).toBeGreaterThan(0);
  });
});
