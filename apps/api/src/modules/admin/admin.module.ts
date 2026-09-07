import { Module } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsModule } from '../flags/flags.module.js';
import { AdminController, FeedbackController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AlertsScheduler } from './alerts.scheduler.js';
import { AlertsService } from './alerts.service.js';
import { FeedbackService } from './feedback.service.js';
import { SuperadminGuard } from './superadmin.guard.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [FlagsModule],
  controllers: [AdminController, FeedbackController],
  providers: [
    AdminService,
    AlertsService,
    AlertsScheduler,
    UsersService,
    FeedbackService,
    SessionGuard,
    SuperadminGuard,
  ],
  exports: [AdminService, AlertsService],
})
export class AdminModule {}
