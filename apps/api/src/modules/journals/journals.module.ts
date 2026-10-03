/**
 * Journal matching — ADR-0040.
 *
 *   GET /documents/:id/journals?openAccess=1&maxApc=2000   ranked journals for the thesis
 *
 * No metered unit (the ranking is pure code; the cost is one or two OpenAlex calls). SUPERADMIN is
 * not required; it is the student's own thesis, owner-scoped like everything else.
 */

import { Controller, Get, Module, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { JournalsService } from './journals.service.js';

@Controller('documents/:id/journals')
@UseGuards(SessionGuard)
export class JournalsController {
  constructor(private readonly journals: JournalsService) {}

  @Get()
  match(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Query('openAccess') openAccess?: string,
    @Query('maxApc') maxApc?: string,
  ) {
    const prefersOa = openAccess === '1' || openAccess === 'true';
    const cap = maxApc ? Number(maxApc) : null;
    return this.journals.match(
      user.id,
      documentId,
      prefersOa,
      cap != null && Number.isFinite(cap) ? cap : null,
    );
  }
}

@Module({
  controllers: [JournalsController],
  providers: [JournalsService, SessionGuard],
})
export class JournalsModule {}
