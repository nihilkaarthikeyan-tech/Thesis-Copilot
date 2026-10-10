/**
 * ADR-0151: a chapter's first sentence for a thesis whose title names a place no paper in the
 * library names is not offered — production (2026-10-10) cited a South African review as the
 * first sentence of a Karnataka thesis. Pinned against the real application on Postgres and
 * Redis: no model call, the unit given back, the place named for the card; a paper on the place
 * (or the country it lies in, by its abstract) lets the sentence through; and a chapter that has
 * its first sentence is not held to it.
 */

import type { LlmChunk, Providers } from '@tc/ai';
import { EMBEDDING_DIMENSIONS, type RawClient, replaceSourceChunks } from '@tc/retrieval';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let providers: Providers;

const ON = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const SOUTH_AFRICA =
  'Upfront cost and limited access to credit were the barriers households in South Africa reported most often.';
const ANSWER = 'Upfront cost is the barrier households report most often {{cite:S1#c1}}.';

function streamOf(text: string): AsyncIterable<LlmChunk> {
  return (async function* () {
    yield { type: 'text', text };
    yield {
      type: 'finish',
      usage: { inputTokens: 500, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 20 },
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
      before: 'Chapter 1 Introduction',
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

async function addPaper(title: string, passage: string, abstract?: string): Promise<void> {
  const source = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title,
      authors: [{ family: 'Author', given: 'A' }],
      year: 2024,
      groundingLevel: 'FULL_TEXT',
      ...(abstract ? { cslJson: { abstract } } : {}),
    },
  });
  await replaceSourceChunks(h.prisma as unknown as RawClient, source.id, [
    {
      sourceId: source.id,
      ordinal: 0,
      text: passage,
      tokenCount: 30,
      page: 3,
      charStart: 0,
      charEnd: passage.length,
      section: 'Findings',
      embedding: ON,
    },
  ]);
}

function setChapterText(words: string): Promise<unknown> {
  return h.prisma.chapter.update({
    where: { id: chapterId },
    data: {
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Introduction' }],
          },
          ...(words ? [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] : []),
        ],
      },
    },
  });
}

beforeAll(async () => {
  h = await startHarness('setting-gap@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const document = await h.prisma.document.create({
    data: {
      ownerId: h.userId,
      title: 'Barriers to rooftop solar adoption among rural households in Karnataka',
      entryPath: 'A_TOPIC',
    },
  });
  documentId = document.id;
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'ch-1',
      title: 'Introduction',
      scopeNote: 'Why rooftop solar uptake is low among rural households.',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  chapterId = chapter.id;
  await addPaper('Rooftop solar barriers: a scoping review', SOUTH_AFRICA);
}, 300_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) => texts.map(() => ON));
  await h.prisma.usageLedger.deleteMany({ where: { userId: h.userId, action: 'ASSIST' } });
});

afterAll(async () => {
  await h?.stop();
});

describe('the first sentence and the thesis setting (ADR-0151)', () => {
  it('is not offered when no paper names the place, and costs nothing', async () => {
    await setChapterText('');
    const stream = vi.spyOn(providers.llm, 'stream').mockImplementation(() => streamOf(ANSWER));
    const done = await suggestDone();
    expect(stream).not.toHaveBeenCalled();
    expect(done.settingGap).toBe('Karnataka');
    expect(done.text).toBe('');
    expect(done.citations).toEqual([]);
    expect(done.papersLoading).toBe(false);
    expect(await assistUnits()).toBe(0);
  });

  it('a chapter that has its first sentence is not held to it', async () => {
    await setChapterText('Rooftop solar adoption remains low in rural Karnataka.');
    const stream = vi.spyOn(providers.llm, 'stream').mockImplementation(() => streamOf(ANSWER));
    const done = await suggestDone();
    expect(stream).toHaveBeenCalledOnce();
    expect(done.settingGap ?? null).toBeNull();
    await setChapterText('');
  });

  it('is offered once a paper names the country the place lies in, by its abstract', async () => {
    await addPaper(
      'Household energy transitions',
      'Net metering raised uptake among households.',
      'Evidence from 1,200 households across India on rooftop solar and net metering.',
    );
    const stream = vi.spyOn(providers.llm, 'stream').mockImplementation(() => streamOf(ANSWER));
    const done = await suggestDone();
    expect(stream).toHaveBeenCalledOnce();
    expect(done.settingGap ?? null).toBeNull();
    expect(String(done.text).length).toBeGreaterThan(0);
  });
});
