/**
 * Adding papers to a thesis's library without adding one twice (ADR-0139).
 *
 * Every path that adds papers reads the library, drops what is already there, and inserts the rest.
 * Two of them running at once both read the library before either inserts, and both insert: two
 * `find-sources` runs 3.6 s apart added the same five papers twice (ADR-0136, "Not fixed"). The
 * second copy's `resolve-reference` job had the first's id, BullMQ dropped it, and the copy stayed
 * PENDING ("Looking it up…") for good.
 *
 * A unique index cannot carry the rule: the library deliberately holds duplicates until the student
 * merges them (library hygiene, ADR-0045), resolution fills a DOI in later, and a title is matched
 * normalised. So the check and the insert happen inside one transaction that first takes a
 * per-thesis advisory lock: a second adder waits for the first to commit, then reads what it added.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

/** What a paper is recognised by. Any one matching an existing row makes it "already there". */
export type SourceIdentity = {
  doi?: string | null;
  title?: string | null;
  rawReference?: string | null;
};

export type AddedSource<T> = { item: T; id: string; created: boolean };

/** A title as the duplicate check compares it: lower case, letters and digits, single spaces. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Serialises every library insert for one thesis until the transaction ends. Selected through a
 * `FROM` so Prisma never has to read the function's `void` result.
 */
export async function lockDocumentSources(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<void> {
  const key = `tc:sources:${documentId}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** The library's rows, findable by DOI (any case), normalised title or the exact reference line. */
class LibraryIndex {
  private readonly byDoi = new Map<string, string>();
  private readonly byTitle = new Map<string, string>();
  private readonly byRaw = new Map<string, string>();

  add(row: SourceIdentity, id: string): void {
    const doi = row.doi?.trim().toLowerCase();
    if (doi && !this.byDoi.has(doi)) this.byDoi.set(doi, id);
    const title = row.title ? normaliseTitle(row.title) : '';
    if (title && !this.byTitle.has(title)) this.byTitle.set(title, id);
    const raw = row.rawReference?.trim();
    if (raw && !this.byRaw.has(raw)) this.byRaw.set(raw, id);
  }

  find(item: SourceIdentity): string | undefined {
    const doi = item.doi?.trim().toLowerCase();
    const title = item.title ? normaliseTitle(item.title) : '';
    const raw = item.rawReference?.trim();
    return (
      (doi ? this.byDoi.get(doi) : undefined) ??
      (raw ? this.byRaw.get(raw) : undefined) ??
      (title ? this.byTitle.get(title) : undefined)
    );
  }
}

/**
 * Adds each item the thesis's library does not already hold, by `create`, and returns every item
 * with its row: the new one, or the one already there (an earlier item of the same call counts).
 * Atomic per thesis: concurrent calls for the same document add each paper once.
 *
 * Queue any follow-up job (resolution, indexing) after this returns, for the `created` rows only:
 * a job queued inside the transaction could run before the row is committed.
 */
export async function addSourcesOnce<T extends SourceIdentity>(
  prisma: PrismaClient,
  documentId: string,
  items: readonly T[],
  create: (tx: Prisma.TransactionClient, item: T) => Promise<{ id: string }>,
): Promise<Array<AddedSource<T>>> {
  if (items.length === 0) return [];
  return prisma.$transaction(
    async (tx) => {
      await lockDocumentSources(tx, documentId);
      const library = await tx.source.findMany({
        where: { documentId },
        select: { id: true, doi: true, title: true, rawReference: true },
        orderBy: { createdAt: 'asc' },
      });
      const index = new LibraryIndex();
      for (const row of library) index.add(row, row.id);
      const out: Array<AddedSource<T>> = [];
      for (const item of items) {
        const found = index.find(item);
        if (found) {
          out.push({ item, id: found, created: false });
          continue;
        }
        const row = await create(tx, item);
        index.add(item, row.id);
        out.push({ item, id: row.id, created: true });
      }
      return out;
    },
    // A second adder waits on the lock inside its transaction; the first holds it for a few
    // inserts. Generous, so a busy database delays an add rather than failing it.
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * The cleanup for copies the race already made (ADR-0139): a PENDING source that duplicates a
 * RESOLVED one in the same thesis — same DOI, same normalised title, or the same reference line —
 * and is older than `olderThanMinutes`, so a copy whose resolution is merely still running is
 * left alone. Never one that is cited, pinned, filed in a collection, highlighted or has passages:
 * those carry the student's work and stay for the student to merge. Idempotent; returns how many
 * rows went. `documentId` narrows it to one thesis.
 */
export async function removeStrandedDuplicateSources(
  prisma: PrismaClient,
  options: { documentId?: string; olderThanMinutes?: number } = {},
): Promise<number> {
  const minutes = options.olderThanMinutes ?? 10;
  const documentId = options.documentId ?? null;
  return prisma.$executeRaw`
    DELETE FROM "Source" p
    WHERE p.status = 'PENDING'
      AND p."createdAt" < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${minutes}::int)
      AND (${documentId}::uuid IS NULL OR p."documentId" = ${documentId}::uuid)
      AND EXISTS (
        SELECT 1 FROM "Source" r
        WHERE r."documentId" = p."documentId"
          AND r.id <> p.id
          AND r.status = 'RESOLVED'
          AND (
            (p.doi IS NOT NULL AND r.doi IS NOT NULL AND lower(r.doi) = lower(p.doi))
            OR (
              p.title IS NOT NULL AND r.title IS NOT NULL
              AND btrim(regexp_replace(lower(p.title), '[^a-z0-9]+', ' ', 'g')) <> ''
              AND btrim(regexp_replace(lower(r.title), '[^a-z0-9]+', ' ', 'g'))
                = btrim(regexp_replace(lower(p.title), '[^a-z0-9]+', ' ', 'g'))
            )
            OR (p."rawReference" IS NOT NULL AND r."rawReference" = p."rawReference")
          )
      )
      AND NOT EXISTS (SELECT 1 FROM "Citation" c WHERE c."sourceId" = p.id)
      AND NOT EXISTS (SELECT 1 FROM "ChapterSourcePin" s WHERE s."sourceId" = p.id)
      AND NOT EXISTS (SELECT 1 FROM "SourceCollectionItem" i WHERE i."sourceId" = p.id)
      AND NOT EXISTS (SELECT 1 FROM "SourceHighlight" h WHERE h."sourceId" = p.id)
      AND NOT EXISTS (SELECT 1 FROM "SourceChunk" k WHERE k."sourceId" = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM "Chapter" ch
        WHERE ch."documentId" = p."documentId" AND ch.content::text LIKE '%' || p.id::text || '%'
      )
  `;
}
