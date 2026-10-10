/**
 * `find-sources` — ADR-0037 (2026-09-30).
 *
 * A reviewer compared a Literature Review written with Jenni against ours: Jenni's cited every
 * sentence, ours cited nothing, because it may only cite papers in the student's library and the
 * library had nothing on the section. Jenni searches the literature on its own. This does too,
 * with the difference that matters: every paper it adds is a real record from an index, read and
 * embedded before anything cites it, so a citation here always points at a paper that exists.
 *
 * What it does, with no LLM call:
 *   1. search OpenAlex (and Semantic Scholar, PubMed, arXiv where configured) for what the student
 *      is writing about;
 *   2. keep only papers with an abstract, not already in the library, whose abstract is close to
 *      the thesis title and the query (cosine at least `AUTO_SOURCES.addCosine`, measured);
 *   3. add the best `AUTO_SOURCES.perRun` to the library, marked `autoAddedAt`, and hand them to
 *      `resolve-reference` → `index-source`, the same path a paper the student picks takes.
 *
 * Bounded by `AUTO_SOURCES.monthly` searches per plan (counted from the `SOURCES_FOUND` log, so
 * it survives restarts) and by the site-wide budget. The embedding spend is logged as `EMBED`, so
 * the per-student ₹100 ceiling sees it.
 */

import type { EmbeddingProvider } from '@tc/ai';
import {
  AUTO_SOURCES,
  AUTO_SOURCES_FLAG,
  autoSourcesJobKey,
  monthlyAutoSearches,
} from '@tc/config';
import {
  addSourcesOnce,
  normaliseTitle,
  type PrismaClient,
  removeStrandedDuplicateSources,
} from '@tc/db';
import {
  cosine,
  credibility,
  type DiscoveredWork,
  mergeWorks,
  nextMidnightUtc,
  scholarlyHealth,
  searchWithinBudget,
  type WorkFilters,
} from '@tc/retrieval';
import { type FindSourcesJob, listedInFilter, meetsSourcePrefs, readSourcePrefs } from '@tc/types';

type Searcher = {
  search(
    query: string,
    now?: Date,
    signal?: AbortSignal,
    filters?: WorkFilters,
  ): Promise<DiscoveredWork[]>;
  /** ADR-0050: OpenAlex only; a fake without it simply contributes nothing. */
  semanticSearch?(
    text: string,
    now?: Date,
    signal?: AbortSignal,
    filters?: WorkFilters,
  ): Promise<DiscoveredWork[]>;
};

export type FindSourcesDeps = {
  prisma: PrismaClient;
  embeddings: EmbeddingProvider;
  openalex: Searcher;
  semanticScholar?: Searcher | null;
  pubmed?: Searcher | null;
  arxiv?: Searcher | null;
  assertBudget?: () => Promise<void>;
  enqueueResolve: (input: {
    documentId: string;
    userId: string;
    rawReference: string;
    printedDoi?: string;
  }) => Promise<unknown>;
  logEmbed?: (call: {
    userId: string;
    documentId: string;
    tokens: number;
    latencyMs: number;
    ok: boolean;
    error?: string;
  }) => Promise<void>;
  /**
   * ADR-0149: schedules this search again, `delayMs` from now, under `jobId`. A degraded run
   * calls it; without it a degraded run simply is not repeated.
   */
  enqueueRetry?: (job: FindSourcesJob, jobId: string, delayMs: number) => Promise<unknown>;
  /** ADR-0149: when OpenAlex is expected to answer again (ms), if anything said. */
  openalexBackAt?: () => Promise<number | null>;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
};

export type FindSourcesResult = {
  /**
   * `off`: the student turned web search off for this thesis (ADR-0087). `degraded`: OpenAlex
   * did not answer (ADR-0149), so at most `DEGRADED_SOURCES.perRun` papers on a higher bar
   * were added and the search is tried again later.
   */
  status: 'added' | 'none-relevant' | 'capped' | 'gone' | 'off' | 'degraded';
  added: number;
  searched: number;
  /** ADR-0149: the search is repeated after this many ms; null when it is not. */
  retryInMs?: number | null;
};

/**
 * ADR-0149: what a search does when OpenAlex, the one index that covers every field, did not
 * answer. The other indexes still answer, but for an engineering or humanities thesis what they
 * find is mostly off topic, and an automatic library fills with it. So: a higher bar, fewer
 * papers, and the search again once OpenAlex should be back.
 */
export const DEGRADED_SOURCES = {
  /** Added to `AUTO_SOURCES.addCosine`. */
  extraCosine: 0.05,
  perRun: 2,
  /** Tried again at most this many times. */
  maxRetries: 2,
  /** When nothing said when OpenAlex is back. */
  retryMs: 30 * 60_000,
  minRetryMs: 5 * 60_000,
  maxRetryMs: 12 * 60 * 60_000,
} as const;

/**
 * The retry's BullMQ id: keyed on what it will read (the chapter and the query, by digest) and
 * the attempt, never on what it writes. No `:` (BullMQ refuses it).
 */
export function degradedRetryJobId(job: FindSourcesJob, attempt: number): string {
  let h = 0;
  for (const ch of job.query) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `find-sources-retry-${job.chapterId}-${(h >>> 0).toString(36)}-${attempt}`;
}

/** When OpenAlex should answer again, from the shared memory of its refusals. */
export async function openalexBackAt(now: number = Date.now()): Promise<number | null> {
  const until = await scholarlyHealth.refusedUntil('openalex');
  if (until !== null) return until;
  const state = await scholarlyHealth.state('openalex');
  return state.keyedExhaustedUntil !== null && state.keyedExhaustedUntil > now
    ? Math.min(state.keyedExhaustedUntil, nextMidnightUtc(now))
    : null;
}

/** Searches this user has had this calendar month (UTC), from the log. */
export async function autoSearchesThisMonth(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return prisma.auditEvent.count({
    where: { userId, kind: 'SOURCES_FOUND', createdAt: { gte: from } },
  });
}

/**
 * ADR-0070: this search fills a library someone is waiting on, often a brand-new one, so it
 * finishes with what the indexes have returned in a few seconds rather than waiting out the
 * slowest. The student-run search (ADR-0050) keeps the longer budget.
 */
export const SEARCH_BUDGET = { perCallMs: 8_000, perIndexMs: 12_000 } as const;

/** The line a Source carries as `rawReference`, the same shape a search pick gets. */
export function referenceLine(w: {
  title: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
}): string {
  return [
    w.year ? `(${w.year}).` : '',
    `${w.title}.`,
    w.venue ? `${w.venue}.` : '',
    w.doi ? `https://doi.org/${w.doi}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function runFindSources(
  job: FindSourcesJob,
  deps: FindSourcesDeps,
): Promise<FindSourcesResult> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now?.() ?? new Date();

  const [user, chapter, document] = await Promise.all([
    deps.prisma.user.findUnique({ where: { id: job.userId }, select: { plan: true } }),
    deps.prisma.chapter.findFirst({
      where: { id: job.chapterId, documentId: job.documentId },
      select: { id: true, title: true },
    }),
    deps.prisma.document.findUnique({
      where: { id: job.documentId },
      select: { title: true, meta: true, memory: { select: { scope: true } } },
    }),
  ]);
  if (!user || !chapter || !document) return { status: 'gone', added: 0, searched: 0 };
  // ADR-0139: a copy an earlier race left PENDING for good ("Looking it up…") goes, once its
  // resolved twin is there. Idempotent and cheap; it never fails the search.
  await removeStrandedDuplicateSources(deps.prisma, { documentId: job.documentId }).then(
    (removed) => {
      if (removed > 0) log({ msg: 'stranded duplicate sources removed', removed });
    },
    (error: unknown) =>
      log({ level: 40, msg: 'stranded duplicate cleanup failed', error: String(error) }),
  );
  // ADR-0087: the student's choices when starting the thesis. Web search off means no papers are
  // found for them at all; the rest narrow what is found.
  const prefs = readSourcePrefs(document.meta);
  if (!prefs.webSearch) return { status: 'off', added: 0, searched: 0 };
  const filters: WorkFilters = {
    yearFrom: prefs.yearFrom,
    yearTo: prefs.yearTo,
    listedIn: listedInFilter(prefs),
    preprints: prefs.preprints,
  };
  const perRun = job.initial ? AUTO_SOURCES.initialPerRun : AUTO_SOURCES.perRun;

  // The thesis's own title leads the query. Without it, "Electrode wear remains a major cost"
  // found battery and wastewater electrodes for an EDM thesis (2026-09-30).
  const scope = (document.memory?.scope ?? {}) as { workingTitle?: unknown };
  const thesis =
    typeof scope.workingTitle === 'string' && scope.workingTitle.trim()
      ? scope.workingTitle.trim()
      : document.title;
  const query = `${thesis}. ${job.query}`.slice(0, 600);

  if (
    (await autoSearchesThisMonth(deps.prisma, job.userId, now)) >= monthlyAutoSearches(user.plan)
  ) {
    return { status: 'capped', added: 0, searched: 0 };
  }
  await deps.assertBudget?.();

  // 1. Search every configured index. One index failing loses its results, never the run.
  // Only OpenAlex can say which journal lists a paper's venue is on, so with an indexing filter
  // the other indexes are not asked: everything they found would fail it.
  const onlyOpenAlex = (filters.listedIn ?? []).length > 0;
  const indexes = [
    { name: 'openalex', client: deps.openalex },
    { name: 'semanticscholar', client: onlyOpenAlex ? null : deps.semanticScholar },
    { name: 'pubmed', client: onlyOpenAlex ? null : deps.pubmed },
    { name: 'arxiv', client: onlyOpenAlex || !prefs.preprints ? null : deps.arxiv },
  ].flatMap(({ name, client }) => (client ? [{ name, client }] : []));
  // Two short searches, not one long one: an index matches a long query against every word and
  // returns almost nothing (one usable paper for an EDM thesis, 2026-09-30). The thesis title
  // finds the field; the section's own words find the part being written. Every result is still
  // scored against the whole of `query` below, so the short searches cost no relevance.
  const searches = [thesis, job.query.slice(0, 300)].filter((q) => q.trim().length > 0);
  // ADR-0149: whether OpenAlex answered at all. `searchWithinBudget` reports each failed query
  // through `onSkip`; OpenAlex is down for this run when it returned nothing and failed at least
  // once.
  let openalexSkips = 0;
  // ADR-0050: a time budget per index, and one semantic search with the whole query.
  const perIndex = await Promise.all([
    (async () => {
      const began = Date.now();
      const found = await searchWithinBudget(
        [job.query.slice(0, 2_000)],
        (q, signal) =>
          deps.openalex.semanticSearch
            ? deps.openalex.semanticSearch(`${thesis}. ${q}`, now, signal, filters)
            : Promise.resolve([]),
        {
          ...SEARCH_BUDGET,
          onSkip: (_q, reason) => {
            openalexSkips += 1;
            log({ level: 40, msg: 'openalex semantic skipped', reason });
          },
        },
      );
      log({
        msg: 'index searched',
        index: 'openalex-semantic',
        ms: Date.now() - began,
        works: found.flat().length,
      });
      return { name: 'openalex', found };
    })(),
    ...indexes.map(async ({ name, client }) => {
      const began = Date.now();
      const found = await searchWithinBudget(
        searches,
        (q, signal) => client.search(q, now, signal, filters),
        {
          ...SEARCH_BUDGET,
          onSkip: (_q, reason) => {
            if (name === 'openalex') openalexSkips += 1;
            log({ level: 40, msg: `${name} search skipped`, reason });
          },
        },
      );
      log({
        msg: 'index searched',
        index: name,
        ms: Date.now() - began,
        works: found.flat().length,
      });
      return { name, found };
    }),
  ]);
  const lists = perIndex.flatMap((entry) => entry.found);
  const openalexWorks = perIndex
    .filter((entry) => entry.name === 'openalex')
    .reduce((n, entry) => n + entry.found.flat().length, 0);
  const degraded = openalexWorks === 0 && openalexSkips > 0;

  // 2. Not already in the library, and with an abstract: a paper with nothing to read cannot be
  // cited, and adding it would only lengthen the library.
  const library = await deps.prisma.source.findMany({
    where: { documentId: job.documentId },
    select: { doi: true, title: true },
  });
  const dois = new Set(library.map((s) => s.doi?.toLowerCase()).filter(Boolean));
  const titles = new Set(
    library.map((s) => (s.title ? normaliseTitle(s.title) : '')).filter(Boolean),
  );
  const fresh = mergeWorks(lists).filter(
    (w) =>
      meetsSourcePrefs(w, prefs) &&
      w.abstract &&
      w.abstract.trim().length > 200 &&
      !(w.doi && dois.has(w.doi.toLowerCase())) &&
      !titles.has(normaliseTitle(w.title)),
  );

  // 3. On topic, by the same measure retrieval uses. No LLM.
  let added: Array<DiscoveredWork & { score: number }> = [];
  if (fresh.length > 0) {
    const startedAt = Date.now();
    const texts = [query, ...fresh.map((w) => `${w.title}. ${w.abstract ?? ''}`.slice(0, 2_000))];
    let vectors: number[][] = [];
    let tokens = 0;
    for (let i = 0; i < texts.length; i += 64) {
      const batch = await deps.embeddings.embedWithUsage(texts.slice(i, i + 64));
      vectors = vectors.concat(batch.vectors);
      tokens += batch.tokens;
    }
    log({ msg: 'candidates embedded', texts: texts.length, ms: Date.now() - startedAt });
    await deps.logEmbed?.({
      userId: job.userId,
      documentId: job.documentId,
      tokens,
      latencyMs: Date.now() - startedAt,
      ok: true,
    });
    const [queryVector, ...workVectors] = vectors;
    added = fresh
      .map((w, i) => ({ ...w, score: cosine(queryVector ?? [], workVectors[i] ?? []) }))
      .filter(
        (w) => w.score >= AUTO_SOURCES.addCosine + (degraded ? DEGRADED_SOURCES.extraCosine : 0),
      )
      // ADR-0076: among papers on topic, the better-established first. Relevance (the filter
      // above) still decides what is eligible; standing only orders the few that are.
      .sort((a, b) => b.score + credibility(b, now) - (a.score + credibility(a, now)))
      .slice(0, degraded ? Math.min(perRun, DEGRADED_SOURCES.perRun) : perRun);
  }

  // 4. Into the library, then the path every picked paper takes: resolve, then read.
  // ADR-0139: the library was read above, seconds ago, and another run (or a student's add) may
  // have added the same papers since. The insert checks again under a per-thesis lock, so two runs
  // at once add each paper once, and only the rows this run created are resolved by it.
  const chosen = added;
  const rows = await addSourcesOnce(
    deps.prisma,
    job.documentId,
    chosen.map((w) => ({ ...w, rawReference: referenceLine(w) })),
    (tx, w) =>
      tx.source.create({
        data: {
          documentId: job.documentId,
          status: 'PENDING',
          rawReference: w.rawReference,
          doi: w.doi,
          openalexId: w.openalexId,
          title: w.title,
          year: w.year,
          venue: w.venue,
          citationCount: w.citationCount,
          isPreprint: w.isPreprint,
          oaStatus: w.oaStatus,
          subTheme: chapter.title,
          autoAddedAt: now,
          ...(w.abstract ? { cslJson: { abstract: w.abstract } } : {}),
        },
        select: { id: true },
      }),
  );
  added = rows.filter((row) => row.created).map((row) => row.item);
  if (added.length < chosen.length) {
    log({
      msg: 'find-sources skipped papers added meanwhile',
      skipped: chosen.length - added.length,
    });
  }
  for (const w of added) {
    await deps.enqueueResolve({
      documentId: job.documentId,
      userId: job.userId,
      rawReference: referenceLine(w),
      ...(w.doi ? { printedDoi: w.doi } : {}),
    });
  }

  // Logged whether or not anything was added: a search that found nothing still counts against
  // the month, or a topic no index covers would search again on every keystroke's request.
  await deps.prisma.auditEvent.create({
    data: {
      kind: 'SOURCES_FOUND',
      userId: job.userId,
      documentId: job.documentId,
      detail: {
        chapterId: job.chapterId,
        query: query.slice(0, 300),
        searched: fresh.length,
        ...(degraded ? { degraded: true, retry: job.retry ?? 0 } : {}),
        added: added.map((w) => ({
          title: w.title,
          doi: w.doi,
          score: Number(w.score.toFixed(3)),
        })),
      },
    },
  });
  log({ msg: 'find-sources done', added: added.length, searched: fresh.length, degraded });
  if (!degraded) {
    return {
      status: added.length > 0 ? 'added' : 'none-relevant',
      added: added.length,
      searched: fresh.length,
    };
  }

  // ADR-0149: again once OpenAlex should be back, a bounded number of times.
  const attempt = (job.retry ?? 0) + 1;
  let retryInMs: number | null = null;
  if (deps.enqueueRetry && attempt <= DEGRADED_SOURCES.maxRetries) {
    const backAt = await (deps.openalexBackAt ?? (() => openalexBackAt(now.getTime())))();
    const wanted = backAt !== null ? backAt - now.getTime() + 60_000 : DEGRADED_SOURCES.retryMs;
    retryInMs = Math.min(
      DEGRADED_SOURCES.maxRetryMs,
      Math.max(DEGRADED_SOURCES.minRetryMs, wanted),
    );
    await deps.enqueueRetry(
      { ...job, retry: attempt },
      degradedRetryJobId(job, attempt),
      retryInMs,
    );
    log({ level: 40, msg: 'find-sources degraded, retry scheduled', attempt, retryInMs });
  }
  return { status: 'degraded', added: added.length, searched: fresh.length, retryInMs };
}

/**
 * Whether to start a search for this chapter, and starts it if so (ADR-0037). The same three
 * checks the API makes for autocomplete: the site switch is on, the student has not turned it
 * off in settings, and the month's searches are not used up. The cooldown is the job id: one per
 * chapter per window, or — given `section` — one per section of it per window, as the API's own
 * searches have been since ADR-0087 (ADR-0124: each theme of a literature review searches for
 * itself; without it every theme after the first was the same BullMQ job and searched nothing).
 */
export async function startFindSources(
  deps: {
    prisma: PrismaClient;
    enqueue: (job: FindSourcesJob, jobId: string) => Promise<unknown>;
  },
  job: FindSourcesJob,
  now: Date = new Date(),
  section?: string | null,
): Promise<boolean> {
  const [flag, user] = await Promise.all([
    deps.prisma.featureFlag.findUnique({
      where: { key: AUTO_SOURCES_FLAG },
      select: { enabled: true },
    }),
    deps.prisma.user.findUnique({
      where: { id: job.userId },
      select: { plan: true, settings: true },
    }),
  ]);
  if (!flag?.enabled || !user) return false;
  if ((user.settings as { autoSources?: unknown } | null)?.autoSources === false) return false;
  if (
    (await autoSearchesThisMonth(deps.prisma, job.userId, now)) >= monthlyAutoSearches(user.plan)
  ) {
    return false;
  }
  await deps.enqueue(job, autoSourcesJobKey(job.chapterId, now, section));
  return true;
}

/**
 * ADR-0076: after a search started for a draft, wait until it is done and the papers it added can
 * be cited (abstract-first indexing, ADR-0070, makes that a few seconds), or the time is up.
 * Resolves with how many added papers are citable.
 *
 * "Done" is the search's own `SOURCES_FOUND` log row, written whether or not anything was added.
 * A search for this thesis in the last cooldown window counts too: a repeat request inside it is
 * the same BullMQ job (ADR-0037), so no new row would ever come.
 */
export async function waitForNewSources(
  prisma: PrismaClient,
  input: { documentId: string; since: Date },
  options: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 35_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const windowStart = new Date(input.since.getTime() - AUTO_SOURCES.cooldownMinutes * 60_000);
  const deadline = Date.now() + timeoutMs;
  let ready = 0;
  for (;;) {
    const [searched, added] = await Promise.all([
      prisma.auditEvent.findFirst({
        where: {
          kind: 'SOURCES_FOUND',
          documentId: input.documentId,
          createdAt: { gte: windowStart },
        },
        select: { id: true },
      }),
      prisma.source.findMany({
        where: { documentId: input.documentId, autoAddedAt: { gte: windowStart } },
        select: { _count: { select: { chunks: true } } },
      }),
    ]);
    ready = added.filter((source) => source._count.chunks > 0).length;
    if (searched && ready === added.length) return ready;
    if (Date.now() >= deadline) return ready;
    await sleep(intervalMs);
  }
}
