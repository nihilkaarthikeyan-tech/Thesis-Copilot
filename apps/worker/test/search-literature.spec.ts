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
    library?: Array<{ doi: string | null; title: string | null }>;
    found?: Work[];
    themesFail?: boolean;
    semanticScholar?: Work[] | null;
    openalexThrows?: boolean;
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
        findUnique: vi.fn(async () => ({ meta })),
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
    expect(Object.keys(result.counts).sort()).toEqual([
      'fetched',
      'kept',
      'merged',
      'notInLibrary',
      'queries',
      'themes',
      'thin',
    ]);
    expect(result.counts.queries).toBe(2);
    expect(result.counts.kept).toBe(3);
  });

  it('makes exactly one Strong call and one Fast call, however many queries it runs', async () => {
    // FR-2.5 "one Strong call per search run"; FR-2.6 "one Fast call for the themes". The four
    // searches in between are HTTP, not tokens.
    const f = fakes();
    await runSearchLiterature(JOB, f.deps);
    expect(f.requests.filter((r) => r.tier === 'strong')).toHaveLength(1);
    expect(f.requests.filter((r) => r.tier === 'fast')).toHaveLength(1);
    expect(f.deps.openalex.search).toHaveBeenCalledTimes(2);
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
  it('refuses before any call when the proposal has not been saved', async () => {
    const f = fakes({ scope: null });
    await expect(runSearchLiterature(JOB, f.deps)).rejects.toThrow(/Save the proposal first/);
    expect(f.requests).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
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
