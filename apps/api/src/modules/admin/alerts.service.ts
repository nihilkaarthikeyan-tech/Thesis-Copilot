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
import { ENV } from '../../common/env.token.js';
import { MAILER, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';

/** §11.5 and §14 thresholds. Named so a test reads the same number the code does. */
export const ALERT = {
  userCostInr: 120,
  platformAverageInr: 90,
  jobFailureRate: 0.05,
  ttfbP95Ms: 900,
  windowMinutes: 15,
} as const;

export type AlertKind = 'USER_COST' | 'PLATFORM_AVERAGE' | 'JOB_FAILURES' | 'TTFB_P95';

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
  ) {}

  /** Runs every condition; returns what breached. Emails new breaches, clears resolved ones. */
  async evaluate(now = new Date()): Promise<Breach[]> {
    const breaches = [
      ...(await this.costBreaches(now)),
      ...(await this.jobFailureBreach(now)),
      ...(await this.ttfbBreach(now)),
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
        to: [this.env.SEED_ADMIN_EMAIL],
        subject: `Thesis Copilot alert: ${fresh.map((b) => b.kind).join(', ')}`,
        text: fresh
          .map((b) => `${b.kind}: ${b.detail} (${b.value} against a threshold of ${b.threshold})`)
          .join('\n'),
      });
      for (const b of fresh) this.open.add(b.kind);
    }

    return breaches;
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
        detail: `user ${worst.userId} has spent INR ${worst.inr.toFixed(2)} this month`,
        value: Math.round(worst.inr * 100) / 100,
        threshold: ALERT.userCostInr,
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
    const rows = await this.prisma.aiCallLog.findMany({
      where: { action: 'ASSIST', ok: true, createdAt: { gte: since, lte: now } },
      select: { latencyMs: true },
    });
    if (rows.length === 0) return [];
    const sorted = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
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
