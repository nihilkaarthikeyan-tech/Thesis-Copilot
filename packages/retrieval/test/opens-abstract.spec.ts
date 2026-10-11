/**
 * ADR-0147 round 6: a passage that starts at the first sentence of its paper's abstract is marked,
 * so A.1 can withhold that sentence at an opening. The mark is read from the database (the first
 * chunk of the "Abstract" section) and carried to the passage unchanged; nothing else changes.
 */

import { describe, expect, it } from 'vitest';
import { type ContextClient, retrievePassages } from '../src/context.js';
import { EMBEDDING_DIMENSIONS, findCandidates } from '../src/pgvector.js';

const vector = () => new Array(EMBEDDING_DIMENSIONS).fill(0.01);

const row = (over: Record<string, unknown> = {}) => ({
  chunkId: 'chunk-1',
  sourceId: 'src-1',
  distance: 0.2,
  subTheme: null,
  groundingLevel: 'ABSTRACT',
  text: 'Rooftop solar adoption remains low. Cost was the main barrier.',
  page: null,
  title: 'Solar adoption in Karnataka',
  year: 2024,
  authors: [{ family: 'Bagla', given: 'S' }],
  ...over,
});

function fakeDb(rows: unknown[]) {
  const queried: string[] = [];
  const db: ContextClient = {
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async <T>(sql: string) => {
      queried.push(sql);
      return rows as T;
    },
    documentMemory: { findUnique: async () => ({ outline: [] }) },
    chapterSourcePin: { findMany: async () => [] },
  };
  return { db, queried };
}

describe('opensAbstract (ADR-0147 round 6)', () => {
  it('asks the database for the first chunk of the Abstract section, in both query forms', async () => {
    for (const perSource of [undefined, 2]) {
      const { db, queried } = fakeDb([]);
      await findCandidates(db, vector(), {
        documentId: 'doc-1',
        ...(perSource ? { perSource } : {}),
      });
      const sql = queried[0] ?? '';
      expect(sql).toContain(`lower(btrim(c."section")) = 'abstract'`);
      expect(sql).toContain('e."ordinal" < c."ordinal"');
      expect(sql).toContain('AS "opensAbstract"');
    }
  });

  it('marks a candidate only when the row says so', async () => {
    const { db } = fakeDb([
      row({ chunkId: 'a', opensAbstract: true }),
      row({ chunkId: 'b', opensAbstract: false }),
      row({ chunkId: 'c' }),
      row({ chunkId: 'd', opensAbstract: null }),
    ]);
    const candidates = await findCandidates(db, vector(), { documentId: 'doc-1' });
    expect(candidates.map((c) => [c.chunkId, c.opensAbstract ?? false])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
      ['d', false],
    ]);
  });

  it('carries the mark to the passage, with its id, text and reference unchanged', async () => {
    const { db } = fakeDb([
      row({ chunkId: 'a', sourceId: 'src-1', opensAbstract: true }),
      row({ chunkId: 'b', sourceId: 'src-2', distance: 0.3, text: 'Later chunk text here.' }),
    ]);
    const chapter = {
      id: 'c1',
      documentId: 'd1',
      outlineNodeId: 'ch1',
      title: 'Chapter 1',
      scopeNote: 'Rooftop solar in Karnataka',
      content: null,
    };
    const embed = async () => [vector()];
    const { passages } = await retrievePassages(db, embed, chapter, 'Chapter 1\n', 'ASSIST');
    const first = passages.find((p) => p.chunkId === 'a');
    const second = passages.find((p) => p.chunkId === 'b');
    expect(first?.opensAbstract).toBe(true);
    expect(first?.text).toBe('Rooftop solar adoption remains low. Cost was the main barrier.');
    expect(first?.id).toMatch(/^S\d+#c1$/);
    expect(second?.opensAbstract).toBeUndefined();
  });
});
