import { Module } from '@nestjs/common';
import { ConsoleMailer, MAILER } from '../../common/mailer.js';
import { SessionGuard } from '../auth/session.guard.js';
import { FlagsModule } from '../flags/flags.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AlertsScheduler } from './alerts.scheduler.js';
import { AlertsService } from './alerts.service.js';
import { SuperadminGuard } from './superadmin.guard.js';

@Module({
  imports: [FlagsModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AlertsService,
    AlertsScheduler,
    SessionGuard,
    SuperadminGuard,
    // Real delivery needs RESEND_API_KEY or SMTP_* (docs/PENDING.md). Until then every
    // environment gets the console mailer, which records what it would have sent.
    { provide: MAILER, useClass: ConsoleMailer },
  ],
  exports: [AdminService, AlertsService, MAILER],
})
export class AdminModule {}
