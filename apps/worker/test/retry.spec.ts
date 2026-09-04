/**
 * Worker retry policy — PHASES.md task 0.7: "a test that enqueues a job that throws and asserts it
 * lands in the failed set after retries."
 *
 * Runs against a real Redis, because the behaviour under test is BullMQ's, not ours.
 */

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_JOB_OPTIONS, QUEUE_NOOP } from '../src/queues.js';

let container: StartedRedisContainer;
let connection: Redis;

beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start();
  connection = new Redis(container.getConnectionUrl(), { maxRetriesPerRequest: null });
}, 180_000);

afterAll(async () => {
  connection?.disconnect();
  await container?.stop();
});

describe('queue configuration', () => {
  it('retries three times with exponential backoff', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 1_000 });
  });

  it('keeps failed jobs, so the failure-rate alert in §14 has something to count', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBeDefined();
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).not.toBe(true);
  });
});

describe('a job that throws', () => {
  it('is retried three times and then lands in the failed set', async () => {
    const queueName = `${QUEUE_NOOP}-failing-${Date.now()}`;
    const queue = new Queue(queueName, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    const events = new QueueEvents(queueName, { connection: connection.duplicate() });
    await events.waitUntilReady();

    let attempts = 0;
    const worker = new Worker(
      queueName,
      async () => {
        attempts++;
        throw new Error('deliberate failure');
      },
      {
        connection: connection.duplicate(),
        // Short backoff so the test does not wait 1s + 2s + 4s.
        settings: { backoffStrategy: () => 10 },
      },
    );

    const failed = new Promise<{ failedReason: string }>((resolve) => {
      worker.on('failed', (job, error) => {
        if (job && job.attemptsMade >= 3) resolve({ failedReason: error.message });
      });
    });

    const job = await queue.add('explode', { any: 'payload' });
    const result = await failed;

    expect(result.failedReason).toBe('deliberate failure');
    expect(attempts).toBe(3);

    // It is in the failed set, not silently dropped.
    const failedJobs = await queue.getFailed();
    expect(failedJobs.map((j) => j.id)).toContain(job.id);

    const state = await job.getState();
    expect(state).toBe('failed');

    await worker.close();
    await events.close();
    await queue.close();
  });

  it('a job that succeeds completes on the first attempt', async () => {
    const queueName = `${QUEUE_NOOP}-ok-${Date.now()}`;
    const queue = new Queue(queueName, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });

    let runs = 0;
    const worker = new Worker(
      queueName,
      async () => {
        runs++;
        return { ok: true };
      },
      { connection: connection.duplicate() },
    );

    const completed = new Promise<void>((resolve) => {
      worker.on('completed', () => resolve());
    });

    await queue.add('fine', {});
    await completed;

    expect(runs).toBe(1);

    await worker.close();
    await queue.close();
  });
});
