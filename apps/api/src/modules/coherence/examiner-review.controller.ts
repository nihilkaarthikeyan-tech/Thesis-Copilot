/**
 * `/chapters/:id/examiner-review` — ADR-0056. POST starts a review of the chapter for one
 * `EXAMINER_REVIEW` unit (owner only); GET reports the latest review's state, which the Flags tab
 * polls while it runs. The issues themselves are flags, served by `/documents/:id/coherence/flags`.
 * A GET with `?watching=1` (a visible tab) marks a running review as looked at (ADR-0058).
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { isWatching, JobWatchService } from '../../common/job-watch.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ExaminerReviewService } from './examiner-review.service.js';

@Controller('chapters/:id/examiner-review')
@UseGuards(SessionGuard)
export class ExaminerReviewController {
  constructor(
    private readonly reviews: ExaminerReviewService,
    private readonly watch: JobWatchService,
  ) {}

  @Post()
  @HttpCode(202)
  start(@CurrentUser() user: SessionUser, @Param('id') chapterId: string, @Body() body: unknown) {
    // ADR-0067: `{ from, to }` reviews only the selected text (positions in the saved chapter).
    const parsed = z
      .object({ from: z.number().int().min(0), to: z.number().int().min(1) })
      .refine((r) => r.to > r.from)
      .optional()
      .safeParse(body && typeof body === 'object' && 'from' in body ? body : undefined);
    if (!parsed.success) throw new ValidationError('Invalid selection', parsed.error.issues);
    return this.reviews.start(user, chapterId, parsed.data);
  }

  @Get()
  async status(
    @CurrentUser() user: SessionUser,
    @Param('id') chapterId: string,
    @Query('watching') watching?: string,
  ) {
    const view = await this.reviews.status(user.id, chapterId);
    if (
      isWatching(watching) &&
      view.runId &&
      (view.status === 'QUEUED' || view.status === 'RUNNING')
    ) {
      await this.watch.touch([view.runId]);
    }
    return view;
  }
}
