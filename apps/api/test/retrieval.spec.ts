/**
 * Retrieval against a real pgvector database — PRD §10.4 and PHASES 1-W2 task 2.7.
 *
 *   "Done when: … an integration test embeds `p01` and retrieves a known passage by its own text
 *    with rank 1."
 *
 * The unit tests in `@tc/retrieval` assert the SQL text; this asserts that the SQL is actually
 * valid, that the HNSW index accepts it, and that the ordering means what it is supposed to mean.
 * Only a real Postgres with the extension loaded can settle those.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockEmbeddingProvider } from '@tc/ai';
import { PrismaClient } from '@tc/db';
import {
  EMBEDDING_DIMENSIONS,
  findCandidates,
  type RawClient,
  replaceSourceChunks,
  rerank,
  TOP_K,
  topK,
} from '@tc/retrieval';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations/', import.meta.url),
);

let pg: StartedPostgreSqlContainer;
let prisma: PrismaClient;

const embeddings = new MockEmbeddingProvider({ dims: EMBEDDING_DIMENSIONS });

/** Passages from three different papers, so a query can be right or wrong about which it wants. */
const PASSAGES = {
  solar:
    'Households in the surveyed districts cited the upfront cost of a rooftop unit as the leading barrier to adoption, well ahead of awareness or roof suitability.',
  wind: 'Coastal siting decisions for wind turbines were dominated by grid connection distance rather than by measured wind speed at hub height.',
  policy:
    'The subsidy scheme reached fewer than one in five eligible households, largely because the application required documents tenants do not hold.',
};

async function applyMigrations(container: StartedPostgreSqlContainer): Promise<void> {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    await container.copyFilesToContainer([
      { source: join(MIGRATIONS_DIR, dir, 'migration.sql'), target: `/tmp/m/${dir}.sql` },
    ]);
    const result = await container.exec([
      'psql',
      '-U',
      'tc',
      '-d',
      'tc_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      `/tmp/m/${dir}.sql`,
    ]);
    if (result.exitCode !== 0) throw new Error(`migration ${dir} failed:\n${result.output}`);
  }
}

let documentId: string;
let otherDocumentId: string;
const sourceIds: Record<keyof typeof PASSAGES, string> = {
  solar: '',
  wind: '',
  policy: '',
};

beforeAll(async () => {
  pg = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('tc_test')
    .withUsername('tc')
    .withPassword('tc')
    .start();
  await applyMigrations(pg);

  prisma = new PrismaClient({ datasources: { db: { url: pg.getConnectionUri() } } });

  const user = await prisma.user.create({
    data: { email: 'retrieval@example.com', name: 'Retrieval' },
  });
  const document = await prisma.document.create({
    data: { ownerId: user.id, title: 'Retrieval test', entryPath: 'B_PAPER' },
  });
  documentId = document.id;

  // A second document, so the isolation assertion means something.
  const other = await prisma.document.create({
    data: { ownerId: user.id, title: 'Another thesis', entryPath: 'A_TOPIC' },
  });
  otherDocumentId = other.id;

  const raw = prisma as unknown as RawClient;

  for (const [key, text] of Object.entries(PASSAGES) as Array<[keyof typeof PASSAGES, string]>) {
    const source = await prisma.source.create({
      data: {
        documentId,
        status: 'RESOLVED',
        title: `Paper about ${key}`,
        authors: [{ family: 'Kumar', given: 'A' }],
        year: 2021,
        groundingLevel: key === 'solar' ? 'FULL_TEXT' : 'ABSTRACT',
        subTheme: key === 'solar' ? 'adoption' : null,
      },
    });
    sourceIds[key] = source.id;

    const [embedding] = await embeddings.embed([text]);
    await replaceSourceChunks(raw, source.id, [
      {
        sourceId: source.id,
        ordinal: 0,
        text,
        tokenCount: 40,
        page: 3,
        charStart: 0,
        charEnd: text.length,
        section: 'Findings',
        embedding: embedding as number[],
      },
    ]);
  }

  // One chunk in the other document, identical to a passage in this one.
  const otherSource = await prisma.source.create({
    data: { documentId: otherDocumentId, status: 'RESOLVED', title: 'Someone else’s paper' },
  });
  const [solarEmbedding] = await embeddings.embed([PASSAGES.solar]);
  await replaceSourceChunks(raw, otherSource.id, [
    {
      sourceId: otherSource.id,
      ordinal: 0,
      text: PASSAGES.solar,
      tokenCount: 40,
      page: 1,
      charStart: 0,
      charEnd: PASSAGES.solar.length,
      section: 'Findings',
      embedding: solarEmbedding as number[],
    },
  ]);
}, 240_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await pg?.stop();
});

describe('pgvector retrieval (§10.4)', () => {
  it('retrieves a known passage by its own text at rank 1', async () => {
    const [query] = await embeddings.embed([PASSAGES.solar]);
    const candidates = await findCandidates(prisma as unknown as RawClient, query as number[], {
      documentId,
    });

    expect(candidates.length).toBe(3);
    expect(candidates[0]?.sourceId).toBe(sourceIds.solar);
    expect(candidates[0]?.text).toBe(PASSAGES.solar);
    expect(candidates[0]?.cosine).toBeGreaterThan(0.99);
  });

  it('ranks a different paper first when the query is about that paper', async () => {
    const [query] = await embeddings.embed([PASSAGES.wind]);
    const candidates = await findCandidates(prisma as unknown as RawClient, query as number[], {
      documentId,
    });
    expect(candidates[0]?.sourceId).toBe(sourceIds.wind);
  });

  it('never returns a chunk from another student’s document', async () => {
    const [query] = await embeddings.embed([PASSAGES.solar]);
    const candidates = await findCandidates(prisma as unknown as RawClient, query as number[], {
      documentId,
    });
    // The identical passage exists in the other document; it must not appear here.
    expect(candidates.every((c) => c.sourceId !== otherDocumentId)).toBe(true);
    expect(candidates).toHaveLength(3);
  });

  it('honours the chapter’s source pins', async () => {
    const [query] = await embeddings.embed([PASSAGES.solar]);
    const candidates = await findCandidates(prisma as unknown as RawClient, query as number[], {
      documentId,
      pinnedSourceIds: [sourceIds.wind],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sourceId).toBe(sourceIds.wind);
  });

  it('carries the metadata the rerank and the passage tag need', async () => {
    const [query] = await embeddings.embed([PASSAGES.solar]);
    const [top] = await findCandidates(prisma as unknown as RawClient, query as number[], {
      documentId,
    });
    expect(top?.groundingLevel).toBe('FULL_TEXT');
    expect(top?.subTheme).toBe('adoption');
    expect(top?.page).toBe(3);
    expect(top?.shortRef).toBe('Kumar 2021');
  });

  it('feeds the §10.4 rerank and top_k without further work', async () => {
    const [query] = await embeddings.embed([PASSAGES.policy]);
    const candidates = await findCandidates(prisma as unknown as RawClient, query as number[], {
      documentId,
    });

    const ranked = topK(rerank(candidates, 'adoption'), 'ASSIST');
    expect(ranked.length).toBeLessThanOrEqual(TOP_K.ASSIST);
    // The policy passage is the query's own text, so it wins despite the boosts on the solar one.
    expect(ranked[0]?.sourceId).toBe(sourceIds.policy);
  });

  it('replaces chunks rather than accumulating them on a re-index', async () => {
    const raw = prisma as unknown as RawClient;
    const [embedding] = await embeddings.embed(['A revised passage after re-indexing.']);
    await replaceSourceChunks(raw, sourceIds.policy, [
      {
        sourceId: sourceIds.policy,
        ordinal: 0,
        text: 'A revised passage after re-indexing.',
        tokenCount: 8,
        page: 1,
        charStart: 0,
        charEnd: 36,
        section: 'Findings',
        embedding: embedding as number[],
      },
    ]);

    const count = await prisma.sourceChunk.count({ where: { sourceId: sourceIds.policy } });
    expect(count).toBe(1);

    // The old passage is gone, so it can no longer be retrieved or quoted.
    const [oldQuery] = await embeddings.embed([PASSAGES.policy]);
    const candidates = await findCandidates(raw, oldQuery as number[], { documentId });
    expect(candidates.some((c) => c.text === PASSAGES.policy)).toBe(false);
  });
});
