/**
 * CORE full-text fallback — PRD FR-2.2.
 *
 * The response shapes below are the ones the live API returned on 2026-09-07 (recorded in the
 * header of `core.ts`), trimmed to the fields the client reads. Nothing here is a guess at what
 * CORE might send.
 */

import { describe, expect, it, vi } from 'vitest';
import { CORE_SEARCH_LIMIT, CoreClient } from '../src/scholarly/core.js';
import { ScholarlyError } from '../src/scholarly/http.js';

const DOI = '10.1371/journal.pone.0185809';

/** `results[0]` of the PLOS ONE search, as observed. */
const PLOS_WORK = {
  id: 8020617,
  doi: DOI,
  title: 'Rural solar adoption',
  downloadUrl: 'https://core.ac.uk/download/132289095.pdf',
  sourceFulltextUrls: [
    'https://core.ac.uk/download/132289095.pdf',
    'http://europepmc.org/articles/PMC5646769?pdf=render',
  ],
  links: [{ type: 'display', url: 'https://core.ac.uk/works/8020617' }],
};

/** `results[0]` of the Nature search, as observed: CORE knows the work but holds no copy. */
const NATURE_WORK = {
  id: 72404683,
  doi: '10.1038/nature12373',
  title: 'Nanometre-scale thermometry in a living cell',
  downloadUrl: '',
  sourceFulltextUrls: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(fetchFn: (url: string, init?: RequestInit) => Promise<Response>) {
  return new CoreClient('test-key', {
    mailto: 'contact@example.org',
    fetch: fetchFn,
    sleep: async () => {},
    requestsPerSecond: 1000,
  });
}

describe('CoreClient.fullTextUrl', () => {
  it('searches by DOI, with the key as a bearer token', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ totalHits: 1, results: [PLOS_WORK] }),
    );
    await client(fetchFn).fullTextUrl(DOI);

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toContain('https://api.core.ac.uk/v3/search/works?q=');
    expect(decodeURIComponent(url ?? '')).toContain(`doi:"${DOI}"`);
    expect(url).toContain(`limit=${CORE_SEARCH_LIMIT}`);
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-key');
    // The polite-pool identification the other clients send is kept.
    expect(headers['user-agent']).toContain('mailto:');
  });

  it("prefers CORE's own download URL", async () => {
    const core = client(async () => json({ totalHits: 1, results: [PLOS_WORK] }));
    expect(await core.fullTextUrl(DOI)).toEqual({
      pdfUrl: 'https://core.ac.uk/download/132289095.pdf',
      coreId: 8020617,
      title: 'Rural solar adoption',
      via: 'downloadUrl',
    });
  });

  it("falls back to the repository's copy when CORE has no download of its own", async () => {
    const work = { ...PLOS_WORK, downloadUrl: '' };
    const core = client(async () => json({ totalHits: 1, results: [work] }));
    const hit = await core.fullTextUrl(DOI);
    expect(hit?.pdfUrl).toBe('https://core.ac.uk/download/132289095.pdf');
    expect(hit?.via).toBe('sourceFulltextUrls');
  });

  it('returns null when CORE knows the work but holds no copy', async () => {
    const core = client(async () => json({ totalHits: 3, results: [NATURE_WORK] }));
    expect(await core.fullTextUrl('10.1038/nature12373')).toBe(null);
  });

  it('returns null for an empty result set', async () => {
    const core = client(async () => json({ totalHits: 0, results: [] }));
    expect(await core.fullTextUrl(DOI)).toBe(null);
  });

  it('ignores a result whose DOI is not the one asked for', async () => {
    // `q=doi:"…"` is a search, and a search can answer with a neighbour. Grounding one paper's
    // claims in another's text is exactly the failure FR-2.2 exists to prevent.
    const other = { ...PLOS_WORK, doi: '10.1371/journal.pone.0185810' };
    const core = client(async () => json({ totalHits: 1, results: [other] }));
    expect(await core.fullTextUrl(DOI)).toBe(null);
  });

  it('matches the DOI regardless of case or a doi.org prefix', async () => {
    const work = { ...PLOS_WORK, doi: DOI.toUpperCase() };
    const core = client(async () => json({ totalHits: 1, results: [work] }));
    const hit = await core.fullTextUrl(`https://doi.org/${DOI}`);
    expect(hit?.pdfUrl).toBe(PLOS_WORK.downloadUrl);
  });

  it('skips a matching work with no copy and takes a later one that has one', async () => {
    const empty = { ...NATURE_WORK, doi: DOI };
    const core = client(async () => json({ totalHits: 2, results: [empty, PLOS_WORK] }));
    const hit = await core.fullTextUrl(DOI);
    expect(hit?.pdfUrl).toBe(PLOS_WORK.downloadUrl);
  });

  it('asks nothing for an empty DOI', async () => {
    const fetchFn = vi.fn(async () => json({ totalHits: 0, results: [] }));
    expect(await client(fetchFn).fullTextUrl('   ')).toBe(null);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces an invalid key as the 401 CORE answers with', async () => {
    // Observed body: {"message":"The API key you provided is not valid."}
    const bad = client(async () =>
      json({ message: 'The API key you provided is not valid.' }, 401),
    );
    await expect(bad.fullTextUrl(DOI)).rejects.toBeInstanceOf(ScholarlyError);
    await expect(bad.fullTextUrl(DOI)).rejects.toMatchObject({ service: 'core', status: 401 });
  });

  it('treats a 404 as no copy rather than a fault', async () => {
    const core = client(async () => new Response('', { status: 404 }));
    expect(await core.fullTextUrl(DOI)).toBe(null);
  });
});
