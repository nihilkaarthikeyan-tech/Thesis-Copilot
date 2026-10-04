/**
 * Coherence runs and flags — PRD §5.6, Appendix D.1, §11.3 (`COHERENCE` cap), PHASES v2 B1.2, B1.8.
 *
 * The API starts a run and reads its flags; the worker does the checking. One run costs one cap
 * unit "regardless of size" (D.1.1), which is why the cap is taken here, once, rather than per
 * call inside the job — a thesis with nine changed chapters must not cost nine units.
 *
 * A run triggered by a guide's feedback round is not charged (D.2.4): the student did not ask for
 * it, so it does not spend their allowance.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { COHERENCE } from '@tc/ai';
import type { Plan } from '@tc/config';
import { jobId } from '@tc/types';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { readExaminerReviews } from './examiner-review.service.js';

/** D.1.1: the autosave hook may start a run at most this often. */
export const AUTOSAVE_INTERVAL_MS = 15 * 60_000;
/** The most flags one read returns; the list is most severe first, so nothing urgent is cut. */
const COHERENCE_FLAGS_MAX = 500;

export type CoherenceRunView = {
  runId: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  error: string | null;
  totals: Record<string, number> | null;
  reducedScope: boolean;
  skipped: string | null;
};

export type FlagView = {
  id: string;
  chapterId: string;
  chapterTitle: string;
  relatedChapterId: string | null;
  relatedChapterTitle: string | null;
  type: string;
  severity: string;
  description: string;
  /** The examiner's correction (ADR-0056); null for the coherence checks, which offer none. */
  suggestion: string | null;
  from: number;
  to: number;
  status: string;
  ignoreReason: string | null;
  createdAt: string;
  /** False when the chapter changed after the run: D.1.3's "location moved — re-run". */
  positionTrusted: boolean;
};

type RunRecord = {
  runId: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  startedAt: string;
  finishedAt?: string;
  triggeredBy: string;
  error?: string;
  totals?: Record<string, number>;
  reducedScope?: boolean;
  skipped?: string;
};

@Injectable()
export class CoherenceService {
  private readonly logger = new Logger(CoherenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly usage: UsageService,
  ) {}

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, meta: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  private runs(meta: unknown): Record<string, RunRecord> {
    return ((meta as { coherenceRuns?: Record<string, RunRecord> } | null)?.coherenceRuns ??
      {}) as Record<string, RunRecord>;
  }

  /**
   * D.1.1 step 1. `MANUAL` and `AUTOSAVE` cost a cap unit; `FEEDBACK` does not (D.2.4). The
   * autosave trigger also refuses to start inside fifteen minutes of the last run.
   */
  async start(
    user: SessionUser,
    documentId: string,
    triggeredBy: 'MANUAL' | 'AUTOSAVE' | 'FEEDBACK' = 'MANUAL',
  ): Promise<{ runId: string; charged: boolean }> {
    const document = await this.owned(user.id, documentId);
    const runs = Object.values(this.runs(document.meta));
    const running = runs.find((r) => r.status === 'RUNNING');
    if (running) throw new ConflictError('A coherence check is already running on this thesis.');

    if (triggeredBy === 'AUTOSAVE') {
      const last = runs
        .map((r) => Date.parse(r.startedAt))
        .filter((t) => !Number.isNaN(t))
        .sort((a, b) => b - a)[0];
      if (last && Date.now() - last < AUTOSAVE_INTERVAL_MS) {
        throw new ConflictError('The last check was less than fifteen minutes ago.');
      }
    }

    const charged = triggeredBy !== 'FEEDBACK';
    if (charged) {
      const cap = await this.usage.consume(user.id, user.plan as Plan, 'COHERENCE');
      if (!cap.ok) throw refusal('COHERENCE', cap);
    }

    const runId = randomUUID();
    const record: RunRecord = {
      runId,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      triggeredBy,
    };
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: { meta: { ...meta, coherenceRuns: { ...this.runs(meta), [runId]: record } } },
    });

    await this.queue.enqueue(
      'coherence',
      { documentId, userId: user.id, runId, triggeredBy },
      { jobId: jobId('coherence', documentId, runId) },
    );
    this.logger.log({ documentId, runId, triggeredBy, charged }, 'coherence run queued');
    return { runId, charged };
  }

  async run(ownerId: string, documentId: string, runId: string): Promise<CoherenceRunView> {
    const document = await this.owned(ownerId, documentId);
    const record = this.runs(document.meta)[runId];
    if (!record) throw new NotFoundError('That run');
    return {
      runId: record.runId,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      triggeredBy: record.triggeredBy,
      error: record.error ?? null,
      totals: record.totals ?? null,
      reducedScope: record.reducedScope ?? false,
      skipped: record.skipped ?? null,
    };
  }

  /** Called by the SSE endpoint when the worker's `run-done` arrives. */
  async finish(
    documentId: string,
    runId: string,
    totals: Record<string, number>,
    extra: { reducedScope?: boolean; skipped?: string; error?: string } = {},
  ): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { meta: true },
    });
    const meta = (document?.meta as Record<string, unknown> | null) ?? {};
    const runs = this.runs(meta);
    const record = runs[runId];
    if (!record) return;
    runs[runId] = {
      ...record,
      status: extra.error ? 'FAILED' : 'DONE',
      finishedAt: new Date().toISOString(),
      totals,
      ...(extra.reducedScope !== undefined ? { reducedScope: extra.reducedScope } : {}),
      ...(extra.skipped ? { skipped: extra.skipped } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    };
    await this.prisma.document.update({
      where: { id: documentId },
      data: { meta: { ...meta, coherenceRuns: runs } },
    });
  }

  /**
   * D.1.3's sidebar: every flag, with the chapter it belongs to and whether its range can still
   * be trusted. A chapter edited after the run has moved its own text, so the flag says
   * "location moved — re-run" rather than scrolling the student to the wrong sentence.
   */
  async flags(
    ownerId: string,
    documentId: string,
    status: 'OPEN' | 'ALL' = 'OPEN',
  ): Promise<{ flags: FlagView[]; counts: Record<string, number>; lastRunAt: string | null }> {
    const document = await this.owned(ownerId, documentId);
    const reviews = readExaminerReviews(document.meta);
    const [rows, chapters] = await Promise.all([
      this.prisma.coherenceFlag.findMany({
        where: { documentId, ...(status === 'OPEN' ? { status: 'OPEN' } : {}) },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        // Ignored and resolved flags are kept, so `ALL` only grows; bounded like any list (2026-09-28).
        take: COHERENCE_FLAGS_MAX,
      }),
      this.prisma.chapter.findMany({
        where: { documentId },
        select: {
          id: true,
          title: true,
          order: true,
          updatedAt: true,
          lastCheckedAt: true,
          version: true,
        },
      }),
    ]);
    const byId = new Map(chapters.map((c) => [c.id, c]));

    const flags: FlagView[] = rows.map((row) => {
      const chapter = byId.get(row.chapterId);
      const related = row.relatedChapterId ? byId.get(row.relatedChapterId) : undefined;
      // An examiner flag (ADR-0056) belongs to its chapter's last review, not to the coherence
      // run's `lastCheckedAt`: its range holds while the chapter is the version that review read.
      const review = reviews[row.chapterId];
      const moved =
        row.type === 'EXAMINER'
          ? !(review && review.runId === row.runId && review.version === chapter?.version)
          : chapter?.lastCheckedAt
            ? chapter.updatedAt > chapter.lastCheckedAt
            : true;
      return {
        id: row.id,
        chapterId: row.chapterId,
        chapterTitle: chapter?.title ?? 'A deleted chapter',
        relatedChapterId: row.relatedChapterId,
        relatedChapterTitle: related?.title ?? null,
        type: row.type,
        severity: row.severity,
        description: row.description,
        suggestion: row.suggestion ?? null,
        from: row.from,
        to: row.to,
        status: row.status,
        ignoreReason: row.ignoreReason,
        createdAt: row.createdAt.toISOString(),
        positionTrusted: !moved,
      };
    });

    const counts: Record<string, number> = {};
    for (const flag of flags) {
      if (flag.status !== 'OPEN') continue;
      counts[flag.type] = (counts[flag.type] ?? 0) + 1;
      counts.total = (counts.total ?? 0) + 1;
    }
    const lastRunAt = chapters
      .map((c) => c.lastCheckedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return { flags, counts, lastRunAt: lastRunAt?.toISOString() ?? null };
  }

  /**
   * D.1.3's actions. Resolve records that the student fixed it; Ignore suppresses the fingerprint
   * in every future run (ADR-0007), which is why the reason is worth keeping — six weeks later it
   * is the only record of why a flag stopped appearing.
   */
  async act(
    ownerId: string,
    documentId: string,
    flagId: string,
    action: 'RESOLVE' | 'IGNORE' | 'REOPEN',
    reason?: string,
  ): Promise<FlagView> {
    await this.owned(ownerId, documentId);
    const flag = await this.prisma.coherenceFlag.findFirst({ where: { id: flagId, documentId } });
    if (!flag) throw new NotFoundError('That flag');

    const status = action === 'RESOLVE' ? 'RESOLVED' : action === 'IGNORE' ? 'IGNORED' : 'OPEN';
    await this.prisma.coherenceFlag.update({
      where: { id: flagId },
      data: {
        status,
        ignoreReason: action === 'IGNORE' ? reason?.trim() || null : null,
      },
    });
    const { flags } = await this.flags(ownerId, documentId, 'ALL');
    const updated = flags.find((f) => f.id === flagId);
    if (!updated) throw new NotFoundError('That flag');
    return updated;
  }

  /** What the budget guard would estimate for the next run, so the button can say it first. */
  async estimate(
    ownerId: string,
    documentId: string,
  ): Promise<{
    changedChapters: number;
    estimatedInr: number;
    willReduceScope: boolean;
  }> {
    await this.owned(ownerId, documentId);
    const chapters = await this.prisma.chapter.findMany({
      where: { documentId },
      select: { updatedAt: true, lastCheckedAt: true },
    });
    const changed = chapters.filter(
      (c) => !c.lastCheckedAt || c.updatedAt > c.lastCheckedAt,
    ).length;
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { glossary: true },
    });
    const terms = Math.min(
      Object.keys((memory?.glossary as Record<string, unknown> | null) ?? {}).length,
      COHERENCE.maxTerms,
    );
    // The same arithmetic the job uses (§11.2's unit costs), kept in one shape here so the screen
    // and the run cannot disagree about what a check costs.
    const estimatedInr = Number((terms * 2.5 + changed * 3 * 2.5 + changed * 3 * 0.3).toFixed(2));
    return {
      changedChapters: changed,
      estimatedInr,
      willReduceScope: estimatedInr > COHERENCE.budgetInr,
    };
  }
}
