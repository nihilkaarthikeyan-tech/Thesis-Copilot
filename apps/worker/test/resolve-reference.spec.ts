/**
 * `resolve-reference` — PRD FR-2.1, FR-2.2 and PHASES 1-W2 task 2.5.
 *
 * Drives the job with a fake Prisma and scripted scholarly clients, so the decisions that matter
 * are pinned without a network: when a match is taken, when it is refused, what grounding level is
 * claimed, and that a DOI the student typed short-circuits the search that already failed.
 */

import {
  CrossrefClient,
  OpenAlexClient,
  type ScholarlyClientOptions,
  UnpaywallClient,
} from '@tc/retrieval';
import type { ResolveReferenceJob } from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import {
  isRetryExhausted,
  markUnresolvedAfterRetries,
  type ResolveReferenceDeps,
  runResolveReference,
} from '../src/jobs/resolve-reference.js';

const RAW = 'Kumar, A., & Rao, B. (2021). Solar adoption in rural Karnataka. Energy Policy, 152.';

const crossrefItem = {
  DOI: '10.1016/j.enpol.2021.112121',
  title: ['Solar adoption in rural Karnataka'],
  author: [
    { family: 'Kumar', given: 'A' },
    { family: 'Rao', given: 'B' },
  ],
  issued: { 'date-parts': [[2021]] },
  'container-title': ['Energy Policy'],
  type: 'journal-article',
  'is-referenced-by-count': 42,
  abstract: '<jats:p>Cost, not awareness, drives non-adoption.</jats:p>',
};

type SourceRow = {
  id: string;
  status: string;
  doi: string | null;
  title: string | null;
  groundingLevel: string;
  oaStatus: string | null;
  isPreprint: boolean;
  isRetracted: boolean;
  cslJson: Record<string, unknown> | null;
  citationCount: number | null;
  venueOpenalexId?: string | null;
  venueCitedness?: number | null;
};

/** One fake `fetch` serving all three services, routed by URL substring. */
function routes(table: Array<{ match: string; body: unknown; status?: number }>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const route = table.find((r) => url.includes(r.match));
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fn, calls };
}

function fakeDeps(table: Parameters<typeof routes>[0], sourceExists = true) {
  const { fn, calls } = routes(table);
  const options: ScholarlyClientOptions = {
    mailto: 'you@example.com',
    fetch: fn,
    sleep: async () => undefined,
  };

  const source: SourceRow = {
    id: 'src-1',
    status: 'PENDING',
    doi: null,
    title: null,
    groundingLevel: 'NONE',
    oaStatus: null,
    isPreprint: false,
    isRetracted: false,
    cslJson: null,
    citationCount: null,
  };

  const indexed: Array<{ sourceId: string }> = [];
  const logs: Array<Record<string, unknown>> = [];

  const prisma = {
    source: {
      findFirst: vi.fn(async () => (sourceExists ? { ...source } : null)),
      update: vi.fn(async ({ data }: { data: Partial<SourceRow> }) => {
        Object.assign(source, data);
        return { ...source };
      }),
    },
  } as unknown as ResolveReferenceDeps['prisma'];

  const deps: ResolveReferenceDeps = {
    prisma,
    crossref: new CrossrefClient(options),
    openalex: new OpenAlexClient(options),
    unpaywall: new UnpaywallClient(options),
    enqueueIndex: vi.fn(async (input) => {
      indexed.push({ sourceId: input.sourceId });
    }),
    log: (event) => logs.push(event),
  };

  return { deps, source, indexed, calls, logs };
}

const job = (over: Partial<ResolveReferenceJob> = {}): ResolveReferenceJob => ({
  documentId: 'doc-1',
  userId: 'user-1',
  rawReference: RAW,
  ...over,
});

describe('runResolveReference', () => {
  it('queues the paper for reading before asking Unpaywall, and still saves what it says (ADR-0136)', async () => {
    const { deps, source, calls } = fakeDeps([
      { match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } },
      { match: 'api.openalex.org', body: { id: 'W1', open_access: { oa_status: 'bronze' } } },
      { match: 'api.unpaywall.org', body: { is_oa: true, oa_status: 'gold' } },
    ]);
    let unpaywallAskedBeforeQueue: boolean | null = null;
    deps.enqueueIndex = vi.fn(async (input) => {
      unpaywallAskedBeforeQueue = calls.some((url) => url.includes('api.unpaywall.org'));
      // What the abstract job will read is already saved when it is queued.
      expect(source.status).toBe('RESOLVED');
      expect(source.cslJson?.abstract).toBe('Cost, not awareness, drives non-adoption.');
      expect(input.contentKey).toBe('10.1016/j.enpol.2021.112121');
    });

    await runResolveReference(job(), deps);

    expect(deps.enqueueIndex).toHaveBeenCalledTimes(1);
    expect(unpaywallAskedBeforeQueue).toBe(false);
    expect(calls.some((url) => url.includes('api.unpaywall.org'))).toBe(true);
    expect(source.oaStatus).toBe('gold');
  });

  it('stores a Crossref match and queues it for indexing', async () => {
    const { deps, source, indexed } = fakeDeps([
      { match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } },
      { match: 'api.openalex.org', body: { id: 'W1', open_access: { oa_status: 'green' } } },
      { match: 'api.unpaywall.org', body: { is_oa: true, best_oa_location: { url_for_pdf: 'x' } } },
    ]);

    const result = await runResolveReference(job(), deps);

    expect(result.status).toBe('RESOLVED');
    expect(result.via).toBe('crossref');
    expect(source.status).toBe('RESOLVED');
    expect(source.doi).toBe('10.1016/j.enpol.2021.112121');
    expect(source.title).toBe('Solar adoption in rural Karnataka');
    expect(source.oaStatus).toBe('green');
    expect(source.citationCount).toBe(42);
    expect(indexed).toEqual([{ sourceId: 'src-1' }]);
  });

  it('stores the journal and its 2-year citedness, asking once per journal', async () => {
    // ADR-0022. The work names its journal; the journal's own record carries the figure.
    const table = [
      { match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } },
      {
        match: 'api.openalex.org/sources',
        body: {
          results: [
            {
              id: 'https://openalex.org/S175056054',
              type: 'journal',
              summary_stats: { '2yr_mean_citedness': 8.18 },
            },
          ],
        },
      },
      {
        match: 'api.openalex.org',
        body: {
          id: 'W1',
          primary_location: {
            source: { id: 'https://openalex.org/S175056054', display_name: 'Energy Policy' },
          },
        },
      },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ];
    const first = fakeDeps(table);
    await runResolveReference(job(), first.deps);
    expect(first.source.venueOpenalexId).toBe('S175056054');
    expect(first.source.venueCitedness).toBe(8.18);

    // A second paper from the same journal is answered from the cache.
    const second = fakeDeps(table);
    await runResolveReference(job(), second.deps);
    expect(second.calls.filter((url) => url.includes('/sources'))).toHaveLength(0);
    expect(second.source.venueCitedness).toBe(8.18);
  });

  it('gives a preprint server no journal figure, although OpenAlex computes one', async () => {
    const { deps, source } = fakeDeps([
      { match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } },
      {
        match: 'api.openalex.org/sources',
        body: {
          results: [
            {
              id: 'https://openalex.org/S4306400194',
              type: 'repository',
              summary_stats: { '2yr_mean_citedness': 0.17 },
            },
          ],
        },
      },
      {
        match: 'api.openalex.org',
        body: {
          id: 'W1',
          primary_location: { source: { id: 'https://openalex.org/S4306400194' } },
        },
      },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ]);
    await runResolveReference(job(), deps);
    expect(source.venueOpenalexId).toBe('S4306400194');
    expect(source.venueCitedness).toBeNull();
  });

  it('keeps a journal OpenAlex has no figure for as unknown, never zero', async () => {
    const { deps, source } = fakeDeps([
      { match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } },
      { match: 'api.openalex.org/sources', body: { results: [{ id: 'https://openalex.org/S9' }] } },
      {
        match: 'api.openalex.org',
        body: { id: 'W1', primary_location: { source: { id: 'https://openalex.org/S9' } } },
      },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ]);
    await runResolveReference(job(), deps);
    expect(source.venueOpenalexId).toBe('S9');
    expect(source.venueCitedness).toBeNull();
  });

  it('claims abstract grounding only when there is an abstract', async () => {
    const withAbstract = fakeDeps([
      { match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } },
      { match: 'api.openalex.org', body: {} },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ]);
    await runResolveReference(job(), withAbstract.deps);
    expect(withAbstract.source.groundingLevel).toBe('ABSTRACT');
    // Stored as readable text, not the JATS the publisher shipped.
    expect(withAbstract.source.cslJson?.abstract).toBe('Cost, not awareness, drives non-adoption.');

    const { abstract: _dropped, ...noAbstract } = crossrefItem;
    const without = fakeDeps([
      { match: 'query.bibliographic', body: { message: { items: [noAbstract] } } },
      { match: 'api.openalex.org', body: {} },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ]);
    await runResolveReference(job(), without.deps);
    // FR-2.2: nothing to quote, so nothing is claimed.
    expect(without.source.groundingLevel).toBe('NONE');
  });

  it('keeps an abstract the source already carries when the resolver has none (2026-09-30)', async () => {
    const { abstract: _dropped, ...noAbstract } = crossrefItem;
    const f = fakeDeps([
      { match: 'query.bibliographic', body: { message: { items: [noAbstract] } } },
      { match: 'api.openalex.org', body: {} },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ]);
    // A search result brought its abstract with it; Crossref has none for this paper.
    f.source.cslJson = { abstract: 'Cost, not awareness, drives non-adoption, in 400 households.' };
    await runResolveReference(job(), f.deps);
    expect(f.source.cslJson?.abstract).toBe(
      'Cost, not awareness, drives non-adoption, in 400 households.',
    );
    expect(f.source.groundingLevel).toBe('ABSTRACT');
  });

  it('leaves a reference UNRESOLVED rather than attaching a wrong DOI', async () => {
    const { deps, source, indexed } = fakeDeps([
      {
        match: 'query.bibliographic',
        body: {
          message: {
            items: [{ ...crossrefItem, title: ['An entirely different paper about wheat yields'] }],
          },
        },
      },
      { match: 'api.openalex.org', body: { results: [] } },
    ]);

    const result = await runResolveReference(job(), deps);

    expect(result.status).toBe('UNRESOLVED');
    expect(source.status).toBe('UNRESOLVED');
    expect(source.doi).toBeNull();
    // Nothing to index: an unresolved reference has no content behind it.
    expect(indexed).toEqual([]);
  });

  it('uses a printed DOI instead of the search that already failed', async () => {
    const { deps, source, calls } = fakeDeps([
      { match: 'api.crossref.org/works/10', body: { message: crossrefItem } },
      { match: 'api.openalex.org', body: {} },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ]);

    const result = await runResolveReference(
      job({ printedDoi: '10.1016/j.enpol.2021.112121' }),
      deps,
    );

    expect(result.status).toBe('RESOLVED');
    expect(source.doi).toBe('10.1016/j.enpol.2021.112121');
    expect(calls.some((url) => url.includes('query.bibliographic'))).toBe(false);
  });

  it('still searches when the printed DOI turns out to be wrong', async () => {
    const { deps, source, calls } = fakeDeps([
      // Crossref and OpenAlex both 404 the typo'd DOI, then the search finds the paper.
      { match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ]);

    const result = await runResolveReference(job({ printedDoi: '10.9999/typo' }), deps);

    expect(result.status).toBe('RESOLVED');
    expect(source.doi).toBe('10.1016/j.enpol.2021.112121');
    expect(calls.some((url) => url.includes('query.bibliographic'))).toBe(true);
  });

  it('flags a retracted record so the library can warn about it', async () => {
    const { deps, source } = fakeDeps([
      {
        match: 'query.bibliographic',
        body: {
          message: {
            items: [{ ...crossrefItem, relation: { 'is-retracted-by': [{ id: '10.1/retract' }] } }],
          },
        },
      },
      { match: 'api.openalex.org', body: {} },
      { match: 'api.unpaywall.org', body: { is_oa: false } },
    ]);

    await runResolveReference(job(), deps);

    expect(source.isRetracted).toBe(true);
    expect(source.status).toBe('RESOLVED');
  });

  it('keeps the match when Unpaywall is down', async () => {
    const { deps, source, logs } = fakeDeps([
      { match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } },
      { match: 'api.openalex.org', body: {} },
      { match: 'api.unpaywall.org', body: { error: 'boom' }, status: 500 },
    ]);

    const result = await runResolveReference(job(), deps);

    expect(result.status).toBe('RESOLVED');
    expect(source.status).toBe('RESOLVED');
    expect(logs.some((entry) => entry.msg === 'unpaywall lookup failed')).toBe(true);
  });

  it('does nothing when the student removed the source before the job ran', async () => {
    const { deps, indexed } = fakeDeps(
      [{ match: 'query.bibliographic', body: { message: { items: [crossrefItem] } } }],
      false,
    );

    const result = await runResolveReference(job(), deps);

    expect(result.sourceId).toBeNull();
    expect(indexed).toEqual([]);
  });
});

describe('a job that never completes (PHASES 0.7: three attempts)', () => {
  it('knows when BullMQ has stopped retrying', () => {
    expect(isRetryExhausted(1, 3)).toBe(false);
    expect(isRetryExhausted(2, 3)).toBe(false);
    expect(isRetryExhausted(3, 3)).toBe(true);
    // A queue with no explicit budget gets one attempt.
    expect(isRetryExhausted(1, undefined)).toBe(true);
  });

  it('moves a stuck source to UNRESOLVED so the fix form becomes reachable', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const logs: Array<Record<string, unknown>> = [];

    const count = await markUnresolvedAfterRetries(
      { source: { updateMany } } as unknown as ResolveReferenceDeps['prisma'],
      { documentId: 'doc-1', userId: 'user-1', rawReference: RAW },
      (event) => logs.push(event),
    );

    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      // Only rows still waiting: a manual fix that landed first must not be overwritten.
      where: { documentId: 'doc-1', rawReference: RAW, status: 'PENDING' },
      data: { status: 'UNRESOLVED' },
    });
    expect(logs[0]?.msg).toBe('reference left unresolved after retries');
  });

  it('says nothing when the source has already moved on', async () => {
    const logs: Array<Record<string, unknown>> = [];
    const count = await markUnresolvedAfterRetries(
      {
        source: { updateMany: vi.fn(async () => ({ count: 0 })) },
      } as unknown as ResolveReferenceDeps['prisma'],
      { documentId: 'doc-1', userId: 'user-1', rawReference: RAW },
      (event) => logs.push(event),
    );
    expect(count).toBe(0);
    expect(logs).toEqual([]);
  });

  it('swallows a database failure rather than crashing the worker', async () => {
    const logs: Array<Record<string, unknown>> = [];
    const count = await markUnresolvedAfterRetries(
      {
        source: {
          updateMany: vi.fn(async () => {
            throw new Error('connection lost');
          }),
        },
      } as unknown as ResolveReferenceDeps['prisma'],
      { documentId: 'doc-1', userId: 'user-1', rawReference: RAW },
      (event) => logs.push(event),
    );
    expect(count).toBe(0);
    expect(logs[0]?.msg).toBe('could not mark unresolved');
  });
});
