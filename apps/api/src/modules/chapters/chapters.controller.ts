import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ChaptersService } from './chapters.service.js';
import { FiguresService } from './figures.service.js';
import { ParaphraseService } from './paraphrase.service.js';
import { SNAPSHOT_REASONS } from './snapshots.service.js';

/** A version list's page cursor: absent for the first page, else the id of the last row shown. */
function versionCursor(before: string | undefined): string | undefined {
  if (before === undefined || before === '') return undefined;
  const parsed = z.string().uuid().safeParse(before);
  if (!parsed.success) throw new ValidationError('Invalid page cursor', parsed.error.issues);
  return parsed.data;
}

const saveBody = z.object({
  content: z.unknown(),
  baseVersion: z.number().int().positive(),
});

/** §10.4's pin filter. Empty means "the whole library", which is the default a chapter starts in. */
const pinsBody = z.object({
  sourceIds: z.array(z.string().uuid()).max(500),
  /** ADR-0085: the heading whose pins these are; absent means the chapter's. */
  section: z.string().trim().max(300).optional(),
});

const snapshotBody = z.object({
  reason: z.enum(['MANUAL', 'PRE_DRAFT_ACCEPT', 'PRE_REVISION']).default('MANUAL'),
});

/** PRD §9.1 — chapter load/save (autosave), manual snapshot, version list. */
@Controller()
@UseGuards(SessionGuard)
export class ChaptersController {
  constructor(
    private readonly chapters: ChaptersService,
    private readonly figures: FiguresService,
    private readonly paraphrase: ParaphraseService,
  ) {}

  @Get('chapters/:id')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.chapters.get(user.id, id);
  }

  /** Appendix B.7: `{ content, baseVersion }` → 200 `{ version }` or 409 when stale. */
  @Put('chapters/:id')
  async save(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const parsed = saveBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid save payload', parsed.error.issues);
    return this.chapters.save(user.id, id, parsed.data.content, parsed.data.baseVersion);
  }

  /** ADR-0085: `?section=<heading>` adds that section's own pins to the answer. */
  @Get('chapters/:id/pins')
  pins(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query('section') section?: string,
  ) {
    return this.chapters.pins(user.id, id, section?.trim() || undefined);
  }

  /** PHASES 3.1: replaces the pin set; "Pin all" is the client sending every source id. */
  @Put('chapters/:id/pins')
  async setPins(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const parsed = pinsBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid pins payload', parsed.error.issues);
    return this.chapters.setPins(user.id, id, parsed.data.sourceIds, parsed.data.section ?? '');
  }

  @Post('chapters/:id/snapshot')
  async snapshot(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const parsed = snapshotBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid snapshot payload', parsed.error.issues);
    if (!(SNAPSHOT_REASONS as readonly string[]).includes(parsed.data.reason)) {
      throw new ValidationError('Unknown snapshot reason');
    }
    return this.chapters.snapshot(user.id, id, parsed.data.reason);
  }

  /**
   * Where this chapter reuses a source's phrasing without citing it.
   *
   * A GET because it computes nothing that persists and costs nothing to repeat: no model call,
   * no embedding, no cap.
   */
  @Get('chapters/:id/paraphrase')
  paraphraseCheck(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.paraphrase.check(user.id, id);
  }

  @Get('documents/:id/versions')
  versions(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.chapters.versions(user.id, id, versionCursor(before));
  }

  /**
   * The History panel's list for one chapter: metadata only, newest first, a page at a time.
   * `?before=<version id>` continues after the last one shown.
   */
  @Get('chapters/:id/versions')
  chapterVersions(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.chapters.chapterVersions(user.id, id, versionCursor(before));
  }

  /** One version's text, for the preview. */
  @Get('versions/:versionId')
  readVersion(@CurrentUser() user: SessionUser, @Param('versionId') versionId: string) {
    return this.chapters.readVersion(user.id, versionId);
  }

  /**
   * Puts a version back. The current text is snapshotted first, so this is undoable — and the
   * response names that snapshot, so the screen can offer the undo straight away.
   */
  @Post('versions/:versionId/restore')
  @HttpCode(200)
  restoreVersion(@CurrentUser() user: SessionUser, @Param('versionId') versionId: string) {
    return this.chapters.restoreVersion(user.id, versionId);
  }

  /**
   * A figure for this chapter — the editor's "Insert figure" button.
   *
   * Multipart, like every other upload here, and for the reason recorded in the hard-won rules:
   * a JSON content-type on a multipart route makes Nest try to JSON-parse the file.
   */
  @Post('chapters/:id/figures')
  @HttpCode(200)
  async uploadFigure(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ) {
    const file = await (
      request as unknown as {
        file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined>;
      }
    ).file();
    if (!file) throw new ValidationError('Choose an image to insert.');
    return this.figures.upload({
      ownerId: user.id,
      chapterId: id,
      filename: file.filename,
      bytes: new Uint8Array(await file.toBuffer()),
    });
  }

  /** Re-signs a figure whose link has expired, so a chapter reopened tomorrow still renders. */
  @Get('chapters/:id/figures/link')
  figureLink(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query('key') key?: string,
  ) {
    if (!key) throw new ValidationError('Which figure?');
    return this.figures.link(user.id, id, key);
  }
}
