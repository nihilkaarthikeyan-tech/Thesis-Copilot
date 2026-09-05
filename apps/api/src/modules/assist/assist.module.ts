import { Module } from '@nestjs/common';
import { RedisService } from '../../common/redis.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { UsageModule } from '../usage/usage.module.js';
import { AssistController } from './assist.controller.js';
import { AssistService } from './assist.service.js';
import { ContextService } from './context.service.js';

@Module({
  imports: [UsageModule],
  controllers: [AssistController],
  providers: [AssistService, ContextService, RedisService, SessionGuard],
  exports: [AssistService, ContextService],
})
export class AssistModule {}
