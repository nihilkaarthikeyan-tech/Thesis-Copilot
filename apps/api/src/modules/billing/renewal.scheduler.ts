/**
 * Renewal reminders — PRD FR-9.5, §2.5, PHASES v2 W11.2.
 *
 * Hourly while the API is up. The service is idempotent per period (an `AuditEvent` per user per
 * renewal date), so a missed tick sends late rather than not at all, and a restart storm does not
 * send twice. Off under test, where the reminder is triggered directly.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BillingService } from './billing.service.js';

const EVERY_HOUR = 60 * 60_000;

@Injectable()
export class RenewalScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RenewalScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly billing: BillingService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.billing
        .sendRenewalReminders()
        .then(({ sent }) => {
          if (sent > 0) this.logger.log({ sent }, 'renewal reminders sent');
        })
        .catch((error: unknown) => this.logger.warn({ error }, 'renewal reminders'));
    }, EVERY_HOUR);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
