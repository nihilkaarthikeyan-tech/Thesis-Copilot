/**
 * `/documents/:id/search*` — PRD §9.2, FR-2.5–2.8, PHASES v2 W7.
 */

import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { SearchService } from './search.service.js';

const startBody = z.object({ mode: z.enum(['discover', 'expand']).default('discover') });
const selectBody = z.object({ candidateIds: z.array(z.string().uuid()).min(1).max(200) });

@Controller('documents/:id/search')
@UseGuards(SessionGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

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

  /** Results grouped by sub-theme — the gap map (FR-2.6). */
  @Get(':runId')
  get(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('runId') runId: string,
  ) {
    return this.search.get(user.id, documentId, runId);
  }

  /** FR-2.7: `{ candidateIds[] }` → library → index jobs. Nothing is selected automatically. */
  @Post(':runId/select')
  @HttpCode(200)
  select(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const parsed = selectBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Pick at least one paper', parsed.error.issues);
    return this.search.select(user.id, documentId, runId, parsed.data.candidateIds);
  }
}
