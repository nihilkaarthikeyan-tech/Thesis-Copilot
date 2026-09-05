/**
 * pgvector reads and writes — PRD §10.4, §7.2.
 *
 * The client is faked down to the two raw methods, so the SQL and its parameters are asserted
 * exactly. That is the point: this is the one place in the codebase that builds SQL text, and the
 * vector literal is interpolated rather than parameterised because no driver can bind a pgvector
 * value. The dimension and finiteness checks are what keep that safe.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingShapeError,
  findCandidates,
  replaceSourceChunks,
  shortReference,
  toVectorLiteral,
} from '../src/pgvector.js';

const vector = (fill = 0.5, dims = EMBEDDING_DIMENSIONS) => new Array(dims).fill(fill);

function fakeDb(rows: unknown[] = []) {
  const executed: Array<{ sql: string; values: unknown[] }> = [];
  const queried: Array<{ sql: string; values: unknown[] }> = [];
  return {
    executed,
    queried,
    db: {
      $executeRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
        executed.push({ sql, values });
        return 1;
      }),
      $queryRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
        queried.push({ sql, values });
        return rows as never;
      }),
    },
  };
}

describe('toVectorLiteral', () => {
  it('renders pgvector input format', () => {
    expect(toVectorLiteral([1, -2, 0.5], 3)).toBe('[1,-2,0.5]');
  });

  it('refuses an embedding of the wrong width', () => {
    // The column is declared vector(1024); a 512-d model would fail at the database with a much
    // worse message, after the write had already been attempted.
    expect(() => toVectorLiteral(vector(0.1, 512))).toThrow(EmbeddingShapeError);
  });

  it('refuses a non-finite value rather than writing a corrupt row', () => {
    expect(() => toVectorLiteral([1, Number.NaN, 3], 3)).toThrow(EmbeddingShapeError);
    expect(() => toVectorLiteral([1, Number.POSITIVE_INFINITY, 3], 3)).toThrow(EmbeddingShapeError);
  });

  it('cannot carry anything but a number into the SQL text', () => {
    const hostile = [1, '); DROP TABLE "SourceChunk"; --' as unknown as number, 3];
    expect(() => toVectorLiteral(hostile, 3)).toThrow(EmbeddingShapeError);
  });
});

describe('replaceSourceChunks', () => {
  const chunk = (ordinal: number) => ({
    sourceId: 'src-1',
    ordinal,
    text: `chunk ${ordinal}`,
    tokenCount: 100,
    page: 1,
    charStart: ordinal * 100,
    charEnd: (ordinal + 1) * 100,
    section: 'Introduction',
    embedding: vector(),
  });

  it('clears the previous generation before inserting', async () => {
    const { db, executed } = fakeDb();
    await replaceSourceChunks(db, 'src-1', [chunk(0), chunk(1)]);

    // Re-indexing must not leave two generations behind, which would double every retrieval hit.
    expect(executed[0]?.sql).toContain('DELETE FROM "SourceChunk"');
    expect(executed[0]?.values).toEqual(['src-1']);
    expect(executed).toHaveLength(3);
  });

  it('passes every column as a bound parameter', async () => {
    const { db, executed } = fakeDb();
    await replaceSourceChunks(db, 'src-1', [chunk(0)]);

    const insert = executed[1];
    expect(insert?.sql).toContain('INSERT INTO "SourceChunk"');
    // The text is a parameter, never interpolated: it is a passage from someone else's paper.
    expect(insert?.values).toContain('chunk 0');
    expect(insert?.values.at(-1)).toBe(toVectorLiteral(vector()));
  });

  it('still clears the old chunks when there are no new ones', async () => {
    const { db, executed } = fakeDb();
    const written = await replaceSourceChunks(db, 'src-1', []);
    expect(written).toBe(0);
    expect(executed).toHaveLength(1);
    expect(executed[0]?.sql).toContain('DELETE');
  });

  it('refuses the whole write when one embedding is the wrong width', async () => {
    const { db } = fakeDb();
    await expect(
      replaceSourceChunks(db, 'src-1', [{ ...chunk(0), embedding: vector(0.5, 10) }]),
    ).rejects.toThrow(EmbeddingShapeError);
  });
});

describe('findCandidates (§10.4)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    chunkId: 'chunk-1',
    sourceId: 'src-1',
    distance: 0.2,
    subTheme: 'adoption',
    groundingLevel: 'FULL_TEXT',
    text: 'Households cited cost as the leading barrier.',
    page: 4,
    title: 'Solar adoption in rural Karnataka',
    year: 2021,
    authors: [{ family: 'Kumar', given: 'A' }],
    ...over,
  });

  it('orders by cosine distance and limits to the candidate window', async () => {
    const { db, queried } = fakeDb([row()]);
    await findCandidates(db, vector(), { documentId: 'doc-1' });

    const sql = queried[0]?.sql ?? '';
    expect(sql).toContain('ORDER BY c."embedding" <=> $1::vector');
    // 24 is §10.4's candidate limit, before the rerank narrows to top_k.
    expect(queried[0]?.values.at(-1)).toBe(24);
  });

  it('converts pgvector distance to the similarity the rerank expects', async () => {
    const { db } = fakeDb([row({ distance: 0.25 })]);
    const [candidate] = await findCandidates(db, vector(), { documentId: 'doc-1' });
    expect(candidate?.cosine).toBeCloseTo(0.75, 10);
  });

  it('restricts to the pinned sources when a chapter has pins', async () => {
    const { db, queried } = fakeDb([row()]);
    await findCandidates(db, vector(), {
      documentId: 'doc-1',
      pinnedSourceIds: ['src-1', 'src-2'],
    });
    expect(queried[0]?.values[2]).toEqual(['src-1', 'src-2']);
  });

  it('searches the whole document when there are no pins', async () => {
    const { db, queried } = fakeDb([row()]);
    await findCandidates(db, vector(), { documentId: 'doc-1', pinnedSourceIds: [] });
    // §10.4: "pins empty OR source.id IN pins" — null means the filter does not apply.
    expect(queried[0]?.values[2]).toBeNull();
  });

  it('never reaches chunks belonging to another document', async () => {
    const { db, queried } = fakeDb([row()]);
    await findCandidates(db, vector(), { documentId: 'doc-1' });
    expect(queried[0]?.sql).toContain('s."documentId" = $2::uuid');
    expect(queried[0]?.values[1]).toBe('doc-1');
  });

  it('carries the grounding level through for the FULL_TEXT boost', async () => {
    const { db } = fakeDb([row({ groundingLevel: 'ABSTRACT' })]);
    const [candidate] = await findCandidates(db, vector(), { documentId: 'doc-1' });
    expect(candidate?.groundingLevel).toBe('ABSTRACT');
  });
});

describe('shortReference', () => {
  it('is surname and year when both are known', () => {
    expect(shortReference([{ family: 'Kumar' }], 2021, 'Solar adoption')).toBe('Kumar 2021');
  });

  it('takes the surname from a literal name', () => {
    expect(shortReference([{ literal: 'Ashok Kumar' }], 2021, null)).toBe('Kumar 2021');
  });

  it('falls back to the title when there is no author', () => {
    expect(shortReference([], 2021, 'Solar adoption')).toBe('Solar adoption 2021');
  });

  it('gives no tag rather than inventing one', () => {
    // "Unknown 2021" in a thesis would read as a citation. Nothing is better than a wrong one.
    expect(shortReference(null, null, null)).toBeUndefined();
  });
});
