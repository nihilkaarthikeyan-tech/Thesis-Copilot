/**
 * `/documents/:id/feedback*` and `/guide/*` — PRD §5.7, Appendix D.2, PHASES v2 B2.
 *
 * Two audiences on one set of routes. The student's requests are authorised by ownership; the
 * guide's by a share. `CommentsService.access` decides which, and every route that changes the
 * thesis or spends a cap unit is the student's alone.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CommentsService } from './comments.service.js';
import { DocxImportService } from './docx-import.service.js';
import { FeedbackExportService } from './feedback-export.service.js';
import { ReviewService } from './review.service.js';
import { SharesService } from './shares.service.js';

const shareBody = z.object({ guideEmail: z.string().trim().email().max(200) });

const commentBody = z.object({
  chapterId: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1).max(4_000),
  quotedText: z.string().trim().max(4_000).nullable().optional(),
  anchorKey: z.string().trim().max(100).nullable().optional(),
});

const resolveBody = z.object({
  outcome: z.enum(['ACCEPTED', 'EDITED', 'REJECTED', 'OPEN']),
  note: z.string().trim().max(2_000).optional(),
});

const pasteBody = z.object({
  text: z.string().trim().min(1).max(20_000),
  chapterId: z.string().uuid().nullable().optional(),
});

const acceptBody = z.object({ revision: z.string().trim().max(20_000).optional() });

const exportBody = z.object({ format: z.enum(['docx', 'pdf']).default('docx') });

@Controller('documents/:id/feedback')
@UseGuards(SessionGuard)
export class FeedbackController {
  constructor(
    private readonly shares: SharesService,
    private readonly comments: CommentsService,
    private readonly review: ReviewService,
    private readonly exports: FeedbackExportService,
    private readonly docx: DocxImportService,
  ) {}

  // ---- shares (student only) ----------------------------------------------------------------

  @Get('shares')
  listShares(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.shares.list(user.id, documentId);
  }

  @Post('shares')
  @HttpCode(200)
  createShare(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = shareBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Enter your guide’s email', parsed.error.issues);
    return this.shares.create(user, documentId, parsed.data.guideEmail);
  }

  @Delete('shares/:shareId')
  revokeShare(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('shareId') shareId: string,
  ) {
    return this.shares.revoke(user.id, documentId, shareId);
  }

  // ---- comments (student or guide) ------------------------------------------------------------

  @Get('comments')
  list(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.comments.list(user, documentId);
  }

  @Post('comments')
  @HttpCode(200)
  create(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = commentBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Write a comment first', parsed.error.issues);
    return this.comments.create(user, documentId, parsed.data);
  }

  /** D.2.2: a pasted email or list becomes one comment per item, for the student to assign. */
  /**
   * FR-7.3: a guide's marked-up `.docx` back into the review queue.
   *
   * Multipart, like every other upload in the product — `@fastify/multipart` is registered in
   * `bootstrap.ts`, and a JSON content-type on this route would make Nest try to parse the file.
   */
  @Post('comments/import-docx')
  @HttpCode(200)
  async importDocx(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Req() request: FastifyRequest,
  ) {
    const file = await (
      request as unknown as {
        file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined>;
      }
    ).file();
    if (!file) throw new ValidationError('Attach the .docx your guide sent back.');
    return this.docx.import(user, documentId, file.filename, await file.toBuffer());
  }

  @Post('comments/paste')
  @HttpCode(200)
  paste(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = pasteBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Paste the feedback first', parsed.error.issues);
    return this.review.splitPasted(
      user,
      documentId,
      parsed.data.text,
      parsed.data.chapterId ?? null,
    );
  }

  /** A.14 on one comment. Student only; capped as `COMMAND`. */
  @Post('comments/:commentId/suggest')
  @HttpCode(200)
  suggest(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.comments.suggest(user, documentId, commentId);
  }

  /** D.2.3: "Suggest for all mechanical" — the count is shown first, each still costs a unit. */
  @Post('comments/suggest-mechanical')
  @HttpCode(200)
  suggestMechanical(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.review.suggestAllMechanical(user, documentId);
  }

  /** Applies a revision to exactly the anchored range, after a snapshot (D.2.4). */
  @Post('comments/:commentId/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
  ) {
    const parsed = acceptBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid payload', parsed.error.issues);
    return this.review.accept(user, documentId, commentId, parsed.data.revision);
  }

  @Post('comments/:commentId/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
  ) {
    const parsed = resolveBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid outcome', parsed.error.issues);
    return this.comments.resolve(
      user,
      documentId,
      commentId,
      parsed.data.outcome,
      parsed.data.note,
    );
  }

  /** D.2.4: emails the guide a summary and enqueues a coherence re-run. */
  @Post('round-complete')
  @HttpCode(200)
  complete(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.review.completeRound(user, documentId);
  }

  /** D.2.5's response-to-committee table. */
  @Post('export')
  @HttpCode(200)
  export(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = exportBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid format', parsed.error.issues);
    return this.exports.responseToCommittee(user, documentId, parsed.data.format);
  }
}

/** The guide's own routes: what was shared with them, and accepting a link. */
@Controller('guide')
@UseGuards(SessionGuard)
export class GuideController {
  constructor(private readonly shares: SharesService) {}

  @Get('documents')
  documents(@CurrentUser() user: SessionUser) {
    return this.shares.sharedWith(user);
  }

  @Post('accept/:token')
  @HttpCode(200)
  accept(@CurrentUser() user: SessionUser, @Param('token') token: string) {
    return this.shares.accept(user, token);
  }

  @Get('documents/:documentId')
  document(@CurrentUser() user: SessionUser, @Param('documentId') documentId: string) {
    return this.shares.documentFor(user, documentId);
  }
}
