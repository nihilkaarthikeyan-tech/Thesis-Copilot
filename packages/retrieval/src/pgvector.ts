/**
 * pgvector reads and writes — PRD §10.4 and §7.2 ("vector queries via `$queryRaw`").
 *
 * Prisma types `SourceChunk.embedding` as `Unsupported("vector(1024)")`, which means it cannot be
 * selected or written through the generated client at all. Every statement that touches an
 * embedding therefore lives here, in one file, rather than being scattered as raw SQL across the
 * worker and the API.
 *
 * The vector literal is built by hand because pgvector's input format is `[1,2,3]` and no driver
 * parameterises it for us. Every number is checked to be finite before it goes in, so the literal
 * can never carry anything but digits, a sign, a decimal point and an exponent — there is no path
 * from caller input into the SQL text.
 */

import type { Candidate } from './rank.js';
import { CANDIDATE_LIMIT } from './rank.js';

/** The only shape this module needs from Prisma, so `@tc/retrieval` stays free of a Prisma import. */
export type RawClient = {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T>;
};

/** PRD §7.2: 1024 dimensions, and the column is declared with it. A mismatch must not reach SQL. */
export const EMBEDDING_DIMENSIONS = 1024;

export class EmbeddingShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingShapeError';
  }
}

/**
 * Renders an embedding as a pgvector literal. Rejects anything that is not a finite number, so a
 * NaN from a provider becomes a loud failure here rather than a corrupt row or malformed SQL.
 */
export function toVectorLiteral(
  embedding: readonly number[],
  dimensions = EMBEDDING_DIMENSIONS,
): string {
  if (embedding.length !== dimensions) {
    throw new EmbeddingShapeError(`expected ${dimensions} dimensions, got ${embedding.length}`);
  }
  const parts = embedding.map((value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EmbeddingShapeError(`embedding contains a non-finite value: ${String(value)}`);
    }
    return String(value);
  });
  return `[${parts.join(',')}]`;
}

export type ChunkRow = {
  sourceId: string;
  ordinal: number;
  text: string;
  tokenCount: number;
  page: number | null;
  charStart: number | null;
  charEnd: number | null;
  section: string | null;
  embedding: readonly number[];
};

/**
 * Replaces a source's chunks with a new set, in one transaction-shaped pair of statements: the old
 * rows go first so re-indexing a source cannot leave two generations of chunks behind, which would
 * quietly double every retrieval result.
 */
export async function replaceSourceChunks(
  db: RawClient,
  sourceId: string,
  chunks: readonly ChunkRow[],
  dimensions = EMBEDDING_DIMENSIONS,
): Promise<number> {
  await db.$executeRawUnsafe('DELETE FROM "SourceChunk" WHERE "sourceId" = $1::uuid', sourceId);
  if (chunks.length === 0) return 0;

  let written = 0;
  // Inserted one at a time rather than in a single multi-row statement: a 1024-float vector is
  // around 12 KB of literal, and a batch of 64 would build a 750 KB query string.
  for (const chunk of chunks) {
    const literal = toVectorLiteral(chunk.embedding, dimensions);
    await db.$executeRawUnsafe(
      `INSERT INTO "SourceChunk"
         ("id", "sourceId", "ordinal", "page", "charStart", "charEnd", "section", "text",
          "tokenCount", "embedding")
       VALUES (uuid_generate_v7(), $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::vector)`,
      chunk.sourceId,
      chunk.ordinal,
      chunk.page,
      chunk.charStart,
      chunk.charEnd,
      chunk.section,
      chunk.text,
      chunk.tokenCount,
      literal,
    );
    written++;
  }
  return written;
}

export type CandidateQuery = {
  documentId: string;
  /** §10.4: "AND (pins empty OR source.id IN pins)". */
  pinnedSourceIds?: readonly string[];
  limit?: number;
};

type CandidateRow = {
  chunkId: string;
  sourceId: string;
  distance: number;
  subTheme: string | null;
  groundingLevel: string;
  text: string;
  page: number | null;
  title: string | null;
  year: number | null;
  authors: unknown;
};

/**
 * §10.4's candidate query: the 24 nearest chunks in this document, by cosine distance, honouring
 * the chapter's source pins. Returns `Candidate`s ready for `rerank`, with cosine similarity rather
 * than pgvector's distance, because everything downstream reasons in similarity.
 */
export async function findCandidates(
  db: RawClient,
  embedding: readonly number[],
  query: CandidateQuery,
  dimensions = EMBEDDING_DIMENSIONS,
): Promise<Candidate[]> {
  const literal = toVectorLiteral(embedding, dimensions);
  const pins = query.pinnedSourceIds ?? [];
  const limit = query.limit ?? CANDIDATE_LIMIT;

  // `<=>` is cosine distance under the HNSW index built in Phase 0; ordering by it is what makes
  // the index usable at all, so the ordering expression must stay exactly this.
  const sql = `
    SELECT c."id"             AS "chunkId",
           c."sourceId"       AS "sourceId",
           c."embedding" <=> $1::vector AS "distance",
           s."subTheme"       AS "subTheme",
           s."groundingLevel"::text AS "groundingLevel",
           c."text"           AS "text",
           c."page"           AS "page",
           s."title"          AS "title",
           s."year"           AS "year",
           s."authors"        AS "authors"
      FROM "SourceChunk" c
      JOIN "Source" s ON s."id" = c."sourceId"
     WHERE s."documentId" = $2::uuid
       AND ($3::uuid[] IS NULL OR s."id" = ANY($3::uuid[]))
     ORDER BY c."embedding" <=> $1::vector
     LIMIT $4`;

  const rows = await db.$queryRawUnsafe<CandidateRow[]>(
    sql,
    literal,
    query.documentId,
    pins.length > 0 ? pins : null,
    limit,
  );

  return rows.map((row) => ({
    chunkId: row.chunkId,
    sourceId: row.sourceId,
    // pgvector returns distance in [0, 2]; §10.4 reranks on similarity.
    cosine: 1 - Number(row.distance),
    subTheme: row.subTheme,
    groundingLevel: (row.groundingLevel as Candidate['groundingLevel']) ?? 'NONE',
    text: row.text,
    page: row.page,
    shortRef: shortReference(row.authors, row.year, row.title),
  }));
}

/**
 * "Kumar 2021" for a passage tag. Falls back through what is actually known rather than inventing
 * a citation: a source with no author and no year is shown by title, and one with neither is left
 * without a tag rather than labelled "Unknown".
 */
export function shortReference(
  authors: unknown,
  year: number | null,
  title: string | null,
): string | undefined {
  const first = Array.isArray(authors)
    ? (authors[0] as { family?: string; literal?: string } | undefined)
    : undefined;
  const name = first?.family?.trim() || first?.literal?.trim().split(/\s+/).pop() || null;

  if (name && year) return `${name} ${year}`;
  if (name) return name;
  if (title && year) return `${title.slice(0, 40)} ${year}`;
  if (title) return title.slice(0, 40);
  return undefined;
}
