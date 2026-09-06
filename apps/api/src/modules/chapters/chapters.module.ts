import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ChaptersController } from './chapters.controller.js';
import { ChaptersService } from './chapters.service.js';
import { SnapshotsService } from './snapshots.service.js';

@Module({
  // For `StyleService`: a chapter save is what crosses the FR-4.7 word threshold.
  imports: [MemoryModule],
  controllers: [ChaptersController],
  providers: [ChaptersService, SnapshotsService, SessionGuard],
  exports: [ChaptersService, SnapshotsService],
})
export class ChaptersModule {}
