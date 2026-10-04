/**
 * The "someone is looking" heartbeat for long jobs — ADR-0058.
 *
 * The pages that show a running search, chapter build, examiner review or coherence check poll
 * the API; a poll from a visible tab carries `?watching=1`, and the controller stamps
 * `job-watch:<runId>` in Redis with the time. The worker reads the stamp when the job ends and
 * emails the student only when nobody has looked for a while. A stamp is a convenience: a Redis
 * fault here is swallowed, never a failed poll.
 */

import { Global, Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import type { Env } from '@tc/config';
import { JOB_WATCH, jobWatchKey } from '@tc/types';
import { Redis } from 'ioredis';
import { ENV } from './env.token.js';

/** `?watching=1` (or `true`) — anything else is a background poll and stamps nothing. */
export function isWatching(value: unknown): boolean {
  return value === '1' || value === 'true';
}

@Injectable()
export class JobWatchService implements OnModuleDestroy {
  private readonly logger = new Logger(JobWatchService.name);
  private readonly redis: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  /** Stamps each run as looked at now. Only call after the caller's ownership check. */
  async touch(runIds: readonly string[], now = Date.now()): Promise<void> {
    if (runIds.length === 0) return;
    try {
      await Promise.all(
        runIds.map((id) =>
          this.redis.set(jobWatchKey(id), String(now), 'EX', JOB_WATCH.ttlSeconds),
        ),
      );
    } catch (error) {
      this.logger.warn({ error: String(error) }, 'job-watch heartbeat not written');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}

@Global()
@Module({ providers: [JobWatchService], exports: [JobWatchService] })
export class JobWatchModule {}
