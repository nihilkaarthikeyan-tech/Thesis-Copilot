/**
 * Where a new library's first minute goes (ADR-0136). Reads the theses `.env` points at and the
 * BullMQ job records still in Redis (completed jobs are kept a day); writes nothing, calls nothing
 * outside the machine.
 * Run: `pnpm --filter @tc/worker exec dotenv -e ../../.env -- tsx scripts/measure-first-passages.ts [emailLike] [count]`
 *
 * For each of the newest `count` theses whose owner's email matches `emailLike` (default
 * `%measure-quick%`), one line per paper, in seconds from the thesis's creation:
 *   added     the Source row was written (find-sources)
 *   resolve   the resolve-reference job was queued / started / finished
 *   abstract  the abstract job was queued / started / finished (ADR-0136; absent before it)
 *   index     the index-source job was queued / started / finished
 *   passage   the first SourceChunk was written (its UUID v7 carries the millisecond)
 */

import { PrismaClient } from '@tc/db';
import { jobId, jobKeyDigest } from '@tc/types';
import { Redis } from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6381');

/** The millisecond a UUID v7 was minted at. */
function uuidV7Ms(id: string): number {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

type Times = { queued: number; started: number | null; finished: number | null } | null;

async function jobTimes(queue: string, id: string): Promise<Times> {
  const h = await redis.hgetall(`bull:${queue}:${id}`);
  if (!h.timestamp) return null;
  return {
    queued: Number(h.timestamp),
    started: h.processedOn ? Number(h.processedOn) : null,
    finished: h.finishedOn ? Number(h.finishedOn) : null,
  };
}

const s = (ms: number | null | undefined, t0: number) =>
  ms === null || ms === undefined ? '   -  ' : ((ms - t0) / 1000).toFixed(1).padStart(6);
const span = (t: Times, t0: number) =>
  t ? `${s(t.queued, t0)}${s(t.started, t0)}${s(t.finished, t0)}` : '      (gone)        ';

async function main(): Promise<void> {
  const like = process.argv[2] ?? '%measure-quick%';
  const count = Number(process.argv[3] ?? 8);
  const docs = await prisma.$queryRawUnsafe<Array<{ id: string; createdAt: Date; email: string }>>(
    `SELECT d."id", d."createdAt", u."email" FROM "Document" d JOIN "User" u ON u."id" = d."ownerId"
      WHERE u."email" LIKE $1 ORDER BY d."createdAt" DESC LIMIT $2`,
    like,
    count,
  );
  for (const doc of docs.reverse()) {
    const t0 = doc.createdAt.getTime();
    const found = await prisma.auditEvent.findMany({
      where: { documentId: doc.id, kind: 'SOURCES_FOUND' },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const sources = await prisma.source.findMany({
      where: { documentId: doc.id },
      select: {
        id: true,
        rawReference: true,
        doi: true,
        createdAt: true,
        groundingLevel: true,
        chunks: { select: { id: true }, orderBy: { id: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`\n${doc.id}  ${doc.createdAt.toISOString()}  ${sources.length} papers`);
    console.log(
      `  find-sources done at: ${found.map((f) => s(f.createdAt.getTime(), t0)).join(', ')}`,
    );
    console.log(
      '  added | resolve q/start/end | abstract q/start/end | index q/start/end | passage | level',
    );
    const passages: number[] = [];
    for (const src of sources) {
      const resolve = src.rawReference
        ? await jobTimes(
            'resolve-reference',
            jobId('resolve-reference', doc.id, jobKeyDigest(src.rawReference)),
          )
        : null;
      const key = jobKeyDigest(src.doi ?? 'none');
      const abstract = await jobTimes('index-abstract', jobId('index-abstract', src.id, key));
      const index = await jobTimes('index-source', jobId('index-source', src.id, key));
      const chunk = src.chunks[0] ? uuidV7Ms(src.chunks[0].id) : null;
      if (chunk) passages.push(chunk - t0);
      console.log(
        `  ${s(src.createdAt.getTime(), t0)} |${span(resolve, t0)} |${span(abstract, t0)} |${span(index, t0)} |${s(chunk, t0)} | ${src.groundingLevel}`,
      );
    }
    passages.sort((a, b) => a - b);
    const at = (n: number) =>
      passages[n - 1] !== undefined ? `${((passages[n - 1] ?? 0) / 1000).toFixed(1)} s` : 'never';
    console.log(`  first passage ${at(1)}, third ${at(3)}, fifth ${at(5)}, tenth ${at(10)}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
