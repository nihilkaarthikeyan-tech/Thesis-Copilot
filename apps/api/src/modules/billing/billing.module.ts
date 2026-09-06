import { Module } from '@nestjs/common';
import { ConsoleMailer, MAILER } from '../../common/mailer.js';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { InvoicesService } from './invoices.service.js';
import { RenewalScheduler } from './renewal.scheduler.js';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    InvoicesService,
    RenewalScheduler,
    StorageService,
    SessionGuard,
    // Renewal reminders and the cancellation confirmation go through the same seam as the §14
    // alerts; real delivery is one implementation away (docs/PENDING.md).
    { provide: MAILER, useClass: ConsoleMailer },
  ],
  exports: [BillingService, InvoicesService],
})
export class BillingModule {}
