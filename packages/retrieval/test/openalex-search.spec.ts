/**
 * What OpenAlex is sent.
 *
 * Found on 2026-09-24 by running chat's Find papers against the live API: OpenAlex answers a
 * search containing `?` or `*` with HTTP 400 ("Wildcards (* or ?) require exact (no-stem) search"),
 * so every question ending in a question mark came back empty. And a question sent as typed ranks
 * on its question words — "What Will 5G Be?" was first for a question about rooftop solar.
 */

import { describe, expect, it } from 'vitest';
import { OpenAlexDiscovery } from '../src/scholarly/discover.js';
import { keywordsOf, openAlexSearchText } from '../src/scholarly/keywords.js';
import { OpenAlexClient } from '../src/scholarly/resolve.js';

describe('an OpenAlex search', () => {
  it('never contains a wildcard, from any of the three places that search', async () => {
    const urls: string[] = [];
    const options = {
      mailto: 'ops@example.edu',
      sleep: async () => undefined,
      fetch: async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      },
    };
    await new OpenAlexDiscovery(options).search('What limits rooftop solar adoption?');
    await new OpenAlexClient(options).search('Is this the end? A review of * notation');
    await new OpenAlexClient(options).searchTopic('solar dryers?');
    expect(urls.map((url) => new URL(url).searchParams.get('search'))).toEqual([
      'What limits rooftop solar adoption',
      'Is this the end A review of notation',
      'solar dryers',
    ]);
  });

  it('keeps everything that is not a wildcard', () => {
    expect(openAlexSearchText('  C++ and C#: a comparison  ')).toBe('C++ and C#: a comparison');
  });
});

describe('the words worth searching for', () => {
  it('drops the question around them', () => {
    expect(
      keywordsOf('What does the literature say about rooftop solar adoption barriers?'),
    ).toEqual(['rooftop', 'solar', 'adoption', 'barriers']);
  });

  it('keeps acronyms and numbers, and each word once', () => {
    expect(keywordsOf('AI in 5G networks: AI scheduling')).toEqual([
      'ai',
      '5g',
      'networks',
      'scheduling',
    ]);
  });

  it('stops at the limit, in the order the student wrote them', () => {
    expect(keywordsOf('alpha beta gamma delta epsilon zeta eta theta', 3)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('gives nothing for a question made only of question words', () => {
    expect(keywordsOf('What does it say?')).toEqual([]);
  });
});

describe("ADR-0087: the student's source preferences in the query", () => {
  const capture = () => {
    const urls: string[] = [];
    const client = new OpenAlexDiscovery({
      mailto: 'ops@example.edu',
      sleep: async () => undefined,
      fetch: async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W1',
                title: 'A paper',
                publication_year: 2023,
                type: 'article',
                primary_location: {
                  source: { display_name: 'J', listed_in: ['doaj', 'cwts-core'] },
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    return { client, urls };
  };
  const filterOf = (url: string) => new URL(url).searchParams.get('filter') ?? '';

  it('asks only for the years, journal lists and kinds of work chosen', async () => {
    const { client, urls } = capture();
    const now = new Date('2026-10-07T00:00:00Z');
    const found = await client.search('mobile banking', now, undefined, {
      yearFrom: 2021,
      yearTo: 2025,
      listedIn: ['doaj', 'abdc-a'],
      preprints: false,
    });
    const filter = filterOf(urls[0] ?? '');
    expect(filter).toContain('from_publication_date:2021-01-01');
    expect(filter).toContain('to_publication_date:2025-12-31');
    expect(filter).toContain('primary_location.source.listed_in:doaj|abdc-a');
    expect(filter).not.toContain('preprint');
    expect(found[0]?.listedIn).toEqual(['doaj', 'cwts-core']);

    await client.semanticSearch('mobile banking', now, undefined, { yearFrom: 2021, yearTo: 2025 });
    const semantic = filterOf(urls[1] ?? '');
    expect(semantic).toContain('publication_year:>2020');
    expect(semantic).toContain('publication_year:<2026');
  });

  it('without preferences, asks as before', async () => {
    const { client, urls } = capture();
    await client.search('mobile banking', new Date('2026-10-07T00:00:00Z'));
    const filter = filterOf(urls[0] ?? '');
    expect(filter).toContain('from_publication_date:2011-01-01');
    expect(filter).toContain('preprint');
    expect(filter).not.toContain('listed_in');
  });
});
