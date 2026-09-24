import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsModule } from '../flags/flags.module.js';
import { DocumentsController } from './documents.controller.js';
import { NextActionService, SetupProgressService } from './next-action.service.js';
import { ProgressService } from './progress.service.js';

@Module({
  imports: [FlagsModule],
  controllers: [DocumentsController],
  providers: [SessionGuard, NextActionService, SetupProgressService, ProgressService],
})
export class DocumentsModule {}
