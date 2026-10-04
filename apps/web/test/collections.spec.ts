import { describe, expect, it } from 'vitest';
import {
  addedSummary,
  checkCollectionName,
  collectionCounts,
  inCollection,
  pruneSelection,
  selectionState,
  toggleAll,
} from '../src/lib/collections';

const rows = [
  { id: 'a', collectionIds: ['m'] },
  { id: 'b', collectionIds: ['m', 'p'] },
  { id: 'c', collectionIds: [] },
  { id: 'd' },
];

describe('filtering the library by collection', () => {
  it('keeps everything, one collection, or the papers in none', () => {
    expect(inCollection(rows, { kind: 'all' }).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(inCollection(rows, { kind: 'one', id: 'm' }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(inCollection(rows, { kind: 'one', id: 'p' }).map((r) => r.id)).toEqual(['b']);
    expect(inCollection(rows, { kind: 'unfiled' }).map((r) => r.id)).toEqual(['c', 'd']);
    expect(inCollection(rows, { kind: 'one', id: 'gone' })).toEqual([]);
  });

  it('counts from the rows, a paper in two collections counting in both', () => {
    const counts = collectionCounts(rows);
    expect(counts.byId.get('m')).toBe(2);
    expect(counts.byId.get('p')).toBe(1);
    expect(counts.unfiled).toBe(2);
  });
});

describe('collection names', () => {
  const existing = [
    { id: '1', name: 'Methods' },
    { id: '2', name: 'Policy' },
  ];

  it('trims, collapses spaces and accepts a fresh name', () => {
    expect(checkCollectionName('  Chapter   2 ', existing)).toEqual({
      ok: true,
      name: 'Chapter 2',
    });
  });

  it('refuses an empty, over-long or clashing name, whatever its case', () => {
    expect(checkCollectionName('  ', existing)).toEqual({
      ok: false,
      error: 'Give the collection a name.',
    });
    expect(checkCollectionName('x'.repeat(61), existing).ok).toBe(false);
    expect(checkCollectionName('x'.repeat(60), existing).ok).toBe(true);
    expect(checkCollectionName('methods', existing)).toEqual({
      ok: false,
      error: 'There is already a collection called "Methods".',
    });
  });

  it('lets a collection keep its own name in another case when renamed', () => {
    expect(checkCollectionName('METHODS', existing, '1')).toEqual({ ok: true, name: 'METHODS' });
    expect(checkCollectionName('policy', existing, '1').ok).toBe(false);
  });
});

describe('selecting rows', () => {
  const visible = ['a', 'b', 'c'];

  it('reports none, some or all of the visible rows', () => {
    expect(selectionState(new Set(), visible)).toBe('none');
    expect(selectionState(new Set(['a', 'x']), visible)).toBe('some');
    expect(selectionState(new Set(visible), visible)).toBe('all');
  });

  it('ticks every visible row, or clears them when all were ticked', () => {
    expect([...toggleAll(new Set(['a']), visible)]).toEqual(visible);
    expect(toggleAll(new Set(visible), visible).size).toBe(0);
  });

  it('drops rows a filter hid, and keeps the same set when nothing changed', () => {
    const selected = new Set(['a', 'z']);
    expect([...pruneSelection(selected, visible)]).toEqual(['a']);
    const same = new Set(['a', 'b']);
    expect(pruneSelection(same, visible)).toBe(same);
  });

  it('says what an add did', () => {
    expect(addedSummary(3, 3, 'Methods')).toBe('Added 3 papers to Methods.');
    expect(addedSummary(1, 3, 'Methods')).toBe('Added 1 paper to Methods. 2 already there.');
    expect(addedSummary(0, 2, 'Methods')).toBe('Already in Methods.');
  });
});
