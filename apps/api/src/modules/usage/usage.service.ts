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

import { Injectable } from '@nestjs/common';
import { capFor, type MeteredAction, type Plan } from '@tc/config';
import { PrismaService } from '../../common/prisma.service.js';

export type ConsumeResult =
  | { readonly ok: true; readonly count: number; readonly cap: number; readonly remaining: number }
  | { readonly ok: false; readonly cap: number; readonly resetsAt: Date };

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
  constructor(private readonly prisma: PrismaService) {}

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
      await this.audit(userId, plan, action, cap);
      return { ok: false, cap, resetsAt: resetsAtFor(now) };
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
      await this.audit(userId, plan, action, cap);
      return { ok: false, cap, resetsAt: resetsAtFor(now) };
    }

    return { ok: true, count: row.count, cap, remaining: Math.max(cap - row.count, 0) };
  }

  /**
   * ADR-0004: a refusal leaves no ledger row, so it is recorded here — the one place every
   * metered action passes. `pnpm pilot:report` and the admin's per-user page count these.
   */
  private async audit(userId: string, plan: Plan, action: MeteredAction, cap: number) {
    await this.prisma.auditEvent.create({
      data: { kind: 'CAP_EXCEEDED', userId, detail: { action, plan, cap } },
    });
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
