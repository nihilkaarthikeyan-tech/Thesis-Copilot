/**
 * Sets one key of `Document.meta` in a single statement, leaving every other key as it is.
 *
 * `meta` holds several independent things (the proposal conversation, the outline run, the
 * source preferences…), and writing it as `{ ...meta-read-earlier, key }` loses whatever another
 * request wrote in between. Found 2026-10-07 (ADR-0091): a student who pressed Skip while the
 * first start question was being written had the plan's "running" mark wiped by the question's
 * save, so the open editor never learnt a plan was coming — no headings, no opening sentence.
 */

import type { PrismaService } from './prisma.service.js';

export async function setMetaKey(
  prisma: Pick<PrismaService, '$executeRaw'>,
  documentId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Document"
    SET "meta" = COALESCE("meta", '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb),
        "updatedAt" = now()
    WHERE "id" = ${documentId}::uuid`;
}
