/**
 * The ₹100 ceiling, enforced at run time — PRD §11.
 *
 * Caps are a proxy for money: 180 Assists × a *modelled* cost per call. The model can be wrong —
 * a longer chapter, a prompt cache that does not engage, a provider price change — and when it is,
 * the caps still let 180 calls through and the ₹100 promise breaks silently. This is the check
 * that reads the money actually logged and refuses.
 *
 * What these tests pin down is the part that is easy to get wrong: it must refuse *even when the
 * action counter still has units left*, because that is precisely the case caps cannot catch, and
 * it must say something different from a cap refusal so the student is not told "you have 40
 * suggestions remaining" and then turned away.
 */

import { MONTHLY_CEILING_INR, MONTHLY_CEILING_MICRO_INR } from '@tc/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UsageService } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let usage: UsageService;

/** Writes one successful call of `costInr` into the log, which is what the ceiling reads. */
async function logSpend(costInr: number): Promise<void> {
  await h.prisma.aiCallLog.create({
    data: {
      userId: h.userId,
      action: 'ASSIST',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 50,
      costMicroInr: BigInt(Math.round(costInr * 1_000_000)),
      latencyMs: 900,
      ok: true,
    },
  });
}

beforeAll(async () => {
  h = await startHarness('ceiling@example.com');
  usage = h.app.get(UsageService);
});

// Each test sets its own spend, so the previous one's must not leak into it.
beforeEach(async () => {
  await h.prisma.aiCallLog.deleteMany({ where: { userId: h.userId } });
  await h.prisma.usageLedger.deleteMany({ where: { userId: h.userId } });
  await h.prisma.auditEvent.deleteMany({ where: { userId: h.userId } });
});

afterAll(async () => {
  await h.stop();
});

describe('spend is read from what was actually logged', () => {
  it('is zero for a user who has done nothing', async () => {
    expect(await usage.spentThisPeriod(h.userId)).toBe(0n);
  });

  it('adds up successful calls', async () => {
    await logSpend(1.5);
    await logSpend(2.25);
    const spent = await usage.spentThisPeriod(h.userId);
    expect(Number(spent) / 1_000_000).toBeCloseTo(3.75, 5);
  });

  it('ignores failed calls, which were refunded and served nothing', async () => {
    await logSpend(4);
    await h.prisma.aiCallLog.create({
      data: {
        userId: h.userId,
        action: 'ASSIST',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 1000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        costMicroInr: 9_000_000n,
        latencyMs: 120,
        ok: false,
        error: 'provider timeout',
      },
    });
    expect(Number(await usage.spentThisPeriod(h.userId)) / 1_000_000).toBeCloseTo(4, 5);
  });
});

describe('the ceiling refuses', () => {
  it('allows a call while spend is under ₹100', async () => {
    await logSpend(MONTHLY_CEILING_INR - 1);
    const result = await usage.consume(h.userId, 'FREE_TRIAL', 'ASSIST');
    expect(result.ok).toBe(true);
  });

  it('refuses once spend reaches ₹100, with units still on the counter', async () => {
    // The case caps cannot catch, and the whole reason this check exists.
    await logSpend(MONTHLY_CEILING_INR);
    const result = await usage.consume(h.userId, 'FREE_TRIAL', 'ASSIST');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('ceiling');
    expect(result.spentInr).toBe(MONTHLY_CEILING_INR);

    // Nothing was reserved: a refused call must not consume a unit either.
    const ledger = await h.prisma.usageLedger.findFirst({
      where: { userId: h.userId, action: 'ASSIST' },
    });
    expect(ledger).toBe(null);
  });

  it('refuses every metered action, not only the one that spent the money', async () => {
    await logSpend(MONTHLY_CEILING_INR + 5);
    for (const action of ['ASSIST', 'DRAFT', 'CITE', 'CHAT', 'COMMAND'] as const) {
      const result = await usage.consume(h.userId, 'FREE_TRIAL', action);
      expect(result.ok, action).toBe(false);
      if (!result.ok) expect(result.reason, action).toBe('ceiling');
    }
  });

  it('records the refusal as its own kind, so it is not read as a cap', async () => {
    await logSpend(MONTHLY_CEILING_INR);
    await usage.consume(h.userId, 'FREE_TRIAL', 'ASSIST');
    const events = await h.prisma.auditEvent.findMany({ where: { userId: h.userId } });
    expect(events.map((e) => e.kind)).toContain('CEILING_EXCEEDED');
  });

  it('still refuses on a cap when the money is fine', async () => {
    // COHERENCE is 0 on the trial: a cap refusal must keep saying `cap`, not `ceiling`.
    const result = await usage.consume(h.userId, 'FREE_TRIAL', 'COHERENCE');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('cap');
  });
});

describe('what the student is told', () => {
  it('reports spend, the ceiling and what is left', async () => {
    await logSpend(37.5);
    expect(await usage.ceilingFor(h.userId)).toEqual({
      spentInr: 37.5,
      ceilingInr: MONTHLY_CEILING_INR,
      remainingInr: MONTHLY_CEILING_INR - 37.5,
    });
  });

  it('never reports a negative remainder', async () => {
    await logSpend(MONTHLY_CEILING_INR + 40);
    const view = await usage.ceilingFor(h.userId);
    expect(view.remainingInr).toBe(0);
    expect(view.spentInr).toBe(MONTHLY_CEILING_INR + 40);
  });

  it('counts the ceiling in whole micro-rupees, matching §0.2', () => {
    expect(MONTHLY_CEILING_MICRO_INR).toBe(100_000_000);
  });
});
