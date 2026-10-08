/**
 * The literature review build through its real HTTP path — ADR-0124 (R37).
 *
 * The cap test every metered action has, with this one's two extra locks: the flag (off by
 * default, seeded off by migration 0050) and a cap of 0 on every plan. Planning is code only and
 * costs nothing (no unit, no provider call); starting is one `LIT_REVIEW_BUILD` unit taken before
 * the job is queued, refused at the cap with no unit and no job, and allowed by an admin's extra
 * allowance. The job is keyed on the build row and carries `kind: 'LIT_REVIEW'`.
 */

import type { Prisma } from '@tc/db';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FlagsService } from '../src/modules/flags/flags.service.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let introductionId: string;
let literatureId: string;
let redis: Redis;
let queue: Queue;

const FLAG = 'literatureReviewBuild';

async function ledger(): Promise<{ count: number; bonus: number }> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'LIT_REVIEW_BUILD', period: periodFor() },
  });
  return { count: row?.count ?? 0, bonus: row?.bonus ?? 0 };
}

async function setLedger(count: number, bonus: number): Promise<void> {
  await h.prisma.usageLedger.upsert({
    where: {
      userId_period_action: { userId: h.userId, period: periodFor(), action: 'LIT_REVIEW_BUILD' },
    },
    create: { userId: h.userId, period: periodFor(), action: 'LIT_REVIEW_BUILD', count, bonus },
    update: { count, bonus },
  });
}

async function setFlag(enabled: boolean): Promise<void> {
  await h.prisma.featureFlag.update({ where: { key: FLAG }, data: { enabled } });
  h.app.get(FlagsService).invalidate();
}

const planReview = (chapterId: string) =>
  h.api(`/documents/${documentId}/literature-review`, {
    method: 'POST',
    body: JSON.stringify({
      chapterId,
      profile: {
        disciplineId: 'engineering_core_v1',
        paradigm: 'experimental',
        universityId: 'generic_author_year_v1',
      },
    }),
  });

type View = {
  id: string;
  kind: string;
  status: string;
  plan: {
    themes: Array<{
      id: string;
      title: string;
      note: string;
      outlineNodeId: string | null;
      children: Array<{ title: string }>;
      from: string;
    }>;
  };
};

beforeAll(async () => {
  h = await startHarness('review@example.com');
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Wear of AA7050 composites', entryPath: 'A_TOPIC' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  introductionId = document.firstChapterId;
  const introduction = await h.prisma.chapter.findUniqueOrThrow({ where: { id: introductionId } });
  const literature = await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'ch2-literature',
      title: 'Literature Review',
      order: introduction.order + 1,
      content: { type: 'doc', content: [] },
    },
  });
  literatureId = literature.id;
  const memory = {
    scope: {
      workingTitle: 'Wear of AA7050 composites',
      problemStatement: 'p',
      objectives: ['To evaluate the dry sliding wear of AA7050/TiC composites.'],
      whyOpen: 'w',
    } as Prisma.InputJsonValue,
    outline: [
      { id: introduction.outlineNodeId, title: introduction.title, scopeNote: 'i', children: [] },
      {
        id: 'ch2-literature',
        title: 'Literature Review',
        scopeNote: 'Review the field.',
        children: [
          { id: 'ch2-intro', title: 'Introduction', scopeNote: 'Scope.', children: [] },
          {
            id: 'ch2-wear',
            title: 'Wear of hybrid aluminium composites',
            scopeNote: 'Dry sliding wear.',
            children: [{ id: 'ch2-wear-a', title: 'Adhesive wear', scopeNote: 'a', children: [] }],
          },
          { id: 'ch2-gaps', title: 'Research gaps', scopeNote: 'g', children: [] },
        ],
      },
    ] as Prisma.InputJsonValue,
    // The literature search's themes (A.8): "Other" is not one, and a repeat is dropped.
    gapMap: {
      runId: 'r',
      at: '2026-10-08T00:00:00.000Z',
      themes: [
        { name: 'Other', count: 9, thin: false, candidateIds: [], sourceIds: [] },
        { name: 'Stir casting routes', count: 2, thin: true, candidateIds: [], sourceIds: [] },
        { name: 'Solid lubricants', count: 7, thin: false, candidateIds: [], sourceIds: [] },
        {
          name: 'Wear of hybrid aluminium composites',
          count: 5,
          thin: false,
          candidateIds: [],
          sourceIds: [],
        },
      ],
    } as Prisma.InputJsonValue,
  };
  await h.prisma.documentMemory.upsert({
    where: { documentId },
    create: { documentId, ...memory, glossary: {} },
    update: memory,
  });
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
  queue = new Queue('lit-review-build', { connection: redis });
}, 300_000);

afterAll(async () => {
  await queue?.close();
  redis?.disconnect();
  await h?.stop();
});

beforeEach(async () => {
  await setLedger(0, 0);
  await h.prisma.chapterBuild.deleteMany({ where: { documentId } });
  await setFlag(false);
});

describe('behind its flag', () => {
  it('is seeded off, not offered, and refused for nothing while off', async () => {
    const row = await h.prisma.featureFlag.findUniqueOrThrow({ where: { key: FLAG } });
    expect(row.enabled).toBe(false);
    const overview = (await (await h.api(`/documents/${documentId}/chapter-build`)).json()) as {
      literatureReview: { enabled: boolean; chapters?: unknown };
    };
    expect(overview.literatureReview).toEqual({ enabled: false });

    const response = await planReview(literatureId);
    expect(response.status).toBe(403);
    expect(await h.prisma.chapterBuild.count({ where: { documentId } })).toBe(0);
    expect((await ledger()).count).toBe(0);
  });
});

describe('with the flag on', () => {
  it('offers the literature chapter only, and plans its themes in code for nothing', async () => {
    await setFlag(true);
    const overview = (await (await h.api(`/documents/${documentId}/chapter-build`)).json()) as {
      literatureReview: {
        enabled: boolean;
        chapters: Array<{ id: string }>;
        remaining: { used: number; cap: number };
      };
    };
    expect(overview.literatureReview.enabled).toBe(true);
    expect(overview.literatureReview.chapters.map((c) => c.id)).toEqual([literatureId]);
    // Not on any plan yet: 0 until the owner sets an allowance.
    expect(overview.literatureReview.remaining).toEqual({ used: 0, cap: 0 });

    expect((await planReview(introductionId)).status).toBe(400);

    const calls = await h.prisma.aiCallLog.count({ where: { userId: h.userId } });
    const planned = await planReview(literatureId);
    expect(planned.status).toBe(201);
    const view = (await planned.json()) as View;
    expect(view.kind).toBe('LIT_REVIEW');
    expect(view.status).toBe('PLANNED');
    // The outline's theme (with its subheading) first, then the search's, covered ones first;
    // the outline's introduction and gaps are the blueprint's own sections, "Other" is no theme.
    expect(view.plan.themes.map((t) => t.title)).toEqual([
      'Wear of hybrid aluminium composites',
      'Solid lubricants',
      'Stir casting routes',
    ]);
    expect(view.plan.themes[0]).toMatchObject({ outlineNodeId: 'ch2-wear', from: 'outline' });
    expect(view.plan.themes[0]?.children.map((c) => c.title)).toEqual(['Adhesive wear']);
    expect(view.plan.themes[1]?.from).toBe('library');
    // Planning made no model call and took no unit.
    expect(await h.prisma.aiCallLog.count({ where: { userId: h.userId } })).toBe(calls);
    expect((await ledger()).count).toBe(0);

    // The student reorders, renames and adds; a planned theme keeps its outline place.
    const edited = await h.api(`/documents/${documentId}/literature-review/${view.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        themes: [
          { id: 't2', title: 'Solid lubricants', note: 'Graphite and MoS2.' },
          { id: 't1', title: 'Wear of AA7050 hybrid composites', note: '' },
          { title: 'Corrosion behaviour', note: '' },
        ],
      }),
    });
    expect(edited.status).toBe(200);
    const after = (await edited.json()) as View;
    expect(after.plan.themes.map((t) => [t.title, t.from, t.outlineNodeId])).toEqual([
      ['Solid lubricants', 'library', null],
      ['Wear of AA7050 hybrid composites', 'outline', 'ch2-wear'],
      ['Corrosion behaviour', 'student', null],
    ]);
    expect(after.plan.themes[1]?.children).toHaveLength(1);
  });

  it('is refused at a cap of 0 before any job, and stays PLANNED; the chapter route cannot start it', async () => {
    await setFlag(true);
    const view = (await (await planReview(literatureId)).json()) as View;

    const refused = await h.api(`/documents/${documentId}/literature-review/${view.id}/start`, {
      method: 'POST',
      body: '{}',
    });
    expect(refused.status).toBe(429);
    const problem = (await refused.json()) as { detail: string };
    expect(problem.detail).toContain('Literature review builds are not included in your plan');
    expect((await ledger()).count).toBe(0);
    const row = await h.prisma.chapterBuild.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.status).toBe('PLANNED');
    expect(await queue.getJob(`lit-review-build__${view.id}`)).toBeUndefined();

    // A review is not a chapter build: the chapter build's start does not know it, so it cannot
    // be run on the chapter build's allowance.
    const wrongRoute = await h.api(`/documents/${documentId}/chapter-build/${view.id}/start`, {
      method: 'POST',
      body: '{}',
    });
    expect(wrongRoute.status).toBe(404);

    // Nothing advertises an allowance the plan does not have.
    const usage = (await (await h.api('/usage/me')).json()) as {
      actions: Array<{ action: string }>;
    };
    expect(usage.actions.some((a) => a.action === 'LIT_REVIEW_BUILD')).toBe(false);
  });

  it('with an admin’s extra unit: takes exactly one, queues the job keyed on the build, once', async () => {
    await setFlag(true);
    await setLedger(0, 1);
    const view = (await (await planReview(literatureId)).json()) as View;

    const usage = (await (await h.api('/usage/me')).json()) as {
      actions: Array<{ action: string; cap: number }>;
    };
    expect(usage.actions.find((a) => a.action === 'LIT_REVIEW_BUILD')?.cap).toBe(1);

    const started = await h.api(`/documents/${documentId}/literature-review/${view.id}/start`, {
      method: 'POST',
      body: '{}',
    });
    expect(started.status).toBe(202);
    expect(((await started.json()) as { buildId: string }).buildId).toBe(view.id);
    expect(await ledger()).toEqual({ count: 1, bonus: 1 });

    const row = await h.prisma.chapterBuild.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.status).toBe('QUEUED');
    expect(row.kind).toBe('LIT_REVIEW');
    expect((row.plan as { confirmedAt: string | null }).confirmedAt).toBeTypeOf('string');

    const job = await queue.getJob(`lit-review-build__${view.id}`);
    expect(job?.id).not.toContain(':');
    expect(job?.data).toMatchObject({
      buildId: view.id,
      documentId,
      chapterId: literatureId,
      userId: h.userId,
      kind: 'LIT_REVIEW',
    });

    // Once: a second start, a theme edit and another plan are all refused, for nothing.
    const again = await h.api(`/documents/${documentId}/literature-review/${view.id}/start`, {
      method: 'POST',
      body: '{}',
    });
    expect(again.status).toBe(409);
    const late = await h.api(`/documents/${documentId}/literature-review/${view.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ themes: [] }),
    });
    expect(late.status).toBe(409);
    expect((await planReview(literatureId)).status).toBe(409);
    expect((await ledger()).count).toBe(1);

    // The overview names it as a review, with the allowance used.
    const overview = (await (await h.api(`/documents/${documentId}/chapter-build`)).json()) as {
      builds: Array<{ id: string; kind: string }>;
      literatureReview: { remaining: { used: number; cap: number } };
    };
    expect(overview.builds[0]).toMatchObject({ id: view.id, kind: 'LIT_REVIEW' });
    expect(overview.literatureReview.remaining).toEqual({ used: 1, cap: 1 });
    await job?.remove();
  });

  it('a delivered section of a review is accepted like any draft', async () => {
    const event = await h.prisma.suggestionEvent.create({
      data: {
        userId: h.userId,
        documentId,
        chapterId: literatureId,
        action: 'LIT_REVIEW_BUILD',
        shownChars: 120,
        outcome: 'SHOWN',
        latencyMs: 0,
      },
    });
    const accepted = await h.api(`/draft/${event.id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ keptChars: 120 }),
    });
    // The draft route answers 201, as it does for a Draft-mode section; before ADR-0124 a
    // review's section was a 404 here, because the route only knew DRAFT and CHAPTER_BUILD.
    expect(accepted.status).toBe(201);
    const row = await h.prisma.suggestionEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.outcome).toBe('ACCEPTED');
  });
});
