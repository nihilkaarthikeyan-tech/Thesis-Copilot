/**
 * Worker entrypoint — a separate process from the API, sharing the same codebase (PRD §7.3).
 *
 * PRD §7.5 step 2 moves this to a second VPS with no code change, because BullMQ is Redis-backed.
 * Nothing here may hold state that the API also needs.
 */

import { loadEnv } from '@tc/config';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DEFAULT_JOB_OPTIONS, QUEUE_NOOP } from './queues.js';

async function main(): Promise<void> {
  const env = loadEnv();

  // BullMQ requires maxRetriesPerRequest: null on the connection it blocks on.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue(QUEUE_NOOP, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });

  const worker = new Worker(
    QUEUE_NOOP,
    async (job) => {
      console.log(
        JSON.stringify({
          level: 30,
          msg: 'job processed',
          queue: QUEUE_NOOP,
          jobId: job.id,
          name: job.name,
          attempt: job.attemptsMade + 1,
        }),
      );
      return { ok: true };
    },
    { connection, concurrency: 4 },
  );

  worker.on('failed', (job, error) => {
    console.error(
      JSON.stringify({
        level: 50,
        msg: 'job failed',
        queue: QUEUE_NOOP,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        error: error.message,
      }),
    );
  });

  console.log(
    JSON.stringify({ level: 30, msg: 'worker ready', queues: [QUEUE_NOOP], concurrency: 4 }),
  );

  const shutdown = async (): Promise<void> => {
    console.log(JSON.stringify({ level: 30, msg: 'worker shutting down' }));
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
