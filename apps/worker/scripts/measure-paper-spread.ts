/**
 * How many different papers the writing paths draw on (ADR-0128). Reads the theses in the database
 * `.env` points at; writes nothing; embeds the query sentences (Voyage, a fraction of a rupee).
 * Run: `pnpm --filter @tc/worker exec dotenv -e ../../.env -- tsx scripts/measure-paper-spread.ts`
 *
 * For each thesis with at least eight indexed papers, up to twelve sentences from its chapters (or
 * its chapter titles, for a thesis with no text yet) go through `retrievePassages` exactly as a
 * suggestion (ASSIST) and a section draft (DRAFT) would. Printed per thesis: the papers in the
 * library, the papers among the candidates, and the papers in what the model is actually sent.
 */

import { createProviders } from '@tc/ai';
import { loadEnv } from '@tc/config';
import { PrismaClient } from '@tc/db';
import { type ContextClient, retrievePassages } from '@tc/retrieval';

const prisma = new PrismaClient();
const embeddings = createProviders(loadEnv()).embeddings;

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === 'string') return n.text;
  return (n.content ?? []).map(textOf).join(n.type === 'doc' ? '\n' : '');
}

function paragraphs(content: unknown): string[] {
  const doc = content as { content?: unknown[] } | null;
  return (doc?.content ?? [])
    .filter((n) => (n as { type?: string }).type === 'paragraph')
    .map(textOf)
    .map((t) => t.trim())
    .filter((t) => t.split(/\s+/).length >= 12);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main(): Promise<void> {
  const docs = await prisma.$queryRawUnsafe<Array<{ documentId: string; papers: number }>>(
    `SELECT s."documentId", COUNT(DISTINCT s."id")::int AS papers
       FROM "SourceChunk" c JOIN "Source" s ON s."id" = c."sourceId"
      GROUP BY 1 HAVING COUNT(DISTINCT s."id") >= 8 ORDER BY 2 DESC LIMIT 6`,
  );
  const totals = { ASSIST: [] as number[], DRAFT: [] as number[], cand: [] as number[] };
  for (const { documentId, papers } of docs) {
    const chapters = await prisma.chapter.findMany({
      where: { documentId },
      orderBy: { order: 'asc' },
    });
    if (chapters.length === 0) continue;
    const queries: Array<{ chapter: (typeof chapters)[number]; text: string }> = [];
    for (const chapter of chapters) {
      for (const p of paragraphs(chapter.content).slice(0, 4)) queries.push({ chapter, text: p });
    }
    if (queries.length === 0) {
      for (const chapter of chapters) queries.push({ chapter, text: chapter.title });
    }
    const picked = queries.slice(0, 12);
    const row = { ASSIST: [] as number[], DRAFT: [] as number[], cand: [] as number[] };
    for (const q of picked) {
      for (const action of ['ASSIST', 'DRAFT'] as const) {
        const r = await retrievePassages(
          prisma as unknown as ContextClient,
          (texts) => embeddings.embed(texts),
          q.chapter,
          q.text,
          action,
        );
        row[action].push(new Set(r.passages.map((p) => p.sourceId)).size);
        if (action === 'DRAFT') row.cand.push(r.candidates);
      }
    }
    totals.ASSIST.push(...row.ASSIST);
    totals.DRAFT.push(...row.DRAFT);
    console.log(
      `${documentId.slice(0, 8)}  library ${String(papers).padStart(2)} papers  ` +
        `${picked.length} queries  candidates ${mean(row.cand).toFixed(0)}  ` +
        `suggestion: ${mean(row.ASSIST).toFixed(1)} papers  draft: ${mean(row.DRAFT).toFixed(1)} papers`,
    );
  }
  console.log(
    `ALL  suggestion: ${mean(totals.ASSIST).toFixed(2)} papers per request  ` +
      `draft: ${mean(totals.DRAFT).toFixed(2)} papers per request`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
