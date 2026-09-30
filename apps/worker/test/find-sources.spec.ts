/**
 * `find-sources` — ADR-0037. Finding papers when the library has none on the section being
 * written: only real, on-topic records with an abstract, never a duplicate, never past the month's
 * allowance, and every search logged.
 */

import type { EmbeddingProvider } from '@tc/ai';
import { autoSourcesJobKey } from '@tc/config';
import type { PrismaClient } from '@tc/db';
import type { DiscoveredWork } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';
import { runFindSources, startFindSources } from '../src/jobs/find-sources.js';

const JOB = {
  documentId: 'doc-1',
  userId: 'user-1',
  chapterId: 'ch-1',
  query: 'Electrode wear in Hastelloy EDM. Copper, graphite and composite electrodes.',
};

const ABSTRACT =
  'Electrical discharge machining of Hastelloy C-276 was studied with copper, graphite and ' +
  'copper-tungsten electrodes. Tool wear rate, material removal rate and surface roughness were ' +
  'measured across peak current and pulse-on time; composite electrodes showed the lowest wear.';

const work = (n: number, over: Partial<DiscoveredWork> = {}): DiscoveredWork => ({
  openalexId: `W${n}`,
  doi: `10.1000/w${n}`,
  title: `Electrode wear in Hastelloy EDM, study ${n}`,
  abstract: ABSTRACT,
  year: 2021,
  venue: 'Journal of Materials Processing Technology',
  citationCount: 12,
  isPreprint: false,
  oaStatus: 'closed',
  via: 'openalex',
  ...over,
});

/** On-topic works embed next to the query; anything titled "off topic" points the other way. */
const embeddings = {
  dims: 2,
  modelId: 'fake',
  embed: async (texts: readonly string[]) => texts.map(() => [1, 0]),
  embedWithUsage: async (texts: readonly string[]) => ({
    vectors: texts.map((t) => (t.toLowerCase().includes('off topic') ? [0, 1] : [1, 0])),
    tokens: texts.length * 100,
  }),
} as unknown as EmbeddingProvider;

function fakes(
  options: {
    found?: DiscoveredWork[];
    library?: Array<{ doi: string | null; title: string | null }>;
    usedThisMonth?: number;
    plan?: string;
    flag?: boolean;
    settings?: Record<string, unknown>;
  } = {},
) {
  const sources: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const resolves: Array<Record<string, unknown>> = [];
  const embeds: Array<Record<string, unknown>> = [];
  const prisma = {
    user: {
      findUnique: async () => ({
        plan: options.plan ?? 'FREE_TRIAL',
        settings: options.settings ?? {},
      }),
    },
    chapter: { findFirst: async () => ({ id: JOB.chapterId, title: 'Literature Review' }) },
    featureFlag: { findUnique: async () => ({ enabled: options.flag ?? true }) },
    auditEvent: {
      count: async () => options.usedThisMonth ?? 0,
      create: async ({ data }: { data: Record<string, unknown> }) => audits.push(data),
    },
    source: {
      findMany: async () => options.library ?? [],
      create: async ({ data }: { data: Record<string, unknown> }) => sources.push(data),
    },
  } as unknown as PrismaClient;
  const found = options.found ?? [work(1), work(2)];
  return {
    sources,
    audits,
    resolves,
    embeds,
    deps: {
      prisma,
      embeddings,
      openalex: { search: async () => found },
      enqueueResolve: async (input: Record<string, unknown>) => resolves.push(input),
      logEmbed: async (call: Record<string, unknown>) => {
        embeds.push(call);
      },
    },
  };
}

describe('find-sources', () => {
  it('adds on-topic papers with their abstract, marked as added automatically, and resolves them', async () => {
    const f = fakes();
    const result = await runFindSources(JOB, f.deps);
    expect(result).toMatchObject({ status: 'added', added: 2 });
    expect(f.sources).toHaveLength(2);
    expect(f.sources[0]).toMatchObject({
      documentId: 'doc-1',
      status: 'PENDING',
      doi: '10.1000/w1',
      cslJson: { abstract: ABSTRACT },
    });
    expect(f.sources[0]?.autoAddedAt).toBeInstanceOf(Date);
    expect(f.resolves.map((r) => r.printedDoi)).toEqual(['10.1000/w1', '10.1000/w2']);
    // Logged, so the month's count and the activity log both see it; embedding spend logged too.
    expect(f.audits[0]).toMatchObject({ kind: 'SOURCES_FOUND', userId: 'user-1' });
    expect(f.embeds[0]).toMatchObject({ userId: 'user-1', tokens: 300, ok: true });
  });

  it('never adds an off-topic paper, a paper with no abstract, or one already in the library', async () => {
    const f = fakes({
      found: [
        work(1),
        work(2, { title: 'Off topic: marine biology of reef fish' }),
        work(3, { abstract: null }),
        work(4, { abstract: 'Too short.' }),
        work(5, { doi: '10.1000/already' }),
      ],
      library: [{ doi: '10.1000/already', title: 'Something' }],
    });
    const result = await runFindSources(JOB, f.deps);
    expect(result.added).toBe(1);
    expect(f.sources.map((s) => s.doi)).toEqual(['10.1000/w1']);
  });

  it('adds at most five papers from one search', async () => {
    const f = fakes({ found: Array.from({ length: 12 }, (_, i) => work(i + 1)) });
    expect((await runFindSources(JOB, f.deps)).added).toBe(5);
  });

  it('stops at the month’s allowance and adds nothing', async () => {
    const f = fakes({ usedThisMonth: 5, plan: 'FREE_TRIAL' });
    expect(await runFindSources(JOB, f.deps)).toMatchObject({ status: 'capped', added: 0 });
    expect(f.sources).toHaveLength(0);
    // A paid plan has more.
    const paid = fakes({ usedThisMonth: 5, plan: 'STUDENT_MONTHLY' });
    expect((await runFindSources(JOB, paid.deps)).status).toBe('added');
  });

  it('logs a search that found nothing, so it still counts against the month', async () => {
    const f = fakes({ found: [] });
    expect((await runFindSources(JOB, f.deps)).status).toBe('none-relevant');
    expect(f.audits).toHaveLength(1);
  });
});

describe('starting a search', () => {
  const enqueueInto = (jobs: Array<{ id: string }>) => async (_job: unknown, id: string) =>
    jobs.push({ id });

  it('starts one when the switch is on, the student has not opted out and searches remain', async () => {
    const jobs: Array<{ id: string }> = [];
    const f = fakes();
    const now = new Date('2026-10-01T10:00:00Z');
    expect(
      await startFindSources({ prisma: f.deps.prisma, enqueue: enqueueInto(jobs) }, JOB, now),
    ).toBe(true);
    // One job per chapter per ten minutes: a second request in the window is the same job.
    expect(jobs[0]?.id).toBe(autoSourcesJobKey('ch-1', now));
    expect(autoSourcesJobKey('ch-1', new Date('2026-10-01T10:05:00Z'))).toBe(jobs[0]?.id);
    expect(jobs[0]?.id).not.toContain(':');
  });

  it('does not start one when the switch is off, the student opted out, or the month is used up', async () => {
    for (const options of [
      { flag: false },
      { settings: { autoSources: false } },
      { usedThisMonth: 5 },
    ]) {
      const jobs: Array<{ id: string }> = [];
      const f = fakes(options);
      expect(
        await startFindSources({ prisma: f.deps.prisma, enqueue: enqueueInto(jobs) }, JOB),
      ).toBe(false);
      expect(jobs).toHaveLength(0);
    }
  });
});
