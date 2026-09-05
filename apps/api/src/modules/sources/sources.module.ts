import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';

@Module({
  controllers: [SourcesController],
  providers: [SourcesService, StorageService, QueueService, SessionGuard],
  exports: [SourcesService, StorageService, QueueService],
})
export class SourcesModule {}
