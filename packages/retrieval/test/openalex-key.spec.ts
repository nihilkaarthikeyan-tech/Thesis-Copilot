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
