/**
 * Measures where chat's "the library is thin" line and the kept-abstract line sit — ADR-0074.
 *
 *   pnpm --filter @tc/api research:thresholds            # the library half (embeddings only)
 *   pnpm --filter @tc/api research:thresholds --search   # also the indexes, for the abstract line
 *
 * Read-only against the database in `DATABASE_URL`. For each library it finds (by title, the one
 * with the most indexed chunks), it retrieves the passages chat would for each question — the
 * production `retrievePassages` with the configured embedding model — and prints the best cosine,
 * how many passages clear each candidate line, and from how many papers. With `--search` it also
 * runs the research plan against the real indexes for one question per library and prints every
 * abstract's cosine against the question with its title, so a human can see where on-topic stops.
 *
 * The questions are written for the measurement; nothing here is a fixture expectation. The
 * numbers are the answer, and a human reads them (docs/BUILD_LOG.md has the run).
 */

import { createProviders } from '@tc/ai';
import { loadEnv } from '@tc/config';
import { PrismaClient } from '@tc/db';
import {
  ArxivClient,
  CHAT_RESEARCH,
  type ContextClient,
  cosine,
  type DiscoveredWork,
  libraryCoverage,
  mergeWorks,
  OpenAlexDiscovery,
  PubMedClient,
  planResearchQueries,
  researchEmbedText,
  retrievePassages,
  searchWithinBudget,
} from '@tc/retrieval';

type Group = 'rich' | 'thin' | 'off';
type Library = { title: string; questions: Array<{ group: Group; text: string }> };

const LIBRARIES: Library[] = [
  {
    title: 'Barriers to rooftop solar adoption among rural households%',
    questions: [
      { group: 'rich', text: 'What household frictions slow rooftop solar adoption in Karnataka?' },
      {
        group: 'rich',
        text: 'How does the subsidy process affect rooftop solar adoption in India?',
      },
      { group: 'rich', text: 'What policies drove rooftop solar adoption in Gujarat?' },
      {
        group: 'thin',
        text: 'What are the main financial barriers to rooftop solar adoption for rural households in India, according to my sources?',
      },
      { group: 'thin', text: 'How does access to credit or loans affect rooftop solar uptake?' },
      { group: 'thin', text: 'What is the payback period of a household rooftop solar system?' },
      {
        group: 'thin',
        text: 'How do women in rural households take part in the decision to adopt solar?',
      },
      { group: 'off', text: 'How do I make biryani?' },
    ],
  },
  {
    // Ten papers, abstracts only: the one dev library with more than five.
    title: 'Why rural households delay rooftop solar%',
    questions: [
      { group: 'rich', text: 'What stops rural households from installing rooftop solar?' },
      { group: 'rich', text: 'Does the subsidy increase rooftop solar adoption?' },
      {
        group: 'thin',
        text: 'What are the main financial barriers to rooftop solar adoption for rural households in India, according to my sources?',
      },
      { group: 'thin', text: 'How does net metering work for Indian households?' },
      { group: 'off', text: 'Who won the 2023 cricket world cup?' },
    ],
  },
  {
    title: 'Protein structure prediction with deep learning',
    questions: [
      { group: 'rich', text: 'How do deep learning methods predict protein structure?' },
      { group: 'thin', text: 'How accurate is AlphaFold2 on proteins with no homologues?' },
      { group: 'off', text: 'What is the capital of Australia?' },
    ],
  },
  {
    title: 'Fish drying losses in coastal Kerala villages',
    questions: [
      { group: 'rich', text: 'What problems does the dry fish industry face in West Bengal?' },
      { group: 'thin', text: 'How much fish is lost during traditional sun drying in Kerala?' },
      { group: 'thin', text: 'Do solar dryers reduce post-harvest fish losses?' },
      { group: 'off', text: 'Give me tips for a job interview.' },
    ],
  },
];

const LINES = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7];

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.EMBED_PROVIDER === 'mock') throw new Error('EMBED_PROVIDER is mock: nothing to measure.');
  const { embeddings } = createProviders(env);
  const prisma = new PrismaClient();
  const db = prisma as unknown as ContextClient;
  const search = process.argv.includes('--search');
  console.log(`Embedding model: ${embeddings.modelId}\n`);

  for (const library of LIBRARIES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; chunks: bigint }>>(
      `SELECT d."id"::text AS id, count(c."id") AS chunks
         FROM "Document" d JOIN "Source" s ON s."documentId" = d."id"
         JOIN "SourceChunk" c ON c."sourceId" = s."id"
        WHERE d."title" ILIKE $1 GROUP BY d."id" ORDER BY chunks DESC LIMIT 1`,
      library.title,
    );
    const documentId = rows[0]?.id;
    if (!documentId) {
      console.log(`(no library titled ${library.title})\n`);
      continue;
    }
    const chapter = await prisma.chapter.findFirstOrThrow({
      where: { documentId },
      select: {
        id: true,
        documentId: true,
        outlineNodeId: true,
        title: true,
        scopeNote: true,
        content: true,
      },
    });
    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { title: true },
    });
    const papers = await prisma.source.count({
      where: { documentId, chunks: { some: {} } },
    });
    console.log(`${document.title} — ${papers} papers with text (${rows[0]?.chunks} chunks)`);
    console.log(
      `  group  best   ${LINES.map((l) => `>=${l.toFixed(2)} (src)`).join('  ')}  verdict  question`,
    );
    for (const q of library.questions) {
      const retrieved = await retrievePassages(
        db,
        (texts) => embeddings.embed(texts),
        chapter,
        q.text,
        'CHAT',
      );
      const coverage = libraryCoverage(retrieved.passages);
      const cols = LINES.map((line) => {
        const on = retrieved.passages.filter((p) => p.cosine >= line);
        return `${String(on.length).padStart(2)} (${new Set(on.map((p) => p.sourceId)).size})`.padEnd(
          13,
        );
      });
      console.log(
        `  ${q.group.padEnd(5)}  ${coverage.best.toFixed(3)}  ${cols.join('')}${(coverage.thin ? 'THIN' : 'ok').padEnd(9)}${q.text}`,
      );
    }

    for (const question of search ? library.questions.filter((q) => q.group === 'thin') : []) {
      const plan = planResearchQueries(question.text, document.title);
      console.log(`\n  Research plan for: ${question.text}`);
      console.log(`    semantic: ${plan.semantic}`);
      for (const k of plan.keyword) console.log(`    keyword:  ${k}`);
      const options = {
        mailto: env.OPENALEX_MAILTO ?? env.CROSSREF_MAILTO ?? '',
        ...(env.OPENALEX_API_KEY ? { apiKey: env.OPENALEX_API_KEY } : {}),
      };
      const openalex = new OpenAlexDiscovery(options);
      const pubmed = new PubMedClient({ mailto: options.mailto, apiKey: env.NCBI_API_KEY ?? null });
      const arxiv = new ArxivClient({ mailto: options.mailto, attempts: 1 });
      const budget = {
        ...CHAT_RESEARCH.budget,
        onSkip: (q: string, reason: string) => console.log(`    skipped "${q}": ${reason}`),
      };
      const began = Date.now();
      const lists: DiscoveredWork[][] = (
        await Promise.all([
          searchWithinBudget(
            [plan.semantic],
            (text, signal) => openalex.semanticSearch(text, new Date(), signal),
            budget,
          ),
          searchWithinBudget(
            plan.keyword,
            (text, signal) => openalex.search(text, new Date(), signal),
            budget,
          ),
          searchWithinBudget(
            plan.keyword,
            (text, signal) => pubmed.search(text, new Date(), signal),
            budget,
          ),
          searchWithinBudget(
            plan.keyword,
            (text, signal) => arxiv.search(text, new Date(), signal),
            budget,
          ),
        ])
      ).flat();
      const works = mergeWorks(lists).filter((w) => (w.abstract ?? '').trim().length >= 80);
      console.log(`    searched in ${Date.now() - began} ms; ${works.length} with an abstract`);
      // Two candidate measures: the question alone, and the thesis title with the question (the
      // shape `find-sources` scores against).
      const texts = [question.text, plan.semantic, ...works.slice(0, 40).map(researchEmbedText)];
      const { vectors, tokens } = await embeddings.embedWithUsage(texts);
      const [qv, tv, ...wv] = vectors;
      const scored = works
        .slice(0, 40)
        .map((w, i) => ({
          w,
          c: cosine(qv ?? [], wv[i] ?? []),
          t: cosine(tv ?? [], wv[i] ?? []),
        }))
        .sort((a, b) => b.t - a.t);
      console.log(`    embedded ${texts.length} texts, ${tokens} tokens`);
      console.log('    question  title+question');
      for (const { w, c, t } of scored) {
        console.log(
          `    ${c.toFixed(3)}     ${t.toFixed(3)}  [${w.via}] ${w.title.slice(0, 100)} (${w.year ?? '?'})`,
        );
      }
    }
    console.log('');
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
