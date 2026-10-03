/**
 * Thesis lifecycle — ADR-0043.
 *
 *   GET  /documents/:id/lifecycle            current state + the actions available from it
 *   POST /documents/:id/lifecycle { event }  fire a validated transition
 *
 * No metered unit: the state machine is pure and the only work is reads plus the compliance check
 * the Submit screen already runs. Owner-scoped.
 */

import { Body, Controller, Get, HttpCode, Module, Param, Post, UseGuards } from '@nestjs/common';
import { LIFECYCLE_EVENTS, type LifecycleEvent } from '@tc/types';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ExportModule } from '../export/export.module.js';
import { LifecycleService } from './lifecycle.service.js';

const fireBody = z.object({
  event: z
    .string()
    .refine((e): e is LifecycleEvent => (LIFECYCLE_EVENTS as readonly string[]).includes(e), {
      message: 'Unknown lifecycle action.',
    }),
});

@Controller('documents/:id/lifecycle')
@UseGuards(SessionGuard)
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get()
  view(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.lifecycle.view(user.id, documentId);
  }

  @Post()
  @HttpCode(200)
  fire(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = fireBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid lifecycle action', parsed.error.issues);
    return this.lifecycle.fire(user.id, documentId, parsed.data.event);
  }
}

@Module({
  imports: [ExportModule],
  controllers: [LifecycleController],
  providers: [LifecycleService, SessionGuard],
})
export class LifecycleModule {}
