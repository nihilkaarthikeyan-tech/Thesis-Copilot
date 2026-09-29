import { Module } from '@nestjs/common';
import { DocumentEraser } from '../../common/document-eraser.service.js';
import { QueueService } from '../../common/queue.service.js';
import { StorageService } from '../../common/storage.service.js';
import { AccountModule } from '../account/account.module.js';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsModule } from '../flags/flags.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { AdminController, FeedbackController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AlertsScheduler } from './alerts.scheduler.js';
import { AlertsService } from './alerts.service.js';
import { AdminControlsController } from './controls.controller.js';
import { AdminControlsService } from './controls.service.js';
import { FeedbackService } from './feedback.service.js';
import { AdminInsightService } from './insight.service.js';
import { SuperadminGuard } from './superadmin.guard.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [FlagsModule, UsageModule, AccountModule],
  controllers: [AdminController, AdminControlsController, FeedbackController],
  providers: [
    AdminService,
    AlertsService,
    AlertsScheduler,
    UsersService,
    FeedbackService,
    AdminControlsService,
    AdminInsightService,
    QueueService,
    StorageService,
    DocumentEraser,
    SessionGuard,
    SuperadminGuard,
  ],
  exports: [AdminService, AlertsService],
})
export class AdminModule {}
