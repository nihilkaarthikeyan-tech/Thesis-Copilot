/**
 * Archiving a thesis and restoring it — Jenni build plan R29 (ADR-0114).
 *
 * Archiving takes a thesis off the student's list and does nothing else: no row, file, share or
 * version is touched, and it never goes near `DocumentEraser`, which is the one place a thesis is
 * removed. A link to it still opens it, a guide's share still works, a running job still finishes.
 *
 * `updatedAt` is written back as it was, so archiving or restoring does not read as an edit: the
 * list's "updated 3 Oct" and its order stay about the writing, not about the filing.
 */

import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

export type ArchiveState = { id: string; archivedAt: string | null };

@Injectable()
export class DocumentArchive {
  constructor(private readonly prisma: PrismaService) {}

  async archive(
    ownerId: string,
    documentId: string,
    now: Date = new Date(),
  ): Promise<ArchiveState> {
    return this.set(ownerId, documentId, now);
  }

  async restore(ownerId: string, documentId: string): Promise<ArchiveState> {
    return this.set(ownerId, documentId, null);
  }

  private async set(
    ownerId: string,
    documentId: string,
    archivedAt: Date | null,
  ): Promise<ArchiveState> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, title: true, archivedAt: true, updatedAt: true },
    });
    if (!document) throw new NotFoundError('That document');
    // Already where it was asked to be: answered as it stands, with no second audit line. An
    // archived thesis keeps the date it was first archived.
    if ((document.archivedAt === null) === (archivedAt === null)) {
      return { id: document.id, archivedAt: document.archivedAt?.toISOString() ?? null };
    }
    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: document.id },
        data: { archivedAt, updatedAt: document.updatedAt },
      }),
      this.prisma.auditEvent.create({
        data: {
          kind: archivedAt ? 'DOCUMENT_ARCHIVED' : 'DOCUMENT_RESTORED',
          userId: ownerId,
          documentId: document.id,
          detail: { title: document.title },
        },
      }),
    ]);
    return { id: document.id, archivedAt: archivedAt?.toISOString() ?? null };
  }
}
