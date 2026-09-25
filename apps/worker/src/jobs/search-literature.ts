/**
 * `search-literature` — PRD FR-2.5, FR-2.6, FR-2.8, PHASES v2 W7.1, W7.2, W7.4.
 *
 * `discover`: A.7 queries (one Strong call) → OpenAlex per query (+ Semantic Scholar when keyed)
 * → merge by DOI/title → drop what the library already holds → embedding-similarity filter to the
 * scope (top 60, no Strong call) → A.8 themes (one Fast call) → `SearchCandidate` rows and the
 * gap map on `DocumentMemory.gapMap`.
 *
 * `expand`: for each resolved source with an OpenAlex id, `cited_by` (top 10) and `related_works`,
 * merged into one run under the theme "Related to your citations" (FR-2.8) — no model call.
 *
 * Counts per stage are logged and stored on the run (`Document.meta.searchRuns[runId]`) so the
 * screen can say what happened and the log shows where candidates were lost.
 */

import {
  buildQueriesRequest,
  buildThemesRequest,
  cleanQueries,
  type EmbeddingProvider,
  type LlmProvider,
  normaliseThemes,
  queriesSchema,
  type ScopeForQueries,
  themesSchema,
} from '@tc/ai';
import { computeCallCost } from '@tc/config';
import type { PrismaClient } from '@tc/db';
import {
  type ArxivClient,
  cosine,
  type DiscoveredWork,
  mergeWorks,
  type OpenAlexDiscovery,
  type PubMedClient,
  type SemanticScholarClient,
} from '@tc/retrieval';
import type { SearchLiteratureJob } from '@tc/types';

export const SEARCH = {
  /** PHASES: "keep top 60". */
  keep: 60,
  /** Embedding batch size, as index-source uses. */
  embedBatch: 64,
  expandTheme: 'Related to your citations',
} as const;

export type SearchLiteratureDeps = {
  prisma: PrismaClient;
  /** Throws when the site's monthly AI budget is reached (2026-09-25): nothing is embedded. */
  assertBudget?: () => Promise<void>;
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  openalex: OpenAlexDiscovery;
  semanticScholar?: SemanticScholarClient | null;
  /** ADR-0020. Both optional, so a script or test that builds the deps by hand keeps working. */
  pubmed?: PubMedClient | null;
  arxiv?: ArxivClient | null;
  aiProvider: 'anthropic' | 'mock';
  log?: (event: Record<string, unknown>) => void;
  now?: () => Date;
};

export type SearchRunStatus = 'RUNNING' | 'DONE' | 'FAILED';

export type SearchRunRecord = {
  runId: string;
  mode: 'discover' | 'expand';
  status: SearchRunStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  counts: Record<string, number>;
  queries?: Array<{ angle: string; q: string }>;
};

export type SearchLiteratureResult = {
  runId: string;
  mode: 'discover' | 'expand';
  candidates: number;
  themes: number;
  counts: Record<string, number>;
};

function readScope(value: unknown): ScopeForQueries | null {
  const scope = value as Partial<ScopeForQueries> | null;
  if (!scope || typeof scope.workingTitle !== 'string' || !scope.workingTitle.trim()) return null;
  return {
    workingTitle: scope.workingTitle,
    problemStatement: scope.problemStatement ?? '',
    objectives: Array.isArray(scope.objectives) ? scope.objectives : [],
    ...(scope.whyOpen ? { whyOpen: scope.whyOpen } : {}),
  };
}

async function writeRun(
  prisma: PrismaClient,
  documentId: string,
  record: SearchRunRecord,
): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { meta: true },
  });
  const meta = (document?.meta as Record<string, unknown> | null) ?? {};
  const runs = (meta.searchRuns as Record<string, SearchRunRecord> | undefined) ?? {};
  await prisma.document.update({
    where: { id: documentId },
    data: { meta: { ...meta, searchRuns: { ...runs, [record.runId]: record } } },
  });
}

export async function runSearchLiterature(
  job: SearchLiteratureJob,
  deps: SearchLiteratureDeps,
): Promise<SearchLiteratureResult> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());
  const record: SearchRunRecord = {
    runId: job.runId,
    mode: job.mode,
    status: 'RUNNING',
    startedAt: now().toISOString(),
    counts: {},
  };
  await writeRun(deps.prisma, job.documentId, record);

  try {
    const outcome =
      job.mode === 'discover'
        ? await discover(job, deps, record, log, now)
        : await expand(job, deps, record, log);
    record.status = 'DONE';
    record.finishedAt = now().toISOString();
    await writeRun(deps.prisma, job.documentId, record);
    log({ msg: 'search-literature done', runId: job.runId, mode: job.mode, ...record.counts });
    return outcome;
  } catch (error) {
    record.status = 'FAILED';
    record.finishedAt = now().toISOString();
    record.error = error instanceof Error ? error.message : String(error);
    await writeRun(deps.prisma, job.documentId, record);
    throw error;
  }
}

/** Sources already in the library, by DOI and normalised title, so a run never re-offers them. */
async function libraryKeys(
  prisma: PrismaClient,
  documentId: string,
): Promise<{ dois: Set<string>; titles: Set<string>; titlesList: string[] }> {
  const rows = await prisma.source.findMany({
    where: { documentId },
    select: { doi: true, title: true },
  });
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return {
    dois: new Set(rows.map((r) => r.doi?.toLowerCase()).filter((d): d is string => Boolean(d))),
    titles: new Set(rows.map((r) => (r.title ? norm(r.title) : '')).filter(Boolean)),
    titlesList: rows.map((r) => r.title).filter((t): t is string => Boolean(t)),
  };
}

function notInLibrary(
  works: DiscoveredWork[],
  keys: { dois: Set<string>; titles: Set<string> },
): DiscoveredWork[] {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return works.filter((w) => !(w.doi && keys.dois.has(w.doi)) && !keys.titles.has(norm(w.title)));
}

async function storeCandidates(
  prisma: PrismaClient,
  job: SearchLiteratureJob,
  works: Array<DiscoveredWork & { score?: number; theme?: string }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const w of works) {
    const row = await prisma.searchCandidate.create({
      data: {
        runId: job.runId,
        documentId: job.documentId,
        openalexId: w.openalexId,
        doi: w.doi,
        title: w.title,
        abstract: w.abstract,
        year: w.year,
        venue: w.venue,
        citationCount: w.citationCount,
        isPreprint: w.isPreprint,
        oaStatus: w.oaStatus,
        theme: w.theme ?? null,
        score: w.score ?? null,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

async function logCall(
  deps: SearchLiteratureDeps,
  job: SearchLiteratureJob,
  tier: 'fast' | 'strong',
  model: string,
  usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    outputTokens: number;
  } | null,
  latencyMs: number,
  ok: boolean,
  error?: unknown,
): Promise<void> {
  const cost =
    ok && usage && deps.aiProvider !== 'mock'
      ? computeCallCost({ tier, modelId: model, usage })
      : 0;
  await deps.prisma.aiCallLog.create({
    data: {
      userId: job.userId,
      documentId: job.documentId,
      action: 'SEARCH_QUERIES',
      model,
      inputTokens: usage?.inputTokens ?? 0,
      cachedInputTokens: usage?.cachedInputTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      costMicroInr: BigInt(cost),
      latencyMs,
      ok,
      error: ok ? null : String(error instanceof Error ? error.message : error).slice(0, 500),
    },
  });
}

async function discover(
  job: SearchLiteratureJob,
  deps: SearchLiteratureDeps,
  record: SearchRunRecord,
  log: NonNullable<SearchLiteratureDeps['log']>,
  now: () => Date,
): Promise<SearchLiteratureResult> {
  const memory = await deps.prisma.documentMemory.findUnique({
    where: { documentId: job.documentId },
    select: { scope: true, gapMap: true },
  });
  const scope = readScope(memory?.scope);
  if (!scope) {
    throw new Error(
      'Save the proposal first: the search needs a working title and problem statement.',
    );
  }
  const library = await libraryKeys(deps.prisma, job.documentId);

  // 1. Queries — the run's one Strong call (FR-2.5).
  const queriesRequest = buildQueriesRequest({
    scope,
    existingTitles: library.titlesList,
    userId: job.userId,
    documentId: job.documentId,
  });
  let startedAt = Date.now();
  let queries: Array<{ angle: string; q: string }>;
  try {
    const answer = await deps.llm.complete({ ...queriesRequest, schema: queriesSchema });
    await logCall(deps, job, 'strong', answer.modelId, answer.usage, Date.now() - startedAt, true);
    queries = cleanQueries(answer.value, scope.workingTitle);
  } catch (error) {
    await logCall(
      deps,
      job,
      'strong',
      deps.llm.modelIdFor('strong'),
      null,
      Date.now() - startedAt,
      false,
      error,
    );
    throw error;
  }
  record.queries = queries;
  record.counts.queries = queries.length;
  log({ msg: 'search queries', runId: job.runId, queries });

  // 2. Search each query in every index. The indexes run side by side, each working through the
  //    queries in turn: arXiv allows one request every three seconds (ADR-0020), and run one
  //    after another its wait would be added to everyone else's.
  const indexes = [
    { name: 'openalex', client: deps.openalex },
    { name: 'semanticscholar', client: deps.semanticScholar },
    { name: 'pubmed', client: deps.pubmed },
    { name: 'arxiv', client: deps.arxiv },
  ].flatMap(({ name, client }) => (client ? [{ name, client }] : []));
  const perIndex = await Promise.all(
    indexes.map(async ({ name, client }) => {
      const found: DiscoveredWork[][] = [];
      for (const query of queries) {
        try {
          found.push(await client.search(query.q, now()));
        } catch (error) {
          // One index failing loses its results, never the run.
          log({ level: 40, msg: `${name} query failed`, q: query.q, error: String(error) });
          found.push([]);
        }
      }
      record.counts[name] = found.reduce((n, list) => n + list.length, 0);
      return found;
    }),
  );
  // Query by query, OpenAlex first within each: `mergeWorks` keeps the first record it sees of a
  // paper, and OpenAlex's is the one with a citation count and an open-access status.
  const lists: DiscoveredWork[][] = queries.flatMap((_, q) =>
    perIndex.map((found) => found[q] ?? []),
  );
  record.counts.fetched = lists.reduce((n, l) => n + l.length, 0);

  // 3. Merge, drop what is already in the library.
  const merged = mergeWorks(lists);
  record.counts.merged = merged.length;
  const fresh = notInLibrary(merged, library);
  record.counts.notInLibrary = fresh.length;

  // 4. Embedding-similarity filter against the scope: no Strong call (FR-2.5).
  const scopeText = `${scope.workingTitle}. ${scope.problemStatement} ${scope.objectives.join(' ')}`;
  const texts = fresh.map((w) => `${w.title}. ${w.abstract ?? ''}`.slice(0, 2_000));
  const vectors: number[][] = [];
  await deps.assertBudget?.();
  const [scopeVector] = await deps.embeddings.embed([scopeText]);
  for (let i = 0; i < texts.length; i += SEARCH.embedBatch) {
    vectors.push(...(await deps.embeddings.embed(texts.slice(i, i + SEARCH.embedBatch))));
  }
  const scored = fresh
    .map((w, i) => ({ ...w, score: cosine(scopeVector ?? [], vectors[i] ?? []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH.keep);
  record.counts.kept = scored.length;

  // 5. Themes — the run's one Fast call (FR-2.6).
  const tempIds = scored.map((_, i) => `c${i + 1}`);
  let themes = normaliseThemes({ themes: [] }, tempIds);
  if (scored.length > 0) {
    const themesRequest = buildThemesRequest({
      scope,
      candidates: scored.map((w, i) => ({
        id: tempIds[i] ?? '',
        title: w.title,
        abstract: w.abstract,
      })),
      userId: job.userId,
      documentId: job.documentId,
    });
    startedAt = Date.now();
    try {
      const answer = await deps.llm.complete({ ...themesRequest, schema: themesSchema });
      await logCall(deps, job, 'fast', answer.modelId, answer.usage, Date.now() - startedAt, true);
      themes = normaliseThemes(answer.value, tempIds);
    } catch (error) {
      await logCall(
        deps,
        job,
        'fast',
        deps.llm.modelIdFor('fast'),
        null,
        Date.now() - startedAt,
        false,
        error,
      );
      throw error;
    }
  }
  const themeOf = new Map<string, string>();
  for (const t of themes) for (const id of t.candidateIds) themeOf.set(id, t.name);

  // 6. Store the candidates and the gap map.
  const ids = await storeCandidates(
    deps.prisma,
    job,
    scored.map((w, i) => ({ ...w, theme: themeOf.get(tempIds[i] ?? '') ?? 'Other' })),
  );
  const idByTemp = new Map(tempIds.map((t, i) => [t, ids[i] ?? '']));
  const gapMap = {
    runId: job.runId,
    at: now().toISOString(),
    themes: themes.map((t) => ({
      name: t.name,
      count: t.count,
      thin: t.thin,
      candidateIds: t.candidateIds.map((c) => idByTemp.get(c) ?? c),
      sourceIds: [] as string[],
    })),
  };
  await deps.prisma.documentMemory.update({
    where: { documentId: job.documentId },
    data: { gapMap: gapMap as never },
  });
  record.counts.themes = themes.length;
  record.counts.thin = themes.filter((t) => t.thin).length;

  return {
    runId: job.runId,
    mode: 'discover',
    candidates: ids.length,
    themes: themes.length,
    counts: record.counts,
  };
}

async function expand(
  job: SearchLiteratureJob,
  deps: SearchLiteratureDeps,
  record: SearchRunRecord,
  log: NonNullable<SearchLiteratureDeps['log']>,
): Promise<SearchLiteratureResult> {
  const sources = await deps.prisma.source.findMany({
    where: { documentId: job.documentId, status: 'RESOLVED', openalexId: { not: null } },
    select: { openalexId: true },
    take: 40,
  });
  record.counts.sources = sources.length;
  const lists: DiscoveredWork[][] = [];
  for (const source of sources) {
    const id = source.openalexId as string;
    try {
      lists.push(await deps.openalex.citedBy(id));
      lists.push(await deps.openalex.related(id));
    } catch (error) {
      log({
        level: 40,
        msg: 'expansion failed for a source',
        openalexId: id,
        error: String(error),
      });
    }
  }
  record.counts.fetched = lists.reduce((n, l) => n + l.length, 0);
  const library = await libraryKeys(deps.prisma, job.documentId);
  const merged = notInLibrary(mergeWorks(lists), library);
  record.counts.merged = merged.length;
  const kept = merged
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
    .slice(0, SEARCH.keep);
  record.counts.kept = kept.length;
  const ids = await storeCandidates(
    deps.prisma,
    job,
    kept.map((w) => ({ ...w, theme: SEARCH.expandTheme })),
  );
  return {
    runId: job.runId,
    mode: 'expand',
    candidates: ids.length,
    themes: 1,
    counts: record.counts,
  };
}
