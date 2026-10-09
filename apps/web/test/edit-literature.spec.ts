/**
 * ADR-0133 — "Search the literature" on an AI edit, the screen's side.
 *
 * Pinned: the switch sends `searchLiterature` for the edits it applies to (and implies the
 * library), never on a follow-up or an edit that takes no passages; the added list's words; and
 * that the panel sends through `commandRunBody` and draws the list with each paper opening in the
 * reader.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addedHeading,
  commandRunBody,
  type EditLiterature,
  literatureApplies,
} from '../src/lib/edit-literature';

const base = {
  chapterId: 'c1',
  selection: 'Upfront cost limits adoption.',
  contextBefore: '',
  contextAfter: '',
};

describe('what an edit sends', () => {
  it('sends the switch with your own instruction, and the library with it', () => {
    expect(
      commandRunBody({
        ...base,
        command: 'custom',
        instruction: 'Add evidence',
        useLibrary: false,
        searchLiterature: true,
      }),
    ).toEqual({
      ...base,
      command: 'custom',
      instruction: 'Add evidence',
      useLibrary: true,
      searchLiterature: true,
    });
  });

  it('sends it with the edits that take passages', () => {
    for (const command of ['expand', 'consistency', 'counter']) {
      expect(literatureApplies(command)).toBe(true);
      expect(
        commandRunBody({ ...base, command, useLibrary: true, searchLiterature: true }),
      ).toHaveProperty('searchLiterature', true);
    }
  });

  it('never with an edit that takes no passages, a follow-up, or the switch off', () => {
    expect(literatureApplies('formalise')).toBe(false);
    expect(
      commandRunBody({ ...base, command: 'formalise', useLibrary: true, searchLiterature: true }),
    ).not.toHaveProperty('searchLiterature');
    expect(
      commandRunBody({
        ...base,
        command: 'custom',
        instruction: 'Shorter',
        useLibrary: true,
        searchLiterature: true,
        original: 'The first text.',
      }),
    ).not.toHaveProperty('searchLiterature');
    const off = commandRunBody({
      ...base,
      command: 'custom',
      instruction: 'Shorter',
      useLibrary: false,
      searchLiterature: false,
    });
    expect(off).not.toHaveProperty('searchLiterature');
    expect(off.useLibrary).toBe(false);
  });
});

describe('the added list', () => {
  const literature: EditLiterature = {
    added: [
      { sourceId: 's1', shortRef: 'Rao 2022', title: 'Credit and solar', year: 2022 },
      { sourceId: 's2', shortRef: 'Iyer 2021', title: 'Solar loans', year: 2021 },
    ],
    collection: { id: 'k1', name: 'Finance' },
    note: null,
  };

  it('names the collection the papers were filed into', () => {
    expect(addedHeading(literature)).toBe('Added to your library (in Finance) — 2 papers:');
    expect(
      addedHeading({ ...literature, added: literature.added.slice(0, 1), collection: null }),
    ).toBe('Added to your library:');
  });
});

describe('the panel', () => {
  const source = readFileSync(
    resolve(__dirname, '../src/components/editor/CommandToolbar.tsx'),
    'utf8',
  );

  it('has the switch beside "Use my library" and sends through commandRunBody', () => {
    expect(source).toContain('data-testid="ai-edit-literature"');
    expect(source).toContain('Search the literature');
    expect(source).toMatch(/commandRunBody\(\{[\s\S]*searchLiterature,/);
  });

  it('lists the added papers, each opening in the reader', () => {
    expect(source).toContain('data-testid="command-literature"');
    expect(source).toMatch(/href=\{readerHref\(documentId, paper\.sourceId\)\}/);
    expect(source).toContain('data-testid="command-literature-note"');
  });
});
