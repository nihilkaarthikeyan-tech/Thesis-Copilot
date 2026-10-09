/**
 * ADR-0139: a paper is added to a thesis once, however many adders run at the same moment, and the
 * copies the old race left stuck at "Looking it up…" are cleared without touching the student's work.
 *
 * Real Postgres in Testcontainers with every migration applied: the guarantee is the advisory lock
 * inside the transaction, and a mocked database would prove nothing.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addSourcesOnce, PrismaClient, removeStrandedDuplicateSources } from '@tc/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations/', import.meta.url),
);
const MIGRATIONS = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let documentId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('tc_test')
    .withUsername('tc')
    .withPassword('tc')
    .withCopyFilesToContainer(
      MIGRATIONS.map((name) => ({
        source: join(MIGRATIONS_DIR, name, 'migration.sql'),
        target: `/tmp/migrations/${name}.sql`,
      })),
    )
    .start();
  for (const name of MIGRATIONS) {
    const applied = await container.exec([
      'psql',
      '-U',
      'tc',
      '-d',
      'tc_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      `/tmp/migrations/${name}.sql`,
    ]);
    if (applied.exitCode !== 0) throw new Error(`migration ${name} failed:\n${applied.output}`);
  }
  // Two adders at once need two connections, or the pool would serialise them for us.
  prisma = new PrismaClient({
    datasources: { db: { url: `${container.getConnectionUri()}?connection_limit=10` } },
  });
  await prisma.$connect();
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.source.deleteMany();
  await prisma.document.deleteMany();
  await prisma.user.deleteMany();
  const user = await prisma.user.create({ data: { email: 'dedupe@example.com' } });
  const document = await prisma.document.create({
    data: { ownerId: user.id, title: 'EDM of Hastelloy', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
});

const PAPERS = [1, 2, 3, 4, 5].map((n) => ({
  doi: `10.1000/w${n}`,
  title: `Electrode wear in Hastelloy EDM, study ${n}`,
  rawReference: `(2021). Electrode wear in Hastelloy EDM, study ${n}. https://doi.org/10.1000/w${n}`,
}));

/** What a find-sources run does with its chosen papers: insert them as PENDING, once. */
function addAsFindSources(papers: typeof PAPERS) {
  return addSourcesOnce(prisma, documentId, papers, async (tx, paper) => {
    // A pause between the check and the insert, so an unlocked version would interleave.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return tx.source.create({
      data: { documentId, status: 'PENDING', autoAddedAt: new Date(), ...paper },
      select: { id: true },
    });
  });
}

describe('addSourcesOnce', () => {
  it('two runs at once give one row per paper, and only one of them creates each', async () => {
    const [first, second] = await Promise.all([addAsFindSources(PAPERS), addAsFindSources(PAPERS)]);

    const rows = await prisma.source.findMany({ where: { documentId } });
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.doi)).size).toBe(5);
    // Each paper was created by exactly one run, so exactly one resolve job is queued for it.
    const created = [...first, ...second].filter((r) => r.created);
    expect(created).toHaveLength(5);
    // Both runs hand back the same row for each paper.
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });

  it('five runs at once still give five rows', async () => {
    await Promise.all(Array.from({ length: 5 }, () => addAsFindSources(PAPERS)));
    expect(await prisma.source.count({ where: { documentId } })).toBe(5);
  });

  it('matches by DOI in any case, by normalised title, and within one call', async () => {
    await addAsFindSources([PAPERS[0] as (typeof PAPERS)[number]]);
    const result = await addSourcesOnce(
      prisma,
      documentId,
      [
        { doi: '10.1000/W1', title: 'Another title', rawReference: 'x' },
        { doi: null, title: 'ELECTRODE wear in Hastelloy EDM — study 2', rawReference: 'y' },
        { doi: null, title: 'Electrode wear in Hastelloy EDM: study 2!', rawReference: 'z' },
      ],
      (tx, paper) =>
        tx.source.create({
          data: { documentId, status: 'PENDING', ...paper },
          select: { id: true },
        }),
    );
    expect(result.map((r) => r.created)).toEqual([false, true, false]);
    expect(await prisma.source.count({ where: { documentId } })).toBe(2);
  });

  it('keeps another thesis out of the check', async () => {
    const other = await prisma.document.create({
      data: {
        ownerId: (await prisma.user.findFirstOrThrow()).id,
        title: 'Another thesis',
        entryPath: 'A_TOPIC',
      },
    });
    await addAsFindSources(PAPERS);
    const result = await addSourcesOnce(prisma, other.id, PAPERS, (tx, paper) =>
      tx.source.create({
        data: { documentId: other.id, status: 'PENDING', ...paper },
        select: { id: true },
      }),
    );
    expect(result.every((r) => r.created)).toBe(true);
  });
});

describe('removeStrandedDuplicateSources', () => {
  const old = new Date(Date.now() - 30 * 60_000);

  async function pair(n: number, copy: { createdAt?: Date; doi?: string | null } = {}) {
    const paper = PAPERS[n - 1] as (typeof PAPERS)[number];
    const resolved = await prisma.source.create({
      data: { documentId, status: 'RESOLVED', ...paper, createdAt: old },
    });
    const stuck = await prisma.source.create({
      data: {
        documentId,
        status: 'PENDING',
        ...paper,
        ...(copy.doi !== undefined ? { doi: copy.doi } : {}),
        createdAt: copy.createdAt ?? old,
      },
    });
    return { resolved, stuck };
  }

  it('removes a PENDING copy of a RESOLVED source, by DOI or by title, older than ten minutes', async () => {
    const byDoi = await pair(1);
    const byTitle = await pair(2, { doi: null });
    expect(await removeStrandedDuplicateSources(prisma, { documentId })).toBe(2);
    const left = await prisma.source.findMany({ where: { documentId }, select: { id: true } });
    expect(left.map((r) => r.id).sort()).toEqual([byDoi.resolved.id, byTitle.resolved.id].sort());
    // Idempotent.
    expect(await removeStrandedDuplicateSources(prisma, { documentId })).toBe(0);
  });

  it('leaves a copy whose resolution may still be running, and a PENDING paper with no twin', async () => {
    await pair(1, { createdAt: new Date() });
    await prisma.source.create({
      data: {
        documentId,
        status: 'PENDING',
        ...(PAPERS[2] as (typeof PAPERS)[number]),
        createdAt: old,
      },
    });
    expect(await removeStrandedDuplicateSources(prisma, { documentId })).toBe(0);
    expect(await prisma.source.count({ where: { documentId } })).toBe(3);
  });

  it('never removes a copy that is cited, pinned, filed, or named in a chapter', async () => {
    const chapter = await prisma.chapter.create({
      data: {
        documentId,
        outlineNodeId: 'n1',
        title: 'Literature Review',
        order: 0,
        content: { type: 'doc', content: [] },
      },
    });
    const cited = await pair(1);
    await prisma.citation.create({
      data: { chapterId: chapter.id, sourceId: cited.stuck.id, nodeKey: 'k1' },
    });
    const pinned = await pair(2);
    await prisma.chapterSourcePin.create({
      data: { chapterId: chapter.id, sourceId: pinned.stuck.id },
    });
    const filed = await pair(3);
    const collection = await prisma.sourceCollection.create({
      data: { documentId, name: 'Wear' },
    });
    await prisma.sourceCollectionItem.create({
      data: { collectionId: collection.id, sourceId: filed.stuck.id },
    });
    const named = await pair(4);
    await prisma.chapter.create({
      data: {
        documentId,
        outlineNodeId: 'n2',
        title: 'Method',
        order: 1,
        content: {
          type: 'doc',
          content: [{ type: 'citation', attrs: { sourceId: named.stuck.id } }],
        },
      },
    });
    const plain = await pair(5);

    expect(await removeStrandedDuplicateSources(prisma, { documentId })).toBe(1);
    expect(await prisma.source.findUnique({ where: { id: plain.stuck.id } })).toBeNull();
    for (const kept of [cited, pinned, filed, named]) {
      expect(await prisma.source.findUnique({ where: { id: kept.stuck.id } })).not.toBeNull();
    }
  });

  it('touches only the thesis it is given', async () => {
    await pair(1);
    const otherUser = await prisma.user.create({ data: { email: 'other@example.com' } });
    const other = await prisma.document.create({
      data: { ownerId: otherUser.id, title: 'Other', entryPath: 'A_TOPIC' },
    });
    expect(await removeStrandedDuplicateSources(prisma, { documentId: other.id })).toBe(0);
    expect(await removeStrandedDuplicateSources(prisma)).toBe(1);
  });
});
