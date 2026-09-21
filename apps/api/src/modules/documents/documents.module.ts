import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { DocumentsController } from './documents.controller.js';
import { NextActionService, SetupProgressService } from './next-action.service.js';
import { ProgressService } from './progress.service.js';

@Module({
  controllers: [DocumentsController],
  providers: [SessionGuard, NextActionService, SetupProgressService, ProgressService],
})
export class DocumentsModule {}
