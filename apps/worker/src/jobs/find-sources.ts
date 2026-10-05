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
import type { PrismaClient } from '@tc/db';
import { cosine, type DiscoveredWork, mergeWorks, searchWithinBudget } from '@tc/retrieval';
import type { FindSourcesJob } from '@tc/types';

type Searcher = {
  search(query: string, now?: Date, signal?: AbortSignal): Promise<DiscoveredWork[]>;
  /** ADR-0050: OpenAlex only; a fake without it simply contributes nothing. */
  semanticSearch?(text: string, now?: Date, signal?: AbortSignal): Promise<DiscoveredWork[]>;
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
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
};

export type FindSourcesResult = {
  status: 'added' | 'none-relevant' | 'capped' | 'gone';
  added: number;
  searched: number;
};

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

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

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
      select: { title: true, memory: { select: { scope: true } } },
    }),
  ]);
  if (!user || !chapter || !document) return { status: 'gone', added: 0, searched: 0 };

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
  const indexes = [
    { name: 'openalex', client: deps.openalex },
    { name: 'semanticscholar', client: deps.semanticScholar },
    { name: 'pubmed', client: deps.pubmed },
    { name: 'arxiv', client: deps.arxiv },
  ].flatMap(({ name, client }) => (client ? [{ name, client }] : []));
  // Two short searches, not one long one: an index matches a long query against every word and
  // returns almost nothing (one usable paper for an EDM thesis, 2026-09-30). The thesis title
  // finds the field; the section's own words find the part being written. Every result is still
  // scored against the whole of `query` below, so the short searches cost no relevance.
  const searches = [thesis, job.query.slice(0, 300)].filter((q) => q.trim().length > 0);
  // ADR-0050: a time budget per index, and one semantic search with the whole query.
  const lists = (
    await Promise.all([
      (async () => {
        const began = Date.now();
        const found = await searchWithinBudget(
          [job.query.slice(0, 2_000)],
          (q, signal) =>
            deps.openalex.semanticSearch
              ? deps.openalex.semanticSearch(`${thesis}. ${q}`, now, signal)
              : Promise.resolve([]),
          {
            ...SEARCH_BUDGET,
            onSkip: (_q, reason) => log({ level: 40, msg: 'openalex semantic skipped', reason }),
          },
        );
        log({
          msg: 'index searched',
          index: 'openalex-semantic',
          ms: Date.now() - began,
          works: found.flat().length,
        });
        return found;
      })(),
      ...indexes.map(async ({ name, client }) => {
        const began = Date.now();
        const found = await searchWithinBudget(
          searches,
          (q, signal) => client.search(q, now, signal),
          {
            ...SEARCH_BUDGET,
            onSkip: (_q, reason) => log({ level: 40, msg: `${name} search skipped`, reason }),
          },
        );
        log({
          msg: 'index searched',
          index: name,
          ms: Date.now() - began,
          works: found.flat().length,
        });
        return found;
      }),
    ])
  ).flat();

  // 2. Not already in the library, and with an abstract: a paper with nothing to read cannot be
  // cited, and adding it would only lengthen the library.
  const library = await deps.prisma.source.findMany({
    where: { documentId: job.documentId },
    select: { doi: true, title: true },
  });
  const dois = new Set(library.map((s) => s.doi?.toLowerCase()).filter(Boolean));
  const titles = new Set(library.map((s) => (s.title ? norm(s.title) : '')).filter(Boolean));
  const fresh = mergeWorks(lists).filter(
    (w) =>
      w.abstract &&
      w.abstract.trim().length > 200 &&
      !(w.doi && dois.has(w.doi.toLowerCase())) &&
      !titles.has(norm(w.title)),
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
      .filter((w) => w.score >= AUTO_SOURCES.addCosine)
      .sort((a, b) => b.score - a.score)
      .slice(0, AUTO_SOURCES.perRun);
  }

  // 4. Into the library, then the path every picked paper takes: resolve, then read.
  for (const w of added) {
    const raw = referenceLine(w);
    await deps.prisma.source.create({
      data: {
        documentId: job.documentId,
        status: 'PENDING',
        rawReference: raw,
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
    });
    await deps.enqueueResolve({
      documentId: job.documentId,
      userId: job.userId,
      rawReference: raw,
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
        added: added.map((w) => ({
          title: w.title,
          doi: w.doi,
          score: Number(w.score.toFixed(3)),
        })),
      },
    },
  });
  log({ msg: 'find-sources done', added: added.length, searched: fresh.length });
  return {
    status: added.length > 0 ? 'added' : 'none-relevant',
    added: added.length,
    searched: fresh.length,
  };
}

/**
 * Whether to start a search for this chapter, and starts it if so (ADR-0037). The same three
 * checks the API makes for autocomplete: the site switch is on, the student has not turned it
 * off in settings, and the month's searches are not used up. The cooldown is the job id.
 */
export async function startFindSources(
  deps: {
    prisma: PrismaClient;
    enqueue: (job: FindSourcesJob, jobId: string) => Promise<unknown>;
  },
  job: FindSourcesJob,
  now: Date = new Date(),
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
  await deps.enqueue(job, autoSourcesJobKey(job.chapterId, now));
  return true;
}
