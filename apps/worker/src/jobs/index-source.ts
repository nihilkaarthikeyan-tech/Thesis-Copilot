/**
 * `index-source` — PRD FR-2.2, FR-2.4 and PHASES 1-W2 tasks 2.6 and 2.7.
 *
 *   "Unpaywall `best_oa_location.pdf_url` → download → object storage → `groundingLevel:
 *    FULL_TEXT`; … else abstract only → `ABSTRACT`."
 *   "Section-aware chunker: ~350 tokens, 15% overlap … embed via `packages/ai` in batches of 64;
 *    write `SourceChunk`."
 *
 * The grounding level this job writes is a promise to the student about what the AI may quote from
 * a source, so it is only ever raised on evidence: FULL_TEXT once a PDF has actually been fetched
 * and read, ABSTRACT once an abstract has actually been chunked, NONE otherwise.
 */

import type { EmbeddingProvider } from '@tc/ai';
import type { PrismaClient } from '@tc/db';
import {
  batched,
  type CoreClient,
  chunkText,
  type EuropePmcClient,
  type ExtractedDocument,
  FIRST_PAGE_CHARS,
  type FullTextFailure,
  fetchOpenAccessPdf,
  groundingLevelFor,
  type ResolvedSource,
  readableFullTextReason,
  readFirstPage,
  replaceSourceChunks,
  type UnpaywallClient,
} from '@tc/retrieval';
import type { IndexSourceJob } from '@tc/types';

/** PHASES 2.7: "embed via `packages/ai` in batches of 64". */
export const EMBED_BATCH = 64;

export type IndexSourceDeps = {
  prisma: PrismaClient;
  embeddings: EmbeddingProvider;
  unpaywall: UnpaywallClient;
  /** FR-2.2's fallback, asked only after Unpaywall failed. Null without `CORE_API_KEY` (§13.3). */
  core?: CoreClient | null;
  /**
   * ADR-0054: the full text as JATS when no open-access PDF could be read, for papers in Europe
   * PMC's open-access subset. Keyless; null or absent turns the step off.
   */
  europePmc?: EuropePmcClient | null;
  /** Reads a PDF already in object storage — a student upload, or one fetched by an earlier run. */
  getObject: (key: string) => Promise<Buffer>;
  /** Writes a fetched open-access PDF to object storage. */
  putObject: (key: string, body: Buffer) => Promise<unknown>;
  /** PDF bytes to text with page and section spans; the same extractor the seed papers use. */
  extract: (bytes: Buffer) => Promise<ExtractedDocument>;
  log?: (event: Record<string, unknown>) => void;
  /**
   * Records one EMBED call row for the whole source (2026-09-25): the tokens Voyage billed, so
   * the per-user ceiling (§11) and the cost alerts (§14) count embedding like every other spend.
   */
  logEmbed?: (call: EmbedCall) => Promise<void>;
  /** Throws when the site's monthly AI budget is reached (2026-09-25): nothing is embedded. */
  assertBudget?: () => Promise<void>;
  /** R20 (ADR-0107): the record a DOI printed on an uploaded PDF's first page names. */
  resolveDoi?: (doi: string, signal?: AbortSignal) => Promise<ResolvedSource>;
};

export type EmbedCall = {
  userId: string;
  documentId: string;
  tokens: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
};

export type IndexSourceResult = {
  sourceId: string;
  groundingLevel: 'NONE' | 'ABSTRACT' | 'FULL_TEXT';
  chunks: number;
  /** Where the indexed text came from, so the log says what was actually read. */
  from: 'stored-pdf' | 'open-access-pdf' | 'open-access-xml' | 'abstract' | 'nothing';
  /** Which service located an open-access PDF, when one was fetched. */
  via?: 'unpaywall' | 'core' | 'europepmc' | 'arxiv';
  fullTextFailure?: FullTextFailure;
};

/** Where a fetched open-access PDF lives. Keyed by source so a re-run overwrites rather than piles up. */
export function openAccessKey(documentId: string, sourceId: string): string {
  return `sources/${documentId}/${sourceId}.pdf`;
}

export async function runIndexSource(
  job: IndexSourceJob,
  deps: IndexSourceDeps,
): Promise<IndexSourceResult> {
  const log = deps.log ?? (() => undefined);

  const source = await deps.prisma.source.findFirst({
    where: { id: job.sourceId, documentId: job.documentId },
    select: {
      id: true,
      documentId: true,
      doi: true,
      title: true,
      fileKey: true,
      cslJson: true,
      groundingLevel: true,
      // R20 (ADR-0107): an upload nobody has identified yet.
      status: true,
      rawReference: true,
      authors: true,
    },
  });
  if (!source) {
    // Removed from the library between enqueue and run.
    return { sourceId: job.sourceId, groundingLevel: 'NONE', chunks: 0, from: 'nothing' };
  }

  let text: string | null = null;
  let pages: Array<{ page: number; start: number; end: number }> | undefined;
  let sections: Array<{ section: string; start: number; end: number }> | undefined;
  let from: IndexSourceResult['from'] = 'nothing';
  let fullTextFailure: FullTextFailure | undefined;
  let via: 'unpaywall' | 'core' | 'europepmc' | 'arxiv' | undefined;
  let fileKey = source.fileKey;

  // 1. A PDF we already hold — the student's own upload (FR-2.3), or one fetched by an earlier run.
  if (fileKey) {
    try {
      const extracted = await deps.extract(await deps.getObject(fileKey));
      text = extracted.text;
      pages = [...extracted.pages];
      sections = [...extracted.sections];
      from = 'stored-pdf';
    } catch (error) {
      log({ msg: 'stored pdf could not be read', sourceId: source.id, error: String(error) });
    }
  }

  // R20 (ADR-0107): an uploaded PDF arrives titled by its file name, with no reference to resolve.
  // Its first page says what it is: the printed DOI's record, else its title, authors and abstract.
  if (
    source.status === 'PENDING' &&
    !source.rawReference &&
    !source.doi &&
    source.authors === null
  ) {
    await identifyUpload(source.id, text, pages, deps, log);
  }

  // Embeds and stores a set of chunks, replacing whatever the source had. The one place this job
  // spends embedding tokens, so the budget check and the EMBED log row cannot be skipped.
  const store = async (chunks: ReturnType<typeof chunkText>): Promise<number> => {
    await deps.assertBudget?.();
    const vectors: number[][] = [];
    let tokens = 0;
    const embedStarted = Date.now();
    try {
      for (const batch of batched(chunks, EMBED_BATCH)) {
        const counted = await deps.embeddings.embedWithUsage(batch.map((chunk) => chunk.text));
        vectors.push(...counted.vectors);
        tokens += counted.tokens;
      }
    } catch (error) {
      await deps.logEmbed?.({
        userId: job.userId,
        documentId: job.documentId,
        tokens,
        latencyMs: Date.now() - embedStarted,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await deps.logEmbed?.({
      userId: job.userId,
      documentId: job.documentId,
      tokens,
      latencyMs: Date.now() - embedStarted,
      ok: true,
    });
    if (vectors.length !== chunks.length) {
      throw new Error(`embedding count ${vectors.length} does not match ${chunks.length} chunks`);
    }
    return replaceSourceChunks(
      deps.prisma as unknown as Parameters<typeof replaceSourceChunks>[0],
      source.id,
      chunks.map((chunk, index) => ({
        sourceId: source.id,
        ordinal: chunk.ordinal,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        page: chunk.page,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        section: chunk.section,
        embedding: vectors[index] as number[],
      })),
    );
  };

  // ADR-0070: abstract first. Finding and reading an open-access copy can take a minute (three
  // services, each with its own time limit); the abstract is already here. A paper nothing has
  // been read from yet is made citable from its abstract now, and the full text, if one is
  // found, replaces it below. Costs one abstract's embedding (~300 tokens) a second time at most.
  let abstractFirst: { chunks: number } | null = null;
  const earlyAbstract = abstractOf(source.cslJson);
  // "Nothing read yet" is no chunks, not the badge: `resolve-reference` sets ABSTRACT as soon as
  // it finds an abstract, before anything is embedded.
  if (
    !text &&
    source.doi &&
    earlyAbstract &&
    (await deps.prisma.sourceChunk.count({ where: { sourceId: source.id } })) === 0
  ) {
    const written = await store(
      chunkText({
        text: earlyAbstract,
        sections: [{ section: 'Abstract', start: 0, end: earlyAbstract.length }],
      }),
    );
    await deps.prisma.source.update({
      where: { id: source.id },
      data: { groundingLevel: 'ABSTRACT' },
    });
    abstractFirst = { chunks: written };
    log({ msg: 'abstract indexed first', sourceId: source.id, chunks: written });
  }

  // 2. Otherwise ask Unpaywall for an open-access copy and fetch it.
  if (!text && source.doi) {
    const outcome = await fetchFromOpenAccess(source.doi, deps, log, source.id);
    if (outcome.ok) {
      try {
        const extracted = await deps.extract(outcome.bytes);
        if (extracted.text.trim().length > 0) {
          fileKey = openAccessKey(source.documentId, source.id);
          await deps.putObject(fileKey, outcome.bytes);
          text = extracted.text;
          pages = [...extracted.pages];
          sections = [...extracted.sections];
          from = 'open-access-pdf';
          via = outcome.via;
        } else {
          // A scanned PDF with no text layer grounds nothing, so it is not stored or claimed.
          fullTextFailure = 'not-a-pdf';
        }
      } catch (error) {
        fullTextFailure = 'not-a-pdf';
        log({
          msg: 'open-access pdf could not be read',
          sourceId: source.id,
          error: String(error),
        });
      }
    } else {
      fullTextFailure = outcome.reason;
    }
  }

  // 2b. ADR-0054: no PDF could be read, so ask Europe PMC for the article as JATS. Springer's bot
  // check (2026) turned away every server-side PDF fetch of its open-access papers; this is the
  // sanctioned road to the same text for anything in PMC's open-access subset.
  if (!text && source.doi && deps.europePmc) {
    try {
      const article = await deps.europePmc.fullText(source.doi, AbortSignal.timeout(60_000));
      if (article) {
        text = article.text;
        pages = undefined;
        sections = article.sections;
        from = 'open-access-xml';
        via = 'europepmc';
        log({
          msg: 'full text from europe pmc',
          sourceId: source.id,
          pmcid: article.pmcid,
          pdfFailure: fullTextFailure,
        });
        fullTextFailure = undefined;
      }
    } catch (error) {
      log({ msg: 'europe pmc lookup failed', sourceId: source.id, error: String(error) });
    }
  }

  const hasFullText = text !== null && text.trim().length > 0;

  // R14 (ADR-0101): why there is no full text, for the library to say per paper ("Fetch PDF");
  // cleared once one has been read. Only what was actually tried is said.
  await deps.prisma.source.update({
    where: { id: source.id },
    data: {
      fullTextNote:
        hasFullText || !fullTextFailure ? null : readableFullTextReason(fullTextFailure),
    },
  });

  // The abstract is already indexed and nothing better was found: done, without embedding it twice.
  if (!hasFullText && abstractFirst) {
    log({
      msg: 'source indexed',
      sourceId: source.id,
      from: 'abstract',
      chunks: abstractFirst.chunks,
      groundingLevel: 'ABSTRACT',
      ...(fullTextFailure ? { fullTextFailure } : {}),
    });
    return {
      sourceId: source.id,
      groundingLevel: 'ABSTRACT',
      chunks: abstractFirst.chunks,
      from: 'abstract',
      ...(fullTextFailure ? { fullTextFailure } : {}),
    };
  }

  // 3. Fall back to the abstract, which `resolve-reference` stored as plain text on the CSL record.
  if (!hasFullText) {
    const abstract = abstractOf(source.cslJson);
    if (abstract) {
      text = abstract;
      pages = undefined;
      sections = [{ section: 'Abstract', start: 0, end: abstract.length }];
      from = 'abstract';
    }
  }

  if (!text || text.trim().length === 0) {
    await deps.prisma.source.update({
      where: { id: source.id },
      data: { groundingLevel: 'NONE' },
    });
    log({
      msg: 'nothing to index',
      sourceId: source.id,
      ...(fullTextFailure ? { why: readableFullTextReason(fullTextFailure) } : {}),
    });
    return {
      sourceId: source.id,
      groundingLevel: 'NONE',
      chunks: 0,
      from: 'nothing',
      ...(fullTextFailure ? { fullTextFailure } : {}),
    };
  }

  const written = await store(
    chunkText({
      text,
      ...(pages ? { pages } : {}),
      ...(sections ? { sections } : {}),
    }),
  );

  const groundingLevel = groundingLevelFor(hasFullText, from === 'abstract');

  await deps.prisma.source.update({
    where: { id: source.id },
    data: { groundingLevel, ...(fileKey && fileKey !== source.fileKey ? { fileKey } : {}) },
  });

  log({
    msg: 'source indexed',
    sourceId: source.id,
    from,
    ...(via ? { via } : {}),
    chunks: written,
    groundingLevel,
    ...(fullTextFailure ? { fullTextFailure } : {}),
  });

  return {
    sourceId: source.id,
    groundingLevel,
    chunks: written,
    from,
    ...(via ? { via } : {}),
    ...(fullTextFailure ? { fullTextFailure } : {}),
  };
}

type OpenAccessOutcome =
  | { ok: true; bytes: Buffer; via: 'unpaywall' | 'core' | 'arxiv' }
  | { ok: false; reason: FullTextFailure };

/**
 * Asks Unpaywall where the open-access copy is and fetches it; when that yields nothing, asks CORE
 * (FR-2.2: "Unpaywall `best_oa_location` → PDF; fallback CORE"). Never throws.
 */
async function fetchFromOpenAccess(
  doi: string,
  deps: IndexSourceDeps,
  log: (event: Record<string, unknown>) => void,
  sourceId: string,
): Promise<OpenAccessOutcome> {
  // An arXiv paper is always free at a known address. Unpaywall does not list arXiv's own DOIs
  // (10.48550/arxiv.*), so "Attention Is All You Need" came back abstract-only (2026-10-05).
  const arxiv = arxivPdfUrl(doi);
  if (arxiv) {
    const result = await fetchOpenAccessPdf(arxiv);
    if (result.ok) {
      log({ msg: 'full text from arxiv', sourceId, url: arxiv });
      return { ok: true, bytes: result.bytes, via: 'arxiv' };
    }
    log({ msg: 'arxiv pdf could not be fetched', sourceId, url: arxiv, reason: result.reason });
  }

  let pdfUrls: string[] = [];
  let unpaywallFailure: FullTextFailure | null = null;
  try {
    const location = await deps.unpaywall.bestOpenAccess(doi);
    pdfUrls = location?.pdfUrls ?? (location?.pdfUrl ? [location.pdfUrl] : []);
  } catch (error) {
    // A placeholder contact address makes Unpaywall answer 422; the worker warns about that at boot.
    log({ msg: 'unpaywall lookup failed', sourceId, error: String(error) });
    unpaywallFailure = 'network';
  }

  if (!unpaywallFailure) {
    // ADR-0050: every copy Unpaywall lists, best first, until one is a real PDF (at most four,
    // so a paper with a dozen mirrors does not cost a dozen downloads).
    if (pdfUrls.length === 0) unpaywallFailure = 'no-location';
    for (const url of pdfUrls.slice(0, 4)) {
      const result = await fetchOpenAccessPdf(url);
      if (result.ok) {
        if (url !== pdfUrls[0]) log({ msg: 'full text from a second open copy', sourceId, url });
        return { ok: true, bytes: result.bytes, via: 'unpaywall' };
      }
      unpaywallFailure ??= result.reason;
    }
  }

  // The fallback. Only reached once Unpaywall has failed, and only when a key was configured.
  const failure: FullTextFailure = unpaywallFailure ?? 'no-location';
  if (!deps.core) return { ok: false, reason: failure };

  let coreUrl: string | null = null;
  try {
    const hit = await deps.core.fullTextUrl(doi);
    if (hit) {
      coreUrl = hit.pdfUrl;
      log({ msg: 'core has a copy', sourceId, coreId: hit.coreId, via: hit.via });
    }
  } catch (error) {
    // An invalid key answers 401; the fallback is best-effort, so the Unpaywall verdict stands.
    log({ msg: 'core lookup failed', sourceId, error: String(error) });
    return { ok: false, reason: failure };
  }
  if (!coreUrl) return { ok: false, reason: failure };

  const result = await fetchOpenAccessPdf(coreUrl);
  if (result.ok) {
    log({ msg: 'full text fetched via core fallback', sourceId, url: coreUrl });
    return { ok: true, bytes: result.bytes, via: 'core' };
  }
  // CORE named a copy and it could not be read: that is the more specific reason to report.
  log({ msg: 'core copy could not be fetched', sourceId, url: coreUrl, reason: result.reason });
  return { ok: false, reason: result.reason };
}

/**
 * The arXiv PDF for an arXiv DOI — `10.48550/arXiv.1706.03762` → `https://arxiv.org/pdf/1706.03762`
 * — or null for any other DOI. Old-style ids (`hep-th/9901001`) keep their slash.
 */
export function arxivPdfUrl(doi: string): string | null {
  const id = /^10\.48550\/arxiv\.(.+)$/i.exec(doi.trim())?.[1];
  return id ? `https://arxiv.org/pdf/${id}` : null;
}

/** The plain-text abstract `resolve-reference` stored on the CSL record, if there is one. */
function abstractOf(cslJson: unknown): string | null {
  if (!cslJson || typeof cslJson !== 'object') return null;
  const abstract = (cslJson as { abstract?: unknown }).abstract;
  return typeof abstract === 'string' && abstract.trim().length > 0 ? abstract.trim() : null;
}

/** One lookup's time limit while identifying an upload; the indexing goes on without it. */
const IDENTIFY_TIMEOUT_MS = 20_000;

/**
 * R20 (ADR-0107): names an uploaded PDF from its first page. A printed DOI wins (Crossref's record,
 * or OpenAlex's); otherwise the title, byline, year and abstract read from the page; a page with
 * nothing readable leaves the paper UNRESOLVED ("needs a hand") rather than "still looking up"
 * for ever, which is where every upload sat before.
 */
async function identifyUpload(
  sourceId: string,
  text: string | null,
  pages: ReadonlyArray<{ page: number; start: number; end: number }> | undefined,
  deps: IndexSourceDeps,
  log: (event: Record<string, unknown>) => void,
): Promise<void> {
  const first = pages?.find((p) => p.page === 1);
  const firstText = text
    ? first
      ? text.slice(first.start, first.end)
      : text.slice(0, FIRST_PAGE_CHARS)
    : '';
  const page = readFirstPage(firstText);

  if (page.doi && deps.resolveDoi) {
    const resolved = await deps
      .resolveDoi(page.doi, AbortSignal.timeout(IDENTIFY_TIMEOUT_MS))
      .catch(() => null);
    if (resolved?.title) {
      const abstract = resolved.abstract ?? page.abstract ?? null;
      await deps.prisma.source.update({
        where: { id: sourceId },
        data: {
          status: 'RESOLVED',
          doi: resolved.doi ?? page.doi,
          ...(resolved.openalexId ? { openalexId: resolved.openalexId } : {}),
          title: resolved.title,
          authors: resolved.authors as never,
          ...(resolved.year !== null ? { year: resolved.year } : {}),
          ...(resolved.venue ? { venue: resolved.venue } : {}),
          ...(resolved.type ? { type: resolved.type } : {}),
          cslJson: { ...(resolved.cslJson ?? {}), ...(abstract ? { abstract } : {}) } as never,
          ...(resolved.oaStatus ? { oaStatus: resolved.oaStatus } : {}),
          ...(resolved.citationCount !== null ? { citationCount: resolved.citationCount } : {}),
          isPreprint: resolved.isPreprint,
          isRetracted: resolved.isRetracted,
        },
      });
      log({ msg: 'upload identified by its doi', sourceId, doi: page.doi });
      return;
    }
  }

  if (page.title) {
    await deps.prisma.source.update({
      where: { id: sourceId },
      data: {
        status: 'RESOLVED',
        title: page.title,
        authors: (page.authors ?? []) as never,
        ...(page.year ? { year: page.year } : {}),
        ...(page.doi ? { doi: page.doi } : {}),
        cslJson: {
          type: 'article-journal',
          title: page.title,
          ...(page.authors?.length ? { author: page.authors } : {}),
          ...(page.year ? { issued: { 'date-parts': [[page.year]] } } : {}),
          ...(page.abstract ? { abstract: page.abstract } : {}),
        } as never,
      },
    });
    log({
      msg: 'upload identified from its first page',
      sourceId,
      authors: page.authors?.length ?? 0,
    });
    return;
  }

  await deps.prisma.source.update({ where: { id: sourceId }, data: { status: 'UNRESOLVED' } });
  log({ msg: 'upload could not be identified', sourceId });
}
