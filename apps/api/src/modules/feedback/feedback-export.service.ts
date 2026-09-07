/**
 * Response-to-committee export — PRD Appendix D.2.5, PHASES v2 B2.6.
 *
 * The rows come from the comments as they stand now: the text the student ended up with, not the
 * revision that was suggested. If they accepted a suggestion and then edited it again, the table
 * shows what is in the thesis, which is what a committee is checking against.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@tc/config';
import { type ResponseRow, responseTableToDocx } from '@tc/export';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { CommentsService } from './comments.service.js';

export type FeedbackExportResult = {
  url: string;
  key: string;
  filename: string;
  bytes: number;
  comments: number;
};

@Injectable()
export class FeedbackExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comments: CommentsService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async responseToCommittee(
    user: SessionUser,
    documentId: string,
    format: 'docx' | 'pdf',
  ): Promise<FeedbackExportResult> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: user.id },
      select: { id: true, title: true, owner: { select: { name: true, email: true } } },
    });
    if (!document) throw new NotFoundError('That document');

    const [views, shares] = await Promise.all([
      this.comments.list(user, documentId),
      this.prisma.guideShare.findMany({
        where: { documentId },
        select: { guideEmail: true },
      }),
    ]);

    const rows: ResponseRow[] = views.map((view) => ({
      comment: view.body,
      chapterTitle: view.chapterTitle ?? 'The thesis as a whole',
      status: view.status as ResponseRow['status'],
      resolutionNote: view.resolutionNote,
      // What the passage says now — after accepting, editing, or neither.
      revisedText: view.currentText,
    }));

    const docx = await responseTableToDocx({
      documentTitle: document.title,
      studentName: document.owner.name ?? document.owner.email,
      guideEmails: shares.map((s) => s.guideEmail),
      exportedAt: new Date(),
      rows,
    });

    const base = `response-to-comments-${document.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60)}`;
    if (format === 'docx') {
      return { ...(await this.store(documentId, `${base}.docx`, docx)), comments: rows.length };
    }
    const pdf = await this.toPdf(docx, `${base}.docx`);
    return { ...(await this.store(documentId, `${base}.pdf`, pdf)), comments: rows.length };
  }

  private async toPdf(docx: Buffer, filename: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(docx)]), filename);
    const response = await fetch(`${this.env.GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) throw new Error(`Gotenberg refused the conversion (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async store(
    documentId: string,
    filename: string,
    body: Buffer,
  ): Promise<{ url: string; key: string; filename: string; bytes: number }> {
    const key = `exports/${documentId}/${Date.now()}-${filename}`;
    await this.storage.put(key, body, {
      'content-type': filename.endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    return { url: await this.storage.signedUrl(key), key, filename, bytes: body.length };
  }
}
