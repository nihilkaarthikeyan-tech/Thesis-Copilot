/**
 * Examiner review through its real HTTP path — ADR-0056.
 *
 * The cap test every metered action has: starting a review is one `EXAMINER_REVIEW` unit, taken
 * before the job is queued, and at the cap the refusal comes with no record and no job. Around
 * it: the refusals that cost nothing (too little of the student's own text — a pending AI draft
 * does not count; a review already running; a chapter unchanged since a complete review), the
 * unit given back when the job cannot be queued, the job id keyed on what the job reads, owner
 * only, and the flags served with the examiner's correction beside the coherence run's.
 */

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueService } from '../src/common/queue.service.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let redis: Redis;
let queue: Queue;

/** FREE_TRIAL's `EXAMINER_REVIEW` cap (ADR-0056). */
const CAP = 1;

const text = (t: string) => ({ type: 'text', text: t });
const para = (t: string) => ({ type: 'paragraph', content: [text(t)] });

const OWN_TEXT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Introduction')] },
    para('Solar drying removes moisture using solar heat in an enclosed cabinet.'),
    para('Open drying loses an estimated fifth of the catch to spoilage every season.'),
    para('This thesis measures the losses of three dryer designs on the Kerala coast.'),
  ],
};

const DRAFT_ONLY = {
  type: 'doc',
  content: [
    para('One sentence of the student’s own, long enough to count.'),
    {
      type: 'draftBlock',
      attrs: { draftId: '00000000-0000-7000-8000-000000000001', status: 'pending' },
      content: [
        para('An AI draft sentence that is long enough to count if it were counted.'),
        para('Another AI draft sentence that the student has not yet accepted at all.'),
        para('A third AI draft sentence, still waiting for the student to decide on it.'),
      ],
    },
  ],
};

async function units(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'EXAMINER_REVIEW', period: periodFor() },
  });
  return row?.count ?? 0;
}

async function setUnits(count: number): Promise<void> {
  await h.prisma.usageLedger.upsert({
    where: {
      userId_period_action: { userId: h.userId, period: periodFor(), action: 'EXAMINER_REVIEW' },
    },
    create: { userId: h.userId, period: periodFor(), action: 'EXAMINER_REVIEW', count },
    update: { count },
  });
}

async function setChapter(content: unknown): Promise<number> {
  const chapter = await h.prisma.chapter.update({
    where: { id: chapterId },
    data: { content: content as never, version: { increment: 1 } },
    select: { version: true },
  });
  return chapter.version;
}

async function record(): Promise<Record<string, unknown> | undefined> {
  const document = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  return (document.meta as { examinerReviews?: Record<string, Record<string, unknown>> } | null)
    ?.examinerReviews?.[chapterId];
}

const start = () => h.api(`/chapters/${chapterId}/examiner-review`, { method: 'POST', body: '{}' });

beforeAll(async () => {
  h = await startHarness('examiner@example.com');
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Solar drying of fish', entryPath: 'A_TOPIC' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
  queue = new Queue('examiner-review', { connection: redis });
}, 300_000);

afterAll(async () => {
  await queue?.close();
  redis?.disconnect();
  await h?.stop();
});

beforeEach(async () => {
  await setUnits(0);
  await queue.obliterate({ force: true });
  const document = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const meta = { ...((document.meta as Record<string, unknown> | null) ?? {}) };
  delete meta.examinerReviews;
  await h.prisma.document.update({ where: { id: documentId }, data: { meta: meta as never } });
});

describe('starting an examiner review', () => {
  it('refuses, for nothing, a chapter with fewer than three sentences of the student’s own', async () => {
    await setChapter(DRAFT_ONLY);
    const response = await start();
    expect(response.status).toBe(400);
    expect(await units()).toBe(0);
    expect(await record()).toBeUndefined();
    expect(await queue.count()).toBe(0);
  });

  it('takes one unit and queues a job keyed on the chapter and the version it will read', async () => {
    const version = await setChapter(OWN_TEXT);
    const response = await start();
    expect(response.status).toBe(202);
    const view = (await response.json()) as { status: string; runId: string };
    expect(view.status).toBe('QUEUED');
    expect(await units()).toBe(1);

    const job = await queue.getJob(`examiner-review__${chapterId}__v${version}__a0`);
    expect(job?.data).toMatchObject({ documentId, chapterId, runId: view.runId, version });
    expect(job?.id).not.toContain(':');

    // The status the Flags tab polls.
    const status = (await (await h.api(`/chapters/${chapterId}/examiner-review`)).json()) as {
      status: string;
      runId: string;
    };
    expect(status).toMatchObject({ status: 'QUEUED', runId: view.runId });

    // A second press while it runs is refused, for nothing.
    const again = await start();
    expect(again.status).toBe(409);
    expect(await units()).toBe(1);
  });

  it('is refused at the cap, before any record or job', async () => {
    await setChapter(OWN_TEXT);
    await setUnits(CAP);
    const response = await start();
    expect(response.status).toBe(429);
    expect(await units()).toBe(CAP);
    expect(await record()).toBeUndefined();
    expect(await queue.count()).toBe(0);
  });

  it('refuses, for nothing, a chapter unchanged since a complete review; a changed one is a new review', async () => {
    const version = await setChapter(OWN_TEXT);
    const document = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await h.prisma.document.update({
      where: { id: documentId },
      data: {
        meta: {
          ...((document.meta as Record<string, unknown> | null) ?? {}),
          examinerReviews: {
            [chapterId]: {
              runId: '00000000-0000-4000-8000-000000000001',
              status: 'DONE',
              version,
              attempt: 0,
              startedAt: new Date().toISOString(),
              failedSections: [],
            },
          },
        } as never,
      },
    });
    const unchanged = await start();
    expect(unchanged.status).toBe(409);
    expect(await units()).toBe(0);

    const next = await setChapter(OWN_TEXT);
    const changed = await start();
    expect(changed.status).toBe(202);
    expect(await units()).toBe(1);
    expect(await queue.getJob(`examiner-review__${chapterId}__v${next}__a0`)).toBeTruthy();
  });

  it('gives the unit back when the job cannot be queued', async () => {
    await setChapter(OWN_TEXT);
    // Every module has its own QueueService instance; the prototype reaches the one in use.
    const spy = vi
      .spyOn(QueueService.prototype, 'enqueue')
      .mockRejectedValueOnce(new Error('redis down'));
    const response = await start();
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(await units()).toBe(0);
    expect(await record()).toMatchObject({ status: 'FAILED' });
  });

  it('is the owner’s alone', async () => {
    const other = await h.prisma.user.create({ data: { email: 'someone@example.edu' } });
    const theirs = await h.prisma.document.create({
      data: {
        ownerId: other.id,
        title: 'Someone else’s thesis',
        entryPath: 'A_TOPIC',
        chapters: {
          create: { outlineNodeId: 'n1', title: 'Chapter 1', order: 0, content: OWN_TEXT },
        },
      },
      include: { chapters: true },
    });
    const response = await h.api(`/chapters/${theirs.chapters[0]?.id}/examiner-review`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(404);
    expect(await units()).toBe(0);
    await h.prisma.document.delete({ where: { id: theirs.id } });
    await h.prisma.user.delete({ where: { id: other.id } });
  });
});

describe('examiner flags', () => {
  it('are served with the examiner’s correction, and hold their place while the chapter is the version reviewed', async () => {
    const version = await setChapter(OWN_TEXT);
    const runId = '00000000-0000-4000-8000-0000000000aa';
    const document = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await h.prisma.document.update({
      where: { id: documentId },
      data: {
        meta: {
          ...((document.meta as Record<string, unknown> | null) ?? {}),
          examinerReviews: {
            [chapterId]: {
              runId,
              status: 'DONE',
              version,
              attempt: 0,
              startedAt: new Date().toISOString(),
              issues: 1,
              blocking: 1,
            },
          },
        } as never,
      },
    });
    await h.prisma.coherenceFlag.create({
      data: {
        documentId,
        chapterId,
        from: 87,
        to: 162,
        type: 'EXAMINER',
        severity: 'ERROR',
        description: 'A fifth is not a measured figure.',
        suggestion: 'Cite a measured loss figure.',
        fingerprint: 'EXAMINER:x',
        runId,
      },
    });
    const read = async () =>
      (
        (await (await h.api(`/documents/${documentId}/coherence/flags`)).json()) as {
          flags: Array<{ type: string; suggestion: string | null; positionTrusted: boolean }>;
        }
      ).flags.find((f) => f.type === 'EXAMINER');
    expect(await read()).toMatchObject({
      suggestion: 'Cite a measured loss figure.',
      positionTrusted: true,
    });

    // Saved again: the range may have moved.
    await setChapter(OWN_TEXT);
    expect((await read())?.positionTrusted).toBe(false);
    await h.prisma.coherenceFlag.deleteMany({ where: { documentId, type: 'EXAMINER' } });
  });
});
