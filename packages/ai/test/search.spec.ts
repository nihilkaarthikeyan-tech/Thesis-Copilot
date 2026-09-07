/**
 * Literature search builders — PRD A.7, A.8, FR-2.5, FR-2.6; PHASES v2 W7, "Tests owed (week 7)".
 *
 *   "Builders: A.7 `cleanQueries` rules, A.8 `normaliseThemes` (every id exactly once, ≤ 8 themes,
 *    thin flag), the two mocks."
 *
 * `normaliseThemes` is the one worth the most care. Every candidate a search returned must appear
 * in exactly one theme, because the gap map is the screen a student uses to decide their library
 * is thin somewhere — a paper silently dropped from the grid is a paper they never see, and a
 * paper counted twice makes a gap look filled.
 */

import { describe, expect, it } from 'vitest';
import {
  cleanQueries,
  mockQueriesResponse,
  QUERIES,
  QUERY_ANGLES,
  queriesSchema,
  renderScope,
} from '../src/builder/queries.js';
import {
  mockThemesResponse,
  normaliseThemes,
  THEMES,
  themesSchema,
  themesUserMessage,
} from '../src/builder/themes.js';

const SCOPE = {
  workingTitle: 'A low-cost forced-convection solar dryer for coastal fish',
  problemStatement: 'Open-air drying on the Tamil Nadu coast loses a fifth of the catch.',
  objectives: [
    'Design a forced-convection solar dryer under ₹15,000',
    'Measure drying curves across three seasons',
  ],
  whyOpen: 'Published designs assume inland conditions and do not report coastal humidity.',
};

type Angle = (typeof QUERY_ANGLES)[number];
const q = (angle: Angle, text: string) => ({ angle, q: text });

describe('A.7 — cleanQueries', () => {
  it('keeps a well-formed query untouched', () => {
    const out = cleanQueries(
      { queries: [q('domain', 'forced convection solar dryer fish')] },
      SCOPE.workingTitle,
    );
    expect(out).toEqual([{ angle: 'domain', q: 'forced convection solar dryer fish' }]);
  });

  it('strips quotes and question marks, and collapses whitespace', () => {
    const out = cleanQueries(
      { queries: [q('domain', '  "solar   drying"  of  fish?  ')] },
      SCOPE.workingTitle,
    );
    expect(out[0]?.q).toBe('solar drying of fish');
  });

  it('drops a query that is too short or too long to be a keyword search', () => {
    const out = cleanQueries(
      {
        queries: [
          q('domain', 'solar dryer'),
          q('methodology', Array.from({ length: 13 }, (_, i) => `word${i}`).join(' ')),
          q('comparative', 'coastal fish drying humidity'),
        ],
      },
      SCOPE.workingTitle,
    );
    expect(out.map((row) => row.q)).toEqual(['coastal fish drying humidity']);
  });

  it('drops the working title verbatim — a search for the thesis finds the thesis', () => {
    const out = cleanQueries(
      { queries: [q('domain', SCOPE.workingTitle), q('domain', 'solar dryer coastal humidity')] },
      SCOPE.workingTitle,
    );
    expect(out.map((row) => row.q)).toEqual(['solar dryer coastal humidity']);
  });

  it('de-duplicates case-insensitively', () => {
    const out = cleanQueries(
      { queries: [q('domain', 'Solar Drying Of Fish'), q('methodology', 'solar drying of fish')] },
      SCOPE.workingTitle,
    );
    expect(out).toHaveLength(1);
  });

  it(`stops at ${QUERIES.max} queries`, () => {
    const many = Array.from({ length: QUERIES.max + 5 }, (_, i) =>
      q('domain', `solar dryer variation number ${i}`),
    );
    expect(cleanQueries({ queries: many }, SCOPE.workingTitle)).toHaveLength(QUERIES.max);
  });
});

describe('A.7 — the mock', () => {
  it('builds queries only from the scope it was given', () => {
    const request = {
      action: 'SEARCH_QUERIES',
      messages: [{ content: renderScope(SCOPE) }],
    };
    expect(mockQueriesResponse.match(request)).toBe(true);
    const result = mockQueriesResponse.respond(request);
    expect(() => queriesSchema.parse(result)).not.toThrow();

    // Nothing invented: every word is either from the scope block or one of the fixed
    // angle-shaping terms the mock adds to turn one topic into several search angles. A new
    // *topic* word appearing here would mean the mock started making things up.
    const ANGLE_WORDS = new Set([
      'survey',
      'method',
      'comparison',
      'districts',
      'outcomes',
      'adoption',
    ]);
    const source = renderScope(SCOPE).toLowerCase();
    for (const row of result.queries) {
      for (const word of row.q.toLowerCase().split(' ')) {
        if (ANGLE_WORDS.has(word)) continue;
        expect(source, `"${word}" is neither in the scope nor an angle word`).toContain(word);
      }
    }
  });

  it('uses only the angles A.7 lists', () => {
    const result = mockQueriesResponse.respond({ messages: [{ content: renderScope(SCOPE) }] });
    for (const row of result.queries) {
      expect(QUERY_ANGLES as readonly string[]).toContain(row.angle);
    }
  });

  it('does not answer a themes request', () => {
    expect(
      mockThemesResponse.match({ action: 'SEARCH_QUERIES', messages: [{ content: '<scope>' }] }),
    ).toBe(false);
  });
});

describe('A.8 — normaliseThemes', () => {
  const ids = (n: number, prefix = 'c') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const flatten = (themes: ReturnType<typeof normaliseThemes>) =>
    themes.flatMap((t) => t.candidateIds);

  it('places every candidate exactly once', () => {
    const all = ids(10);
    const themes = normaliseThemes(
      { themes: [{ name: 'Solar', candidateIds: all.slice(0, 6) }] },
      all,
    );
    const placed = flatten(themes);
    expect([...placed].sort()).toEqual([...all].sort());
    expect(new Set(placed).size).toBe(all.length);
  });

  it('drops ids the model invented', () => {
    const all = ids(3);
    const themes = normaliseThemes(
      { themes: [{ name: 'Solar', candidateIds: [...all, 'not-a-candidate'] }] },
      all,
    );
    expect(flatten(themes)).not.toContain('not-a-candidate');
  });

  it('keeps a duplicated id in its first theme only', () => {
    const all = ids(4);
    const themes = normaliseThemes(
      {
        themes: [
          { name: 'Solar', candidateIds: ['c0', 'c1'] },
          { name: 'Thermal', candidateIds: ['c1', 'c2', 'c3'] },
        ],
      },
      all,
    );
    expect(themes.find((t) => t.name === 'Solar')?.candidateIds).toContain('c1');
    expect(themes.find((t) => t.name === 'Thermal')?.candidateIds).not.toContain('c1');
    expect(flatten(themes)).toHaveLength(4);
  });

  it('collects what the model forgot under "Other"', () => {
    const all = ids(6);
    const themes = normaliseThemes({ themes: [{ name: 'Solar', candidateIds: ['c0'] }] }, all);
    const other = themes.find((t) => t.name === 'Other');
    expect(other?.candidateIds.sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('merges into an existing "Other" rather than making a second one', () => {
    const all = ids(5);
    const themes = normaliseThemes(
      {
        themes: [
          { name: 'Solar', candidateIds: ['c0'] },
          { name: 'other', candidateIds: ['c1'] },
        ],
      },
      all,
    );
    expect(themes.filter((t) => t.name.toLowerCase() === 'other')).toHaveLength(1);
    expect(flatten(themes)).toHaveLength(5);
  });

  it(`folds the smallest themes into "Other" past ${THEMES.maxThemes}, losing nothing`, () => {
    const all = ids(30);
    const themes = normaliseThemes(
      {
        themes: Array.from({ length: 12 }, (_, i) => ({
          name: `Theme ${i}`,
          // Descending sizes, so the tail is what gets folded.
          candidateIds: all.slice(i * 2, i * 2 + (12 - i > 2 ? 3 : 1)).filter(Boolean),
        })),
      },
      all,
    );
    expect(themes.length).toBeLessThanOrEqual(THEMES.maxThemes);
    expect([...flatten(themes)].sort()).toEqual([...all].sort());
  });

  it(`flags a theme with fewer than ${THEMES.thinBelow} candidates as thin`, () => {
    const all = ids(5);
    const themes = normaliseThemes(
      {
        themes: [
          { name: 'Well covered', candidateIds: ['c0', 'c1', 'c2', 'c3'] },
          { name: 'Thin', candidateIds: ['c4'] },
        ],
      },
      all,
    );
    expect(themes.find((t) => t.name === 'Well covered')?.thin).toBe(false);
    expect(themes.find((t) => t.name === 'Thin')?.thin).toBe(true);
  });

  it('reports count as the number of candidates in the theme', () => {
    const all = ids(3);
    const themes = normaliseThemes({ themes: [{ name: 'Solar', candidateIds: all }] }, all);
    expect(themes[0]?.count).toBe(3);
  });
});

describe('A.8 — the mock', () => {
  const candidates = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      // Deliberately varied titles: the failure this test exists for was one theme per frequent
      // word, which for sixty candidates is far more than the schema allows.
      title: `A ${['solar', 'thermal', 'convective', 'hybrid', 'photovoltaic', 'biomass'][i % 6]} ${['dryer', 'collector', 'chamber', 'absorber'][i % 4]} for ${['fish', 'grain', 'chilli', 'copra', 'fruit'][i % 5]} in ${['Kerala', 'Gujarat', 'Odisha'][i % 3]}`,
      abstract: null,
    }));

  const request = (n: number) => ({
    action: 'SEARCH_QUERIES',
    messages: [
      {
        content: themesUserMessage({
          scope: SCOPE,
          candidates: candidates(n),
          userId: 'u',
          documentId: 'd',
        }),
      },
    ],
  });

  it('matches only a request carrying <candidates>', () => {
    expect(mockThemesResponse.match(request(3))).toBe(true);
  });

  it('answers within the schema for a large result set', () => {
    // Sixty candidates is what a real `discover` run keeps. Before this bound the mock returned
    // one theme per frequent title word and every large search failed schema validation.
    const result = mockThemesResponse.respond(request(60));
    expect(() => themesSchema.parse(result)).not.toThrow();
    expect(result.themes.length).toBeLessThanOrEqual(THEMES.maxThemes);
  });

  it('places every candidate exactly once, however many there are', () => {
    for (const n of [3, 25, 60]) {
      const result = mockThemesResponse.respond(request(n));
      const placed = result.themes.flatMap((t) => t.candidateIds);
      expect(new Set(placed).size, `${n} candidates`).toBe(n);
    }
  });

  it('names themes from the candidates own titles, never from thin air', () => {
    const rows = candidates(20);
    const titles = rows
      .map((c) => c.title)
      .join(' ')
      .toLowerCase();
    for (const theme of mockThemesResponse.respond(request(20)).themes) {
      if (theme.name === 'Other') continue;
      expect(titles).toContain(theme.name.toLowerCase());
    }
  });
});
