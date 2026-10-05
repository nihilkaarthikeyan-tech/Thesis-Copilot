/**
 * ADR-0071 from the API side: Draft mode refuses a section that names no topic ("Chapter 1" with
 * no scope and no heading above the cursor), before any unit is taken; with a heading, the draft
 * goes ahead and the heading reaches the job.
 */

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let chapterId: string;
let redis: Redis;
let queue: Queue;

async function draftsUsed(): Promise<number> {
  const rows = await h.prisma.usageLedger.findMany({
    where: { userId: h.userId, action: 'DRAFT' },
  });
  return rows.reduce((n, r) => n + r.count, 0);
}

beforeAll(async () => {
  h = await startHarness('draft-topic@example.com');
  const res = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Untitled thesis', entryPath: 'A_TOPIC' }),
  });
  chapterId = ((await res.json()) as { firstChapterId: string }).firstChapterId;
  redis = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  queue = new Queue('draft-section', { connection: redis });
}, 300_000);

afterAll(async () => {
  await queue?.close();
  await redis?.quit();
  await h?.stop();
});

describe('Draft mode needs a topic', () => {
  it('refuses "Chapter 1" with no heading, and takes no unit', async () => {
    const before = await draftsUsed();
    const res = await h.api('/draft/section', {
      method: 'POST',
      body: JSON.stringify({ chapterId, outlineNodeId: 'ch-1', context: 'Some text.' }),
    });
    expect(res.status).toBe(422);
    const problem = (await res.json()) as { type: string; detail: string };
    expect(problem.type).toBe('SECTION_NEEDS_TOPIC');
    expect(problem.detail).toContain('Add a heading above the cursor');
    expect(await draftsUsed()).toBe(before);
  });

  it('a heading that is itself generic is refused too', async () => {
    const res = await h.api('/draft/section', {
      method: 'POST',
      body: JSON.stringify({ chapterId, outlineNodeId: 'ch-1', heading: '## Chapter 2' }),
    });
    expect(res.status).toBe(422);
  });

  it('with a heading, the draft starts and the heading reaches the job', async () => {
    const controller = new AbortController();
    const res = await h.api('/draft/section', {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        outlineNodeId: 'ch-1',
        heading: 'Financial constraints',
        context: 'Upfront cost comes first.',
      }),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    // The stream opens before the job is enqueued; give it a moment.
    let job: Awaited<ReturnType<typeof queue.getJobs>>[number] | undefined;
    for (let i = 0; i < 50 && !job; i++) {
      const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
      job = jobs.find((j) => j.data.chapterId === chapterId);
      if (!job) await new Promise((r) => setTimeout(r, 100));
    }
    expect(job?.data).toMatchObject({
      heading: 'Financial constraints',
      context: 'Upfront cost comes first.',
    });
    controller.abort();
  });
});
