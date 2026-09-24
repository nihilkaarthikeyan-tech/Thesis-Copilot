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

import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ARXIV, ArxivClient, PUBMED, PubMedClient, sharedGate } from '@tc/retrieval';
import { Redis } from 'ioredis';
import { ENV } from './env.token.js';

@Injectable()
export class ScholarlyIndexes implements OnModuleDestroy {
  readonly arxiv: ArxivClient;
  readonly pubmed: PubMedClient;
  private readonly redis: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
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
