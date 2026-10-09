/**
 * R18 (ADR-0129): a paper is filed where it is added — the screen's side.
 *
 * Pinned: the chosen collection goes on the add's body as `collectionId` (null for "the library
 * only", never left out); a stale choice (a deleted collection) is dropped before it is sent; the
 * notice names the collection the server filed into; and every way a paper is added outside the
 * library's own add row — Discover, the Papers tab, chat (one paper and "Add all"), a pasted
 * reference — sends its body through `withCollection`, with the picker on that screen.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filedNotice, liveChoice, withCollection } from '../src/lib/add-into';

describe('what an add sends', () => {
  it('puts the chosen collection on the body', () => {
    expect(withCollection({ references: [{ raw: 'A' }] }, 'c1')).toEqual({
      references: [{ raw: 'A' }],
      collectionId: 'c1',
    });
  });

  it('sends null for the library only, never an empty string or nothing', () => {
    expect(withCollection({ candidateIds: ['x'] }, null)).toEqual({
      candidateIds: ['x'],
      collectionId: null,
    });
    expect(withCollection({ candidateIds: ['x'] }, '')).toHaveProperty('collectionId', null);
  });

  it('drops a choice whose collection is gone', () => {
    const collections = [{ id: 'm' }, { id: 'p' }];
    expect(liveChoice('m', collections)).toBe('m');
    expect(liveChoice('gone', collections)).toBeNull();
    expect(liveChoice(null, collections)).toBeNull();
    expect(liveChoice('m', [])).toBeNull();
  });

  it('says where the papers went', () => {
    expect(filedNotice({ id: 'm', name: 'Methods' })).toBe(' Filed in Methods.');
    expect(filedNotice(null)).toBe('');
    expect(filedNotice(undefined)).toBe('');
  });
});

describe('every add outside the library row sends the choice', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '../src', path), 'utf8');

  it.each([
    ['app/app/d/[id]/sources/DiscoverPanel.tsx', 'search/${run.runId}/select', 1],
    ['components/editor/FindPapersPanel.tsx', 'sources/resolve', 1],
    ['components/editor/ChatPanel.tsx', 'sources/resolve', 2],
    ['components/editor/CitationsPanel.tsx', 'citations/accept', 1],
  ])('%s', (path, route, calls) => {
    const source = read(path);
    // Each call to the add route is followed, within its options, by withCollection(...).
    // In a URL (after `${documentId}/`), not in a comment.
    const pattern = `}/${route}`.replace(/[$.{}/[\]]/g, '\\$&');
    const at = [...source.matchAll(new RegExp(pattern, 'g'))].map((m) => m.index ?? 0);
    expect(at.length).toBe(calls);
    for (const index of at) {
      expect(source.slice(index, index + 400)).toContain('withCollection(');
    }
  });

  it('offers the picker where the student adds', () => {
    expect(read('app/app/d/[id]/sources/SourcesScreen.tsx')).toContain('<AddIntoPicker');
    expect(read('app/app/d/[id]/sources/SourcesScreen.tsx')).toContain(
      'addInto={addInto.collectionId}',
    );
    for (const path of [
      'components/editor/FindPapersPanel.tsx',
      'components/editor/ChatPanel.tsx',
      'components/editor/CitationsPanel.tsx',
    ]) {
      expect(read(path)).toContain('<AddIntoPicker');
      expect(read(path)).toContain('useAddInto(documentId)');
    }
  });
});
