/**
 * ADR-0037 from the API side: autocomplete on a chapter whose library has nothing on topic starts
 * a search for papers, tells the editor so, and a second request inside the cooldown is the same
 * search rather than another one. With the site switch off, nothing starts.
 */

import { AUTO_SOURCES_FLAG, autoSourcesJobKey, initialSourcesJobKey } from '@tc/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../src/modules/flags/flags.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let chapterId: string;
let queue: Queue;
let redis: Redis;

async function suggestDone(): Promise<Record<string, unknown>> {
  const res = await h.api('/assist/suggest', {
    method: 'POST',
    body: JSON.stringify({
      chapterId,
      before: 'Electrode wear governs the cost of machining Hastelloy.',
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

async function setFlag(enabled: boolean) {
  await h.prisma.featureFlag.upsert({
    where: { key: AUTO_SOURCES_FLAG },
    create: { key: AUTO_SOURCES_FLAG, enabled },
    update: { enabled },
  });
  h.app.get(FlagsService).invalidate();
}

beforeAll(async () => {
  h = await startHarness('auto-sources@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'EDM of Hastelloy', entryPath: 'A_TOPIC' },
  });
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId: document.id,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: 'Electrode materials and wear in EDM of nickel superalloys.',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  chapterId = chapter.id;
  redis = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  queue = new Queue('find-sources', { connection: redis });
}, 300_000);

afterAll(async () => {
  await queue?.close();
  await redis?.quit();
  await h?.stop();
});

describe('automatic sources from autocomplete', () => {
  it('with the switch off, nothing starts', async () => {
    await setFlag(false);
    const done = await suggestDone();
    expect(done.findingSources).toBe(false);
    expect(await queue.getJob(autoSourcesJobKey(chapterId))).toBeUndefined();
  });

  it('with it on and an empty library, starts one search and tells the editor', async () => {
    await setFlag(true);
    const done = await suggestDone();
    expect(done.findingSources).toBe(true);
    // ADR-0070: the library is still filling, so the editor is told to wait for citations.
    expect(done.papersLoading).toBe(true);
    const job = await queue.getJob(autoSourcesJobKey(chapterId));
    expect(job?.data).toMatchObject({ chapterId, userId: h.userId });
    expect(String(job?.data.query)).toContain('Literature Review');
    expect(String(job?.data.query)).toContain('Electrode wear governs the cost');

    // A second request inside the cooldown is the same job, not a second search.
    await suggestDone();
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('a new thesis with a real title starts its search at once (ADR-0070)', async () => {
    const res = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Barriers to rooftop solar adoption in rural Karnataka',
        entryPath: 'A_TOPIC',
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; firstChapterId: string };
    // ADR-0087: the search made at creation is its own job, and adds fifteen papers.
    const job = await queue.getJob(initialSourcesJobKey(created.id));
    expect(job?.data).toMatchObject({
      documentId: created.id,
      query: 'Barriers to rooftop solar adoption in rural Karnataka',
      initial: true,
    });

    const progress = await h.api(`/documents/${created.id}/sources/progress`);
    expect(progress.status).toBe(200);
    expect(await progress.json()).toEqual({ searching: true, found: 0, ready: 0, reading: 0 });
  });

  it('a placeholder title starts nothing', async () => {
    const res = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Untitled thesis', entryPath: 'A_TOPIC' }),
    });
    const created = (await res.json()) as { id: string; firstChapterId: string };
    expect(await queue.getJob(initialSourcesJobKey(created.id))).toBeUndefined();
    const progress = await h.api(`/documents/${created.id}/sources/progress`);
    expect(await progress.json()).toMatchObject({ searching: false });
  });

  it('a student who turned it off gets no search', async () => {
    await h.prisma.user.update({
      where: { id: h.userId },
      data: { settings: { autoSources: false } },
    });
    await queue.obliterate({ force: true });
    const done = await suggestDone();
    expect(done.findingSources).toBe(false);
  });
});
