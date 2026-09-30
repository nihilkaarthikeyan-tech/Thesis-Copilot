import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { RedisService } from '../../common/redis.service.js';
import { ScholarlyIndexes } from '../../common/scholarly-indexes.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsModule } from '../flags/flags.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { AssistController } from './assist.controller.js';
import { AssistService } from './assist.service.js';
import { AutoSourcesService } from './auto-sources.service.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { CitationsController } from './citations.controller.js';
import { CiteService } from './cite.service.js';
import { CiteRoleService } from './cite-role.service.js';
import { CommandService } from './command.service.js';
import { ContextService } from './context.service.js';
import { DraftController } from './draft.controller.js';
import { DraftService } from './draft.service.js';
import { ProofreadService } from './proofread.service.js';
import { WebScopeService } from './web-scope.service.js';

@Module({
  imports: [UsageModule, FlagsModule],
  controllers: [AssistController, CitationsController, DraftController, ChatController],
  providers: [
    AssistService,
    AutoSourcesService,
    ChatService,
    WebScopeService,
    CiteRoleService,
    CommandService,
    CiteService,
    ContextService,
    DraftService,
    ProofreadService,
    QueueService,
    RedisService,
    ScholarlyIndexes,
    SessionGuard,
  ],
  exports: [
    AssistService,
    CiteService,
    ChatService,
    CiteRoleService,
    CommandService,
    ContextService,
    DraftService,
  ],
})
export class AssistModule {}
