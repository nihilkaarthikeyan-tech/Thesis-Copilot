import { describe, expect, it } from 'vitest';
import { applyLibraryFilters, kindOf, NO_FILTERS } from '../src/lib/library-filters';

const rows = [
  { id: 'a', year: 2018, openAccess: true, isPreprint: false, type: 'article-journal' },
  { id: 'b', year: 2022, openAccess: false, isPreprint: false, type: 'book' },
  { id: 'c', year: 2024, openAccess: null, isPreprint: true, type: 'article' },
  { id: 'd', year: null, openAccess: true, isPreprint: false, type: 'chapter' },
  { id: 'e', year: 2021, openAccess: true, isPreprint: false, type: 'paper-conference' },
];
const ids = (list: Array<{ id: string }>) => list.map((r) => r.id);

describe('the library filters (Jenni build plan R17)', () => {
  it('keep everything when off', () => {
    expect(ids(applyLibraryFilters(rows, NO_FILTERS))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('narrow by year, leaving out papers with no year', () => {
    expect(ids(applyLibraryFilters(rows, { ...NO_FILTERS, yearFrom: 2021 }))).toEqual([
      'b',
      'c',
      'e',
    ]);
    expect(ids(applyLibraryFilters(rows, { ...NO_FILTERS, yearFrom: 2019, yearTo: 2022 }))).toEqual(
      ['b', 'e'],
    );
  });

  it('narrow by access; an unknown status is in neither open nor closed', () => {
    expect(ids(applyLibraryFilters(rows, { ...NO_FILTERS, access: 'open' }))).toEqual([
      'a',
      'd',
      'e',
    ]);
    expect(ids(applyLibraryFilters(rows, { ...NO_FILTERS, access: 'closed' }))).toEqual(['b']);
  });

  it('narrow by kind, a preprint being a preprint whatever its type', () => {
    expect(ids(applyLibraryFilters(rows, { ...NO_FILTERS, kind: 'preprint' }))).toEqual(['c']);
    expect(ids(applyLibraryFilters(rows, { ...NO_FILTERS, kind: 'book' }))).toEqual(['b']);
    expect(kindOf({ year: 2020, isPreprint: false, type: null })).toBe('article');
    expect(kindOf({ year: 2020, isPreprint: false, type: 'thesis' })).toBe('other');
  });
});
