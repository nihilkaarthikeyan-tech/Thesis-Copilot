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
