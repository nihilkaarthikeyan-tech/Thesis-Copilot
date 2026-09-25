/**
 * The worker's side of the site-wide monthly AI budget (2026-09-25).
 *
 * The API refuses every metered call once the budget is reached
 * (`apps/api/src/modules/usage/platform-budget.service.ts`); the two jobs here that call the
 * embedding provider without a metered allowance — indexing a paper, searching the literature —
 * ask the same question from the same two rows before they spend. Read fresh per job: a job is
 * seconds, and a minute's cache would only hide the line for a minute.
 */

import type { Env } from '@tc/config';
import type { PrismaClient } from '@tc/db';

export const PLATFORM_CEILING_KEY = 'platformMonthlyCeilingInr';

/** Thrown by a job that must not spend; the job fails and says why. */
export class PlatformBudgetReachedError extends Error {
  constructor(
    readonly spentInr: number,
    readonly ceilingInr: number,
  ) {
    super(
      `The site's AI budget for this month is reached (₹${spentInr.toFixed(2)} of ₹${ceilingInr}); ` +
        'indexing is paused until the 1st or until the administrator raises it.',
    );
    this.name = 'PlatformBudgetReachedError';
  }
}

export async function platformBudget(
  prisma: PrismaClient,
  env: Pick<Env, 'PLATFORM_MONTHLY_CEILING_INR'>,
  now: Date = new Date(),
): Promise<{ ceilingInr: number | null; spentInr: number; reached: boolean }> {
  const row = await prisma.platformSetting.findUnique({ where: { key: PLATFORM_CEILING_KEY } });
  let ceilingInr: number | null;
  if (row) {
    const n = Number(row.value);
    ceilingInr = row.value === 'off' || !Number.isFinite(n) || n <= 0 ? null : Math.floor(n);
  } else {
    ceilingInr = env.PLATFORM_MONTHLY_CEILING_INR ?? null;
  }
  if (ceilingInr === null) return { ceilingInr: null, spentInr: 0, reached: false };
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const sum = await prisma.aiCallLog.aggregate({
    where: { ok: true, createdAt: { gte: from, lt: to } },
    _sum: { costMicroInr: true },
  });
  const micro = sum._sum.costMicroInr ?? 0n;
  return {
    ceilingInr,
    spentInr: Math.round(Number(micro) / 10_000) / 100,
    reached: micro >= BigInt(ceilingInr) * 1_000_000n,
  };
}

/** For a job's `assertBudget` dependency: throws when the site must not spend. */
export function assertPlatformBudget(
  prisma: PrismaClient,
  env: Pick<Env, 'PLATFORM_MONTHLY_CEILING_INR'>,
): () => Promise<void> {
  return async () => {
    const budget = await platformBudget(prisma, env);
    if (budget.reached && budget.ceilingInr !== null) {
      throw new PlatformBudgetReachedError(budget.spentInr, budget.ceilingInr);
    }
  };
}
