/**
 * `/documents/:id/proposal` — PRD §9.1, FR-1.5, PHASES 6.1.
 *
 * `GET` returns the conversation so a reload shows what was said; `POST { message }` is one
 * student turn. The reply is the whole view every time, because the skeleton, the gap check and
 * the question count all change what the screen shows next.
 */

import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ProposalService } from './proposal.service.js';

const turnBody = z.object({ message: z.string().trim().min(1).max(2_000) });

@Controller('documents/:id/proposal')
@UseGuards(SessionGuard)
export class ProposalController {
  constructor(private readonly proposal: ProposalService) {}

  @Get()
  get(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.proposal.get(user, documentId);
  }

  @Post()
  @HttpCode(200)
  turn(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = turnBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Say something first', parsed.error.issues);
    return this.proposal.turn(user, documentId, parsed.data.message);
  }
}
