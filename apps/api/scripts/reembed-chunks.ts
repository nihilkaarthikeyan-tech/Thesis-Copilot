/**
 * Re-embeds every stored chunk with the configured embedding model — ADR-0032.
 *
 *   pnpm ai:reembed
 *
 * A vector from one model cannot be compared with a vector from another, so a change of
 * `AI_EMBED_MODEL` leaves every `SourceChunk` and `ChapterChunk` row silently wrong for search
 * until this has run. It updates each row's `embedding` in place, in batches of 64, and touches
 * nothing else. Safe to re-run; while it runs, search over the rows not yet reached is degraded,
 * which is why the switch happens while the library is small.
 *
 * Refuses to run against the mock provider: a mock vector written into production would be a
 * far quieter fault than the one this fixes.
 */

import { createProviders } from '@tc/ai';
import { loadEnv } from '@tc/config';
import { PrismaClient } from '@tc/db';
import { toVectorLiteral } from '@tc/retrieval';

const BATCH = 64;

const env = loadEnv();
if (env.EMBED_PROVIDER === 'mock') {
  throw new Error('EMBED_PROVIDER is mock: nothing to re-embed with. Set it to voyage.');
}
const { embeddings } = createProviders(env);
const prisma = new PrismaClient();

type Row = { id: string; text: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MIN_BATCH = 8;

/**
 * An account with no payment method is held to 3 requests a minute and 10,000 tokens a minute
 * (Voyage answers 429 with a message saying so). A batch of 64 chunks is over the token limit on
 * its own, so a refusal first halves the batch, then waits the minute out. Production has the
 * same limits until the owner adds the card.
 */
async function reembed(table: 'SourceChunk' | 'ChapterChunk'): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT "id"::text AS id, "text" FROM "${table}" ORDER BY "id"`,
  );
  console.log(`${table}: ${rows.length} rows`);
  let done = 0;
  let size = BATCH;
  let refusals = 0;
  for (let i = 0; i < rows.length; ) {
    const batch = rows.slice(i, i + size);
    let vectors: number[][];
    try {
      vectors = await embeddings.embed(batch.map((row) => row.text));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/\b429\b/.test(message) || ++refusals > 12) throw error;
      if (size > MIN_BATCH) {
        size = Math.max(MIN_BATCH, Math.floor(size / 2));
        console.log(`  rate limited; batch now ${size}`);
      } else {
        console.log('  rate limited; waiting 21s');
        await sleep(21_000);
      }
      continue;
    }
    refusals = 0;
    i += batch.length;
    if (vectors.length !== batch.length) {
      throw new Error(`${table}: got ${vectors.length} vectors for ${batch.length} rows`);
    }
    for (const [index, row] of batch.entries()) {
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "embedding" = $1::vector WHERE "id" = $2::uuid`,
        toVectorLiteral(vectors[index] as number[], env.EMBED_DIMS),
        row.id,
      );
    }
    done += batch.length;
    if (done % (BATCH * 10) === 0 || done === rows.length) {
      console.log(`  ${done}/${rows.length}`);
    }
  }
  return rows.length;
}

async function main(): Promise<void> {
  console.log(`Re-embedding with ${embeddings.modelId} (${env.EMBED_DIMS}-d)`);
  const sources = await reembed('SourceChunk');
  const chapters = await reembed('ChapterChunk');
  console.log(`Done: ${sources} source chunks and ${chapters} chapter chunks re-embedded.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
