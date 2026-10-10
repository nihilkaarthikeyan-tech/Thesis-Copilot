/**
 * Alerts — PRD §11.5 and §14, PHASES 4.6, verbatim:
 *
 *   §11.5: "Alert (email to admins) if any user's month-to-date cost > ₹120 or platform average
 *           > ₹90."
 *   §14:   "Alerts: email on cost thresholds (§11.5), job failure rate > 5% over 15 min, TTFB p95
 *           > 900 ms over 15 min."
 *
 * Every condition is evaluated from the durable record (`AiCallLog`), not from in-memory metrics,
 * so a restart cannot hide a breach. Each condition emails once per breach and then goes quiet
 * until it clears, because an alert that fires every 15 minutes for the same fact is one nobody
 * reads by the third hour.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import {
  OPENALEX_USD,
  OPENALEX_WARN_SHARES,
  type OpenAlexDay,
  openAlexMeter,
  scholarlyHealth,
} from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { MAILER, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PlatformBudgetService } from '../usage/platform-budget.service.js';

/** §11.5 and §14 thresholds. Named so a test reads the same number the code does. */
export const ALERT = {
  /**
   * §11.5's figure, and deliberately above the ₹100 ceiling: reaching it means the runtime ceiling
   * in `UsageService` did not hold, which is a fault in the metering rather than a heavy user.
   */
  userCostInr: 120,
  /**
   * A second, quieter threshold below the ceiling. ₹120 only ever fires once something has already
   * gone wrong; this one fires while there is still something to do about it — a user at ₹85 is on
   * course to be refused before the month ends, and that is worth knowing then rather than after.
   */
  userApproachingInr: 85,
  platformAverageInr: 90,
  jobFailureRate: 0.05,
  ttfbP95Ms: 900,
  windowMinutes: 15,
} as const;

export type AlertKind =
  | 'USER_COST'
  | 'USER_APPROACHING'
  | 'PLATFORM_AVERAGE'
  | 'PLATFORM_BUDGET_WARNING'
  | 'PLATFORM_BUDGET_REACHED'
  | 'JOB_FAILURES'
  | 'TTFB_P95'
  /** ADR-0149: the day's OpenAlex use has passed 70% / 90% of the key's free daily budget. */
  | 'OPENALEX_BUDGET_70'
  | 'OPENALEX_BUDGET_90'
  /** ADR-0149: the key's budget is spent; searches go to the (smaller) keyless pool. */
  | 'OPENALEX_KEY_SPENT'
  /** ADR-0149: a paper index is refusing every request. */
  | 'INDEX_REFUSING';

export type Breach = { kind: AlertKind; detail: string; value: number; threshold: number };

const toInr = (microInr: bigint | number): number => Number(microInr) / 1_000_000;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  /** Breaches currently emailed, so the same fact is not sent every window. */
  private readonly open = new Set<AlertKind>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
    private readonly budget: PlatformBudgetService,
  ) {}

  /** The seed admin, plus `ALERT_EMAILS` (2026-09-25: the owner asked for a second inbox). */
  recipients(): string[] {
    const extra = (this.env.ALERT_EMAILS ?? '')
      .split(',')
      .map((address) => address.trim())
      .filter((address) => address.includes('@'));
    return [...new Set([this.env.SEED_ADMIN_EMAIL, ...extra])];
  }

  /** Runs every condition; returns what breached. Emails new breaches, clears resolved ones. */
  async evaluate(now = new Date()): Promise<Breach[]> {
    const breaches = [
      ...(await this.budgetBreaches(now)),
      ...(await this.costBreaches(now)),
      ...(await this.jobFailureBreach(now)),
      ...(await this.ttfbBreach(now)),
      ...(await this.scholarlyBreaches(now)),
    ];

    const current = new Set(breaches.map((b) => b.kind));
    for (const kind of this.open) {
      if (!current.has(kind)) {
        this.open.delete(kind);
        this.logger.log({ kind }, 'alert cleared');
      }
    }

    const fresh = breaches.filter((b) => !this.open.has(b.kind));
    if (fresh.length > 0) {
      await this.mailer.send({
        to: this.recipients(),
        subject: `Thesis Copilot alert: ${fresh.map((b) => b.kind).join(', ')}`,
        text: fresh
          .map((b) => `${b.kind}: ${b.detail} (${b.value} against a threshold of ${b.threshold})`)
          .join('\n'),
      });
      for (const b of fresh) this.open.add(b.kind);
    }

    return breaches;
  }

  /**
   * The site-wide monthly budget (2026-09-25): a warning at 80%, and the stop itself. Each is
   * emailed once and then stays open until the month turns or the number is raised.
   */
  private async budgetBreaches(now: Date): Promise<Breach[]> {
    const budget = await this.budget.status(now);
    if (budget.ceilingInr === null) return [];
    if (budget.reached) {
      return [
        {
          kind: 'PLATFORM_BUDGET_REACHED',
          detail: `The site's AI budget for ${budget.period} is reached: ₹${budget.spentInr.toFixed(2)} of ₹${budget.ceilingInr}. Every AI call is refused until the 1st, or until the budget is raised in Admin.`,
          value: budget.spentInr,
          threshold: budget.ceilingInr,
        },
      ];
    }
    if (budget.warning) {
      return [
        {
          kind: 'PLATFORM_BUDGET_WARNING',
          detail: `The site has used ₹${budget.spentInr.toFixed(2)} of its ₹${budget.ceilingInr} AI budget for ${budget.period}. AI features stop at the budget.`,
          value: budget.spentInr,
          threshold: Math.round(budget.ceilingInr * 0.8),
        },
      ];
    }
    return [];
  }

  /**
   * ADR-0149: the paper indexes. The day's OpenAlex count (ours, in Redis, shared with the
   * worker) against the key's free $1, at 70% and at 90% — only the higher is open at a time,
   * and the day turning clears it; the key's budget spent; an index refusing every request. Each
   * is one email per incident, like every other alert here.
   */
  async scholarlyBreaches(
    now: Date,
    sources: {
      today?: () => Promise<OpenAlexDay>;
      states?: () => ReturnType<typeof scholarlyHealth.snapshot>;
    } = {},
  ): Promise<Breach[]> {
    const out: Breach[] = [];
    try {
      const day = await (sources.today ?? (() => openAlexMeter.today(now.getTime())))();
      const share = day.shareOfKeyedBudget;
      const [warn70, warn90] = OPENALEX_WARN_SHARES;
      const level = share >= warn90 ? 90 : share >= warn70 ? 70 : null;
      if (level !== null) {
        out.push({
          kind: level === 90 ? 'OPENALEX_BUDGET_90' : 'OPENALEX_BUDGET_70',
          detail: `OpenAlex use today (${day.date} UTC) is about $${day.usd.toFixed(3)} of the key's free $${OPENALEX_USD.keyedDailyBudget}: ${day.searches} searches, ${day.lists} list requests, ${day.lookups} free lookups. Past the budget OpenAlex refuses the key until midnight UTC and searches fall back to the shared keyless pool ($${OPENALEX_USD.keylessDailyBudget}/day).`,
          value: Math.round(share * 100),
          threshold: level,
        });
      }
      const states = await (sources.states ?? (() =>
        scholarlyHealth.snapshot(['openalex', 'semanticscholar'])))();
      const t = now.getTime();
      for (const state of states) {
        if (
          state.service === 'openalex' &&
          state.keyedExhaustedUntil !== null &&
          state.keyedExhaustedUntil > t
        ) {
          out.push({
            kind: 'OPENALEX_KEY_SPENT',
            detail: `OpenAlex refused the key until ${new Date(state.keyedExhaustedUntil).toISOString()} ("${state.reason ?? 'budget spent'}"). Searches go without the key until then. A prepaid top-up is the remedy if this repeats (docs/PENDING.md).`,
            value: 0,
            threshold: 0,
          });
        }
        if (state.refusedUntil !== null && state.refusedUntil > t) {
          const minutes = state.refusingSince ? Math.round((t - state.refusingSince) / 60_000) : 0;
          out.push({
            kind: 'INDEX_REFUSING',
            detail: `${state.service} has refused every request for ${minutes} min, until ${new Date(state.refusedUntil).toISOString()} ("${state.reason ?? 'HTTP 429'}"). Students see a notice naming it; searches use the other indexes.`,
            value: minutes,
            threshold: 0,
          });
        }
      }
    } catch (error) {
      // Redis down is not a reason to stop the other alerts.
      this.logger.warn({ err: error }, 'scholarly alert check failed');
    }
    return out;
  }

  /** §11.5: month-to-date, per user and platform-wide. */
  private async costBreaches(now: Date): Promise<Breach[]> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const perUser = await this.prisma.aiCallLog.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: monthStart, lte: now } },
      _sum: { costMicroInr: true },
    });
    if (perUser.length === 0) return [];

    const spends = perUser.map((row) => ({
      userId: row.userId,
      inr: toInr(row._sum.costMicroInr ?? 0n),
    }));
    const out: Breach[] = [];

    const worst = spends.reduce((a, b) => (b.inr > a.inr ? b : a));
    if (worst.inr > ALERT.userCostInr) {
      out.push({
        kind: 'USER_COST',
        detail: `user ${worst.userId} has spent INR ${worst.inr.toFixed(2)} this month, past the ₹100 ceiling`,
        value: Math.round(worst.inr * 100) / 100,
        threshold: ALERT.userCostInr,
      });
    } else if (worst.inr > ALERT.userApproachingInr) {
      // Only when the louder one has not fired: two emails about the same user say nothing extra.
      out.push({
        kind: 'USER_APPROACHING',
        detail: `user ${worst.userId} has spent INR ${worst.inr.toFixed(2)} of the ₹100 ceiling this month`,
        value: Math.round(worst.inr * 100) / 100,
        threshold: ALERT.userApproachingInr,
      });
    }

    const average = spends.reduce((sum, s) => sum + s.inr, 0) / spends.length;
    if (average > ALERT.platformAverageInr) {
      out.push({
        kind: 'PLATFORM_AVERAGE',
        detail: `platform average is INR ${average.toFixed(2)} per user this month`,
        value: Math.round(average * 100) / 100,
        threshold: ALERT.platformAverageInr,
      });
    }
    return out;
  }

  /** §14: failed AI calls over the last 15 minutes. A window with no calls cannot breach. */
  private async jobFailureBreach(now: Date): Promise<Breach[]> {
    const since = new Date(now.getTime() - ALERT.windowMinutes * 60_000);
    const [total, failed] = await Promise.all([
      this.prisma.aiCallLog.count({ where: { createdAt: { gte: since, lte: now } } }),
      this.prisma.aiCallLog.count({ where: { createdAt: { gte: since, lte: now }, ok: false } }),
    ]);
    if (total === 0) return [];
    const rate = failed / total;
    if (rate <= ALERT.jobFailureRate) return [];
    return [
      {
        kind: 'JOB_FAILURES',
        detail: `${failed} of ${total} AI calls failed in the last ${ALERT.windowMinutes} minutes`,
        value: Math.round(rate * 1000) / 10,
        threshold: ALERT.jobFailureRate * 100,
      },
    ];
  }

  /**
   * §14: Assist p95 latency over the last 15 minutes, computed from the logged latencies. The
   * Prometheus histogram is the operational source; this is the same fact from the durable record.
   */
  private async ttfbBreach(now: Date): Promise<Breach[]> {
    const since = new Date(now.getTime() - ALERT.windowMinutes * 60_000);
    // The database counts and picks the one row, rather than every call in the window coming back
    // to be sorted here — a window that grows with traffic (2026-09-28). Same index as before.
    const where = { action: 'ASSIST' as const, ok: true, createdAt: { gte: since, lte: now } };
    const count = await this.prisma.aiCallLog.count({ where });
    if (count === 0) return [];
    const [row] = await this.prisma.aiCallLog.findMany({
      where,
      orderBy: { latencyMs: 'asc' },
      skip: Math.min(count - 1, Math.floor(count * 0.95)),
      take: 1,
      select: { latencyMs: true },
    });
    const p95 = row?.latencyMs ?? 0;
    if (p95 <= ALERT.ttfbP95Ms) return [];
    return [
      {
        kind: 'TTFB_P95',
        detail: `Assist p95 latency is ${p95} ms over the last ${ALERT.windowMinutes} minutes`,
        value: p95,
        threshold: ALERT.ttfbP95Ms,
      },
    ];
  }
}
