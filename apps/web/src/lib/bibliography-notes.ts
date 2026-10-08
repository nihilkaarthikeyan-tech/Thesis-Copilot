/**
 * The words around a chapter's bibliography notes — Jenni build plan R25 (ADR-0112). The figures
 * come from the API (`GET /documents/:id/sources/quality?chapterId=`, `bibliography-notes.ts`);
 * this only says them, and says plainly what the records did not hold.
 */

export type YearBin = { from: number; to: number; works: number };

export type BibliographyNotes = {
  works: number;
  years: {
    known: number;
    median: number | null;
    oldest: number | null;
    newest: number | null;
    overDecade: number;
    overDecadeThrough: number;
    bins: YearBin[];
  };
  venues: {
    known: number;
    unique: number;
    top: Array<{ name: string; works: number }>;
    otherWorks: number;
  };
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Median year 2021. 1 of 3 works is over a decade old (2015 or earlier)." */
export function yearSentence(notes: BibliographyNotes): string {
  const { years, works } = notes;
  if (years.known === 0) {
    return works === 1
      ? 'The paper has no publication year on record.'
      : `None of the ${works} papers has a publication year on record.`;
  }
  const missing = works - years.known;
  const uncharted =
    missing > 0
      ? ` ${count(missing, 'paper')} with no year on record ${missing === 1 ? 'is' : 'are'} not charted.`
      : '';
  if (years.known === 1) {
    const when = `${years.median}${years.overDecade === 1 ? ', over a decade ago' : ''}`;
    return works === 1
      ? `Published in ${when}.`
      : `Only 1 of ${works} papers has a year on record: ${when}. The others are not charted.`;
  }
  const old =
    years.overDecade === 0
      ? `None of the ${years.known} works is over a decade old.`
      : `${years.overDecade} of ${years.known} works ${years.overDecade === 1 ? 'is' : 'are'} over a decade old (${years.overDecadeThrough} or earlier).`;
  return `Median year ${years.median}. ${old}${uncharted}`;
}

/** "3 unique venues across 3 works." */
export function venueSentence(notes: BibliographyNotes): string {
  const { venues, works } = notes;
  if (venues.known === 0) {
    return works === 1
      ? 'The paper has no journal or venue on record.'
      : `None of the ${works} papers has a journal or venue on record.`;
  }
  const missing = works - venues.known;
  return `${count(venues.unique, 'unique venue')} across ${count(venues.known, 'work')}.${
    missing > 0 ? ` ${count(missing, 'paper')} with no venue on record.` : ''
  }`;
}

/** A bin's label: "2019", or "2015–2019". */
export function binLabel(bin: YearBin): string {
  return bin.from === bin.to ? String(bin.from) : `${bin.from}–${bin.to}`;
}

/** True when every year in the bin is over a decade old: drawn pale, as the sentence says. */
export function binIsOld(bin: YearBin, notes: BibliographyNotes): boolean {
  return bin.to <= notes.years.overDecadeThrough;
}
