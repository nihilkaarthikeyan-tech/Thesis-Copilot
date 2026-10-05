/**
 * A suggestion that reuses a passage's wording is asked for again, once — ADR-0082.
 *
 * The real application on Postgres and Redis. The model is replaced with a stream that copies the
 * passage word for word the first time and rewords it when asked to (the second request carries
 * `REWORD_INSTRUCTION` in A.1's `<instruction>` slot). Pinned: the student gets the rewording,
 * unflagged and marked `reworded`; one ASSIST unit; two ASSIST call-log rows; a rewording that is
 * still verbatim is not taken, and the flag stays.
 */

import { type LlmChunk, type LlmRequest, type Providers, REWORD_INSTRUCTION } from '@tc/ai';
import { EMBEDDING_DIMENSIONS, type RawClient, replaceSourceChunks } from '@tc/retrieval';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let chapterId: string;
let providers: Providers;

const ON = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const PASSAGE =
  'In a survey of 312 rural households in Karnataka, upfront cost was the barrier most often reported by non-adopters, ahead of roof space and paperwork.';
const COPIED = `In a survey of 312 rural households in Karnataka, upfront cost was the barrier most often reported by non-adopters {{cite:S1#c1}}.`;
const REWORDED =
  'Among 312 Karnataka households, non-adopters named the initial price before anything else {{cite:S1#c1}}.';

function streamOf(text: string): AsyncIterable<LlmChunk> {
  return (async function* () {
    yield { type: 'text', text };
    yield {
      type: 'finish',
      usage: { inputTokens: 500, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 40 },
      modelId: 'mock-fast',
      finishReason: 'stop',
    };
  })();
}

async function suggestDone(): Promise<Record<string, unknown>> {
  const res = await h.api('/assist/suggest', {
    method: 'POST',
    body: JSON.stringify({
      chapterId,
      before: 'Rooftop solar adoption among rural households in Karnataka remains low.',
      after: '',
      cursorContext: { blockType: 'paragraph' },
    }),
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  const done = text
    .split('\n\n')
    .find((block) => block.startsWith('event: done'))
    ?.split('\n')
    .find((line) => line.startsWith('data: '));
  return JSON.parse(done?.slice(6) ?? '{}') as Record<string, unknown>;
}

async function assistUnits(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'ASSIST', period: periodFor() },
  });
  return row?.count ?? 0;
}

beforeAll(async () => {
  h = await startHarness('assist-reword@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId: document.id,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: 'Household adoption of rooftop solar.',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  chapterId = chapter.id;
  const source = await h.prisma.source.create({
    data: {
      documentId: document.id,
      status: 'RESOLVED',
      title: 'Solar adoption in rural Karnataka',
      authors: [{ family: 'Kumar', given: 'A' }],
      year: 2021,
      groundingLevel: 'FULL_TEXT',
    },
  });
  await replaceSourceChunks(h.prisma as unknown as RawClient, source.id, [
    {
      sourceId: source.id,
      ordinal: 0,
      text: PASSAGE,
      tokenCount: 30,
      page: 7,
      charStart: 0,
      charEnd: PASSAGE.length,
      section: 'Findings',
      embedding: ON,
    },
  ]);
}, 300_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) => texts.map(() => ON));
  await h.prisma.usageLedger.deleteMany({ where: { userId: h.userId, action: 'ASSIST' } });
});

afterAll(async () => {
  await h?.stop();
});

describe('a suggestion that copies a passage', () => {
  it('is asked for again in its own words, on the same unit, and shown unflagged', async () => {
    const requests: LlmRequest[] = [];
    vi.spyOn(providers.llm, 'stream').mockImplementation((req) => {
      requests.push(req);
      return streamOf(requests.length === 1 ? COPIED : REWORDED);
    });
    const rows = await h.prisma.aiCallLog.count({ where: { action: 'ASSIST', userId: h.userId } });

    const done = await suggestDone();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)?.content).toContain(REWORD_INSTRUCTION);
    expect(requests[0]?.messages.at(-1)?.content).not.toContain(REWORD_INSTRUCTION);
    expect(String(done.text)).toMatch(/^Among 312 Karnataka households/);
    expect(done.closeTo).toBeNull();
    expect(done.reworded).toBe(true);
    const citations = done.citations as Array<{ key: string; sourceId: string | null }>;
    expect(citations.map((c) => c.key)).toEqual(['S1#c1']);
    expect(citations[0]?.sourceId).toBeTruthy();

    expect(await assistUnits()).toBe(1);
    expect(await h.prisma.aiCallLog.count({ where: { action: 'ASSIST', userId: h.userId } })).toBe(
      rows + 2,
    );
  });

  it('keeps the first answer, flagged, when the rewording still copies', async () => {
    vi.spyOn(providers.llm, 'stream').mockImplementation(() => streamOf(COPIED));
    const done = await suggestDone();
    expect(done.reworded).toBe(false);
    expect((done.closeTo as { kind: string } | null)?.kind).toBe('verbatim');
    expect(String(done.text)).toMatch(/^In a survey of 312/);
    expect(await assistUnits()).toBe(1);
  });

  it('keeps the first answer when the second call fails', async () => {
    let calls = 0;
    vi.spyOn(providers.llm, 'stream').mockImplementation(() => {
      calls++;
      if (calls === 2) throw new Error('provider down');
      return streamOf(COPIED);
    });
    const done = await suggestDone();
    expect(done.reworded).toBe(false);
    expect(done.closeTo).not.toBeNull();
    expect(await assistUnits()).toBe(1);
  });

  it('an answer in its own words is not asked for again', async () => {
    const stream = vi.spyOn(providers.llm, 'stream').mockImplementation(() => streamOf(REWORDED));
    const done = await suggestDone();
    expect(stream).toHaveBeenCalledOnce();
    expect(done.reworded).toBe(false);
    expect(done.closeTo).toBeNull();
  });
});
