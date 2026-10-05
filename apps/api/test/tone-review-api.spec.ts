/**
 * The tone review through the API — ADR-0084. Pinned: the sample (a chosen paper's passages, or
 * the learned profile), one COMMAND unit a run, rewrites as data with the sentence and a position,
 * no profile and no paper refused before any unit, another thesis's paper refused, the refund when
 * nothing was served.
 */

import type { Providers } from '@tc/ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let sourceId: string;
let providers: Providers;

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

async function units(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'COMMAND', period: periodFor() },
  });
  return row?.count ?? 0;
}

beforeAll(async () => {
  h = await startHarness('tone-review@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: 'Household adoption.',
      order: 1,
      content: {
        type: 'doc',
        content: [
          paragraph('A lot of households in Karnataka never install rooftop solar.'),
          paragraph('Upfront cost was named first by 73% of respondents in the CEEW survey.'),
          paragraph('This is really a very big problem for the state.'),
        ],
      },
    },
  });
  chapterId = chapter.id;
  const source = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title: 'Household frictions in rooftop solar adoption',
      authors: [{ family: 'Bagla', given: 'R' }],
      year: 2026,
      groundingLevel: 'FULL_TEXT',
    },
  });
  sourceId = source.id;
  const chunkText = Array.from(
    { length: 12 },
    (_, i) =>
      `Passage ${i}: the study finds that upfront cost and roof ownership constrain adoption among rural households, and that information gaps compound them.`,
  );
  await h.prisma.sourceChunk.createMany({
    data: chunkText.map((text, ordinal) => ({
      sourceId: source.id,
      ordinal,
      text,
      tokenCount: 30,
    })),
  });
}, 300_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  await h.prisma.usageLedger.deleteMany({ where: { userId: h.userId, action: 'COMMAND' } });
  await h.prisma.documentMemory.deleteMany({ where: { documentId } });
});

afterAll(async () => {
  await h?.stop();
});

describe('the tone review', () => {
  it('against a chosen paper: rewrites as data, one COMMAND unit, the sample named', async () => {
    const res = await h.api('/tone-review', {
      method: 'POST',
      body: JSON.stringify({ chapterId, sampleSourceId: sourceId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      corrections: Array<{
        kind: string;
        original: string;
        replacement: string;
        sentence: string;
        near: number;
      }>;
      checkedWords: number;
      totalWords: number;
      sample: { kind: string; label: string };
    };
    expect(body.sample).toEqual({ kind: 'paper', label: 'Bagla 2026' });
    expect(body.checkedWords).toBe(body.totalWords);
    // The mock rewrites the two conversational sentences and leaves the figure alone.
    expect(body.corrections).toHaveLength(2);
    for (const c of body.corrections) {
      expect(c.kind).toBe('tone');
      expect(c.replacement).not.toBe(c.original);
      expect(c.sentence).toBe(c.original);
      expect(c.near).toBeGreaterThan(0);
    }
    expect(body.corrections.some((c) => c.original.startsWith('Upfront cost'))).toBe(false);
    expect(await units()).toBe(1);
    // Nothing changed in the chapter.
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(JSON.stringify(chapter.content)).toContain('A lot of households');
  });

  it('against the learned profile when there is one; refused before any unit when there is none', async () => {
    const none = await h.api('/tone-review', {
      method: 'POST',
      body: JSON.stringify({ chapterId }),
    });
    expect(none.status).toBe(400);
    expect(await units()).toBe(0);

    await h.prisma.documentMemory.create({
      data: {
        documentId,
        scope: {},
        outline: [],
        glossary: {},
        styleProfile: {
          learnedAt: new Date().toISOString(),
          avgSentenceLen: 20,
          register: 'formal',
          voice: 'passive',
          transitions: ['however'],
          voiceNote: 'Plain and cautious.',
          hedging: 'high',
        },
      },
    });
    const res = await h.api('/tone-review', {
      method: 'POST',
      body: JSON.stringify({ chapterId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sample: { kind: string } };
    expect(body.sample.kind).toBe('profile');
    expect(await units()).toBe(1);
  });

  it("another thesis's paper is not a sample", async () => {
    const other = await h.prisma.document.create({
      data: { ownerId: h.userId, title: 'Another', entryPath: 'A_TOPIC' },
    });
    const foreign = await h.prisma.source.create({
      data: {
        documentId: other.id,
        status: 'RESOLVED',
        title: 'Elsewhere',
        groundingLevel: 'ABSTRACT',
      },
    });
    const res = await h.api('/tone-review', {
      method: 'POST',
      body: JSON.stringify({ chapterId, sampleSourceId: foreign.id }),
    });
    expect(res.status).toBe(404);
    expect(await units()).toBe(0);
  });

  it('refunds the unit when the model fails before anything was served', async () => {
    vi.spyOn(providers.llm, 'complete').mockRejectedValue(new Error('provider down'));
    const res = await h.api('/tone-review', {
      method: 'POST',
      body: JSON.stringify({ chapterId, sampleSourceId: sourceId }),
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await units()).toBe(0);
  });
});
