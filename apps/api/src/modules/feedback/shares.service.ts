/**
 * Guide shares — PRD §5.7, Appendix D.2.1, §12.1, PHASES v2 B2.1.
 *
 *   "Opening the link requires sign-in with that email (OTP). On first sign-in the user is created
 *    with role `GUIDE`. A guide sees only documents shared with them, read-only, with comment mode
 *    enabled. Guides never see the AI panels, usage meters, or the student's other documents."
 *
 * The token in the URL is an invitation, not an authorisation: it names which document is on offer
 * and to whom. Access is granted only after the guide signs in as the address the student typed,
 * so a forwarded link gets the recipient an OTP challenge they cannot pass, and a leaked one gets
 * nothing at all.
 */

import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
import { withFreshFigureLinks } from '../../common/figure-links.js';
import { MAILER, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';
import {
  type GuideProgress,
  guideProgress,
  HISTORY_WEEKS,
  shouldBumpVisit,
} from './guide-progress.js';

export type ShareView = {
  id: string;
  guideEmail: string;
  createdAt: string;
  /** Set once the guide has signed in and been bound to the share. */
  acceptedAt: string | null;
  comments: number;
  url: string;
  /** ADR-0028: may open a chapter in the live editor. */
  canEdit: boolean;
  /** On the answer to a new share: whether the invitation e-mail went. False means send the link. */
  mailed?: boolean;
};

/** What a guide is allowed to see about a document they were shared (D.2.1). */
export type GuideDocumentView = {
  documentId: string;
  title: string;
  studentEmail: string;
  chapters: Array<{ id: string; title: string; order: number }>;
  /** ADR-0028: this share lets its holder edit live, not only comment. */
  canEdit: boolean;
  /** The signed-in guide's own address — the name on their cursor. */
  viewerEmail: string;
};

@Injectable()
export class SharesService {
  private readonly logger = new Logger(SharesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StorageService,
  ) {}

  private async ownedDocument(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, title: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  private url(token: string): string {
    return `${this.env.APP_URL.replace(/\/$/, '')}/guide/${token}`;
  }

  async list(ownerId: string, documentId: string): Promise<ShareView[]> {
    await this.ownedDocument(ownerId, documentId);
    const shares = await this.prisma.guideShare.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });
    const counts = await this.prisma.comment.groupBy({
      by: ['authorEmail'],
      where: { documentId },
      _count: { _all: true },
    });
    const byEmail = new Map(counts.map((c) => [c.authorEmail.toLowerCase(), c._count._all]));
    return shares.map((share) => ({
      id: share.id,
      guideEmail: share.guideEmail,
      createdAt: share.createdAt.toISOString(),
      acceptedAt: share.guideUserId ? share.createdAt.toISOString() : null,
      comments: byEmail.get(share.guideEmail.toLowerCase()) ?? 0,
      url: this.url(share.token),
      canEdit: share.canEdit,
    }));
  }

  async create(
    owner: { id: string; email: string },
    documentId: string,
    guideEmail: string,
    canEdit = false,
  ): Promise<ShareView> {
    const document = await this.ownedDocument(owner.id, documentId);
    const email = guideEmail.trim().toLowerCase();
    if (email === owner.email.toLowerCase()) {
      throw new ValidationError('That is your own address.');
    }

    const existing = await this.prisma.guideShare.findFirst({
      where: { documentId, guideEmail: email },
    });
    // Sharing again with the same address changes what they may do, in either direction.
    const share = existing
      ? existing.canEdit === canEdit
        ? existing
        : await this.prisma.guideShare.update({ where: { id: existing.id }, data: { canEdit } })
      : await this.prisma.guideShare.create({
          data: {
            documentId,
            guideEmail: email,
            token: randomBytes(24).toString('base64url'),
            canEdit,
          },
        });

    // The share exists whether or not the mail goes. A provider rate limit (Hostinger's answered
    // 451 to a burst of invitations on 2026-09-24) used to turn into a 500 here, after the row
    // was written — the student saw an error, and the guide they retried got a second email.
    // Now the answer says the mail did not go, and the panel offers the link to send by hand.
    let mailed = true;
    try {
      await this.mailer.send({
        to: [email],
        subject: canEdit
          ? `${owner.email} has invited you to write a thesis chapter with them`
          : `${owner.email} has asked you to review a thesis chapter`,
        text: [
          canEdit
            ? `${owner.email} would like to write “${document.title}” with you, live.`
            : `${owner.email} would like your comments on “${document.title}”.`,
          '',
          this.url(share.token),
          '',
          'The link asks you to sign in with this email address — we send you a six-digit code, there',
          canEdit
            ? 'is no password. You can open a chapter and type alongside them, and comment on any passage.'
            : 'is no password. You will see the thesis read-only and can comment on any passage.',
          'You will not see anything else in their account.',
        ].join('\n'),
      });
    } catch (error) {
      mailed = false;
      this.logger.warn({ err: error, documentId, guideEmail: email }, 'guide share mail failed');
    }
    this.logger.log({ documentId, guideEmail: email, canEdit, mailed }, 'guide share sent');

    const [view] = await this.list(owner.id, documentId).then((all) =>
      all.filter((s) => s.id === share.id),
    );
    return { ...(view as ShareView), mailed };
  }

  /** D.2.1: "The student can revoke a share; the guide's comments remain." */
  async revoke(ownerId: string, documentId: string, shareId: string): Promise<{ revoked: true }> {
    await this.ownedDocument(ownerId, documentId);
    const share = await this.prisma.guideShare.findFirst({ where: { id: shareId, documentId } });
    if (!share) throw new NotFoundError('That share');
    await this.prisma.guideShare.delete({ where: { id: share.id } });
    return { revoked: true };
  }

  /**
   * Binds a signed-in user to the share their token names, and only if the address matches.
   *
   * This is the security boundary of the whole guide feature: the token says which document, the
   * session says who, and they must agree. A guide who signs in with a different address gets a
   * 403 rather than someone else's thesis.
   */
  async accept(
    user: { id: string; email: string; role: string },
    token: string,
  ): Promise<GuideDocumentView> {
    const share = await this.prisma.guideShare.findUnique({
      where: { token },
      select: { id: true, documentId: true, guideEmail: true, guideUserId: true },
    });
    if (!share) throw new NotFoundError('That link');
    if (share.guideEmail.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenError(
        'This link was sent to a different address. Sign in as the address that received it.',
      );
    }

    if (!share.guideUserId) {
      await this.prisma.guideShare.update({
        where: { id: share.id },
        data: { guideUserId: user.id },
      });
    }
    // A student who is also someone's guide keeps their own role; only a new account becomes GUIDE.
    if (user.role !== 'GUIDE' && user.role === 'STUDENT') {
      const own = await this.prisma.document.count({ where: { ownerId: user.id } });
      if (own === 0) {
        await this.prisma.user.update({ where: { id: user.id }, data: { role: 'GUIDE' } });
      }
    }

    return this.documentFor(user, share.documentId);
  }

  /** The read-only view a guide gets. Deliberately thin: no memory, no usage, no other documents. */
  async documentFor(
    user: { id: string; email: string },
    documentId: string,
  ): Promise<GuideDocumentView> {
    const share = await this.assertShared(user, documentId);
    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        owner: { select: { email: true } },
        chapters: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true },
        },
      },
    });
    return {
      documentId: document.id,
      title: document.title,
      studentEmail: document.owner.email,
      chapters: document.chapters,
      canEdit: share.canEdit,
      viewerEmail: user.email,
    };
  }

  /**
   * One chapter, read-only, for a guide who was shared the document.
   *
   * This did not exist, and its absence meant the guide feature had never worked end to end: the
   * guide page fetched `/chapters/:id`, which filters on `document: { ownerId }` and so answered
   * 404 to every supervisor who ever opened a share. They saw the title, the student's address,
   * and "Loading…" for ever. Found 2026-09-21 by signing in as a guide in a browser — the share,
   * comment and revoke paths all had tests, and none of them reads a chapter.
   *
   * A separate route rather than relaxing the student's: ownership and shared-with are different
   * permissions, and the way to get this wrong is to weaken the check that protects every other
   * chapter read in the product.
   */
  async chapterFor(
    user: { id: string; email: string },
    documentId: string,
    chapterId: string,
  ): Promise<{ id: string; title: string; content: unknown }> {
    await this.assertShared(user, documentId);
    const chapter = await this.prisma.chapter.findFirst({
      // Scoped to the shared document, so a chapter id from someone else's thesis is a 404 here
      // even for a legitimate guide of this one.
      where: { id: chapterId, documentId },
      select: { id: true, title: true, content: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    // The guide sees the figures too, and the links stored with the chapter have long expired.
    await withFreshFigureLinks(chapter.content, documentId, (key) => this.storage.signedUrl(key));
    return chapter;
  }

  /**
   * Where the thesis is up to, and what moved since this guide last looked.
   *
   * The visit marker is read *before* it is written, so the answer describes the gap since the
   * previous visit rather than since a moment ago — and it is only moved forward once the
   * previous one has gone cold (`shouldBumpVisit`), so refreshing while reading does not empty
   * the list underneath them.
   */
  async progressFor(
    user: { id: string; email: string },
    documentId: string,
    options: { recordVisit?: boolean; since?: Date } = {},
  ): Promise<GuideProgress> {
    const share = await this.assertShared(user, documentId);

    const [chapters, openComments, versions] = await Promise.all([
      this.prisma.chapter.findMany({
        where: { documentId },
        orderBy: { order: 'asc' },
        select: { id: true, title: true, order: true, wordCount: true, updatedAt: true },
      }),
      // This guide's own open comments, not every guide's: the number is "what have I asked for
      // that has not been dealt with", and another supervisor's threads are not that.
      this.prisma.comment.groupBy({
        by: ['chapterId'],
        where: { documentId, authorEmail: user.email, status: 'OPEN' },
        _count: { _all: true },
      }),
      // The words-over-time line: the counts autosave already records, over the weeks shown.
      this.prisma.documentVersion.findMany({
        where: {
          documentId,
          chapterId: { not: null },
          createdAt: { gte: new Date(Date.now() - (HISTORY_WEEKS + 1) * 7 * 24 * 60 * 60_000) },
        },
        select: { chapterId: true, wordCount: true, createdAt: true },
      }),
    ]);

    const previousVisit = options.since ?? share.lastViewedAt;
    const now = new Date();
    if (options.recordVisit !== false && shouldBumpVisit(previousVisit, now)) {
      await this.prisma.guideShare.update({
        where: { id: share.id },
        data: { lastViewedAt: now },
      });
    }

    return guideProgress({
      chapters,
      openCommentsByChapter: new Map(
        openComments
          .filter((row): row is typeof row & { chapterId: string } => row.chapterId !== null)
          .map((row) => [row.chapterId, row._count._all]),
      ),
      lastViewedAt: previousVisit,
      versions: versions.filter((v): v is typeof v & { chapterId: string } => v.chapterId !== null),
      now,
    });
  }

  /**
   * §12.1: a guide reaching anything they were not shared gets a 404, not a 403 — the same answer
   * a document that does not exist gives, so the ids leak nothing.
   */
  async assertShared(
    user: { id: string; email: string },
    documentId: string,
  ): Promise<{ id: string; lastViewedAt: Date | null; canEdit: boolean }> {
    const share = await this.prisma.guideShare.findFirst({
      where: {
        documentId,
        OR: [{ guideUserId: user.id }, { guideEmail: user.email.toLowerCase() }],
      },
      // Returns the row rather than void so `progressFor` does not have to fetch it twice. Every
      // existing caller ignores the value and still gets the throw, which is what they wanted.
      select: { id: true, lastViewedAt: true, canEdit: true },
    });
    if (!share) throw new NotFoundError('That document');
    return share;
  }

  /** Every document shared with this guide — the list their landing page shows. */
  async sharedWith(user: {
    id: string;
    email: string;
  }): Promise<Array<{ documentId: string; title: string; studentEmail: string; token: string }>> {
    const shares = await this.prisma.guideShare.findMany({
      where: { OR: [{ guideUserId: user.id }, { guideEmail: user.email.toLowerCase() }] },
      select: {
        token: true,
        document: { select: { id: true, title: true, owner: { select: { email: true } } } },
      },
    });
    return shares.map((share) => ({
      documentId: share.document.id,
      title: share.document.title,
      studentEmail: share.document.owner.email,
      token: share.token,
    }));
  }
}
