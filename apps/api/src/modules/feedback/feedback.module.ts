import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { StorageService } from '../../common/storage.service.js';
import { AssistModule } from '../assist/assist.module.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ChaptersModule } from '../chapters/chapters.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { CommentsService } from './comments.service.js';
import { DocxImportService } from './docx-import.service.js';
import { FeedbackController, GuideController, ReadLinkController } from './feedback.controller.js';
import { FeedbackExportService } from './feedback-export.service.js';
import { ReviewService } from './review.service.js';
import { ShareLinkService } from './share-link.service.js';
import { SharesService } from './shares.service.js';

@Module({
  // ContextService (memory + retrieval for A.14) and SnapshotsService (the pre-revision snapshot).
  imports: [AssistModule, ChaptersModule, UsageModule],
  controllers: [FeedbackController, GuideController, ReadLinkController],
  providers: [
    SharesService,
    ShareLinkService,
    CommentsService,
    ReviewService,
    FeedbackExportService,
    DocxImportService,
    StorageService,
    QueueService,
    SessionGuard,
  ],
  exports: [SharesService, CommentsService],
})
export class FeedbackModule {}
