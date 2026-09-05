/**
 * `/citations/*` — PRD §9.3, FR-4.5.
 *
 * Separate from `/assist/*` only because §9.3 puts it at its own path; it shares the same
 * retrieval and memory services.
 */

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CiteService } from './cite.service.js';

const citeBody = z.object({
  chapterId: z.string().uuid(),
  sentence: z.string().trim().min(1).max(2_000),
});

@Controller('citations')
@UseGuards(SessionGuard)
export class CitationsController {
  constructor(private readonly cite: CiteService) {}

  /**
   * FR-4.5. Answers `{ suggestions: [], triggered: false }` when the claim heuristic declines or
   * the library has nothing to offer — a normal, free outcome, not an error.
   */
  @Post('suggest')
  async suggest(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = citeBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.issues);
    return this.cite.suggest(user, parsed.data.chapterId, parsed.data.sentence);
  }
}
