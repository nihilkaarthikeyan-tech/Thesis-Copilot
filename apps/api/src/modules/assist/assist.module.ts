import { Module } from '@nestjs/common';
import { RedisService } from '../../common/redis.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { UsageModule } from '../usage/usage.module.js';
import { AssistController } from './assist.controller.js';
import { AssistService } from './assist.service.js';
import { CitationsController } from './citations.controller.js';
import { CiteService } from './cite.service.js';
import { ContextService } from './context.service.js';

@Module({
  imports: [UsageModule],
  controllers: [AssistController, CitationsController],
  providers: [AssistService, CiteService, ContextService, RedisService, SessionGuard],
  exports: [AssistService, CiteService, ContextService],
})
export class AssistModule {}
