/**
 * Worker entrypoint — a separate process from the API, sharing the same codebase (PRD §7.3).
 *
 * PRD §7.5 step 2 moves this to a second VPS with no code change, because BullMQ is Redis-backed
 * and every file is in object storage. Nothing here may hold state the API also needs.
 */

import {
  createProviders,
  MockEmbeddingProvider,
  MockLlmProvider,
  mockExtractionResponse,
  type Providers,
} from '@tc/ai';
import { type Env, loadEnv } from '@tc/config';
import { PrismaClient } from '@tc/db';
import { type ExtractPaperJob, jobId, jobKeyDigest } from '@tc/types';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Client as MinioClient } from 'minio';
import { runExtractPaper } from './jobs/extract-paper.js';
import { DEFAULT_JOB_OPTIONS, QUEUE_EXTRACT_PAPER, QUEUE_NOOP } from './queues.js';

const log = (event: Record<string, unknown>): void => {
  console.log(JSON.stringify({ level: 30, time: Date.now(), ...event }));
};

function providersFor(env: Env): Providers {
  if (env.AI_PROVIDER === 'mock') {
    return {
      llm: new MockLlmProvider({
        latencyMs: env.AI_MOCK_LATENCY_MS,
        // An EXTRACT request is answered from the paper's own text, so an upload still yields a
        // usable proposal screen and library before real provider keys exist. It invents nothing.
        responses: [mockExtractionResponse],
        modelIds: { fast: env.AI_FAST_MODEL, strong: env.AI_STRONG_MODEL },
      }),
      embeddings: new MockEmbeddingProvider({ dims: env.EMBED_DIMS, modelId: env.AI_EMBED_MODEL }),
    };
  }
  return createProviders(env);
}

function storageFor(env: Env): { get: (key: string) => Promise<Buffer> } {
  const endpoint = new URL(env.S3_ENDPOINT);
  const client = new MinioClient({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
    useSSL: endpoint.protocol === 'https:',
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    region: env.S3_REGION,
  });

  return {
    async get(key: string): Promise<Buffer> {
      const stream = await client.getObject(env.S3_BUCKET, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    },
  };
}

async function main(): Promise<void> {
  const env = loadEnv();

  // BullMQ requires `maxRetriesPerRequest: null` on the connection it blocks on.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const prisma = new PrismaClient();
  await prisma.$connect();

  const providers = providersFor(env);
  const storage = storageFor(env);

  const resolveQueue = new Queue('resolve-reference', {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  const workers = [
    new Worker(
      QUEUE_EXTRACT_PAPER,
      async (job: Job<ExtractPaperJob>) => {
        const result = await runExtractPaper(job.data, {
          prisma,
          llm: providers.llm,
          getObject: (key) => storage.get(key),
          enqueueResolve: (input) =>
            resolveQueue.add('resolve-reference', input, {
              jobId: jobId('resolve-reference', input.documentId, jobKeyDigest(input.rawReference)),
            }),
          log: (event) => log({ jobId: job.id, ...event }),
        });
        log({ msg: 'extract-paper done', jobId: job.id, ...result });
        return result;
      },
      // One paper at a time per worker: extraction is a Strong-tier call and holds a whole paper
      // in memory. Throughput comes from running more worker processes (§7.5).
      { connection: connection.duplicate(), concurrency: 1 },
    ),

    new Worker(QUEUE_NOOP, async (job) => ({ ok: true, id: job.id }), {
      connection: connection.duplicate(),
      concurrency: 4,
    }),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      console.error(
        JSON.stringify({
          level: 50,
          time: Date.now(),
          msg: 'job failed',
          queue: worker.name,
          jobId: job?.id,
          attempt: job?.attemptsMade,
          error: error.message,
        }),
      );
    });
  }

  log({ msg: 'worker ready', queues: workers.map((w) => w.name), provider: env.AI_PROVIDER });

  const shutdown = async (): Promise<void> => {
    log({ msg: 'worker shutting down' });
    await Promise.all(workers.map((w) => w.close()));
    await resolveQueue.close();
    await prisma.$disconnect();
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
