/**
 * Bibliography notes for one chapter — Jenni build plan R25 (ADR-0112; inventory §13.3).
 *
 * Jenni's Source Quality review ends with two notes on the document's bibliography: a
 * publication-year chart ("median year 2021; 1 of 3 works over a decade old") and a venue spread
 * ("3 unique venues across 3 works"). These are the same two notes over the papers a chapter
 * cites, each paper once however often it is cited.
 *
 * Pure: the service feeds it the cited sources' records and draws nothing from anywhere else.
 * Only what the record holds is counted. A paper with no year is left out of the year figures and
 * a paper with no venue out of the venue figures, and both are reported as such, never guessed.
 */

export type NoteSource = {
  year: number | null;
  venue: string | null;
  /** OpenAlex's id for the journal (ADR-0022), when one was looked up. */
  venueOpenalexId: string | null;
};

export type YearBin = {
  /** First and last year of the bin, clipped to the years actually present. */
  from: number;
  to: number;
  works: number;
};

export type BibliographyNotes = {
  /** Distinct papers the chapter cites. */
  works: number;
  years: {
    /** Papers with a year on record; the rest have none and are not charted. */
    known: number;
    /** The middle year; of an even count, the earlier of the two middle years (a year present). */
    median: number | null;
    oldest: number | null;
    newest: number | null;
    /** Papers published more than ten years before this year. */
    overDecade: number;
    /** The latest year that counts as over a decade old (this year minus eleven). */
    overDecadeThrough: number;
    /** Contiguous bins from the oldest year to the newest, empty bins included. */
    bins: YearBin[];
  };
  venues: {
    /** Papers with a venue on record. */
    known: number;
    /** Distinct venues among them. */
    unique: number;
    /** The most used venues, most papers first, at most `TOP_VENUES`. */
    top: Array<{ name: string; works: number }>;
    /** Papers in the venues beyond `top`. */
    otherWorks: number;
  };
};

/** Bars in the year chart: the side panel is 288 px wide, so a bar is never thinner than ~20 px. */
export const MAX_YEAR_BINS = 12;

/** Venues listed by name; the rest are summed. */
export const TOP_VENUES = 5;

/** Bin widths tried in order, so the labels stay round (2015–2019, 2000–2009). */
const BIN_WIDTHS = [1, 2, 5, 10, 20, 50, 100];

/** A venue name as compared: case, spacing and trailing punctuation do not make a new journal. */
function venueKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:]+$/, '')
    .trim();
}

function yearBins(years: readonly number[]): YearBin[] {
  if (years.length === 0) return [];
  const oldest = Math.min(...years);
  const newest = Math.max(...years);
  let width =
    BIN_WIDTHS.find((w) => Math.floor(newest / w) - Math.floor(oldest / w) + 1 <= MAX_YEAR_BINS) ??
    0;
  if (width === 0) width = Math.ceil((newest - oldest + 1) / MAX_YEAR_BINS);
  // Aligned to the width (2015–2019, not 2013–2017) when the width is one of the round ones.
  const start = BIN_WIDTHS.includes(width) ? Math.floor(oldest / width) * width : oldest;
  const bins: YearBin[] = [];
  for (let from = start; from <= newest; from += width) {
    const to = from + width - 1;
    bins.push({
      from: Math.max(from, oldest),
      to: Math.min(to, newest),
      works: years.filter((y) => y >= from && y <= to).length,
    });
  }
  return bins;
}

export function bibliographyNotes(
  sources: readonly NoteSource[],
  now: Date = new Date(),
): BibliographyNotes {
  const thisYear = now.getUTCFullYear();
  const years = sources
    .map((s) => s.year)
    .filter((y): y is number => typeof y === 'number' && Number.isInteger(y) && y > 0)
    .sort((a, b) => a - b);
  const overDecadeThrough = thisYear - 11;

  // One group per journal: the same OpenAlex id, or the same name once normalised, is one venue.
  type Group = { name: string; works: number; order: number };
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  let venuesKnown = 0;
  for (const source of sources) {
    const name = source.venue?.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    venuesKnown++;
    const nameKey = `name:${venueKey(name)}`;
    const idKey = source.venueOpenalexId ? `id:${source.venueOpenalexId}` : null;
    let group = (idKey ? byKey.get(idKey) : undefined) ?? byKey.get(nameKey);
    if (!group) {
      group = { name, works: 0, order: groups.length };
      groups.push(group);
    }
    group.works++;
    byKey.set(nameKey, group);
    if (idKey) byKey.set(idKey, group);
  }
  const ranked = [...groups].sort(
    (a, b) => b.works - a.works || a.name.localeCompare(b.name) || a.order - b.order,
  );
  const top = ranked.slice(0, TOP_VENUES).map(({ name, works }) => ({ name, works }));

  return {
    works: sources.length,
    years: {
      known: years.length,
      median: years.length > 0 ? (years[Math.floor((years.length - 1) / 2)] ?? null) : null,
      oldest: years[0] ?? null,
      newest: years[years.length - 1] ?? null,
      overDecade: years.filter((y) => y <= overDecadeThrough).length,
      overDecadeThrough,
      bins: yearBins(years),
    },
    venues: {
      known: venuesKnown,
      unique: groups.length,
      top,
      otherWorks: venuesKnown - top.reduce((n, v) => n + v.works, 0),
    },
  };
}
