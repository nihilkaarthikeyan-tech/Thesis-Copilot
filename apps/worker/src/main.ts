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
  mockCoherenceResponse,
  mockCrossPaperResponse,
  mockDraftFor,
  mockExtractionResponse,
  mockOutlineResponse,
  mockQueriesResponse,
  mockSectionScopeResponse,
  mockThemesResponse,
  type Providers,
} from '@tc/ai';
import { computeCallCost, computeEmbeddingCost, type Env, loadEnv } from '@tc/config';
import { PrismaClient } from '@tc/db';
import {
  ARXIV,
  ArxivClient,
  buildChapterMemory,
  type ContextChapter,
  type ContextClient,
  CoreClient,
  CrossrefClient,
  extractDocument,
  OpenAlexClient,
  OpenAlexDiscovery,
  PUBMED,
  PubMedClient,
  retrievePassages,
  SemanticScholarClient,
  sharedGate,
  UnpaywallClient,
} from '@tc/retrieval';
import {
  type CoherenceRunJob,
  type DraftSectionJob,
  type ExtractPaperJob,
  type GenerateOutlineJob,
  type IndexSourceJob,
  jobId,
  jobKeyDigest,
  type ResolveReferenceJob,
  type SearchLiteratureJob,
} from '@tc/types';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Client as MinioClient } from 'minio';
import { runCoherence } from './jobs/coherence-run.js';
import { runCrossPaper } from './jobs/cross-paper.js';
import { runDraftSection } from './jobs/draft-section.js';
import { runExtractPaper } from './jobs/extract-paper.js';
import { runGenerateOutline } from './jobs/generate-outline.js';
import { runIndexSource } from './jobs/index-source.js';
import {
  isRetryExhausted,
  markUnresolvedAfterRetries,
  runResolveReference,
} from './jobs/resolve-reference.js';
import { runSearchLiterature } from './jobs/search-literature.js';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_COHERENCE,
  QUEUE_DRAFT_SECTION,
  QUEUE_EXTRACT_PAPER,
  QUEUE_GENERATE_OUTLINE,
  QUEUE_INDEX_SOURCE,
  QUEUE_NOOP,
  QUEUE_RESOLVE_REFERENCE,
  QUEUE_SEARCH_LITERATURE,
} from './queues.js';
import { captureException, initSentry } from './sentry.js';

const log = (event: Record<string, unknown>): void => {
  console.log(JSON.stringify({ level: 30, time: Date.now(), ...event }));
};

function providersFor(env: Env): Providers {
  if (env.AI_PROVIDER === 'mock') {
    return {
      llm: new MockLlmProvider({
        // A DRAFT request gets an A.2-shaped answer built from its own passages, so the whole
        // draft path is exercisable before provider keys exist. Nothing is invented: each
        // sentence restates the passage it cites.
        defaultText: (req) => (req.action === 'DRAFT' ? mockDraftFor(req) : 'Mock text.'),
        latencyMs: env.AI_MOCK_LATENCY_MS,
        // An EXTRACT request is answered from the paper's own text, so an upload still yields a
        // usable proposal screen and library before real provider keys exist. It invents nothing.
        // Themes before queries: both are SEARCH_QUERIES calls, told apart by <candidates>.
        responses: [
          mockExtractionResponse,
          mockCrossPaperResponse,
          mockCoherenceResponse,
          mockThemesResponse,
          mockQueriesResponse,
          // FR-3.6 is also an OUTLINE call; it is matched first by its `<target>` block.
          mockSectionScopeResponse,
          mockOutlineResponse,
        ],
        modelIds: { fast: env.AI_FAST_MODEL, strong: env.AI_STRONG_MODEL },
      }),
      embeddings: new MockEmbeddingProvider({ dims: env.EMBED_DIMS, modelId: env.AI_EMBED_MODEL }),
    };
  }
  return createProviders(env);
}

function storageFor(env: Env): {
  get: (key: string) => Promise<Buffer>;
  put: (key: string, body: Buffer) => Promise<unknown>;
} {
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
    async put(key: string, body: Buffer) {
      return client.putObject(env.S3_BUCKET, key, body, body.length, {
        'content-type': 'application/pdf',
      });
    },
  };
}

/**
 * One AiCallLog row per bulk embedding (2026-09-25): the tokens Voyage reported, priced by
 * `computeEmbeddingCost`, so `UsageService`'s ₹100 ceiling and the §14 alerts include it. The
 * mock logs zero cost but the row still lands, as every other action does.
 */
const logEmbed =
  (prisma: PrismaClient, env: Env) =>
  async (call: {
    userId: string;
    documentId: string;
    tokens: number;
    latencyMs: number;
    ok: boolean;
    error?: string;
  }) => {
    const cost = call.ok && env.EMBED_PROVIDER !== 'mock' ? computeEmbeddingCost(call.tokens) : 0;
    await prisma.aiCallLog.create({
      data: {
        userId: call.userId,
        documentId: call.documentId,
        action: 'EMBED',
        model: env.AI_EMBED_MODEL,
        inputTokens: call.tokens,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        costMicroInr: BigInt(cost),
        latencyMs: call.latencyMs,
        ok: call.ok,
        error: call.error ?? null,
      },
    });
  };

async function main(): Promise<void> {
  const env = loadEnv();
  initSentry(env.SENTRY_DSN, 'worker');

  // BullMQ requires `maxRetriesPerRequest: null` on the connection it blocks on.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const prisma = new PrismaClient();
  await prisma.$connect();

  const providers = providersFor(env);
  const storage = storageFor(env);

  const resolveQueue = new Queue(QUEUE_RESOLVE_REFERENCE, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const indexQueue = new Queue('index-source', {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  // Crossref, OpenAlex and Unpaywall need no API key, only a contact address for their polite
  // pools (PRD §13.3). Set a real one before any real use — see docs/PENDING.md.
  //
  // Unpaywall returns HTTP 422 for the placeholder address rather than an explanation, which
  // looks exactly like an outage in the logs. Say so plainly at boot instead.
  const placeholders = (
    [
      ['CROSSREF_MAILTO', env.CROSSREF_MAILTO],
      ['OPENALEX_MAILTO', env.OPENALEX_MAILTO],
      ['UNPAYWALL_EMAIL', env.UNPAYWALL_EMAIL],
    ] as const
  ).filter(([, value]) => /@example\.(com|org|net)$/i.test(value));
  if (placeholders.length > 0) {
    log({
      level: 40,
      msg: 'scholarly contact address is still a placeholder',
      variables: placeholders.map(([name]) => name),
      consequence: 'Unpaywall refuses these with HTTP 422, so no source will reach FULL_TEXT',
      fix: 'set a real contact address in .env — docs/PENDING.md',
    });
  }

  // Its own connection: the slot checks must never queue behind a BullMQ command.
  const gateStore = connection.duplicate();
  const scholarly = {
    crossref: new CrossrefClient({ mailto: env.CROSSREF_MAILTO }),
    openalex: new OpenAlexClient({
      mailto: env.OPENALEX_MAILTO,
      ...(env.OPENALEX_API_KEY ? { apiKey: env.OPENALEX_API_KEY } : {}),
    }),
    unpaywall: new UnpaywallClient({ mailto: env.UNPAYWALL_EMAIL }),
    // FR-2.2's full-text fallback; the key is optional (PRD §13.3), so without it there is no client.
    core: env.CORE_API_KEY
      ? new CoreClient(env.CORE_API_KEY, { mailto: env.UNPAYWALL_EMAIL })
      : null,
    // FR-2.5 discovery: OpenAlex primary, Semantic Scholar only when a key exists (PRD 13.3).
    discovery: new OpenAlexDiscovery({
      mailto: env.OPENALEX_MAILTO,
      ...(env.OPENALEX_API_KEY ? { apiKey: env.OPENALEX_API_KEY } : {}),
    }),
    semanticScholar: env.SEMANTIC_SCHOLAR_API_KEY
      ? new SemanticScholarClient(env.SEMANTIC_SCHOLAR_API_KEY, { mailto: env.OPENALEX_MAILTO })
      : null,
    // ADR-0020. arXiv and NCBI count requests per operator, not per process, so this worker and
    // the API take turns through one slot each in Redis rather than a limiter apiece.
    arxiv: new ArxivClient({
      mailto: env.OPENALEX_MAILTO,
      gate: sharedGate('arxiv', gateStore, 'scholarly:slot:arxiv', ARXIV.intervalMs),
    }),
    pubmed: new PubMedClient({
      mailto: env.OPENALEX_MAILTO,
      apiKey: env.NCBI_API_KEY ?? null,
      gate: sharedGate(
        'pubmed',
        gateStore,
        'scholarly:slot:ncbi',
        env.NCBI_API_KEY ? PUBMED.intervalMs.withKey : PUBMED.intervalMs.withoutKey,
      ),
    }),
  };

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
        // FR-1.6: once two or more papers are read, compare them. Its failure is its own.
        try {
          const xpaper = await runCrossPaper(
            { documentId: job.data.documentId, userId: job.data.userId },
            {
              prisma,
              llm: providers.llm,
              aiProvider: env.AI_PROVIDER,
              log: (event) => log({ jobId: job.id, ...event }),
            },
          );
          if (!xpaper.ran) log({ msg: 'cross-paper skipped', jobId: job.id, ...xpaper });
        } catch (error) {
          captureException(error, { queue: 'cross-paper', documentId: job.data.documentId });
          log({ level: 50, msg: 'cross-paper failed', jobId: job.id, error: String(error) });
        }
        return result;
      },
      // One paper at a time per worker: extraction is a Strong-tier call and holds a whole paper
      // in memory. Throughput comes from running more worker processes (§7.5).
      { connection: connection.duplicate(), concurrency: 1 },
    ),

    new Worker(
      QUEUE_RESOLVE_REFERENCE,
      async (job: Job<ResolveReferenceJob>) => {
        const result = await runResolveReference(job.data, {
          prisma,
          ...scholarly,
          enqueueIndex: (input) =>
            indexQueue.add('index-source', input, {
              jobId: jobId(
                'index-source',
                input.sourceId,
                jobKeyDigest(input.contentKey ?? 'none'),
              ),
            }),
          log: (event) => log({ jobId: job.id, ...event }),
        });
        return result;
      },
      // A handful at a time: the clients rate-limit themselves to the polite 5 req/s, and running
      // more in parallel would only queue behind that limiter.
      { connection: connection.duplicate(), concurrency: 3 },
    ),

    new Worker(
      QUEUE_INDEX_SOURCE,
      async (job: Job<IndexSourceJob>) => {
        const result = await runIndexSource(job.data, {
          prisma,
          embeddings: providers.embeddings,
          unpaywall: scholarly.unpaywall,
          core: scholarly.core,
          getObject: (key) => storage.get(key),
          putObject: (key, body) => storage.put(key, body),
          extract: (bytes) => extractDocument(bytes, 'pdf'),
          logEmbed: logEmbed(prisma, env),
          log: (event) => log({ jobId: job.id, ...event }),
        });
        return result;
      },
      // Downloads a PDF and then embeds it: mostly waiting on the network, but one paper's worth
      // of text in memory at a time per slot.
      { connection: connection.duplicate(), concurrency: 2 },
    ),

    new Worker(
      QUEUE_DRAFT_SECTION,
      async (job: Job<DraftSectionJob & { draftId: string }>) => {
        const result = await runDraftSection(job.data, {
          prisma,
          llm: providers.llm,
          embeddings: providers.embeddings,
          // The same code the API's Assist path uses, so a draft and the suggestion beside it
          // never retrieve from different candidate sets for the same chapter.
          memoryBlock: async (chapter: ContextChapter) =>
            (await buildChapterMemory(prisma as unknown as ContextClient, chapter)).text,
          retrieve: (chapter: ContextChapter, query: string) =>
            retrievePassages(
              prisma as unknown as ContextClient,
              (texts) => providers.embeddings.embed(texts),
              chapter,
              query,
              'DRAFT',
            ),
          strongTier: async () => {
            const flag = await prisma.featureFlag.findUnique({
              where: { key: 'draftModeStrongTier' },
              select: { enabled: true },
            });
            // A.2's tier is behind the flag; absent means the PRD default, which is Strong.
            return flag?.enabled ?? true;
          },
          publish: (event) =>
            connection.publish(`draft:${job.data.draftId}`, JSON.stringify(event)),
          logCall: async (call) => {
            // PHASES 1.4: the mock logs zero cost but the row still lands, so the dashboard's
            // call and token counts are real even before a provider key exists.
            const cost =
              call.ok && call.usage && env.AI_PROVIDER !== 'mock'
                ? computeCallCost({ tier: call.tier, modelId: call.modelId, usage: call.usage })
                : 0;
            await prisma.aiCallLog.create({
              data: {
                userId: call.userId,
                documentId: call.documentId,
                action: 'DRAFT',
                model: call.modelId,
                inputTokens: call.usage?.inputTokens ?? 0,
                cachedInputTokens: call.usage?.cachedInputTokens ?? 0,
                cacheWriteTokens: call.usage?.cacheWriteTokens ?? 0,
                outputTokens: call.usage?.outputTokens ?? 0,
                costMicroInr: BigInt(cost),
                latencyMs: call.latencyMs,
                ok: call.ok,
                error: call.error ?? null,
              },
            });
          },
          log: (event) => log({ jobId: job.id, ...event }),
        });
        return result;
      },
      // One draft at a time per worker: it is the longest call in the product and holds a whole
      // section plus its passages in memory.
      { connection: connection.duplicate(), concurrency: 1 },
    ),

    new Worker(QUEUE_NOOP, async (job) => ({ ok: true, id: job.id }), {
      connection: connection.duplicate(),
      concurrency: 4,
    }),
    new Worker(
      QUEUE_GENERATE_OUTLINE,
      async (job: Job<GenerateOutlineJob>) => {
        const result = await runGenerateOutline(
          { ...job.data, template: job.data.template as never },
          {
            prisma,
            llm: providers.llm,
            aiProvider: env.AI_PROVIDER,
            emptyChapter: (title) => ({
              type: 'doc',
              content: [
                { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
                { type: 'paragraph' },
              ],
            }),
            log: (event) => log({ jobId: job.id, ...event }),
          },
        );
        // The outline screen polls `outlineRun`; clear it whatever the outcome.
        const document = await prisma.document.findUnique({
          where: { id: job.data.documentId },
          select: { meta: true },
        });
        await prisma.document.update({
          where: { id: job.data.documentId },
          data: {
            meta: {
              ...((document?.meta as Record<string, unknown> | null) ?? {}),
              outlineRun: { status: 'DONE', finishedAt: new Date().toISOString() },
            },
          },
        });
        log({ msg: 'generate-outline finished', jobId: job.id, ...result });
        return result;
      },
      { connection, concurrency: 1 },
    ),
    new Worker(
      QUEUE_COHERENCE,
      async (job: Job<CoherenceRunJob>) => {
        try {
          const result = await runCoherence(job.data, {
            prisma,
            llm: providers.llm,
            embeddings: providers.embeddings,
            logEmbed: logEmbed(prisma, env),
            aiProvider: env.AI_PROVIDER,
            // D.1.1 step 3: the sidebar watches the run through the API's SSE endpoint, which
            // subscribes to this channel — the same shape the draft stream uses.
            onProgress: async (event) => {
              await connection.publish(`coherence:${job.data.runId}`, JSON.stringify(event));
            },
            log: (event) => log({ jobId: job.id, ...event }),
          });
          log({ msg: 'coherence finished', jobId: job.id, ...result });
          return result;
        } catch (error) {
          // The document must never be left with a run stuck at RUNNING: that would refuse every
          // later check with "a check is already running".
          const document = await prisma.document.findUnique({
            where: { id: job.data.documentId },
            select: { meta: true },
          });
          const meta = (document?.meta as Record<string, unknown> | null) ?? {};
          const runs =
            (meta.coherenceRuns as Record<string, Record<string, unknown>> | undefined) ?? {};
          if (runs[job.data.runId]) {
            await prisma.document.update({
              where: { id: job.data.documentId },
              data: {
                meta: {
                  ...meta,
                  coherenceRuns: {
                    ...runs,
                    [job.data.runId]: {
                      ...runs[job.data.runId],
                      status: 'FAILED',
                      finishedAt: new Date().toISOString(),
                      error: error instanceof Error ? error.message : String(error),
                    },
                  },
                },
              } as never,
            });
          }
          throw error;
        }
      },
      // D.1.1: "concurrency 2 per worker".
      { connection, concurrency: 2 },
    ),
    new Worker(
      QUEUE_SEARCH_LITERATURE,
      async (job: Job<SearchLiteratureJob>) => {
        const result = await runSearchLiterature(job.data, {
          prisma,
          llm: providers.llm,
          embeddings: providers.embeddings,
          openalex: scholarly.discovery,
          semanticScholar: scholarly.semanticScholar,
          pubmed: scholarly.pubmed,
          arxiv: scholarly.arxiv,
          aiProvider: env.AI_PROVIDER,
          log: (event) => log({ jobId: job.id, ...event }),
        });
        log({ msg: 'search-literature finished', jobId: job.id, ...result });
        return result;
      },
      { connection, concurrency: 2 },
    ),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      captureException(error, { queue: worker.name, jobId: job?.id, attempt: job?.attemptsMade });
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

      // A resolve job that has burned its last attempt would otherwise leave the source at
      // PENDING for good, and the library would show "Looking it up…" forever with no way out.
      // Mark it UNRESOLVED so the student sees "Not found" and the Fix this reference form.
      if (
        worker.name === QUEUE_RESOLVE_REFERENCE &&
        job &&
        isRetryExhausted(job.attemptsMade, job.opts.attempts)
      ) {
        void markUnresolvedAfterRetries(prisma, job.data as ResolveReferenceJob, (event) =>
          log({ jobId: job.id, ...event }),
        );
      }
    });
  }

  log({ msg: 'worker ready', queues: workers.map((w) => w.name), provider: env.AI_PROVIDER });

  const shutdown = async (): Promise<void> => {
    log({ msg: 'worker shutting down' });
    await Promise.all(workers.map((w) => w.close()));
    await resolveQueue.close();
    await indexQueue.close();
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
