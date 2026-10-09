/**
 * `/documents/:id/search*` — PRD §9.2, FR-2.5–2.8, PHASES v2 W7.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { isWatching, JobWatchService } from '../../common/job-watch.js';
import { LibraryFilingService } from '../../common/library-filing.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { SearchService } from './search.service.js';

const startBody = z.object({ mode: z.enum(['discover', 'expand']).default('discover') });
const selectBody = z.object({
  candidateIds: z.array(z.string().uuid()).min(1).max(200),
  /** R18 (ADR-0129): the collection to file the papers into; absent or null, the library only. */
  collectionId: z.string().uuid().nullable().optional(),
});

@Controller('documents/:id/search')
@UseGuards(SessionGuard)
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly watch: JobWatchService,
    private readonly filing: LibraryFilingService,
  ) {}

  /** `{ mode: 'discover' | 'expand' }` → job `search-literature`. */
  @Post()
  @HttpCode(202)
  start(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = startBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid search request', parsed.error.issues);
    return this.search.start(user.id, documentId, parsed.data.mode);
  }

  @Get()
  list(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.search.list(user.id, documentId);
  }

  /**
   * Results grouped by sub-theme — the gap map (FR-2.6). `?watching=1` from a visible tab marks a
   * running search as looked at (ADR-0058).
   */
  @Get(':runId')
  async get(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('runId') runId: string,
    @Query('watching') watching?: string,
  ) {
    const view = await this.search.get(user.id, documentId, runId);
    if (isWatching(watching) && view.status === 'RUNNING') await this.watch.touch([runId]);
    return view;
  }

  /** FR-2.7: `{ candidateIds[] }` → library → index jobs. Nothing is selected automatically. */
  @Post(':runId/select')
  @HttpCode(200)
  async select(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const parsed = selectBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Pick at least one paper', parsed.error.issues);
    const target = await this.filing.target(user.id, documentId, parsed.data.collectionId);
    const result = await this.search.select(user.id, documentId, runId, parsed.data.candidateIds);
    const filedIn = await this.filing.file(documentId, target, result.sourceIds);
    return { ...result, filedIn };
  }
}
