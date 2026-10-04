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

  it('reads the subjects from topics when OpenAlex sends no concepts', async () => {
    // The shape `/sources?select=…,x_concepts,topics` returned on 2026-10-04: no `x_concepts`
    // key at all, and topics carrying their subfield, field and domain.
    const topicsOnly = {
      id: 'https://openalex.org/S90259781',
      display_name: 'Soil Science',
      type: 'journal',
      topics: [
        {
          display_name: 'Soil Carbon and Nitrogen Dynamics',
          count: 1482,
          subfield: { display_name: 'Soil Science' },
          field: { display_name: 'Agricultural and Biological Sciences' },
          domain: { display_name: 'Life Sciences' },
        },
        {
          display_name: 'Clay minerals and soil interactions',
          count: 741,
          subfield: { display_name: 'Soil Science' },
          field: { display_name: 'Agricultural and Biological Sciences' },
          domain: { display_name: 'Life Sciences' },
        },
      ],
    };
    const client = new OpenAlexSources({
      mailto: 'dev@example.com',
      fetch: jsonFetch({ results: [topicsOnly] }),
    });
    const [c] = await client.search('soil carbon');
    expect(c?.concepts).toEqual(
      expect.arrayContaining([
        { name: 'Soil Carbon and Nitrogen Dynamics', level: 3, score: 1 },
        { name: 'Clay minerals and soil interactions', level: 3, score: 0.5 },
        { name: 'Soil Science', level: 2, score: 1 },
        { name: 'Agricultural and Biological Sciences', level: 1, score: 1 },
        { name: 'Life Sciences', level: 0, score: 1 },
      ]),
    );
    // A subfield named under two topics is one subject, at its higher confidence.
    expect(c?.concepts.filter((x) => x.name === 'Soil Science')).toHaveLength(1);
  });

  it('asks OpenAlex for topics as well as concepts', async () => {
    const fetch = jsonFetch({ results: [] });
    const client = new OpenAlexSources({ mailto: 'dev@example.com', fetch });
    await client.search('soil');
    const url = String((fetch.mock.calls[0] as unknown[] | undefined)?.[0]);
    expect(url).toContain('topics');
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
