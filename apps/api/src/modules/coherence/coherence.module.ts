import { Module } from '@nestjs/common';
import { QueueService } from '../../common/queue.service.js';
import { RedisService } from '../../common/redis.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { UsageModule } from '../usage/usage.module.js';
import { CoherenceController } from './coherence.controller.js';
import { CoherenceService } from './coherence.service.js';
import { ExaminerReviewController } from './examiner-review.controller.js';
import { ExaminerReviewService } from './examiner-review.service.js';

@Module({
  imports: [UsageModule],
  controllers: [CoherenceController, ExaminerReviewController],
  providers: [CoherenceService, ExaminerReviewService, QueueService, RedisService, SessionGuard],
  exports: [CoherenceService],
})
export class CoherenceModule {}
