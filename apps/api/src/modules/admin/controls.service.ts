/**
 * What a superadmin can do to an account and its work (2026-09-29, the owner's approved design).
 *
 * Every method here writes an `AuditEvent` with the admin as `actorId`, so the Activity log can
 * say who did what. Two rules the design settled:
 *
 * - An admin may read a thesis, never change it. Each read is logged, and the student is emailed
 *   when an admin opens it (the privacy page says so).
 * - An admin cannot suspend, sign out or delete their own account from here: with one
 *   administrator that locks everybody out, and the database is the only way back.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Env, type MeteredAction } from '@tc/config';
import { DocumentEraser } from '../../common/document-eraser.service.js';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { withFreshFigureLinks } from '../../common/figure-links.js';
import { MAILER, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';
import { DeletionService } from '../account/deletion.service.js';
import { UsageService } from '../usage/usage.service.js';
import { thesisDeletedMail, thesisViewedMail } from './admin-mail.js';

/**
 * A second open of the same thesis by the same admin inside this window is logged but not mailed
 * again: a page refresh is not a second visit, and ten identical emails would read as an alarm.
 */
export const VIEW_MAIL_WINDOW_MS = 10 * 60 * 1000;

type Grant = { action: MeteredAction; units: number };

@Injectable()
export class AdminControlsService {
  private readonly logger = new Logger(AdminControlsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly deletion: DeletionService,
    private readonly eraser: DocumentEraser,
    private readonly storage: StorageService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async target(actorId: string, userId: string, verb: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, deletedAt: true, suspendedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundError('That user');
    if (user.id === actorId) {
      throw new ValidationError(`You cannot ${verb} your own account from here.`);
    }
    return user;
  }

  /** Signed out everywhere and unable to sign in again until unsuspended. Nothing is deleted. */
  async suspend(actorId: string, userId: string, reason: string, now: Date = new Date()) {
    const user = await this.target(actorId, userId, 'suspend');
    if (user.suspendedAt) return { suspendedAt: user.suspendedAt };
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { suspendedAt: now, suspendedReason: reason },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.auditEvent.create({
        data: { kind: 'USER_SUSPENDED', userId, actorId, detail: { reason } },
      }),
    ]);
    return { suspendedAt: now };
  }

  async unsuspend(actorId: string, userId: string) {
    const user = await this.target(actorId, userId, 'unsuspend');
    if (!user.suspendedAt) return { suspendedAt: null };
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { suspendedAt: null, suspendedReason: null },
      }),
      this.prisma.auditEvent.create({
        data: { kind: 'USER_UNSUSPENDED', userId, actorId, detail: {} },
      }),
    ]);
    return { suspendedAt: null };
  }

  /** Ends every session the account has. They can sign straight back in. */
  async signOutEverywhere(actorId: string, userId: string) {
    await this.target(actorId, userId, 'sign out');
    const [removed] = await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.auditEvent.create({
        data: { kind: 'SESSIONS_REVOKED', userId, actorId, detail: {} },
      }),
    ]);
    return { sessions: removed.count };
  }

  /** Extra units this month, on top of the plan. One audit row per action given. */
  async grantAllowance(actorId: string, userId: string, grants: Grant[], reason: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundError('That user');
    const given = grants.filter((g) => g.units > 0);
    if (given.length === 0) throw new ValidationError('Give at least one extra unit.');
    const results = [];
    for (const grant of given) {
      results.push(await this.usage.grantBonus(actorId, userId, grant.action, grant.units, reason));
    }
    return { granted: results };
  }

  /** Starts the same seven-day deletion a student can start, logged as the admin's. */
  async requestDeletion(actorId: string, userId: string) {
    await this.target(actorId, userId, 'delete');
    return this.deletion.request(userId, new Date(), actorId);
  }

  async cancelDeletion(actorId: string, userId: string) {
    return this.deletion.cancel(userId, actorId);
  }

  /**
   * A thesis, read-only, for an administrator. Logged every time; the student is emailed unless
   * this admin opened it within the last few minutes.
   */
  async viewThesis(actorId: string, documentId: string, now: Date = new Date()) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        citationStyle: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, email: true, name: true } },
        chapters: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true, wordCount: true, wordCounts: true },
        },
        _count: { select: { sources: true, shares: true } },
      },
    });
    if (!document) throw new NotFoundError('That thesis');

    const recent = await this.prisma.auditEvent.findFirst({
      where: {
        kind: 'THESIS_VIEWED',
        actorId,
        documentId,
        createdAt: { gte: new Date(now.getTime() - VIEW_MAIL_WINDOW_MS) },
        detail: { path: ['emailed'], equals: true },
      },
      select: { id: true },
    });
    const emailStudent = !recent && document.owner.id !== actorId;
    await this.prisma.auditEvent.create({
      data: {
        kind: 'THESIS_VIEWED',
        userId: document.owner.id,
        actorId,
        documentId,
        detail: { title: document.title, emailed: emailStudent },
      },
    });
    if (emailStudent) {
      // Not awaited: the admin should not wait on a mail server to read the page, and the view
      // is already logged. A failure is logged too; it must not make the visit look unrecorded.
      void this.mailer
        .send(
          thesisViewedMail({
            to: document.owner.email,
            name: document.owner.name,
            title: document.title,
            at: now,
            appUrl: this.env.APP_URL,
          }),
        )
        .catch((error: unknown) =>
          this.logger.error(
            { documentId, error },
            'could not email the student about a thesis view',
          ),
        );
    }

    let words = 0;
    let written = 0;
    for (const chapter of document.chapters) {
      words += chapter.wordCount;
      const counts = (chapter.wordCounts ?? {}) as Record<string, number>;
      written += (counts.HUMAN ?? 0) + (counts.HUMAN_EDITED ?? 0);
    }
    const counted = document.chapters.reduce((sum, c) => {
      const counts = (c.wordCounts ?? {}) as Record<string, number>;
      return sum + Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
    }, 0);

    return {
      id: document.id,
      title: document.title,
      citationStyle: document.citationStyle,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      owner: document.owner,
      words,
      writtenByStudentShare: counted > 0 ? Math.round((written / counted) * 100) : null,
      sources: document._count.sources,
      shares: document._count.shares,
      // True for a refresh inside the window too: the student was told about this visit.
      studentEmailed: document.owner.id !== actorId,
      chapters: document.chapters.map(({ wordCounts: _omit, ...c }) => c),
    };
  }

  /** One chapter's content for the read-only view, with fresh figure links. Logged. */
  async viewChapter(actorId: string, documentId: string, chapterId: string) {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, documentId },
      select: {
        id: true,
        title: true,
        order: true,
        content: true,
        documentId: true,
        document: { select: { ownerId: true } },
      },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    await this.prisma.auditEvent.create({
      data: {
        kind: 'CHAPTER_VIEWED',
        userId: chapter.document.ownerId,
        actorId,
        documentId,
        detail: { chapterId, title: chapter.title },
      },
    });
    await withFreshFigureLinks(chapter.content, documentId, (key) => this.storage.signedUrl(key));

    // "(Goel, 2016)" for each cited source. The student's own style is rendered by citeproc in
    // the editor; an administrator reading for support needs only to see who is cited.
    const sourceIds = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; attrs?: { sourceId?: unknown }; content?: unknown[] };
      if (n.type === 'citation' && typeof n.attrs?.sourceId === 'string') {
        sourceIds.add(n.attrs.sourceId);
      }
      for (const child of n.content ?? []) walk(child);
    };
    walk(chapter.content);
    const sources = sourceIds.size
      ? await this.prisma.source.findMany({
          where: { id: { in: [...sourceIds] }, documentId },
          select: { id: true, authors: true, year: true, title: true },
        })
      : [];
    const citeLabels = Object.fromEntries(
      sources.map((s) => {
        const authors = Array.isArray(s.authors) ? (s.authors as Array<{ family?: string }>) : [];
        const first = authors[0]?.family ?? s.title?.split(/\s+/).slice(0, 3).join(' ') ?? 'Source';
        const who =
          authors.length > 2
            ? `${first} et al.`
            : authors.length === 2
              ? `${first} & ${authors[1]?.family ?? ''}`
              : first;
        return [s.id, `${who}, ${s.year ?? 'n.d.'}`];
      }),
    );
    return {
      id: chapter.id,
      title: chapter.title,
      order: chapter.order,
      content: chapter.content,
      citeLabels,
    };
  }

  /** Removes a thesis for good and tells its owner why. */
  async deleteThesis(actorId: string, documentId: string, reason: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, title: true, owner: { select: { id: true, email: true, name: true } } },
    });
    if (!document) throw new NotFoundError('That thesis');
    const { files } = await this.eraser.erase([documentId]);
    await this.prisma.auditEvent.create({
      data: {
        kind: 'DOCUMENT_DELETED',
        userId: document.owner.id,
        actorId,
        documentId,
        detail: { title: document.title, reason, files, by: 'admin' },
      },
    });
    if (document.owner.id !== actorId) {
      void this.mailer
        .send(
          thesisDeletedMail({
            to: document.owner.email,
            name: document.owner.name,
            title: document.title,
            reason,
            appUrl: this.env.APP_URL,
          }),
        )
        .catch((error: unknown) =>
          this.logger.error({ documentId, error }, 'could not email the student about a deletion'),
        );
    }
    return { deleted: true, files };
  }
}
