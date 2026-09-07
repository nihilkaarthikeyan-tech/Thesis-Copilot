import { Module } from '@nestjs/common';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ChaptersModule } from '../chapters/chapters.module.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';
import { ThesisExportService } from './thesis-export.service.js';

@Module({
  // For `CitationsService`: an export renders citations the same way the editor does.
  imports: [ChaptersModule],
  controllers: [ExportController],
  providers: [ExportService, ThesisExportService, StorageService, SessionGuard],
  exports: [ExportService, ThesisExportService],
})
export class ExportModule {}
