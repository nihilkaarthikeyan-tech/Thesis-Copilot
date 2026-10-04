import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ChaptersModule } from '../chapters/chapters.module.js';
import { FlagsModule } from '../flags/flags.module.js';
import { CollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';

@Module({
  // For `livingGapMap` (FR-9.7): the gap map follows the library only when the flag is on.
  // `ChaptersModule` for `SnapshotsService`: a merge snapshots every chapter it re-points.
  imports: [FlagsModule, ChaptersModule],
  controllers: [SourcesController, SearchController, CollectionsController],
  providers: [
    SourcesService,
    SearchService,
    CollectionsService,
    StorageService,
    QueueService,
    SessionGuard,
  ],
  exports: [SourcesService, StorageService, QueueService],
})
export class SourcesModule {}
