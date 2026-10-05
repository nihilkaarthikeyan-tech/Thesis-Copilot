/**
 * ADR-0072 from the API side: a thesis started with "Start writing now" has its chapters planned
 * from the title at once, through the same `generate-outline` job; a placeholder title or the
 * proposal path starts nothing; and the plan is bounded like a metered action — a monthly count,
 * the per-thesis run limit, an ended trial — with every refusal made before anything is queued.
 */

import { AUTO_OUTLINES, OUTLINE_CALLS_PER_DOCUMENT } from '@tc/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let queue: Queue;
let redis: Redis;

const TITLE = 'Barriers to rooftop solar adoption in rural Karnataka';

async function create(body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await h.api('/documents', { method: 'POST', body: JSON.stringify(body) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function jobsFor(documentId: string) {
  const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
  return jobs.filter((j) => j?.data?.documentId === documentId);
}

async function outlineView(documentId: string): Promise<Record<string, unknown>> {
  const res = await h.api(`/documents/${documentId}/outline`);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  h = await startHarness('plan-from-title@example.com');
  redis = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  queue = new Queue('generate-outline', { connection: redis });
}, 300_000);

afterAll(async () => {
  await queue?.close();
  await redis?.quit();
  await h?.stop();
});

beforeEach(async () => {
  // Each case starts on a fresh month's count and a live trial.
  await h.prisma.auditEvent.deleteMany({ where: { kind: 'OUTLINE_FROM_TITLE' } });
  await h.prisma.user.update({
    where: { id: h.userId },
    data: { plan: 'FREE_TRIAL', trialEndsAt: new Date(Date.now() + 7 * 86_400_000) },
  });
});

describe('planning the chapters from the title (ADR-0072)', () => {
  it('Start writing now with a real title queues the outline job from the title', async () => {
    const created = await create({ title: TITLE, entryPath: 'A_TOPIC', start: 'writing' });
    const jobs = await jobsFor(created.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({ documentId: created.id, fromTitle: true });

    const view = await outlineView(created.id);
    expect(view.generating).toBe(true);
    expect(view.generatingFrom).toBe('title');
    expect(view.canPlanFromTitle).toBe(false);

    // The scope stays empty: the proposal screen must not think a proposal was saved.
    const memory = await h.prisma.documentMemory.findUnique({ where: { documentId: created.id } });
    expect(memory?.scope).toEqual({});

    // The button while the plan runs is the same plan, not a second one.
    const again = await h.api(`/documents/${created.id}/outline/plan-from-title`, {
      method: 'POST',
      body: '{}',
    });
    expect(again.status).toBe(202);
    expect(await jobsFor(created.id)).toHaveLength(1);
  });

  it('a placeholder title starts nothing, and offers no button', async () => {
    const created = await create({
      title: 'Untitled thesis',
      entryPath: 'A_TOPIC',
      start: 'writing',
    });
    expect(await jobsFor(created.id)).toHaveLength(0);
    const view = await outlineView(created.id);
    expect(view.generating).toBe(false);
    expect(view.canPlanFromTitle).toBe(false);
  });

  it('the proposal path plans from the proposal later, not from the title now', async () => {
    const created = await create({ title: TITLE, entryPath: 'A_TOPIC' });
    expect(await jobsFor(created.id)).toHaveLength(0);
    // ...but a thesis with no outline is offered the button.
    expect((await outlineView(created.id)).canPlanFromTitle).toBe(true);
  });

  it('the button plans a thesis that has no outline', async () => {
    const created = await create({ title: TITLE, entryPath: 'A_TOPIC' });
    const res = await h.api(`/documents/${created.id}/outline/plan-from-title`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(202);
    expect(await jobsFor(created.id)).toHaveLength(1);
  });

  it('refuses a thesis that already has its chapters', async () => {
    const created = await create({ title: TITLE, entryPath: 'A_TOPIC' });
    await h.prisma.documentMemory.update({
      where: { documentId: created.id },
      data: { outline: [{ id: 'ch1-intro', title: 'Introduction', scopeNote: 'x', children: [] }] },
    });
    const res = await h.api(`/documents/${created.id}/outline/plan-from-title`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(409);
    expect(await jobsFor(created.id)).toHaveLength(0);
  });
});

describe('the bounds on a title plan (cap tests)', () => {
  it('stops at the monthly count: the create still succeeds, the plan does not start', async () => {
    const allowed = AUTO_OUTLINES.monthly.FREE_TRIAL;
    const started: string[] = [];
    for (let i = 0; i < allowed; i++) {
      started.push(
        (await create({ title: `${TITLE} ${i}`, entryPath: 'A_TOPIC', start: 'writing' })).id,
      );
    }
    for (const id of started) expect(await jobsFor(id)).toHaveLength(1);

    const over = await create({ title: `${TITLE} over`, entryPath: 'A_TOPIC', start: 'writing' });
    expect(await jobsFor(over.id)).toHaveLength(0);

    const pressed = await h.api(`/documents/${over.id}/outline/plan-from-title`, {
      method: 'POST',
      body: '{}',
    });
    expect(pressed.status).toBe(429);
    const problem = (await pressed.json()) as { type: string; detail: string };
    expect(problem.type).toBe('CAP_EXCEEDED');
    expect(problem.detail).toContain('chapter plans from a title');
    expect(await jobsFor(over.id)).toHaveLength(0);
  });

  it('an ended trial plans nothing', async () => {
    await h.prisma.user.update({
      where: { id: h.userId },
      data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
    });
    const created = await create({ title: TITLE, entryPath: 'A_TOPIC', start: 'writing' });
    expect(await jobsFor(created.id)).toHaveLength(0);
    const pressed = await h.api(`/documents/${created.id}/outline/plan-from-title`, {
      method: 'POST',
      body: '{}',
    });
    expect(pressed.status).toBe(402);
    expect(await jobsFor(created.id)).toHaveLength(0);
  });

  it('a thesis that has had its outline runs gets no more, from the title or the proposal', async () => {
    const created = await create({ title: TITLE, entryPath: 'A_TOPIC' });
    await h.prisma.aiCallLog.createMany({
      data: Array.from({ length: OUTLINE_CALLS_PER_DOCUMENT }, () => ({
        userId: h.userId,
        documentId: created.id,
        action: 'OUTLINE' as const,
        model: 'mock-strong',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        costMicroInr: 0n,
        latencyMs: 1,
        ok: true,
      })),
    });
    const fromTitle = await h.api(`/documents/${created.id}/outline/plan-from-title`, {
      method: 'POST',
      body: '{}',
    });
    expect(fromTitle.status).toBe(409);

    await h.prisma.documentMemory.update({
      where: { documentId: created.id },
      data: { scope: { workingTitle: TITLE, problemStatement: 'p', objectives: ['o'] } },
    });
    const fromProposal = await h.api(`/documents/${created.id}/outline/generate`, {
      method: 'POST',
      body: '{}',
    });
    expect(fromProposal.status).toBe(409);
    expect(await jobsFor(created.id)).toHaveLength(0);
  });
});
