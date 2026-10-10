/**
 * R31 (ADR-0122): a refused action carries everything a screen needs to say it plainly — which
 * allowance, how many of it were used of how many, and when it resets — as RFC 9457 extension
 * members, through the real HTTP path. The web app builds one message from these on every
 * screen (`apps/web/src/lib/limit.ts`), so the members are the contract, not the `detail`.
 *
 * The cap check itself is unchanged and proven elsewhere (`cap-concurrency.spec.ts`,
 * `caps.spec.ts`, `week1.spec.ts`): these refusals all happen before any provider call.
 */

import { MONTHLY_CEILING_INR, PLAN_LIMITS } from '@tc/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { periodFor, resetsAtFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;

/** The FREE_TRIAL caps a fresh account starts on (PRD §11.3; ADR-0152 made it ten). */
const COMMAND_CAP = PLAN_LIMITS.FREE_TRIAL.caps.COMMAND;

const runCommand = () =>
  h.api('/commands/run', {
    method: 'POST',
    body: JSON.stringify({ chapterId, command: 'shorten', selection: 'A sentence to shorten.' }),
  });

async function setLedger(action: 'COMMAND', count: number, bonus = 0): Promise<void> {
  await h.prisma.usageLedger.upsert({
    where: { userId_period_action: { userId: h.userId, period: periodFor(), action } },
    create: { userId: h.userId, period: periodFor(), action, count, bonus },
    update: { count, bonus },
  });
}

async function commandsUsed(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'COMMAND', period: periodFor() },
  });
  return row?.count ?? 0;
}

beforeAll(async () => {
  h = await startHarness('limit-refusal@example.com');
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Limits', entryPath: 'A_TOPIC' }),
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  documentId = doc.id;
  chapterId = doc.firstChapterId;
}, 300_000);

let trialEndsAt: Date;

beforeEach(async () => {
  await h.prisma.usageLedger.deleteMany({ where: { userId: h.userId } });
  await h.prisma.aiCallLog.deleteMany({ where: { userId: h.userId } });
  trialEndsAt = new Date(Date.now() + 7 * 86_400_000);
  // The trial started now, so its ledger row is this month's (ADR-0152).
  await h.prisma.user.update({
    where: { id: h.userId },
    data: { trialEndsAt, trialStartsAt: new Date() },
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('a cap refusal names the allowance, the count and the reset', () => {
  it('on the free trial: how many were used of how many, and the trial’s end, not the 1st', async () => {
    // ADR-0152: a trial's allowance is for the whole trial; it does not renew on the 1st.
    await setLedger('COMMAND', COMMAND_CAP);
    const response = await runCommand();
    expect(response.status).toBe(429);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    const problem = (await response.json()) as Record<string, unknown>;
    expect(problem).toMatchObject({
      type: 'CAP_EXCEEDED',
      status: 429,
      title: 'Trial limit reached',
      action: 'COMMAND',
      allowance: 'Section commands',
      used: COMMAND_CAP,
      cap: COMMAND_CAP,
      trialAllowance: true,
      trialEndsAt: trialEndsAt.toISOString(),
      resetsAt: trialEndsAt.toISOString(),
      detail: `You have used all ${COMMAND_CAP} of your free trial's section commands.`,
    });
    // Refused before the provider: the counter did not move.
    expect(await commandsUsed()).toBe(COMMAND_CAP);
  });

  it('a paid plan: the next 1st at 00:00 UTC', async () => {
    await h.prisma.user.update({ where: { id: h.userId }, data: { plan: 'STUDENT_MONTHLY' } });
    const { UsageService } = await import('../src/modules/usage/usage.service.js');
    const usage = h.app.get(UsageService);
    try {
      await h.prisma.usageLedger.create({
        data: {
          userId: h.userId,
          period: periodFor(),
          action: 'COMMAND',
          count: PLAN_LIMITS.STUDENT_MONTHLY.caps.COMMAND,
        },
      });
      const result = await usage.consume(h.userId, 'STUDENT_MONTHLY', 'COMMAND');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.resetsAt).toEqual(resetsAtFor());
      expect(result.trialEndsAt).toBeUndefined();
      expect(result.resetsAt.getUTCDate()).toBe(1);
      expect(result.resetsAt.getUTCHours()).toBe(0);
    } finally {
      await h.prisma.user.update({ where: { id: h.userId }, data: { plan: 'FREE_TRIAL' } });
    }
  });

  it('counts an admin’s extra allowance in the total', async () => {
    await setLedger('COMMAND', COMMAND_CAP + 1, 1);
    const problem = (await (await runCommand()).json()) as Record<string, unknown>;
    expect(problem).toMatchObject({
      type: 'CAP_EXCEEDED',
      used: COMMAND_CAP + 1,
      cap: COMMAND_CAP + 1,
    });
  });

  it('reports an allowance the plan does not include as 0 of 0', async () => {
    // COHERENCE is 0 on the trial (PRD §11.3).
    const response = await h.api(`/documents/${documentId}/coherence/run`, {
      method: 'POST',
      body: JSON.stringify({ triggeredBy: 'MANUAL' }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      type: 'CAP_EXCEEDED',
      action: 'COHERENCE',
      allowance: 'Coherence checks',
      used: 0,
      cap: 0,
    });
  });
});

describe('the other refusals carry the allowance too', () => {
  it('an ended trial: the date it ended, and no reset date', async () => {
    const ended = new Date(Date.now() - 86_400_000);
    await h.prisma.user.update({ where: { id: h.userId }, data: { trialEndsAt: ended } });
    const response = await runCommand();
    expect(response.status).toBe(402);
    const problem = (await response.json()) as Record<string, unknown>;
    expect(problem).toMatchObject({
      type: 'CAP_EXCEEDED',
      action: 'COMMAND',
      allowance: 'Section commands',
      trialEnded: true,
      trialEndedAt: ended.toISOString(),
      cap: 0,
    });
    expect(problem.resetsAt).toBeUndefined();
  });

  it('the ₹100 ceiling: the allowance and the reset date', async () => {
    await h.prisma.aiCallLog.create({
      data: {
        userId: h.userId,
        action: 'ASSIST',
        model: 'gpt-5-nano',
        inputTokens: 1000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 50,
        costMicroInr: BigInt(MONTHLY_CEILING_INR * 1_000_000),
        latencyMs: 900,
        ok: true,
      },
    });
    const response = await runCommand();
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      type: 'CEILING_EXCEEDED',
      action: 'COMMAND',
      allowance: 'Section commands',
      resetsAt: resetsAtFor().toISOString(),
    });
  });
});
