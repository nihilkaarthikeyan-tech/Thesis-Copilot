/**
 * `find-sources` when OpenAlex does not answer — ADR-0149. The other indexes still answer, but
 * what they find for most theses is off topic, so a degraded run adds fewer papers on a higher
 * bar, says it was degraded, and is tried again once OpenAlex should be back. No live calls: the
 * refusal is the body production recorded on 2026-10-10.
 */

import type { EmbeddingProvider } from '@tc/ai';
import type { PrismaClient } from '@tc/db';
import { type DiscoveredWork, ScholarlyError } from '@tc/retrieval';
import type { FindSourcesJob } from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  DEGRADED_SOURCES,
  degradedRetryJobId,
  runFindSources,
} from '../src/jobs/find-sources.js';

const JOB: FindSourcesJob = {
  documentId: 'doc-1',
  userId: 'user-1',
  chapterId: 'ch-1',
  query: 'Electrode wear in Hastelloy EDM. Copper, graphite and composite electrodes.',
  initial: true,
};

const ABSTRACT =
  'Electrical discharge machining of Hastelloy C-276 was studied with copper, graphite and ' +
  'copper-tungsten electrodes. Tool wear rate, material removal rate and surface roughness were ' +
  'measured across peak current and pulse-on time; composite electrodes showed the lowest wear.';

const work = (n: number, via = 'openalex'): DiscoveredWork =>
  ({
    openalexId: `W${n}`,
    doi: `10.1000/w${n}`,
    title: `Electrode wear in Hastelloy EDM, study ${n}`,
    abstract: ABSTRACT,
    year: 2021,
    venue: 'Journal of Materials Processing Technology',
    citationCount: 12,
    isPreprint: false,
    oaStatus: 'closed',
    via,
  }) as DiscoveredWork;

const embeddings = {
  dims: 2,
  modelId: 'fake',
  embed: async (texts: readonly string[]) => texts.map(() => [1, 0]),
  embedWithUsage: async (texts: readonly string[]) => ({
    vectors: texts.map(() => [1, 0]),
    tokens: texts.length * 100,
  }),
} as unknown as EmbeddingProvider;

/** Recorded 2026-10-10: the keyed budget spent, and then the keyless pool as well. */
const refused = () =>
  new ScholarlyError(
    'openalex',
    429,
    'Rate limit exceeded: Insufficient budget. This request costs $0.001 but you only have $0 remaining. Resets at midnight UTC.',
    { refused: true, until: Date.parse('2026-10-11T00:00:00Z') },
  );

function harness() {
  const sources: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const retries: Array<{ job: FindSourcesJob; id: string; delayMs: number }> = [];
  const prisma = {
    user: { findUnique: async () => ({ plan: 'FREE_TRIAL', settings: {} }) },
    chapter: { findFirst: async () => ({ id: JOB.chapterId, title: 'Literature Review' }) },
    document: { findUnique: async () => ({ title: 'EDM of Hastelloy', meta: {}, memory: null }) },
    auditEvent: {
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => audits.push(data),
    },
    source: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        sources.push(data);
        return { id: `source-${sources.length}` };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
  } as unknown as PrismaClient;
  const base = {
    prisma,
    embeddings,
    enqueueResolve: async () => undefined,
    now: () => new Date('2026-10-10T18:00:00Z'),
  };
  const degraded = {
    ...base,
    openalex: {
      search: async (): Promise<DiscoveredWork[]> => {
        throw refused();
      },
      semanticSearch: async (): Promise<DiscoveredWork[]> => {
        throw refused();
      },
    },
    semanticScholar: {
      search: async () => [1, 2, 3, 4, 5, 6].map((n) => work(n, 'semanticscholar')),
    },
    openalexBackAt: async () => Date.parse('2026-10-11T00:00:00Z'),
    enqueueRetry: async (job: FindSourcesJob, id: string, delayMs: number) => {
      retries.push({ job, id, delayMs });
    },
  };
  return { sources, audits, retries, base, degraded };
}

describe('find-sources when OpenAlex does not answer (ADR-0149)', () => {
  it('adds at most two papers, marks the search degraded, and tries again once OpenAlex is back', async () => {
    const h = harness();
    const result = await runFindSources(JOB, h.degraded);
    expect(result.status).toBe('degraded');
    expect(result.added).toBe(DEGRADED_SOURCES.perRun);
    expect(h.sources).toHaveLength(DEGRADED_SOURCES.perRun);
    expect(h.audits[0]).toMatchObject({ detail: { degraded: true, retry: 0 } });
    expect(h.retries).toHaveLength(1);
    expect(h.retries[0]?.job).toMatchObject({ retry: 1, initial: true });
    // Keyed on what it reads (the chapter and the query) and the attempt; BullMQ refuses ':'.
    expect(h.retries[0]?.id).toBe(degradedRetryJobId(JOB, 1));
    expect(h.retries[0]?.id).toContain(JOB.chapterId);
    expect(h.retries[0]?.id).not.toContain(':');
    // Midnight UTC plus a minute, from 18:00 UTC.
    expect(h.retries[0]?.delayMs).toBe(6 * 60 * 60_000 + 60_000);
  });

  it('stops trying after the last retry', async () => {
    const h = harness();
    const result = await runFindSources({ ...JOB, retry: DEGRADED_SOURCES.maxRetries }, h.degraded);
    expect(result).toMatchObject({ status: 'degraded', retryInMs: null });
    expect(h.retries).toHaveLength(0);
  });

  it('is not degraded when OpenAlex answers, even with nothing', async () => {
    const h = harness();
    const result = await runFindSources(JOB, {
      ...h.base,
      openalex: { search: async () => [], semanticSearch: async () => [] },
      semanticScholar: { search: async () => [work(1, 'semanticscholar')] },
      enqueueRetry: h.degraded.enqueueRetry,
    });
    expect(result.status).toBe('added');
    expect(h.retries).toHaveLength(0);
  });

  it('measured: the search made when a thesis is created sends three OpenAlex searches', async () => {
    const h = harness();
    let searches = 0;
    const result = await runFindSources(JOB, {
      ...h.base,
      openalex: {
        search: async () => {
          searches += 1;
          return [work(1)];
        },
        semanticSearch: async () => {
          searches += 1;
          return [work(2)];
        },
      },
    });
    expect(result.status).toBe('added');
    // One semantic search with the whole query, a keyword search for the thesis title and one
    // for the section: $0.003 of the key's free $1 a day.
    expect(searches).toBe(3);
  });
});
