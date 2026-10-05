/**
 * Removes stored chunks that are not prose — ADR-0071.
 *
 *   pnpm --filter @tc/api prune-chunks            # dry run: counts only
 *   pnpm --filter @tc/api prune-chunks -- --apply # deletes
 *
 * The chunker now drops runs of headings, contents pages and reference lists before they are
 * embedded (`isProseChunk`). Papers indexed before that still hold them, and a vague query such as
 * a draft for "Chapter 1." retrieves exactly those, so this removes them with the same test. No
 * re-embedding is needed: the prose chunks keep their vectors.
 *
 * A source is never left with no chunks: if every chunk of a paper fails the test, they all stay,
 * as the chunker itself would have kept them.
 */

import { PrismaClient } from '@tc/db';
import { isProseChunk } from '@tc/retrieval';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

type Row = { id: string; sourceId: string; text: string; section: string | null };

async function main(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT "id"::text AS id, "sourceId"::text AS "sourceId", "text", "section"
       FROM "SourceChunk" ORDER BY "sourceId", "ordinal"`,
  );
  const bySource = new Map<string, Row[]>();
  for (const row of rows) {
    const list = bySource.get(row.sourceId) ?? [];
    list.push(row);
    bySource.set(row.sourceId, list);
  }

  const doomed: string[] = [];
  let sourcesTouched = 0;
  for (const chunks of bySource.values()) {
    const bad = chunks.filter((chunk) => !isProseChunk(chunk));
    if (bad.length === 0 || bad.length === chunks.length) continue;
    sourcesTouched += 1;
    doomed.push(...bad.map((chunk) => chunk.id));
  }

  console.log(
    `${rows.length} chunks in ${bySource.size} sources; ${doomed.length} are not prose, in ` +
      `${sourcesTouched} sources.`,
  );
  if (!apply) {
    console.log('Dry run. Re-run with --apply to delete them.');
    return;
  }
  for (let i = 0; i < doomed.length; i += 500) {
    const ids = doomed.slice(i, i + 500);
    await prisma.$executeRawUnsafe(`DELETE FROM "SourceChunk" WHERE "id" = ANY($1::uuid[])`, ids);
  }
  console.log(`Deleted ${doomed.length} chunks.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
