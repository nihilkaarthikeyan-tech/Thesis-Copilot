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
import { cleanAuthors } from './scholarly/names.js';
import type { CslAuthor } from './scholarly/resolve.js';

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
  citationCount: number | null;
  isPreprint: boolean | null;
  venueCitedness: number | null;
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
           s."authors"        AS "authors",
           s."citationCount"  AS "citationCount",
           s."isPreprint"     AS "isPreprint",
           s."venueCitedness" AS "venueCitedness"
      FROM "SourceChunk" c
      JOIN "Source" s ON s."id" = c."sourceId"
     WHERE s."documentId" = $2::uuid
       -- ADR-0076: a retracted paper is never offered as evidence.
       AND s."isRetracted" = false
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
    citationCount: row.citationCount,
    isPreprint: row.isPreprint ?? false,
    venueCitedness: row.venueCitedness,
    year: row.year,
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
  // ADR-0078: stored before `cleanAuthors` existed, so repaired here too ("- 2026", "College 2025").
  const first = Array.isArray(authors)
    ? (cleanAuthors(authors as CslAuthor[])[0] as { family?: string; literal?: string } | undefined)
    : undefined;
  const name = first?.family?.trim() || first?.literal?.trim().split(/\s+/).pop() || null;

  if (name && year) return `${name} ${year}`;
  if (name) return name;
  if (title && year) return `${title.slice(0, 40)} ${year}`;
  if (title) return title.slice(0, 40);
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Chapter chunks — the coherence engine's index (PRD Appendix D.1.1)
// ---------------------------------------------------------------------------------------------

/** One chapter chunk ready to store, with its ProseMirror positions. */
export type ChapterChunkRow = {
  chapterId: string;
  ordinal: number;
  from: number;
  to: number;
  text: string;
  embedding: readonly number[];
};

/**
 * Replaces one chapter's chunks. D.1.1 re-chunks only changed chapters, so this is per chapter and
 * never per document: a run must not disturb the index of a chapter nobody touched.
 */
export async function replaceChapterChunks(
  db: RawClient,
  chapterId: string,
  chunks: readonly ChapterChunkRow[],
  dimensions = EMBEDDING_DIMENSIONS,
): Promise<number> {
  await db.$executeRawUnsafe('DELETE FROM "ChapterChunk" WHERE "chapterId" = $1::uuid', chapterId);
  let written = 0;
  for (const chunk of chunks) {
    const literal = toVectorLiteral(chunk.embedding, dimensions);
    await db.$executeRawUnsafe(
      `INSERT INTO "ChapterChunk" ("id", "chapterId", "ordinal", "from", "to", "text", "embedding")
       VALUES (uuid_generate_v7(), $1::uuid, $2, $3, $4, $5, $6::vector)`,
      chunk.chapterId,
      chunk.ordinal,
      chunk.from,
      chunk.to,
      chunk.text,
      literal,
    );
    written += 1;
  }
  return written;
}

export type NeighbourChunk = {
  chunkId: string;
  chapterId: string;
  ordinal: number;
  from: number;
  to: number;
  text: string;
  distance: number;
};

/**
 * D.1.2 CLAIM_CONTRADICTION: the passages most like a claim, **from other chapters**.
 *
 * Excluding the claim's own chapter is the point — a claim always matches the paragraph it came
 * from, and a check that reports a chapter contradicting itself in the same sentence is noise.
 */
export async function findChapterNeighbours(
  db: RawClient,
  documentId: string,
  excludeChapterId: string,
  embedding: readonly number[],
  limit = 5,
  dimensions = EMBEDDING_DIMENSIONS,
): Promise<NeighbourChunk[]> {
  const literal = toVectorLiteral(embedding, dimensions);
  const sql = `
    SELECT cc."id"        AS "chunkId",
           cc."chapterId" AS "chapterId",
           cc."ordinal"   AS "ordinal",
           cc."from"      AS "from",
           cc."to"        AS "to",
           cc."text"      AS "text",
           cc."embedding" <=> $1::vector AS "distance"
      FROM "ChapterChunk" cc
      JOIN "Chapter" ch ON ch."id" = cc."chapterId"
     WHERE ch."documentId" = $2::uuid
       AND cc."chapterId" <> $3::uuid
       AND cc."embedding" IS NOT NULL
     ORDER BY cc."embedding" <=> $1::vector
     LIMIT ${Math.max(1, Math.floor(limit))}`;
  return db.$queryRawUnsafe<NeighbourChunk[]>(sql, literal, documentId, excludeChapterId);
}
