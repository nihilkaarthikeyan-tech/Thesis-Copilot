/**
 * `draft-section` — PRD FR-4.4, A.2, §10.2 step 5, PHASES 4.2 and 4.3.
 *
 * Driven with fake deps so the three decisions that matter are pinned without a database or a
 * provider: a draft with no sources is refused before any call is made, a written draft lands in
 * `AiCallLog` with its real usage, and a provider failure is logged as a failure rather than lost.
 */

import type { LlmChunk, LlmRequest } from '@tc/ai';
import { describe, expect, it, vi } from 'vitest';
import {
  type DraftCallLog,
  type DraftEvent,
  type DraftSectionDeps,
  draftCloseTo,
  guidanceFor,
  runDraftSection,
} from '../src/jobs/draft-section.js';

const PASSAGE = {
  id: 'S1#c1',
  shortRef: 'Kumar 2021',
  page: 7,
  text: 'Upfront cost was the main barrier households reported.',
  sourceId: 'src-1',
  chunkId: 'chunk-1',
  score: 0.9,
};

function fakeDeps(options: { passages?: boolean; fail?: boolean } = {}) {
  const published: DraftEvent[] = [];
  const logged: DraftCallLog[] = [];
  const requests: LlmRequest[] = [];

  const deps: DraftSectionDeps = {
    prisma: {
      chapter: {
        findFirst: vi.fn(async () => ({
          id: 'ch-1',
          documentId: 'doc-1',
          outlineNodeId: '1-introduction',
          title: 'Introduction',
          scopeNote: 'Why uptake is low.',
          content: { type: 'doc', content: [] },
        })),
      },
      documentMemory: { findUnique: vi.fn(async () => ({ outline: [] })) },
    } as unknown as DraftSectionDeps['prisma'],
    llm: {
      modelIdFor: () => 'mock-strong',
      async *stream(request: LlmRequest): AsyncIterable<LlmChunk> {
        requests.push(request);
        if (options.fail) throw new Error('provider down');
        yield { type: 'text', text: 'Cost dominated the responses {{cite:S1#c1}}. ' };
        yield { type: 'text', text: 'This section examines why.' };
        yield {
          type: 'finish',
          usage: { inputTokens: 900, cachedInputTokens: 800, outputTokens: 40 },
          modelId: 'mock-strong',
          finishReason: 'stop',
        };
      },
      complete: vi.fn(),
    },
    embeddings: {
      dims: 1024,
      modelId: 'mock-embed',
      embed: vi.fn(async () => [[]]),
      embedWithUsage: vi.fn(async () => ({ vectors: [[]], tokens: 0 })),
    },
    memoryBlock: vi.fn(async () => '<document_memory></document_memory>'),
    retrieve: vi.fn(async () => ({
      passages: options.passages === false ? [] : [PASSAGE],
      byKey: new Map(
        options.passages === false
          ? []
          : [['S1#c1', { sourceId: 'src-1', chunkId: 'chunk-1', shortRef: 'Kumar 2021' }]],
      ),
    })),
    strongTier: vi.fn(async () => true),
    publish: vi.fn(async (event: DraftEvent) => {
      published.push(event);
    }),
    logCall: vi.fn(async (call: DraftCallLog) => {
      logged.push(call);
    }),
  };

  return { deps, published, logged, requests };
}

const job = {
  chapterId: 'ch-1',
  documentId: 'doc-1',
  userId: 'user-1',
  outlineNodeId: '1-introduction',
  draftId: 'draft-1',
};

describe('runDraftSection', () => {
  it('refuses with no sources, before any provider call and without a log row', async () => {
    const { deps, published, logged, requests } = fakeDeps({ passages: false });

    const result = await runDraftSection(job, deps);

    expect(result.status).toBe('refused');
    expect(requests).toHaveLength(0);
    // Nothing was called, so nothing is charged and nothing is logged as a call.
    expect(logged).toHaveLength(0);
    expect(published.at(-1)).toMatchObject({ type: 'refused' });
    expect((published.at(-1) as { reason: string }).reason).toContain('Pin at least one source');
  });

  it('with no sources, starts a search for them and says so (ADR-0037)', async () => {
    const { deps, published } = fakeDeps({ passages: false });
    const findSources = vi.fn(async () => true);
    const result = await runDraftSection(job, { ...deps, findSources });
    expect(result.status).toBe('refused');
    expect(findSources).toHaveBeenCalledWith(expect.objectContaining({ chapterId: 'ch-1' }));
    const reason = (published.at(-1) as { reason: string }).reason;
    expect(reason).toContain('We are finding papers on it');
    expect(reason).toContain('Try Draft again');
  });

  it('writes the draft, resolves its citation, and logs the call with its usage', async () => {
    const { deps, published, logged } = fakeDeps();

    const result = await runDraftSection(job, deps);

    expect(result.status).toBe('done');
    expect(result.citations).toBe(1);

    const done = published.find((event) => event.type === 'done') as Extract<
      DraftEvent,
      { type: 'done' }
    >;
    expect(done.result.citations).toEqual([
      { key: 'S1#c1', sourceId: 'src-1', chunkId: 'chunk-1', rendered: '(Kumar 2021)' },
    ]);
    // §9.3: the result carries ProseMirror content, ready to insert.
    expect(done.content.length).toBeGreaterThan(0);

    // §10.2 step 5 / PHASES 4.3: one AiCallLog row, with the usage the provider reported.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      userId: 'user-1',
      documentId: 'doc-1',
      tier: 'strong',
      modelId: 'mock-strong',
      ok: true,
      usage: { inputTokens: 900, cachedInputTokens: 800, outputTokens: 40 },
    });
  });

  it('uses the Fast tier when the flag is off (PHASES 4.9)', async () => {
    const { deps, requests, logged } = fakeDeps();
    deps.strongTier = vi.fn(async () => false);

    await runDraftSection(job, deps);

    expect(requests[0]?.tier).toBe('fast');
    expect(logged[0]?.tier).toBe('fast');
  });

  it('logs a provider failure as a failed call rather than losing it', async () => {
    const { deps, published, logged } = fakeDeps({ fail: true });

    const result = await runDraftSection(job, deps);

    expect(result.status).toBe('error');
    expect(published.at(-1)).toMatchObject({ type: 'error' });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ ok: false, usage: null });
    expect(logged[0]?.error).toContain('provider down');
  });
});

describe('ADR-0047: research-type guidance in Draft mode', () => {
  it('uses the saved build profile when there is one', () => {
    const text = guidanceFor(
      {
        field: 'Mechanical Engineering',
        meta: { chapterProfile: { disciplineId: 'law_v1', paradigm: 'doctrinal' } },
      },
      'Methodology',
    );
    expect(text).toContain('Research type: doctrinal');
    expect(text).toContain('binding or persuasive');
  });

  it('suggests from the field otherwise, and adds nothing when there is neither', () => {
    expect(guidanceFor({ field: 'Mechanical Engineering', meta: {} }, 'Introduction')).toContain(
      'Research type: experimental',
    );
    expect(guidanceFor({ field: null, meta: null }, 'Introduction')).toBe('');
    expect(guidanceFor(null, 'Introduction')).toBe('');
  });
});

describe('the section the cursor is in (ADR-0071)', () => {
  it('drafts for the heading under the cursor, searching with it and the student’s own text', async () => {
    const { deps, requests } = fakeDeps();
    await runDraftSection(
      { ...job, heading: 'Financial constraints', context: 'Upfront cost comes first.' },
      deps,
    );
    const query = (deps.retrieve as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(query).toContain('Financial constraints');
    expect(query).toContain('Upfront cost comes first.');
    const prompt = JSON.stringify(requests[0]);
    expect(prompt).toContain('title=\\"Financial constraints\\"');
  });

  it('finds the planned section when the editor still sends the placeholder node (ADR-0072)', async () => {
    // The editor opened on "Chapter 1" ('ch-1'); the chapters were planned from the title since,
    // and the row now points at the planned node.
    const { deps, requests } = fakeDeps();
    (deps.prisma.chapter.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'ch-1',
      documentId: 'doc-1',
      outlineNodeId: 'ch1-introduction',
      title: 'Introduction',
      scopeNote: 'Why uptake is low.',
      content: { type: 'doc', content: [] },
    });
    (deps.prisma.documentMemory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      outline: [
        {
          id: 'ch1-introduction',
          title: 'Introduction',
          scopeNote: 'Why uptake is low.',
          children: [
            {
              id: 'ch1-sec1-cost-barriers',
              title: 'Cost barriers',
              scopeNote: 'Establish upfront cost as the barrier households name first.',
              children: [],
            },
          ],
        },
      ],
    });
    await runDraftSection({ ...job, outlineNodeId: 'ch-1', heading: 'Cost barriers' }, deps);
    expect(JSON.stringify(requests[0])).toContain(
      'Establish upfront cost as the barrier households name first.',
    );
  });

  it('refuses a section that names no topic, before any search or provider call', async () => {
    const { deps, published, requests } = fakeDeps();
    (deps.prisma.chapter.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'ch-1',
      documentId: 'doc-1',
      outlineNodeId: 'ch-1',
      title: 'Chapter 1',
      scopeNote: null,
      content: { type: 'doc', content: [] },
    });
    const result = await runDraftSection({ ...job, outlineNodeId: 'ch-1' }, deps);
    expect(result.status).toBe('refused');
    expect(requests).toHaveLength(0);
    expect(deps.retrieve).not.toHaveBeenCalled();
    expect((published.at(-1) as { reason: string }).reason).toContain('Add a heading');
  });
});

describe('draftCloseTo (ADR-0071)', () => {
  const passage = {
    chunkId: 'c1',
    sourceId: 's1',
    shortRef: 'Bagla 2026',
    page: 11,
    text: 'Adoption remains constrained by informational gaps, procedural complexity, structural limitations, and perceived financial risk across districts.',
  };

  it('names the paragraph that follows a passage’s wording', () => {
    const markdown =
      'Households hesitate for many reasons.\n\nAdoption remains constrained by informational gaps, procedural complexity, structural limitations, and perceived financial risk {{cite:S1#c1}}.';
    const found = draftCloseTo(markdown, [passage]);
    expect(found).toHaveLength(1);
    expect(found[0]?.shortRef).toBe('Bagla 2026');
  });

  it('says nothing about a draft in its own words', () => {
    expect(
      draftCloseTo(
        'Families hold back because the forms are confusing and the savings feel uncertain {{cite:S1#c1}}.',
        [passage],
      ),
    ).toEqual([]);
  });
});
