/**
 * Examiner review — ADR-0056. Starts a review of one chapter (one `EXAMINER_REVIEW` unit, taken
 * atomically before the job is queued) and reports its state. The worker reads the chapter, asks
 * the examiner section by section, writes the `EXAMINER` flags and owns the record's terminal
 * state; the flags are served by the coherence flags endpoint, beside the coherence run's.
 *
 * The record lives in `Document.meta.examinerReviews[chapterId]`, the way a coherence run's lives
 * in `meta.coherenceRuns`: one per chapter, the latest.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EXAMINER_REVIEW, ownSentenceCount } from '@tc/ai';
import type { Plan } from '@tc/config';
import type { Prisma } from '@tc/db';
import { type ExaminerReviewRecord, jobId } from '@tc/types';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { refusal, UsageService } from '../usage/usage.service.js';

/**
 * A record still QUEUED or RUNNING after this long did not finish: eight sections at three at a
 * time, each call capped at three minutes, is nine minutes at worst. Shown as failed, and the
 * student may start again.
 */
export const EXAMINER_REVIEW_STALE_MS = 30 * 60_000;

export type ExaminerReviewView = {
  status: 'NONE' | ExaminerReviewRecord['status'];
  runId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** True when the chapter was saved after the review read it: its flags may have moved. */
  chapterChanged: boolean;
  sections: number | null;
  sectionsReviewed: number | null;
  failedSections: string[];
  issues: number | null;
  blocking: number | null;
  error: string | null;
};

export function readExaminerReviews(meta: unknown): Record<string, ExaminerReviewRecord> {
  const value = (meta as { examinerReviews?: unknown } | null)?.examinerReviews;
  return value && typeof value === 'object' ? (value as Record<string, ExaminerReviewRecord>) : {};
}

/** A queued or running record that has been at it for longer than any review can take. */
export function isStale(record: ExaminerReviewRecord, now: Date = new Date()): boolean {
  if (record.status !== 'QUEUED' && record.status !== 'RUNNING') return false;
  const started = Date.parse(record.startedAt);
  return Number.isNaN(started) || now.getTime() - started > EXAMINER_REVIEW_STALE_MS;
}

@Injectable()
export class ExaminerReviewService {
  private readonly logger = new Logger(ExaminerReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly usage: UsageService,
  ) {}

  /** The chapter, if the signed-in user owns its thesis. A co-author or a guide does not. */
  private async owned(ownerId: string, chapterId: string) {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: {
        id: true,
        documentId: true,
        content: true,
        version: true,
        document: { select: { meta: true } },
      },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    return chapter;
  }

  private async writeRecord(
    documentId: string,
    chapterId: string,
    record: ExaminerReviewRecord,
  ): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { meta: true },
    });
    const meta = (document?.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        meta: {
          ...meta,
          examinerReviews: { ...readExaminerReviews(meta), [chapterId]: record },
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Refusals first, for nothing: a review already running, a chapter unchanged since a complete
   * review, a chapter with fewer than three sentences of the student's own. Then one unit, then
   * the job — and the unit back if the job could not be queued.
   */
  async start(user: SessionUser, chapterId: string): Promise<ExaminerReviewView> {
    const chapter = await this.owned(user.id, chapterId);
    const previous = readExaminerReviews(chapter.document.meta)[chapterId];

    if (previous && (previous.status === 'QUEUED' || previous.status === 'RUNNING')) {
      if (!isStale(previous)) {
        throw new ConflictError('An examiner review of this chapter is already running.');
      }
    }
    if (
      previous?.status === 'DONE' &&
      previous.version === chapter.version &&
      (previous.failedSections ?? []).length === 0
    ) {
      throw new ConflictError(
        'This chapter has not changed since its last examiner review. Its flags are in the list below.',
      );
    }
    if (ownSentenceCount(chapter.content) < EXAMINER_REVIEW.minSentences) {
      throw new ValidationError(
        'Write at least three sentences of your own in this chapter before asking for an examiner review. AI drafts waiting for your decision do not count.',
      );
    }

    const cap = await this.usage.consume(user.id, user.plan as Plan, 'EXAMINER_REVIEW');
    if (!cap.ok) throw refusal('EXAMINER_REVIEW', cap);

    // The job id keys on what the job reads: this chapter as saved at this version. A deliberate
    // second review of the same version (the last one failed, or left sections out) is a new
    // attempt, so BullMQ does not swallow it as a duplicate.
    const attempt = previous && previous.version === chapter.version ? previous.attempt + 1 : 0;
    const record: ExaminerReviewRecord = {
      runId: randomUUID(),
      status: 'QUEUED',
      version: chapter.version,
      attempt,
      startedAt: new Date().toISOString(),
    };
    await this.writeRecord(chapter.documentId, chapterId, record);

    try {
      await this.queue.enqueue(
        'examiner-review',
        {
          documentId: chapter.documentId,
          chapterId,
          userId: user.id,
          runId: record.runId,
          version: chapter.version,
        },
        { jobId: jobId('examiner-review', chapterId, `v${chapter.version}`, `a${attempt}`) },
      );
    } catch (error) {
      await this.usage.refund(user.id, 'EXAMINER_REVIEW');
      await this.writeRecord(chapter.documentId, chapterId, {
        ...record,
        status: 'FAILED',
        finishedAt: new Date().toISOString(),
        error: 'The review could not be started. Your allowance was not used.',
      });
      this.logger.error({ chapterId, error: String(error) }, 'examiner review not queued');
      throw error;
    }
    this.logger.log(
      { documentId: chapter.documentId, chapterId, runId: record.runId, attempt },
      'examiner review queued',
    );
    return this.view(record, chapter.version);
  }

  async status(ownerId: string, chapterId: string): Promise<ExaminerReviewView> {
    const chapter = await this.owned(ownerId, chapterId);
    const record = readExaminerReviews(chapter.document.meta)[chapterId];
    return this.view(record, chapter.version);
  }

  private view(record: ExaminerReviewRecord | undefined, version: number): ExaminerReviewView {
    if (!record) {
      return {
        status: 'NONE',
        runId: null,
        startedAt: null,
        finishedAt: null,
        chapterChanged: false,
        sections: null,
        sectionsReviewed: null,
        failedSections: [],
        issues: null,
        blocking: null,
        error: null,
      };
    }
    const stale = isStale(record);
    return {
      status: stale ? 'FAILED' : record.status,
      runId: record.runId,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      chapterChanged: record.status === 'DONE' && record.version !== version,
      sections: record.sections ?? null,
      sectionsReviewed: record.sectionsReviewed ?? null,
      failedSections: record.failedSections ?? [],
      issues: record.issues ?? null,
      blocking: record.blocking ?? null,
      error: stale ? 'The review did not finish. You can start it again.' : (record.error ?? null),
    };
  }
}
