/**
 * `search-literature` — PRD FR-2.5, FR-2.6, A.7, A.8; PHASES v2 W7, "Tests owed (week 7)".
 *
 *   "Job: discover end to end against a fake Prisma and scripted provider (counts per stage, one
 *    Strong + one Fast call); expand with two sources."
 *
 * The cost shape is the assertion that matters most: FR-2.5 buys **one** Strong call for the
 * queries and FR-2.6 **one** Fast call for the themes, and everything between them is search and
 * embedding. A run that quietly made a Strong call per query would multiply the most expensive
 * thing in the product by four and still look correct on screen.
 *
 * The second is that the run never re-offers what the student already has. A gap map padded with
 * papers already in the library reads as coverage the student does not have.
 */

import type { LlmProvider, LlmRequest } from '@tc/ai';
import { describe, expect, it, vi } from 'vitest';
import { runSearchLiterature, type SearchLiteratureDeps } from '../src/jobs/search-literature.js';

type Work = {
  openalexId: string;
  doi: string | null;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  citationCount: number | null;
  isPreprint: boolean;
  oaStatus: string | null;
};

const work = (n: number, over: Partial<Work> = {}): Work => ({
  openalexId: `W${n}`,
  doi: `10.1000/w${n}`,
  title: `Solar drying study number ${n}`,
  abstract: `An abstract about drying, number ${n}.`,
  year: 2020,
  venue: 'Renewable Energy',
  citationCount: 10,
  isPreprint: false,
  oaStatus: 'gold',
  ...over,
});

const SCOPE = {
  workingTitle: 'A low-cost forced-convection solar dryer for coastal fish',
  problemStatement: 'Open-air drying loses a fifth of the catch.',
  objectives: ['Design the dryer', 'Measure drying curves'],
};

type Fakes = {
  deps: SearchLiteratureDeps;
  requests: LlmRequest[];
  candidates: Array<Record<string, unknown>>;
  calls: Array<Record<string, unknown>>;
  meta: () => Record<string, unknown>;
  gapMap: () => Record<string, unknown> | null;
};

function fakes(
  options: {
    scope?: unknown;
    /** The thesis title, which stands in for a scope that was never saved. */
    title?: string | null;
    library?: Array<{ doi: string | null; title: string | null }>;
    found?: Work[];
    themesFail?: boolean;
    semanticScholar?: Work[] | null;
    openalexThrows?: boolean;
    /** ADR-0020's two indexes, as search functions so a test can make one slow or failing. */
    pubmed?: (q: string) => Promise<Work[]>;
    arxiv?: (q: string) => Promise<Work[]>;
  } = {},
): Fakes {
  const requests: LlmRequest[] = [];
  const candidates: Array<Record<string, unknown>> = [];
  const calls: Array<Record<string, unknown>> = [];
  let meta: Record<string, unknown> = {};
  let gapMap: Record<string, unknown> | null = null;
  const found = options.found ?? [work(1), work(2), work(3)];

  const llm = {
    modelIdFor: (tier: string) => `mock-${tier}`,
    complete: vi.fn(async (request: LlmRequest) => {
      requests.push(request);
      const isThemes = (request.messages.at(-1)?.content ?? '').includes('<candidates>');
      if (isThemes && options.themesFail) throw new Error('themes call failed');
      const value = isThemes
        ? {
            themes: [
              {
                name: 'Solar',
                candidateIds: found.map((_, i) => `c${i + 1}`).slice(0, Math.max(1, found.length)),
              },
            ],
          }
        : {
            queries: [
              { angle: 'domain', q: 'solar drying coastal fish' },
              { angle: 'methodology', q: 'forced convection dryer method' },
            ],
          };
      return {
        value,
        modelId: isThemes ? 'mock-fast' : 'mock-strong',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }),
  } as unknown as LlmProvider;

  const deps = {
    prisma: {
      document: {
        findUnique: vi.fn(async () => ({ meta, title: options.title ?? null })),
        update: vi.fn(async ({ data }: { data: { meta: Record<string, unknown> } }) => {
          meta = data.meta;
          return { meta };
        }),
      },
      documentMemory: {
        findUnique: vi.fn(async () => ({
          scope: 'scope' in options ? options.scope : SCOPE,
          gapMap: null,
        })),
        update: vi.fn(async ({ data }: { data: { gapMap: Record<string, unknown> } }) => {
          gapMap = data.gapMap;
          return {};
        }),
      },
      source: { findMany: vi.fn(async () => options.library ?? []) },
      searchCandidate: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          candidates.push(data);
          return { id: `cand-${candidates.length}` };
        }),
      },
      aiCallLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          calls.push(data);
          return {};
        }),
      },
    },
    llm,
    embeddings: {
      // A vector per text; the first component falls with position, so the ranking is stable and
      // the job's own ordering is what is under test rather than a random embedding.
      embed: vi.fn(async (texts: string[]) => texts.map((_, i) => [1 - i / 100, 0.1, 0.1])),
      embedWithUsage: vi.fn(async (texts: string[]) => ({
        vectors: texts.map((_, i) => [1 - i / 100, 0.1, 0.1]),
        tokens: texts.length,
      })),
    },
    openalex: {
      search: vi.fn(async () => {
        if (options.openalexThrows) throw new Error('OpenAlex is down');
        return found;
      }),
    },
    semanticScholar: options.semanticScholar
      ? { search: vi.fn(async () => options.semanticScholar ?? []) }
      : null,
    pubmed: options.pubmed ? { search: vi.fn(options.pubmed) } : null,
    arxiv: options.arxiv ? { search: vi.fn(options.arxiv) } : null,
    aiProvider: 'mock' as const,
    log: () => undefined,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  } as unknown as SearchLiteratureDeps;

  return { deps, requests, candidates, calls, meta: () => meta, gapMap: () => gapMap };
}

const JOB = { documentId: 'doc-1', userId: 'user-1', runId: 'run-1', mode: 'discover' as const };

describe('discover', () => {
  it('runs end to end and reports a count for every stage', async () => {
    const f = fakes();
    const result = await runSearchLiterature(JOB, f.deps);

    expect(result.mode).toBe('discover');
    expect(result.candidates).toBe(3);
    expect(result.themes).toBe(1);
    // One count per index searched (ADR-0020) — here only OpenAlex — and one per stage.
    expect(Object.keys(result.counts).sort()).toEqual([
      'fetched',
      'filled',
      'kept',
      'merged',
      'notInLibrary',
      'openalex',
      'queries',
      'semantic',
      'themeQueries',
      'themes',
      'thin',
    ]);
    expect(result.counts.queries).toBe(2);
    expect(result.counts.kept).toBe(3);
  });

  it('makes exactly one Strong call and one Fast call, however many queries it runs', async () => {
    // FR-2.5 "one Strong call per search run"; FR-2.6 "one Fast call for the themes". The
    // searches in between are HTTP, not tokens — including ADR-0046's targeted search for the
    // one thin theme, which is the third.
    const f = fakes();
    await runSearchLiterature(JOB, f.deps);
    expect(f.requests.filter((r) => r.tier === 'strong')).toHaveLength(1);
    expect(f.requests.filter((r) => r.tier === 'fast')).toHaveLength(1);
    expect(f.deps.openalex.search).toHaveBeenCalledTimes(3);
  });

  it("ADR-0046: records each theme's targeted query and its real per-year density", async () => {
    const f = fakes();
    const yearCounts = vi.fn(async () => [
      { year: 2025, count: 40 },
      { year: 2024, count: 30 },
      { year: 2023, count: 30 },
      { year: 2021, count: 20 },
    ]);
    (f.deps.openalex as unknown as { yearCounts: typeof yearCounts }).yearCounts = yearCounts;
    await runSearchLiterature(JOB, f.deps);
    const run = (f.meta().searchRuns as Record<string, Record<string, unknown>>)['run-1'];
    const density = run?.themeDensity as Record<string, { query: string; total: number }>;
    // Built in code: the title's words, then — the name "Solar" adding nothing new — the words
    // its papers' titles share. No model call.
    expect(density.Solar?.query).toBe('low-cost forced-convection solar drying number');
    expect(yearCounts).toHaveBeenCalledWith(density.Solar?.query, expect.any(Date));
    expect(density.Solar?.total).toBe(120);
    expect(f.requests).toHaveLength(2);
  });

  it('ADR-0046: a thin theme is searched again and gains only papers as close to the scope', async () => {
    let call = 0;
    const f = fakes();
    // The two run queries return the usual three; the theme's own search returns two new papers
    // and one the run already has.
    f.deps.openalex.search = vi.fn(async () => {
      call++;
      return call <= 2 ? [work(1), work(2), work(3)] : [work(1), work(7), work(8)];
    }) as never;
    const result = await runSearchLiterature(JOB, f.deps);
    expect(result.counts.filled).toBe(2);
    expect(result.candidates).toBe(5);
    const solar = f.candidates.filter((c) => c.theme === 'Solar').map((c) => c.doi);
    expect(solar).toEqual(expect.arrayContaining(['10.1000/w7', '10.1000/w8']));
    // W1 was not added twice.
    expect(f.candidates.filter((c) => c.doi === '10.1000/w1')).toHaveLength(1);
    // The gap map records the theme as no longer thin: five papers.
    const themes = (f.gapMap()?.themes ?? []) as Array<{
      name: string;
      count: number;
      thin: boolean;
    }>;
    expect(themes.find((t) => t.name === 'Solar')).toMatchObject({ count: 5, thin: false });
  });

  it('logs both calls against the document, as SEARCH_QUERIES', async () => {
    const f = fakes();
    await runSearchLiterature(JOB, f.deps);
    expect(f.calls).toHaveLength(2);
    for (const call of f.calls) {
      expect(call.action).toBe('SEARCH_QUERIES');
      expect(call.documentId).toBe('doc-1');
      expect(call.ok).toBe(true);
      // The mock provider is free; a non-zero cost here would be a fabricated number (§0.3 rule 4).
      expect(call.costMicroInr).toBe(0n);
    }
  });

  it('never re-offers a paper already in the library, by DOI or by title', async () => {
    const f = fakes({
      library: [
        { doi: '10.1000/w1', title: 'Something else entirely' },
        { doi: null, title: 'solar DRYING study   number 2' },
      ],
    });
    const result = await runSearchLiterature(JOB, f.deps);
    expect(result.counts.merged).toBe(3);
    expect(result.counts.notInLibrary).toBe(1);
    expect(f.candidates.map((c) => c.openalexId)).toEqual(['W3']);
  });

  it('merges the two indexes and de-duplicates by DOI', async () => {
    const f = fakes({
      found: [work(1), work(2)],
      semanticScholar: [work(2), work(9)],
    });
    const result = await runSearchLiterature(JOB, f.deps);
    // Two queries × two indexes = four lists; W2 appears twice and counts once.
    expect(result.counts.fetched).toBe(8);
    expect(result.counts.merged).toBe(3);
  });

  it('merges arXiv and PubMed in too, and counts what each found', async () => {
    const f = fakes({
      found: [work(1), work(2)],
      // The same paper PubMed and OpenAlex both have, by DOI, and one only PubMed has.
      pubmed: async () => [work(2, { openalexId: '' }), work(20, { openalexId: '' })],
      arxiv: async () => [work(30, { openalexId: '', venue: 'arXiv', isPreprint: true })],
    });
    const result = await runSearchLiterature(JOB, f.deps);
    expect(result.counts.openalex).toBe(4);
    expect(result.counts.pubmed).toBe(4);
    expect(result.counts.arxiv).toBe(2);
    expect(result.counts.fetched).toBe(10);
    // W1, W2, W20, W30 — W2 once, and OpenAlex's record of it, which came first.
    expect(result.counts.merged).toBe(4);
    const w2 = f.candidates.find((c) => c.doi === '10.1000/w2');
    expect(w2?.openalexId).toBe('W2');
  });

  it('loses only an index that fails, never the run', async () => {
    const f = fakes({
      found: [work(1)],
      arxiv: async () => {
        throw new Error('arXiv: no request slot within 60000 ms');
      },
    });
    const result = await runSearchLiterature(JOB, f.deps);
    expect(result.counts.arxiv).toBe(0);
    expect(result.counts.merged).toBe(1);
    const runs = f.meta().searchRuns as Record<string, Record<string, unknown>>;
    expect(runs['run-1']?.status).toBe('DONE');
  });

  it('runs the indexes side by side, so a slow one does not hold the others up', async () => {
    // arXiv answers its first query only once OpenAlex has finished both of its own. Run one
    // index after another, query by query, this would never finish.
    let release: () => void = () => undefined;
    const openalexDone = new Promise<void>((resolve) => {
      release = resolve;
    });
    let openalexCalls = 0;
    const f = fakes({
      found: [work(1)],
      arxiv: async () => {
        await openalexDone;
        return [work(40, { openalexId: '' })];
      },
    });
    const original = f.deps.openalex.search;
    f.deps.openalex.search = vi.fn(async (...args: Parameters<typeof original>) => {
      const found = await original(...args);
      openalexCalls += 1;
      if (openalexCalls === 2) release();
      return found;
    }) as typeof original;
    const result = await runSearchLiterature(JOB, f.deps);
    expect(result.counts.arxiv).toBe(2);
  });

  it('stores every candidate with the theme it was placed in', async () => {
    const f = fakes();
    await runSearchLiterature(JOB, f.deps);
    expect(f.candidates).toHaveLength(3);
    for (const candidate of f.candidates) {
      expect(candidate.runId).toBe('run-1');
      expect(candidate.theme).toBe('Solar');
      expect(typeof candidate.score).toBe('number');
    }
  });

  it('writes a gap map whose candidate ids are the stored rows, not the prompt placeholders', async () => {
    // The map is what the curation grid renders; `c1` would render an empty theme.
    const f = fakes();
    await runSearchLiterature(JOB, f.deps);
    const themes = (f.gapMap()?.themes ?? []) as Array<{ candidateIds: string[]; thin: boolean }>;
    expect(themes[0]?.candidateIds).toEqual(['cand-1', 'cand-2', 'cand-3']);
    expect(themes[0]?.thin).toBe(true); // three is below FR-2.6's threshold of four
  });

  it('records the run on the document, DONE, with the queries it used', async () => {
    const f = fakes();
    await runSearchLiterature(JOB, f.deps);
    const runs = f.meta().searchRuns as Record<string, Record<string, unknown>>;
    expect(runs['run-1']?.status).toBe('DONE');
    expect(runs['run-1']?.finishedAt).toBe('2026-09-07T00:00:00.000Z');
    expect(runs['run-1']?.queries).toHaveLength(2);
  });

  it('marks the run RUNNING before it does any work', async () => {
    // A student watching the screen has to see something between pressing search and the results.
    const f = fakes();
    const seen: string[] = [];
    type UpdateArgs = { data: { meta: Record<string, unknown> } };
    const update = f.deps.prisma.document.update as unknown as {
      getMockImplementation: () => ((args: UpdateArgs) => Promise<unknown>) | undefined;
      mockImplementation: (fn: (args: UpdateArgs) => Promise<unknown>) => void;
    };
    const original = update.getMockImplementation();
    update.mockImplementation(async (args: UpdateArgs) => {
      const runs = args.data.meta.searchRuns as Record<string, { status: string }>;
      seen.push(runs['run-1']?.status ?? '?');
      return original?.(args);
    });
    await runSearchLiterature(JOB, f.deps);
    expect(seen[0]).toBe('RUNNING');
    expect(seen.at(-1)).toBe('DONE');
  });
});

describe('when something goes wrong', () => {
  it('refuses before any call when there is neither a proposal nor a title', async () => {
    const f = fakes({ scope: null });
    await expect(runSearchLiterature(JOB, f.deps)).rejects.toThrow(/Give the thesis a title first/);
    expect(f.requests).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  });

  it('searches from the thesis title when "Start writing now" saved no proposal', async () => {
    const f = fakes({
      scope: {},
      title: 'Mobile banking adoption among rural women in Tamil Nadu',
    });
    const result = await runSearchLiterature(JOB, f.deps);
    expect(result.candidates).toBeGreaterThan(0);
    const queries = f.requests.find((r) => r.tier === 'strong');
    expect(JSON.stringify(queries)).toContain('Mobile banking adoption among rural women');
    expect(f.gapMap()).toBeTruthy();
  });

  it('records the run FAILED with the reason, rather than leaving it RUNNING forever', async () => {
    const f = fakes({ themesFail: true });
    await expect(runSearchLiterature(JOB, f.deps)).rejects.toThrow('themes call failed');
    const runs = f.meta().searchRuns as Record<string, Record<string, unknown>>;
    expect(runs['run-1']?.status).toBe('FAILED');
    expect(runs['run-1']?.error).toBe('themes call failed');
  });

  it('logs the failed call as a failure rather than losing it', async () => {
    const f = fakes({ themesFail: true });
    await expect(runSearchLiterature(JOB, f.deps)).rejects.toThrow();
    const failed = f.calls.find((c) => c.ok === false);
    expect(failed?.error).toContain('themes call failed');
    expect(failed?.model).toBe('mock-fast');
  });

  it('survives one index being down — a search with no results beats no search', async () => {
    const f = fakes({ openalexThrows: true });
    const result = await runSearchLiterature(JOB, f.deps);
    expect(result.counts.fetched).toBe(0);
    expect(result.candidates).toBe(0);
    const runs = f.meta().searchRuns as Record<string, Record<string, unknown>>;
    expect(runs['run-1']?.status).toBe('DONE');
  });

  it('skips the themes call entirely when nothing survived the filter', async () => {
    const f = fakes({ openalexThrows: true });
    await runSearchLiterature(JOB, f.deps);
    expect(f.requests.filter((r) => r.tier === 'fast')).toHaveLength(0);
  });
});

describe('expand (ADR-0052)', () => {
  it('groups backward, recent and related, ranking references by how many sources cite them', async () => {
    const f = fakes();
    const sources = [{ openalexId: 'W100' }, { openalexId: 'W200' }, { openalexId: 'W300' }];
    (f.deps.prisma as unknown as { source: { findMany: unknown } }).source.findMany = vi.fn(
      async (args: { where?: { status?: string } }) => (args?.where?.status ? sources : []),
    );
    // W9 is cited by all three sources, W8 by one: W9 must lead its group.
    const refsOf: Record<string, Work[]> = {
      W100: [work(8, { citationCount: 9_000 }), work(9, { citationCount: 10 })],
      W200: [work(9, { citationCount: 10 })],
      W300: [work(9, { citationCount: 10 })],
    };
    Object.assign(f.deps.openalex, {
      citedBy: vi.fn(async () => [work(20)]),
      related: vi.fn(async () => [work(21)]),
      references: vi.fn(async (id: string) => refsOf[id] ?? []),
      recentCitedBy: vi.fn(async () => [work(30, { year: 2026 }), work(31, { year: 2024 })]),
    });
    const result = await runSearchLiterature({ ...JOB, mode: 'expand' as const }, f.deps);
    expect(result.themes).toBe(3);
    const byTheme = (t: string) => f.candidates.filter((c) => c.theme === t).map((c) => c.doi);
    expect(byTheme('Cited by your sources')).toEqual(['10.1000/w9', '10.1000/w8']);
    expect(byTheme('Recent work citing your sources')).toEqual(['10.1000/w30', '10.1000/w31']);
    expect(byTheme('Related to your citations')).toEqual(
      expect.arrayContaining(['10.1000/w20', '10.1000/w21']),
    );
  });
});
