/**
 * The site-wide monthly AI budget — the owner's guard (2026-09-25).
 *
 * One number, in rupees, for the whole site per calendar month. Once every user's successful AI
 * spend adds up to it, every metered call is refused (`UsageService`), the worker stops calling
 * the embedding provider (`apps/worker/src/platform-budget.ts` reads the same two rows), and the
 * §14 alerts email the administrators. It resets on the 1st, like everything else in §11.
 *
 * Where the number comes from, in order: the `PlatformSetting` row the admin screen writes
 * (`'off'` means no site-wide stop), else `PLATFORM_MONTHLY_CEILING_INR` from the environment,
 * else none. The per-user ₹100 ceiling (§11) applies regardless. Both the number and the sum are
 * cached for a minute, which bounds the overshoot to a minute of calls.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

export const PLATFORM_CEILING_KEY = 'platformMonthlyCeilingInr';
const CACHE_MS = 60_000;
/** The alert fires here, while there is still something to do about it. */
export const PLATFORM_BUDGET_WARNING_FRACTION = 0.8;

export type PlatformBudgetStatus = {
  /** Null: no site-wide stop is set. */
  ceilingInr: number | null;
  source: 'admin' | 'env' | 'none';
  spentInr: number;
  period: string;
  resetsAt: string;
  reached: boolean;
  /** Spend is at or past `PLATFORM_BUDGET_WARNING_FRACTION` of the ceiling. */
  warning: boolean;
};

const periodOf = (now: Date) =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const nextMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

@Injectable()
export class PlatformBudgetService {
  private ceiling: {
    value: { ceilingInr: number | null; source: 'admin' | 'env' | 'none' };
    at: number;
  } | null = null;
  private spend: { period: string; micro: bigint; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async ceilingInr(
    now: Date = new Date(),
  ): Promise<{ ceilingInr: number | null; source: 'admin' | 'env' | 'none' }> {
    if (this.ceiling && now.getTime() - this.ceiling.at < CACHE_MS) return this.ceiling.value;
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: PLATFORM_CEILING_KEY },
    });
    let value: { ceilingInr: number | null; source: 'admin' | 'env' | 'none' };
    if (row) {
      const n = Number(row.value);
      value =
        row.value === 'off' || !Number.isFinite(n) || n <= 0
          ? { ceilingInr: null, source: 'admin' }
          : { ceilingInr: Math.floor(n), source: 'admin' };
    } else if (this.env.PLATFORM_MONTHLY_CEILING_INR !== undefined) {
      value = { ceilingInr: this.env.PLATFORM_MONTHLY_CEILING_INR, source: 'env' };
    } else {
      value = { ceilingInr: null, source: 'none' };
    }
    this.ceiling = { value, at: now.getTime() };
    return value;
  }

  /** Every user's successful spend this period, in micro-rupees; cached for a minute. */
  async spentMicro(now: Date = new Date()): Promise<bigint> {
    const period = periodOf(now);
    if (this.spend && this.spend.period === period && now.getTime() - this.spend.at < CACHE_MS) {
      return this.spend.micro;
    }
    const sum = await this.prisma.aiCallLog.aggregate({
      where: { ok: true, createdAt: { gte: monthStart(now), lt: nextMonth(now) } },
      _sum: { costMicroInr: true },
    });
    const micro = sum._sum.costMicroInr ?? 0n;
    this.spend = { period, micro, at: now.getTime() };
    return micro;
  }

  async status(now: Date = new Date()): Promise<PlatformBudgetStatus> {
    const [{ ceilingInr, source }, micro] = await Promise.all([
      this.ceilingInr(now),
      this.spentMicro(now),
    ]);
    const spentInr = Math.round(Number(micro) / 10_000) / 100;
    const reached = ceilingInr !== null && micro >= BigInt(ceilingInr) * 1_000_000n;
    const warning =
      ceilingInr !== null &&
      Number(micro) >= ceilingInr * 1_000_000 * PLATFORM_BUDGET_WARNING_FRACTION;
    return {
      ceilingInr,
      source,
      spentInr,
      period: periodOf(now),
      resetsAt: nextMonth(now).toISOString(),
      reached,
      warning,
    };
  }

  /** The admin's number, logged with who set it. `null` switches the site-wide stop off. */
  async setCeiling(actorId: string, ceilingInr: number | null): Promise<PlatformBudgetStatus> {
    if (ceilingInr !== null && (!Number.isInteger(ceilingInr) || ceilingInr < 1)) {
      throw new ValidationError('The budget must be a whole number of rupees, at least 1.');
    }
    const before = await this.ceilingInr();
    await this.prisma.$transaction([
      this.prisma.platformSetting.upsert({
        where: { key: PLATFORM_CEILING_KEY },
        create: {
          key: PLATFORM_CEILING_KEY,
          value: ceilingInr === null ? 'off' : String(ceilingInr),
        },
        update: { value: ceilingInr === null ? 'off' : String(ceilingInr) },
      }),
      this.prisma.auditEvent.create({
        data: {
          kind: 'PLATFORM_BUDGET_CHANGED',
          userId: actorId,
          actorId,
          detail: { from: before.ceilingInr, to: ceilingInr },
        },
      }),
    ]);
    this.ceiling = null;
    return this.status();
  }
}
