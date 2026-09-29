/**
 * A student deleting one of their own theses (2026-09-29). Before this the only way to be rid of
 * a thesis was to delete the whole account.
 */

import { Injectable } from '@nestjs/common';
import { DocumentEraser } from '../../common/document-eraser.service.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

/** Writes the same `DOCUMENT_DELETED` audit an admin deletion does, with the student as actor. */
@Injectable()
export class OwnThesisDeletion {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eraser: DocumentEraser,
  ) {}

  async delete(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, title: true, shares: { where: { canEdit: true }, select: { id: true } } },
    });
    if (!document) throw new NotFoundError('That document');
    if (document.shares.length > 0) {
      // A co-author is writing in it too (ADR-0028); removing it would delete their work as well.
      throw new ConflictError(
        'Someone is writing this thesis with you. Remove their access first, then delete it.',
      );
    }
    const { files } = await this.eraser.erase([documentId]);
    await this.prisma.auditEvent.create({
      data: {
        kind: 'DOCUMENT_DELETED',
        userId: ownerId,
        actorId: ownerId,
        documentId,
        detail: { title: document.title, files, by: 'owner' },
      },
    });
    return { deleted: true };
  }
}
