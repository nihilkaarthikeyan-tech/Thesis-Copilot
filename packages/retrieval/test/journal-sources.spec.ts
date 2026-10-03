/**
 * OpenAlex `/sources` → journal candidates (ADR-0040). `fetch` is injected, so the mapping from
 * OpenAlex's shape to our grounded `JournalCandidate` is pinned without a network.
 */

import { describe, expect, it, vi } from 'vitest';
import { OpenAlexSources, sourceShortId } from '../src/journals/sources.js';

const SOURCE = {
  id: 'https://openalex.org/S4210',
  display_name: 'Journal of Materials Processing Technology',
  issn: ['0924-0136'],
  issn_l: '0924-0136',
  host_organization_name: 'Elsevier',
  type: 'journal',
  works_count: 12000,
  is_oa: false,
  summary_stats: { '2yr_mean_citedness': 6.2 },
  apc_usd: 3200,
  x_concepts: [
    { display_name: 'Materials science', level: 0, score: 0.9 },
    { display_name: 'Machining', level: 2, score: 0.7 },
  ],
};

const jsonFetch = (body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
  );

describe('sourceShortId', () => {
  it('extracts S-id from a URL or a bare id', () => {
    expect(sourceShortId('https://openalex.org/S4210')).toBe('S4210');
    expect(sourceShortId('S99')).toBe('S99');
    expect(sourceShortId(null)).toBeNull();
  });
});

describe('OpenAlexSources', () => {
  it('maps an OpenAlex source to a grounded candidate', async () => {
    const fetch = jsonFetch({ results: [SOURCE] });
    const client = new OpenAlexSources({ mailto: 'dev@example.com', fetch });
    const [c] = await client.search('EDM Hastelloy');
    expect(c).toMatchObject({
      id: 'S4210',
      name: 'Journal of Materials Processing Technology',
      issn: ['0924-0136'],
      publisher: 'Elsevier',
      meanCitedness: 6.2,
      apcUsd: 3200,
      type: 'journal',
    });
    expect(c?.concepts).toHaveLength(2);
  });

  it('gather de-duplicates the cited venues and the topic search', async () => {
    const fetch = jsonFetch({ results: [SOURCE] });
    const client = new OpenAlexSources({ mailto: 'dev@example.com', fetch });
    const out = await client.gather({ citedVenueIds: ['S4210'], query: 'EDM' });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('S4210');
  });

  it('byIds returns nothing for an empty id list, with no call', async () => {
    const fetch = jsonFetch({ results: [] });
    const client = new OpenAlexSources({ mailto: 'dev@example.com', fetch });
    expect(await client.byIds([])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
