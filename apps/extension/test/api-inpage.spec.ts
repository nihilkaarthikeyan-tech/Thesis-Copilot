/**
 * The in-page card's two calls (ADR-0125), against a fake `fetch`. Pinned: the lookup sends the
 * identifier in the query and nothing else; the import posts `{ q }` and nothing else; the
 * lookup's answer is checked field by field (a count that is not a count, an access claim the
 * add-on does not know, are dropped); a call that hangs ends with words, not a spinner for ever.
 */

import { describe, expect, it } from 'vitest';
import { IMPORT_TIMEOUT_MS, LOOKUP_TIMEOUT_MS, makeApi, previewFrom } from '../src/api.js';

const BASE = 'https://thesis.rademics.ai';
const DOC = '0190a3c4-0000-7000-8000-000000000001';
const SOURCE = '0190a3c4-0000-7000-8000-000000000101';

type Seen = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  return { fetcher, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LOOKED_UP = {
  kind: 'doi',
  id: '10.5555/x1',
  title: 'Groundwater Recharge',
  authors: [{ family: 'Raman', given: 'Kavya' }, { literal: 'WHO Group' }, { family: 'Iyer' }],
  year: 2017,
  venue: 'OJGS',
  doi: '10.5555/x1',
  abstract: 'Never shown by the add-on.',
  type: 'article-journal',
  citedBy: 54,
  openAccessVia: null,
};

describe('looking a paper up', () => {
  it('sends only the identifier, with the session cookie and a time limit', async () => {
    const { fetcher, seen } = fakeFetch(() => json(LOOKED_UP));
    const reply = await makeApi(BASE, fetcher).lookupId(DOC, 'PMID 33333333');
    expect(seen[0]?.url).toBe(
      `${BASE}/api/v1/documents/${DOC}/sources/lookup-id?q=PMID%2033333333`,
    );
    expect(seen[0]?.init.method).toBeUndefined();
    expect(seen[0]?.init.body).toBeUndefined();
    expect(seen[0]?.init.credentials).toBe('include');
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(reply).toEqual({
      ok: true,
      value: {
        kind: 'doi',
        title: 'Groundwater Recharge',
        byline: 'Kavya Raman, WHO Group, Iyer',
        year: 2017,
        venue: 'OJGS',
        doi: '10.5555/x1',
        citedBy: 54,
        openAccessVia: null,
      },
    });
    expect(LOOKUP_TIMEOUT_MS).toBeLessThan(IMPORT_TIMEOUT_MS);
  });

  it('passes on the server’s reason for "no record"', async () => {
    const { fetcher } = fakeFetch(() =>
      json({ title: 'Not Found', detail: 'No paper with that DOI' }, 404),
    );
    expect(await makeApi(BASE, fetcher).lookupId(DOC, '10.5555/x1')).toEqual({
      ok: false,
      status: 404,
      message: 'No paper with that DOI',
    });
  });

  it('ends a call that hangs with words', async () => {
    const hang = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as typeof fetch;
    expect(await makeApi(BASE, hang).lookupId(DOC, '10.5555/x1')).toEqual({
      ok: false,
      status: 0,
      message: 'Thesis Copilot took too long to answer. Try again in a moment.',
    });
  });
});

describe('the lookup’s answer, checked field by field', () => {
  it('drops a count that is not a count and an access claim it does not know', () => {
    expect(previewFrom({ ...LOOKED_UP, citedBy: '54', openAccessVia: 'Sci-Hub' })).toMatchObject({
      citedBy: null,
      openAccessVia: null,
    });
    expect(previewFrom({ ...LOOKED_UP, citedBy: -3 })?.citedBy).toBeNull();
    expect(
      previewFrom({ ...LOOKED_UP, kind: 'arxiv', openAccessVia: 'arXiv' })?.openAccessVia,
    ).toBe('arXiv');
    expect(previewFrom({ ...LOOKED_UP, doi: 'not a doi' })?.doi).toBeNull();
  });

  it('is nothing when it names no kind or no title, and keeps a title as text', () => {
    expect(previewFrom({ ...LOOKED_UP, kind: 'isbn' })).toBeNull();
    expect(previewFrom({ ...LOOKED_UP, title: '' })).toBeNull();
    expect(previewFrom('nope')).toBeNull();
    expect(previewFrom({ ...LOOKED_UP, title: '<img src=x onerror=alert(1)>' })?.title).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});

describe('importing it', () => {
  it('posts the identifier and nothing else, and checks the id it answers', async () => {
    const { fetcher, seen } = fakeFetch(() =>
      json({ sourceId: SOURCE, alreadyPresent: true }, 201),
    );
    const api = makeApi(BASE, fetcher);
    expect(await api.importId(DOC, 'arXiv:2610.00001')).toEqual({
      ok: true,
      value: { sourceId: SOURCE, alreadyPresent: true },
    });
    expect(seen[0]?.url).toBe(`${BASE}/api/v1/documents/${DOC}/sources/import-id`);
    expect(seen[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({ q: 'arXiv:2610.00001' });

    const odd = fakeFetch(() => json({ sourceId: '../../x' }, 201));
    expect(await makeApi(BASE, odd.fetcher).importId(DOC, '10.5555/x1')).toMatchObject({
      ok: false,
    });
  });

  it('never calls with a thesis id that is not a UUID', async () => {
    const { fetcher, seen } = fakeFetch(() => json({}));
    const api = makeApi(BASE, fetcher);
    expect(await api.importId('../../admin', '10.5555/x1')).toMatchObject({ ok: false });
    expect(await api.lookupId('../../admin', '10.5555/x1')).toMatchObject({ ok: false });
    expect(seen).toHaveLength(0);
  });
});
