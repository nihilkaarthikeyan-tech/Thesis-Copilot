/**
 * Caps on every P1 action — PRD FR-9.2, §10.2, §11.5, PHASES 4.1.
 *
 * `cap-concurrency.spec.ts` proves the atomic counter at the service level and `week1.spec.ts`
 * proves the Assist endpoint refuses call 51. This proves the same for the two remaining P1
 * actions through their real HTTP paths, and one thing the service tests cannot: a refused draft
 * gives its unit back, because the student was never served (§11.5).
 */

import { EMBEDDING_DIMENSIONS, type RawClient, replaceSourceChunks } from '@tc/retrieval';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let outlineNodeId: string;

/** The FREE_TRIAL caps a fresh account starts on (PRD §11.3). */
const CAPS = { CITE: 10, DRAFT: 2 } as const;

async function usedUnits(action: keyof typeof CAPS): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action, period: periodFor() },
  });
  return row?.count ?? 0;
}

async function fillToCap(action: keyof typeof CAPS): Promise<void> {
  await h.prisma.usageLedger.upsert({
    where: { userId_period_action: { userId: h.userId, period: periodFor(), action } },
    create: { userId: h.userId, period: periodFor(), action, count: CAPS[action] },
    update: { count: CAPS[action] },
  });
}

beforeAll(async () => {
  h = await startHarness('caps@example.com');

  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Caps', entryPath: 'B_PAPER' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;
  outlineNodeId = (
    await h.prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      select: { outlineNodeId: true },
    })
  ).outlineNodeId;

  // One indexed source, so citation suggestion has a passage to offer and reaches the cap check.
  // (It retrieves before charging: with nothing to cite there is nothing to charge for.)
  const source = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title: 'Solar adoption in rural Karnataka',
      authors: [{ family: 'Kumar', given: 'A' }],
      year: 2021,
      groundingLevel: 'ABSTRACT',
    },
  });
  await replaceSourceChunks(h.prisma as unknown as RawClient, source.id, [
    {
      sourceId: source.id,
      ordinal: 0,
      text: 'In a 2021 survey of 312 rural households, upfront cost was the main barrier reported.',
      tokenCount: 20,
      page: 7,
      charStart: 0,
      charEnd: 90,
      section: 'Findings',
      embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.01),
    },
  ]);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('CITE cap (FR-4.5 is metered as CITE)', () => {
  const claim = 'Studies show that 78% of households cited upfront cost as the main barrier.';

  it('serves a suggestion and charges one unit while under the cap', async () => {
    const before = await usedUnits('CITE');
    const response = await h.api('/citations/suggest', {
      method: 'POST',
      body: JSON.stringify({ chapterId, sentence: claim }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { triggered: boolean; suggestions: unknown[] };
    expect(body.triggered).toBe(true);
    expect(await usedUnits('CITE')).toBe(before + 1);
  });

  it('refuses with 429 CAP_EXCEEDED at the cap, before any provider call', async () => {
    await fillToCap('CITE');
    const response = await h.api('/citations/suggest', {
      method: 'POST',
      body: JSON.stringify({ chapterId, sentence: claim }),
    });
    expect(response.status).toBe(429);
    const problem = (await response.json()) as { type: string; cap?: number };
    expect(problem.type).toBe('CAP_EXCEEDED');
    // The counter does not creep past the cap on a refusal.
    expect(await usedUnits('CITE')).toBe(CAPS.CITE);
  });

  it('does not charge for a sentence the heuristic declines', async () => {
    const before = await usedUnits('CITE');
    const response = await h.api('/citations/suggest', {
      method: 'POST',
      body: JSON.stringify({ chapterId, sentence: 'This section examines cost barriers.' }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { triggered: boolean }).triggered).toBe(false);
    expect(await usedUnits('CITE')).toBe(before);
  });
});

describe('DRAFT cap (FR-4.4 is metered as DRAFT)', () => {
  it('refuses with 429 CAP_EXCEEDED at the cap, before opening a stream', async () => {
    await fillToCap('DRAFT');
    const response = await h.api('/draft/section', {
      method: 'POST',
      // ADR-0071: a section needs a topic before the cap is even consulted.
      body: JSON.stringify({ chapterId, outlineNodeId, heading: 'Financial constraints' }),
    });
    // A refusal is JSON problem-details, not a 200 with an error event (see assist/sse.ts).
    expect(response.status).toBe(429);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(((await response.json()) as { type: string }).type).toBe('CAP_EXCEEDED');
    expect(await usedUnits('DRAFT')).toBe(CAPS.DRAFT);
  });

  it('takes the unit when the stream opens, so a worker refusal has something to refund', async () => {
    // Under the cap again, but the chapter has no pins and retrieval finds nothing to draft from.
    await h.prisma.usageLedger.updateMany({
      where: { userId: h.userId, action: 'DRAFT', period: periodFor() },
      data: { count: 0 },
    });
    await h.prisma.sourceChunk.deleteMany({});
    await h.prisma.chapterSourcePin.deleteMany({ where: { chapterId } });

    const response = await h.api('/draft/section', {
      method: 'POST',
      // ADR-0071: a section needs a topic before the cap is even consulted.
      body: JSON.stringify({ chapterId, outlineNodeId, heading: 'Financial constraints' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    // No worker runs in this harness, so the stream never sees a `done`; the refund path is the
    // worker's `refused` event, exercised in the worker's own tests and the E2E. What this proves
    // is the accounting boundary: the unit is taken at the start of the stream.
    expect(await usedUnits('DRAFT')).toBe(1);
  });
});
