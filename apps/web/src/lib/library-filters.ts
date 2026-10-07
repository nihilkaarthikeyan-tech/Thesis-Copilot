/**
 * The library's filters (Jenni build plan R17, ADR-0104): publication year, open access and kind,
 * on top of the full-text and collection filters it already had. Pure, so the list and the tests
 * agree on what each one keeps.
 */

export type LibraryKind =
  | 'any'
  | 'article'
  | 'book'
  | 'chapter'
  | 'conference'
  | 'preprint'
  | 'other';

export type LibraryFilters = {
  yearFrom: number | null;
  yearTo: number | null;
  /** Free to read, known to be closed, or either (a paper whose status is unknown is in "any"). */
  access: 'any' | 'open' | 'closed';
  kind: LibraryKind;
};

export const NO_FILTERS: LibraryFilters = {
  yearFrom: null,
  yearTo: null,
  access: 'any',
  kind: 'any',
};

type Filterable = {
  year: number | null;
  openAccess?: boolean | null;
  isPreprint: boolean;
  /** The CSL type, when the record has one. */
  type?: string | null;
};

/** What kind of thing a library row is, from its CSL type and the preprint flag. */
export function kindOf(row: Filterable): Exclude<LibraryKind, 'any'> {
  if (row.isPreprint || row.type === 'article' || row.type === 'posted-content') return 'preprint';
  switch (row.type) {
    case 'article-journal':
    case 'journal-article':
    case 'review':
      return 'article';
    case 'book':
    case 'monograph':
    case 'edited-book':
      return 'book';
    case 'chapter':
    case 'book-chapter':
      return 'chapter';
    case 'paper-conference':
    case 'proceedings-article':
      return 'conference';
    case null:
    case undefined:
    case '':
      // Most rows without a type came from a journal search; the citation builder treats a row
      // with a venue as a journal article too.
      return 'article';
    default:
      return 'other';
  }
}

export function applyLibraryFilters<T extends Filterable>(
  rows: readonly T[],
  f: LibraryFilters,
): T[] {
  return rows.filter((row) => {
    if (f.yearFrom !== null && (row.year === null || row.year < f.yearFrom)) return false;
    if (f.yearTo !== null && (row.year === null || row.year > f.yearTo)) return false;
    if (f.access === 'open' && row.openAccess !== true) return false;
    if (f.access === 'closed' && row.openAccess !== false) return false;
    if (f.kind !== 'any' && kindOf(row) !== f.kind) return false;
    return true;
  });
}

export const anyFilterOn = (f: LibraryFilters): boolean =>
  f.yearFrom !== null || f.yearTo !== null || f.access !== 'any' || f.kind !== 'any';
