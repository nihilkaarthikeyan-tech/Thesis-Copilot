import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { ScholarlyIndexes } from '../../common/scholarly-indexes.service.js';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ChaptersController } from './chapters.controller.js';
import { ChaptersService } from './chapters.service.js';
import { CitationStylesController } from './citation-styles.controller.js';
import { DocumentCitationsController } from './citations.controller.js';
import { CitationsService } from './citations.service.js';
import { CiteParseService } from './cite-parse.service.js';
import { FiguresService } from './figures.service.js';
import { ParaphraseService } from './paraphrase.service.js';
import { SnapshotsService } from './snapshots.service.js';
import { StyleStoreService } from './style-store.service.js';
import { WordImportController } from './word-import.controller.js';
import { WordImportService } from './word-import.service.js';

@Module({
  // For `StyleService`: a chapter save is what crosses the FR-4.7 word threshold.
  imports: [MemoryModule],
  controllers: [
    ChaptersController,
    DocumentCitationsController,
    CitationStylesController,
    WordImportController,
  ],
  providers: [
    WordImportService,
    ChaptersService,
    SnapshotsService,
    CitationsService,
    CiteParseService,
    FiguresService,
    ParaphraseService,
    StyleStoreService,
    QueueService,
    ScholarlyIndexes,
    StorageService,
    SessionGuard,
  ],
  exports: [ChaptersService, SnapshotsService, CitationsService, StyleStoreService],
})
export class ChaptersModule {}
