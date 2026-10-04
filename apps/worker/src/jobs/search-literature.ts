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
  densityFrom,
  mergeWorks,
  type OpenAlexDiscovery,
  type PubMedClient,
  type SemanticScholarClient,
  searchWithinBudget,
  type ThemeDensity,
  themeQuery,
} from '@tc/retrieval';
import type { SearchLiteratureJob } from '@tc/types';

export const SEARCH = {
  /** PHASES: "keep top 60". */
  keep: 60,
  /** Embedding batch size, as index-source uses. */
  embedBatch: 64,
  expandTheme: 'Related to your citations',
  /** ADR-0052: Expand's three groups. */
  expandThemes: {
    references: 'Cited by your sources',
    recent: 'Recent work citing your sources',
    related: 'Related to your citations',
  },
  /** Each group's share of the 60 kept. */
  expandPerTheme: 20,
  /** ADR-0046: thin themes searched again with their own query, at most this many per run. */
  fillThemes: 4,
  /** Papers a targeted search may add to one thin theme. */
  fillPerTheme: 5,
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
  /**
   * ADR-0046: per theme, the targeted query and what OpenAlex counts for it, year by year. Kept
   * on the run rather than the gap map, which the next run overwrites.
   */
  themeDensity?: Record<string, ThemeDensity>;
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
  //    ADR-0050: each index has a time budget, so a slow or rate-limited one (arXiv) cannot hold
  //    the run; one index failing or running out of time loses its results, never the run.
  const perIndex = await Promise.all(
    indexes.map(async ({ name, client }) => {
      const found = await searchWithinBudget(
        queries.map((q) => q.q),
        (q, signal) => client.search(q, now(), signal),
        { onSkip: (q, reason) => log({ level: 40, msg: `${name} query skipped`, q, reason }) },
      );
      record.counts[name] = found.reduce((n, list) => n + list.length, 0);
      return found;
    }),
  );
  //    ADR-0050: one OpenAlex semantic search with the whole scope — papers that share the idea,
  //    not only the words. Its results go first, so `mergeWorks` keeps OpenAlex's record.
  const semantic = await searchWithinBudget(
    [`${scope.workingTitle}. ${scope.problemStatement} ${scope.objectives.join(' ')}`],
    (q, signal) =>
      typeof deps.openalex.semanticSearch === 'function'
        ? deps.openalex.semanticSearch(q, now(), signal)
        : Promise.resolve([]),
    { onSkip: (_q, reason) => log({ level: 40, msg: 'openalex semantic skipped', reason }) },
  );
  record.counts.semantic = semantic[0]?.length ?? 0;
  // Query by query, OpenAlex first within each: `mergeWorks` keeps the first record it sees of a
  // paper, and OpenAlex's is the one with a citation count and an open-access status.
  const lists: DiscoveredWork[][] = [
    ...semantic,
    ...queries.flatMap((_, q) => perIndex.map((found) => found[q] ?? [])),
  ];
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
  // 5b. ADR-0046: one targeted query per theme, its real publication density, and a second
  //     search for the thin ones. No model call; OpenAlex only.
  const extra = await deepenThemes({
    themes,
    scored,
    tempIds,
    pool: merged,
    library,
    workingTitle: scope.workingTitle,
    scopeVector: scopeVector ?? [],
    deps,
    record,
    log,
    now,
  });
  scored.push(...extra.works);
  tempIds.push(...extra.tempIds);

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
  // ADR-0052: three groups instead of one list sorted by citations, which favoured old famous
  // papers. Backward: what the student's sources cite, ranked by how many of them cite it — a paper
  // three of your sources rest on is foundational. Forward: recent work citing them. And
  // OpenAlex's related works, as before (with the most-cited citing works, FR-2.8).
  const openalex = deps.openalex as OpenAlexDiscovery & {
    references?: OpenAlexDiscovery['references'];
    recentCitedBy?: OpenAlexDiscovery['recentCitedBy'];
  };
  const references: DiscoveredWork[][] = [];
  const recent: DiscoveredWork[][] = [];
  const related: DiscoveredWork[][] = [];
  for (const source of sources) {
    const id = source.openalexId as string;
    try {
      related.push(await deps.openalex.citedBy(id));
      related.push(await deps.openalex.related(id));
      if (openalex.references) references.push(await openalex.references(id));
      if (openalex.recentCitedBy) recent.push(await openalex.recentCitedBy(id, new Date()));
    } catch (error) {
      log({
        level: 40,
        msg: 'expansion failed for a source',
        openalexId: id,
        error: String(error),
      });
    }
  }
  record.counts.fetched = [...references, ...recent, ...related].reduce((n, l) => n + l.length, 0);
  const library = await libraryKeys(deps.prisma, job.documentId);
  const key = (w: DiscoveredWork) => w.doi ?? w.openalexId ?? w.title.toLowerCase();

  // How many of the student's sources cite each reference.
  const citedTimes = new Map<string, number>();
  for (const list of references) {
    for (const w of new Set(list.map(key))) citedTimes.set(w, (citedTimes.get(w) ?? 0) + 1);
  }
  const taken = new Set<string>();
  const pick = (
    lists: DiscoveredWork[][],
    order: (a: DiscoveredWork, b: DiscoveredWork) => number,
  ) =>
    notInLibrary(mergeWorks(lists), library)
      .filter((w) => !taken.has(key(w)))
      .sort(order)
      .slice(0, SEARCH.expandPerTheme)
      .map((w) => {
        taken.add(key(w));
        return w;
      });
  const groups = [
    {
      theme: SEARCH.expandThemes.references,
      works: pick(
        references,
        (a, b) =>
          (citedTimes.get(key(b)) ?? 0) - (citedTimes.get(key(a)) ?? 0) ||
          (b.citationCount ?? 0) - (a.citationCount ?? 0),
      ),
    },
    {
      theme: SEARCH.expandThemes.recent,
      works: pick(
        recent,
        (a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.citationCount ?? 0) - (a.citationCount ?? 0),
      ),
    },
    {
      theme: SEARCH.expandThemes.related,
      works: pick(related, (a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0)),
    },
  ].filter((g) => g.works.length > 0);
  record.counts.merged = taken.size;
  record.counts.kept = taken.size;
  record.counts.references =
    groups.find((g) => g.theme === SEARCH.expandThemes.references)?.works.length ?? 0;
  record.counts.recent =
    groups.find((g) => g.theme === SEARCH.expandThemes.recent)?.works.length ?? 0;
  const ids = await storeCandidates(
    deps.prisma,
    job,
    groups.flatMap((g) => g.works.map((w) => ({ ...w, theme: g.theme }))),
  );
  return {
    runId: job.runId,
    mode: 'expand',
    candidates: ids.length,
    themes: groups.length,
    counts: record.counts,
  };
}

type ScoredWork = DiscoveredWork & { score: number };

/**
 * ADR-0046 — Rademics Copilot's per-cluster search, built on what this job already has.
 *
 * For every theme but "Other": a query from the thesis title's content words and the theme's own
 * (`themeQuery`, deterministic), and OpenAlex's per-year count for it — the theme's real
 * publication density, and whether it is growing. For up to `SEARCH.fillThemes` thin themes, the
 * same query is searched and the papers that score at least as high against the scope as the
 * weakest one kept are added to that theme. A request that fails costs its theme its density or
 * its extra papers, never the run.
 */
async function deepenThemes(input: {
  themes: Array<{ name: string; candidateIds: string[]; count: number; thin: boolean }>;
  scored: readonly ScoredWork[];
  tempIds: readonly string[];
  pool: readonly DiscoveredWork[];
  library: { dois: Set<string>; titles: Set<string> };
  workingTitle: string;
  scopeVector: number[];
  deps: SearchLiteratureDeps;
  record: SearchRunRecord;
  log: NonNullable<SearchLiteratureDeps['log']>;
  now: () => Date;
}): Promise<{ works: ScoredWork[]; tempIds: string[] }> {
  const { themes, scored, tempIds, deps, record, log, now } = input;
  const openalex = deps.openalex as OpenAlexDiscovery & {
    yearCounts?: OpenAlexDiscovery['yearCounts'];
  };
  const titleOf = new Map(tempIds.map((id, i) => [id, scored[i]?.title ?? '']));
  const named = themes.filter((t) => t.name.toLowerCase() !== 'other');

  const density: Record<string, ThemeDensity> = {};
  const queryOf = new Map<string, string>();
  for (const theme of named) {
    const q = themeQuery(
      input.workingTitle,
      theme.name,
      theme.candidateIds.map((id) => titleOf.get(id) ?? ''),
    );
    queryOf.set(theme.name, q);
    if (typeof openalex.yearCounts !== 'function') continue;
    try {
      density[theme.name] = densityFrom(q, await openalex.yearCounts(q, now()), now());
    } catch (error) {
      log({ level: 40, msg: 'theme density failed', theme: theme.name, q, error: String(error) });
    }
  }
  if (Object.keys(density).length > 0) record.themeDensity = density;
  record.counts.themeQueries = queryOf.size;

  // Thin themes: search again with their own query.
  const floor = scored.length > 0 ? Math.min(...scored.map((w) => w.score)) : 0;
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const seen = new Set<string>();
  for (const w of [...input.pool, ...scored]) {
    if (w.doi) seen.add(`doi:${w.doi}`);
    seen.add(`t:${norm(w.title)}`);
  }
  const isNew = (w: DiscoveredWork) =>
    !(w.doi && (seen.has(`doi:${w.doi}`) || input.library.dois.has(w.doi))) &&
    !seen.has(`t:${norm(w.title)}`) &&
    !input.library.titles.has(norm(w.title));

  const works: ScoredWork[] = [];
  const ids: string[] = [];
  let filled = 0;
  const thin = named.filter((t) => t.thin).slice(0, SEARCH.fillThemes);
  for (const theme of thin) {
    const q = queryOf.get(theme.name);
    if (!q) continue;
    let found: DiscoveredWork[] = [];
    try {
      found = (await deps.openalex.search(q, now())).filter(isNew);
    } catch (error) {
      log({ level: 40, msg: 'theme search failed', theme: theme.name, q, error: String(error) });
      continue;
    }
    if (found.length === 0) continue;
    await deps.assertBudget?.();
    const vectors = await deps.embeddings.embed(
      found.map((w) => `${w.title}. ${w.abstract ?? ''}`.slice(0, 2_000)),
    );
    const kept = found
      .map((w, i) => ({ ...w, score: cosine(input.scopeVector, vectors[i] ?? []) }))
      .filter((w) => w.score >= floor)
      .sort((a, b) => b.score - a.score)
      .slice(0, SEARCH.fillPerTheme);
    for (const w of kept) {
      if (w.doi) seen.add(`doi:${w.doi}`);
      seen.add(`t:${norm(w.title)}`);
      const id = `f${tempIds.length + ids.length + 1}`;
      ids.push(id);
      works.push(w);
      theme.candidateIds.push(id);
    }
    theme.count = theme.candidateIds.length;
    theme.thin = theme.count < 4;
    filled += kept.length;
  }
  record.counts.filled = filled;
  log({ msg: 'themes deepened', runId: record.runId, queries: queryOf.size, filled });
  return { works, tempIds: ids };
}
