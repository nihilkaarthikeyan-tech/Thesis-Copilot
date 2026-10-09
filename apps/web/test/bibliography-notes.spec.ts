import { describe, expect, it } from 'vitest';
import {
  type BibliographyNotes,
  binIsOld,
  binLabel,
  checkedPhrase,
  citedHeading,
  citedTimes,
  venueSentence,
  worksPhrase,
  yearSentence,
} from '../src/lib/bibliography-notes';

function notes(over: Partial<BibliographyNotes> = {}): BibliographyNotes {
  return {
    works: 3,
    years: {
      known: 3,
      median: 2021,
      oldest: 2014,
      newest: 2023,
      overDecade: 1,
      overDecadeThrough: 2015,
      bins: [],
    },
    venues: {
      known: 3,
      unique: 3,
      top: [],
      otherWorks: 0,
    },
    ...over,
  };
}

describe('bibliography notes, in words (Jenni build plan R25)', () => {
  it('says the median year and how many works are over a decade old, as Jenni does', () => {
    expect(yearSentence(notes())).toBe(
      'Median year 2021. One of 3 works is over a decade old (2015 or earlier).',
    );
    expect(venueSentence(notes())).toBe('3 unique venues across 3 works.');
  });

  it('says which papers were not charted because the record has no year or venue', () => {
    const n = notes({
      works: 5,
      venues: { known: 4, unique: 2, top: [], otherWorks: 0 },
    });
    expect(yearSentence(n)).toBe(
      'Median year 2021. One of 3 works is over a decade old (2015 or earlier). 2 papers with no year on record are not charted.',
    );
    expect(venueSentence(n)).toBe(
      '2 unique venues across 4 works. One paper with no venue on record.',
    );
  });

  it('never states a year or a venue the records do not hold', () => {
    const none = notes({
      works: 2,
      years: { ...notes().years, known: 0, median: null, overDecade: 0 },
      venues: { known: 0, unique: 0, top: [], otherWorks: 0 },
    });
    expect(yearSentence(none)).toBe('None of the 2 papers has a publication year on record.');
    expect(venueSentence(none)).toBe('None of the 2 papers has a journal or venue on record.');
  });

  it('speaks of one paper as one paper', () => {
    const one = notes({
      works: 1,
      years: { ...notes().years, known: 1, median: 2012, overDecade: 1 },
      venues: { known: 1, unique: 1, top: [], otherWorks: 0 },
    });
    expect(yearSentence(one)).toBe('Published in 2012, over a decade ago.');
    expect(venueSentence(one)).toBe('One venue on record.');
    expect(
      yearSentence({ ...one, works: 3, years: { ...one.years, overDecade: 0, median: 2022 } }),
    ).toBe('Only one of 3 papers has a year on record: 2022. The others are not charted.');
  });

  it('writes one as a word in every count phrase, never "1 work" or "1 papers"', () => {
    expect(citedHeading(1)).toBe('The one work this chapter cites');
    expect(citedHeading(4)).toBe('The 4 works this chapter cites');
    expect(worksPhrase(1)).toBe('one work');
    expect(worksPhrase(2)).toBe('2 works');
    expect(checkedPhrase(1)).toBe('One paper checked.');
    expect(checkedPhrase(0)).toBe('0 papers checked.');
    expect(checkedPhrase(7)).toBe('7 papers checked.');
    expect(citedTimes(1)).toBe('Cited once in your thesis');
    expect(citedTimes(2)).toBe('Cited twice in your thesis');
    expect(citedTimes(5)).toBe('Cited 5 times in your thesis');
    expect(venueSentence(notes({ venues: { known: 3, unique: 1, top: [], otherWorks: 0 } }))).toBe(
      'All 3 works in one venue.',
    );
  });

  it('says when no work is over a decade old', () => {
    expect(yearSentence(notes({ years: { ...notes().years, overDecade: 0 } }))).toBe(
      'Median year 2021. None of the 3 works is over a decade old.',
    );
  });

  it('labels a bar by its year or its span, and greys only a bar wholly over a decade old', () => {
    expect(binLabel({ from: 2019, to: 2019, works: 1 })).toBe('2019');
    expect(binLabel({ from: 2015, to: 2019, works: 2 })).toBe('2015–2019');
    expect(binIsOld({ from: 2010, to: 2014, works: 1 }, notes())).toBe(true);
    expect(binIsOld({ from: 2015, to: 2019, works: 1 }, notes())).toBe(false);
  });
});
