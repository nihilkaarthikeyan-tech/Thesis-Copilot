import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ChaptersModule } from '../chapters/chapters.module.js';
import { FlagsModule } from '../flags/flags.module.js';
import { CollabService } from './collab.service.js';

/** ADR-0028: the live co-authoring rooms. Served only where `COLLAB_ENABLED` is set. */
@Module({
  imports: [AuthModule, ChaptersModule, FlagsModule],
  providers: [CollabService],
  exports: [CollabService],
})
export class CollabModule {}
