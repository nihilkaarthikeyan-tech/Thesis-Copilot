/**
 * Overlap check — ADR-0042.
 *
 *   POST /documents/:id/overlap { passage, sourceIds? }   read-only near-verbatim overlap report
 *
 * Read-only: it reports copied text, it never rewrites it (PRD §12.3). No metered unit — the
 * comparison is word-shingling over source passages already in the library.
 */

import { Body, Controller, HttpCode, Module, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { OverlapService } from './overlap.service.js';

const overlapBody = z.object({
  passage: z.string().min(1).max(20_000),
  sourceIds: z.array(z.string().uuid()).max(500).optional(),
});

@Controller('documents/:id/overlap')
@UseGuards(SessionGuard)
export class OverlapController {
  constructor(private readonly overlap: OverlapService) {}

  @Post()
  @HttpCode(200)
  check(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = overlapBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid overlap request', parsed.error.issues);
    return this.overlap.check(user.id, documentId, parsed.data.passage, parsed.data.sourceIds);
  }
}

@Module({
  controllers: [OverlapController],
  providers: [OverlapService, SessionGuard],
})
export class OverlapModule {}
