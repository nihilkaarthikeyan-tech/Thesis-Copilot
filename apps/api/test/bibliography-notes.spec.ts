/**
 * Jenni build plan R25 (ADR-0112) — a chapter's bibliography notes: the publication-year chart and
 * the venue spread. Only what the records hold is counted; a missing year or venue is reported as
 * missing, never filled in.
 */

import { describe, expect, it } from 'vitest';
import {
  bibliographyNotes,
  MAX_YEAR_BINS,
  type NoteSource,
  TOP_VENUES,
} from '../src/modules/sources/bibliography-notes.js';

const now = new Date('2026-10-08T00:00:00Z');
const paper = (year: number | null, venue: string | null = null, id: string | null = null) =>
  ({ year, venue, venueOpenalexId: id }) satisfies NoteSource;

describe('bibliographyNotes — years', () => {
  it('gives the median, the range and the papers over a decade old', () => {
    const notes = bibliographyNotes([paper(2021), paper(2014), paper(2023)], now);
    expect(notes.works).toBe(3);
    expect(notes.years).toMatchObject({
      known: 3,
      median: 2021,
      oldest: 2014,
      newest: 2023,
      overDecade: 1,
      overDecadeThrough: 2015,
    });
  });

  it('takes the earlier middle year of an even count, a year that is really there', () => {
    const notes = bibliographyNotes([paper(2018), paper(2021), paper(2010), paper(2024)], now);
    expect(notes.years.median).toBe(2018);
  });

  it('counts a paper ten years old as not over a decade, and eleven as over', () => {
    expect(bibliographyNotes([paper(2016)], now).years.overDecade).toBe(0);
    expect(bibliographyNotes([paper(2015)], now).years.overDecade).toBe(1);
  });

  it('leaves a paper with no year out of the chart and says so', () => {
    const notes = bibliographyNotes([paper(2020), paper(null), paper(null)], now);
    expect(notes.works).toBe(3);
    expect(notes.years.known).toBe(1);
    expect(notes.years.bins).toEqual([{ from: 2020, to: 2020, works: 1 }]);
  });

  it('has no median and no bars when no paper has a year', () => {
    const notes = bibliographyNotes([paper(null)], now);
    expect(notes.years).toMatchObject({ known: 0, median: null, oldest: null, bins: [] });
  });

  it('draws one bar a year over a short span, empty years included', () => {
    const notes = bibliographyNotes([paper(2019), paper(2021), paper(2021)], now);
    expect(notes.years.bins).toEqual([
      { from: 2019, to: 2019, works: 1 },
      { from: 2020, to: 2020, works: 0 },
      { from: 2021, to: 2021, works: 2 },
    ]);
  });

  it('groups a long span into round bins, never more than fit the panel, clipped to the data', () => {
    const notes = bibliographyNotes([paper(1998), paper(2003), paper(2004), paper(2025)], now);
    expect(notes.years.bins.length).toBeLessThanOrEqual(MAX_YEAR_BINS);
    expect(notes.years.bins[0]).toEqual({ from: 1998, to: 1999, works: 1 });
    expect(notes.years.bins[1]).toEqual({ from: 2000, to: 2004, works: 2 });
    expect(notes.years.bins.at(-1)).toEqual({ from: 2025, to: 2025, works: 1 });
    expect(notes.years.bins.reduce((n, b) => n + b.works, 0)).toBe(4);
  });

  it('keeps even a century-wide span within the bar limit', () => {
    const notes = bibliographyNotes([paper(1890), paper(1950), paper(2026)], now);
    expect(notes.years.bins.length).toBeLessThanOrEqual(MAX_YEAR_BINS);
    expect(notes.years.bins.reduce((n, b) => n + b.works, 0)).toBe(3);
  });
});

describe('bibliographyNotes — venues', () => {
  it('counts unique venues across the works, most used first', () => {
    const notes = bibliographyNotes(
      [paper(2020, 'Energy Policy'), paper(2021, 'Renewable Energy'), paper(2022, 'Energy Policy')],
      now,
    );
    expect(notes.venues).toEqual({
      known: 3,
      unique: 2,
      top: [
        { name: 'Energy Policy', works: 2 },
        { name: 'Renewable Energy', works: 1 },
      ],
      otherWorks: 0,
    });
  });

  it('treats case, spacing and a trailing full stop as the same journal', () => {
    const notes = bibliographyNotes(
      [paper(2020, 'Energy  Policy'), paper(2021, 'energy policy.')],
      now,
    );
    expect(notes.venues.unique).toBe(1);
    expect(notes.venues.top).toEqual([{ name: 'Energy Policy', works: 2 }]);
  });

  it('treats the same OpenAlex journal under two spellings as one venue', () => {
    const notes = bibliographyNotes(
      [paper(2020, 'J. Hydrol.', 'S1'), paper(2021, 'Journal of Hydrology', 'S1')],
      now,
    );
    expect(notes.venues.unique).toBe(1);
  });

  it('leaves a paper with no venue out and does not invent one', () => {
    const notes = bibliographyNotes([paper(2020, 'Nature'), paper(2021, null), paper(2022, ' ')]);
    expect(notes.venues).toMatchObject({ known: 1, unique: 1 });
  });

  it('names the top venues and sums the rest', () => {
    const venues = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const notes = bibliographyNotes(
      venues.map((v) => paper(2020, `Journal ${v}`)),
      now,
    );
    expect(notes.venues.unique).toBe(7);
    expect(notes.venues.top).toHaveLength(TOP_VENUES);
    expect(notes.venues.otherWorks).toBe(7 - TOP_VENUES);
  });

  it('is empty for a chapter that cites nothing', () => {
    const notes = bibliographyNotes([], now);
    expect(notes.works).toBe(0);
    expect(notes.venues).toEqual({ known: 0, unique: 0, top: [], otherWorks: 0 });
    expect(notes.years.bins).toEqual([]);
  });
});
