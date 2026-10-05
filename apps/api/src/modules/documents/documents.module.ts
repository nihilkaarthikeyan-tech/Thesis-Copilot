import { Module } from '@nestjs/common';
import { DocumentEraser } from '../../common/document-eraser.service.js';
import { RedisService } from '../../common/redis.service.js';
import { StorageService } from '../../common/storage.service.js';
import { AssistModule } from '../assist/assist.module.js';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsModule } from '../flags/flags.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ClaimsService } from './claims.service.js';
import { DocumentCopier } from './document-copier.service.js';
import { DocumentsController } from './documents.controller.js';
import { NextActionService, SetupProgressService } from './next-action.service.js';
import { OwnThesisDeletion } from './own-thesis-deletion.service.js';
import { ProgressService } from './progress.service.js';

@Module({
  imports: [FlagsModule, AssistModule, MemoryModule],
  controllers: [DocumentsController],
  providers: [
    SessionGuard,
    NextActionService,
    SetupProgressService,
    ProgressService,
    OwnThesisDeletion,
    DocumentCopier,
    DocumentEraser,
    StorageService,
    ClaimsService,
    RedisService,
  ],
})
export class DocumentsModule {}
