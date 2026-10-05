/** ADR-0085: pins per section — a section's own pins win; otherwise the chapter's apply. */

import { describe, expect, it } from 'vitest';
import { type ContextClient, pinsInScope, retrievePassages } from '../src/context.js';
import { EMBEDDING_DIMENSIONS } from '../src/pgvector.js';

type Pin = { sourceId: string; section: string };

function fakeDb(pins: Pin[]) {
  const sourceFilters: unknown[] = [];
  const wheres: unknown[] = [];
  const db: ContextClient = {
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async <T>(_sql: string, ...values: unknown[]) => {
      sourceFilters.push(values[2]);
      return [] as T;
    },
    documentMemory: { findUnique: async () => ({ outline: [] }) },
    chapterSourcePin: {
      findMany: async (args) => {
        wheres.push(args.where);
        const allowed = args.where.section?.in;
        return pins.filter((p) => !allowed || allowed.includes(p.section));
      },
    },
  };
  return { db, sourceFilters, wheres };
}

const embed = async () => [Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01)];
const chapter = {
  id: 'c1',
  documentId: 'd1',
  outlineNodeId: 'ch1',
  title: 'Chapter 2',
  scopeNote: null,
  content: null,
};

describe('pinsInScope', () => {
  it("a section's own pins replace the chapter's; without any, the chapter's apply", () => {
    const pins = [
      { sourceId: 'a', section: '' },
      { sourceId: 'b', section: '' },
      { sourceId: 'c', section: 'financial constraints' },
    ];
    expect(pinsInScope(pins, 'financial constraints')).toEqual(['c']);
    expect(pinsInScope(pins, 'trust')).toEqual(['a', 'b']);
    expect(pinsInScope(pins, '')).toEqual(['a', 'b']);
  });

  it('a row without the column counts as the chapter’s', () => {
    expect(pinsInScope([{ sourceId: 'a' }], 'x')).toEqual(['a']);
  });
});

describe('retrievePassages with a section', () => {
  it('asks only for the chapter’s and that section’s rows, by heading key, and filters by the section’s', async () => {
    const { db, sourceFilters, wheres } = fakeDb([
      { sourceId: 'a', section: '' },
      { sourceId: 'c', section: 'financial constraints' },
    ]);
    await retrievePassages(db, embed, chapter, 'Upfront cost', 'ASSIST', {
      section: '2.1 Financial Constraints',
    });
    expect(wheres[0]).toEqual({
      chapterId: 'c1',
      section: { in: ['', 'financial constraints'] },
    });
    expect(sourceFilters).toEqual([['c']]);
  });

  it('under a heading with no pins of its own, the chapter’s pins apply', async () => {
    const { db, sourceFilters } = fakeDb([{ sourceId: 'a', section: '' }]);
    await retrievePassages(db, embed, chapter, 'Trust', 'ASSIST', { section: 'Trust' });
    expect(sourceFilters).toEqual([['a']]);
  });

  it('with no section, only the chapter’s rows are asked for', async () => {
    const { db, wheres } = fakeDb([]);
    await retrievePassages(db, embed, chapter, 'Anything', 'CHAT');
    expect(wheres[0]).toEqual({ chapterId: 'c1', section: { in: [''] } });
  });
});
