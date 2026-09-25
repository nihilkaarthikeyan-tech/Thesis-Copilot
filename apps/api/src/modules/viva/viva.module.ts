/**
 * Viva preparation — ADR-0030.
 *
 *   GET  /documents/:id/viva                   the latest question set, with answers so far
 *   POST /viva/:documentId/questions           a new set (one VIVA unit)
 *   POST /viva/questions/:questionId/answer    feedback on one typed answer (one VIVA unit)
 *
 * The two that reach a provider sit under `/viva/`, which the AI rate limiter covers.
 */

import { Body, Controller, Get, HttpCode, Module, Param, Post, UseGuards } from '@nestjs/common';
import { VIVA } from '@tc/ai';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { UsageModule } from '../usage/usage.module.js';
import { VivaService } from './viva.service.js';

const answerBody = z.object({ answer: z.string().trim().min(1).max(VIVA.answerMaxChars) });

@Controller()
@UseGuards(SessionGuard)
export class VivaController {
  constructor(private readonly viva: VivaService) {}

  @Get('documents/:id/viva')
  view(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.viva.view(user.id, documentId);
  }

  @Post('viva/:documentId/questions')
  @HttpCode(200)
  generate(@CurrentUser() user: SessionUser, @Param('documentId') documentId: string) {
    return this.viva.generate(user, documentId);
  }

  @Post('viva/questions/:questionId/answer')
  @HttpCode(200)
  answer(
    @CurrentUser() user: SessionUser,
    @Param('questionId') questionId: string,
    @Body() body: unknown,
  ) {
    const parsed = answerBody.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        `Type your answer first (at most ${VIVA.answerMaxChars.toLocaleString('en')} characters)`,
        parsed.error.issues,
      );
    }
    return this.viva.answer(user, questionId, parsed.data.answer);
  }
}

@Module({
  imports: [UsageModule],
  controllers: [VivaController],
  providers: [VivaService, SessionGuard],
})
export class VivaModule {}
