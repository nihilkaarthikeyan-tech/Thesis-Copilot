/**
 * Runs the §14 alert evaluation every 15 minutes while the API is up (PHASES 4.6).
 *
 * A missed tick is harmless: the next one evaluates the same durable record. Off under test,
 * where the test forces an evaluation through `POST /admin/alerts/evaluate` instead.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ALERT, AlertsService } from './alerts.service.js';

@Injectable()
export class AlertsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly alerts: AlertsService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () => void this.alerts.evaluate().catch((error) => this.logger.warn({ error }, 'alerts')),
      ALERT.windowMinutes * 60_000,
    );
    // Do not keep a shutting-down process alive for a timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
