/**
 * Import from Zotero by API key — ADR-0062.
 *
 * The client against Zotero's documented response shapes (`fixtures/zotero.ts` says where each
 * came from). What matters: the key travels only in the header, notes and attachments are left
 * out, a library over the cap is refused whole, paging follows `Link` only on Zotero's own host,
 * and no failure message carries the key.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  cslToBibEntry,
  listZoteroCollections,
  nextLink,
  readZoteroItems,
  ZoteroError,
} from '../src/scholarly/zotero.js';
import {
  ARTICLE,
  CHAPTER,
  COLLECTIONS,
  NOTE,
  REPORT_WITH_EXTRA_DOI,
  UNTITLED,
  USER_ID,
  zoteroResponse,
} from './fixtures/zotero.js';

const KEY = 'P9NiFoyLeZu2bZNvvuQPDWsd';
const credentials = { userId: USER_ID, apiKey: KEY };

describe('readZoteroItems', () => {
  it('reads top-level items with the key in the header only, and maps CSL-JSON', async () => {
    const fetch = vi.fn(async () =>
      zoteroResponse([ARTICLE, CHAPTER, REPORT_WITH_EXTRA_DOI, NOTE, UNTITLED], { total: 5 }),
    );
    const result = await readZoteroItems(credentials, { fetch });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.zotero.org/users/${USER_ID}/items/top?format=json&include=data,csljson&itemType=-attachment&limit=100&start=0`,
    );
    expect(url).not.toContain(KEY);
    expect(init.headers).toMatchObject({ 'Zotero-API-Key': KEY, 'Zotero-API-Version': '3' });

    expect(result.total).toBe(5);
    expect(result.notReferences).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.entries.map((e) => e.doi)).toEqual([
      '10.1016/j.renene.2021.01.001',
      null,
      '10.5281/zenodo.1234567',
    ]);
    expect(result.entries[0]).toMatchObject({
      key: 'X2BQ6C5V',
      title: 'Solar drying of marine fish in coastal Tamil Nadu',
      authors: ['Kumar, A.', 'Raman, S.'],
      year: 2021,
      venue: 'Renewable Energy',
    });
    // The same reference line the .bib import builds.
    expect(result.entries[0]?.raw).toBe(
      'Kumar, A., Raman, S. (2021). Solar drying of marine fish in coastal Tamil Nadu. Renewable Energy. https://doi.org/10.1016/j.renene.2021.01.001',
    );
    expect(result.entries[1]).toMatchObject({
      authors: ['Food and Agriculture Organization'],
      year: 2019,
      venue: 'The State of World Fisheries',
    });
  });

  it('reads one collection when a key is given', async () => {
    const fetch = vi.fn(async () => zoteroResponse([ARTICLE], { total: 1 }));
    await readZoteroItems(credentials, { fetch, collectionKey: 'BCDF2345' });
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toContain(`/users/${USER_ID}/collections/BCDF2345/items/top?`);
  });

  it('follows the Link header page by page', async () => {
    const page2 = `https://api.zotero.org/users/${USER_ID}/items/top?format=json&include=data%2Ccsljson&itemType=-attachment&limit=100&start=100`;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(zoteroResponse([ARTICLE], { total: 101, next: page2 }))
      .mockResolvedValueOnce(zoteroResponse([CHAPTER], { total: 101 }));
    const result = await readZoteroItems(credentials, { fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(page2);
    expect(result.entries).toHaveLength(2);
  });

  it('refuses a library over the cap before reading past the first page', async () => {
    const fetch = vi.fn(async () => zoteroResponse([ARTICLE], { total: 812 }));
    const error = await readZoteroItems(credentials, { fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZoteroError);
    expect((error as ZoteroError).failure).toBe('TOO_MANY');
    expect((error as ZoteroError).total).toBe(812);
    expect((error as ZoteroError).message).toContain('812 items');
    expect((error as ZoteroError).message).toContain('Pick a collection');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('turns a 403 into a plain message that does not carry the key', async () => {
    const fetch = vi.fn(async () => new Response('Forbidden', { status: 403 }));
    const error = (await readZoteroItems(credentials, { fetch }).catch((e) => e)) as ZoteroError;
    expect(error.failure).toBe('BAD_KEY');
    expect(error.message).toMatch(/Zotero refused that key/);
    expect(error.message).not.toContain(KEY);
  });

  it('turns a network failure into a plain message with no cause attached', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError(`fetch failed for key ${KEY}`);
    });
    const error = (await readZoteroItems(credentials, { fetch }).catch((e) => e)) as ZoteroError;
    expect(error.failure).toBe('NETWORK');
    expect(error.message).toMatch(/Could not reach Zotero/);
    expect(JSON.stringify({ m: error.message, s: error.stack, c: error.cause })).not.toContain(KEY);
    expect(error.cause).toBeUndefined();
  });

  it('reads 429 as being asked to slow down', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 429 }));
    const error = (await readZoteroItems(credentials, { fetch }).catch((e) => e)) as ZoteroError;
    expect(error.failure).toBe('RATE_LIMITED');
  });
});

describe('listZoteroCollections', () => {
  it('lists collections by name with their parent and item count', async () => {
    const fetch = vi.fn(async () => zoteroResponse(COLLECTIONS, { total: 2 }));
    const collections = await listZoteroCollections(credentials, { fetch });
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      `https://api.zotero.org/users/${USER_ID}/collections?format=json&limit=100&start=0`,
    );
    expect(collections).toEqual([
      { key: 'GHJK6789', name: 'Drying methods', parentKey: 'BCDF2345', numItems: 1 },
      { key: 'BCDF2345', name: 'Thesis — chapter 2', parentKey: null, numItems: 3 },
    ]);
  });
});

describe('nextLink', () => {
  it('follows only a next page on the Zotero API itself', () => {
    expect(
      nextLink(
        '<https://api.zotero.org/users/1/items?start=100>; rel="next", <https://api.zotero.org/users/1/items?start=400>; rel="last"',
      ),
    ).toBe('https://api.zotero.org/users/1/items?start=100');
    expect(nextLink('<https://evil.example/users/1/items?start=100>; rel="next"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });
});

describe('cslToBibEntry', () => {
  it('falls back to editors, and to an issued raw date', () => {
    expect(
      cslToBibEntry({
        title: 'Edited volume',
        editor: [{ family: 'Rao', given: 'P.' }],
        issued: { raw: 'Spring 2017' },
      }),
    ).toMatchObject({ authors: ['Rao, P.'], year: 2017 });
  });

  it('returns null for an item with neither a title nor a DOI', () => {
    expect(cslToBibEntry({ type: 'document' })).toBeNull();
  });
});
