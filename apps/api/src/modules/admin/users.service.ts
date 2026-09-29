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
import type { Prisma } from '@tc/db';
import { NotFoundError, ValidationError } from '../../common/errors.js';
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
  usage: Array<{ action: AiAction; used: number; cap: number; bonus: number }>;
  status: UserStatus;
  /** When the free trial ends or ended (ADR-0036); meaningful on FREE_TRIAL only. */
  trialEndsAt: Date | null;
};

/**
 * Where an account stands (2026-09-29). Deleted wins over everything, then a pending deletion,
 * then a suspension.
 */
export type UserStatus = 'active' | 'suspended' | 'deleting' | 'deleted';
export const USER_STATUSES = ['active', 'suspended', 'deleting', 'deleted'] as const;

export type UserFilters = {
  q?: string;
  plan?: Plan;
  role?: string;
  status?: UserStatus;
};

function statusOf(u: {
  suspendedAt: Date | null;
  deletionRequestedAt: Date | null;
  deletedAt: Date | null;
}): UserStatus {
  if (u.deletedAt) return 'deleted';
  if (u.deletionRequestedAt) return 'deleting';
  if (u.suspendedAt) return 'suspended';
  return 'active';
}

function whereFor(filters: UserFilters): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (filters.plan) where.plan = filters.plan;
  if (filters.role) where.role = filters.role as Prisma.UserWhereInput['role'];
  switch (filters.status) {
    case 'deleted':
      where.deletedAt = { not: null };
      break;
    case 'deleting':
      where.deletedAt = null;
      where.deletionRequestedAt = { not: null };
      break;
    case 'suspended':
      where.deletedAt = null;
      where.deletionRequestedAt = null;
      where.suspendedAt = { not: null };
      break;
    case 'active':
      where.deletedAt = null;
      where.deletionRequestedAt = null;
      where.suspendedAt = null;
      break;
  }
  return where;
}

const statusSelect = {
  suspendedAt: true,
  deletionRequestedAt: true,
  deletedAt: true,
  trialEndsAt: true,
} as const;

export type UserPage = {
  rows: UserRow[];
  total: number;
  limit: number;
  offset: number;
};

/** A page nobody asked to size. Large enough to be one screen, small enough to be one query. */
export const USERS_PAGE_SIZE = 50;
export const USERS_MAX_PAGE_SIZE = 200;

export type UserDetail = UserRow & {
  documentList: Array<{
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    chapters: number;
    words: number;
  }>;
  capExceeded: number;
  recentEvents: Array<{
    kind: string;
    actorId: string | null;
    actorEmail: string | null;
    detail: unknown;
    createdAt: Date;
  }>;
  /** How this person signs in: `otp` always, plus `password` and/or `google`. */
  signInMethods: string[];
  sessions: number;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  deletionRequestedAt: Date | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of users, newest first, with this period's usage and cost.
   *
   * Paginated because this is the one list in the product that grows with the platform rather
   * than with one student's work: unbounded, it is a full table scan plus three platform-wide
   * aggregates on every visit to `/admin/users`.
   *
   * Ordered by `createdAt` rather than by last activity. Activity is derived from aggregates over
   * two other tables and cannot be a database sort key without denormalising it, and ordering a
   * *page* by something the database did not order by would show a different set of users
   * depending on which page you were on. It is still a column; it is no longer the sort.
   */
  async list(
    options: { limit?: number; offset?: number } & UserFilters = {},
    now: Date = new Date(),
  ): Promise<UserPage> {
    const limit = Math.min(Math.max(options.limit ?? USERS_PAGE_SIZE, 1), USERS_MAX_PAGE_SIZE);
    const offset = Math.max(options.offset ?? 0, 0);
    const period = periodFor(now);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const where = whereFor(options);
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          plan: true,
          createdAt: true,
          ...statusSelect,
          _count: { select: { documents: true } },
          usage: { where: { period }, select: { action: true, count: true, bonus: true } },
        },
      }),
    ]);

    // Scoped to the page's users, so these do not scan the whole platform either.
    const ids = users.map((u) => u.id);
    const [costs, lastCalls, lastEvents] = await Promise.all([
      this.prisma.aiCallLog.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, createdAt: { gte: from } },
        _sum: { costMicroInr: true },
      }),
      this.prisma.aiCallLog.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _max: { createdAt: true },
      }),
      this.prisma.suggestionEvent.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _max: { createdAt: true },
      }),
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
      usage: usageWithCaps(u.plan, u.usage, trialOver(u.plan, u.trialEndsAt, now)),
      status: statusOf(u),
      trialEndsAt: u.trialEndsAt,
    }));
    return { rows, total, limit, offset };
  }

  /**
   * One user in full.
   *
   * This used to call `list()` and pick the row out of it, which meant reading every user on the
   * platform and three platform-wide aggregates to answer a question about one of them. It asks
   * about the one now.
   */
  async get(userId: string, now: Date = new Date()): Promise<UserDetail> {
    const period = periodFor(now);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        createdAt: true,
        ...statusSelect,
        suspendedReason: true,
        _count: { select: { documents: true, sessions: true } },
        usage: { where: { period }, select: { action: true, count: true, bonus: true } },
        accounts: { select: { providerId: true } },
      },
    });
    if (!user) throw new NotFoundError('That user');

    const [cost, lastCall, lastEvent] = await Promise.all([
      this.prisma.aiCallLog.aggregate({
        where: { userId, createdAt: { gte: from } },
        _sum: { costMicroInr: true },
      }),
      this.prisma.aiCallLog.aggregate({ where: { userId }, _max: { createdAt: true } }),
      this.prisma.suggestionEvent.aggregate({ where: { userId }, _max: { createdAt: true } }),
    ]);
    const activity = [lastCall._max.createdAt, lastEvent._max.createdAt].filter(
      (d): d is Date => d !== null,
    );
    const row: UserRow = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.plan,
      createdAt: user.createdAt,
      lastActiveAt: activity.length
        ? new Date(Math.max(...activity.map((d) => d.getTime())))
        : null,
      documents: user._count.documents,
      costInr: toInr(cost._sum.costMicroInr ?? 0n),
      usage: usageWithCaps(user.plan, user.usage, trialOver(user.plan, user.trialEndsAt, now)),
      status: statusOf(user),
      trialEndsAt: user.trialEndsAt,
    };

    const [documents, words, capExceeded, recentEvents] = await Promise.all([
      this.prisma.document.findMany({
        where: { ownerId: userId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { chapters: true } },
        },
      }),
      this.prisma.chapter.groupBy({
        by: ['documentId'],
        where: { document: { ownerId: userId } },
        _sum: { wordCount: true },
      }),
      this.prisma.auditEvent.count({
        where: { userId, kind: 'CAP_EXCEEDED', createdAt: { gte: from } },
      }),
      this.prisma.auditEvent.findMany({
        where: { userId, kind: { not: 'CAP_EXCEEDED' } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { kind: true, actorId: true, detail: true, createdAt: true },
      }),
    ]);
    const wordsByDoc = new Map(words.map((w) => [w.documentId, w._sum.wordCount ?? 0]));
    const actorIds = [
      ...new Set(recentEvents.map((e) => e.actorId).filter((id): id is string => Boolean(id))),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : [];
    const actorEmail = new Map(actors.map((a) => [a.id, a.email]));

    const providers = new Set(user.accounts.map((a) => a.providerId));
    const signInMethods = ['otp'];
    if (providers.has('credential')) signInMethods.push('password');
    if (providers.has('google')) signInMethods.push('google');

    return {
      ...row,
      documentList: documents.map((d) => ({
        id: d.id,
        title: d.title,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        chapters: d._count.chapters,
        words: wordsByDoc.get(d.id) ?? 0,
      })),
      capExceeded,
      recentEvents: recentEvents.map((e) => ({
        ...e,
        actorEmail: e.actorId ? (actorEmail.get(e.actorId) ?? null) : null,
      })),
      signInMethods,
      sessions: user._count.sessions,
      suspendedAt: user.suspendedAt,
      suspendedReason: user.suspendedReason,
      deletionRequestedAt: user.deletionRequestedAt,
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

  /**
   * Changes a user's role, logged with who did it. An admin cannot take their own superadmin
   * role away: with one administrator that would lock everyone out of the admin screens, and the
   * database is the only way back in.
   */
  async setRole(
    actorId: string,
    userId: string,
    role: 'STUDENT' | 'INSTITUTION_ADMIN' | 'SUPERADMIN',
  ): Promise<{ role: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new NotFoundError('That user');
    if (actorId === userId && user.role === 'SUPERADMIN' && role !== 'SUPERADMIN') {
      throw new ValidationError(
        'You cannot remove your own admin access. Ask another superadmin to do it.',
      );
    }
    if (user.role === role) return { role };
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { role } }),
      this.prisma.auditEvent.create({
        data: { kind: 'ROLE_CHANGED', userId, actorId, detail: { from: user.role, to: role } },
      }),
    ]);
    return { role };
  }
}

export const PLAN_NAMES = PLANS;

/** This period's use against the plan's cap plus any extra an admin gave (2026-09-29). */
function trialOver(plan: Plan, endsAt: Date | null, now: Date): boolean {
  return plan === 'FREE_TRIAL' && endsAt !== null && endsAt.getTime() <= now.getTime();
}

function usageWithCaps(
  plan: Plan,
  usage: Array<{ action: AiAction; count: number; bonus: number }>,
  trialEnded = false,
): Array<{ action: AiAction; used: number; cap: number; bonus: number }> {
  const caps: Partial<Record<AiAction, number>> = trialEnded ? {} : PLAN_LIMITS[plan].caps;
  return METERED_ACTIONS.map((action) => {
    const row = usage.find((u) => u.action === action);
    const bonus = row?.bonus ?? 0;
    return { action, used: row?.count ?? 0, cap: (caps[action] ?? 0) + bonus, bonus };
  });
}
