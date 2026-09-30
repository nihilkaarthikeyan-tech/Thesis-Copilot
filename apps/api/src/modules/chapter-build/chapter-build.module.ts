/**
 * Chapter build — ADR-0039.
 *
 *   GET  /chapter-build/profiles                                  disciplines, paradigms, universities
 *   GET  /documents/:id/chapter-build                             profile, chapters, past builds, allowance
 *   PUT  /documents/:id/chapter-build/profile                     keep the student's choice
 *   POST /documents/:id/chapter-build                             plan one: key terms + questions, PLANNED (no unit) → 201
 *   PUT  /documents/:id/chapter-build/:buildId/plan               the student's edits to the key terms and answers
 *   POST /documents/:id/chapter-build/:buildId/start              start it (one CHAPTER_BUILD unit) → 202
 *   GET  /documents/:id/chapter-build/:buildId                    state, plan and QA report
 *   POST /documents/:id/chapter-build/:buildId/issues/:issueId    accept (dismiss) or reopen an issue
 *   GET  /documents/:id/chapter-build/pitfalls                    what the bank checks for this discipline
 *   POST /documents/:id/chapter-build/pitfalls                    report a pitfall (goes to the queue)
 *
 *   GET  /admin/pitfalls?status=                                  the bank, SUPERADMIN
 *   POST /admin/pitfalls                                          add an approved entry
 *   PUT  /admin/pitfalls/:id                                      edit
 *   POST /admin/pitfalls/:id/:status                              approve | retire | pending
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { QueueService } from '../../common/queue.service.js';
import { SuperadminGuard } from '../admin/superadmin.guard.js';
import { AiModule } from '../ai/ai.module.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { UsageModule } from '../usage/usage.module.js';
import { ChapterBuildService } from './chapter-build.service.js';
import { PitfallsService } from './pitfalls.service.js';

const startBody = z.object({
  chapterId: z.string().uuid(),
  profile: z.unknown().optional(),
});
const decideBody = z.object({
  action: z.enum(['accept', 'reopen']),
  note: z.string().trim().max(500).optional(),
});
const statusParam = z.enum(['approve', 'retire', 'pending']);

@Controller()
@UseGuards(SessionGuard)
export class ChapterBuildController {
  constructor(
    private readonly builds: ChapterBuildService,
    private readonly pitfalls: PitfallsService,
  ) {}

  @Get('chapter-build/profiles')
  profiles() {
    return this.builds.profiles();
  }

  @Get('documents/:id/chapter-build')
  overview(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.builds.overview(user, documentId);
  }

  @Put('documents/:id/chapter-build/profile')
  saveProfile(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    return this.builds.saveProfile(user.id, documentId, body);
  }

  @Post('documents/:id/chapter-build')
  @HttpCode(201)
  plan(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = startBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Pick a chapter to build.', parsed.error.issues);
    return this.builds.plan(user, documentId, parsed.data.chapterId, parsed.data.profile);
  }

  @Put('documents/:id/chapter-build/:buildId/plan')
  updatePlan(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('buildId') buildId: string,
    @Body() body: unknown,
  ) {
    return this.builds.updatePlan(user.id, documentId, buildId, body);
  }

  @Post('documents/:id/chapter-build/:buildId/start')
  @HttpCode(202)
  start(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('buildId') buildId: string,
  ) {
    return this.builds.start(user, documentId, buildId);
  }

  @Get('documents/:id/chapter-build/pitfalls')
  async bank(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    const overview = await this.builds.overview(user, documentId);
    return {
      profile: overview.profile.disciplineId,
      pitfalls: await this.pitfalls.forProfile(overview.profile.disciplineId),
    };
  }

  @Post('documents/:id/chapter-build/pitfalls')
  @HttpCode(201)
  async report(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const overview = await this.builds.overview(user, documentId);
    return this.pitfalls.report(user.id, overview.profile.disciplineId, body);
  }

  @Get('documents/:id/chapter-build/:buildId')
  view(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('buildId') buildId: string,
  ) {
    return this.builds.view(user.id, documentId, buildId);
  }

  @Post('documents/:id/chapter-build/:buildId/issues/:issueId')
  @HttpCode(200)
  decide(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('buildId') buildId: string,
    @Param('issueId') issueId: string,
    @Body() body: unknown,
  ) {
    const parsed = decideBody.safeParse(body);
    if (!parsed.success)
      throw new ValidationError('Say what to do with the issue.', parsed.error.issues);
    return this.builds.decideIssue(
      user.id,
      documentId,
      buildId,
      issueId,
      parsed.data.action,
      parsed.data.note,
    );
  }
}

@Controller('admin/pitfalls')
@UseGuards(SessionGuard, SuperadminGuard)
export class PitfallsAdminController {
  constructor(private readonly pitfalls: PitfallsService) {}

  @Get()
  list(@Query('status') status?: string) {
    const parsed = z.enum(['PENDING', 'APPROVED', 'RETIRED', 'ALL']).safeParse(status ?? 'ALL');
    return this.pitfalls.list(parsed.success ? parsed.data : 'ALL');
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.pitfalls.create(user.id, body);
  }

  @Put(':id')
  update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    return this.pitfalls.update(user.id, id, body);
  }

  @Post(':id/:status')
  @HttpCode(200)
  setStatus(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('status') status: string,
  ) {
    const parsed = statusParam.safeParse(status);
    if (!parsed.success) throw new ValidationError('approve, retire or pending');
    const next =
      parsed.data === 'approve' ? 'APPROVED' : parsed.data === 'retire' ? 'RETIRED' : 'PENDING';
    return this.pitfalls.setStatus(user.id, id, next);
  }
}

@Module({
  imports: [UsageModule, AiModule],
  controllers: [ChapterBuildController, PitfallsAdminController],
  providers: [ChapterBuildService, PitfallsService, QueueService, SessionGuard, SuperadminGuard],
  exports: [PitfallsService],
})
export class ChapterBuildModule {}
