import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { RedisService } from '../../common/redis.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsModule } from '../flags/flags.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { AssistController } from './assist.controller.js';
import { AssistService } from './assist.service.js';
import { CitationsController } from './citations.controller.js';
import { CiteService } from './cite.service.js';
import { ContextService } from './context.service.js';
import { DraftController } from './draft.controller.js';
import { DraftService } from './draft.service.js';

@Module({
  imports: [UsageModule, FlagsModule],
  controllers: [AssistController, CitationsController, DraftController],
  providers: [
    AssistService,
    CiteService,
    ContextService,
    DraftService,
    QueueService,
    RedisService,
    SessionGuard,
  ],
  exports: [AssistService, CiteService, ContextService, DraftService],
})
export class AssistModule {}
