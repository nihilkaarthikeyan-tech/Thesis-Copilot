/**
 * Reference resolution — PRD FR-2.1, FR-2.2 and PHASES 2.5.
 *
 * `fetch` is injected, so these run with no network and assert on the exact URLs and headers the
 * polite pools expect.
 */

import { describe, expect, it, vi } from 'vitest';
import { RateLimiter, ScholarlyError, ScholarlyHttp } from '../src/scholarly/http.js';
import {
  CrossrefClient,
  candidateScore,
  groundingLevelFor,
  OpenAlexClient,
  RESOLUTION_THRESHOLD,
  resolveReference,
  UnpaywallClient,
} from '../src/scholarly/resolve.js';

const REFERENCE =
  'Kumar, A., & Rao, B. (2021). Solar adoption in rural Karnataka. Energy Policy, 152, 112-121.';

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
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Routes by URL substring so one fake serves all three services. */
function fakeFetch(routes: Array<{ match: string; body: unknown; status?: number }>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return new Response('not found', { status: 404 });
    return jsonResponse(route.body, route.status ?? 200);
  });
  return { fn, calls };
}

const options = (fetchFn: ReturnType<typeof fakeFetch>['fn']) => ({
  mailto: 'you@example.com',
  fetch: fetchFn,
  sleep: async () => undefined,
});

describe('RateLimiter (PHASES 2.5: ≤ 5 req/s)', () => {
  it('spaces calls by the interval', async () => {
    const waited: number[] = [];
    let clock = 0;
    const limiter = new RateLimiter(
      5,
      async (ms) => {
        waited.push(ms);
        clock += ms;
      },
      () => clock,
    );

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(waited[0]).toBe(0);
    expect(waited[1]).toBeCloseTo(200, 0);
    expect(waited[2]).toBeCloseTo(200, 0);
  });
});

describe('ScholarlyHttp', () => {
  it('sends a contact address in the User-Agent for the polite pool', async () => {
    let headers: Record<string, string> = {};
    const http = new ScholarlyHttp('crossref', {
      mailto: 'you@example.com',
      sleep: async () => undefined,
      fetch: async (_url, init) => {
        headers = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse({ ok: true });
      },
    });
    await http.getJson('https://api.crossref.org/works');
    expect(headers['user-agent']).toContain('mailto:you@example.com');
  });

  it('returns null on 404 rather than throwing', async () => {
    const http = new ScholarlyHttp('unpaywall', {
      mailto: 'you@example.com',
      sleep: async () => undefined,
      fetch: async () => new Response('', { status: 404 }),
    });
    expect(await http.getJson('https://api.unpaywall.org/v2/10.1/none')).toBeNull();
  });

  it('retries a 429 and then succeeds', async () => {
    let calls = 0;
    const http = new ScholarlyHttp('crossref', {
      mailto: 'you@example.com',
      sleep: async () => undefined,
      fetch: async () => {
        calls++;
        return calls === 1
          ? new Response('slow down', { status: 429 })
          : jsonResponse({ ok: true });
      },
    });
    expect(await http.getJson<{ ok: boolean }>('https://api.crossref.org/works')).toEqual({
      ok: true,
    });
    expect(calls).toBe(2);
  });

  it('gives up after the attempt budget and reports the status', async () => {
    const http = new ScholarlyHttp('crossref', {
      mailto: 'you@example.com',
      attempts: 2,
      sleep: async () => undefined,
      fetch: async () => new Response('boom', { status: 500 }),
    });
    await expect(http.getJson('https://api.crossref.org/works')).rejects.toBeInstanceOf(
      ScholarlyError,
    );
  });

  it('does not retry a 400', async () => {
    let calls = 0;
    const http = new ScholarlyHttp('crossref', {
      mailto: 'you@example.com',
      sleep: async () => undefined,
      fetch: async () => {
        calls++;
        return new Response('bad', { status: 400 });
      },
    });
    await expect(http.getJson('https://api.crossref.org/works')).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('candidateScore (FR-2.1)', () => {
  it('clears the bar for the right paper', () => {
    const score = candidateScore(REFERENCE, {
      title: 'Solar adoption in rural Karnataka',
      authors: [{ family: 'Kumar' }, { family: 'Rao' }],
      year: 2021,
    });
    expect(score).toBeGreaterThanOrEqual(RESOLUTION_THRESHOLD);
  });

  it('stays below the bar for a different paper', () => {
    const score = candidateScore(REFERENCE, {
      title: 'Wind turbine siting in coastal Kerala',
      authors: [{ family: 'Singh' }],
      year: 2015,
    });
    expect(score).toBeLessThan(RESOLUTION_THRESHOLD);
  });

  it('refuses a same-titled paper from the wrong year', () => {
    const score = candidateScore(REFERENCE, {
      title: 'Solar adoption in rural Karnataka',
      authors: [{ family: 'Kumar' }, { family: 'Rao' }],
      year: 2014,
    });
    expect(score).toBeLessThan(RESOLUTION_THRESHOLD);
  });

  it('scores nothing when the candidate has no title', () => {
    expect(candidateScore(REFERENCE, { title: null, authors: [], year: 2021 })).toBe(0);
  });
});

describe('resolveReference', () => {
  it('resolves via Crossref and enriches from OpenAlex', async () => {
    const { fn, calls } = fakeFetch([
      { match: 'api.crossref.org/works?', body: { message: { items: [crossrefItem] } } },
      {
        match: 'api.openalex.org/works/doi:',
        body: {
          id: 'https://openalex.org/W123',
          open_access: { oa_status: 'gold' },
          cited_by_count: 44,
        },
      },
    ]);
    const resolved = await resolveReference(REFERENCE, {
      crossref: new CrossrefClient(options(fn)),
      openalex: new OpenAlexClient(options(fn)),
    });

    expect(resolved.via).toBe('crossref');
    expect(resolved.doi).toBe('10.1016/j.enpol.2021.112121');
    expect(resolved.title).toBe('Solar adoption in rural Karnataka');
    expect(resolved.year).toBe(2021);
    expect(resolved.venue).toBe('Energy Policy');
    expect(resolved.oaStatus).toBe('gold');
    expect(resolved.citationCount).toBe(44);
    expect(resolved.isPreprint).toBe(false);
    expect(resolved.isRetracted).toBe(false);
    expect(resolved.cslJson).not.toBeNull();
    expect(resolved.score).toBeGreaterThanOrEqual(RESOLUTION_THRESHOLD);

    // Crossref got the bibliographic query and the polite mailto.
    expect(calls[0]).toContain('query.bibliographic=');
    expect(calls[0]).toContain('mailto=you%40example.com');
  });

  it('falls back to OpenAlex when Crossref finds nothing good', async () => {
    const { fn } = fakeFetch([
      { match: 'api.crossref.org/works?', body: { message: { items: [] } } },
      {
        match: 'api.openalex.org/works?',
        body: {
          results: [
            {
              id: 'https://openalex.org/W9',
              doi: 'https://doi.org/10.1016/J.ENPOL.2021.112121',
              title: 'Solar adoption in rural Karnataka',
              publication_year: 2021,
              cited_by_count: 40,
              type: 'article',
              authorships: [
                { author: { display_name: 'A Kumar' } },
                { author: { display_name: 'B Rao' } },
              ],
              primary_location: { source: { display_name: 'Energy Policy' } },
              open_access: { oa_status: 'green' },
            },
          ],
        },
      },
    ]);

    const resolved = await resolveReference(REFERENCE, {
      crossref: new CrossrefClient(options(fn)),
      openalex: new OpenAlexClient(options(fn)),
    });

    expect(resolved.via).toBe('openalex');
    expect(resolved.doi).toBe('10.1016/j.enpol.2021.112121');
    expect(resolved.openalexId).toBe('https://openalex.org/W9');
    expect(resolved.oaStatus).toBe('green');
  });

  it('returns UNRESOLVED rather than guessing when nothing matches', async () => {
    const { fn } = fakeFetch([
      {
        match: 'api.crossref.org/works?',
        body: {
          message: { items: [{ ...crossrefItem, title: ['An entirely unrelated study of soil'] }] },
        },
      },
      { match: 'api.openalex.org/works?', body: { results: [] } },
    ]);

    const resolved = await resolveReference(REFERENCE, {
      crossref: new CrossrefClient(options(fn)),
      openalex: new OpenAlexClient(options(fn)),
    });

    expect(resolved.via).toBeNull();
    expect(resolved.doi).toBeNull();
    expect(resolved.score).toBe(0);
  });

  it('flags a preprint and a retraction', async () => {
    const { fn } = fakeFetch([
      {
        match: 'api.crossref.org/works?',
        body: {
          message: {
            items: [
              {
                ...crossrefItem,
                type: 'posted-content',
                subtype: 'preprint',
                relation: { 'is-retracted-by': [{ id: '10.1/retraction' }] },
              },
            ],
          },
        },
      },
      { match: 'api.openalex.org/works/doi:', body: {} },
    ]);

    const resolved = await resolveReference(REFERENCE, {
      crossref: new CrossrefClient(options(fn)),
      openalex: new OpenAlexClient(options(fn)),
    });

    expect(resolved.isPreprint).toBe(true);
    expect(resolved.isRetracted).toBe(true);
  });

  it('keeps the Crossref match when the OpenAlex enrichment fails', async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes('api.crossref.org'))
        return jsonResponse({ message: { items: [crossrefItem] } });
      throw new Error('openalex down');
    });

    const resolved = await resolveReference(REFERENCE, {
      crossref: new CrossrefClient(options(fn)),
      openalex: new OpenAlexClient({ ...options(fn), attempts: 1 }),
    });

    expect(resolved.via).toBe('crossref');
    expect(resolved.doi).toBe('10.1016/j.enpol.2021.112121');
    expect(resolved.oaStatus).toBeNull();
  });
});

describe('UnpaywallClient (FR-2.2)', () => {
  it('returns the best OA PDF location', async () => {
    const { fn, calls } = fakeFetch([
      {
        match: 'api.unpaywall.org/v2/',
        body: {
          is_oa: true,
          oa_status: 'gold',
          best_oa_location: {
            url_for_pdf: 'https://example.org/paper.pdf',
            url: 'https://example.org/paper',
          },
        },
      },
    ]);
    const location = await new UnpaywallClient(options(fn)).bestOpenAccess('10.1/aaa');

    expect(location).toEqual({
      pdfUrl: 'https://example.org/paper.pdf',
      landingUrl: 'https://example.org/paper',
      oaStatus: 'gold',
      isOa: true,
    });
    expect(calls[0]).toContain('email=you%40example.com');
  });

  it('reports a closed-access record without a PDF', async () => {
    const { fn } = fakeFetch([
      { match: 'api.unpaywall.org/v2/', body: { is_oa: false, oa_status: 'closed' } },
    ]);
    const location = await new UnpaywallClient(options(fn)).bestOpenAccess('10.1/bbb');
    expect(location).toEqual({ pdfUrl: null, landingUrl: null, oaStatus: 'closed', isOa: false });
  });
});

describe('groundingLevelFor (FR-2.2)', () => {
  it.each([
    [true, true, 'FULL_TEXT'],
    [true, false, 'FULL_TEXT'],
    [false, true, 'ABSTRACT'],
    [false, false, 'NONE'],
  ])('full=%s abstract=%s → %s', (full, abstract, expected) => {
    expect(groundingLevelFor(full, abstract)).toBe(expected);
  });
});
