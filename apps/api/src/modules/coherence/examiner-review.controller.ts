/**
 * `/chapters/:id/examiner-review` — ADR-0056. POST starts a review of the chapter for one
 * `EXAMINER_REVIEW` unit (owner only); GET reports the latest review's state, which the Flags tab
 * polls while it runs. The issues themselves are flags, served by `/documents/:id/coherence/flags`.
 * A GET with `?watching=1` (a visible tab) marks a running review as looked at (ADR-0058).
 */

import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
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
  start(@CurrentUser() user: SessionUser, @Param('id') chapterId: string) {
    return this.reviews.start(user, chapterId);
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
