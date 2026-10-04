/**
 * Feedback — PHASES 5.9.
 *
 *   "feedback link in the app that emails the admin with the document id and last 5 suggestion
 *    events."
 *
 * The mail carries ids and outcomes, never chapter text: an admin reading a support request
 * should not receive a thesis by accident (§12.2). The message is kept in `AuditEvent` too, so
 * it survives a lost email.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { MAILER, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';

export type FeedbackInput = { documentId: string; message: string; page?: string };

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(
    user: { id: string; email: string },
    input: FeedbackInput,
  ): Promise<{ ok: true; events: number }> {
    const document = await this.prisma.document.findFirst({
      where: { id: input.documentId, ownerId: user.id },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');

    const events = await this.prisma.suggestionEvent.findMany({
      where: { userId: user.id, documentId: document.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        action: true,
        outcome: true,
        shownChars: true,
        keptChars: true,
        ttfbMs: true,
        latencyMs: true,
        rating: true,
        createdAt: true,
      },
    });

    const lines = events.map(
      (e) =>
        `  ${e.createdAt.toISOString()}  ${e.action.padEnd(6)} ${e.outcome.padEnd(9)} ` +
        `shown ${e.shownChars} kept ${e.keptChars} ttfb ${e.ttfbMs ?? '–'} ms` +
        `${e.rating === 1 ? '  rated useful' : e.rating === -1 ? '  rated not useful' : ''}  (${e.id})`,
    );
    const text = [
      `From: ${user.email} (user ${user.id})`,
      `Document: ${document.id}`,
      input.page ? `Page: ${input.page}` : null,
      '',
      input.message,
      '',
      events.length ? 'Last suggestion events on this document:' : 'No suggestion events yet.',
      ...lines,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    await this.prisma.auditEvent.create({
      data: {
        kind: 'FEEDBACK',
        userId: user.id,
        documentId: document.id,
        detail: { message: input.message, page: input.page ?? null, events: events.length },
      },
    });
    await this.mailer.send({
      to: [this.env.SEED_ADMIN_EMAIL],
      subject: `[Thesis Copilot] Feedback from ${user.email}`,
      text,
    });
    return { ok: true, events: events.length };
  }
}
