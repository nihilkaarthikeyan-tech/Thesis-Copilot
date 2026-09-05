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
  chunkText,
  type ExtractedDocument,
  type FullTextFailure,
  fetchOpenAccessPdf,
  groundingLevelFor,
  readableFullTextReason,
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
  /** Reads a PDF already in object storage — a student upload, or one fetched by an earlier run. */
  getObject: (key: string) => Promise<Buffer>;
  /** Writes a fetched open-access PDF to object storage. */
  putObject: (key: string, body: Buffer) => Promise<unknown>;
  /** PDF bytes to text with page and section spans; the same extractor the seed papers use. */
  extract: (bytes: Buffer) => Promise<ExtractedDocument>;
  log?: (event: Record<string, unknown>) => void;
};

export type IndexSourceResult = {
  sourceId: string;
  groundingLevel: 'NONE' | 'ABSTRACT' | 'FULL_TEXT';
  chunks: number;
  /** Where the indexed text came from, so the log says what was actually read. */
  from: 'stored-pdf' | 'open-access-pdf' | 'abstract' | 'nothing';
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

  const hasFullText = text !== null && text.trim().length > 0;

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

  const chunks = chunkText({
    text,
    ...(pages ? { pages } : {}),
    ...(sections ? { sections } : {}),
  });

  const vectors: number[][] = [];
  for (const batch of batched(chunks, EMBED_BATCH)) {
    vectors.push(...(await deps.embeddings.embed(batch.map((chunk) => chunk.text))));
  }
  if (vectors.length !== chunks.length) {
    throw new Error(`embedding count ${vectors.length} does not match ${chunks.length} chunks`);
  }

  const written = await replaceSourceChunks(
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

  const groundingLevel = groundingLevelFor(hasFullText, from === 'abstract');

  await deps.prisma.source.update({
    where: { id: source.id },
    data: { groundingLevel, ...(fileKey && fileKey !== source.fileKey ? { fileKey } : {}) },
  });

  log({
    msg: 'source indexed',
    sourceId: source.id,
    from,
    chunks: written,
    groundingLevel,
    ...(fullTextFailure ? { fullTextFailure } : {}),
  });

  return {
    sourceId: source.id,
    groundingLevel,
    chunks: written,
    from,
    ...(fullTextFailure ? { fullTextFailure } : {}),
  };
}

/** Asks Unpaywall where the open-access copy is, then fetches it. Never throws. */
async function fetchFromOpenAccess(
  doi: string,
  deps: IndexSourceDeps,
  log: (event: Record<string, unknown>) => void,
  sourceId: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: FullTextFailure }> {
  let pdfUrl: string | null = null;
  try {
    const location = await deps.unpaywall.bestOpenAccess(doi);
    pdfUrl = location?.pdfUrl ?? null;
  } catch (error) {
    // A placeholder contact address makes Unpaywall answer 422; the worker warns about that at boot.
    log({ msg: 'unpaywall lookup failed', sourceId, error: String(error) });
    return { ok: false, reason: 'network' };
  }

  const result = await fetchOpenAccessPdf(pdfUrl);
  return result.ok ? { ok: true, bytes: result.bytes } : { ok: false, reason: result.reason };
}

/** The plain-text abstract `resolve-reference` stored on the CSL record, if there is one. */
function abstractOf(cslJson: unknown): string | null {
  if (!cslJson || typeof cslJson !== 'object') return null;
  const abstract = (cslJson as { abstract?: unknown }).abstract;
  return typeof abstract === 'string' && abstract.trim().length > 0 ? abstract.trim() : null;
}
