import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ChaptersService } from './chapters.service.js';
import { SNAPSHOT_REASONS } from './snapshots.service.js';

const saveBody = z.object({
  content: z.unknown(),
  baseVersion: z.number().int().positive(),
});

/** §10.4's pin filter. Empty means "the whole library", which is the default a chapter starts in. */
const pinsBody = z.object({
  sourceIds: z.array(z.string().uuid()).max(500),
});

const snapshotBody = z.object({
  reason: z.enum(['MANUAL', 'PRE_DRAFT_ACCEPT', 'PRE_REVISION']).default('MANUAL'),
});

/** PRD §9.1 — chapter load/save (autosave), manual snapshot, version list. */
@Controller()
@UseGuards(SessionGuard)
export class ChaptersController {
  constructor(private readonly chapters: ChaptersService) {}

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

  @Get('chapters/:id/pins')
  pins(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.chapters.pins(user.id, id);
  }

  /** PHASES 3.1: replaces the pin set; "Pin all" is the client sending every source id. */
  @Put('chapters/:id/pins')
  async setPins(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const parsed = pinsBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid pins payload', parsed.error.issues);
    return this.chapters.setPins(user.id, id, parsed.data.sourceIds);
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

  @Get('documents/:id/versions')
  versions(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.chapters.versions(user.id, id);
  }
}
