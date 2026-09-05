/**
 * Job producer — PRD §7.2 (BullMQ on Redis, a separate worker process).
 *
 * The API only ever enqueues; the worker consumes. Queue names, payload shapes and the retry
 * policy are shared with `apps/worker` through `@tc/types`, so a typo cannot silently create a
 * second queue that nothing reads.
 */

import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Env } from '@tc/config';
import { JOB_RETRY, type JobPayloads, type QueueName } from '@tc/types';
import { type JobsOptions, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV } from './env.token.js';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queues = new Map<QueueName, Queue>();

  constructor(@Inject(ENV) env: Env) {
    // BullMQ requires `maxRetriesPerRequest: null` on connections it blocks on.
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  private queue(name: QueueName): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const queue = new Queue(name, {
      connection: this.connection,
      defaultJobOptions: JOB_RETRY as JobsOptions,
    });
    this.queues.set(name, queue);
    return queue;
  }

  /**
   * Enqueues a job. `jobId` makes the enqueue idempotent: BullMQ ignores a second add with an id
   * it already holds, so a retried HTTP request cannot start the same extraction twice.
   */
  async enqueue<N extends QueueName>(
    name: N,
    payload: JobPayloads[N],
    options: { jobId?: string; delayMs?: number } = {},
  ): Promise<string | undefined> {
    const job = await this.queue(name).add(name, payload, {
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(options.delayMs ? { delay: options.delayMs } : {}),
    });
    return job.id;
  }

  /** Queue depth, for the `/metrics` gauge in PRD §14. */
  async counts(name: QueueName): Promise<Record<string, number>> {
    return this.queue(name).getJobCounts();
  }

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) await queue.close();
    await this.connection.quit();
  }
}
