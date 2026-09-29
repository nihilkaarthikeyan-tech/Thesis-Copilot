/**
 * The admin's read-outs (2026-09-29): the overview, the activity log, background jobs and the
 * feedback inbox. Numbers only a database or a queue can answer; nothing here changes a student's
 * account except marking feedback read or answered, and retrying a failed job.
 */

import { Injectable } from '@nestjs/common';
import { MONTHLY_CEILING_INR, PRICING } from '@tc/config';
import type { Prisma } from '@tc/db';
import { QUEUE_NAMES, type QueueName } from '@tc/types';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { StorageService } from '../../common/storage.service.js';
import { PlatformBudgetService } from '../usage/platform-budget.service.js';

const DAY = 86_400_000;
const toInr = (micro: bigint | number | null | undefined): number =>
  Math.round(Number(micro ?? 0) / 10_000) / 100;

/** Walking the bucket is slow on a big one; the overview shows a figure at most this old. */
const STORAGE_CACHE_MS = 10 * 60 * 1000;

/** The date a timestamp falls on in India, `YYYY-MM-DD` — the day a student would call it. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Kinds the Activity log leaves out unless asked for by name: one per refused AI call, so on a
 * busy day they would bury every administrator action in the list.
 */
const NOISY_KINDS = ['CAP_EXCEEDED', 'CEILING_EXCEEDED', 'PLATFORM_CEILING_EXCEEDED'];

export type ActivityFilters = {
  kind?: string;
  q?: string;
  days?: number;
  limit?: number;
  offset?: number;
};

@Injectable()
export class AdminInsightService {
  private storageCache: {
    at: number;
    value: Awaited<ReturnType<StorageService['totals']>>;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly budget: PlatformBudgetService,
  ) {}

  async overview(now: Date = new Date()) {
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thirtyDaysAgo = new Date(now.getTime() - 29 * DAY);
    const people: Prisma.UserWhereInput = { deletedAt: null, role: { not: 'SUPERADMIN' } };

    const [
      students,
      newThisWeek,
      activeRows,
      subscriptions,
      recentSignups,
      newest,
      spend,
      spendByUser,
      budget,
      feedbackRows,
      theses,
      chapters,
      words,
      sources,
      uploads,
      seedUploads,
      dbSize,
      suspended,
      deleting,
      trialsEnding,
      trialsEnded,
    ] = await Promise.all([
      this.prisma.user.count({ where: people }),
      this.prisma.user.count({ where: { ...people, createdAt: { gte: weekAgo } } }),
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(DISTINCT "userId") AS n FROM (
          SELECT "userId" FROM "AiCallLog" WHERE "createdAt" >= ${weekAgo}
          UNION SELECT "userId" FROM "SuggestionEvent" WHERE "createdAt" >= ${weekAgo}
          UNION SELECT "userId" FROM "Session" WHERE "updatedAt" >= ${weekAgo}
        ) AS seen`,
      this.prisma.subscription.findMany({
        where: { status: { in: ['active', 'trialing', 'past_due'] } },
        select: { plan: true },
      }),
      this.prisma.user.findMany({
        where: { ...people, createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true, _count: { select: { documents: true } } },
      }),
      this.prisma.user.findMany({
        where: people,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, email: true, createdAt: true, _count: { select: { documents: true } } },
      }),
      this.prisma.aiCallLog.aggregate({
        where: { ok: true, createdAt: { gte: monthStart } },
        _sum: { costMicroInr: true },
      }),
      this.prisma.aiCallLog.groupBy({
        by: ['userId'],
        where: { ok: true, createdAt: { gte: monthStart } },
        _sum: { costMicroInr: true },
      }),
      this.budget.status(now),
      this.prisma.$queryRaw<Array<{ unread: bigint; last: Date | null }>>`
        SELECT COUNT(*) FILTER (WHERE f."readAt" IS NULL) AS unread, MAX(a."createdAt") AS last
        FROM "AuditEvent" a LEFT JOIN "FeedbackState" f ON f."auditEventId" = a."id"
        WHERE a."kind" = 'FEEDBACK'`,
      this.prisma.document.count(),
      this.prisma.chapter.count(),
      this.prisma.chapter.aggregate({ _sum: { wordCount: true } }),
      this.prisma.source.count(),
      this.prisma.source.count({ where: { fileKey: { not: null } } }),
      this.prisma.seedPaper.count(),
      this.prisma.$queryRaw<Array<{ bytes: bigint }>>`
        SELECT pg_database_size(current_database()) AS bytes`,
      this.prisma.user.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
      this.prisma.user.count({ where: { deletedAt: null, deletionRequestedAt: { not: null } } }),
      this.prisma.user.findMany({
        where: {
          ...people,
          plan: 'FREE_TRIAL',
          trialEndsAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY) },
        },
        orderBy: { trialEndsAt: 'asc' },
        take: 8,
        select: { id: true, email: true, trialEndsAt: true },
      }),
      this.prisma.user.count({
        where: { ...people, plan: 'FREE_TRIAL', trialEndsAt: { lte: now } },
      }),
    ]);

    // Sign-ups per day for the last 30 days, by the Indian calendar day.
    const days: Array<{ day: string; signups: number; withThesis: number }> = [];
    for (let i = 29; i >= 0; i--) {
      days.push({ day: istDay(new Date(now.getTime() - i * DAY)), signups: 0, withThesis: 0 });
    }
    const byDay = new Map(days.map((d) => [d.day, d]));
    for (const u of recentSignups) {
      const bucket = byDay.get(istDay(u.createdAt));
      if (!bucket) continue;
      bucket.signups += 1;
      if (u._count.documents > 0) bucket.withThesis += 1;
    }

    let mrr = 0;
    let annual = 0;
    for (const s of subscriptions) {
      const price = PRICING[s.plan];
      if (price.period === 'yearly') {
        if (price.priceInr > 0) annual += 1;
        mrr += price.priceInr / 12;
      } else {
        mrr += price.priceInr;
      }
    }
    const paying = subscriptions.filter((s) => PRICING[s.plan].priceInr > 0).length;
    const perUser = spendByUser.map((r) => toInr(r._sum.costMicroInr));
    const costInr = toInr(spend._sum.costMicroInr);

    const jobs = await this.jobCounts();
    const storage = await this.storageTotals();

    return {
      students,
      newThisWeek,
      activeLast7Days: Number(activeRows[0]?.n ?? 0),
      suspended,
      deleting,
      trialsEnding: trialsEnding.map((u) => ({
        id: u.id,
        email: u.email,
        trialEndsAt: u.trialEndsAt,
      })),
      trialsEnded,
      paying,
      annualSubscriptions: annual,
      monthlyRecurringInr: Math.round(mrr),
      signupsPerDay: days,
      newest: newest.map((u) => ({
        id: u.id,
        email: u.email,
        createdAt: u.createdAt,
        theses: u._count.documents,
      })),
      ai: {
        costInr,
        budgetInr: budget.ceilingInr,
        averagePerActiveStudentInr: perUser.length
          ? Math.round((costInr / perUser.length) * 100) / 100
          : 0,
        highestStudentInr: perUser.length ? Math.max(...perUser) : 0,
        studentCeilingInr: MONTHLY_CEILING_INR,
      },
      jobs: {
        failed: jobs.reduce((n, q) => n + q.failed, 0),
        waiting: jobs.reduce((n, q) => n + q.waiting, 0),
        running: jobs.reduce((n, q) => n + q.active, 0),
      },
      feedback: {
        unread: Number(feedbackRows[0]?.unread ?? 0),
        lastAt: feedbackRows[0]?.last ?? null,
      },
      holdings: {
        theses,
        chapters,
        words: words._sum.wordCount ?? 0,
        papers: sources,
        uploadedFiles: uploads + seedUploads,
        storageBytes: storage?.bytes ?? null,
        storageFiles: storage?.files ?? null,
        storageByKind: storage?.byPrefix ?? null,
        databaseBytes: Number(dbSize[0]?.bytes ?? 0),
      },
    };
  }

  /** The two numbers the sidebar shows beside its links. Cheap: no bucket walk. */
  async badges() {
    const [jobs, feedback] = await Promise.all([
      this.jobCounts(),
      this.prisma.$queryRaw<Array<{ unread: bigint }>>`
        SELECT COUNT(*) AS unread
        FROM "AuditEvent" a LEFT JOIN "FeedbackState" f ON f."auditEventId" = a."id"
        WHERE a."kind" = 'FEEDBACK' AND f."readAt" IS NULL`,
    ]);
    return {
      failedJobs: jobs.reduce((n, q) => n + q.failed, 0),
      unreadFeedback: Number(feedback[0]?.unread ?? 0),
    };
  }

  private async storageTotals() {
    if (this.storageCache && Date.now() - this.storageCache.at < STORAGE_CACHE_MS) {
      return this.storageCache.value;
    }
    try {
      const value = await this.storage.totals();
      this.storageCache = { at: Date.now(), value };
      return value;
    } catch {
      // The overview is still worth showing with the storage tile blank.
      return null;
    }
  }

  /** Every administrator action and sensitive change, newest first, a page at a time. */
  async activity(filters: ActivityFilters, now: Date = new Date()) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: Prisma.AuditEventWhereInput = filters.kind
      ? { kind: filters.kind }
      : { kind: { notIn: NOISY_KINDS } };
    if (filters.days) where.createdAt = { gte: new Date(now.getTime() - filters.days * DAY) };
    const q = filters.q?.trim();
    if (q) {
      const matches = await this.prisma.user.findMany({
        where: { email: { contains: q, mode: 'insensitive' } },
        select: { id: true },
        take: 200,
      });
      const ids = matches.map((m) => m.id);
      where.OR = [{ userId: { in: ids } }, { actorId: { in: ids } }];
    }

    const [total, events, kinds] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          kind: true,
          userId: true,
          actorId: true,
          documentId: true,
          detail: true,
          createdAt: true,
        },
      }),
      this.prisma.auditEvent.groupBy({ by: ['kind'], _count: { _all: true } }),
    ]);

    const ids = [
      ...new Set(
        events.flatMap((e) => [e.userId, e.actorId]).filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, email: true },
        })
      : [];
    const email = new Map(users.map((u) => [u.id, u.email]));

    return {
      rows: events.map((e) => ({
        ...e,
        userEmail: e.userId ? (email.get(e.userId) ?? null) : null,
        actorEmail: e.actorId ? (email.get(e.actorId) ?? null) : null,
      })),
      total,
      limit,
      offset,
      kinds: kinds.map((k) => k.kind).sort(),
    };
  }

  private async jobCounts() {
    return Promise.all(
      QUEUE_NAMES.filter((name) => name !== 'noop').map(async (name) => {
        try {
          const c = await this.queues.counts(name);
          return {
            queue: name,
            waiting: (c.waiting ?? 0) + (c.prioritized ?? 0),
            active: c.active ?? 0,
            delayed: c.delayed ?? 0,
            completed: c.completed ?? 0,
            failed: c.failed ?? 0,
            reachable: true,
          };
        } catch {
          return {
            queue: name,
            waiting: 0,
            active: 0,
            delayed: 0,
            completed: 0,
            failed: 0,
            reachable: false,
          };
        }
      }),
    );
  }

  /** Each queue's counts and the most recent failures across all of them. */
  async jobs() {
    const queues = await this.jobCounts();
    const failures = (
      await Promise.all(
        queues
          .filter((q) => q.failed > 0)
          .map(async (q) =>
            (
              await this.queues.failed(q.queue as QueueName, 20)
            ).map((f) => ({
              ...f,
              queue: q.queue,
            })),
          ),
      )
    )
      .flat()
      .sort((a, b) => (b.failedAt ?? 0) - (a.failedAt ?? 0))
      .slice(0, 50);

    const ids = [...new Set(failures.map((f) => f.userId).filter((id): id is string => !!id))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, email: true },
        })
      : [];
    const email = new Map(users.map((u) => [u.id, u.email]));
    return {
      queues,
      failed: failures.map((f) => ({
        ...f,
        userEmail: f.userId ? (email.get(f.userId) ?? null) : null,
      })),
    };
  }

  async retryJob(queue: string, jobId: string) {
    const name = this.queueName(queue);
    if (!(await this.queues.retry(name, jobId))) throw new NotFoundError('That failed job');
    return { retried: 1 };
  }

  async retryAll() {
    let retried = 0;
    for (const q of await this.jobCounts()) {
      if (q.failed > 0) retried += await this.queues.retryAll(q.queue as QueueName);
    }
    return { retried };
  }

  private queueName(queue: string): QueueName {
    if (!(QUEUE_NAMES as readonly string[]).includes(queue)) throw new NotFoundError('That queue');
    return queue as QueueName;
  }

  /** What students sent from the Feedback button, newest first. */
  async feedback(options: { status?: 'unread' | 'all'; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const read = await this.prisma.feedbackState.findMany({
      where: { readAt: { not: null } },
      select: { auditEventId: true },
    });
    const where: Prisma.AuditEventWhereInput = { kind: 'FEEDBACK' };
    if (options.status === 'unread' && read.length) {
      where.id = { notIn: read.map((r) => r.auditEventId) };
    }
    const [total, events] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: { id: true, userId: true, documentId: true, detail: true, createdAt: true },
      }),
    ]);
    const eventIds = events.map((e) => e.id);
    const userIds = [...new Set(events.map((e) => e.userId).filter((id): id is string => !!id))];
    const docIds = [...new Set(events.map((e) => e.documentId).filter((id): id is string => !!id))];
    const [states, users, docs] = await Promise.all([
      this.prisma.feedbackState.findMany({ where: { auditEventId: { in: eventIds } } }),
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      }),
      this.prisma.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, title: true },
      }),
    ]);
    const state = new Map(states.map((s) => [s.auditEventId, s]));
    const user = new Map(users.map((u) => [u.id, u]));
    const doc = new Map(docs.map((d) => [d.id, d.title]));
    return {
      rows: events.map((e) => {
        const detail = (e.detail ?? {}) as { message?: string; page?: string | null };
        const s = state.get(e.id);
        const u = e.userId ? user.get(e.userId) : undefined;
        return {
          id: e.id,
          createdAt: e.createdAt,
          message: detail.message ?? '',
          page: detail.page ?? null,
          userId: e.userId,
          userEmail: u?.email ?? null,
          userName: u?.name ?? null,
          documentId: e.documentId,
          documentTitle: e.documentId ? (doc.get(e.documentId) ?? null) : null,
          readAt: s?.readAt ?? null,
          answeredAt: s?.answeredAt ?? null,
        };
      }),
      total,
      limit,
      offset,
    };
  }

  async markFeedback(
    actorId: string,
    id: string,
    mark: 'read' | 'unread' | 'answered',
    now: Date = new Date(),
  ) {
    const event = await this.prisma.auditEvent.findFirst({
      where: { id, kind: 'FEEDBACK' },
      select: { id: true },
    });
    if (!event) throw new NotFoundError('That feedback');
    const data =
      mark === 'unread'
        ? { readAt: null, answeredAt: null, answeredBy: null }
        : mark === 'answered'
          ? { readAt: now, answeredAt: now, answeredBy: actorId }
          : { readAt: now };
    return this.prisma.feedbackState.upsert({
      where: { auditEventId: id },
      create: { auditEventId: id, ...data },
      update: data,
    });
  }
}
