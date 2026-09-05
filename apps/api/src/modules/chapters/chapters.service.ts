/**
 * Chapters — PRD §9.1 (`GET/PUT /chapters/:id`, snapshot, versions) and Appendix B.7.
 *
 * Every query is scoped by the document owner (PRD §12.1). The save is an optimistic-concurrency
 * update: it only applies when `version` still equals the client's `baseVersion`; otherwise the
 * caller gets a 409 and the client stops autosaving (B.7).
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@tc/db';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { type SnapshotReason, SnapshotsService } from './snapshots.service.js';
import { looksLikeDoc, totalWords, wordCountsOf } from './word-counts.js';

export type ChapterView = {
  id: string;
  documentId: string;
  outlineNodeId: string;
  title: string;
  order: number;
  content: unknown;
  version: number;
  wordCount: number;
  wordCounts: unknown;
  scopeNote: string | null;
  snapshotAt: string | null;
  updatedAt: string;
};

const select = {
  id: true,
  documentId: true,
  outlineNodeId: true,
  title: true,
  order: true,
  content: true,
  version: true,
  wordCount: true,
  wordCounts: true,
  scopeNote: true,
  snapshotAt: true,
  updatedAt: true,
} satisfies Prisma.ChapterSelect;

@Injectable()
export class ChaptersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotsService,
  ) {}

  async get(ownerId: string, chapterId: string): Promise<ChapterView> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select,
    });
    if (!chapter) throw new NotFoundError('That chapter');
    return this.view(chapter);
  }

  /**
   * B.7 save. Returns the new version, or throws 409 when `baseVersion` is stale.
   * Also refreshes the per-provenance word counts (B.4) and writes an AUTOSAVE snapshot when one
   * is due.
   */
  async save(
    ownerId: string,
    chapterId: string,
    content: unknown,
    baseVersion: number,
  ): Promise<{ version: number; wordCount: number; snapshotTaken: boolean }> {
    if (!looksLikeDoc(content)) {
      throw new ValidationError(
        'content must be a ProseMirror document ({ type: "doc", content: [] })',
      );
    }
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new ValidationError('baseVersion must be a positive integer');
    }

    const counts = wordCountsOf(content);
    const wordCount = totalWords(counts);

    const updated = await this.prisma.chapter.updateMany({
      where: { id: chapterId, version: baseVersion, document: { ownerId } },
      data: {
        content: content as Prisma.InputJsonValue,
        wordCount,
        wordCounts: counts,
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      const current = await this.prisma.chapter.findFirst({
        where: { id: chapterId, document: { ownerId } },
        select: { version: true },
      });
      if (!current) throw new NotFoundError('That chapter');
      throw new ConflictError('This chapter was changed elsewhere — reload to continue.', {
        serverVersion: current.version,
        baseVersion,
      });
    }

    const after = await this.prisma.chapter.findFirstOrThrow({
      where: { id: chapterId },
      select: { version: true, documentId: true, snapshotAt: true },
    });

    let snapshotTaken = false;
    if (this.snapshots.isDue(after.snapshotAt)) {
      await this.snapshots.write({
        documentId: after.documentId,
        chapterId,
        content,
        reason: 'AUTOSAVE',
      });
      snapshotTaken = true;
    }

    return { version: after.version, wordCount, snapshotTaken };
  }

  async snapshot(
    ownerId: string,
    chapterId: string,
    reason: SnapshotReason,
  ): Promise<{ id: string; createdAt: string; reason: SnapshotReason }> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: { id: true, documentId: true, content: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    const row = await this.snapshots.write({
      documentId: chapter.documentId,
      chapterId: chapter.id,
      content: chapter.content,
      reason,
    });
    return { id: row.id, createdAt: row.createdAt.toISOString(), reason };
  }

  async versions(
    ownerId: string,
    documentId: string,
  ): Promise<Array<{ id: string; chapterId: string | null; reason: string; createdAt: string }>> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    const rows = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, chapterId: true, reason: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  private view(c: {
    id: string;
    documentId: string;
    outlineNodeId: string;
    title: string;
    order: number;
    content: unknown;
    version: number;
    wordCount: number;
    wordCounts: unknown;
    scopeNote: string | null;
    snapshotAt: Date | null;
    updatedAt: Date;
  }): ChapterView {
    return {
      ...c,
      snapshotAt: c.snapshotAt?.toISOString() ?? null,
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
