import { describe, expect, it } from 'vitest';
import { densityFrom, themeQuery } from '../src/gap/density.js';
import { OpenAlexDiscovery } from '../src/scholarly/discover.js';

const NOW = new Date('2026-10-03T00:00:00Z');

describe('themeQuery (ADR-0046)', () => {
  it('anchors on the thesis title and narrows with the theme name, skipping generic words', () => {
    expect(
      themeQuery(
        'Solar drying of marine fish in coastal Tamil Nadu',
        'Cost barriers to adoption',
        [],
      ),
    ).toBe('solar drying marine cost barriers adoption');
  });

  it('borrows the words its papers share when the theme name is short', () => {
    const q = themeQuery('Solar drying of marine fish', 'Other methods', [
      'Microwave assisted drying kinetics of anchovy',
      'Drying kinetics and quality of microwave dried sardine',
      'Unrelated title about anchovy markets',
    ]);
    // "drying" is already in the anchor; "kinetics" and "microwave" are shared by two titles,
    // "anchovy" by two as well; three words at most, alphabetical within a tie.
    expect(q).toBe('solar drying marine anchovy kinetics microwave');
  });

  it('is deterministic', () => {
    const args = ['A title about grain storage', 'Pest losses', ['x y', 'y z']] as const;
    expect(themeQuery(...args)).toBe(themeQuery(...args));
  });
});

describe('densityFrom', () => {
  const years = (pairs: Array<[number, number]>) => pairs.map(([year, count]) => ({ year, count }));

  it('compares the last three complete years with the three before, leaving out this year', () => {
    const d = densityFrom(
      'q',
      years([
        [2026, 999], // unfinished — in the total, in neither window
        [2025, 40],
        [2024, 30],
        [2023, 30],
        [2022, 20],
        [2021, 20],
        [2020, 20],
        [2015, 5],
      ]),
      NOW,
    );
    expect(d.recent).toBe(100);
    expect(d.previous).toBe(60);
    expect(d.trend).toBe('rising');
    expect(d.total).toBe(1164);
    expect(d.perYear[0]?.year).toBe(2015);
  });

  it('reads falling and steady, and nothing when there is too little', () => {
    expect(
      densityFrom(
        'q',
        years([
          [2025, 10],
          [2022, 30],
          [2021, 10],
        ]),
        NOW,
      ).trend,
    ).toBe('falling');
    expect(
      densityFrom(
        'q',
        years([
          [2025, 30],
          [2022, 30],
        ]),
        NOW,
      ).trend,
    ).toBe('steady');
    expect(
      densityFrom(
        'q',
        years([
          [2025, 3],
          [2022, 4],
        ]),
        NOW,
      ).trend,
    ).toBeNull();
  });
});

describe('OpenAlexDiscovery.yearCounts', () => {
  it('asks one grouped request over the search window and reads the per-year counts', async () => {
    const urls: string[] = [];
    const client = new OpenAlexDiscovery({
      mailto: 'ops@example.edu',
      sleep: async () => undefined,
      fetch: async (url) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            meta: { count: 57 },
            group_by: [
              { key: '2024', key_display_name: '2024', count: 31 },
              { key: '2023', key_display_name: '2023', count: 26 },
              { key: 'unknown', count: 4 },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const counts = await client.yearCounts('solar drying fish?', NOW);
    expect(counts).toEqual([
      { year: 2024, count: 31 },
      { year: 2023, count: 26 },
    ]);
    expect(urls).toHaveLength(1);
    const url = decodeURIComponent(urls[0] ?? '');
    expect(url).toContain('group_by=publication_year');
    expect(url).toContain('from_publication_date:2011-01-01');
    // Title and abstract only — the plain search also matches full text and inflated every count.
    // `?` is a wildcard to OpenAlex and a 400 with a stemmed search.
    expect(url).toContain('title_and_abstract.search:solar drying fish,type:');
    expect(url).not.toContain('&search=');
  });
});
