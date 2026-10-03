/**
 * Theme density — ADR-0046. How much has actually been published on each gap-map theme, counted by
 * OpenAlex, and whether that is growing.
 *
 * The idea is taken from Rademics Copilot's literature builder, which writes targeted queries per
 * thematic cluster and counts real publication density per theme. Here the query is built in code
 * (no model call, nothing metered): the thesis title's content words anchor it to the field, and
 * the theme's own words narrow it. Counts are what OpenAlex returned for that query, per year —
 * observed numbers, never estimates. A theme whose count could not be fetched has no density
 * rather than a guessed one.
 */

import { keywordsOf } from '../scholarly/keywords.js';

export type YearCount = { year: number; count: number };

export type ThemeDensity = {
  /** The query OpenAlex was asked, so the student can run it themselves. */
  query: string;
  /** Works OpenAlex holds for the query across the years counted. */
  total: number;
  /** The last three complete years. */
  recent: number;
  /** The three years before those. */
  previous: number;
  /**
   * `rising` when the recent three years hold at least a quarter more than the three before,
   * `falling` when a fifth fewer, `steady` otherwise; null when there is too little to say.
   */
  trend: 'rising' | 'steady' | 'falling' | null;
  perYear: YearCount[];
};

export const DENSITY = {
  /** Years in each half of the trend comparison. */
  window: 3,
  /** Below this many works in the two windows together, no trend is read. */
  minForTrend: 20,
  rising: 1.25,
  falling: 0.8,
  /** Title words that appear in at least this many of a theme's papers count as its vocabulary. */
  minShared: 2,
  /** Content words of the thesis title kept as the anchor. */
  anchorWords: 3,
  /** Words the theme contributes. */
  themeWords: 3,
} as const;

/** Words every theme name and title uses, which narrow nothing. */
const GENERIC = new Set([
  'analysis',
  'approach',
  'approaches',
  'based',
  'effect',
  'effects',
  'factors',
  'impact',
  'impacts',
  'method',
  'methods',
  'model',
  'models',
  'other',
  'review',
  'role',
  'system',
  'systems',
  'using',
]);

/**
 * The query for one theme: the thesis anchor, then the theme name's own words, then — when the
 * name is short — the words its papers' titles share. Deterministic, so a rerun asks the same.
 */
export function themeQuery(
  workingTitle: string,
  themeName: string,
  candidateTitles: readonly string[],
): string {
  const anchor = keywordsOf(workingTitle, DENSITY.anchorWords);
  const used = new Set(anchor);
  const words: string[] = [];
  for (const w of keywordsOf(themeName, 8)) {
    if (words.length >= DENSITY.themeWords) break;
    if (used.has(w) || GENERIC.has(w)) continue;
    used.add(w);
    words.push(w);
  }
  if (words.length < DENSITY.themeWords) {
    const freq = new Map<string, number>();
    for (const title of candidateTitles) {
      for (const w of new Set(keywordsOf(title, 20))) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    const shared = [...freq.entries()]
      .filter(([w, n]) => n >= DENSITY.minShared && !used.has(w) && !GENERIC.has(w))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([w]) => w);
    for (const w of shared) {
      if (words.length >= DENSITY.themeWords) break;
      used.add(w);
      words.push(w);
    }
  }
  return [...anchor, ...words].join(' ');
}

/** The trend and totals from per-year counts. The current, unfinished year is not in either window. */
export function densityFrom(query: string, perYear: readonly YearCount[], now: Date): ThemeDensity {
  const thisYear = now.getUTCFullYear();
  const inRange = (from: number, to: number) =>
    perYear.filter((y) => y.year >= from && y.year <= to).reduce((n, y) => n + y.count, 0);
  const recent = inRange(thisYear - DENSITY.window, thisYear - 1);
  const previous = inRange(thisYear - 2 * DENSITY.window, thisYear - DENSITY.window - 1);
  const total = perYear.reduce((n, y) => n + y.count, 0);
  let trend: ThemeDensity['trend'] = null;
  if (recent + previous >= DENSITY.minForTrend) {
    if (previous === 0 || recent >= previous * DENSITY.rising) trend = 'rising';
    else if (recent <= previous * DENSITY.falling) trend = 'falling';
    else trend = 'steady';
  }
  return {
    query,
    total,
    recent,
    previous,
    trend,
    perYear: [...perYear].sort((a, b) => a.year - b.year),
  };
}
