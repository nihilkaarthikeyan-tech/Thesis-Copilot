import { describe, expect, it } from 'vitest';
import { joinBrokenWords, readFirstPage } from '../src/scholarly/first-page.js';

/** The synthetic test PDF from the Jenni study, as the text extractor gives it. */
const TEST_NOTE = `Night-time heat exposure of street vendors in
Chennai: a field note
A. Test Author, Department of Urban Studies (test document for software evaluation, 2026)
Abstract
This short field note is a synthetic test document. It describes a hypothetical survey of 40 street vendors in
two Chennai neighbourhoods and their sleep quality during hot nights in May. It is written only to test how
reference software reads an uploaded PDF and must not be cited.
1. Introduction
Night-time temperatures in coastal South Indian cities stay high during the pre-monsoon months.`;

const JOURNAL = `Journal of Landscape Ecology (2026), Vol: 19 / No. 2
DOI: 10.2478/jlecol-2026-0015
DECADAL DYNAMICS OF NIGHTTIME URBAN HEAT ISLAND
Kajesh Gadekar1, Aneesh Mathew2 and P. Sarwesh1
1 Department of Civil Engineering, National Institute of Technology
Abstract: Nighttime urban heat islands intensify heat stress. This study tracks the night-
time land surface temperature of Coimbatore from 2001 to 2022 using satellite records and shows
rising clustering of hot zones across the city over two decades of rapid growth and change.
Keywords: urban heat island, nighttime`;

describe("an uploaded PDF's first page (Jenni build plan R20)", () => {
  it('the test PDF: the title on one line, the initial kept, the abstract, the year', () => {
    expect(readFirstPage(TEST_NOTE)).toEqual({
      title: 'Night-time heat exposure of street vendors in Chennai: a field note',
      authors: [{ family: 'Author', given: 'A. Test' }],
      abstract:
        'This short field note is a synthetic test document. It describes a hypothetical survey of 40 street vendors in two Chennai neighbourhoods and their sleep quality during hot nights in May. It is written only to test how reference software reads an uploaded PDF and must not be cited.',
      year: 2026,
    });
  });

  it('a journal page: the printed DOI, three authors without their marks, the abstract joined', () => {
    const page = readFirstPage(JOURNAL);
    expect(page.doi).toBe('10.2478/jlecol-2026-0015');
    expect(page.authors).toEqual([
      { family: 'Gadekar', given: 'Kajesh' },
      { family: 'Mathew', given: 'Aneesh' },
      { family: 'Sarwesh', given: 'P.' },
    ]);
    expect(page.title).toBe('DECADAL DYNAMICS OF NIGHTTIME URBAN HEAT ISLAND');
    expect(page.abstract).toMatch(
      /^Nighttime urban heat islands intensify heat stress\. This study tracks the nighttime land/,
    );
    expect(page.abstract).not.toMatch(/Keywords/);
  });

  it('joins a word broken at a line end, and keeps a real hyphen', () => {
    expect(joinBrokenWords('temper-\nature and night-time')).toBe('temperature and night-time');
  });

  it('says nothing it cannot see', () => {
    expect(
      readFirstPage('Some running text without a byline or an abstract heading at all.'),
    ).toEqual({});
  });
});
