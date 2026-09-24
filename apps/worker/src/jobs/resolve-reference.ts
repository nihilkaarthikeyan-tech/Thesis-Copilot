/**
 * `resolve-reference` — PRD FR-2.1 and PHASES 1-W2 task 2.5.
 *
 *   "Crossref `query.bibliographic` (top 3) → pick by normalised similarity ≥ 0.85 on
 *    title/authors/year; fallback OpenAlex search; store `Source` with `cslJson`, `oaStatus`,
 *    `citationCount`, `isPreprint`, retraction check; unresolved → `UNRESOLVED`."
 *
 * One reference string per job, idempotent by `documentId + rawReference`. A reference that
 * matches nothing well enough is left `UNRESOLVED` for the student to fix by hand rather than
 * given a wrong DOI, because a wrong citation in a thesis is worse than a missing one.
 */

import type { PrismaClient } from '@tc/db';
import {
  type ArxivClient,
  type CrossrefClient,
  groundingLevelFor,
  type OpenAlexClient,
  resolveByDoi,
  resolveReference,
  UNRESOLVED,
  type UnpaywallClient,
} from '@tc/retrieval';
import type { ResolveReferenceJob } from '@tc/types';

export type ResolveReferenceDeps = {
  prisma: PrismaClient;
  crossref: CrossrefClient;
  openalex: OpenAlexClient;
  unpaywall: UnpaywallClient;
  /** ADR-0020: the fallback for an arXiv DOI that OpenAlex has not indexed yet. */
  arxiv?: ArxivClient | null;
  /** Enqueues indexing once a source has something to index (FR-2.2, FR-2.4). */
  enqueueIndex: (input: {
    sourceId: string;
    documentId: string;
    userId: string;
    contentKey?: string;
  }) => Promise<unknown>;
  log?: (event: Record<string, unknown>) => void;
};

export type ResolveReferenceResult = {
  sourceId: string | null;
  status: 'RESOLVED' | 'UNRESOLVED';
  doi: string | null;
  via: string | null;
  score: number;
  openAccess: boolean;
};

export async function runResolveReference(
  job: ResolveReferenceJob,
  deps: ResolveReferenceDeps,
): Promise<ResolveReferenceResult> {
  const log = deps.log ?? (() => undefined);

  const source = await deps.prisma.source.findFirst({
    where: { documentId: job.documentId, rawReference: job.rawReference },
    select: { id: true, status: true },
  });
  if (!source) {
    // The student removed it from the library between enqueue and run. Nothing to do.
    return {
      sourceId: null,
      status: 'UNRESOLVED',
      doi: null,
      via: null,
      score: 0,
      openAccess: false,
    };
  }

  const resolver = { crossref: deps.crossref, openalex: deps.openalex, arxiv: deps.arxiv ?? null };

  // A DOI printed in the entry, or typed in by the student on the "Fix this reference" form, is
  // the answer already. Re-running the bibliographic search that failed the first time would only
  // fail again, which is exactly what the manual fix exists to escape.
  let resolved = job.printedDoi ? await resolveByDoi(job.printedDoi, resolver) : { ...UNRESOLVED };

  if (!resolved.via) {
    resolved = await resolveReference(job.rawReference, resolver);
  }

  if (!resolved.via || !resolved.title) {
    await deps.prisma.source.update({
      where: { id: source.id },
      data: { status: 'UNRESOLVED' },
    });
    log({ msg: 'reference unresolved', sourceId: source.id, raw: job.rawReference.slice(0, 80) });
    return {
      sourceId: source.id,
      status: 'UNRESOLVED',
      doi: null,
      via: null,
      score: resolved.score,
      openAccess: false,
    };
  }

  // FR-2.2: an open-access record can be read in full; everything else is abstract-only for now.
  let openAccess = false;
  let oaStatus = resolved.oaStatus;
  if (resolved.doi) {
    try {
      const location = await deps.unpaywall.bestOpenAccess(resolved.doi);
      openAccess = Boolean(location?.pdfUrl);
      oaStatus = location?.oaStatus ?? oaStatus;
    } catch (error) {
      // Best effort: a failed Unpaywall lookup must not lose the resolution.
      log({ msg: 'unpaywall lookup failed', sourceId: source.id, error: String(error) });
    }
  }

  const cslJson: Record<string, unknown> | null = resolved.cslJson
    ? { ...resolved.cslJson, ...(resolved.abstract ? { abstract: resolved.abstract } : {}) }
    : resolved.abstract
      ? { abstract: resolved.abstract }
      : null;

  await deps.prisma.source.update({
    where: { id: source.id },
    data: {
      status: 'RESOLVED',
      ...(resolved.doi ? { doi: resolved.doi } : {}),
      ...(resolved.openalexId ? { openalexId: resolved.openalexId } : {}),
      title: resolved.title,
      authors: resolved.authors as never,
      ...(resolved.year !== null ? { year: resolved.year } : {}),
      ...(resolved.venue ? { venue: resolved.venue } : {}),
      ...(resolved.type ? { type: resolved.type } : {}),
      // The abstract is stored as plain text on the CSL record so `index-source` can chunk it
      // without a second round trip. Crossref ships it as JATS XML, which no reader wants.
      ...(cslJson ? { cslJson: cslJson as never } : {}),
      ...(oaStatus ? { oaStatus } : {}),
      ...(resolved.citationCount !== null ? { citationCount: resolved.citationCount } : {}),
      isPreprint: resolved.isPreprint,
      isRetracted: resolved.isRetracted,
      // Full text is only claimed once it has actually been fetched, by `index-source`; and
      // ABSTRACT only when there really is an abstract, not merely because a match was found.
      groundingLevel: groundingLevelFor(false, Boolean(resolved.abstract)),
    },
  });

  log({
    msg: 'reference resolved',
    sourceId: source.id,
    via: resolved.via,
    doi: resolved.doi,
    score: Number(resolved.score.toFixed(3)),
    retracted: resolved.isRetracted,
    hasAbstract: Boolean(resolved.abstract),
  });

  await deps.enqueueIndex({
    sourceId: source.id,
    documentId: job.documentId,
    userId: job.userId,
    // The DOI decides what `index-source` will fetch, so it decides whether this is the same work.
    ...(resolved.doi ? { contentKey: resolved.doi } : {}),
  });

  return {
    sourceId: source.id,
    status: 'RESOLVED',
    doi: resolved.doi,
    via: resolved.via,
    score: resolved.score,
    openAccess,
  };
}

/**
 * True once BullMQ will not retry this job again. BullMQ counts attempts from zero while it is
 * working and increments before emitting `failed`, so the last failure has `attemptsMade` equal
 * to the configured budget.
 */
export function isRetryExhausted(attemptsMade: number, attempts: number | undefined): boolean {
  return attemptsMade >= (attempts ?? 1);
}

/**
 * Last-resort status write for a resolve job that never completed — a Crossref outage, a malformed
 * request, anything that survived all three attempts. Without this the source sits at `PENDING`
 * for good and the library shows "Looking it up…" forever, with no way for the student to reach
 * the manual fix form.
 *
 * Scoped to rows still `PENDING`, so it can never overwrite a resolution a later manual fix has
 * already produced.
 */
export async function markUnresolvedAfterRetries(
  prisma: PrismaClient,
  data: ResolveReferenceJob,
  log: (event: Record<string, unknown>) => void = () => undefined,
): Promise<number> {
  try {
    const { count } = await prisma.source.updateMany({
      where: { documentId: data.documentId, rawReference: data.rawReference, status: 'PENDING' },
      data: { status: 'UNRESOLVED' },
    });
    if (count > 0) {
      log({
        msg: 'reference left unresolved after retries',
        documentId: data.documentId,
        raw: data.rawReference.slice(0, 80),
      });
    }
    return count;
  } catch (error) {
    log({ level: 50, msg: 'could not mark unresolved', error: String(error) });
    return 0;
  }
}
