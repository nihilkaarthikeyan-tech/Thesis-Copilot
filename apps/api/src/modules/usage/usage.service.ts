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
 *
 * ADR-0144: for an allowance that counts only kept suggestions (`CALLS_PER_KEPT`, Assist), the
 * same statement checks two things on the same locked row: the calls (`count`) against the call
 * ceiling, and the suggestions kept (`kept`) against the allowance. `keep` adds to `kept` when the
 * student keeps one; nothing else changes it.
 */

import { Injectable } from '@nestjs/common';
import {
  CALLS_PER_KEPT,
  callCeiling,
  capFor,
  countsKept,
  type MeteredAction,
  MONTHLY_CEILING_INR,
  MONTHLY_CEILING_MICRO_INR,
  type Plan,
} from '@tc/config';
import {
  CallCeilingError,
  CapExceededError,
  CeilingExceededError,
  PlatformCeilingExceededError,
  TrialEndedError,
} from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PlatformBudgetService } from './platform-budget.service.js';

/**
 * Why a refusal happened. The student sees a different sentence for each, because they mean
 * different things: a cap is "you have used your 180 suggestions", the ceiling is "your AI budget
 * for the month is spent" and can arrive while suggestions are still showing as remaining.
 */
export type RefusalReason = 'cap' | 'ceiling' | 'platform' | 'trial';

export type ConsumeResult =
  | { readonly ok: true; readonly count: number; readonly cap: number; readonly remaining: number }
  | {
      readonly ok: false;
      readonly reason: RefusalReason;
      readonly cap: number;
      /**
       * R31 (ADR-0122): this month's count of the action when its cap (or an ended trial) is what
       * refused, so the student is told "10 of 10 used". Read after the refusal; never part of it.
       */
      readonly used?: number;
      readonly resetsAt: Date;
      /** Month-to-date spend in rupees, present when a ceiling is what refused. */
      readonly spentInr?: number;
      /** The site-wide ceiling, present when that is what refused. */
      readonly platformCeilingInr?: number;
      /** When the free trial ended, present when that is what refused (ADR-0036). */
      readonly trialEndedAt?: Date;
      /**
       * ADR-0152: the refused allowance is the free trial's, counted over the whole trial and
       * ending on this date rather than renewing on the 1st. `resetsAt` is the same date.
       */
      readonly trialEndsAt?: Date;
      /**
       * ADR-0144: the month's calls hit the call ceiling of an allowance that counts kept
       * suggestions, before the student kept the whole allowance. `cap` and `used` are still the
       * allowance and the suggestions kept.
       */
      readonly callCeiling?: number;
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

/** What decides which ledger row an account's metered actions count on (ADR-0152). */
export type LedgerAccount = {
  readonly plan: string;
  readonly trialStartsAt?: Date | null;
  readonly trialEndsAt?: Date | null;
};

/**
 * ADR-0152: the ledger row a metered action counts on. A paid plan counts by the calendar month
 * (PRD §0.2). A free trial counts once over the whole trial, on the row of the month it started:
 * a trial that starts on 25 October goes on counting on October's row on 2 November, so crossing
 * the 1st no longer gives it a second month's allowance. After `trialEndsAt` the trial's allowance
 * is 0 (ADR-0036), so the trial's row covers [trialStartsAt, trialEndsAt]. An account with no
 * trial dates (none should be left) counts by the month, as before.
 */
export function ledgerPeriodFor(account: LedgerAccount, now: Date = new Date()): string {
  return account.plan === 'FREE_TRIAL' && account.trialStartsAt && account.trialEndsAt
    ? periodFor(account.trialStartsAt)
    : periodFor(now);
}

/**
 * `ledgerPeriodFor` in SQL, for the statements that find the row themselves (`refund`, `keep`,
 * and the worker's refunds): `u` is the joined "User" row, `fallback` the SQL for the month's key.
 */
export function ledgerPeriodSql(u: string, fallback: string): string {
  return `(CASE WHEN ${u}."plan" = 'FREE_TRIAL' AND ${u}."trialStartsAt" IS NOT NULL
             AND ${u}."trialEndsAt" IS NOT NULL
           THEN to_char(${u}."trialStartsAt", 'YYYY-MM') ELSE ${fallback} END)`;
}

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: PlatformBudgetService,
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
    // ADR-0152: a trial counts on the row of the month it started, for the whole trial.
    const trial = plan === 'FREE_TRIAL' ? await this.trialWindow(userId) : null;
    const period = ledgerPeriodFor({ plan, ...trial }, now);
    // ADR-0036: a free trial past its end date has no plan allowance. The student keeps every
    // thesis; an admin's extra allowance still counts, so a grant can help someone finish.
    const ends = trial?.trialEndsAt ?? null;
    const trialEndedAt = ends && ends.getTime() <= now.getTime() ? ends : null;
    // ADR-0152: a running trial's allowance does not renew on the 1st; it lasts until the end.
    const trialEndsAt = ends && trial?.trialStartsAt && !trialEndedAt ? ends : null;
    const cap = trialEndedAt ? 0 : capFor(plan, action);
    const refusedFor: RefusalReason = trialEndedAt ? 'trial' : 'cap';
    const capRefusal = (shown: number, used: number) => ({
      ok: false as const,
      reason: refusedFor,
      cap: shown,
      used,
      resetsAt: trialEndsAt ?? resetsAtFor(now),
      ...(trialEndedAt ? { trialEndedAt } : {}),
      ...(trialEndsAt ? { trialEndsAt } : {}),
    });

    // A cap of 0 must refuse without touching the table: the INSERT branch would otherwise create
    // the row with count = 1 and let one call through. PRD Appendix E.2 relies on a missing or zero
    // cap making the endpoint unusable, so this path matters.
    //
    // An admin's extra allowance (2026-09-29) sits on the ledger row as `bonus` and raises the
    // cap for this period only; a zero-cap action with a bonus is let through to the statement,
    // whose WHERE reads the bonus off the same locked row.
    if (cap <= 0) {
      const ledger = await this.ledgerFor(userId, period, action);
      if (ledger.bonus <= 0) {
        await this.audit(userId, plan, action, cap, refusedFor);
        return capRefusal(cap, ledger.count);
      }
    }

    // PRD §11's ₹100 is a constraint on money, and caps are only a proxy for money: they assume a
    // modelled cost per call, and a call can cost more than modelled. This is the check that makes
    // the ceiling true rather than projected. It reads spend already logged, so the call that
    // crosses the line is served and the next one is refused — bounded overshoot of one call.
    // The site-wide budget (2026-09-25, the owner's guard): the sum over every user, so no
    // number of students within their own ceilings can add up to a bill nobody agreed to. Summed
    // at most once a minute, which bounds the overshoot to a minute of calls.
    const budget = await this.budget.status(now);
    if (budget.reached && budget.ceilingInr !== null) {
      await this.audit(userId, plan, action, cap, 'platform');
      return {
        ok: false,
        reason: 'platform',
        cap,
        resetsAt: resetsAtFor(now),
        spentInr: budget.spentInr,
        platformCeilingInr: budget.ceilingInr,
      };
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

    // ADR-0144: `$5` is how many calls one unit of the allowance may take (1 for every action
    // that counts calls), and `$6` whether the allowance counts kept suggestions. For those, the
    // calls are refused at (allowance + bonus) × $5 and the kept at allowance + bonus, both on
    // the row the statement has locked. A new row starts at one call and nothing kept, which an
    // allowance above 0 always admits.
    const perKept = CALLS_PER_KEPT[action] ?? 1;
    const keptOnly = countsKept(action);
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ count: number; bonus: number; kept: number }>
    >(
      `INSERT INTO "UsageLedger" ("id", "userId", "period", "action", "count")
       VALUES (uuid_generate_v7(), $1::uuid, $2, $3::"AiAction", 1)
       ON CONFLICT ("userId", "period", "action")
       DO UPDATE SET "count" = "UsageLedger"."count" + 1
       WHERE "UsageLedger"."count" < ($4 + "UsageLedger"."bonus") * $5
         AND (NOT $6::boolean OR "UsageLedger"."kept" < $4 + "UsageLedger"."bonus")
       RETURNING "count", "bonus", "kept"`,
      userId,
      period,
      action,
      cap,
      perKept,
      keptOnly,
    );

    const row = rows[0];
    if (!row) {
      // Refused by the statement above. What the row holds now is only read, to say how much of
      // the allowance was used (R31); the decision is already made.
      const ledger = await this.ledgerFor(userId, period, action);
      const allowance = cap + ledger.bonus;
      await this.audit(userId, plan, action, allowance, refusedFor);
      if (!keptOnly) return capRefusal(allowance, ledger.count);
      // ADR-0144: kept the whole allowance, or asked for the most suggestions a month allows.
      return ledger.kept >= allowance
        ? capRefusal(allowance, ledger.kept)
        : { ...capRefusal(allowance, ledger.kept), callCeiling: callCeiling(action, allowance) };
    }

    const allowed = cap + row.bonus;
    const used = keptOnly ? row.kept : row.count;
    return {
      ok: true,
      count: row.count,
      cap: allowed,
      remaining: Math.max(allowed - used, 0),
    };
  }

  /**
   * ADR-0144: the student kept suggestion `suggestionId` (accepted it whole or in part), so it
   * counts against the allowance — once, however many times the editor reports it, and only for
   * an action whose allowance counts kept suggestions. One statement: the suggestion is marked
   * counted only if it was not already, and the ledger row of the month it was shown in gains one
   * only if that mark was made. Returns whether it counted.
   *
   * Never refused: the text is already in the thesis. A student with several suggestions on screen
   * at the last unit can keep each, so `kept` may pass the allowance by those few; the money is
   * bounded by the call ceiling, which `consume` checks before every call.
   */
  async keep(userId: string, suggestionId: string): Promise<boolean> {
    const actions = Object.keys(CALLS_PER_KEPT);
    // ADR-0152: a trial's suggestion counts on the trial's row, whichever month it was shown in.
    const rows = await this.prisma.$queryRawUnsafe<Array<{ kept: number }>>(
      `WITH counted AS (
         UPDATE "SuggestionEvent" e SET "countedAt" = now()
         FROM "User" u
         WHERE e."id" = $1::uuid AND e."userId" = $2::uuid AND e."countedAt" IS NULL
           AND e."action"::text = ANY($3::text[]) AND u."id" = e."userId"
         RETURNING e."userId", e."action",
           ${ledgerPeriodSql('u', `to_char(e."createdAt", 'YYYY-MM')`)} AS period
       )
       UPDATE "UsageLedger" l SET "kept" = l."kept" + 1
       FROM counted
       WHERE l."userId" = counted."userId" AND l."period" = counted.period
         AND l."action" = counted."action"
       RETURNING l."kept"`,
      suggestionId,
      userId,
      actions,
    );
    return rows.length > 0;
  }

  /**
   * ADR-0072: the money checks of `consume` without a cap row, for an action PRD §11.3 gives no
   * cap (`OUTLINE`) that the product now starts on its own. An ended trial, the student's ₹100
   * ceiling and the site-wide budget each refuse it, exactly as they would a metered action; the
   * count that bounds it is the caller's.
   */
  async spendAllowed(
    userId: string,
    plan: Plan,
    now: Date = new Date(),
  ): Promise<{ ok: true } | Extract<ConsumeResult, { ok: false }>> {
    const resetsAt = resetsAtFor(now);
    const trialEndedAt = plan === 'FREE_TRIAL' ? await this.trialEndedAt(userId, now) : null;
    if (trialEndedAt) return { ok: false, reason: 'trial', cap: 0, resetsAt, trialEndedAt };
    const budget = await this.budget.status(now);
    if (budget.reached && budget.ceilingInr !== null) {
      return {
        ok: false,
        reason: 'platform',
        cap: 0,
        resetsAt,
        spentInr: budget.spentInr,
        platformCeilingInr: budget.ceilingInr,
      };
    }
    const spentMicro = await this.spentThisPeriod(userId, now);
    if (spentMicro >= MONTHLY_CEILING_MICRO_INR) {
      return {
        ok: false,
        reason: 'ceiling',
        cap: 0,
        resetsAt,
        spentInr: Math.round(Number(spentMicro) / 10_000) / 100,
      };
    }
    return { ok: true };
  }

  /** For the usage meter: when the trial ends, whether it has, and whole days left. */
  async trialStatus(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ endsAt: string; ended: boolean; daysLeft: number } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trialEndsAt: true },
    });
    if (!user?.trialEndsAt) return null;
    const ms = user.trialEndsAt.getTime() - now.getTime();
    return {
      endsAt: user.trialEndsAt.toISOString(),
      ended: ms <= 0,
      daysLeft: Math.max(Math.ceil(ms / 86_400_000), 0),
    };
  }

  /** The account's trial dates (ADR-0036, ADR-0152); null when the user is not found. */
  async trialWindow(
    userId: string,
  ): Promise<{ trialStartsAt: Date | null; trialEndsAt: Date | null } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { trialStartsAt: true, trialEndsAt: true },
    });
  }

  /**
   * ADR-0152: the ledger row this user's metered actions count on now — the trial's row for a
   * free trial, this month's otherwise. Reads the plan from the account unless it is given.
   */
  async periodOf(userId: string, now: Date = new Date(), plan?: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, trialStartsAt: true, trialEndsAt: true },
    });
    if (!user) return periodFor(now);
    return ledgerPeriodFor({ ...user, plan: plan ?? user.plan }, now);
  }

  /** The end of this account's free trial if it has passed, otherwise null. */
  async trialEndedAt(userId: string, now: Date = new Date()): Promise<Date | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trialEndsAt: true },
    });
    const ends = user?.trialEndsAt ?? null;
    return ends && ends.getTime() <= now.getTime() ? ends : null;
  }

  /** This period's count and extra allowance for one action; zeros when there is no row yet. */
  private async ledgerFor(
    userId: string,
    period: string,
    action: MeteredAction,
  ): Promise<{ count: number; bonus: number; kept: number }> {
    const row = await this.prisma.usageLedger.findUnique({
      where: { userId_period_action: { userId, period, action } },
      select: { count: true, bonus: true, kept: true },
    });
    return { count: row?.count ?? 0, bonus: row?.bonus ?? 0, kept: row?.kept ?? 0 };
  }

  /**
   * Extra units of one action for this period, given by an admin (2026-09-29). Adds to whatever
   * was given before; the next month starts from the plan's cap again. Logged with the reason.
   */
  async grantBonus(
    actorId: string,
    userId: string,
    action: MeteredAction,
    units: number,
    reason: string,
    now: Date = new Date(),
  ): Promise<{ action: MeteredAction; bonus: number; period: string }> {
    // ADR-0152: on a free trial the grant goes on the trial's row, which is the one it counts on.
    const period = await this.periodOf(userId, now);
    const [row] = await this.prisma.$transaction([
      this.prisma.usageLedger.upsert({
        where: { userId_period_action: { userId, period, action } },
        create: { userId, period, action, count: 0, bonus: units },
        update: { bonus: { increment: units } },
        select: { bonus: true },
      }),
      this.prisma.auditEvent.create({
        data: {
          kind: 'ALLOWANCE_GRANTED',
          userId,
          actorId,
          detail: { period, action, units, reason },
        },
      }),
    ]);
    return { action, bonus: row.bonus, period };
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
    // ADR-0152: the row `consume` charged — the trial's for a free trial.
    await this.prisma.$executeRawUnsafe(
      `UPDATE "UsageLedger" l
       SET "count" = l."count" - 1
       FROM "User" u
       WHERE u."id" = $1::uuid AND l."userId" = u."id" AND l."action" = $3::"AiAction"
         AND l."count" > 0 AND l."period" = ${ledgerPeriodSql('u', '$2')}`,
      userId,
      periodFor(now),
      action,
    );
  }

  /**
   * Current usage for one user in the current period — powers `GET /usage/me` (PRD §9.4). On a
   * free trial, the whole trial's (ADR-0152).
   */
  async usageFor(
    userId: string,
    now: Date = new Date(),
    plan?: string,
  ): Promise<Array<{ action: string; count: number; bonus: number; kept: number }>> {
    const period = await this.periodOf(userId, now, plan);
    const rows = await this.prisma.usageLedger.findMany({
      where: { userId, period },
      select: { action: true, count: true, bonus: true, kept: true },
    });
    return rows.map((r) => ({ action: r.action, count: r.count, bonus: r.bonus, kept: r.kept }));
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
):
  | CallCeilingError
  | CapExceededError
  | CeilingExceededError
  | PlatformCeilingExceededError
  | TrialEndedError {
  if (result.reason === 'trial' && result.trialEndedAt) {
    return new TrialEndedError(action, result.trialEndedAt);
  }
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
  if (result.trialEndsAt && result.callCeiling === undefined) {
    return new CapExceededError(
      action,
      result.cap,
      result.resetsAt,
      result.used ?? result.cap,
      result.trialEndsAt,
    );
  }
  if (result.callCeiling !== undefined) {
    return new CallCeilingError(
      action,
      result.cap,
      result.callCeiling,
      result.resetsAt,
      result.used ?? 0,
    );
  }
  return new CapExceededError(action, result.cap, result.resetsAt, result.used ?? result.cap);
}
