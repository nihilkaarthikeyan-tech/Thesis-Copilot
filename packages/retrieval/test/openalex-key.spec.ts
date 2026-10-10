/**
 * The `api_key` query parameter (2026). OpenAlex now meters its API by cost: without a key the
 * whole site gets $0.10 of use a day — about a hundred searches — and the free key raises it to
 * $1. NCBI's key raises PubMed's rate (ADR-0020). Both are added in `ScholarlyHttp`, the one place
 * every request passes; this pins that the key reaches every kind of request, exactly once, and
 * that nothing changes when it is not set.
 */

import { describe, expect, it } from 'vitest';
import { OpenAlexClient, OpenAlexDiscovery, PubMedClient } from '../src/index.js';

function recorder(body: unknown = { results: [], meta: { count: 0 } }) {
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { urls, fetch };
}

const base = { mailto: 'test@example.com', sleep: async () => undefined } as const;

describe('the OpenAlex key', () => {
  it('is sent with every kind of OpenAlex request', async () => {
    const { urls, fetch } = recorder();
    const client = new OpenAlexClient({ ...base, fetch, apiKey: 'k3y/with&chars' });
    await client.search('Deep learning');
    await client.byDoi('10.1038/nature14539');
    await client.searchTopic('rooftop solar adoption');
    await client.journalCitedness(['S137773608']);
    const discovery = new OpenAlexDiscovery({ ...base, fetch, apiKey: 'k3y/with&chars' });
    await discovery.search('rooftop solar');

    expect(urls.length).toBeGreaterThanOrEqual(5);
    for (const url of urls) {
      expect(url.startsWith('https://api.openalex.org/')).toBe(true);
      // Encoded, so a key with reserved characters cannot break the query.
      expect(url).toContain('api_key=k3y%2Fwith%26chars');
      expect(new URL(url).searchParams.get('api_key')).toBe('k3y/with&chars');
    }
    // Everything else is unchanged: the search is still there.
    expect(new URL(urls[0] as string).searchParams.get('search')).toBeTruthy();
  });

  it('is left off when not set, so the site works exactly as before', async () => {
    const { urls, fetch } = recorder();
    await new OpenAlexClient({ ...base, fetch }).search('Deep learning');
    await new OpenAlexClient({ ...base, fetch, apiKey: '' }).byDoi('10.1038/nature14539');
    await new OpenAlexClient({ ...base, fetch, apiKey: null }).byDoi('10.1038/nature14539');
    for (const url of urls) expect(url).not.toContain('api_key');
  });
});

describe('the NCBI key, through the same mechanism', () => {
  it('reaches a PubMed request exactly once', async () => {
    const { urls, fetch } = recorder({ esearchresult: { idlist: [] } });
    await new PubMedClient({ ...base, fetch, apiKey: 'ncbi-key' }).search('rooftop solar');
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0] as string);
    expect(url.hostname).toBe('eutils.ncbi.nlm.nih.gov');
    expect(url.searchParams.getAll('api_key')).toEqual(['ncbi-key']);
    // The identity NCBI asks for is still there.
    expect(url.searchParams.get('tool')).toBeTruthy();
    expect(url.searchParams.get('email')).toBe('test@example.com');
  });
});

describe('a key whose day is spent (ADR-0145 addendum, 2026-10-10)', () => {
  // What OpenAlex answered on 2026-10-10 to every keyed request, once a day of real-model test
  // runs had spent the key's $1: no Retry-After header, the seconds to midnight in the body.
  const spent = () =>
    new Response(
      JSON.stringify({
        error: 'Insufficient credits',
        message:
          'This request costs $0.001 but you only have $0 remaining. Resets at midnight UTC.',
        retryAfter: 13177,
        dailyRemainingUsd: 0,
      }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  const found = () =>
    new Response(JSON.stringify({ results: [], meta: { count: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('is dropped at once for the same request, and stays out until the reset', async () => {
    const urls: string[] = [];
    const client = new OpenAlexClient({
      ...base,
      apiKey: 'spent-key',
      fetch: async (url: string) => {
        urls.push(url);
        return url.includes('api_key') ? spent() : found();
      },
    });
    // The first search: refused with the key, answered without it — one request, not three
    // attempts and a failure, and no wait at all.
    const first = await client.searchTopic('rooftop solar adoption');
    expect(first.count).toBe(0);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('api_key=spent-key');
    expect(urls[1]).not.toContain('api_key');
    expect(urls[1]).toContain('mailto=');
    // The next search does not try the key again: the day is known to be spent.
    await client.search('Deep learning');
    expect(urls).toHaveLength(3);
    expect(urls[2]).not.toContain('api_key');
  });

  it('is kept for an ordinary 429, which is waited out and retried with the key', async () => {
    const urls: string[] = [];
    const waits: number[] = [];
    const client = new OpenAlexClient({
      ...base,
      apiKey: 'busy-key',
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: async (url: string) => {
        urls.push(url);
        return urls.length === 1
          ? new Response('', { status: 429, headers: { 'retry-after': '2' } })
          : found();
      },
    });
    await client.search('Deep learning');
    expect(urls).toHaveLength(2);
    for (const url of urls) expect(url).toContain('api_key=busy-key');
    expect(waits).toContain(2_000);
  });
});
