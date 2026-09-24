/** Saved prompts (ADR-0019). */

import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { PromptsController } from './prompts.controller.js';
import { PromptsService } from './prompts.service.js';

@Module({
  controllers: [PromptsController],
  providers: [PromptsService, SessionGuard],
})
export class PromptsModule {}
