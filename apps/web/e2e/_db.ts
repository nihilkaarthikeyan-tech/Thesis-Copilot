/**
 * Direct database access for the one thing the API cannot set up without the internet: a paper we
 * hold only the abstract of (ADR-0068's reader). Through the API that state needs a real
 * Crossref/OpenAlex lookup of a closed paper that happens to publish an abstract — a test that
 * depends on a third party's records. The row is written exactly as `resolve-reference` and
 * `index-source` would leave it, on a thesis this test created through the API.
 *
 * Uses the workspace's own Prisma client (`packages/db`), built by `pnpm build`, on the dev and
 * CI database (`DATABASE_URL`, else the dev Compose address).
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Prisma = {
  source: { create: (args: unknown) => Promise<{ id: string }> };
  sourceChunk: { create: (args: unknown) => Promise<unknown> };
  user: { findUniqueOrThrow: (args: unknown) => Promise<{ id: string }> };
  usageLedger: { upsert: (args: unknown) => Promise<unknown> };
  $disconnect: () => Promise<void>;
};

async function client(): Promise<Prisma> {
  const url = process.env.DATABASE_URL ?? 'postgresql://tc:tc@localhost:5434/tc';
  // Playwright compiles the specs as CommonJS, so the path is found from `__dirname`.
  const path = pathToFileURL(resolve(__dirname, '../../../packages/db/dist/index.js')).href;
  const { PrismaClient } = (await import(path)) as {
    PrismaClient: new (options: unknown) => Prisma;
  };
  return new PrismaClient({ datasources: { db: { url } } });
}

/** An abstract-only paper in `documentId`'s library, with its abstract as the one passage. */
export async function seedAbstractOnlySource(
  documentId: string,
  paper: { title: string; abstract: string; doi: string; year: number; family: string },
): Promise<string> {
  const prisma = await client();
  try {
    const source = await prisma.source.create({
      data: {
        documentId,
        status: 'RESOLVED',
        title: paper.title,
        authors: [{ family: paper.family, given: 'A.' }],
        year: paper.year,
        venue: 'Journal of Hydrology',
        doi: paper.doi,
        groundingLevel: 'ABSTRACT',
        cslJson: {
          type: 'article-journal',
          title: paper.title,
          author: [{ family: paper.family, given: 'A.' }],
          issued: { 'date-parts': [[paper.year]] },
          'container-title': 'Journal of Hydrology',
          DOI: paper.doi,
          abstract: paper.abstract,
        },
      },
    });
    await prisma.sourceChunk.create({
      data: { sourceId: source.id, ordinal: 0, text: paper.abstract, tokenCount: 20 },
    });
    return source.id;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * R31 (ADR-0122): this month's count of one allowance for the account at `email`, set directly,
 * so a test can be refused without spending real units first. The row is the one
 * `UsageService.consume` keys on: (user, `YYYY-MM` in UTC, action).
 */
export async function setAllowanceUsed(
  email: string,
  action: string,
  count: number,
): Promise<void> {
  const prisma = await client();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const period = new Date().toISOString().slice(0, 7);
    await prisma.usageLedger.upsert({
      where: { userId_period_action: { userId: user.id, period, action } },
      create: { userId: user.id, period, action, count },
      update: { count },
    });
  } finally {
    await prisma.$disconnect();
  }
}
