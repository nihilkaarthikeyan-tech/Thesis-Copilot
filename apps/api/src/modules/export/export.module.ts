import { Module } from '@nestjs/common';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

@Module({
  controllers: [ExportController],
  providers: [ExportService, StorageService, SessionGuard],
  exports: [ExportService],
})
export class ExportModule {}
