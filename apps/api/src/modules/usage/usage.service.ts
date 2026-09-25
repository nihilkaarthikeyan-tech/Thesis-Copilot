/**
 * Cap enforcement — PRD §11.5 and §10.2.
 *
 * "Cap check + increment in one atomic SQL statement. No AI call is made if the cap is hit."
 *
 * This is the single most important guard in the product: PRD §11 makes ₹100/user/month a hard
 * constraint, and §0.3 rule 4 says a feature that cannot be metered and capped must not ship. Every
 * metered action goes through `consume` BEFORE the provider is called.
 *
 * The statement is one round trip:
 *
 *   INSERT ... VALUES (..., 1)
 *   ON CONFLICT (userId, period, action)
 *   DO UPDATE SET count = count + 1 WHERE count < cap
 *   RETURNING count
 *
 * Postgres takes a row lock on the conflicting row, so concurrent requests serialise on it. When
 * the cap is already reached the WHERE fails, `DO UPDATE` touches nothing, and `RETURNING` yields
 * no row — which is the refusal. Two requests can never both see the last remaining unit.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  capFor,
  type Env,
  type MeteredAction,
  MONTHLY_CEILING_INR,
  MONTHLY_CEILING_MICRO_INR,
  type Plan,
} from '@tc/config';
import { ENV } from '../../common/env.token.js';
import {
  CapExceededError,
  CeilingExceededError,
  PlatformCeilingExceededError,
} from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

/** How long one site-wide spend figure is trusted before it is re-summed. */
const PLATFORM_SPEND_CACHE_MS = 60_000;

/**
 * Why a refusal happened. The student sees a different sentence for each, because they mean
 * different things: a cap is "you have used your 180 suggestions", the ceiling is "your AI budget
 * for the month is spent" and can arrive while suggestions are still showing as remaining.
 */
export type RefusalReason = 'cap' | 'ceiling' | 'platform';

export type ConsumeResult =
  | { readonly ok: true; readonly count: number; readonly cap: number; readonly remaining: number }
  | {
      readonly ok: false;
      readonly reason: RefusalReason;
      readonly cap: number;
      readonly resetsAt: Date;
      /** Month-to-date spend in rupees, present when a ceiling is what refused. */
      readonly spentInr?: number;
      /** The site-wide ceiling, present when that is what refused. */
      readonly platformCeilingInr?: number;
    };

/**
 * Billing period key, `YYYY-MM` in UTC.
 * PRD §0.2: caps reset at 00:00 UTC on the 1st of each month.
 */
export function periodFor(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Start of the next UTC month — what a capped response reports as `resetsAt`. */
export function resetsAtFor(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

@Injectable()
export class UsageService {
  private platformSpend: { period: string; micro: bigint; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Reserves one unit of `action` for `userId`. Call this before the provider, never after.
   *
   * Returns `{ ok: false }` when the cap is reached; the caller must then answer `CAP_EXCEEDED`
   * with `resetsAt` and make no provider call.
   */
  async consume(
    userId: string,
    plan: Plan,
    action: MeteredAction,
    now: Date = new Date(),
  ): Promise<ConsumeResult> {
    const cap = capFor(plan, action);
    const period = periodFor(now);

    // A cap of 0 must refuse without touching the table: the INSERT branch would otherwise create
    // the row with count = 1 and let one call through. PRD Appendix E.2 relies on a missing or zero
    // cap making the endpoint unusable, so this path matters.
    if (cap <= 0) {
      await this.audit(userId, plan, action, cap, 'cap');
      return { ok: false, reason: 'cap', cap, resetsAt: resetsAtFor(now) };
    }

    // PRD §11's ₹100 is a constraint on money, and caps are only a proxy for money: they assume a
    // modelled cost per call, and a call can cost more than modelled. This is the check that makes
    // the ceiling true rather than projected. It reads spend already logged, so the call that
    // crosses the line is served and the next one is refused — bounded overshoot of one call.
    // The site-wide budget (2026-09-25, the owner's guard): the sum over every user, so no
    // number of students within their own ceilings can add up to a bill nobody agreed to. Summed
    // at most once a minute, which bounds the overshoot to a minute of calls.
    const platformCeilingInr = this.env.PLATFORM_MONTHLY_CEILING_INR;
    if (platformCeilingInr !== undefined) {
      const platformMicro = await this.platformSpentThisPeriod(now);
      if (platformMicro >= BigInt(platformCeilingInr) * 1_000_000n) {
        await this.audit(userId, plan, action, cap, 'platform');
        return {
          ok: false,
          reason: 'platform',
          cap,
          resetsAt: resetsAtFor(now),
          spentInr: Math.round(Number(platformMicro) / 10_000) / 100,
          platformCeilingInr,
        };
      }
    }

    const spentMicro = await this.spentThisPeriod(userId, now);
    if (spentMicro >= MONTHLY_CEILING_MICRO_INR) {
      await this.audit(userId, plan, action, cap, 'ceiling');
      return {
        ok: false,
        reason: 'ceiling',
        cap,
        resetsAt: resetsAtFor(now),
        spentInr: Math.round(Number(spentMicro) / 10_000) / 100,
      };
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `INSERT INTO "UsageLedger" ("id", "userId", "period", "action", "count")
       VALUES (uuid_generate_v7(), $1::uuid, $2, $3::"AiAction", 1)
       ON CONFLICT ("userId", "period", "action")
       DO UPDATE SET "count" = "UsageLedger"."count" + 1
       WHERE "UsageLedger"."count" < $4
       RETURNING "count"`,
      userId,
      period,
      action,
      cap,
    );

    const row = rows[0];
    if (!row) {
      await this.audit(userId, plan, action, cap, 'cap');
      return { ok: false, reason: 'cap', cap, resetsAt: resetsAtFor(now) };
    }

    return { ok: true, count: row.count, cap, remaining: Math.max(cap - row.count, 0) };
  }

  /**
   * ADR-0004: a refusal leaves no ledger row, so it is recorded here — the one place every
   * metered action passes. `pnpm pilot:report` and the admin's per-user page count these.
   */
  private async audit(
    userId: string,
    plan: Plan,
    action: MeteredAction,
    cap: number,
    reason: RefusalReason,
  ) {
    await this.prisma.auditEvent.create({
      data: {
        kind:
          reason === 'platform'
            ? 'PLATFORM_CEILING_EXCEEDED'
            : reason === 'ceiling'
              ? 'CEILING_EXCEEDED'
              : 'CAP_EXCEEDED',
        userId,
        detail: { action, plan, cap, reason },
      },
    });
  }

  /** Every user's successful spend this period, in micro-rupees; cached for a minute. */
  async platformSpentThisPeriod(now: Date = new Date()): Promise<bigint> {
    const period = periodFor(now);
    const cached = this.platformSpend;
    if (cached && cached.period === period && now.getTime() - cached.at < PLATFORM_SPEND_CACHE_MS) {
      return cached.micro;
    }
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sum = await this.prisma.aiCallLog.aggregate({
      where: { ok: true, createdAt: { gte: from, lt: resetsAtFor(now) } },
      _sum: { costMicroInr: true },
    });
    const micro = sum._sum.costMicroInr ?? 0n;
    this.platformSpend = { period, micro, at: now.getTime() };
    return micro;
  }

  /**
   * Money this user has spent in the current period, in micro-rupees.
   *
   * Only successful calls: a failed one is refunded by `refund` and cost nothing to serve. Indexed
   * by `(userId, createdAt)` on `AiCallLog`, so this is one index scan per metered request.
   */
  async spentThisPeriod(userId: string, now: Date = new Date()): Promise<bigint> {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rows = await this.prisma.aiCallLog.aggregate({
      where: { userId, ok: true, createdAt: { gte: from } },
      _sum: { costMicroInr: true },
    });
    return rows._sum.costMicroInr ?? 0n;
  }

  /** The ₹100 ceiling and what is left of it, for `GET /usage/me`. */
  async ceilingFor(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ spentInr: number; ceilingInr: number; remainingInr: number }> {
    const spent = Math.round(Number(await this.spentThisPeriod(userId, now)) / 10_000) / 100;
    return {
      spentInr: spent,
      ceilingInr: MONTHLY_CEILING_INR,
      remainingInr: Math.max(MONTHLY_CEILING_INR - spent, 0),
    };
  }

  /**
   * Gives a unit back after the provider failed.
   *
   * PRD §11.5 costs from real usage, and §10.2 makes the call only after the cap is reserved. When
   * the provider errors, the student was never served, so the unit is returned. Never drops below
   * zero.
   */
  async refund(userId: string, action: MeteredAction, now: Date = new Date()): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "UsageLedger"
       SET "count" = "count" - 1
       WHERE "userId" = $1::uuid AND "period" = $2 AND "action" = $3::"AiAction" AND "count" > 0`,
      userId,
      periodFor(now),
      action,
    );
  }

  /** Current usage for one user in the current period — powers `GET /usage/me` (PRD §9.4). */
  async usageFor(
    userId: string,
    now: Date = new Date(),
  ): Promise<Array<{ action: string; count: number }>> {
    const rows = await this.prisma.usageLedger.findMany({
      where: { userId, period: periodFor(now) },
      select: { action: true, count: true },
    });
    return rows.map((r) => ({ action: r.action, count: r.count }));
  }
}

/**
 * The error a refused `consume` should throw.
 *
 * One helper rather than a conditional at each of the nine metered call sites — they all refuse
 * for the same two reasons and should say the same two things when they do.
 */
export function refusal(
  action: string,
  result: Extract<ConsumeResult, { ok: false }>,
): CapExceededError | CeilingExceededError | PlatformCeilingExceededError {
  if (result.reason === 'platform') {
    return new PlatformCeilingExceededError(
      action,
      result.spentInr ?? 0,
      result.platformCeilingInr ?? 0,
      result.resetsAt,
    );
  }
  if (result.reason === 'ceiling') {
    return new CeilingExceededError(
      action,
      result.spentInr ?? MONTHLY_CEILING_INR,
      MONTHLY_CEILING_INR,
      result.resetsAt,
    );
  }
  return new CapExceededError(action, result.cap, result.resetsAt);
}
