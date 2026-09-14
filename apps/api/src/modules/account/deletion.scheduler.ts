/**
 * The clock behind account deletion — PRD §12.2.
 *
 * Every ten minutes while the API is up, erase whatever has sat out its grace period. Frequent
 * because the work is a single indexed query that finds nothing almost every time, and because a
 * student who asked to be forgotten should not wait on a cron window once the week is over.
 *
 * `erase` is idempotent, so a restart mid-sweep repeats rather than skips, and one account
 * failing does not stop the rest — a bucket outage should delay one erasure, not all of them.
 * Off under test, where the service is called directly.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DeletionService } from './deletion.service.js';

const EVERY_TEN_MINUTES = 10 * 60_000;

@Injectable()
export class DeletionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeletionScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deletion: DeletionService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), EVERY_TEN_MINUTES);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now: Date = new Date()): Promise<{ erased: number; failed: number }> {
    let erased = 0;
    let failed = 0;
    try {
      const due = await this.deletion.due(now);
      for (const userId of due) {
        try {
          await this.deletion.erase(userId, now);
          erased += 1;
        } catch (error) {
          failed += 1;
          this.logger.error({ userId, error }, 'could not erase an account; will retry next sweep');
        }
      }
    } catch (error) {
      this.logger.warn({ error }, 'deletion sweep');
    }
    if (erased > 0 || failed > 0) this.logger.log({ erased, failed }, 'deletion sweep');
    return { erased, failed };
  }
}
