/**
 * `/chapters/:id/examiner-review` — ADR-0056. POST starts a review of the chapter for one
 * `EXAMINER_REVIEW` unit (owner only); GET reports the latest review's state, which the Flags tab
 * polls while it runs. The issues themselves are flags, served by `/documents/:id/coherence/flags`.
 */

import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ExaminerReviewService } from './examiner-review.service.js';

@Controller('chapters/:id/examiner-review')
@UseGuards(SessionGuard)
export class ExaminerReviewController {
  constructor(private readonly reviews: ExaminerReviewService) {}

  @Post()
  @HttpCode(202)
  start(@CurrentUser() user: SessionUser, @Param('id') chapterId: string) {
    return this.reviews.start(user, chapterId);
  }

  @Get()
  status(@CurrentUser() user: SessionUser, @Param('id') chapterId: string) {
    return this.reviews.status(user.id, chapterId);
  }
}
