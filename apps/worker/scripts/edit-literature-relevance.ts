/**
 * Measures where "Search the literature" on an AI edit should draw its relevance line — ADR-0133.
 *
 *   pnpm --filter @tc/worker exec dotenv -e ../../.env -- tsx scripts/edit-literature-relevance.ts
 *
 * No model and no database: for each realistic selection/instruction pair (different fields, some
 * with a thesis title, some untitled) it plans the searches with the production
 * `editSearchPlan`, asks the real indexes as `WebScopeService.searchPlan` does (OpenAlex semantic
 * and keyword, Semantic Scholar with a key, PubMed, arXiv, within `CHAT_RESEARCH.budget`), embeds
 * every candidate with an abstract once, and prints each one's cosine against the relevance text
 * (context + selection) and against the semantic text (context + selection + instruction), with
 * its title, best first. The first version's measure (the instruction and the selection, against
 * `planResearchQueries`) is printed too, for the two papers the first live run let in.
 *
 * The pairs are written for the measurement; nothing here is a fixture expectation. A human reads
 * the numbers; ADR-0133 has the run.
 */

import { createProviders } from '@tc/ai';
import { loadEnv } from '@tc/config';
import {
  ArxivClient,
  CHAT_RESEARCH,
  cosine,
  type DiscoveredWork,
  EDIT_SEARCH,
  editSearchContext,
  editSearchPlan,
  interleave,
  keepRelevant,
  mergeWorks,
  OpenAlexDiscovery,
  PubMedClient,
  planResearchQueries,
  researchEmbedText,
  SemanticScholarClient,
  searchWithinBudget,
} from '@tc/retrieval';

type Pair = {
  field: string;
  thesis?: string;
  chapter?: string;
  selection: string;
  instruction: string;
};

const PAIRS: Pair[] = [
  {
    field: 'energy (the live run: untitled, empty library)',
    selection:
      'Many rural households in Karnataka have not installed rooftop solar panels even though subsidies exist. The upfront cost and access to credit appear to matter.',
    instruction: 'Add evidence from published studies for each claim',
  },
  {
    field: 'energy, titled',
    thesis: 'Barriers to rooftop solar adoption among rural households in Karnataka',
    chapter: 'Literature Review',
    selection:
      'Net metering lets a household sell surplus solar power to the grid, which shortens the payback period of a rooftop system.',
    instruction: 'Support this with published evidence',
  },
  {
    field: 'structural biology',
    thesis: 'Deep learning for protein structure prediction',
    selection:
      'AlphaFold2 predicts structures with near-experimental accuracy for many single-domain proteins, but its confidence falls for proteins with few homologous sequences.',
    instruction: 'Add citations',
  },
  {
    field: 'fisheries',
    thesis: 'Post-harvest fish losses in coastal Kerala',
    selection:
      'Traditional open sun drying of fish on the Kerala coast exposes the catch to dust, insects and rain, and losses rise in the monsoon.',
    instruction: 'Expand with evidence',
  },
  {
    field: 'education (untitled)',
    selection:
      'Mother-tongue instruction in the early primary years improves reading comprehension compared with instruction in a second language.',
    instruction: 'Add evidence',
  },
  {
    field: 'public health',
    thesis: 'Anaemia among adolescent girls in rural Tamil Nadu',
    selection:
      'Weekly iron and folic acid supplementation in schools has reduced anaemia, but adherence falls when tablets cause gastric side effects.',
    instruction: 'Add a counter-argument',
  },
  {
    field: 'computer science',
    thesis: 'Transformer models for low-resource machine translation',
    selection:
      'Back-translation of monolingual target-language text improves translation quality for low-resource language pairs.',
    instruction: 'Cite studies',
  },
  {
    field: 'development economics (untitled)',
    selection:
      'Microfinance loans to women in self-help groups raise household consumption but have little effect on business profits.',
    instruction: 'Add evidence for each claim',
  },
  {
    field: 'civil engineering',
    thesis: 'Fly ash as partial cement replacement in concrete',
    selection:
      'Replacing 30 percent of cement with fly ash lowers early compressive strength but improves long-term durability against chloride attack.',
    instruction: 'Support with published studies',
  },
  {
    field: 'psychology (chapter only)',
    chapter: 'Literature Review',
    selection:
      'Smartphone use at bedtime is associated with shorter sleep duration and poorer sleep quality among university students.',
    instruction: 'Add evidence',
  },
];

/** Candidate rules: a floor, and a margin below the best match. */
const RULES = [
  { floor: 0.6, margin: 1 },
  { floor: 0.65, margin: 1 },
  { floor: 0.7, margin: 1 },
  { floor: 0.6, margin: 0.08 },
  { floor: 0.6, margin: 0.1 },
  { floor: 0.65, margin: 0.1 },
  { floor: EDIT_SEARCH.floor, margin: EDIT_SEARCH.margin },
];

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.EMBED_PROVIDER === 'mock') throw new Error('EMBED_PROVIDER is mock: nothing to measure.');
  const { embeddings } = createProviders(env);
  const mailto = env.OPENALEX_MAILTO ?? env.CROSSREF_MAILTO ?? '';
  const openalex = new OpenAlexDiscovery({
    mailto,
    ...(env.OPENALEX_API_KEY ? { apiKey: env.OPENALEX_API_KEY } : {}),
  });
  const s2 = env.SEMANTIC_SCHOLAR_API_KEY
    ? new SemanticScholarClient(env.SEMANTIC_SCHOLAR_API_KEY, { mailto })
    : null;
  const pubmed = new PubMedClient({ mailto, apiKey: env.NCBI_API_KEY ?? null });
  const arxiv = new ArxivClient({ mailto, attempts: 1 });
  console.log(`Embedding model: ${embeddings.modelId}; Semantic Scholar: ${s2 ? 'on' : 'off'}\n`);
  let totalTokens = 0;

  // `--replay` runs only the replay of the live run below.
  for (const pair of process.argv.includes('--replay') ? [] : PAIRS) {
    const context = editSearchContext({
      thesisTitle: pair.thesis ?? null,
      chapterTitle: pair.chapter ?? null,
    });
    const plan = editSearchPlan({
      selection: pair.selection,
      instruction: pair.instruction,
      context,
    });
    console.log(`=== ${pair.field}`);
    console.log(`  context:   ${context || '(none)'}`);
    console.log(`  semantic:  ${plan.semantic.slice(0, 160)}`);
    for (const k of plan.keyword) console.log(`  keyword:   ${k}`);

    const budget = {
      ...CHAT_RESEARCH.budget,
      onSkip: (q: string, reason: string) => console.log(`  skipped "${q}": ${reason}`),
    };
    const keywordIndexes = [openalex, s2, pubmed, arxiv].flatMap((c) => (c ? [c] : []));
    const lists = await Promise.all([
      searchWithinBudget(
        [plan.semantic],
        (q, signal) => openalex.semanticSearch(q, new Date(), signal),
        budget,
      ),
      ...keywordIndexes.map((client) =>
        searchWithinBudget(
          plan.keyword,
          (q, signal) => client.search(q, new Date(), signal),
          budget,
        ),
      ),
    ]);
    const works: DiscoveredWork[] = mergeWorks([interleave(lists.map((l) => interleave(l)))])
      .filter((w) => (w.abstract ?? '').trim().length >= 80 && w.title.trim())
      .slice(0, CHAT_RESEARCH.maxCandidates);
    if (works.length === 0) {
      console.log('  (nothing with an abstract)\n');
      continue;
    }
    const old = `${pair.instruction}. ${pair.selection}`;
    const { vectors, tokens } = await embeddings.embedWithUsage([
      plan.relevance,
      plan.semantic,
      old,
      ...works.map((w) => researchEmbedText(w)),
    ]);
    totalTokens += tokens;
    const [rv, sv, ov, ...wv] = vectors;
    const scored = works
      .map((w, i) => ({
        w,
        cosine: cosine(rv ?? [], wv[i] ?? []),
        semantic: cosine(sv ?? [], wv[i] ?? []),
        old: cosine(ov ?? [], wv[i] ?? []),
      }))
      .sort((a, b) => b.cosine - a.cosine);
    console.log(`  ${works.length} candidates, ${tokens} tokens`);
    console.log('  relev  seman  first  title');
    for (const s of scored) {
      console.log(
        `  ${s.cosine.toFixed(3)}  ${s.semantic.toFixed(3)}  ${s.old.toFixed(3)}  [${s.w.via}] ${s.w.title.slice(0, 110)} (${s.w.year ?? '?'})`,
      );
    }
    for (const rule of RULES) {
      const kept = keepRelevant(scored, { ...rule, max: EDIT_SEARCH.maxPapers });
      console.log(
        `  rule floor ${rule.floor} margin ${rule.margin === 1 ? '-' : rule.margin}: keeps ${kept.length}`,
      );
    }
    console.log('');
  }
  // The live run (2026-10-09): the first version's plan for the first pair — the instruction and
  // the selection through `planResearchQueries` with no title — and the two papers it kept,
  // looked up by title, scored on both measures.
  const live = PAIRS[0] as Pair;
  const oldQuestion = `${live.instruction}. ${live.selection}`;
  const oldPlan = planResearchQueries(oldQuestion, '');
  const relevance = editSearchPlan({ selection: live.selection, instruction: live.instruction });
  console.log('=== replay of the live run (first version)');
  for (const k of oldPlan.keyword) console.log(`  keyword:   ${k}`);
  const budget = { ...CHAT_RESEARCH.budget };
  const oldLists = await Promise.all([
    searchWithinBudget(
      [oldPlan.semantic],
      (q, signal) => openalex.semanticSearch(q, new Date(), signal),
      budget,
    ),
    ...[openalex, pubmed, arxiv].map((client) =>
      searchWithinBudget(
        oldPlan.keyword,
        (q, signal) => client.search(q, new Date(), signal),
        budget,
      ),
    ),
  ]);
  const named = await Promise.all(
    [
      'Utilizing Solar Photovoltaics to Improve Primary Health Care in Rural and Tribal Regions',
      'A review of renewable off-grid mini-grids in Sub-Saharan Africa',
    ].map((title) =>
      openalex.search(title, new Date(), AbortSignal.timeout(15_000)).catch(() => []),
    ),
  );
  const oldWorks = mergeWorks([
    interleave(oldLists.map((l) => interleave(l))),
    ...named.map((list) => list.slice(0, 1)),
  ])
    .filter((w) => (w.abstract ?? '').trim().length >= 80 && w.title.trim())
    .slice(0, CHAT_RESEARCH.maxCandidates + 2);
  const { vectors } = await embeddings.embedWithUsage([
    relevance.relevance,
    oldPlan.semantic,
    ...oldWorks.map((w) => researchEmbedText(w)),
  ]);
  const [rv, ov, ...wv] = vectors;
  const rows = oldWorks
    .map((w, i) => ({
      w,
      cosine: cosine(rv ?? [], wv[i] ?? []),
      old: cosine(ov ?? [], wv[i] ?? []),
    }))
    .sort((a, b) => b.old - a.old);
  console.log('  relev  first  title');
  for (const s of rows) {
    console.log(
      `  ${s.cosine.toFixed(3)}  ${s.old.toFixed(3)}  [${s.w.via}] ${s.w.title.slice(0, 110)} (${s.w.year ?? '?'})`,
    );
  }
  console.log(`\nEmbedding tokens in all: ${totalTokens}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
