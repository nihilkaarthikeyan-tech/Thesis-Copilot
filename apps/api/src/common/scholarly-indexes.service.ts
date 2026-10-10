/**
 * arXiv and PubMed for the API — ADR-0020.
 *
 * Both services limit requests per operator, not per process: arXiv to one every three seconds
 * "across all of the machines under your control", NCBI to three a second per address. The worker
 * searches them too, so both apps take turns through the same Redis slots (`sharedGate`) rather
 * than each keeping a limiter of its own and sending twice the rate between them.
 *
 * The waits here are short. A student is watching this request; the worker's jobs are not, and
 * wait as long as they need.
 */

import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Env } from '@tc/config';
import {
  ARXIV,
  ArxivClient,
  openAlexMeter,
  PUBMED,
  PubMedClient,
  scholarlyHealth,
  sharedGate,
} from '@tc/retrieval';
import { Redis } from 'ioredis';
import { ENV } from './env.token.js';

@Injectable()
export class ScholarlyIndexes implements OnModuleDestroy {
  readonly arxiv: ArxivClient;
  readonly pubmed: PubMedClient;
  private readonly redis: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
    // ADR-0149: every OpenAlex / Semantic Scholar client in this process (they are built per
    // request) reads and writes the indexes' refusals and the day's OpenAlex count here, in the
    // same Redis the worker uses, so a refusal one process met is not paid for again by the other.
    const logger = new Logger('ScholarlyHealth');
    scholarlyHealth.configure({
      store: this.redis,
      log: ({ msg, level, ...rest }) =>
        level === 40 ? logger.warn({ ...rest }, String(msg)) : logger.log({ ...rest }, String(msg)),
    });
    openAlexMeter.configure({ store: this.redis });
    this.arxiv = new ArxivClient({
      mailto: env.OPENALEX_MAILTO,
      // One attempt: a retry means another three-second slot, and the student is waiting.
      attempts: 1,
      gate: sharedGate('arxiv', this.redis, 'scholarly:slot:arxiv', ARXIV.intervalMs, {
        maxWaitMs: 8_000,
      }),
    });
    this.pubmed = new PubMedClient({
      mailto: env.OPENALEX_MAILTO,
      apiKey: env.NCBI_API_KEY ?? null,
      attempts: 2,
      gate: sharedGate(
        'pubmed',
        this.redis,
        'scholarly:slot:ncbi',
        env.NCBI_API_KEY ? PUBMED.intervalMs.withKey : PUBMED.intervalMs.withoutKey,
        { maxWaitMs: 4_000 },
      ),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
