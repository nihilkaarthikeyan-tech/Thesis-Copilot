/**
 * ADR-0145 from the API side: New makes an untitled thesis with the setup card at its first row;
 * naming it in the card starts the paper search creation starts today (ADR-0070); the field and
 * university are kept where chapter build reads them; "Standard chapters" and "No headings"
 * replace a plan only while nothing is written; an untouched untitled thesis leaves the list after
 * a day without being deleted.
 */

import { AUTO_SOURCES_FLAG, initialSourcesJobKey, TEMPLATE_SPECS } from '@tc/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../src/modules/flags/flags.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let queue: Queue;
let redis: Redis;

const TITLE = 'Barriers to rooftop solar adoption among rural households in Karnataka';

async function createNew(): Promise<{ id: string; firstChapterId: string }> {
  const res = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Untitled thesis',
      entryPath: 'A_TOPIC',
      start: 'writing',
      askFirst: true,
      setup: true,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; firstChapterId: string };
}

async function setup(id: string, body: Record<string, unknown>) {
  return h.api(`/documents/${id}/setup`, { method: 'PUT', body: JSON.stringify(body) });
}

beforeAll(async () => {
  h = await startHarness('setup-card@example.com');
  await h.prisma.featureFlag.upsert({
    where: { key: AUTO_SOURCES_FLAG },
    create: { key: AUTO_SOURCES_FLAG, enabled: true },
    update: { enabled: true },
  });
  h.app.get(FlagsService).invalidate();
  redis = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  queue = new Queue('find-sources', { connection: redis });
}, 300_000);

afterAll(async () => {
  await queue?.close();
  await redis?.quit();
  await h?.stop();
});

describe('the setup card (ADR-0145)', () => {
  it('New makes an untitled thesis whose card starts at the title, and searches nothing yet', async () => {
    const created = await createNew();
    const doc = (await (await h.api(`/documents/${created.id}`)).json()) as {
      meta: { setup?: { step: string; done: boolean } };
    };
    expect(doc.meta.setup).toMatchObject({ step: 'title', done: false, dismissedAt: null });
    expect(await queue.getJob(initialSourcesJobKey(created.id))).toBeUndefined();
  });

  it('naming the thesis renames it and starts the search on that title, with its source settings', async () => {
    const created = await createNew();
    const res = await setup(created.id, {
      title: TITLE,
      sourcePrefs: {
        webSearch: true,
        librarySearch: true,
        yearFrom: null,
        yearTo: null,
        indexedIn: [],
        preprints: false,
      },
      step: 'field',
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      title: string;
      searching: boolean;
      setup: { step: string };
    };
    expect(view).toMatchObject({ title: TITLE, searching: true, setup: { step: 'field' } });
    const job = await queue.getJob(initialSourcesJobKey(created.id, TITLE));
    expect(job?.data).toMatchObject({ documentId: created.id, query: TITLE, initial: true });
    const row = await h.prisma.document.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.title).toBe(TITLE);
    expect((row.meta as { sourcePrefs?: { preprints?: boolean } }).sourcePrefs?.preprints).toBe(
      false,
    );

    // The same title again is not a second search.
    const again = (await (await setup(created.id, { title: TITLE })).json()) as {
      searching: boolean;
    };
    expect(again.searching).toBe(false);
  });

  it('keeps the field and university where chapter build reads them, and refuses an unknown one', async () => {
    const created = await createNew();
    const res = await setup(created.id, {
      field: 'Agriculture and environment',
      universityId: 'anna_university_v1',
      step: 'aim',
    });
    expect(res.status).toBe(200);
    const row = await h.prisma.document.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.field).toBe('Agriculture and environment');
    expect((row.meta as { universityId?: string }).universityId).toBe('anna_university_v1');
    expect((await setup(created.id, { universityId: 'nowhere_v1' })).status).toBe(400);

    // Finish later, then back.
    const folded = (await (await setup(created.id, { dismissed: true })).json()) as {
      setup: { dismissedAt: string | null; step: string };
    };
    expect(folded.setup.dismissedAt).not.toBeNull();
    expect(folded.setup.step).toBe('aim');
    const back = (await (await setup(created.id, { dismissed: false })).json()) as {
      setup: { dismissedAt: string | null };
    };
    expect(back.setup.dismissedAt).toBeNull();
  });

  it('Standard chapters and No headings replace a plan while nothing is written, and not after', async () => {
    const created = await createNew();
    // A planned thesis: three chapters, the first with section headings and no writing.
    await h.api(`/documents/${created.id}/memory/outline`, {
      method: 'PUT',
      body: JSON.stringify({
        outline: [
          { id: 'p1', title: 'Introduction', scopeNote: 'Why.', children: [] },
          { id: 'p2', title: 'Rooftop solar in India', scopeNote: 'What.', children: [] },
          { id: 'p3', title: 'Survey design', scopeNote: 'How.', children: [] },
        ],
      }),
    });
    const standard = await h.api(`/documents/${created.id}/outline/restart`, {
      method: 'POST',
      body: JSON.stringify({ structure: 'standard', chapterId: created.firstChapterId }),
    });
    expect(standard.status).toBe(200);
    let chapters = await h.prisma.chapter.findMany({
      where: { documentId: created.id },
      orderBy: { order: 'asc' },
    });
    expect(chapters.map((c) => c.title)).toEqual(
      TEMPLATE_SPECS.STEM_EMPIRICAL.chapters.map((c) => c.title),
    );
    expect(chapters).toHaveLength(6);
    // The first chapter keeps its row, so the address the student is on still works.
    expect(chapters[0]?.id).toBe(created.firstChapterId);

    const none = await h.api(`/documents/${created.id}/outline/restart`, {
      method: 'POST',
      body: JSON.stringify({ structure: 'none' }),
    });
    expect(none.status).toBe(200);
    chapters = await h.prisma.chapter.findMany({ where: { documentId: created.id } });
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1']);

    // Once a sentence is written, the chapters are the student's.
    await h.prisma.chapter.update({
      where: { id: created.firstChapterId },
      data: {
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Chapter 1' }],
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Rooftop solar spreads slowly.' }],
            },
          ],
        },
      },
    });
    const refused = await h.api(`/documents/${created.id}/outline/restart`, {
      method: 'POST',
      body: JSON.stringify({ structure: 'standard' }),
    });
    expect(refused.status).toBe(409);
  });

  it('an untouched untitled thesis leaves the list after a day; named or written in, it stays', async () => {
    const untouched = await createNew();
    const named = await createNew();
    await setup(named.id, {
      title: 'Fish drying losses in coastal Kerala villages',
      step: 'field',
    });
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await h.prisma.document.updateMany({
      where: { id: { in: [untouched.id, named.id] } },
      data: { createdAt: old },
    });
    const listed = (await (await h.api('/documents')).json()) as Array<{ id: string }>;
    const ids = listed.map((d) => d.id);
    expect(ids).not.toContain(untouched.id);
    expect(ids).toContain(named.id);
    // Nothing deleted: the thesis still opens.
    expect((await h.api(`/documents/${untouched.id}`)).status).toBe(200);
  });
});
