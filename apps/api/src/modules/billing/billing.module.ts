import { Module } from '@nestjs/common';
import { StorageService } from '../../common/storage.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { InvoicesService } from './invoices.service.js';
import { RenewalScheduler } from './renewal.scheduler.js';

@Module({
  controllers: [BillingController],
  providers: [BillingService, InvoicesService, RenewalScheduler, StorageService, SessionGuard],
  exports: [BillingService, InvoicesService],
})
export class BillingModule {}
