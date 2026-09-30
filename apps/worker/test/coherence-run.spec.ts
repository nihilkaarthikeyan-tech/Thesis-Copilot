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
import {
  type CoherenceRunDeps,
  estimateRun,
  runCoherence,
  supportFlagText,
} from '../src/jobs/coherence-run.js';

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
    /** ADR-0023: source chunks by id, and the rows the nearest-passage query returns. */
    chunks?: Array<{ id: string; sourceId: string; text: string; page: number | null }>;
    nearest?: Array<Record<string, unknown>>;
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
      sourceChunk: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          (options.chunks ?? []).filter((chunk) => where.id.in.includes(chunk.id)),
        ),
      },
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
      $queryRawUnsafe: vi.fn(async () => options.nearest ?? []),
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
      // Through `embed`, so the test that counts re-embedding still sees it.
      async embedWithUsage(texts: string[]) {
        return {
          vectors: await this.embed(texts),
          tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
        };
      },
    },
    logEmbed: vi.fn(async () => undefined),
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
    const fingerprint = f.created[0]?.fingerprint;
    expect(typeof fingerprint).toBe('string');
    expect(String(fingerprint).length).toBeGreaterThan(0);
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

describe('the citation-support check (ADR-0023)', () => {
  const PASSAGE =
    'Upfront cost may explain part of the gap, although the survey could not separate cost from access to credit.';
  const SOURCE = {
    id: 'src-1',
    title: 'Drip uptake',
    doi: null,
    isRetracted: false,
    rawReference: null,
    authors: [{ family: 'Kumar' }],
    year: 2021,
  };

  /** One chapter whose one sentence cites `src-1`, with or without the passage it came from. */
  const cited = (chunkId: string | null) => ({
    id: 'ch-1',
    title: 'Results',
    order: 3,
    changed: true,
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Results' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Upfront cost always explains the whole adoption gap ' },
            { type: 'citation', attrs: { key: 'k1', sourceId: 'src-1', chunkId } },
            { type: 'text', text: '.' },
          ],
        },
      ],
    },
  });

  /** Answers the support call with `verdict` for every sentence it was sent; silence otherwise. */
  const answering = (verdict: string, quote: string, extraId?: string) => (request: LlmRequest) => {
    const text = request.messages.at(-1)?.content ?? '';
    if (!text.includes('<support_check>')) return EMPTY_ANSWER;
    const ids = [...text.matchAll(/<sentence id="([^"]+)">/g)].map((m) => m[1]);
    return {
      results: [
        ...ids.map((sentenceId) => ({ sentenceId, verdict, why: 'the passage hedges it', quote })),
        ...(extraId
          ? [{ sentenceId: extraId, verdict: 'MISREPRESENTED', why: 'invented', quote: '' }]
          : []),
      ],
    };
  };

  const supportFlags = (f: Fakes) => f.created.filter((flag) => flag.type === 'CITATION_SUPPORT');
  const supportCalls = (f: Fakes) =>
    f.requests.filter((r) => (r.messages.at(-1)?.content ?? '').includes('<support_check>'));

  it('reads the passage a citation was made from, and flags an overstatement with its words', async () => {
    const f = fakes({
      chapters: [cited('chunk-1')],
      sources: [SOURCE],
      chunks: [{ id: 'chunk-1', sourceId: 'src-1', text: PASSAGE, page: 4 }],
      answer: answering('OVERSTATED', 'Upfront cost may explain part of the gap'),
    });
    await runCoherence(JOB, f.deps);

    const [call] = supportCalls(f);
    expect(call?.tier).toBe('strong'); // ADR-0023 addendum, 2026-09-30
    expect(call?.messages.at(-1)?.content).toContain(PASSAGE);
    expect(call?.messages.at(-1)?.content).toContain('source="Kumar 2021" page="4"');
    const [flag] = supportFlags(f);
    expect(flag?.severity).toBe('WARN');
    expect(String(flag?.description)).toContain('says more than the cited passage');
    expect(String(flag?.description)).toContain('“Upfront cost may explain part of the gap”');
  });

  it('never shows a quote the passage does not contain, and softens the verdict without it', async () => {
    const f = fakes({
      chapters: [cited('chunk-1')],
      sources: [SOURCE],
      chunks: [{ id: 'chunk-1', sourceId: 'src-1', text: PASSAGE, page: 4 }],
      answer: answering('MISREPRESENTED', 'Cost explains nothing at all'),
    });
    await runCoherence(JOB, f.deps);
    const [flag] = supportFlags(f);
    expect(flag?.severity).toBe('WARN');
    expect(String(flag?.description)).not.toContain('Cost explains nothing');
  });

  it('finds the nearest passages of the cited source when the citation carries none', async () => {
    const f = fakes({
      chapters: [cited(null)],
      sources: [SOURCE],
      nearest: [
        {
          chunkId: 'chunk-9',
          sourceId: 'src-1',
          distance: 0.2,
          subTheme: null,
          groundingLevel: 'ABSTRACT',
          text: PASSAGE,
          page: null,
          title: 'Drip uptake',
          year: 2021,
          authors: [{ family: 'Kumar' }],
        },
      ],
      answer: answering('SUPPORTED', ''),
    });
    await runCoherence(JOB, f.deps);
    expect(supportCalls(f)[0]?.messages.at(-1)?.content).toContain(PASSAGE);
    // SUPPORTED is not a flag: there is nothing for the student to do.
    expect(supportFlags(f)).toHaveLength(0);
  });

  it('skips a citation whose source has no text, rather than judging it against nothing', async () => {
    const f = fakes({
      chapters: [cited(null)],
      sources: [SOURCE],
      nearest: [],
      answer: answering('MISREPRESENTED', ''),
    });
    await runCoherence(JOB, f.deps);
    expect(supportCalls(f)).toHaveLength(0);
    expect(supportFlags(f)).toHaveLength(0);
  });

  it('drops a verdict about a sentence it was never sent', async () => {
    const f = fakes({
      chapters: [cited('chunk-1')],
      sources: [SOURCE],
      chunks: [{ id: 'chunk-1', sourceId: 'src-1', text: PASSAGE, page: 4 }],
      answer: answering('SUPPORTED', '', 'ch-1#s99'),
    });
    await runCoherence(JOB, f.deps);
    expect(supportFlags(f)).toHaveLength(0);
  });

  it('counts its calls in the budget estimate', () => {
    expect(estimateRun(1, 0, 60)).toBeGreaterThan(estimateRun(1, 0, 0));
  });
});

describe('the chapter re-embedding is logged as spend (2026-09-25)', () => {
  it('records one EMBED call for the run with the tokens the provider billed', async () => {
    const f = fakes({
      chapters: [
        { id: 'ch-1', title: 'Introduction', order: 1, sentences: CHAPTER_TEXT, changed: true },
      ],
    });
    await runCoherence(JOB, f.deps);
    const logEmbed = (f.deps as unknown as { logEmbed: ReturnType<typeof vi.fn> }).logEmbed;
    expect(logEmbed).toHaveBeenCalledTimes(1);
    const call = logEmbed.mock.calls[0]?.[0] as { userId: string; tokens: number; ok: boolean };
    expect(call.userId).toBe(JOB.userId);
    expect(call.ok).toBe(true);
    expect(call.tokens).toBeGreaterThan(0);
  });
});

/**
 * 2026-09-30, approved by the owner: a reviewer caught Jenni citing a stainless-steel finding in
 * a maraging-steel review. The support check now has a verdict for it.
 */
describe('the different-material warning', () => {
  it('reads as a warning about the subject, with the passage’s own words when there are some', () => {
    const flag = supportFlagText(
      'DIFFERENT_SUBJECT',
      'The passage studies 316L stainless steel, not maraging steel',
      'MnS inclusions in 316L act as pitting initiation sites',
    );
    expect(flag.severity).toBe('WARN');
    expect(flag.description).toMatch(/^This source studies a different material or setting/);
    expect(flag.description).toContain('316L stainless steel');
    expect(flag.description).toContain('“MnS inclusions in 316L act as pitting initiation sites”');
  });
});
