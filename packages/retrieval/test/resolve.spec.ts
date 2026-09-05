/**
 * Reference resolution — PRD FR-2.1, FR-2.2 and PHASES 2.5.
 *
 * `fetch` is injected, so these run with no network and assert on the exact URLs and headers the
 * polite pools expect.
 */

import { describe, expect, it, vi } from 'vitest';
import { RateLimiter, ScholarlyError, ScholarlyHttp } from '../src/scholarly/http.js';
import {
  abstractFromInvertedIndex,
  CrossrefClient,
  candidateScore,
  groundingLevelFor,
  OpenAlexClient,
  plainAbstract,
  RESOLUTION_THRESHOLD,
  resolveByDoi,
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

// -----------------------------------------------------------------------------------------------
// Regression: the query parameters the live services actually accept
// -----------------------------------------------------------------------------------------------

describe('request shape (verified against the live APIs)', () => {
  /**
   * `subtype` is not a Crossref-selectable field. Asking for it made every single lookup return
   * HTTP 400, which the job then retried three times and gave up on, leaving whole libraries
   * stuck at PENDING. The 400 body lists the legal fields; these are the ones we use.
   */
  const CROSSREF_SELECTABLE = new Set([
    'DOI',
    'title',
    'author',
    'issued',
    'container-title',
    'type',
    'is-referenced-by-count',
    'update-to',
    'relation',
    'abstract',
  ]);

  it('only asks Crossref for selectable fields', async () => {
    const fake = fakeFetch([{ match: 'api.crossref.org', body: { message: { items: [] } } }]);
    await new CrossrefClient(options(fake.fn)).searchBibliographic(REFERENCE);

    const select = new URL(fake.calls[0] as string).searchParams.get('select');
    expect(select).not.toBeNull();
    for (const field of (select as string).split(',')) {
      expect(CROSSREF_SELECTABLE.has(field), `${field} is not selectable`).toBe(true);
    }
    expect(select).not.toContain('subtype');
  });

  it('asks Crossref for the fields the retraction and abstract checks read', async () => {
    const fake = fakeFetch([{ match: 'api.crossref.org', body: { message: { items: [] } } }]);
    await new CrossrefClient(options(fake.fn)).searchBibliographic(REFERENCE);

    const select = (new URL(fake.calls[0] as string).searchParams.get('select') as string).split(
      ',',
    );
    // crossrefRetracted reads `relation` and `type`; the abstract decides the grounding level.
    expect(select).toContain('relation');
    expect(select).toContain('type');
    expect(select).toContain('abstract');
  });

  it('asks OpenAlex for the inverted index it rebuilds abstracts from', async () => {
    const fake = fakeFetch([{ match: 'api.openalex.org', body: { results: [] } }]);
    await new OpenAlexClient(options(fake.fn)).search(REFERENCE);

    const select = new URL(fake.calls[0] as string).searchParams.get('select') as string;
    expect(select.split(',')).toContain('abstract_inverted_index');
  });
});

describe('abstracts', () => {
  it('strips the JATS markup Crossref wraps abstracts in', () => {
    expect(
      plainAbstract('<jats:p>Rooftop solar uptake &lt; 4% in the study districts.</jats:p>'),
    ).toBe('Rooftop solar uptake < 4% in the study districts.');
  });

  it('drops a leading "Abstract" label', () => {
    expect(
      plainAbstract('<jats:title>Abstract</jats:title><jats:p>We surveyed 400 homes.</jats:p>'),
    ).toBe('We surveyed 400 homes.');
  });

  it('treats an empty or missing abstract as none', () => {
    expect(plainAbstract(undefined)).toBeNull();
    expect(plainAbstract('<jats:p>  </jats:p>')).toBeNull();
  });

  it('rebuilds an OpenAlex abstract from its inverted index', () => {
    expect(abstractFromInvertedIndex({ We: [0], surveyed: [1], '400': [2], homes: [3] })).toBe(
      'We surveyed 400 homes',
    );
  });

  it('rebuilds words that occur more than once at every position', () => {
    expect(abstractFromInvertedIndex({ solar: [0, 2], and: [1] })).toBe('solar and solar');
  });

  it('has no abstract when OpenAlex omits the index', () => {
    expect(abstractFromInvertedIndex(undefined)).toBeNull();
    expect(abstractFromInvertedIndex({})).toBeNull();
  });

  it('carries the abstract onto the resolved source', async () => {
    const fake = fakeFetch([
      {
        match: 'api.crossref.org',
        body: {
          message: {
            items: [{ ...crossrefItem, abstract: '<jats:p>Cost, not awareness.</jats:p>' }],
          },
        },
      },
      { match: 'api.openalex.org', body: {} },
    ]);
    const resolved = await resolveReference(REFERENCE, {
      crossref: new CrossrefClient(options(fake.fn)),
      openalex: new OpenAlexClient(options(fake.fn)),
    });
    expect(resolved.via).toBe('crossref');
    expect(resolved.abstract).toBe('Cost, not awareness.');
    // FR-2.2: an abstract is what makes the source quotable at abstract level.
    expect(groundingLevelFor(false, Boolean(resolved.abstract))).toBe('ABSTRACT');
  });

  it('reports no abstract when neither service published one', async () => {
    const fake = fakeFetch([
      { match: 'api.crossref.org', body: { message: { items: [crossrefItem] } } },
      { match: 'api.openalex.org', body: {} },
    ]);
    const resolved = await resolveReference(REFERENCE, {
      crossref: new CrossrefClient(options(fake.fn)),
      openalex: new OpenAlexClient(options(fake.fn)),
    });
    expect(resolved.abstract).toBeNull();
    expect(groundingLevelFor(false, Boolean(resolved.abstract))).toBe('NONE');
  });
});

describe('resolveByDoi (FR-2.1 manual fix)', () => {
  it('takes the DOI as the answer instead of searching', async () => {
    const fake = fakeFetch([
      { match: 'api.crossref.org/works/', body: { message: crossrefItem } },
      { match: 'api.openalex.org', body: { id: 'W1', open_access: { oa_status: 'gold' } } },
    ]);
    const resolved = await resolveByDoi('10.1016/j.enpol.2021.112121', {
      crossref: new CrossrefClient(options(fake.fn)),
      openalex: new OpenAlexClient(options(fake.fn)),
    });

    expect(resolved.via).toBe('crossref');
    expect(resolved.score).toBe(1);
    expect(resolved.doi).toBe('10.1016/j.enpol.2021.112121');
    expect(resolved.oaStatus).toBe('gold');
    // The whole point: the bibliographic search is never called.
    expect(fake.calls.some((url) => url.includes('query.bibliographic'))).toBe(false);
  });

  it('accepts a DOI pasted as a doi.org link', async () => {
    const fake = fakeFetch([
      { match: 'api.crossref.org/works/', body: { message: crossrefItem } },
      { match: 'api.openalex.org', body: {} },
    ]);
    const resolved = await resolveByDoi('https://doi.org/10.1016/J.ENPOL.2021.112121', {
      crossref: new CrossrefClient(options(fake.fn)),
      openalex: new OpenAlexClient(options(fake.fn)),
    });
    expect(resolved.via).toBe('crossref');
    expect(fake.calls[0]).toContain(encodeURIComponent('10.1016/j.enpol.2021.112121'));
  });

  it('falls back to OpenAlex for a DOI Crossref did not mint', async () => {
    const fake = fakeFetch([
      { match: 'api.crossref.org/works/', body: {}, status: 404 },
      {
        match: 'api.openalex.org/works/doi:',
        body: {
          id: 'https://openalex.org/W2',
          display_name: 'A DataCite-registered dataset paper',
          publication_year: 2020,
          type: 'preprint',
          abstract_inverted_index: { Rainfall: [0], data: [1] },
        },
      },
    ]);
    const resolved = await resolveByDoi('10.5281/zenodo.123456', {
      crossref: new CrossrefClient(options(fake.fn)),
      openalex: new OpenAlexClient(options(fake.fn)),
    });
    expect(resolved.via).toBe('openalex');
    expect(resolved.title).toBe('A DataCite-registered dataset paper');
    expect(resolved.isPreprint).toBe(true);
    expect(resolved.abstract).toBe('Rainfall data');
  });

  it('reports unresolved when neither service knows the DOI', async () => {
    const fake = fakeFetch([]);
    const resolved = await resolveByDoi('10.0000/not-a-real-doi', {
      crossref: new CrossrefClient(options(fake.fn)),
      openalex: new OpenAlexClient(options(fake.fn)),
    });
    expect(resolved.via).toBeNull();
    expect(resolved.doi).toBeNull();
  });

  it('is unresolved for an empty DOI rather than fetching', async () => {
    const fake = fakeFetch([]);
    const resolved = await resolveByDoi('   ', {
      crossref: new CrossrefClient(options(fake.fn)),
      openalex: new OpenAlexClient(options(fake.fn)),
    });
    expect(resolved.via).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});
