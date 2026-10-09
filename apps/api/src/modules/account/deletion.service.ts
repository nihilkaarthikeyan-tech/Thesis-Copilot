/**
 * Account deletion — PRD §12.2: "hard-delete documents, sources, chunks, files within 30 days;
 * keep billing records as required by law."
 *
 * Two steps, because §12.2 allows thirty days and the days are worth having.
 *
 * `request` marks the account and signs every device out. `erase` is what actually destroys
 * things, and `DeletionScheduler` calls it once the grace period has passed. In between the
 * student can `cancel` and lose nothing.
 *
 * The grace period is not administrative slack. Sign-in here is a six-digit code emailed to an
 * address (PRD §7.2 — there is no password), so anybody who reads one email can ask for an
 * account to be erased. Against an irreversible action that is too thin a defence on its own; a
 * week in which the real owner gets an email and can undo it is the rest of it.
 *
 * **What survives, and why.** The `User` row itself is kept and stripped rather than deleted:
 * §12.2 requires billing records to be retained, `Subscription` and the `AuditEvent` trail both
 * have foreign keys into `User`, and a payment record pointing at nothing proves nothing to a tax
 * officer. So the row stays with its email replaced by an address nobody can receive mail at, its
 * name gone, and `deletedAt` set. Everything that is the student's *work* is deleted outright.
 *
 * Deliberately not a Prisma cascade. A cascade would be shorter, but it would also delete whatever
 * anyone adds to `Document` later without anybody thinking about whether it should be — including,
 * one day, something we are required to keep. This list is meant to be read and argued with.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import { DocumentEraser } from '../../common/document-eraser.service.js';
import { ENV } from '../../common/env.token.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

/**
 * Days between the request and the erasure.
 *
 * Seven, not thirty. §12.2's thirty days is a deadline to finish by, not a period to wait out, and
 * the nightly backups are themselves kept for thirty days — so erasing on day 7 means the last
 * copy of the student's text leaves the backups around day 37, while erasing on day 30 would push
 * that to day 60 and break the promise on the privacy page.
 */
export const DELETION_GRACE_DAYS = 7;

export type DeletionStatus = {
  readonly requestedAt: Date | null;
  readonly erasesAt: Date | null;
  readonly graceDays: number;
};

/** The address left on an erased row. Unroutable by RFC 2606, and obviously not a real person. */
export function tombstoneEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

export function erasesAt(requestedAt: Date, graceDays = DELETION_GRACE_DAYS): Date {
  return new Date(requestedAt.getTime() + graceDays * 24 * 60 * 60_000);
}

@Injectable()
export class DeletionService {
  private readonly logger = new Logger(DeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eraser: DocumentEraser,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async status(userId: string): Promise<DeletionStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletionRequestedAt: true },
    });
    if (!user) throw new NotFoundError('No such account');
    return {
      requestedAt: user.deletionRequestedAt,
      erasesAt: user.deletionRequestedAt ? erasesAt(user.deletionRequestedAt) : null,
      graceDays: DELETION_GRACE_DAYS,
    };
  }

  /**
   * Ask for the account to be erased.
   *
   * Signs every device out in the same transaction. That is not tidiness: the student has just
   * said they are leaving, and if the request was not theirs, the session that made it is the one
   * thing that must not survive it.
   */
  async request(
    userId: string,
    now: Date = new Date(),
    actorId: string | null = null,
  ): Promise<DeletionStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletionRequestedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundError('No such account');
    if (user.deletionRequestedAt) {
      // Idempotent rather than an error: two taps on a slow connection should not read as a
      // failure, and the date must not move — that would let a request be postponed forever.
      return {
        requestedAt: user.deletionRequestedAt,
        erasesAt: erasesAt(user.deletionRequestedAt),
        graceDays: DELETION_GRACE_DAYS,
      };
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { deletionRequestedAt: now } }),
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.auditEvent.create({
        data: { kind: 'DELETION_REQUESTED', userId, actorId, detail: { erasesAt: erasesAt(now) } },
      }),
    ]);

    this.logger.log({ userId, erasesAt: erasesAt(now) }, 'account deletion requested');
    return { requestedAt: now, erasesAt: erasesAt(now), graceDays: DELETION_GRACE_DAYS };
  }

  /** Change of mind, any time before the scheduler gets to it. */
  async cancel(userId: string, actorId: string | null = null): Promise<DeletionStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletionRequestedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundError('No such account');
    if (!user.deletionRequestedAt) throw new ConflictError('No deletion is pending');

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { deletionRequestedAt: null } }),
      this.prisma.auditEvent.create({
        data: { kind: 'DELETION_CANCELLED', userId, actorId, detail: {} },
      }),
    ]);

    this.logger.log({ userId }, 'account deletion cancelled');
    return { requestedAt: null, erasesAt: null, graceDays: DELETION_GRACE_DAYS };
  }

  /** Accounts whose grace period has run out. */
  async due(now: Date = new Date()): Promise<string[]> {
    const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 24 * 60 * 60_000);
    const rows = await this.prisma.user.findMany({
      where: { deletionRequestedAt: { not: null, lte: cutoff }, deletedAt: null },
      select: { id: true },
      take: 100,
    });
    return rows.map((r) => r.id);
  }

  /**
   * Erase one account's content. Idempotent: a second run on an erased row does nothing.
   *
   * Files first, database second. If this dies halfway, a re-run finds the rows still there and
   * deletes the files again — harmless, `remove` tolerates a missing key. The other order would
   * leave objects in the bucket with nothing left to say they exist, which is the one outcome
   * §12.2 actually forbids.
   */
  async erase(userId: string, now: Date = new Date()): Promise<{ files: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) return { files: 0 };

    const documents = await this.prisma.document.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });
    const documentIds = documents.map((d) => d.id);

    // The shared eraser (2026-09-29) also removes figures and version snapshots, which this path
    // used to leave in the bucket after the account was gone.
    const files = documentIds.length > 0 ? await this.eraser.removeFiles(documentIds) : 0;

    await this.prisma.$transaction(async (tx) => {
      await this.eraser.deleteRows(tx, documentIds);

      // Not document-scoped, and all of it is the student's behaviour rather than their money.
      await tx.aiCallLog.deleteMany({ where: { userId } });
      await tx.usageLedger.deleteMany({ where: { userId } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      // The student's own words (ADR-0019), not a billing record.
      await tx.savedPrompt.deleteMany({ where: { userId } });
      // ADR-0132: research questions asked with no thesis, and their answers.
      await tx.researchChat.deleteMany({ where: { userId } });

      // Kept: Subscription and AuditEvent. §12.2's "billing records as required by law", and the
      // proof that this erasure was asked for and carried out.
      await tx.user.update({
        where: { id: userId },
        data: {
          email: tombstoneEmail(userId),
          name: null,
          image: null,
          settings: undefined,
          institutionId: null,
          deletedAt: now,
          deletionRequestedAt: null,
        },
      });
      await tx.auditEvent.create({
        data: {
          kind: 'DELETION_COMPLETED',
          userId,
          detail: { documents: documentIds.length, files },
        },
      });
    });

    this.logger.log({ userId, documents: documentIds.length, files }, 'account erased');
    return { files };
  }

  /** Whether the API is configured such that erasure can run at all. Read by /health. */
  get configured(): boolean {
    return Boolean(this.env.S3_BUCKET);
  }
}
