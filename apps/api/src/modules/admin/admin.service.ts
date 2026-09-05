/**
 * Admin dashboards — PRD §9.4 (`/admin/costs`, `/admin/telemetry`), §11.5, §14,
 * PHASES 4.3, 4.4, 4.5.
 *
 * Every number here is read from `AiCallLog` and `SuggestionEvent`, which record what actually
 * happened rather than what was projected. §11.5 is explicit that cost comes from real token
 * usage and never an estimate, so the projection in the cost model and the figures below are two
 * different things and the dashboard shows both — the gap between them is the thing worth looking
 * at.
 */

import { Injectable } from '@nestjs/common';
import {
  type AiAction,
  computeMonthlyBudget,
  METERED_ACTIONS,
  PLAN_LIMITS,
  PLANS,
} from '@tc/config';
import { PrismaService } from '../../common/prisma.service.js';

/** Micro-rupees to rupees. Money is stored as an integer throughout (§0.2). */
const toInr = (microInr: bigint | number): number => Math.round(Number(microInr) / 10_000) / 100;

export type CostRow = {
  action: string;
  calls: number;
  failed: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costInr: number;
  /** §10.3's target for Assist is ≥ 70% after warm-up. */
  cacheHitRate: number;
};

export type CostsReport = {
  from: Date;
  to: Date;
  rows: CostRow[];
  totalInr: number;
  users: number;
  /** Spend per active user this period, against the ₹100 ceiling (§11). */
  perUserInr: number;
  ceilingInr: number;
  /** The worst individual user this period; the ceiling is per user, not an average. */
  worstUserInr: number;
};

export type TelemetryReport = {
  from: Date;
  to: Date;
  outcomes: Array<{ action: string; outcome: string; count: number }>;
  /** FR-9.4's headline: of the suggestions shown, how many were kept. */
  acceptance: Array<{ action: string; shown: number; accepted: number; rate: number }>;
  /** §10.6 alerts above 1%. */
  hallucinatedCiteRate: number;
  /** Mean, not median: Postgres has no cheap median and the mean is what the query gives. */
  avgLatencyMs: Record<string, number>;
};

/** The default window: the current calendar month, which is also the cap period (§11.3). */
function currentPeriod(): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: now,
  };
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** PHASES 4.3: what the AI actually cost, by action. */
  async costs(period = currentPeriod()): Promise<CostsReport> {
    const grouped = await this.prisma.aiCallLog.groupBy({
      by: ['action', 'ok'],
      where: { createdAt: { gte: period.from, lte: period.to } },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        costMicroInr: true,
      },
    });

    const byAction = new Map<string, CostRow>();
    for (const action of METERED_ACTIONS) {
      byAction.set(action, {
        action,
        calls: 0,
        failed: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costInr: 0,
        cacheHitRate: 0,
      });
    }

    for (const row of grouped) {
      const current =
        byAction.get(row.action) ??
        ({
          action: row.action,
          calls: 0,
          failed: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          costInr: 0,
          cacheHitRate: 0,
        } satisfies CostRow);

      current.calls += row._count._all;
      if (!row.ok) current.failed += row._count._all;
      current.inputTokens += row._sum.inputTokens ?? 0;
      current.cachedInputTokens += row._sum.cachedInputTokens ?? 0;
      current.outputTokens += row._sum.outputTokens ?? 0;
      current.costInr += toInr(row._sum.costMicroInr ?? 0n);
      byAction.set(row.action, current);
    }

    const rows = [...byAction.values()].map((row) => {
      const billable = row.inputTokens + row.cachedInputTokens;
      return {
        ...row,
        costInr: Math.round(row.costInr * 100) / 100,
        cacheHitRate:
          billable === 0 ? 0 : Math.round((row.cachedInputTokens / billable) * 1000) / 10,
      };
    });

    // Per user, because the ₹100 ceiling in §11 is per user rather than an average over everyone.
    const perUser = await this.prisma.aiCallLog.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: period.from, lte: period.to } },
      _sum: { costMicroInr: true },
    });
    const spends = perUser.map((row) => toInr(row._sum.costMicroInr ?? 0n));
    const totalInr = Math.round(spends.reduce((sum, value) => sum + value, 0) * 100) / 100;

    return {
      from: period.from,
      to: period.to,
      rows,
      totalInr,
      users: perUser.length,
      perUserInr: perUser.length === 0 ? 0 : Math.round((totalInr / perUser.length) * 100) / 100,
      ceilingInr: computeMonthlyBudget('STUDENT_MONTHLY').ceilingInr,
      worstUserInr: spends.length === 0 ? 0 : Math.max(...spends),
    };
  }

  /** PHASES 4.4: what students did with what the AI offered (FR-9.4). */
  async telemetry(period = currentPeriod()): Promise<TelemetryReport> {
    const grouped = await this.prisma.suggestionEvent.groupBy({
      by: ['action', 'outcome'],
      where: { createdAt: { gte: period.from, lte: period.to } },
      _count: { _all: true },
    });

    const outcomes = grouped
      .map((row) => ({ action: row.action, outcome: row.outcome, count: row._count._all }))
      .sort((a, b) => a.action.localeCompare(b.action) || a.outcome.localeCompare(b.outcome));

    // "Accepted" is ACCEPTED or PARTIAL: a partly kept suggestion was still useful.
    const kept = new Set(['ACCEPTED', 'PARTIAL']);
    const byAction = new Map<string, { shown: number; accepted: number }>();
    for (const row of outcomes) {
      const current = byAction.get(row.action) ?? { shown: 0, accepted: 0 };
      current.shown += row.count;
      if (kept.has(row.outcome)) current.accepted += row.count;
      byAction.set(row.action, current);
    }

    const acceptance = [...byAction.entries()].map(([action, counts]) => ({
      action,
      shown: counts.shown,
      accepted: counts.accepted,
      rate: counts.shown === 0 ? 0 : Math.round((counts.accepted / counts.shown) * 1000) / 10,
    }));

    // §10.6 alerts when hallucinated citations exceed 1% of calls. The counter is in Prometheus;
    // this is the same ratio from the durable record, so the dashboard does not depend on scrape
    // history that a restart would lose.
    const calls = await this.prisma.aiCallLog.count({
      where: { createdAt: { gte: period.from, lte: period.to }, ok: true },
    });
    const withHallucination = await this.prisma.aiCallLog.count({
      where: {
        createdAt: { gte: period.from, lte: period.to },
        error: { contains: 'HALLUCINATED_CITE' },
      },
    });

    const latencies = await this.prisma.aiCallLog.groupBy({
      by: ['action'],
      where: { createdAt: { gte: period.from, lte: period.to }, ok: true },
      _avg: { latencyMs: true },
    });

    return {
      from: period.from,
      to: period.to,
      outcomes,
      acceptance,
      hallucinatedCiteRate: calls === 0 ? 0 : Math.round((withHallucination / calls) * 1000) / 10,
      avgLatencyMs: Object.fromEntries(
        latencies.map((row) => [row.action, Math.round(row._avg.latencyMs ?? 0)]),
      ),
    };
  }

  /** PHASES 4.9: the flag list with its current state, for the admin toggle UI. */
  async flags(): Promise<Array<{ key: string; enabled: boolean; updatedAt: Date }>> {
    return this.prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
      select: { key: true, enabled: true, updatedAt: true },
    });
  }

  async setFlag(key: string, enabled: boolean): Promise<{ key: string; enabled: boolean }> {
    const updated = await this.prisma.featureFlag.update({
      where: { key },
      data: { enabled },
      select: { key: true, enabled: true },
    });
    return updated;
  }

  /** The caps every plan enforces, so the dashboard can show them beside actual use (FR-9.2). */
  plans(): Array<{ plan: string; caps: Partial<Record<AiAction, number>> }> {
    return PLANS.map((plan) => ({ plan, caps: PLAN_LIMITS[plan].caps }));
  }
}
