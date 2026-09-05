/**
 * Pilot support — PHASES 5.9.
 *
 *   "Admin: per-user page with their documents (titles only), usage, cost, last active;
 *    'reset caps' button (logged)."
 *
 * Titles only, deliberately: a support view does not need chapter text, and §12.2 keeps thesis
 * content out of places that do not need it. Everything an admin does here lands in `AuditEvent`
 * (ADR-0004) with the admin as `actorId`, so a reset is never a silent change to a ledger.
 */

import { Injectable } from '@nestjs/common';
import { type AiAction, METERED_ACTIONS, PLAN_LIMITS, PLANS, type Plan } from '@tc/config';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { periodFor } from '../usage/usage.service.js';

const toInr = (microInr: bigint | number): number => Math.round(Number(microInr) / 10_000) / 100;

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  documents: number;
  costInr: number;
  usage: Array<{ action: AiAction; used: number; cap: number }>;
};

export type UserDetail = UserRow & {
  documentList: Array<{ id: string; title: string; updatedAt: Date; chapters: number }>;
  capExceeded: number;
  recentEvents: Array<{ kind: string; actorId: string | null; detail: unknown; createdAt: Date }>;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every user, most recently active first, with this period's usage and cost. */
  async list(now: Date = new Date()): Promise<UserRow[]> {
    const period = periodFor(now);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        createdAt: true,
        _count: { select: { documents: true } },
        usage: { where: { period }, select: { action: true, count: true } },
      },
    });

    const [costs, lastCalls, lastEvents] = await Promise.all([
      this.prisma.aiCallLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: from } },
        _sum: { costMicroInr: true },
      }),
      this.prisma.aiCallLog.groupBy({ by: ['userId'], _max: { createdAt: true } }),
      this.prisma.suggestionEvent.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    ]);
    const costByUser = new Map(costs.map((c) => [c.userId, c._sum.costMicroInr ?? 0n]));
    const lastByUser = new Map<string, Date>();
    for (const row of [...lastCalls, ...lastEvents]) {
      const at = row._max.createdAt;
      if (!at) continue;
      const current = lastByUser.get(row.userId);
      if (!current || at > current) lastByUser.set(row.userId, at);
    }

    const rows = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      plan: u.plan,
      createdAt: u.createdAt,
      lastActiveAt: lastByUser.get(u.id) ?? null,
      documents: u._count.documents,
      costInr: toInr(costByUser.get(u.id) ?? 0n),
      usage: usageWithCaps(u.plan, u.usage),
    }));
    return rows.sort((a, b) => (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0));
  }

  async get(userId: string, now: Date = new Date()): Promise<UserDetail> {
    const rows = await this.list(now);
    const row = rows.find((r) => r.id === userId);
    if (!row) throw new NotFoundError('That user');

    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [documents, capExceeded, recentEvents] = await Promise.all([
      this.prisma.document.findMany({
        where: { ownerId: userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, updatedAt: true, _count: { select: { chapters: true } } },
      }),
      this.prisma.auditEvent.count({
        where: { userId, kind: 'CAP_EXCEEDED', createdAt: { gte: from } },
      }),
      this.prisma.auditEvent.findMany({
        where: { userId, kind: { not: 'CAP_EXCEEDED' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { kind: true, actorId: true, detail: true, createdAt: true },
      }),
    ]);

    return {
      ...row,
      documentList: documents.map((d) => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
        chapters: d._count.chapters,
      })),
      capExceeded,
      recentEvents,
    };
  }

  /**
   * Zeroes this period's ledger for every metered action. The units already spent stay in
   * `AiCallLog` — the cost was real — and the reset is written with the admin's id and what the
   * counters were, so it can be read back.
   */
  async resetCaps(
    actorId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<{ reset: Array<{ action: string; was: number }> }> {
    const period = periodFor(now);
    const before = await this.prisma.usageLedger.findMany({
      where: { userId, period },
      select: { action: true, count: true },
    });
    if (!(await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      throw new NotFoundError('That user');
    }
    const reset = before
      .filter((r) => r.count > 0)
      .map((r) => ({ action: r.action, was: r.count }));
    await this.prisma.$transaction([
      this.prisma.usageLedger.updateMany({ where: { userId, period }, data: { count: 0 } }),
      this.prisma.auditEvent.create({
        data: { kind: 'CAPS_RESET', userId, actorId, detail: { period, reset } },
      }),
    ]);
    return { reset };
  }

  /** PHASES 5.8: "pilot users … set to STUDENT_MONTHLY caps by admin override". */
  async setPlan(actorId: string, userId: string, plan: Plan): Promise<{ plan: Plan }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    if (!user) throw new NotFoundError('That user');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { plan } }),
      this.prisma.auditEvent.create({
        data: { kind: 'PLAN_CHANGED', userId, actorId, detail: { from: user.plan, to: plan } },
      }),
    ]);
    return { plan };
  }
}

export const PLAN_NAMES = PLANS;

function usageWithCaps(
  plan: Plan,
  usage: Array<{ action: AiAction; count: number }>,
): Array<{ action: AiAction; used: number; cap: number }> {
  const caps = PLAN_LIMITS[plan].caps;
  return METERED_ACTIONS.map((action) => ({
    action,
    used: usage.find((u) => u.action === action)?.count ?? 0,
    cap: caps[action] ?? 0,
  }));
}
