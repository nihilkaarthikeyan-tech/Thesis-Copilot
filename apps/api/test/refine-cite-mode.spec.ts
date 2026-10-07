/**
 * Jenni build plan R3 — the citation presets on a refined suggestion.
 *
 * The real application on Postgres and Redis; the model is a stream. Pinned:
 * - "Re-write without citations" (`citeMode: 'none'`): a citation the model writes anyway is
 *   stripped in code, and the unit is spent as usual.
 * - "Cite from my library" (`citeMode: 'library'`): only papers the student added themselves are
 *   searched; with none on the sentence the student is told in words, the model is never called
 *   and the unit goes back (Jenni says nothing).
 */

import type { LlmChunk, Providers } from '@tc/ai';
import { EMBEDDING_DIMENSIONS, type RawClient, replaceSourceChunks } from '@tc/retrieval';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let chapterId: string;
let sourceId: string;
let providers: Providers;

const ON = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const PASSAGE =
  'In a survey of 312 rural households in Karnataka, upfront cost was the barrier most often reported by non-adopters, ahead of roof space and paperwork.';
const CITED =
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

async function suggest(citeMode: 'none' | 'library'): Promise<{ status: number; events: string }> {
  const res = await h.api('/assist/suggest', {
    method: 'POST',
    body: JSON.stringify({
      chapterId,
      before: 'Rooftop solar adoption among rural households in Karnataka remains low.',
      after: '',
      guided: 'Write the same point.',
      citeMode,
      cursorContext: { blockType: 'paragraph' },
    }),
  });
  return { status: res.status, events: await res.text() };
}

function eventData(events: string, name: string): Record<string, unknown> | null {
  const line = events
    .split('\n\n')
    .find((block) => block.startsWith(`event: ${name}`))
    ?.split('\n')
    .find((l) => l.startsWith('data: '));
  return line ? (JSON.parse(line.slice(6)) as Record<string, unknown>) : null;
}

async function assistUnits(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'ASSIST', period: periodFor() },
  });
  return row?.count ?? 0;
}

beforeAll(async () => {
  h = await startHarness('refine-cite-mode@example.com');
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
  sourceId = source.id;
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
  await h.prisma.source.update({ where: { id: sourceId }, data: { autoAddedAt: null } });
});

afterAll(async () => {
  await h?.stop();
});

describe('Re-write without citations', () => {
  it('strips a citation the model writes anyway', async () => {
    vi.spyOn(providers.llm, 'stream').mockImplementation(() => streamOf(CITED));
    const { status, events } = await suggest('none');
    expect(status).toBe(200);
    const done = eventData(events, 'done');
    expect(String(done?.text)).toMatch(/^Among 312 Karnataka households/);
    expect(String(done?.text)).not.toContain('{{cite:');
    expect(done?.citations).toEqual([]);
    expect(await assistUnits()).toBe(1);
  });
});

describe('Cite from my library', () => {
  it("cites the student's own paper", async () => {
    vi.spyOn(providers.llm, 'stream').mockImplementation(() => streamOf(CITED));
    const done = eventData((await suggest('library')).events, 'done');
    const citations = done?.citations as Array<{ sourceId: string | null }>;
    expect(citations.map((c) => c.sourceId)).toEqual([sourceId]);
  });

  it('says so, never calls the model and gives the unit back when nothing of their own fits', async () => {
    // The only paper was found for the student, not added by them.
    await h.prisma.source.update({ where: { id: sourceId }, data: { autoAddedAt: new Date() } });
    const stream = vi.spyOn(providers.llm, 'stream').mockImplementation(() => streamOf(CITED));
    const { events } = await suggest('library');
    const error = eventData(events, 'error');
    expect(error?.code).toBe('NO_LIBRARY_MATCH');
    expect(String(error?.message)).toMatch(/papers you added yourself/);
    expect(stream).not.toHaveBeenCalled();
    expect(await assistUnits()).toBe(0);
  });
});
