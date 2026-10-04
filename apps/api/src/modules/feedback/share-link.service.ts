/**
 * "Anyone with the link can read" — ADR-0057.
 *
 * A guide share is an invitation bound to an address; this is the other thing the word "share"
 * means on the web, and it is deliberately the smaller of the two: read-only, text only, no
 * comments, no AI, no student e-mail, no library. Off until the owner turns it on.
 *
 * The token is 32 random bytes (256 bits) in base64url. Only its SHA-256 is stored, so a copy of
 * the database is not a copy of the links, and the owner sees the URL once, when it is made.
 * Turning the link off deletes the row — the old token then hashes to nothing — and turning it on
 * again, or asking for a new link, mints a fresh token and replaces the row in one transaction.
 * The lookup is by the hash's unique index; the stored hash is then compared with
 * `timingSafeEqual` as well, so no path compares secret material with an early-exit `===`.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { type ReadBlock, readBlocks } from './read-view.js';

/** 32 bytes of base64url, unpadded: exactly 43 characters from the URL-safe alphabet. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type ShareLinkStatus = {
  enabled: boolean;
  createdAt: string | null;
  views: number;
  lastViewedAt: string | null;
};

/** Only on the answer that made the link: the one time the URL exists outside the browser. */
export type NewShareLink = ShareLinkStatus & { url: string };

/** What a link holder sees of the thesis. No owner, no e-mail, no memory, no sources. */
export type LinkDocumentView = {
  title: string;
  chapters: Array<{ id: string; title: string; order: number }>;
};

export type LinkChapterView = { id: string; title: string; blocks: ReadBlock[] };

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Whether a string could be a token at all, before it costs a database read. */
export function isTokenShaped(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

/** Constant-time equality of two lowercase hex SHA-256 digests. */
export function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

@Injectable()
export class ShareLinkService {
  private readonly logger = new Logger(ShareLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private url(token: string): string {
    return `${this.env.APP_URL.replace(/\/$/, '')}/read/${token}`;
  }

  private async ownedDocument(ownerId: string, documentId: string): Promise<{ id: string }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  async status(ownerId: string, documentId: string): Promise<ShareLinkStatus> {
    await this.ownedDocument(ownerId, documentId);
    const link = await this.prisma.shareLink.findUnique({ where: { documentId } });
    return {
      enabled: Boolean(link),
      createdAt: link?.createdAt.toISOString() ?? null,
      views: link?.views ?? 0,
      lastViewedAt: link?.lastViewedAt?.toISOString() ?? null,
    };
  }

  /** Turns the link on, or replaces it: whichever link existed before stops working. */
  async enable(ownerId: string, documentId: string): Promise<NewShareLink> {
    await this.ownedDocument(ownerId, documentId);
    const token = newToken();
    const link = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.shareLink.deleteMany({ where: { documentId } });
      const created = await tx.shareLink.create({
        data: { documentId, tokenHash: hashToken(token) },
      });
      await tx.auditEvent.create({
        data: {
          kind: 'SHARE_LINK_ON',
          userId: ownerId,
          documentId,
          detail: { replaced: previous.count > 0 },
        },
      });
      return created;
    });
    this.logger.log({ documentId }, 'share link turned on');
    return {
      enabled: true,
      createdAt: link.createdAt.toISOString(),
      views: 0,
      lastViewedAt: null,
      url: this.url(token),
    };
  }

  async disable(ownerId: string, documentId: string): Promise<ShareLinkStatus> {
    await this.ownedDocument(ownerId, documentId);
    const removed = await this.prisma.shareLink.deleteMany({ where: { documentId } });
    if (removed.count > 0) {
      await this.prisma.auditEvent.create({
        data: { kind: 'SHARE_LINK_OFF', userId: ownerId, documentId },
      });
      this.logger.log({ documentId }, 'share link turned off');
    }
    return { enabled: false, createdAt: null, views: 0, lastViewedAt: null };
  }

  /**
   * The document a token opens, or a 404 — the same answer for a malformed token, one that never
   * existed and one that was turned off, so the response says nothing about which.
   */
  private async resolve(token: string): Promise<{ id: string; documentId: string }> {
    if (!isTokenShaped(token)) throw new NotFoundError('That link');
    const digest = hashToken(token);
    const link = await this.prisma.shareLink.findUnique({
      where: { tokenHash: digest },
      select: { id: true, documentId: true, tokenHash: true },
    });
    if (!link || !sameDigest(digest, link.tokenHash)) throw new NotFoundError('That link');
    return link;
  }

  /** The thesis's title and chapter list. Counted as one view, the way a guide's visit is. */
  async document(token: string): Promise<LinkDocumentView> {
    const link = await this.resolve(token);
    const [document] = await Promise.all([
      this.prisma.document.findUniqueOrThrow({
        where: { id: link.documentId },
        select: {
          title: true,
          chapters: { orderBy: { order: 'asc' }, select: { id: true, title: true, order: true } },
        },
      }),
      this.prisma.shareLink.update({
        where: { id: link.id },
        data: { views: { increment: 1 }, lastViewedAt: new Date() },
      }),
    ]);
    this.logger.log({ documentId: link.documentId, linkId: link.id }, 'share link opened');
    return document;
  }

  /** One chapter as headings and paragraphs (`readBlocks`); never the stored JSON. */
  async chapter(token: string, chapterId: string): Promise<LinkChapterView> {
    const link = await this.resolve(token);
    const chapter = await this.prisma.chapter.findFirst({
      // Scoped to the linked document: a chapter id from another thesis is a 404 here.
      where: { id: chapterId, documentId: link.documentId },
      select: { id: true, title: true, content: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    return { id: chapter.id, title: chapter.title, blocks: readBlocks(chapter.content) };
  }
}
