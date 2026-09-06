import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ChaptersController } from './chapters.controller.js';
import { ChaptersService } from './chapters.service.js';
import { DocumentCitationsController } from './citations.controller.js';
import { CitationsService } from './citations.service.js';
import { CiteParseService } from './cite-parse.service.js';
import { SnapshotsService } from './snapshots.service.js';

@Module({
  // For `StyleService`: a chapter save is what crosses the FR-4.7 word threshold.
  imports: [MemoryModule],
  controllers: [ChaptersController, DocumentCitationsController],
  providers: [
    ChaptersService,
    SnapshotsService,
    CitationsService,
    CiteParseService,
    QueueService,
    SessionGuard,
  ],
  exports: [ChaptersService, SnapshotsService, CitationsService],
})
export class ChaptersModule {}
