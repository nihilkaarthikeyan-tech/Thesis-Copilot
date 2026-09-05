import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';

@Module({
  controllers: [SourcesController, SearchController],
  providers: [SourcesService, SearchService, StorageService, QueueService, SessionGuard],
  exports: [SourcesService, StorageService, QueueService],
})
export class SourcesModule {}
