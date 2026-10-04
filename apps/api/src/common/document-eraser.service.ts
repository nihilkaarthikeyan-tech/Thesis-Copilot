/**
 * Removing a thesis for good — its rows and every object it owns in storage (2026-09-29).
 *
 * One place, used by three callers: a student deleting their own thesis, a superadmin deleting
 * one from Admin, and account erasure (PRD §12.2). Before this existed only account erasure
 * deleted documents, and it missed two kinds of object: figures (`figures/<id>/`) and version
 * snapshots (each `DocumentVersion.snapshotKey`). Both outlived the account they belonged to.
 *
 * Files first, then rows, as erasure always did: if MinIO is briefly down a file is left behind
 * and logged, but the rows that would make it reachable are still removed — the other order would
 * leave objects nothing points at, the one outcome §12.2 forbids.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { figurePrefix } from './figure-links.js';
import { PrismaService } from './prisma.service.js';
import { StorageService } from './storage.service.js';

@Injectable()
export class DocumentEraser {
  private readonly logger = new Logger(DocumentEraser.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Removes these documents' files, then their rows in one transaction. */
  async erase(documentIds: readonly string[]): Promise<{ files: number }> {
    if (documentIds.length === 0) return { files: 0 };
    const files = await this.removeFiles(documentIds);
    await this.prisma.$transaction(async (tx) => {
      await this.deleteRows(tx, documentIds);
    });
    return { files };
  }

  /**
   * The document-scoped rows, deepest first — Prisma will not order these and several have no
   * cascade. Exposed so account erasure can run it inside its own, larger transaction.
   */
  async deleteRows(tx: Prisma.TransactionClient, documentIds: readonly string[]): Promise<void> {
    if (documentIds.length === 0) return;
    const ids = [...documentIds];
    const inDocs = { documentId: { in: ids } };
    const chapterIds = (await tx.chapter.findMany({ where: inDocs, select: { id: true } })).map(
      (c) => c.id,
    );
    const sourceIds = (await tx.source.findMany({ where: inDocs, select: { id: true } })).map(
      (s) => s.id,
    );

    if (chapterIds.length > 0) {
      await tx.chapterChunk.deleteMany({ where: { chapterId: { in: chapterIds } } });
      await tx.chapterSourcePin.deleteMany({ where: { chapterId: { in: chapterIds } } });
      await tx.citation.deleteMany({ where: { chapterId: { in: chapterIds } } });
    }
    if (sourceIds.length > 0) {
      await tx.sourceChunk.deleteMany({ where: { sourceId: { in: sourceIds } } });
    }
    await tx.coherenceFlag.deleteMany({ where: inDocs });
    await tx.comment.deleteMany({ where: inDocs });
    await tx.guideShare.deleteMany({ where: inDocs });
    await tx.shareLink.deleteMany({ where: inDocs });
    await tx.documentVersion.deleteMany({ where: inDocs });
    await tx.suggestionEvent.deleteMany({ where: inDocs });
    await tx.searchCandidate.deleteMany({ where: inDocs });
    await tx.documentMemory.deleteMany({ where: inDocs });
    await tx.seedPaper.deleteMany({ where: inDocs });
    await tx.source.deleteMany({ where: inDocs });
    await tx.chapter.deleteMany({ where: inDocs });
    await tx.document.deleteMany({ where: { id: { in: ids } } });
  }

  /**
   * Every object in the bucket belonging to these documents. A failure to remove one does not
   * stop the rest; the key is logged so it can be swept by hand.
   */
  async removeFiles(documentIds: readonly string[]): Promise<number> {
    const inDocs = { documentId: { in: [...documentIds] } };
    const [seeds, sources, versions] = await Promise.all([
      this.prisma.seedPaper.findMany({ where: inDocs, select: { fileKey: true } }),
      this.prisma.source.findMany({
        where: { ...inDocs, fileKey: { not: null } },
        select: { fileKey: true },
      }),
      this.prisma.documentVersion.findMany({ where: inDocs, select: { snapshotKey: true } }),
    ]);

    const listed: string[] = [];
    for (const id of documentIds) {
      for (const prefix of [`exports/${id}/`, figurePrefix(id)]) {
        try {
          listed.push(...(await this.storage.list(prefix)));
        } catch (error) {
          this.logger.error({ documentId: id, prefix, error }, 'could not list files to erase');
        }
      }
    }

    const keys = [
      ...new Set(
        [
          ...seeds.map((s) => s.fileKey),
          ...sources.map((s) => s.fileKey),
          ...versions.map((v) => v.snapshotKey),
          ...listed,
        ].filter((k): k is string => Boolean(k)),
      ),
    ];

    let removed = 0;
    for (const key of keys) {
      try {
        await this.storage.remove(key);
        removed += 1;
      } catch (error) {
        this.logger.error({ key, error }, 'could not remove a file while erasing a document');
      }
    }
    return removed;
  }
}
