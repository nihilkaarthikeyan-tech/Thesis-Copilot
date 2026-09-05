import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { ChaptersController } from './chapters.controller.js';
import { ChaptersService } from './chapters.service.js';
import { SnapshotsService } from './snapshots.service.js';

@Module({
  controllers: [ChaptersController],
  providers: [ChaptersService, SnapshotsService, SessionGuard],
  exports: [ChaptersService, SnapshotsService],
})
export class ChaptersModule {}
