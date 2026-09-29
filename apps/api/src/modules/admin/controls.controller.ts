/**
 * The superadmin's controls (2026-09-29, the owner's approved design): account actions, the
 * read-only thesis view, the overview, the activity log, background jobs and the feedback inbox.
 *
 * Every route is SUPERADMIN-only. Every change is written to the activity log by the service.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { METERED_ACTIONS } from '@tc/config';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AdminControlsService } from './controls.service.js';
import { AdminInsightService } from './insight.service.js';
import { SuperadminGuard } from './superadmin.guard.js';

const reason = z.string().trim().min(3, 'Say why, in a few words.').max(500);
const suspendBody = z.object({ reason });
const trialBody = z.object({ days: z.number().int().min(1).max(365), reason });
const deleteThesisBody = z.object({ reason });
const allowanceBody = z.object({
  grants: z
    .array(z.object({ action: z.enum(METERED_ACTIONS), units: z.number().int().min(0).max(1000) }))
    .min(1),
  reason,
});
const page = {
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
};
const activityQuery = z.object({
  ...page,
  kind: z.string().trim().max(60).optional(),
  q: z.string().trim().max(200).optional(),
  days: z.coerce.number().int().positive().max(3650).optional(),
});
const feedbackQuery = z.object({ ...page, status: z.enum(['unread', 'all']).optional() });
const feedbackMark = z.enum(['read', 'unread', 'answered']);

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(what, parsed.error.issues);
  return parsed.data;
}

/** Empty query parameters arrive as `''`; treat them as absent. */
function present(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '' && v !== undefined));
}

@Controller('admin')
@UseGuards(SessionGuard, SuperadminGuard)
export class AdminControlsController {
  constructor(
    private readonly controls: AdminControlsService,
    private readonly insight: AdminInsightService,
  ) {}

  @Get('overview')
  overview() {
    return this.insight.overview();
  }

  @Get('badges')
  badges() {
    return this.insight.badges();
  }

  @Post('users/:id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(suspendBody, body, 'A reason is needed');
    return this.controls.suspend(admin.id, id, reason);
  }

  @Post('users/:id/unsuspend')
  @HttpCode(200)
  unsuspend(@CurrentUser() admin: SessionUser, @Param('id') id: string) {
    return this.controls.unsuspend(admin.id, id);
  }

  @Post('users/:id/sign-out')
  @HttpCode(200)
  signOut(@CurrentUser() admin: SessionUser, @Param('id') id: string) {
    return this.controls.signOutEverywhere(admin.id, id);
  }

  @Post('users/:id/allowance')
  @HttpCode(200)
  allowance(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const { grants, reason } = parse(allowanceBody, body, 'Invalid allowance');
    return this.controls.grantAllowance(admin.id, id, grants, reason);
  }

  @Post('users/:id/trial')
  @HttpCode(200)
  extendTrial(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const { days, reason } = parse(trialBody, body, 'Days (1 to 365) and a reason are needed');
    return this.controls.extendTrial(admin.id, id, days, reason);
  }

  @Post('users/:id/deletion')
  @HttpCode(200)
  requestDeletion(@CurrentUser() admin: SessionUser, @Param('id') id: string) {
    return this.controls.requestDeletion(admin.id, id);
  }

  @Delete('users/:id/deletion')
  @HttpCode(200)
  cancelDeletion(@CurrentUser() admin: SessionUser, @Param('id') id: string) {
    return this.controls.cancelDeletion(admin.id, id);
  }

  /** Opening a thesis read-only. Logged; the student is emailed. */
  @Get('theses/:id')
  viewThesis(@CurrentUser() admin: SessionUser, @Param('id') id: string) {
    return this.controls.viewThesis(admin.id, id);
  }

  @Get('theses/:id/chapters/:chapterId')
  viewChapter(
    @CurrentUser() admin: SessionUser,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.controls.viewChapter(admin.id, id, chapterId);
  }

  /** POST rather than DELETE because it carries a reason, which a DELETE body often loses. */
  @Post('theses/:id/delete')
  @HttpCode(200)
  deleteThesis(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(deleteThesisBody, body, 'A reason is needed');
    return this.controls.deleteThesis(admin.id, id, reason);
  }

  @Get('activity')
  activity(@Query() query: Record<string, unknown>) {
    return this.insight.activity(parse(activityQuery, present(query), 'Invalid filters'));
  }

  @Get('jobs')
  jobs() {
    return this.insight.jobs();
  }

  @Post('jobs/retry-all')
  @HttpCode(200)
  retryAll() {
    return this.insight.retryAll();
  }

  @Post('jobs/:queue/:id/retry')
  @HttpCode(200)
  retryJob(@Param('queue') queue: string, @Param('id') id: string) {
    return this.insight.retryJob(queue, id);
  }

  @Get('feedback')
  feedback(@Query() query: Record<string, unknown>) {
    return this.insight.feedback(parse(feedbackQuery, present(query), 'Invalid filters'));
  }

  @Post('feedback/:id/:mark')
  @HttpCode(200)
  markFeedback(
    @CurrentUser() admin: SessionUser,
    @Param('id') id: string,
    @Param('mark') mark: string,
  ) {
    return this.insight.markFeedback(admin.id, id, parse(feedbackMark, mark, 'Unknown mark'));
  }
}
