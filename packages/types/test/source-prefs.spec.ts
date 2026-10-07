import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_PREFS,
  listedInFilter,
  meetsSourcePrefs,
  readSourcePrefs,
  sourcePrefsSchema,
} from '../src/source-prefs.js';

describe("ADR-0087: a thesis's source preferences", () => {
  it('defaults for a thesis made before there were any', () => {
    expect(readSourcePrefs(null)).toEqual(DEFAULT_SOURCE_PREFS);
    expect(readSourcePrefs({ sourcePrefs: { webSearch: 'yes' } })).toEqual(DEFAULT_SOURCE_PREFS);
  });

  it('refuses both searches off, and a year range backwards', () => {
    const base = { ...DEFAULT_SOURCE_PREFS };
    expect(
      sourcePrefsSchema.safeParse({ ...base, webSearch: false, librarySearch: false }).success,
    ).toBe(false);
    expect(sourcePrefsSchema.safeParse({ ...base, yearFrom: 2024, yearTo: 2020 }).success).toBe(
      false,
    );
    expect(sourcePrefsSchema.safeParse({ ...base, yearFrom: 2020, yearTo: 2024 }).success).toBe(
      true,
    );
  });

  it('maps ABDC to its four grades for OpenAlex', () => {
    expect(listedInFilter({ ...DEFAULT_SOURCE_PREFS, indexedIn: ['abdc', 'doaj'] })).toEqual([
      'abdc-a-star',
      'abdc-a',
      'abdc-b',
      'abdc-c',
      'doaj',
    ]);
  });

  it('keeps a found paper only when it meets every preference', () => {
    const prefs = {
      ...DEFAULT_SOURCE_PREFS,
      yearFrom: 2021,
      preprints: false,
      indexedIn: ['doaj' as const],
    };
    const ok = { year: 2023, isPreprint: false, listedIn: ['doaj', 'cwts-core'] };
    expect(meetsSourcePrefs(ok, prefs)).toBe(true);
    expect(meetsSourcePrefs({ ...ok, year: 2019 }, prefs)).toBe(false);
    expect(meetsSourcePrefs({ ...ok, isPreprint: true }, prefs)).toBe(false);
    expect(meetsSourcePrefs({ ...ok, listedIn: ['cwts-core'] }, prefs)).toBe(false);
    // An index that cannot say where a paper is listed never passes an indexing filter.
    expect(meetsSourcePrefs({ year: 2023, isPreprint: false }, prefs)).toBe(false);
    expect(meetsSourcePrefs({ year: 2023, isPreprint: false }, DEFAULT_SOURCE_PREFS)).toBe(true);
  });
});
